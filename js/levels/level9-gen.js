"use strict";

/* Level 9 — The Suburbs. Pure generation layer (no THREE, no DOM, so it can be tested in Node).

   Everything here is a pure function of (seed, integer coordinates). Nothing is stored that cannot be rebuilt
   identically, so the same seed gives the same suburb whatever route was walked. Caches are only speed-ups.

   WORLD MODEL
     Road lines. Roads run along a loose grid. Line i (roads along z) sits at x = lineX(i), line j (roads along x)
     at z = lineZ(j). Pitch is about 76 m with +-10 m jitter, so blocks are 56 to 96 m wide. Every third line is
     an arterial (wide, always present). The other segments are local streets: each one is kept if it is the
     "parent" link of an endpoint (every interior node links toward the arterial grid) or on a 80% roll. So the
     network is always connected, some blocks are open on a side, and cul-de-sacs are rare.
     Blocks. Block (bi, bj) lies between lines bi, bi+1 and bj, bj+1. Houses stand along its four sides, facing
     the road, on lots about 22 m wide and 19 m deep. The middle of the block is back yards.
     Houses. A lot is a house (84%), an empty lot, or overgrown. Every house has a spec (archetype, size, colours,
     door, windows, lock, fridge, lit room, ...). Interiors are planned from the spec on demand (interiorPlan).
     Exits. Four special lots: the sealed arrival mound (spawn), the hole back to Level 8, field breaks to
     Level 10, and the Level 11 exit (one, 2000+ m out, at the end of a road with growing arrow signs). */
