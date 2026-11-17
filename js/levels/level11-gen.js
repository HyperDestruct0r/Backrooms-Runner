"use strict";

/* Level 11 — City of Concrete. Pure generation layer: no THREE, no DOM, so every rule here can be tested in Node.
   (Floor interiors are in level11-floors.js; the runtime that builds meshes and streams is level11.js.)

   Everything is a pure function of (world seed, integer coordinates). The same seed gives the same city.

   WORLD MODEL
     Roads run along x = i * PITCH and z = j * PITCH. The spawn is the centre of the crossing at the origin.
     Block (bi, bj) is the square between four roads: x in [bi*PITCH + ROAD/2, (bi+1)*PITCH - ROAD/2], same for z.
     A block is one of: quad (4 towers, a cross-shaped alley), pair (2 towers, an alley), single (1 big lot, a forecourt plaza),
     split (a tower and a small park), park, plaza. Block (0,0) is always a quad and its first tower is always enterable.
     Building: block + lot index k. ID = category + "-" + 8 hex digits of a hash of (seed, bi, bj, k).
     The entrance faces a street. Local building frame: origin at the footprint centre, the entrance on local +z.

   FLOORS
     Floor 1 is the lobby (y = 0). Floor k >= 1 has its walking surface at (k-1)*FLOOR_H. Basement levels are -1, -2, ...
     at k*BASE_H below street level. The only way to stand above the top floor is the optional roof, floor H+1.
     Each floor has its own seed: floorSeed(seed, buildingId, floor). Nothing about a floor depends on what the player did.

   THE ANOMALY (a separate system from basements)
     The first anomaly is searched deterministically in a 1000..5000 m annulus round the spawn and snapped to an enterable
     building. Further ones come from a coarse grid with random priorities (a greedy independent set), so each is at least
     1000 m from every other one and from the spawn; a candidate that breaks a rule is dropped, never moved.
     If no valid first location is found within the search budget the placement is deferred and no anomaly exists. */