const Level9Gen = {
  seed: 0,
  SP: 76,          // line pitch
  SW: 1.8,         // sidewalk width
  LD: 14,          // lot depth
  CORNER: 2,       // margin kept clear at the ends of a side
  LOTW: 15.5,      // minimum lot width
  GW: 3.6,         // garage width
  FLOOR_H: 3.0,    // floor to floor
  STEP_RISE: 0.3,
  STEP_RUN: 0.28,
  LEVEL10: { cell: 420, chance: 0.42, near: 260, pref: 700 },
  LEVEL11: { min: 2000, max: 2450, approach: 9 },
  MANGLED_BANDS: [[500, 0.0], [1000, 0.055], [1500, 0.12], [2000, 0.22], [2600, 0.36]],

  _blocks: new Map(), _houses: new Map(), _cands: new Map(), _acc: new Map(), _special: null, _cells: new Map(),
  _crit: new Map(),

  /* ------------------------------------------------------------------
     HASHING (the Level 8 way)
     ------------------------------------------------------------------ */
  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },
  h32(a, b, c) {
    let h = (this.seed >>> 0) ^ Math.imul((a | 0) + 0x9e3779b9, 0x45d9f3b) ^ Math.imul((b | 0) - 0x7f4a7c15, 0x27d4eb2d) ^ Math.imul((c | 0) + 0x165667b1, 0x85ebca6b);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  },
  hash(a, b, c) { return this.h32(a, b, c) / 4294967296; },
  trng(a, b, c) { const r = this.rng(this.h32(a, b, c)); r(); r(); return r; },
  mod3(n) { return ((n % 3) + 3) % 3; },
  // a stable pair of integers for a lot, for hashing
  lotA(l) { return l.bi * 7919 + l.k * 31 + l.s * 5; },
  lotB(l) { return l.bj * 104729 + l.s * 13 + 7; },
  lh(l, salt) { return this.hash(this.lotA(l), this.lotB(l), salt); },
  lr(l, salt) { return this.trng(this.lotA(l), this.lotB(l), salt); },

  init(seed) {
    this.seed = seed >>> 0;
    this._blocks = new Map(); this._houses = new Map(); this._cands = new Map(); this._acc = new Map();
    this._cells = new Map(); this._crit = new Map(); this._special = null; this._signs = new Map();
    this._computeSpecial();
  },

  /* ------------------------------------------------------------------
     ROAD LINES AND SEGMENTS
     ------------------------------------------------------------------ */
  lineX(i) { return i * this.SP + Math.round((this.hash(i, 0, 101) - 0.5) * 20); },
  lineZ(j) { return j * this.SP + Math.round((this.hash(0, j, 102) - 0.5) * 20); },
  rwV(i) { return this.mod3(i) === 0 ? 5 : 3.6; },       // half width of the road along z at lineX(i)
  rwH(j) { return this.mod3(j) === 0 ? 5 : 3.6; },
  arterialH(j) { return this.mod3(j) === 0; },
  arterialV(i) { return this.mod3(i) === 0; },

  // index of the line at or below v
  indexAt(v, axis) {
    const f = axis === 0 ? (k) => this.lineX(k) : (k) => this.lineZ(k);
    let i = Math.floor(v / this.SP);
    while (f(i + 1) <= v) i++;
    while (f(i) > v) i--;
    return i;
  },

  _parent(i, j) {
    if (this.mod3(i) === 0 || this.mod3(j) === 0) return null;
    const sx = this.mod3(i) === 1 ? -1 : 1, sz = this.mod3(j) === 1 ? -1 : 1;
    return this.hash(i, j, 111) < 0.5 ? [i + sx, j] : [i, j + sz];
  },
  segH(i, j) {                                           // road along x from node (i,j) to (i+1,j)
    if (this.mod3(j) === 0) return true;
    const pa = this._parent(i, j), pb = this._parent(i + 1, j);
    if (pa && pa[0] === i + 1 && pa[1] === j) return true;
    if (pb && pb[0] === i && pb[1] === j) return true;
    return this.hash(i, j, 112) < 0.8;
  },
  segV(i, j) {                                           // road along z from node (i,j) to (i,j+1)
    if (this.mod3(i) === 0) return true;
    const pa = this._parent(i, j), pb = this._parent(i, j + 1);
    if (pa && pa[0] === i && pa[1] === j + 1) return true;
    if (pb && pb[0] === i && pb[1] === j) return true;
    return this.hash(i, j, 113) < 0.8;
  },

  /* ------------------------------------------------------------------
     BLOCKS AND LOTS
     ------------------------------------------------------------------ */
  block(bi, bj) {
    const key = bi + "," + bj, hit = this._blocks.get(key);
    if (hit) return hit;
    if (this._blocks.size > 900) this._blocks.clear();
    const x0 = this.lineX(bi), x1 = this.lineX(bi + 1), z0 = this.lineZ(bj), z1 = this.lineZ(bj + 1);
    const roads = [this.segH(bi, bj), this.segV(bi + 1, bj), this.segH(bi, bj + 1), this.segV(bi, bj)];   // S E N W
    const rw = [this.rwH(bj), this.rwV(bi + 1), this.rwH(bj + 1), this.rwV(bi)];
    const SW = this.SW;
    const B = {
      bi, bj, x0, x1, z0, z1, roads, rw,
      ix0: x0 + rw[3] + SW, ix1: x1 - rw[1] - SW, iz0: z0 + rw[0] + SW, iz1: z1 - rw[2] - SW,
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, lots: null
    };
    this._blocks.set(key, B);
    B.lots = this._makeLots(B);
    return B;
  },

  _makeLots(B) {
    const lots = [], LD = this.LD, C = this.CORNER;
    const spec = [
      { s: 0, nx: 0, nz: -1, tx: 1, tz: 0, a0: B.ix0 + C, a1: B.ix1 - C },
      { s: 1, nx: 1, nz: 0, tx: 0, tz: 1, a0: B.iz0 + (B.roads[0] ? LD : 0) + C, a1: B.iz1 - (B.roads[2] ? LD : 0) - C },
      { s: 2, nx: 0, nz: 1, tx: 1, tz: 0, a0: B.ix0 + C, a1: B.ix1 - C },
      { s: 3, nx: -1, nz: 0, tx: 0, tz: 1, a0: B.iz0 + (B.roads[0] ? LD : 0) + C, a1: B.iz1 - (B.roads[2] ? LD : 0) - C }
    ];
    for (const sd of spec) {
      if (!B.roads[sd.s]) continue;
      const len = sd.a1 - sd.a0;
      if (len < 19) continue;
      const n = Math.max(1, Math.floor(len / this.LOTW)), w = len / n;
      for (let k = 0; k < n; k++) {
        const u = sd.a0 + (k + 0.5) * w;
        let fx, fz;
        if (sd.s === 0) { fx = u; fz = B.iz0; } else if (sd.s === 2) { fx = u; fz = B.iz1; }
        else if (sd.s === 1) { fx = B.ix1; fz = u; } else { fx = B.ix0; fz = u; }
        const lot = { id: B.bi + "," + B.bj + "," + sd.s + "," + k, bi: B.bi, bj: B.bj, s: sd.s, k, u, w, fx, fz, nx: sd.nx, nz: sd.nz, tx: sd.tx, tz: sd.tz, kind: "house", special: null, forceFlush: 0 };
        const r = this.lh(lot, 1);
        lot.kind = r < 0.84 ? "house" : r < 0.96 ? "empty" : "weeds";
        lots.push(lot);
      }
    }
    // the spawn lot is the first lot on the south side of block (0,0): its house sits at the far end
    if (B.bi === 0 && B.bj === 0) {
      const sl = lots.find(l => l.s === 0 && l.k === 0);
      if (sl) { sl.kind = "house"; sl.forceFlush = 1; sl.noGarage = true; }
    }
    // specials override the roll
    const sp = this._special;
    if (sp) for (const l of lots) {
      const k = sp.byLot.get(l.id);
      if (k) { l.kind = k; l.special = k; }
    }
    return lots;
  },

  lotsNear(x, z, nb) {
    const bi = this.indexAt(x, 0), bj = this.indexAt(z, 1), out = [];
    for (let dj = -nb; dj <= nb; dj++) for (let di = -nb; di <= nb; di++) for (const l of this.block(bi + di, bj + dj).lots) out.push(l);
    return out;
  },

  // front point of the lot and the point `d` metres into it along the inward direction
  lotPoint(lot, d, lateral) {
    return { x: lot.fx - lot.nx * d + lot.tx * (lateral || 0), z: lot.fz - lot.nz * d + lot.tz * (lateral || 0) };
  },

  /* ------------------------------------------------------------------
     SPECIAL LOTS: spawn, way back to Level 8, Level 10 field breaks, the Level 11 exit
     ------------------------------------------------------------------ */
  spawnInfo() {
    const B = this.block(0, 0);
    return { x: B.ix0 + 3.4, z: B.iz0 + 1.9, mx: B.ix0 + 1.1, mz: B.iz0 + 1.9, yaw: -Math.PI / 2 };   // faces +x, along the road
  },

  _lotDist(lot, d) {
    const p = this.lotPoint(lot, d || 9, 0), s = this.spawnInfo();
    return Math.hypot(p.x - s.x, p.z - s.z);
  },

  _computeSpecial() {
    const byLot = new Map();
    this._special = { byLot, hole8: null, exit11: null, node11: null, approach: null, fields: [] };
    const sp = this.spawnInfo();
    const used = (id) => byLot.has(id);
    const eligible = (l) => (l.kind === "house" || l.kind === "empty" || l.kind === "weeds") && !used(l.id) && !(l.bi === 0 && l.bj === 0);

    // Level 8: a lot 170 to 300 m from the spawn, picked by hash
    {
      let best = null, bs = 9;
      for (let bj = -5; bj <= 5; bj++) for (let bi = -5; bi <= 5; bi++) for (const l of this.block(bi, bj).lots) {
        if (!eligible(l)) continue;
        const d = this._lotDist(l, 9);
        if (d < 170 || d > 300) continue;
        const h = this.lh(l, 201);
        if (h < bs) { bs = h; best = l; }
      }
      if (best) { byLot.set(best.id, "hole8"); this._special.hole8 = best; }
    }
    // Level 11: an arterial crossing 2000 to 2450 m out, the lot nearest to it
    {
      const L = this.LEVEL11;
      const ang = this.hash(0, 0, 211) * Math.PI * 2;
      const dist = L.min + this.hash(0, 0, 212) * (L.max - L.min);
      const tx = sp.x + Math.cos(ang) * dist, tz = sp.z + Math.sin(ang) * dist;
      let I = Math.round(tx / this.SP / 3) * 3, J = Math.round(tz / this.SP / 3) * 3;
      const nodeDist = (i, j) => Math.hypot(this.lineX(i) - sp.x, this.lineZ(j) - sp.z);
      while (nodeDist(I, J) < L.min + 40) { I += Math.sign(I || 1) * 3; J += Math.sign(J || 1) * 3; }
      const nx = this.lineX(I), nz = this.lineZ(J);
      let best = null, bd = 1e9;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) for (const l of this.block(I + di, J + dj).lots) {
        if (!eligible(l)) continue;
        const p = this.lotPoint(l, 8, 0), d = Math.hypot(p.x - nx, p.z - nz);
        if (d < bd) { bd = d; best = l; }
      }
      if (best) { byLot.set(best.id, "exit11"); this._special.exit11 = best; }
      this._special.node11 = { i: I, j: J, x: nx, z: nz, dist: nodeDist(I, J) };
      // the approach: along the arterial through the node, from the spawn side
      const dx = sp.x - nx, dz = sp.z - nz;
      if (Math.abs(dx) >= Math.abs(dz)) this._special.approach = { axis: "H", line: J, node: I, dir: dx < 0 ? 1 : -1 };       // dir: direction of travel toward the node
      else this._special.approach = { axis: "V", line: I, node: J, dir: dz < 0 ? 1 : -1 };
    }
    // Level 10: field breaks. One candidate per 420 m cell; at least one within 700 m of the spawn
    {
      const F = this.LEVEL10, fields = this._special.fields;
      const pick = (a, b) => {
        const cx = F.cell * a + F.cell / 2, cz = F.cell * b + F.cell / 2;
        const bi = this.indexAt(cx, 0), bj = this.indexAt(cz, 1);
        let best = null, bd = 1e9;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const l of this.block(bi + di, bj + dj).lots) {
          if (!eligible(l)) continue;
          const p = this.lotPoint(l, 9, 0), d = Math.hypot(p.x - cx, p.z - cz) + this.lh(l, 221) * 12;
          if (d < bd) { bd = d; best = l; }
        }
        return best;
      };
      const cand = [];
      for (let b = -6; b <= 6; b++) for (let a = -6; a <= 6; a++) {
        const l = pick(a, b);
        if (!l) continue;
        const d = this._lotDist(l, 13);
        if (d < F.near) continue;
        cand.push({ a, b, lot: l, d, nat: this.hash(a, b, 222) < F.chance });
      }
      let any = false;
      for (const c of cand) if (c.nat && c.d < F.pref) any = true;
      if (!any) {
        let bc = null, bh = 9;
        for (const c of cand) { if (c.d >= F.pref) continue; const h = this.hash(c.a, c.b, 223); if (h < bh) { bh = h; bc = c; } }
        if (bc) bc.nat = true;
      }
      for (const c of cand) {
        if (!c.nat || byLot.has(c.lot.id)) continue;
        byLot.set(c.lot.id, "field10");
        fields.push({ lot: c.lot, dist: c.d });
      }
      fields.sort((p, q) => p.dist - q.dist);
    }
    // blocks that hold a special lot get their lots re-flagged when next built
    this._blocks.clear();
    this._houses.clear();
  },

  special() { return this._special; },

  // world position of the thing in a special lot
  exitPoint(lot) {
    const d = lot.special === "field10" ? 13 : lot.special === "hole8" ? 9 : 8;
    return this.lotPoint(lot, d, 0);
  },

  exitList() {
    const out = [], S = this._special;
    if (S.hole8) { const p = this.exitPoint(this.block(S.hole8.bi, S.hole8.bj).lots.find(l => l.id === S.hole8.id)); out.push({ kind: "level8", x: p.x, z: p.z, dist: this._lotDist(S.hole8, 9) }); }
    for (const f of S.fields) { const l = this.block(f.lot.bi, f.lot.bj).lots.find(q => q.id === f.lot.id); const p = this.exitPoint(l); out.push({ kind: "level10", x: p.x, z: p.z, dist: f.dist, nx: l.nx, nz: l.nz }); }
    if (S.exit11) { const l = this.block(S.exit11.bi, S.exit11.bj).lots.find(q => q.id === S.exit11.id); const p = this.exitPoint(l); out.push({ kind: "level11", x: p.x, z: p.z, dist: this._lotDist(S.exit11, 8) }); }
    return out;
  },

  /* ------------------------------------------------------------------
     ARROW SIGNS (Level 11 approach and a few decoys)
     ------------------------------------------------------------------ */
  // Signs on road segment (axis "H"|"V", i, j). Each: { x, z, dx, dz, nx, nz, real }
  // (dx,dz) is the way the arrow points, (nx,nz) the way the panel faces (toward the road).
  segmentSigns(axis, i, j) {
    const key = axis + i + "," + j, hit = this._signs.get(key);
    if (hit) return hit;
    if (this._signs.size > 2000) this._signs.clear();
    const out = [];
    const arterial = axis === "H" ? this.arterialH(j) : this.arterialV(i);
    const exists = axis === "H" ? this.segH(i, j) : this.segV(i, j);
    if (arterial && exists) {
      const A = this._special.approach, L = this.LEVEL11;
      let real = false, m = 0;
      if (A && A.axis === axis) {
        const line = axis === "H" ? j : i, idx = axis === "H" ? i : j;
        if (line === A.line) {
          // segment idx runs from node idx to idx+1. dir +1: travelling toward larger idx.
          if (A.dir > 0 && idx < A.node && idx >= A.node - L.approach) { real = true; m = A.node - 1 - idx; }
          if (A.dir < 0 && idx >= A.node && idx < A.node + L.approach) { real = true; m = idx - A.node; }
        }
      }
      const base = axis === "H" ? { px: this.lineX(i), pz: this.lineZ(j), ex: this.lineX(i + 1), ez: this.lineZ(j) }
        : { px: this.lineX(i), pz: this.lineZ(j), ex: this.lineX(i), ez: this.lineZ(j + 1) };
      const len = Math.hypot(base.ex - base.px, base.ez - base.pz), ux = (base.ex - base.px) / len, uz = (base.ez - base.pz) / len;
      const rw = axis === "H" ? this.rwH(j) : this.rwV(i);
      const put = (frac, dir, isReal) => {
        const cx = base.px + ux * len * frac, cz = base.pz + uz * len * frac;
        const dx = ux * dir, dz = uz * dir;
        const px = -dz, pz = dx, off = rw + this.SW + 0.7;                // right of travel
        out.push({ x: cx + px * off, z: cz + pz * off, dx, dz, nx: -px, nz: -pz, real: isReal });
      };
      if (real) {
        const n = m <= 1 ? 3 : m <= 4 ? 2 : (this.hash(i, j, 231) < 0.7 ? 1 : 0);
        const fr = [0.3, 0.55, 0.8];
        for (let q = 0; q < n; q++) put(n === 1 ? 0.5 : fr[q + (n === 2 ? 0 : 0)], A.dir, true);
      } else if (this.hash(i, j, 232) < 0.045) {
        put(0.3 + this.hash(i, j, 233) * 0.4, this.hash(i, j, 234) < 0.5 ? 1 : -1, false);   // a decoy: one sign, no pattern
      }
    }
    this._signs.set(key, out);
    return out;
  },

  /* ------------------------------------------------------------------
     STREET LAMPS: roughly one per block, a few more on some sides
     ------------------------------------------------------------------ */
  blockLamps(B) {
    const out = [];
    let first = true;
    for (let s = 0; s < 4; s++) {
      if (!B.roads[s]) continue;
      const r = this.trng(B.bi * 7 + s, B.bj * 11, 241);
      if (!first && r() > 0.2) continue;
      first = false;
      const t = 0.18 + r() * 0.64;
      const stat = r();
      const status = stat < 0.58 ? "on" : stat < 0.72 ? "flicker" : "dead";
      let x, z;
      const off = B.rw[s] + 0.6;
      if (s === 0) { x = B.x0 + (B.x1 - B.x0) * t; z = B.z0 + off; }
      else if (s === 2) { x = B.x0 + (B.x1 - B.x0) * t; z = B.z1 - off; }
      else if (s === 3) { x = B.x0 + off; z = B.z0 + (B.z1 - B.z0) * t; }
      else { x = B.x1 - off; z = B.z0 + (B.z1 - B.z0) * t; }
      out.push({ x, z, side: s, status, ph: r() * 6 });
    }
    return out;
  },

  /* ------------------------------------------------------------------
     HOUSES
     ------------------------------------------------------------------ */
  SIDING: [0x4a4c4e, 0x55524e, 0x464a48, 0x524e4e, 0x4c4e4a, 0x52504c, 0x484a50, 0x4e4c4a],
  ROOF: [0x2b2522, 0x302c2a, 0x3a2f2a, 0x26282b],
  DOOR: [0x3a342e, 0x323834, 0x3c3632, 0x32343a, 0x403832],

  houseSpec(lot) {
    const hit = this._houses.get(lot.id);
    if (hit) return hit;
    if (this._houses.size > 4000) this._houses.clear();
    const r = this.lr(lot, 10);
    const arch = Math.floor(r() * 3);
    const W = (arch === 0 ? 9 + r() * 2.2 : arch === 1 ? 10 + r() * 2.5 : 9.5 + r() * 2.4);
    const D = 8.6 + r() * 1.8;
    const setback = 5.5 + r() * Math.max(0, Math.min(2.5, this.LD - 0.5 - D - 5.5));
    const GW = this.GW;
    let garage = 0;
    if (arch >= 1 && !lot.noGarage && r() < 0.55 && lot.w >= W + GW + 3.2) garage = r() < 0.5 ? 1 : -1;
    const bodyW = W + (garage ? GW : 0);
    const free = Math.max(0, (lot.w - bodyW - 2) / 2);
    let lateral = (r() * 2 - 1) * free * 0.6;
    if (lot.forceFlush) lateral = lot.forceFlush * free;
    // composite centre sits at `lateral`; the house body is offset away from the garage
    const bodyLat = lateral - garage * GW / 2;
    const theta = Math.atan2(lot.nx, lot.nz);
    const ex = Math.round(Math.cos(theta)), ez = Math.round(-Math.sin(theta));      // local +x in world
    const ctr = this.lotPoint(lot, setback + D / 2, 0);
    const cx = ctr.x + ex * bodyLat, cz = ctr.z + ez * bodyLat;
    const doorX = 0.7 + r() * Math.max(0.2, W / 2 - 2.5);
    const porch = Math.floor(r() * 3);                       // 0 step only, 1 covered, 2 wide
    const sid = Math.floor(r() * this.SIDING.length), roof = Math.floor(r() * this.ROOF.length);
    const spec = {
      id: lot.id, lot, arch, W, D, setback, garage, theta, ex, ez, cx, cz, doorX, porch,
      siding: this.SIDING[sid], roof: this.ROOF[roof], trim: 0x6a6a62, doorColor: this.DOOR[Math.floor(r() * this.DOOR.length)],
      pitch: 0.34 + r() * 0.28, chimney: r() < 0.5 ? (r() < 0.5 ? -1 : 1) : 0, chimX: 0,
      driveway: garage ? 1 : (r() < 0.35 ? 2 : 0),
      locked: this.lh(lot, 22) >= 0.33,
      fridge: this.lh(lot, 23) < 0.25,
      lit: this.lh(lot, 26) < 0.17, litRoom: ["front", "back", "upper"][Math.floor(this.lh(lot, 27) * 3)],
      zp: 0, rooms: null, windows: null, shade: 0.9 + r() * 0.2
    };
    spec.zp = -D / 2 + 0.2 + 3.2 + (this.lh(lot, 28) * 0.6);
    // rooms
    const kr = this.lh(lot, 29), ur = this.lh(lot, 30), fr = this.lh(lot, 31);
    spec.rooms = {
      front: fr < 0.82 ? "living" : "dining",
      back: spec.fridge ? "kitchen" : (kr < 0.4 ? "dining" : kr < 0.7 ? "storage" : "bedroom"),
      upper: ur < 0.7 ? "bedroom" : "storage"
    };
    spec.windows = this._windows(spec, r);
    // loot is decided by the spatial rule below, and only when asked (it looks at the neighbouring blocks)
    Object.defineProperty(spec, "bottle", { enumerable: true, configurable: true, get: () => {
      const v = spec.fridge && this._bottleAccepted(spec);
      Object.defineProperty(spec, "bottle", { value: v, enumerable: true });
      return v;
    } });
    this._houses.set(lot.id, spec);
    return spec;
  },

  _windows(sp, r) {
    const W = sp.W, D = sp.D, out = [];
    const add = (wall, along, floor, room) => out.push({ wall, along, floor, room });
    // front wall: left and right of the door
    const dX = sp.doorX;
    const frontSlots = [-W / 2 + 2.3, dX + 2.0, -W / 2 + 4.6];
    for (const a of frontSlots) {
      if (Math.abs(a - dX) < 1.5 || a > W / 2 - 1.0 || a < -W / 2 + 1.2) continue;
      if (a < -W / 2 + 1.6 + 0.01 && a === frontSlots[0]) { /* above the stairs: still a window */ }
      add("front", a, 0, "front");
    }
    const upper = [-W / 2 + 2.4, 0.2, W / 2 - 2.4];
    for (const a of upper) if (r() < 0.9) add("front", a, 1, "upper");
    // back wall
    add("back", -W / 4, 0, "back"); if (r() < 0.6) add("back", W / 4, 0, "back");
    add("back", -W / 4, 1, "upper"); add("back", W / 4, 1, "upper");
    // side walls (left = -x, right = +x)
    for (const wall of ["left", "right"]) {
      if (wall === "right" && sp.garage === 1) continue;
      if (wall === "left" && sp.garage === -1) continue;
      add(wall, sp.zp + (D / 2 - sp.zp) / 2, 0, "front");
      add(wall, (-D / 2 + sp.zp) / 2, 0, "back");
      add(wall, 0, 1, "upper");
    }
    return out;
  },

  /* ------------------------------------------------------------------
     ALMOND WATER: sparse, and capped across region boundaries.
     A candidate is a house with a fridge that wins a 17.5% roll. It becomes a real bottle only if fewer than two
     higher-priority real bottles lie within 60 m. Any 60 m circle therefore holds at most two, whatever block
     or chunk the houses belong to, and the answer does not depend on what is loaded.
     ------------------------------------------------------------------ */
  _blockCands(bi, bj) {
    const key = bi + "," + bj, hit = this._cands.get(key);
    if (hit) return hit;
    if (this._cands.size > 900) this._cands.clear();
    const out = [], B = this.block(bi, bj);
    for (const l of B.lots) {
      if (l.kind !== "house") continue;
      if (!(this.lh(l, 23) < 0.25 && this.lh(l, 24) < 0.175)) continue;
      const p = this.lotPoint(l, 11, 0);
      out.push({ id: l.id, x: p.x, z: p.z, pr: this.lh(l, 25), bi, bj });
    }
    this._cands.set(key, out);
    return out;
  },

  _bottleAccepted(spec) {
    const l = spec.lot;
    if (!(this.lh(l, 24) < 0.175)) return false;
    return this._accepted(l.id, l.bi, l.bj);
  },

  _accepted(id, bi, bj) {
    const hit = this._acc.get(id);
    if (hit !== undefined) return hit;
    const mine = this._blockCands(bi, bj).find(c => c.id === id);
    if (!mine) { this._acc.set(id, false); return false; }
    let count = 0;
    for (let dj = -2; dj <= 2 && count < 2; dj++) for (let di = -2; di <= 2 && count < 2; di++) {
      for (const o of this._blockCands(bi + di, bj + dj)) {
        if (o.id === id) continue;
        if (!(o.pr > mine.pr || (o.pr === mine.pr && o.id > id))) continue;
        if (Math.hypot(o.x - mine.x, o.z - mine.z) >= 60) continue;
        if (this._accepted(o.id, o.bi, o.bj)) { count++; if (count >= 2) break; }
      }
    }
    const ok = count < 2;
    this._acc.set(id, ok);
    return ok;
  },

  /* ------------------------------------------------------------------
     CRITTER POPULATION (Hounds and Mangled): deterministic per block
     ------------------------------------------------------------------ */
  distFromSpawn(x, z) { const s = this.spawnInfo(); return Math.hypot(x - s.x, z - s.z); },

  mangledChance(d) {
    const B = this.MANGLED_BANDS;
    if (d < B[0][0]) return 0;
    for (let i = 1; i < B.length; i++) {
      if (d < B[i][0]) {
        const a = B[i - 1], b = B[i];
        const t = (d - a[0]) / (b[0] - a[0]);
        return (i === 1 ? 0.02 : a[1]) + ((b[1]) - (i === 1 ? 0.02 : a[1])) * t;
      }
    }
    return Math.min(0.46, B[B.length - 1][1] + (d - B[B.length - 1][0]) / 4000);
  },

  // house-free ground points for one block, used as spawn points
  blockCritters(bi, bj) {
    const key = bi + "," + bj, hit = this._crit.get(key);
    if (hit) return hit;
    if (this._crit.size > 600) this._crit.clear();
    const B = this.block(bi, bj), out = [], r = this.trng(bi, bj, 301);
    const d = this.distFromSpawn(B.cx, B.cz);
    const houses = B.lots.filter(l => l.kind === "house" && !l.special);
    const pickSpot = (types) => {
      const t = types[Math.floor(r() * types.length)];
      if (t === "street") {
        const roads = [0, 1, 2, 3].filter(s => B.roads[s]);
        if (!roads.length) return null;
        const s = roads[Math.floor(r() * roads.length)], u = 0.15 + r() * 0.7;
        let x, z;
        if (s === 0) { x = B.x0 + (B.x1 - B.x0) * u; z = B.z0 + (r() - 0.5) * 2.2; }
        else if (s === 2) { x = B.x0 + (B.x1 - B.x0) * u; z = B.z1 + (r() - 0.5) * 2.2; }
        else if (s === 3) { x = B.x0 + (r() - 0.5) * 2.2; z = B.z0 + (B.z1 - B.z0) * u; }
        else { x = B.x1 + (r() - 0.5) * 2.2; z = B.z0 + (B.z1 - B.z0) * u; }
        return { type: "street", x, z };
      }
      if (!houses.length) return null;
      const l = houses[Math.floor(r() * houses.length)], sp = this.houseSpec(l);
      if (t === "yard") {                                       // behind the house
        const lat = (r() - 0.5) * (l.w - 4);
        const p = this.lotPoint(l, this.LD - 3.2, lat);
        return { type: "yard", x: p.x, z: p.z, house: sp.id };
      }
      if (t === "garage") {
        if (!sp.garage) return null;
        const loc = this.localToWorld(sp, sp.garage * (sp.W / 2 + this.GW / 2), sp.D / 2 - 2.6);
        return { type: "garage", x: loc.x, z: loc.z, house: sp.id };
      }
      if (t === "interior") {
        if (sp.locked) return null;
        const loc = this.localToWorld(sp, sp.W / 4, (-sp.D / 2 + sp.zp) / 2);
        return { type: "interior", x: loc.x, z: loc.z, house: sp.id };
      }
      return null;
    };
    if (r() < 0.32) {
      const s = pickSpot(["street", "yard", "yard", "garage", "interior"]);
      if (s) out.push(Object.assign({ kind: "hound", id: "h:" + key, temper: r() }, s));
    }
    if (r() < this.mangledChance(d)) {
      const s = pickSpot(["street", "yard", "interior", "street"]);
      if (s) out.push(Object.assign({ kind: "mangled", id: "m:" + key, temper: r() }, s));
    }
    this._crit.set(key, out);
    return out;
  },

  /* ------------------------------------------------------------------
     TRANSFORMS
     ------------------------------------------------------------------ */
  localToWorld(sp, lx, lz) {
    const c = Math.round(Math.cos(sp.theta)), s = Math.round(Math.sin(sp.theta));
    return { x: sp.cx + lx * c + lz * s, z: sp.cz - lx * s + lz * c };
  },
  worldToLocal(sp, x, z) {
    const c = Math.round(Math.cos(sp.theta)), s = Math.round(Math.sin(sp.theta));
    const dx = x - sp.cx, dz = z - sp.cz;
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  },
  // world AABB of a local AABB (theta is a multiple of 90 degrees, so the result is exact)
  boxToWorld(sp, x0, y0, z0, x1, y1, z1) {
    const a = this.localToWorld(sp, x0, z0), b = this.localToWorld(sp, x1, z1);
    return { min: { x: Math.min(a.x, b.x), y: y0, z: Math.min(a.z, b.z) }, max: { x: Math.max(a.x, b.x), y: y1, z: Math.max(a.z, b.z) } };
  },

  // centre of a room in local coordinates (x, y, z) for a light
  roomCenter(sp, room) {
    const W = sp.W, D = sp.D, zp = sp.zp;
    if (room === "front") return { x: 0.6, y: 2.2, z: (zp + D / 2) / 2 };
    if (room === "back") return { x: 0, y: 2.2, z: (-D / 2 + zp) / 2 };
    return { x: 1.0, y: 5.2, z: 0 };
  },

  /* ------------------------------------------------------------------
     INTERIOR PLAN (local coordinates, y absolute). Built into geometry only when a door is opened.
     ------------------------------------------------------------------ */
  interiorPlan(sp) {
    const W = sp.W, D = sp.D, t = 0.2, zp = sp.zp, FH = this.FLOOR_H, RISE = this.STEP_RISE, RUN = this.STEP_RUN;
    const r = this.lr(sp.lot, 40);
    const P = { W, D, solids: [], steps: [], furn: [], fridge: null, sockets: [], rooms: sp.rooms };
    const solid = (x0, y0, z0, x1, y1, z1, color, tag) => P.solids.push({ x0, y0, z0, x1, y1, z1, color, tag: tag || "wall" });
    const PLASTER = 0x5a564c, TRIM = 0x3f3b34, CEIL = 0x4b4a44;
    const ix0 = -W / 2 + t, ix1 = W / 2 - t, iz0 = -D / 2 + t, iz1 = D / 2 - t;
    // stairs
    const sx0 = ix0, sx1 = ix0 + 1.05, z0s = iz1 - 0.9;
    for (let n = 1; n <= 10; n++) P.steps.push({ x0: sx0, x1: sx1, z0: z0s - n * RUN, z1: z0s - (n - 1) * RUN, y1: n * RISE });
    const zEnd = z0s - 10 * RUN;
    P.stair = { x0: sx0, x1: sx1, z0: zEnd, z1: z0s, zEnd };
    // ground partition (front room / back room) with a doorway
    const xp = Math.min(ix1 - 1.4, Math.max(sx1 + 1.4, -W / 2 + 2.9 + r() * (W - 5.4)));
    P.xp = xp;
    solid(-W / 2 + 0.2, 0, zp - 0.075, xp - 0.55, 2.7, zp + 0.075, PLASTER, "part");
    solid(xp + 0.55, 0, zp - 0.075, W / 2 - 0.2, 2.7, zp + 0.075, PLASTER, "part");
    solid(xp - 0.55, 2.1, zp - 0.075, xp + 0.55, 2.7, zp + 0.075, PLASTER, "part");
    // upper floor slab with the stairwell hole
    const hx1 = sx1 + 0.1, hz0 = zEnd, hz1 = z0s + 0.3;
    P.hole = { x0: ix0, x1: hx1, z0: hz0, z1: hz1 };
    solid(-W / 2, 2.7, -D / 2, W / 2, FH, hz0, CEIL, "slab");                          // behind the hole
    solid(hx1, 2.7, hz0, W / 2, FH, D / 2, CEIL, "slab");                                // beside the hole
    solid(-W / 2, 2.7, hz1, hx1, FH, D / 2, CEIL, "slab");                               // in front of the hole
    // upper partition (landing / room) with a doorway, and a railing along the hole
    const pxw = hx1 + 0.05;
    P.pxw = pxw;
    const lz0 = iz0, lz1 = hz0, zc = (lz0 + lz1) / 2;
    solid(pxw - 0.075, FH, lz0, pxw + 0.075, FH + 2.6, zc - 0.55, PLASTER, "part");
    solid(pxw - 0.075, FH, zc + 0.55, pxw + 0.075, FH + 2.6, lz1, PLASTER, "part");
    solid(pxw - 0.075, FH + 2.1, zc - 0.55, pxw + 0.075, FH + 2.6, zc + 0.55, PLASTER, "part");
    solid(hx1 - 0.04, FH, hz0, hx1 + 0.04, FH + 0.95, hz1, TRIM, "rail");
    P.landing = { x0: ix0, x1: pxw, z0: lz0, z1: lz1 };
    // keep-out rectangles for furniture
    const keep = { 0: [], 1: [] };
    keep[0].push([sx0 - 0.1, zEnd - 0.4, sx1 + 0.6, iz1 + 0.1]);                         // stairs and their foot
    keep[0].push([sp.doorX - 0.9, iz1 - 1.4, sp.doorX + 0.9, iz1 + 0.1]);                // front door
    keep[0].push([sx1 + 0.4, iz1 - 1.5, sp.doorX + 0.9, iz1 + 0.1]);                      // a clear lane along the front wall, door to stairs
    keep[0].push([sx1 + 0.4, zp - 0.2, sp.doorX + 0.9, iz1 - 1.0]);                      // and a lane from the door toward the partition doorway
    keep[0].push([xp - 0.9, zp - 1.2, xp + 0.9, zp + 1.5]);                              // approach to the doorway from the front room
    keep[0].push([xp - 0.9, zp - 1.0, xp + 0.9, zp + 1.0]);                              // partition doorway
    keep[1].push([ix0, lz0, pxw + 0.8, lz1 + 0.1]);                                      // landing
    keep[1].push([pxw - 0.2, zc - 1.0, pxw + 1.2, zc + 1.0]);                            // upper doorway
    const rooms = [
      { name: "front", type: sp.rooms.front, floor: 0, x0: ix0, x1: ix1, z0: zp + 0.1, z1: iz1 },
      { name: "back", type: sp.rooms.back, floor: 0, x0: ix0, x1: ix1, z0: iz0, z1: zp - 0.1 },
      { name: "upper", type: sp.rooms.upper, floor: 1, x0: pxw + 0.1, x1: ix1, z0: iz0, z1: iz1 }
    ];
    const overlap = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const placed = { 0: [], 1: [] };
    const tryPlace = (rm, item, wall) => {
      // wall: 0 against -z (back) wall, 1 against +z, 2 against -x, 3 against +x, 4 free in the room
      for (let a = 0; a < 10; a++) {
        let x, z, sx = item.sx, sz = item.sz, face = 0;
        const gap = 0.04;
        const w = wall === 4 ? Math.floor(r() * 4) : wall;
        if (w === 0) { z = rm.z0 + sz / 2 + gap; x = rm.x0 + sx / 2 + 0.1 + r() * Math.max(0, rm.x1 - rm.x0 - sx - 0.2); face = 0; }
        else if (w === 1) { z = rm.z1 - sz / 2 - gap; x = rm.x0 + sx / 2 + 0.1 + r() * Math.max(0, rm.x1 - rm.x0 - sx - 0.2); face = 1; }
        else if (w === 2) { x = rm.x0 + sz / 2 + gap; z = rm.z0 + sx / 2 + 0.1 + r() * Math.max(0, rm.z1 - rm.z0 - sx - 0.2); sx = item.sz; sz = item.sx; face = 2; }
        else { x = rm.x1 - sz / 2 - gap; z = rm.z0 + sx / 2 + 0.1 + r() * Math.max(0, rm.z1 - rm.z0 - sx - 0.2); sx = item.sz; sz = item.sx; face = 3; }
        if (wall === 4 && item.free) { x = rm.x0 + 0.6 + sx / 2 + r() * Math.max(0, rm.x1 - rm.x0 - sx - 1.2); z = rm.z0 + 0.6 + sz / 2 + r() * Math.max(0, rm.z1 - rm.z0 - sz - 1.2); face = Math.floor(r() * 4); }
        if (x - sx / 2 < rm.x0 - 0.01 || x + sx / 2 > rm.x1 + 0.01 || z - sz / 2 < rm.z0 - 0.01 || z + sz / 2 > rm.z1 + 0.01) continue;
        const rect = [x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2];
        let bad = false;
        for (const k of keep[rm.floor]) if (overlap(rect, k)) { bad = true; break; }
        if (!bad) for (const q of placed[rm.floor]) if (overlap(rect, q)) { bad = true; break; }
        if (bad) continue;
        placed[rm.floor].push(rect);
        const y0 = rm.floor === 0 ? 0 : FH;
        return { x, z, y0, sx, sz, face };
      }
      return null;
    };
    const furn = (rm, kind, sx, sy, sz, color, wall, opts) => {
      const o = opts || {};
      const pl = tryPlace(rm, { sx, sz, free: !!o.free }, wall);
      if (!pl) return null;
      const f = { kind, x: pl.x, z: pl.z, y: pl.y0 + sy / 2, sx: pl.sx, sy, sz: pl.sz, color, collide: o.collide !== false && sy > 0.45, face: pl.face, tag: o.tag || "" };
      P.furn.push(f);
      return f;
    };
    const WOOD = 0x3b2d22, WOOD2 = 0x4a3a2c, FAB = [0x3d3f46, 0x4a3d3a, 0x37443f, 0x4b4638];
    for (const rm of rooms) {
      const fab = FAB[Math.floor(r() * FAB.length)];
      if (rm.type === "living") {
        furn(rm, "sofa", 2.1, 0.8, 0.9, fab, 1 + Math.floor(r() * 2) * 0 + (r() < 0.5 ? 0 : 3));
        furn(rm, "table", 1.0, 0.42, 0.6, WOOD, 4, { free: true, collide: true });
        const tv = furn(rm, "cabinet", 1.3, 0.5, 0.45, WOOD2, r() < 0.5 ? 2 : 3);
        if (tv) P.furn.push({ kind: "tv", x: tv.x, z: tv.z, y: tv.y + 0.25 + 0.34, sx: tv.face >= 2 ? 0.1 : 1.0, sy: 0.62, sz: tv.face >= 2 ? 1.0 : 0.1, color: 0x08090a, collide: false, face: tv.face, tag: "tv" });
        if (r() < 0.6) furn(rm, "chair", 0.8, 0.9, 0.8, fab, 4, { free: true });
        if (r() < 0.5) furn(rm, "lamp", 0.3, 1.5, 0.3, 0x2a2a2a, r() < 0.5 ? 0 : 1, { collide: false });
      } else if (rm.type === "kitchen") {
        const fr = furn(rm, "fridge", 0.8, 1.85, 0.75, 0x5b5f60, r() < 0.5 ? 0 : 2, { tag: "fridge" });
        if (fr) P.fridge = { x: fr.x, z: fr.z, y: fr.y, sx: fr.sx, sy: fr.sy, sz: fr.sz, face: fr.face };
        if (fr) {                                                   // keep the space in front of the fridge clear: it has to be reachable
          const d = [[0, 1], [0, -1], [1, 0], [-1, 0]][fr.face];
          const fx0 = fr.x - fr.sx / 2 - 0.45, fx1 = fr.x + fr.sx / 2 + 0.45, fz0 = fr.z - fr.sz / 2 - 0.45, fz1 = fr.z + fr.sz / 2 + 0.45;
          keep[0].push([d[0] > 0 ? fx0 : d[0] < 0 ? fx0 - 1.5 : fx0, d[1] > 0 ? fz0 : d[1] < 0 ? fz0 - 1.5 : fz0, d[0] > 0 ? fx1 + 1.5 : fx1, d[1] > 0 ? fz1 + 1.5 : fz1]);
        }
        furn(rm, "counter", 2.4, 0.92, 0.62, 0x4a4640, 0);
        furn(rm, "counter", 1.6, 0.92, 0.62, 0x4a4640, r() < 0.5 ? 2 : 3);
        furn(rm, "table", 1.3, 0.76, 0.9, WOOD2, 4, { free: true });
        if (r() < 0.7) furn(rm, "chair", 0.45, 0.85, 0.45, WOOD, 4, { free: true });
      } else if (rm.type === "dining") {
        furn(rm, "table", 1.7, 0.76, 0.95, WOOD2, 4, { free: true });
        for (let c = 0; c < 2 + Math.floor(r() * 3); c++) furn(rm, "chair", 0.45, 0.85, 0.45, WOOD, 4, { free: true });
        furn(rm, "cabinet", 1.2, 1.5, 0.45, WOOD, 1 + Math.floor(r() * 3));
      } else if (rm.type === "bedroom") {
        furn(rm, "bed", 1.5, 0.5, 2.0, fab, r() < 0.5 ? 0 : 2);
        furn(rm, "stand", 0.45, 0.5, 0.4, WOOD, r() < 0.5 ? 0 : 1);
        furn(rm, "wardrobe", 1.1, 2.0, 0.55, WOOD, 1 + Math.floor(r() * 3));
        if (r() < 0.5) furn(rm, "dresser", 1.0, 0.85, 0.5, WOOD2, 3);
      } else {
        const n = 3 + Math.floor(r() * 4);
        for (let c = 0; c < n; c++) furn(rm, "crate", 0.5 + r() * 0.5, 0.4 + r() * 0.5, 0.5 + r() * 0.4, [0x4a4034, 0x3b3a34, 0x504536][c % 3], 4, { free: true });
        furn(rm, "shelf", 1.2, 1.8, 0.4, 0x3a3a38, 1 + Math.floor(r() * 3));
      }
    }
    // Self-check: every part of the house the player is meant to reach must be reachable. If furniture walls
    // something off, the last free-standing piece on that floor goes, and the check runs again.
    for (let guard = 0; guard < 12; guard++) {
      const bad = this._unreachable(sp, P);
      if (bad < 0) break;
      let idx = -1;
      for (let i = P.furn.length - 1; i >= 0; i--) {
        const f = P.furn[i], fl = f.y - f.sy / 2 >= FH - 0.1 ? 1 : 0;
        if (fl === bad && f.collide && f.kind !== "fridge" && f.kind !== "counter" && f.kind !== "bed" && f.kind !== "wardrobe") { idx = i; break; }
      }
      if (idx < 0) break;
      P.furn.splice(idx, 1);
    }
    return P;
  },

  // A grid reachability check on a plan (player radius inflated). Returns the floor (0 or 1) that has an
  // unreachable goal, or -1 when everything can be reached.
  _unreachable(sp, P) {
    const R = 0.34, cell = 0.1, FH = this.FLOOR_H, x0 = -sp.W / 2, z0 = -sp.D / 2, NX = Math.ceil(sp.W / cell), NZ = Math.ceil(sp.D / cell);
    const grid = (floor) => {
      const rects = [], ylo = floor ? FH : 0, yhi = floor ? FH + 1.7 : 1.7, blocked = new Uint8Array(NX * NZ);
      for (const s of P.solids) { if (s.y1 <= ylo + 0.34 || s.y0 >= yhi || s.tag === "slab") continue; rects.push([s.x0, s.z0, s.x1, s.z1]); }
      if (!floor) for (const st of P.steps) if (st.y1 > 0.34) rects.push([st.x0, st.z0, st.x1, st.z1]);
      for (const f of P.furn) if (f.collide && (floor ? f.y - f.sy / 2 >= FH - 0.1 : f.y - f.sy / 2 < FH - 0.1)) rects.push([f.x - f.sx / 2, f.z - f.sz / 2, f.x + f.sx / 2, f.z + f.sz / 2]);
      rects.push([x0 - 1, z0 - 1, x0 + 0.2, z0 + sp.D + 1], [x0 + sp.W - 0.2, z0 - 1, x0 + sp.W + 1, z0 + sp.D + 1], [x0 - 1, z0 - 1, x0 + sp.W + 1, z0 + 0.2], [x0 - 1, z0 + sp.D - 0.2, x0 + sp.W + 1, z0 + sp.D + 1]);
      if (floor) rects.push([P.hole.x0, P.hole.z0, P.hole.x1, P.hole.z1]);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
        for (const r of rects) if (x + R > r[0] && x - R < r[2] && z + R > r[1] && z - R < r[3]) { blocked[j * NX + i] = 1; break; }
      }
      return blocked;
    };
    const reach = (blocked, sx, sz, tx, tz) => {
      const si = Math.floor((sx - x0) / cell), sj = Math.floor((sz - z0) / cell), ti = Math.floor((tx - x0) / cell), tj = Math.floor((tz - z0) / cell);
      if (blocked[sj * NX + si]) return false;
      const seen = new Uint8Array(NX * NZ), q = [si, sj]; seen[sj * NX + si] = 1;
      while (q.length) {
        const j = q.pop(), i = q.pop();
        if (Math.abs(i - ti) <= 2 && Math.abs(j - tj) <= 2) return true;
        for (let k = 0; k < 4; k++) {
          const ni = i + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = j + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
          const idx = nj * NX + ni;
          if (seen[idx] || blocked[idx]) continue;
          seen[idx] = 1; q.push(ni, nj);
        }
      }
      return false;
    };
    const g0 = grid(0), g1 = grid(1), clampv = (v, h) => Math.max(-h + 0.6, Math.min(h - 0.6, v));
    const door = [sp.doorX, sp.D / 2 - 0.7];
    if (!reach(g0, door[0], door[1], (P.stair.x0 + P.stair.x1) / 2, P.stair.z1 + 0.45)) return 0;
    if (!reach(g0, door[0], door[1], P.xp, sp.zp - 1.0)) return 0;
    if (P.fridge) {
      const fr = [[0, 1], [0, -1], [1, 0], [-1, 0]][P.fridge.face];
      if (!reach(g0, door[0], door[1], clampv(P.fridge.x + fr[0], sp.W / 2), clampv(P.fridge.z + fr[1], sp.D / 2))) return 0;
    }
    const lz = (P.landing.z0 + P.landing.z1) / 2;
    if (!reach(g1, P.landing.x0 + 0.6, lz, P.pxw + 0.9, lz)) return 1;
    return -1;
  },

  /* ------------------------------------------------------------------
     TESTING HELPERS
     ------------------------------------------------------------------ */
  // every house spec in a square of blocks (for the Node tests)
  eachHouse(bi0, bj0, bi1, bj1, fn) {
    for (let bj = bj0; bj <= bj1; bj++) for (let bi = bi0; bi <= bi1; bi++) for (const l of this.block(bi, bj).lots) if (l.kind === "house") fn(this.houseSpec(l), l);
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = Level9Gen;