const Level11Gen = {
  seed: 0,
  FLOOR_H: 3.2, BASE_H: 3.6, SLAB: 0.3,
  PITCH: 104, ROAD: 16, BLOCK: 88, ALLEY: 6, SETBACK: 3,
  MIN_FLOORS: 10, MAX_FLOORS: 60,
  CATS: ["APT", "OFF", "HTL", "COM", "MED", "MIX"],
  CAT_NAMES: { APT: "Apartment", OFF: "Office", HTL: "Hotel", COM: "Commercial", MED: "Medical", MIX: "Mixed-use" },
  CAT_WEIGHTS: { APT: 0.25, OFF: 0.28, HTL: 0.10, COM: 0.14, MED: 0.07, MIX: 0.16 },
  // configurable generation ranges (inclusive)
  HEIGHTS: { APT: [30, 60], OFF: [10, 25], HTL: [20, 50], COM: [10, 30], MED: [15, 45], MIX: [15, 60] },
  LOCKED_P: 0.15,                                   // share of buildings with a permanently locked entrance (whole buildings only)
  FLOOR_TYPES: ["residential", "office", "hotel", "commercial", "medical", "utility", "unfinished"],
  // weights over the floor types, per category. MIX uses its sections (below) and these weights inside a section.
  FLOOR_WEIGHTS: {
    APT: { residential: 72, utility: 8, commercial: 7, office: 6, unfinished: 7 },
    OFF: { office: 74, utility: 8, commercial: 8, unfinished: 10 },
    HTL: { hotel: 80, utility: 7, commercial: 7, office: 3, unfinished: 3 },
    COM: { commercial: 78, office: 8, utility: 7, unfinished: 7 },
    MED: { medical: 80, utility: 8, office: 6, commercial: 3, unfinished: 3 }
  },
  // MIX: three vertical sections. Each template is [lower, middle, upper] as the category whose floor weights apply.
  MIX_TEMPLATES: [["COM", "OFF", "APT"], ["COM", "HTL", "APT"], ["COM", "OFF", "HTL"], ["MED", "OFF", "APT"]],
  BASEMENT_P: { APT: 0.40, OFF: 0.55, HTL: 0.60, COM: 0.60, MED: 0.50, MIX: 0.60 },
  RAMP_P: 0.70,                                     // of buildings that have a basement
  ROOF_P: 0.30,                                     // of enterable buildings
  ANOM: { MIN_FIRST: 1000, MAX_FIRST: 5000, SEP: 1000, CELL: 1600, CAND_P: 0.25, TRIP_P: 0.12, BUDGET: 400, MIN_RIDE: 4 },

  _blocks: new Map(), _bld: new Map(), _anom: null, _anomMemo: new Map(),

  /* ------------------------------------------------------------------ hashing */
  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },
  h32(a, b, c, d) {
    let h = (this.seed >>> 0) ^ Math.imul((a | 0) + 0x9e3779b9, 0x45d9f3b) ^ Math.imul((b | 0) - 0x7f4a7c15, 0x27d4eb2d) ^ Math.imul((c | 0) + 0x165667b1, 0x85ebca6b) ^ Math.imul((d | 0) + 0x61c88647, 0xc2b2ae35);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  },
  hash(a, b, c, d) { return this.h32(a, b, c, d) / 4294967296; },
  trng(a, b, c, d) { const r = this.rng(this.h32(a, b, c, d)); r(); r(); return r; },
  hex8(n) { return ("00000000" + (n >>> 0).toString(16).toUpperCase()).slice(-8); },
  // a seed for anything keyed by a building ID string + a number (floors, loot, trips): world seed + building + n
  floorSeed(seed, buildingIdHash, floor) {
    let h = (seed >>> 0) ^ Math.imul((buildingIdHash | 0) + 0x7f4a7c15, 0x27d4eb2d) ^ Math.imul((floor | 0) + 0x3c6ef372, 0x45d9f3b);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  },

  init(seed) {
    this.seed = seed >>> 0;
    this._blocks = new Map(); this._bld = new Map(); this._anom = null; this._anomMemo = new Map();
  },
  pick(r, weights) {
    let t = 0; for (const k in weights) t += weights[k];
    let x = r * t;
    for (const k in weights) { x -= weights[k]; if (x < 0) return k; }
    return Object.keys(weights)[0];
  },

  /* ------------------------------------------------------------------ blocks */
  blockOrigin(bi, bj) { return { x0: bi * this.PITCH + this.ROAD / 2, z0: bj * this.PITCH + this.ROAD / 2 }; },
  blockIndex(v) { return Math.floor(v / this.PITCH); },
  spawn() { return { x: 0, z: 0, yaw: -Math.PI / 4 }; },

  block(bi, bj) {
    const key = bi + "," + bj, hit = this._blocks.get(key);
    if (hit) return hit;
    if (this._blocks.size > 3000) this._blocks.clear();
    const o = this.blockOrigin(bi, bj), B = this.BLOCK, A = this.ALLEY, half = (B - A) / 2;
    const h = this.hash(bi, bj, 11);
    let type = h < 0.34 ? "quad" : h < 0.54 ? "pair" : h < 0.74 ? "single" : h < 0.84 ? "split" : h < 0.92 ? "park" : "plaza";
    if (bi === 0 && bj === 0) type = "quad";
    const lots = [], R = { x0: o.x0, z0: o.z0, x1: o.x0 + B, z1: o.z0 + B };
    const lot = (k, x0, z0, x1, z1) => lots.push({ k, x0, z0, x1, z1 });
    let open = null;                                   // the non-building part: a park or plaza rect
    if (type === "quad") {
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) lot(a + 2 * b, o.x0 + a * (half + A), o.z0 + b * (half + A), o.x0 + a * (half + A) + half, o.z0 + b * (half + A) + half);
    } else if (type === "pair") {
      if (this.hash(bi, bj, 12) < 0.5) { lot(0, R.x0, R.z0, R.x0 + half, R.z1); lot(1, R.x0 + half + A, R.z0, R.x1, R.z1); }
      else { lot(0, R.x0, R.z0, R.x1, R.z0 + half); lot(1, R.x0, R.z0 + half + A, R.x1, R.z1); }
    } else if (type === "single") {
      lot(0, R.x0, R.z0, R.x1, R.z1);
    } else if (type === "split") {
      const tw = 56;
      if (this.hash(bi, bj, 13) < 0.5) { lot(0, R.x0, R.z0, R.x0 + tw, R.z1); open = { x0: R.x0 + tw + A, z0: R.z0, x1: R.x1, z1: R.z1 }; }
      else { lot(0, R.x0, R.z0, R.x1, R.z0 + tw); open = { x0: R.x0, z0: R.z0 + tw + A, x1: R.x1, z1: R.z1 }; }
    } else {
      open = R;
    }
    if (type === "park" || type === "plaza") open = R;
    const out = { key, bi, bj, type, rect: R, lots, open, openKind: type === "plaza" ? "plaza" : "park" };
    if (type === "single") out.forecourt = true;
    this._blocks.set(key, out);
    return out;
  },

  /* ------------------------------------------------------------------ buildings */
  category(bi, bj, k) { return this.pick(this.hash(bi, bj, k, 21), this.CAT_WEIGHTS); },
  floorsFor(cat, bi, bj, k) {
    const r = this.HEIGHTS[cat], lo = Math.max(this.MIN_FLOORS, r[0]), hi = Math.min(this.MAX_FLOORS, r[1]);
    return lo + Math.floor(this.hash(bi, bj, k, 22) * (hi - lo + 1));
  },
  footprint(cat, lot, bi, bj, k) {
    const base = { APT: [30, 38], OFF: [34, 46], HTL: [30, 42], COM: [36, 50], MED: [34, 46], MIX: [32, 44] }[cat];
    const lw = lot.x1 - lot.x0 - 2 * this.SETBACK, ld = lot.z1 - lot.z0 - 2 * this.SETBACK;
    const pickDim = (salt, cap) => Math.max(28, Math.min(cap, base[0] + Math.floor(this.hash(bi, bj, k, salt) * (base[1] - base[0] + 1))));
    return { w: Math.round(pickDim(23, lw)), d: Math.round(pickDim(24, ld)) };
  },
  // facing: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x): the way the entrance looks. It faces a street.
  entranceFacing(blk, lot, bi, bj, k) {
    const sides = [];
    if (lot.z0 === blk.rect.z0) sides.push(0);
    if (lot.x1 === blk.rect.x1) sides.push(1);
    if (lot.z1 === blk.rect.z1) sides.push(2);
    if (lot.x0 === blk.rect.x0) sides.push(3);
    if (!sides.length) sides.push(2);
    if (bi === 0 && bj === 0 && k === 0) return this.hash(bi, bj, k, 25) < 0.5 ? 3 : 0;      // toward the spawn crossing
    return sides[Math.floor(this.hash(bi, bj, k, 25) * sides.length) % sides.length];
  },
  THETA: [Math.PI, Math.PI / 2, 0, Math.PI * 1.5],   // local frame -> world yaw for L9Builder.push (see level11.js)
  toWorld(b, lx, lz) {
    switch (b.facing) {
      case 2: return { x: b.x + lx, z: b.z + lz };
      case 0: return { x: b.x - lx, z: b.z - lz };
      case 1: return { x: b.x + lz, z: b.z - lx };
      default: return { x: b.x - lz, z: b.z + lx };
    }
  },
  toLocal(b, wx, wz) {
    const dx = wx - b.x, dz = wz - b.z;
    switch (b.facing) {
      case 2: return { x: dx, z: dz };
      case 0: return { x: -dx, z: -dz };
      case 1: return { x: -dz, z: dx };
      default: return { x: dz, z: -dx };
    }
  },
  // the world AABB of a local rectangle
  worldRect(b, x0, z0, x1, z1) {
    const a = this.toWorld(b, x0, z0), c = this.toWorld(b, x1, z1);
    return { x0: Math.min(a.x, c.x), z0: Math.min(a.z, c.z), x1: Math.max(a.x, c.x), z1: Math.max(a.z, c.z) };
  },

  building(bi, bj, k) {
    const key = bi + "," + bj + "," + k, hit = this._bld.get(key);
    if (hit) return hit;
    const blk = this.block(bi, bj), lot = blk.lots.find(l => l.k === k);
    if (!lot) return null;
    if (this._bld.size > 6000) this._bld.clear();
    const cat = this.category(bi, bj, k), floors = this.floorsFor(cat, bi, bj, k), idHash = this.h32(bi, bj, k, 0x11B);
    const fp = this.footprint(cat, lot, bi, bj, k), facing = this.entranceFacing(blk, lot, bi, bj, k);
    let enterable = this.hash(bi, bj, k, 26) >= this.LOCKED_P;
    if (bi === 0 && bj === 0 && k === 0) enterable = true;
    const swap = facing === 1 || facing === 3;
    const b = {
      key, bi, bj, k, id: cat + "-" + this.hex8(idHash), idHash, cat, floors, enterable, facing,
      x: (lot.x0 + lot.x1) / 2, z: (lot.z0 + lot.z1) / 2, w: fp.w, d: fp.d, lot,
      theta: this.THETA[facing],
      // the footprint's world extents (the entrance side swaps width and depth)
      hx: (swap ? fp.d : fp.w) / 2, hz: (swap ? fp.w : fp.d) / 2
    };
    b.look = this.look(b);
    b.mix = cat === "MIX" ? this.mixSections(b) : null;
    b.basement = this.basement(b);
    b.roof = enterable && this.hash(bi, bj, k, 27) < this.ROOF_P;
    b.variations = this.variations(b);
    b.footRect = { x0: b.x - b.hx, z0: b.z - b.hz, x1: b.x + b.hx, z1: b.z + b.hz };
    this._bld.set(key, b);
    return b;
  },
  buildingByKey(key) { const p = key.split(",").map(Number); return this.building(p[0], p[1], p[2]); },
  buildingsInBlock(bi, bj) { return this.block(bi, bj).lots.map(l => this.building(bi, bj, l.k)); },

  // The exterior. Category drives the window arrangement and the entrance; the id hash drives the colours.
  PALETTES: [
    { wall: 0x8e8c86, trim: 0x6d6b66, glass: 0x2d3a42 }, { wall: 0xa49c8c, trim: 0x7a7266, glass: 0x34424a },
    { wall: 0x7a7d80, trim: 0x585b5e, glass: 0x26343c }, { wall: 0x8a7a6c, trim: 0x65584c, glass: 0x303c40 },
    { wall: 0x9a9fa2, trim: 0x74787a, glass: 0x2a4048 }, { wall: 0x6f716f, trim: 0x4c4e4c, glass: 0x22302f },
    { wall: 0xb0aa9c, trim: 0x877f70, glass: 0x384650 }, { wall: 0x7d6f64, trim: 0x5a4d44, glass: 0x2b3638 }
  ],
  STYLES: {
    APT: { win: "cells", pier: 1.7, ribbon: 0.62, sill: 0.95, balcony: true },
    OFF: { win: "curtain", pier: 3.0, ribbon: 0.86, sill: 0.45, balcony: false },
    HTL: { win: "grid", pier: 2.4, ribbon: 0.64, sill: 0.9, balcony: false },
    COM: { win: "ribbon", pier: 4.2, ribbon: 0.7, sill: 0.7, balcony: false },
    MED: { win: "slit", pier: 2.0, ribbon: 0.42, sill: 1.1, balcony: false },
    MIX: { win: "mixed", pier: 2.4, ribbon: 0.66, sill: 0.85, balcony: false }
  },
  ENTRANCES: { APT: "canopy", OFF: "revolving", HTL: "portico", COM: "storefront", MED: "ambulance", MIX: "canopy" },
  look(b) {
    const h = (n) => this.hash(b.bi, b.bj, b.k, 30 + n), pal = (n) => this.PALETTES[Math.floor(h(n) * this.PALETTES.length)];
    const st = this.STYLES[b.cat];
    return {
      pal: pal(0), style: st.win, pier: st.pier, ribbon: st.ribbon, sill: st.sill, balcony: st.balcony && h(1) < 0.6,
      entrance: this.ENTRANCES[b.cat], crown: ["flat", "mech", "setback", "crown"][Math.floor(h(2) * 4)],
      podium: b.cat === "COM" || b.cat === "HTL" || h(3) < 0.4, shade: 0.9 + 0.2 * h(4),
      sections: b.cat === "MIX" ? [pal(5), pal(6), pal(7)] : null,
      sectionStyles: b.cat === "MIX" ? ["storefront", "curtain", "cells"] : null
    };
  },

  /* ------------------------------------------------------------------ MIX: distinct vertical sections */
  mixSections(b) {
    const H = b.floors, t = this.MIX_TEMPLATES[Math.floor(this.hash(b.bi, b.bj, b.k, 41) * this.MIX_TEMPLATES.length)];
    // the lobby is floor 1 (the lower section starts at 2). Boundaries are fractions of the height, then clamped so
    // every section holds at least 3 floors. The exact split differs between MIX buildings.
    let a = Math.round(H * (0.18 + 0.14 * this.hash(b.bi, b.bj, b.k, 42))), c = Math.round(H * (0.48 + 0.2 * this.hash(b.bi, b.bj, b.k, 43)));
    a = Math.max(4, Math.min(a, H - 6)); c = Math.max(a + 3, Math.min(c, H - 3));
    return [{ from: 1, to: a, cat: t[0] }, { from: a + 1, to: c, cat: t[1] }, { from: c + 1, to: H, cat: t[2] }];
  },

  /* ------------------------------------------------------------------ floors */
  floorTypeWeights(cat) { return this.FLOOR_WEIGHTS[cat] || null; },
  // The type of floor f (1..H) of building b. Pure in (seed, building, floor). Floor 1 is always the lobby.
  floorType(b, f) {
    if (f === 1) return "lobby";
    if (f > b.floors) return f === b.floors + 1 && b.roof ? "roof" : null;
    if (f < 1) return f >= -b.basement.levels && b.basement.has ? "parking" : null;
    const v = b.variations;
    if (v.unfinishedFrom && f >= v.unfinishedFrom) return "unfinished";
    if (v.cafeteria === f) return "cafeteria";
    let cat = b.cat;
    if (cat === "MIX") { const s = b.mix.find(m => f >= m.from && f <= m.to); cat = s ? s.cat : "OFF"; }
    const w = this.FLOOR_WEIGHTS[cat];
    return this.pick(this.hash(b.bi, b.bj, b.k, 50 + f * 7), w);
  },
  // rare variations of an existing category (never new categories)
  variations(b) {
    const h = (n) => this.hash(b.bi, b.bj, b.k, 60 + n), v = { bigFloor: 0, cafeteria: 0, bigLobby: false, bigBasement: false, unfinishedFrom: 0 };
    if (!b.enterable) return v;
    if (h(0) < 0.07) v.bigFloor = 3 + Math.floor(h(1) * (b.floors - 4));                               // one unusually large floor
    if (b.cat === "OFF" && h(2) < 0.25 && b.floors >= 12) v.cafeteria = 4 + Math.floor(h(3) * (b.floors - 6));   // an entire cafeteria floor
    if (b.cat === "APT" && h(4) < 0.2) v.bigLobby = true;                                               // a very large lobby
    if (b.basement.has && h(5) < 0.15) v.bigBasement = true;                                            // an unusually large basement
    if (h(6) < 0.06 && b.floors >= 14) v.unfinishedFrom = b.floors - 2 - Math.floor(h(7) * 4);          // an unfinished upper section
    return v;
  },
  basement(b) {
    const none = { has: false, levels: 0, ramp: false, pedestrian: true, rampSide: 1, config: "none" };
    if (!b.enterable) return none;
    if (this.hash(b.bi, b.bj, b.k, 70) >= this.BASEMENT_P[b.cat]) return none;
    const r = this.hash(b.bi, b.bj, b.k, 71), levels = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    const ramp = this.hash(b.bi, b.bj, b.k, 72) < this.RAMP_P;
    const pedestrian = ramp ? this.hash(b.bi, b.bj, b.k, 73) >= 0.06 : true;     // a basement with no stairs up is reached by its ramp only
    const config = ["grid", "rows", "perimeter"][Math.floor(this.hash(b.bi, b.bj, b.k, 74) * 3)];
    return { has: true, levels, ramp, pedestrian, rampSide: this.hash(b.bi, b.bj, b.k, 75) < 0.5 ? -1 : 1, config };
  },

  // y of a floor's walking surface above the street, for floor numbers ..., -2, -1, 1, 2, ..., H, H+1
  floorY(f) { return f >= 1 ? (f - 1) * this.FLOOR_H : f * this.BASE_H; },
  floorHeight(f) { return f >= 1 ? this.FLOOR_H : this.BASE_H; },          // distance to the floor above
  // the floors that exist, bottom to top
  floorList(b) {
    const l = [];
    if (b.basement.has) for (let k = -b.basement.levels; k <= -1; k++) l.push(k);
    for (let f = 1; f <= b.floors; f++) l.push(f);
    if (b.roof) l.push(b.floors + 1);
    return l;
  },
  floorBelow(b, f) {
    if (f === 1) return b.basement.has ? -1 : null;
    if (f < 0) return f - 1 >= -b.basement.levels ? f - 1 : null;
    return f - 1;
  },
  floorAbove(b, f) {
    if (f === -1) return 1;
    if (f < -1) return f + 1;
    return f + 1 <= b.floors + (b.roof ? 1 : 0) ? f + 1 : null;
  },
  // the floors that may be generated while the player is on f: f, f-1, f+1 (those that exist)
  window(b, f) {
    const out = [f], lo = this.floorBelow(b, f), hi = this.floorAbove(b, f);
    if (lo != null) out.push(lo);
    if (hi != null) out.push(hi);
    return out;
  },

  /* ------------------------------------------------------------------ lookups by position */
  buildingAt(x, z, margin) {
    const bi = this.blockIndex(x), bj = this.blockIndex(z), m = margin || 0;
    for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) {
      for (const b of this.buildingsInBlock(i, j)) {
        const r = b.footRect;
        if (x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m) return b;
      }
    }
    return null;
  },
  nearestEnterable(px, pz) {
    const bi = this.blockIndex(px), bj = this.blockIndex(pz);
    let best = null, bd = Infinity;
    for (let j = bj - 1; j <= bj + 1; j++) for (let i = bi - 1; i <= bi + 1; i++) {
      for (const b of this.buildingsInBlock(i, j)) {
        if (!b.enterable) continue;
        const d = Math.hypot(b.x - px, b.z - pz);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  },
  // the entrance in the world: the door point on the footprint edge and the point just outside it
  entrance(b) {
    const door = this.toWorld(b, 0, b.d / 2), out = this.toWorld(b, 0, b.d / 2 + 2.4);
    return { x: door.x, z: door.z, outX: out.x, outZ: out.z };
  },
  // the garage door (a second entrance on the same facade): the ramp's top end
  garageDoor(b) {
    if (!b.basement.has || !b.basement.ramp) return null;
    const lx = b.basement.rampSide * (b.w / 2 - 3.1), p = this.toWorld(b, lx, b.d / 2), o = this.toWorld(b, lx, b.d / 2 + 2.4);
    return { x: p.x, z: p.z, outX: o.x, outZ: o.z, lx };
  },

  /* ------------------------------------------------------------------ the anomaly */
  // Deterministic search for the first anomaly. budget: how many candidates to try. Returns { key } or { deferred: true }.
  placeFirst(budget) {
    const A = this.ANOM, n = budget == null ? A.BUDGET : budget;
    for (let a = 0; a < n; a++) {
      const r = Math.sqrt(A.MIN_FIRST * A.MIN_FIRST + (A.MAX_FIRST * A.MAX_FIRST - A.MIN_FIRST * A.MIN_FIRST) * this.hash(a, 0, 0, 801));
      const ang = this.hash(a, 0, 0, 802) * Math.PI * 2;
      const b = this.nearestEnterable(Math.cos(ang) * r, Math.sin(ang) * r);
      if (!b) continue;
      const d = Math.hypot(b.x, b.z);
      if (d < A.MIN_FIRST || d > A.MAX_FIRST) continue;           // a snap that broke a rule: reject, do not accept
      return { key: b.key, attempts: a + 1, distance: d };
    }
    return { deferred: true, attempts: n };
  },
  first(budget) {
    if (budget != null) return this.placeFirst(budget);
    if (!this._anom) this._anom = this.placeFirst();
    return this._anom;
  },
  _cell(ci, cj) {
    const A = this.ANOM;
    if (this.hash(ci, cj, 0, 811) >= A.CAND_P) return null;
    const px = (ci + 0.15 + 0.7 * this.hash(ci, cj, 0, 812)) * A.CELL, pz = (cj + 0.15 + 0.7 * this.hash(ci, cj, 0, 813)) * A.CELL;
    const b = this.nearestEnterable(px, pz);
    if (!b) return null;
    return { ci, cj, key: b.key, x: b.x, z: b.z, pri: this.hash(ci, cj, 0, 814) };
  },
  _accepted(ci, cj) {
    const A = this.ANOM, mk = ci + "," + cj, hit = this._anomMemo.get(mk);
    if (hit !== undefined) return hit;
    let ok = false;
    const c = this._cell(ci, cj), f = this.first();
    if (c && f && !f.deferred) {
      ok = Math.hypot(c.x, c.z) >= A.MIN_FIRST;                    // every anomaly is at least 1000 m from the spawn
      if (ok) { const fb = this.buildingByKey(f.key); if (c.key === f.key || Math.hypot(c.x - fb.x, c.z - fb.z) < A.SEP) ok = false; }
      for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) {
        if (!di && !dj) continue;
        const n = this._cell(ci + di, cj + dj);
        if (!n) continue;
        if ((n.pri > c.pri || (n.pri === c.pri && n.key > c.key)) && Math.hypot(n.x - c.x, n.z - c.z) < A.SEP && this._accepted(ci + di, cj + dj)) ok = false;
      }
    }
    this._anomMemo.set(mk, ok);
    return ok;
  },
  // every anomaly building within R metres of the origin (including the first), as { key, x, z }
  anomalies(R) {
    const out = [], f = this.first();
    if (!f || f.deferred) return out;
    const fb = this.buildingByKey(f.key);
    out.push({ key: f.key, x: fb.x, z: fb.z, first: true });
    const C = this.ANOM.CELL, n = Math.ceil(R / C) + 1;
    for (let cj = -n; cj <= n; cj++) for (let ci = -n; ci <= n; ci++) {
      if (!this._accepted(ci, cj)) continue;
      const c = this._cell(ci, cj);
      if (Math.hypot(c.x, c.z) <= R) out.push({ key: c.key, x: c.x, z: c.z, first: false });
    }
    return out;
  },
  isAnomaly(key) {
    const f = this.first();
    if (!f || f.deferred) return false;
    if (f.key === key) return true;
    const b = this.buildingByKey(key);
    if (!b) return false;
    const C = this.ANOM.CELL, ci = Math.floor(b.x / C), cj = Math.floor(b.z / C);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = this._cell(ci + di, cj + dj);
      if (c && c.key === key && this._accepted(ci + di, cj + dj)) return true;
    }
    return false;
  },
  anomalyId(key) { const p = key.split(",").map(Number); return "ANOM-" + this.hex8(this.h32(p[0], p[1], p[2], 0xA70)); },
  // does an elevator ride in an anomaly building end in the garage? A pure function of (seed, building, trip number).
  anomalyTrip(b, tripIndex, from, to) {
    if (!this.isAnomaly(b.key)) return false;
    if (Math.abs(to - from) < this.ANOM.MIN_RIDE) return false;
    return this.hash(b.bi, b.bj, b.k, 900 + (tripIndex | 0)) < this.ANOM.TRIP_P;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { Level11Gen };
