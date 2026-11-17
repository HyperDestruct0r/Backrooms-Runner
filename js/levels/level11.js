"use strict";

/* Level 11 — City of Concrete. Runtime: streaming, meshes, interiors, lifts, the anomaly, lifecycle. No entities live here.
   Pure generation is in level11-gen.js (city, buildings) and level11-floors.js (floor plans).

   STREAMING (two independent streams)
     City blocks (the Level 10 way): every block within BUILD metres of the player is built one generator step at a time
     inside a per-frame budget and disposed beyond DROP. A block holds only exteriors: ground, roads, street furniture, and
     for each building a shell (opaque facade, windows, entrance, roof). The shell is a closed box seen from outside, so an
     unbuilt interior is never visible; from inside it is back-face culled, so the interior's window openings look out onto
     the city. No interior, light or loot is ever built for a building the player is not in.
     Floors: after E at a door, the lobby (floor 1) and the floor above it (and the basement below it, if any) are built.
     From then on exactly the player's floor and its neighbours exist (floor N-1, N, N+1; only those that exist). Moving by
     stairs or lift shifts the window: missing floors are built a slice at a time, the rest are disposed. A floor is a pure
     function of (seed, building, floor); what the player changed (taken loot) is kept in `persist`.

   COLLISION. Axis-aligned boxes only. Level11.baseY is the lowest walkable level (street, or the lowest loaded floor).
   LIGHT. A hemisphere, an ambient and a faint sun outside; inside, emissive ceiling panels everywhere and a small pool of
   real point lights (quality-dependent) on the nearest fixtures of the player's own floor. */
const Level11 = {
  active: false, seed: 0, group: null, colliders: [], blocks: new Map(), doors: new Map(),
  spawn: new THREE.Vector3(), spawnYaw: 0, baseY: 0, infoText: "", time: 0,
  mode: "street",                       // street | building | garage
  cur: null,                            // { b, floor } while inside a building
  floors: new Map(),                    // floor number (or "G") -> record, for the building entered
  cab: null,                            // the lift: { b, bld, floor, door, group, colliders... }
  persist: null,
  BUILD: 235, DROP: 330, COLLIDE: 70, BUDGET: 3.5,
  stepTol: 0.34,                        // player.js reads it: stair treads (0.2 m) and kerbs are stepped onto
  fixtures: [], exits: [], pool: [], poolFx: [], _cur: [], _want: [], ambient: [],
  _queue: [], _fq: [], _cur_rec: null, _cur_floor: null, _lastKey: "", _lightT: 0, _promptT: 0, _trackT: 0, _dirty: false,
  _in: 0, _leaving: false, _ended: false, _pendingEnter: null,
  OUT: { fog: 0xaeb4b8, sky: 0xaeb4b8, hemiSky: 0xdfe6ea, hemiGround: 0x77746c, hemi: 1.0, amb: 0xb8bcc0, ambI: 0.55, sun: 0.5, exposure: 1.18 },
  IN: { fog: 0x1a1a1c, sky: 0x1a1a1c, hemiSky: 0x8a909c, hemiGround: 0x3a3a3c, hemi: 0.34, amb: 0x8890a0, ambI: 0.42, sun: 0, exposure: 1.2 },
  GAR: { fog: 0x0e0f0e, sky: 0x0e0f0e, hemiSky: 0x6a6e68, hemiGround: 0x222422, hemi: 0.28, amb: 0x707870, ambI: 0.34, sun: 0, exposure: 1.2 },

  /* ------------------------------------------------------------------ colours and materials */
  _cc: new Map(),
  col(hex, k) {
    let c = this._cc.get(hex);
    if (!c) { const t = new THREE.Color(hex); c = [t.r, t.g, t.b]; this._cc.set(hex, c); }
    return k ? [c[0] * k, c[1] * k, c[2] * k] : c;
  },
  mats() {
    if (this.M) return this.M;
    this.M = {
      lit: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }),
      emi: new THREE.MeshBasicMaterial({ vertexColors: true }),
      door: new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.6, metalness: 0.3 }),
      box: new THREE.BoxGeometry(1, 1, 1)
    };
    return this.M;
  },
  lerpHex(a, b, t) {
    const ch = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  },
  q() { return (typeof Quality !== "undefined" && Quality.profile) ? Quality.profile : { poolSize: 12, cameraFar: 160, meshBudgetMs: 5 }; },

  /* ------------------------------------------------------------------ small geometry helpers */
  lbox(b, x0, y0, z0, x1, y1, z1, c) { if (x1 - x0 > 1e-5 && y1 - y0 > 1e-5 && z1 - z0 > 1e-5) b.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, c, 0); },
  flat(b, x0, z0, x1, z1, y, c, down) {
    const V = (x, z) => b._v(x, y, z), ref = b._v((x0 + x1) / 2, y + (down ? 5 : -5), (z0 + z1) / 2);
    b.quad(V(x0, z0), V(x1, z0), V(x1, z1), V(x0, z1), c, ref);
  },
  rectsMinus(r, holes) {
    let pieces = [r];
    for (const h of holes) {
      const next = [];
      for (const p of pieces) {
        if (h.x0 >= p.x1 || h.x1 <= p.x0 || h.z0 >= p.z1 || h.z1 <= p.z0) { next.push(p); continue; }
        if (h.x0 > p.x0) next.push({ x0: p.x0, z0: p.z0, x1: h.x0, z1: p.z1 });
        if (h.x1 < p.x1) next.push({ x0: h.x1, z0: p.z0, x1: p.x1, z1: p.z1 });
        const lx = Math.max(p.x0, h.x0), rx = Math.min(p.x1, h.x1);
        if (h.z0 > p.z0) next.push({ x0: lx, z0: p.z0, x1: rx, z1: h.z0 });
        if (h.z1 < p.z1) next.push({ x0: lx, z0: h.z1, x1: rx, z1: p.z1 });
      }
      pieces = next;
    }
    return pieces.filter(p => p.x1 - p.x0 > 1e-4 && p.z1 - p.z0 > 1e-4);
  },
  collider(rec, x0, y0, z0, x1, y1, z1, tag) {
    const c = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
    if (tag) c.tag = tag;
    rec.colliders.push(c);
    return c;
  },
  // a local-frame rectangle (x0,z0)-(x1,z1) at heights y0..y1 of a building-like frame as a world collider
  lcol(rec, bld, x0, y0, z0, x1, y1, z1, tag) {
    const w = Level11Gen.worldRect(bld, x0, z0, x1, z1);
    return this.collider(rec, w.x0, y0, w.z0, w.x1, y1, w.z1, tag);
  },
  _mesh(group, geos, b, mat) {
    if (!b.count) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    group.add(m);
    geos.push(g);
    b.clear();
  },
  flush(rec) { const M = this.mats(); this._mesh(rec.group, rec.geos, rec.lit, M.lit); this._mesh(rec.group, rec.geos, rec.emi, M.emi); },
  _blockDist(B, px, pz) { return Math.hypot(Math.max(0, B.x0 - px, px - B.x1), Math.max(0, B.z0 - pz, pz - B.z1)); },
  newRec(key, extra) {
    return Object.assign({ key, group: new THREE.Group(), geos: [], colliders: [], fixtures: [], exits: [], pickups: [], doors: [], lit: new L9Builder(), emi: new L9Builder(), done: false, dist: 0 }, extra || {});
  },

  /* ------------------------------------------------------------------ city blocks */
  *_buildBlock(rec) {
    const G = Level11Gen, blk = rec.blk = G.block(rec.bi, rec.bj), bl = this.buildings(rec.bi, rec.bj);
    this._ground(rec, blk, bl);
    yield;
    if (blk.open) { this._open(rec, blk); yield; }
    this._street(rec, blk);
    yield;
    for (const b of bl) { this._shell(rec, b); this.flush(rec); yield; }
    if (blk.type === "quad" || blk.type === "pair") this._alley(rec, blk);
    this.flush(rec);
    rec.done = true;
  },
  buildings(bi, bj) { return Level11Gen.buildingsInBlock(bi, bj); },

  _ground(rec, blk, bl) {
    const P = Level11Gen.PITCH, x0 = blk.bi * P, z0 = blk.bj * P, cell = { x0, z0, x1: x0 + P, z1: z0 + P }, b = rec.lit, R = blk.rect;
    const holes = bl.map(q => q.footRect);
    b.pop();
    for (const r of this.rectsMinus(cell, holes)) {                                  // the ground itself, with the buildings' footprints cut out
      b.box((r.x0 + r.x1) / 2, -0.25, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.5, r.z1 - r.z0, this.col(0x2d2e30), 0);
      this.collider(rec, r.x0, -0.5, r.z0, r.x1, 0, r.z1, "ground");
    }
    const sw = 3.4, walk = this.col(0x6b6a66), pave = this.col(0x57564f);
    const bandR = [{ x0: R.x0 - sw, z0: R.z0 - sw, x1: R.x1 + sw, z1: R.z0 }, { x0: R.x0 - sw, z0: R.z1, x1: R.x1 + sw, z1: R.z1 + sw },
                   { x0: R.x0 - sw, z0: R.z0, x1: R.x0, z1: R.z1 }, { x0: R.x1, z0: R.z0, x1: R.x1 + sw, z1: R.z1 }];
    for (const band of bandR) for (const r of this.rectsMinus(band, holes)) this.flat(b, r.x0, r.z0, r.x1, r.z1, 0.02, walk);
    for (const r of this.rectsMinus(R, holes.concat(blk.open ? [blk.open] : []))) this.flat(b, r.x0, r.z0, r.x1, r.z1, 0.015, pave);   // lots, alleys and forecourts
  },
  _street(rec, blk) {
    const b = rec.lit, G = Level11Gen, P = G.PITCH, x0 = blk.bi * P, z0 = blk.bj * P, line = this.col(0xcfc8a0), white = this.col(0xd6d6d2), R = blk.rect;
    for (let t = 4; t < P - 8; t += 9) {                                                // dashed centre lines on the north and west roads
      this.flat(b, x0 + t, z0 - 0.12, x0 + t + 4, z0 + 0.12, 0.03, line);
      this.flat(b, x0 - 0.12, z0 + t, x0 + 0.12, z0 + t + 4, 0.03, line);
    }
    for (let k = 0; k < 6; k++) {                                                       // crosswalks at the north-west crossing
      const o = -6 + k * 2.2;
      this.flat(b, x0 + o, z0 + 6.2, x0 + o + 1.1, z0 + 9.6, 0.03, white); this.flat(b, x0 + 6.2, z0 + o, x0 + 9.6, z0 + o + 1.1, 0.03, white);
    }
    // lamp posts and the odd bollard along the north and west pavements
    for (let t = 12; t < G.BLOCK - 4; t += 26) {
      for (const [lx, lz] of [[R.x0 + t, R.z0 - 3.1], [R.x0 - 3.1, R.z0 + t]]) {
        b.box(lx, 3.2, lz, 0.18, 6.4, 0.18, this.col(0x3a3c3e), 0); b.box(lx + 0.5, 6.35, lz, 1.1, 0.12, 0.12, this.col(0x3a3c3e), 0);
        this.collider(rec, lx - 0.12, 0, lz - 0.12, lx + 0.12, 6.4, lz + 0.12, "post");
      }
    }
  },
  _open(rec, blk) {
    const G = Level11Gen, b = rec.lit, o = blk.open, hh = (n) => G.hash(blk.bi, blk.bj, 200 + n);
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    if (blk.openKind === "park") {
      this.flat(b, o.x0, o.z0, o.x1, o.z1, 0.03, this.col(0x3d4a32));
      this.flat(b, cx - 1.2, o.z0, cx + 1.2, o.z1, 0.04, this.col(0x7a7468)); this.flat(b, o.x0, cz - 1.2, o.x1, cz + 1.2, 0.04, this.col(0x7a7468));
      let n = 0;
      for (let i = 0; i < 16; i++) {
        const x = o.x0 + 3 + hh(i) * (o.x1 - o.x0 - 6), z = o.z0 + 3 + hh(i + 40) * (o.z1 - o.z0 - 6);
        if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
        const h = 4 + hh(i + 80) * 3;
        b.box(x, h * 0.2, z, 0.35, h * 0.4, 0.35, this.col(0x4a3a2c), 0); b.cone(x, h * 0.3, z, 2.2 + hh(i + 120), h * 0.8, 6, this.col(0x2f4a2c, 0.8 + 0.4 * hh(i + 160)));
        this.collider(rec, x - 0.25, 0, z - 0.25, x + 0.25, h, z + 0.25, "tree"); n++;
      }
      for (const [bx, bz] of [[cx - 4, cz - 2.6], [cx + 4, cz + 2.6]]) { b.box(bx, 0.3, bz, 1.8, 0.6, 0.5, this.col(0x6a5a46), 0); this.collider(rec, bx - 0.9, 0, bz - 0.25, bx + 0.9, 0.6, bz + 0.25, "bench"); }
    } else {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
        const x0 = o.x0 + (o.x1 - o.x0) * i / 8, z0 = o.z0 + (o.z1 - o.z0) * j / 8;
        this.flat(b, x0, z0, o.x0 + (o.x1 - o.x0) * (i + 1) / 8, o.z0 + (o.z1 - o.z0) * (j + 1) / 8, 0.03, this.col((i + j) % 2 ? 0x66655e : 0x77766e));
      }
      b.box(cx, 0.45, cz, 6, 0.9, 6, this.col(0x5a5a56), 0); this.flat(b, cx - 2.6, cz - 2.6, cx + 2.6, cz + 2.6, 0.92, this.col(0x4a5a62));
      this.collider(rec, cx - 3, 0, cz - 3, cx + 3, 0.9, cz + 3, "fountain");
      for (const [px, pz] of [[o.x0 + 4, o.z0 + 4], [o.x1 - 4, o.z0 + 4], [o.x0 + 4, o.z1 - 4], [o.x1 - 4, o.z1 - 4]]) { b.box(px, 0.4, pz, 2.4, 0.8, 2.4, this.col(0x5a584f), 0); b.cone(px, 0.8, pz, 1.1, 1.8, 6, this.col(0x34502c)); this.collider(rec, px - 1.2, 0, pz - 1.2, px + 1.2, 0.8, pz + 1.2, "planter"); }
    }
  },
  _alley(rec, blk) {
    const G = Level11Gen, b = rec.lit, hh = (n) => G.hash(blk.bi, blk.bj, 300 + n), R = blk.rect;
    for (let i = 0; i < 2; i++) {
      if (hh(i) < 0.4) continue;
      const x = R.x0 + 8 + hh(i + 5) * (G.BLOCK - 16), z = R.z0 + G.BLOCK / 2 + (hh(i + 9) - 0.5) * 3;
      if (blk.lots.some(l => x > l.x0 - 1.5 && x < l.x1 + 1.5 && z > l.z0 - 1.5 && z < l.z1 + 1.5)) continue;
      b.box(x, 0.8, z, 2.2, 1.6, 1.2, this.col(0x2e4a3a), 0); this.collider(rec, x - 1.1, 0, z - 0.6, x + 1.1, 1.6, z + 0.6, "dumpster");
    }
  },

  /* ------------------------------------------------------------------ building shells */
  _shell(rec, b) {
    const G = Level11Gen, FH = G.FLOOR_H, H = b.floors, Ht = H * FH, L = b.look, pal = L.pal, w = b.w, d = b.d, hw = w / 2, hd = d / 2, bb = rec.lit;
    bb.push(b.theta, b.x, b.z);
    const capY = b.roof ? Ht - 0.06 : Ht;
    const secs = b.mix ? b.mix : [{ from: 1, to: H, cat: b.cat }];
    secs.forEach((s, i) => {
      const sp = b.mix ? L.sections[i] : pal, y0 = (s.from - 1) * FH, y1 = i === secs.length - 1 ? capY : s.to * FH;
      bb.box(0, (y0 + y1) / 2, 0, w, y1 - y0, d, this.col(sp.wall, L.shade), 0);
      const style = b.mix ? L.sectionStyles[i] : L.style;
      this._facade(bb, b, sp, style, s.from, s.to, hw, hd);
      if (b.mix && i > 0) this._band(bb, hw, hd, y0, sp);
    });
    if (b.variations.unfinishedFrom) this._unfinished(bb, b, hw, hd);
    this._base(rec, bb, b, hw, hd);
    this._crown(rec, bb, b, hw, hd, Ht);
    bb.pop();
    this._shellColliders(rec, b);
  },
  _band(bb, hw, hd, y, sp) { this.lbox(bb, -hw - 0.12, y - 0.1, -hd - 0.12, hw + 0.12, y + 0.35, hd + 0.12, this.col(sp.trim)); },
  // Window arrangement by style. One ribbon of glass per floor per face and full-height piers: ~1.4k triangles a tower.
  _facade(bb, b, sp, style, f0, f1, hw, hd) {
    const G = Level11Gen, FH = G.FLOOR_H, L = b.look, e = 0.04, glass = sp.glass, trim = this.col(sp.trim, L.shade);
    const st = { cells: [0.95, 0.62, 1.7], curtain: [0.45, 0.86, 3.0], grid: [0.9, 0.64, 2.4], ribbon: [0.7, 0.7, 4.2], slit: [1.1, 0.42, 2.0], storefront: [0.8, 0.7, 3.4], mixed: [0.85, 0.66, 2.4] }[style] || [0.9, 0.64, 2.4];
    const sill = st[0], rh = st[1] * FH * 0.62, pier = st[2];
    const lo = f0 === 1 ? 2 : f0;                                                    // floor 1 is the solid plinth below
    const faces = [[0, hd, 1, 0, 2 * hw], [0, -hd, -1, 0, 2 * hw], [hw, 0, 0, 1, 2 * hd], [-hw, 0, 0, -1, 2 * hd]];  // [cx, cz, nz, nx, length] per face
    for (const [cx, cz, nz, nx, len] of faces) {
      const alongX = nz !== 0, half = len / 2 - 1.0;
      for (let f = lo; f <= f1; f++) {
        const y = (f - 1) * FH + sill, sh = 0.82 + 0.3 * G.hash(b.bi * 31 + f, b.bj, b.k, 400 + (nz + 2) * 3 + (nx + 2));
        const c = this.col(glass, sh);
        if (alongX) this.lbox(bb, cx - half, y, cz + (nz > 0 ? 0 : -e), cx + half, y + rh, cz + (nz > 0 ? e : 0), c);
        else this.lbox(bb, cx + (nx > 0 ? 0 : -e), y, cz - half, cx + (nx > 0 ? e : 0), y + rh, cz + half, c);
      }
      const n = Math.max(2, Math.round(len / pier)), y0 = (lo - 1) * FH, h = (f1 - lo + 1) * FH;
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len * i) / n, wd = 0.16;
        if (alongX) this.lbox(bb, t - wd, y0, cz + (nz > 0 ? 0 : -0.12), t + wd, y0 + h, cz + (nz > 0 ? 0.12 : 0), trim);
        else this.lbox(bb, cx + (nx > 0 ? 0 : -0.12), y0, t - wd, cx + (nx > 0 ? 0.12 : 0), y0 + h, t + wd, trim);
      }
      if (L.balcony && style === "cells") {                                          // a few balconies on the lower middle floors
        for (let f = Math.max(lo, 3); f <= Math.min(f1, 24); f += 3) {
          const bc = (G.hash(b.bi, f, b.bj * 7 + (nz + 2), 410) - 0.5) * (len - 8), y = (f - 1) * FH;
          if (alongX) this.lbox(bb, bc - 1.2, y, cz + (nz > 0 ? 0 : -1.0), bc + 1.2, y + 0.12, cz + (nz > 0 ? 1.0 : 0), trim);
          else this.lbox(bb, cx + (nx > 0 ? 0 : -1.0), y, bc - 1.2, cx + (nx > 0 ? 1.0 : 0), y + 0.12, bc + 1.2, trim);
        }
      }
    }
    // storefront glass and dark plinth on floor 1 (opaque: the lobby behind it is not built from outside)
    if (f0 === 1) {
      const dark = this.col(sp.trim, 0.62), gl = this.col(glass, 0.8), fr = style === "storefront" || b.cat === "COM";
      for (const [cx, cz, nz, nx, len] of faces) {
        const half = len / 2 - 0.8;
        if (nz !== 0) { this.lbox(bb, -half, 0, cz + (nz > 0 ? 0 : -e * 2), half, 4.2, cz + (nz > 0 ? e * 2 : 0), dark); if (fr) this.lbox(bb, -half + 1, 0.2, cz + (nz > 0 ? 0 : -e * 3), half - 1, 3.4, cz + (nz > 0 ? e * 3 : 0), gl); }
        else { this.lbox(bb, cx + (nx > 0 ? 0 : -e * 2), 0, -half, cx + (nx > 0 ? e * 2 : 0), 4.2, half, dark); if (fr) this.lbox(bb, cx + (nx > 0 ? 0 : -e * 3), 0.2, -half + 1, cx + (nx > 0 ? e * 3 : 0), 3.4, half - 1, gl); }
      }
    }
  },
  _unfinished(bb, b, hw, hd) {                                                      // the unfinished top: bare concrete with dark openings
    const G = Level11Gen, FH = G.FLOOR_H, y0 = (b.variations.unfinishedFrom - 1) * FH, y1 = b.floors * FH, c = this.col(0x7d7d79), dark = this.col(0x161616);
    this.lbox(bb, -hw - 0.06, y0, -hd - 0.06, hw + 0.06, y1, hd + 0.06, c);
    for (let f = b.variations.unfinishedFrom; f <= b.floors; f++) for (const s of [-1, 1]) {
      this.lbox(bb, -hw + 3, (f - 1) * FH + 0.4, s * (hd + 0.08), hw - 3, f * FH - 0.7, s * (hd + 0.1), dark);
      this.lbox(bb, s * (hw + 0.08), (f - 1) * FH + 0.4, -hd + 3, s * (hw + 0.1), f * FH - 0.7, hd - 3, dark);
    }
  },
  // entrance, canopy, garage door and the plinth detail, all on the local +z face
  _base(rec, bb, b, hw, hd) {
    const G = Level11Gen, L = b.look, trim = this.col(L.pal.trim, 0.8), dark = this.col(0x15181a), glow = this.col(b.enterable ? 0x6a7a6a : 0x7a2a2a);
    this.lbox(bb, -2.0, 0, hd, 2.0, 3.0, hd + 0.08, trim);                              // the frame
    this.lbox(bb, -1.6, 0, hd + 0.02, 1.6, 2.7, hd + 0.1, dark);                         // the dark recess (the leaf slides over it)
    this.lbox(bb, 1.8, 1.2, hd + 0.1, 1.95, 1.5, hd + 0.16, glow);                        // an indicator: green if it opens, red if not
    const ent = L.entrance;
    if (ent === "canopy" || ent === "ambulance" || ent === "portico") {
      const wd = ent === "ambulance" ? 8 : 6;
      this.lbox(bb, -wd / 2, 3.2, hd, wd / 2, 3.45, hd + (ent === "portico" ? 3 : 2.4), trim);
      if (ent === "ambulance") this.lbox(bb, -wd / 2, 3.45, hd + 2.3, wd / 2, 3.75, hd + 2.4, this.col(0xa03030));
      if (ent === "portico") for (const s of [-1, 1]) { this.lbox(bb, s * 2.6 - 0.2, 0, hd + 2.6, s * 2.6 + 0.2, 3.2, hd + 3.0, trim); }
    } else if (ent === "revolving") {
      this.lbox(bb, -2.2, 0, hd + 0.1, 2.2, 3.0, hd + 1.6, this.col(L.pal.glass, 0.9)); this.lbox(bb, -2.3, 3.0, hd + 0.1, 2.3, 3.2, hd + 1.7, trim);
    }
    const gd = G.garageDoor(b);
    if (gd) {
      const x0 = gd.lx - 2.3, x1 = gd.lx + 2.3;
      this.lbox(bb, x0 - 0.2, 0, hd, x1 + 0.2, 3.3, hd + 0.08, trim); this.lbox(bb, x0, 0, hd + 0.02, x1, 3.0, hd + 0.1, this.col(0x44484a));
      this.lbox(bb, x0, 3.0, hd + 0.1, x1, 3.2, hd + 0.14, this.col(0xc8a020));
    }
  },
  _crown(rec, bb, b, hw, hd, Ht) {
    const L = b.look, trim = this.col(L.pal.trim, 0.9), G = Level11Gen, hh = (n) => G.hash(b.bi, b.bj, b.k, 430 + n);
    if (!b.roof) { // parapet
      this.lbox(bb, -hw, Ht, -hd, hw, Ht + 1.0, -hd + 0.4, trim); this.lbox(bb, -hw, Ht, hd - 0.4, hw, Ht + 1.0, hd, trim);
      this.lbox(bb, -hw, Ht, -hd + 0.4, -hw + 0.4, Ht + 1.0, hd - 0.4, trim); this.lbox(bb, hw - 0.4, Ht, -hd + 0.4, hw, Ht + 1.0, hd - 0.4, trim);
    }
    const crown = b.roof ? "flat" : L.crown;
    if (crown === "mech" || crown === "flat") {
      for (let i = 0; i < 3; i++) { const x = (hh(i) - 0.5) * (hw * 1.2), z = (hh(i + 5) - 0.5) * (hd * 1.2); this.lbox(bb, x - 1.2, Ht + (b.roof ? 0 : 1), z - 1, x + 1.2, Ht + 2.4, z + 1, this.col(0x6a6a66)); }
    } else if (crown === "setback") {
      this.lbox(bb, -hw * 0.6, Ht, -hd * 0.6, hw * 0.6, Ht + 6.4, hd * 0.6, this.col(L.pal.wall, 0.85)); this.lbox(bb, -hw * 0.6, Ht + 6.4, -hd * 0.6, hw * 0.6, Ht + 6.7, hd * 0.6, trim);
    } else {
      this.lbox(bb, -hw * 0.7, Ht, -hd * 0.7, hw * 0.7, Ht + 4, hd * 0.7, this.col(L.pal.wall, 0.9)); this.lbox(bb, -hw * 0.4, Ht + 4, -hd * 0.4, hw * 0.4, Ht + 8, hd * 0.4, this.col(L.pal.wall, 0.8));
      this.lbox(bb, -0.15, Ht + 8, -0.15, 0.15, Ht + 16, 0.15, this.col(0x555555));
    }
  },
  // ground-level colliders for the shell (6 m high is out of reach), and the doors as small dynamic objects
  _shellColliders(rec, b) {
    const G = Level11Gen, hw = b.w / 2, hd = b.d / 2, T = 0.4, h = 6, gd = G.garageDoor(b);
    const gaps = { S: [] };
    gaps.S.push([-1.6, 1.6, "e"]);                                                    // every building has an entrance door; a locked one simply never opens
    if (gd) gaps.S.push([gd.lx - 2.3, gd.lx + 2.3, "g"]);
    gaps.S.sort((p, q) => p[0] - q[0]);
    this.lcol(rec, b, -hw, 0, -hd, hw, h, -hd + T, "wall"); this.lcol(rec, b, -hw, 0, -hd, -hw + T, h, hd, "wall"); this.lcol(rec, b, hw - T, 0, -hd, hw, h, hd, "wall");
    let x = -hw;
    for (const [a0, a1, kind] of gaps.S) { this.lcol(rec, b, x, 0, hd - T, a0, h, hd, "wall"); this.lcol(rec, b, a0, 3.1, hd - T, a1, h, hd, "wall"); x = a1; }
    this.lcol(rec, b, x, 0, hd - T, hw, h, hd, "wall");
    for (const [a0, a1, kind] of gaps.S) this._door(rec, b, kind, a0, a1);
    if (b.look.entrance === "portico") for (const s of [-1, 1]) this.lcol(rec, b, s * 2.6 - 0.2, 0, hd + 2.6, s * 2.6 + 0.2, 3.2, hd + 3.0, "column");
  },
  _door(rec, b, kind, a0, a1) {
    const G = Level11Gen, hd = b.d / 2, key = b.key + ":" + kind, ent = kind === "e", h = ent ? 2.7 : 3.0;
    const p = G.toWorld(b, (a0 + a1) / 2, hd - 0.1);
    const w = G.worldRect(b, a0, hd - 0.4, a1, hd);
    const open = this.persist && this.persist.open.has(key) && this.cur && this.cur.b.key === b.key;
    const cl = this.collider(rec, w.x0, 0, w.z0, w.x1, h, w.z1, "door");
    const d = { key, b, kind, x: p.x, z: p.z, a0, a1, h, locked: ent ? !b.enterable : false, open: open ? 1 : 0, target: open ? 1 : 0, collider: cl, mesh: null, rec };
    if (open) { cl.min.y = 500; cl.max.y = 502; }
    else if (this.persist) this.persist.open.delete(key);
    rec.doors.push(d); this.doors.set(key, d);
  },

  /* ------------------------------------------------------------------ block streaming */
  _plan(px, pz) {
    const P = Level11Gen.PITCH, bi = Math.floor(px / P), bj = Math.floor(pz / P), R = Math.ceil(this.BUILD / P) + 1, q = [];
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = bi + di, j = bj + dj, key = i + "," + j;
      if (this.blocks.has(key)) continue;
      const dd = this._blockDist({ x0: i * P, z0: j * P, x1: i * P + P, z1: j * P + P }, px, pz);
      if (dd < this.BUILD) q.push({ d: dd, i, j, key });
    }
    q.sort((a, c) => a.d - c.d);
    this._queue = q;
    for (const rec of Array.from(this.blocks.values())) if (this._blockDist(rec.B, px, pz) > this.DROP) this._disposeBlock(rec);
  },
  _disposeBlock(rec) {
    for (const d of rec.doors) { if (d.mesh) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); d.mesh = null; } if (this.doors.get(d.key) === d) this.doors.delete(d.key); }
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos) g.dispose();
    rec.disposed = true;
    this.blocks.delete(rec.key);
    this._dirty = true;
  },
  stream(force, maxDist) {
    if (!this.active || !this.group || this._leaving || this.mode === "garage") return;
    const p = Player.position, key = Math.floor(p.x / 16) + "," + Math.floor(p.z / 16);
    if (force || key !== this._lastKey) { this._lastKey = key; this._plan(p.x, p.z); }
    const t0 = performance.now(), budget = Math.min(this.BUDGET, this.q().meshBudgetMs || this.BUDGET);
    let guard = 0;
    for (;;) {
      if (++guard > 20000) break;
      if (!this._cur_rec) {
        const it = this._queue[0];
        if (!it) break;
        if (force && maxDist != null && it.d > maxDist) break;
        this._queue.shift();
        if (this.blocks.has(it.key)) continue;
        const P = Level11Gen.PITCH, rec = this.newRec(it.key, { bi: it.i, bj: it.j, B: { x0: it.i * P, z0: it.j * P, x1: it.i * P + P, z1: it.j * P + P } });
        rec.gen = this._buildBlock(rec);
        this.blocks.set(rec.key, rec);
        this.group.add(rec.group);
        this._cur_rec = rec;
      }
      const rec = this._cur_rec, r = rec.gen.next();
      this.flush(rec);
      this._dirty = true;
      if (r.done) { this._cur_rec = null; rec.gen = null; }
      if (!force && performance.now() - t0 > budget) break;
    }
    if (this._cur_rec && this._cur_rec.disposed) this._cur_rec = null;
    if (this._dirty) { this._dirty = false; this._collect(); }
  },
  _collect() {
    const p = Player.position, a = this.colliders;
    a.length = 0;
    this.exits = [];
    if (this.mode !== "garage") for (const rec of this.blocks.values()) {
      rec.dist = this._blockDist(rec.B, p.x, p.z);
      if (rec.dist < this.COLLIDE) for (const c of rec.colliders) a.push(c);
    }
    for (const fr of this.floors.values()) { for (const c of fr.colliders) a.push(c); if (fr.exit) this.exits.push(fr.exit); }
    if (this.cab) for (const c of this.cab.colliders) a.push(c);
  },

  /* ------------------------------------------------------------------ floors (interiors) */
  // the building-like frame a plan is built in: a real building, or the garage placed at the lift's building, unrotated
  frameFor(b, f) { return f === "G" ? { facing: 2, theta: 0, x: b.x, z: b.z, key: b.key } : b; },
  floorYOf(b, f) { return f === "G" ? Level11Floors.GARAGE_Y : Level11Gen.floorY(f); },
  _queueFloor(f) {
    const b = this.cur.b, plan = f === "G" ? Level11Floors.garage(b) : Level11Floors.plan(b, f);
    if (!plan) return null;
    const rec = this.newRec(b.key + "#" + f, { floor: f, b, plan, bld: this.frameFor(b, f), y: this.floorYOf(b, f), panel: null, exit: null });
    rec.gen = this._buildFloor(rec);
    this.floors.set(f, rec);
    this.group.add(rec.group);
    this._fq.push(rec);
    return rec;
  },
  *_buildFloor(rec) {
    const F = Level11Floors, P = rec.plan, bld = rec.bld, b = rec.lit, e = rec.emi, y = rec.y, cl = P.clear, T = F.T, r = P.rect, c = P.col;
    b.push(bld.theta, bld.x, bld.z); e.push(bld.theta, bld.x, bld.z);
    // slab (a hole where a stair or ramp arrives) and ceiling
    for (const q of this.rectsMinus(r, P.slab.holes)) { this.lbox(b, q.x0, y - 0.3, q.z0, q.x1, y, q.z1, this.col(c.floor)); this.lcol(rec, bld, q.x0, y - 0.3, q.z0, q.x1, y, q.z1, "floor"); }
    if (!P.open) {
      const holes = rec.b && rec.floor !== "G" ? F.ceilHoles(rec.b, rec.floor) : [];
      for (const q of this.rectsMinus(r, holes)) this.flat(b, q.x0, q.z0, q.x1, q.z1, y + cl, this.col(c.ceil), true);
      if (rec.floor === "G" || (rec.b && rec.floor === rec.b.floors && !rec.b.roof)) this.lcol(rec, bld, r.x0, y + cl, r.z0, r.x1, y + cl + 0.3, r.z1, "ceil");   // the top of the building / the garage
    }
    this._perimeter(rec, P, bld, y);
    this.flush(rec);
    yield;
    for (const w of P.walls) { this.lbox(b, w.x0, y + w.y0, w.z0, w.x1, y + w.y1, w.z1, this.col(w.c)); if (w.y1 - w.y0 > 0.05) this.lcol(rec, bld, w.x0, y + w.y0, w.z0, w.x1, y + w.y1, w.z1, "wall"); }
    this.flush(rec);
    yield;
    for (const p of P.props) {
      this.lbox(p.emi ? e : b, p.x0, y + p.y0, p.z0, p.x1, y + p.y1, p.z1, this.col(p.c));
      if (p.col) this.lcol(rec, bld, p.x0, y + p.y0, p.z0, p.x1, y + p.y1, p.z1, p.stair ? "step" : "prop");
    }
    const lc = this.col(c.light), dead = this.col(0x25262a);
    for (const q of P.panels) this.flat(e, q.x - q.sx / 2, q.z - q.sz / 2, q.x + q.sx / 2, q.z + q.sz / 2, y + cl - 0.03, q.on ? lc : dead, true);
    const spec = P.lightSpec;
    for (const l of P.lights) { const w = Level11Gen.toWorld(bld, l.x, l.z); rec.fixtures.push({ x: w.x, y: y + cl - 0.5, z: w.z, base: spec.base, dist: spec.dist, color: spec.c }); }
    this.flush(rec);
    yield;
    this._lift_panel(rec);
    if (P.exit) { const w = Level11Gen.worldRect(bld, P.exit.x0, P.exit.z0, P.exit.x1, P.exit.z1); rec.exit = { kind: "level1", x0: w.x0, z0: w.z0, x1: w.x1, z1: w.z1, y: y }; }
    this._pickups(rec);
    rec.done = true;
    this._dirty = true;
  },
  // the outer wall of a floor: visible and solid, with window openings (solid glass) and doorways (open)
  _perimeter(rec, P, bld, y) {
    const F = Level11Floors, r = P.rect, T = F.T, b = rec.lit, cl = P.clear, wc = this.col(P.col.wall), top = P.open ? P.parapet : cl;
    const side = (s) => s === "N" ? { lo: r.x0, hi: r.x1, box: (a0, a1, y0, y1) => [a0, y0, r.z0, a1, y1, r.z0 + T] }
      : s === "S" ? { lo: r.x0, hi: r.x1, box: (a0, a1, y0, y1) => [a0, y0, r.z1 - T, a1, y1, r.z1] }
      : s === "W" ? { lo: r.z0, hi: r.z1, box: (a0, a1, y0, y1) => [r.x0, y0, a0, r.x0 + T, y1, a1] }
      : { lo: r.z0, hi: r.z1, box: (a0, a1, y0, y1) => [r.x1 - T, y0, a0, r.x1, y1, a1] };
    for (const s of ["N", "S", "W", "E"]) {
      const S = side(s), seg = (a0, a1, y0, y1, solid) => {
        if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
        const q = S.box(a0, a1, y + y0, y + y1);
        this.lbox(b, q[0], q[1], q[2], q[3], q[4], q[5], wc);
        if (solid) this.lcol(rec, bld, q[0], q[1], q[2], q[3], q[4], q[5], "wall");
      };
      if (P.open) { seg(S.lo, S.hi, 0, top, true); continue; }
      const ops = P.windows.filter(o => o.side === s).map(o => ({ a0: o.a0, a1: o.a1, y0: o.y0, y1: o.y1, door: false }))
        .concat(P.perimDoors.filter(o => o.side === s).map(o => ({ a0: o.a0, a1: o.a1, y0: 0, y1: o.h, door: true }))).sort((p, q) => p.a0 - q.a0);
      let pos = S.lo;
      for (const o of ops) {
        if (o.a0 < pos) continue;
        seg(pos, o.a0, 0, cl, true);
        if (!o.door) { seg(o.a0, o.a1, 0, o.y0, true); seg(o.a0, o.a1, o.y1, cl, true); seg(o.a0, o.a1, o.y0, o.y1, false); this._glassCollider(rec, bld, S.box(o.a0, o.a1, y + o.y0, y + o.y1)); }
        else seg(o.a0, o.a1, o.y1, cl, true);
        pos = o.a1;
      }
      seg(pos, S.hi, 0, cl, true);
    }
  },
  _glassCollider(rec, bld, q) { this.lcol(rec, bld, q[0], q[1], q[2], q[3], q[4], q[5], "glass"); },
  // the closed lift door on a floor where the cab is not (a small dynamic mesh, so it can hide when the cab arrives)
  _lift_panel(rec) {
    const P = rec.plan;
    if (!P.elev || rec.floor === "G" && !P.elev) return;
    const E = Level11Floors.ELEV, bld = rec.bld, M = this.mats();
    const w = Level11Gen.worldRect(bld, E.dx0, 4.5, E.dx1, 4.5 + Level11Floors.FRONT);
    const cl = this.collider(rec, w.x0, rec.y, w.z0, w.x1, rec.y + 2.3, w.z1, "liftdoor");
    const m = new THREE.Mesh(M.box, M.door);
    m.position.set((w.x0 + w.x1) / 2, rec.y + 1.15, (w.z0 + w.z1) / 2);
    m.scale.set(w.x1 - w.x0, 2.3, w.z1 - w.z0);
    rec.group.add(m);
    rec.panel = { mesh: m, collider: cl, y: rec.y };
    if (this.cab && this.cab.floor === rec.floor) this._panelHide(rec, true);
  },
  _panelHide(rec, hide) {
    if (!rec.panel) return;
    rec.panel.mesh.visible = !hide;
    rec.panel.collider.min.y = hide ? 500 : rec.panel.y; rec.panel.collider.max.y = hide ? 502 : rec.panel.y + 2.3;
  },
  _pickups(rec) {
    if (typeof PickupSystem === "undefined" || !PickupSystem.group) return;
    for (const l of rec.plan.loot) {
      if (this.persist.taken.has(l.id)) continue;
      const w = Level11Gen.toWorld(rec.bld, l.x, l.z);
      PickupSystem._addMesh(l.kind, w.x, w.z);
      const q = PickupSystem.list[PickupSystem.list.length - 1];
      q.l11 = l.id; q.y = rec.y + l.y;
      if (q.mesh) q.mesh.position.y = rec.y + l.y + 0.17;
      rec.pickups.push(q);
    }
  },
  _syncTaken(rec) { for (const q of rec.pickups) if (q.taken && q.l11) this.persist.taken.add(q.l11); },
  _disposeFloor(rec) {
    this._syncTaken(rec);
    for (const q of rec.pickups) {
      if (q.mesh) { if (q.mesh.parent) q.mesh.parent.remove(q.mesh); if (q.mesh.material && q.mesh.material.dispose && false) q.mesh.material.dispose(); }
      if (typeof PickupSystem !== "undefined") { const i = PickupSystem.list.indexOf(q); if (i >= 0) PickupSystem.list.splice(i, 1); }
    }
    rec.pickups.length = 0;
    if (rec.panel && rec.panel.mesh.parent) rec.panel.mesh.parent.remove(rec.panel.mesh);
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos) g.dispose();
    rec.disposed = true;
    const i = this._fq.indexOf(rec); if (i >= 0) this._fq.splice(i, 1);
    if (this._cur_floor === rec) this._cur_floor = null;
    if (this.floors.get(rec.floor) === rec) this.floors.delete(rec.floor);
    this._dirty = true;
  },
  _disposeAllFloors() { for (const rec of Array.from(this.floors.values())) this._disposeFloor(rec); this._fq.length = 0; this._cur_floor = null; },
  // keep exactly floor f and its neighbours: build what is missing, drop the rest
  _syncFloors(f) {
    const b = this.cur.b, want = f === "G" ? ["G"] : Level11Gen.window(b, f);
    for (const [k, rec] of Array.from(this.floors)) if (!want.includes(k)) this._disposeFloor(rec);
    for (const k of want) if (!this.floors.has(k)) this._queueFloor(k);
    this._want = want;
    this._dirty = true;
  },
  _floorsReady(f) { const b = this.cur.b, want = f === "G" ? ["G"] : Level11Gen.window(b, f); return want.every(k => { const r = this.floors.get(k); return r && r.done; }); },
  _pumpFloors(force) {
    const t0 = performance.now(), budget = Math.min(this.BUDGET, this.q().meshBudgetMs || this.BUDGET);
    let guard = 0;
    while (this._fq.length && ++guard < 5000) {
      if (!this._cur_floor) this._cur_floor = this._fq[0];
      const rec = this._cur_floor;
      if (rec.disposed) { this._cur_floor = null; continue; }
      const r = rec.gen.next();
      this.flush(rec);
      this._dirty = true;
      if (r.done) { rec.gen = null; this._cur_floor = null; const i = this._fq.indexOf(rec); if (i >= 0) this._fq.splice(i, 1); }
      if (!force && performance.now() - t0 > budget) break;
    }
    if (this._dirty) { this._dirty = false; this._collect(); this._setBase(); this._refreshFixtures(); }
  },
  _setBase() {
    let m = 0;
    if (this.mode === "garage") m = Level11Floors.GARAGE_Y;
    else if (this.mode === "building") {
      m = Infinity;                                                  // the lowest walkable level: the lowest loaded floor, or the cab in transit
      for (const rec of this.floors.values()) if (rec.y < m) m = rec.y;
      if (this.cab && this.cab.y < m) m = this.cab.y;
      if (m === Infinity) m = 0;
    }
    this.baseY = m;
  },
  floorName(f) { return f === "G" ? "?" : f > (this.cur ? this.cur.b.floors : 1e9) ? "ROOF" : f < 0 ? "P" + (-f) : String(f); },
  // true while the player is in the stairwell shaft and a floor is still being built: then the build is finished at once
  _onStairs() {
    if (!this._fq.length || this.mode !== "building" || !this.cur) return false;
    const p = Player.position, l = Level11Gen.toLocal(this.cur.b, p.x, p.z);
    return l.x > 0.2 && l.x < 4.0 && l.z > -0.8 && l.z < 4.6;
  },
  _trackFloor() {
    if (this.mode !== "building" || !this.cur || this.lift.state !== "idle" && this.lift.state !== "panel") return;
    const b = this.cur.b, py = Player.position.y;
    let best = null;
    for (const f of Level11Gen.floorList(b)) if (Level11Gen.floorY(f) <= py + 0.35) best = f;
    if (best == null || best === this.cur.floor) return;
    this.cur.floor = best;
    this._syncFloors(best);
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(best > b.floors ? "ROOF" : best < 0 ? "PARKING P" + (-best) : best === 1 ? "LOBBY" : "FLOOR " + best);
  },

  /* ------------------------------------------------------------------ doors (entrance and garage) */
  _doors(dt) {
    const p = Player.position, M = this.mats(), G = Level11Gen;
    for (const d of this.doors.values()) {
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      if (dist < 42 && !d.mesh && this.group) {
        const m = new THREE.Mesh(M.box, M.door), w = d.a1 - d.a0, b = d.b, hd = b.d / 2, c = G.toWorld(b, (d.a0 + d.a1) / 2, hd - 0.1), ns = b.facing === 0 || b.facing === 2;
        d.cx = c.x; d.cz = c.z; d.sx = ns ? w : 0.14; d.sz = ns ? 0.14 : w; d.along = ns ? "x" : "z";
        m.position.set(c.x, d.h / 2, c.z); m.scale.set(d.sx, d.h, d.sz);
        this.group.add(m); d.mesh = m;
      } else if (dist > 62 && d.mesh) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); d.mesh = null; }
      if (d.open !== d.target) { d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.6); }
      const solid = d.open < 0.5;
      d.collider.min.y = solid ? 0 : 500; d.collider.max.y = solid ? d.h : 502;
      if (d.mesh) {
        const k = 1 - d.open;
        d.mesh.visible = k > 0.03;
        if (d.along === "x") { d.mesh.scale.x = Math.max(0.01, d.sx * k); d.mesh.position.x = d.cx - (d.sx * (1 - k)) / 2; }
        else { d.mesh.scale.z = Math.max(0.01, d.sz * k); d.mesh.position.z = d.cz - (d.sz * (1 - k)) / 2; }
      }
    }
  },

  /* ------------------------------------------------------------------ entering and leaving a building */
  _pb(b) { let r = this.persist.bld.get(b.key); if (!r) { r = { trips: 0, anomaly: false }; this.persist.bld.set(b.key, r); } return r; },
  _enterBuilding(d) {
    if (this.cur || this._leaving) return false;
    const b = d.b, G = Level11Gen;
    this.cur = { b, floor: d.kind === "g" ? -1 : 1 };
    this.mode = "building";
    this._entryDoor = d; this._doorOpened = false; this._wasInside = false;
    this.persist.open.add(d.key);
    this._makeCab(b);
    this._syncFloors(this.cur.floor);
    this._setAudio("in");
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(b.id + " · " + b.floors + " FLOORS");
    return true;
  },
  _leaveBuilding() {
    if (!this.cur) return;
    const b = this.cur.b;
    this._disposeAllFloors();
    this._destroyCab();
    for (const k of ["e", "g"]) { const d = this.doors.get(b.key + ":" + k); if (d) d.target = 0; this.persist.open.delete(b.key + ":" + k); }
    this.cur = null; this.mode = "street"; this._entryDoor = null;
    this.lift = { state: "idle" }; this._hideUI();
    this._dirty = true; this._collect(); this._setBase(); this._refreshFixtures();
    this._setAudio("out");
    this._lastKey = "";
  },
  _insideFootprint(b, m) { const p = Player.position, r = b.footRect; return p.x > r.x0 - m && p.x < r.x1 + m && p.z > r.z0 - m && p.z < r.z1 + m; },
  _setAudio(which) {
    if (this._aud === which || typeof AudioSystem === "undefined" || !AudioSystem.setLevel) return;
    this._aud = which;
    AudioSystem.setLevel(which === "in" ? "11i" : 11);
  },

  /* ------------------------------------------------------------------ the lift */
  lift: { state: "idle" },
  // The cab is one small separate object (floor, ceiling, three walls, front flanks, a door leaf). It is moved, never
  // simulated: a ride closes the door, loads the destination window, then puts the cab and the player at the new floor.
  _makeCab(b, floor) {
    const F = Level11Floors, E = F.ELEV, M = this.mats(), f = floor || 1, bld = this.frameFor(b, f);
    const g = new THREE.Group(), lit = new L9Builder(), emi = new L9Builder(), geos = [], parts = [];
    lit.push(bld.theta, bld.x, bld.z); emi.push(bld.theta, bld.x, bld.z);
    const mc = this.col(0x9aa0a4), box = (x0, y0, z0, x1, y1, z1, c, solid, b2) => {
      this.lbox(b2 || lit, x0, y0, z0, x1, y1, z1, c);
      if (solid) { const w = Level11Gen.worldRect(bld, x0, z0, x1, z1); const cc = { min: { x: w.x0, y: 0, z: w.z0 }, max: { x: w.x1, y: 0, z: w.z1 }, tag: "cab" }; parts.push({ c: cc, y0, y1 }); }
    };
    box(E.x0, 0, E.z0, E.x1, 2.6, E.z0 + 0.1, mc, true); box(E.x0, 0, E.z0, E.x0 + 0.1, 2.6, E.z1, mc, true); box(E.x1 - 0.1, 0, E.z0, E.x1, 2.6, E.z1, mc, true);
    box(E.x0, 0, 4.5, E.dx0, 2.6, 4.8, mc, true); box(E.dx1, 0, 4.5, E.x1, 2.6, 4.8, mc, true); box(E.dx0, 2.3, 4.5, E.dx1, 2.6, 4.8, mc, true);
    box(E.x0, -0.3, E.z0, E.x1, 0, 4.8, this.col(0x5a5c5e), true); box(E.x0, 2.6, E.z0, E.x1, 2.9, 4.8, this.col(0x7a7c7e), true);
    box(E.x1 - 0.14, 1.0, 2.9, E.x1 - 0.1, 1.6, 3.6, this.col(0xd8a040), false, emi);             // the button panel on the right wall
    this.flat(lit, E.x0, E.z0, E.x1, 4.5, 0.01, this.col(0x6a6a68)); this.flat(lit, E.x0, E.z0, E.x1, 4.5, 2.6, this.col(0xb8b8b4), true);
    this.flat(emi, E.x0 + 0.5, E.z0 + 0.5, E.x1 - 0.5, 4.0, 2.58, this.col(0xfff2d8), true);
    this._mesh(g, geos, lit, M.lit); this._mesh(g, geos, emi, M.emi);
    const leafW = Level11Gen.worldRect(bld, E.dx0, 4.5, E.dx1, 4.8);
    const lc = { min: { x: leafW.x0, y: 0, z: leafW.z0 }, max: { x: leafW.x1, y: 0, z: leafW.z1 }, tag: "cabdoor" };
    parts.push({ c: lc, y0: 0, y1: 2.3, door: true });
    const leaf = new THREE.Mesh(M.box, M.door);
    leaf.scale.set(leafW.x1 - leafW.x0, 2.3, leafW.z1 - leafW.z0);
    g.add(leaf);
    if (this.group) this.group.add(g);
    const ctr = Level11Gen.toWorld(bld, (E.x0 + E.x1) / 2, (E.z0 + E.z1) / 2);
    this.cab = { b, bld, floor: f, y: 0, group: g, geos, parts, colliders: parts.map(q => q.c), leaf, leafRect: leafW, door: { open: 1, target: 1 }, cx: ctr.x, cz: ctr.z };
    this._cabPlace(f);
    return this.cab;
  },
  _destroyCab() {
    const c = this.cab; if (!c) return;
    if (c.group.parent) c.group.parent.remove(c.group);
    for (const g of c.geos) g.dispose();
    for (const rec of this.floors.values()) this._panelHide(rec, false);
    this.cab = null; this._dirty = true;
  },
  _cabPlace(f) {
    const c = this.cab; if (!c) return;
    c.floor = f; c.y = this.floorYOf(c.b, f);
    c.group.position.y = c.y;
    for (const q of c.parts) { if (q.door) continue; q.c.min.y = c.y + q.y0; q.c.max.y = c.y + q.y1; }
    this._cabDoor();
    for (const rec of this.floors.values()) this._panelHide(rec, rec.floor === f);
    this._dirty = true;
  },
  _cabDoor() {
    const c = this.cab, d = c.door, solid = d.target === 0 || d.open < 0.5, q = c.parts.find(p => p.door), r = c.leafRect, k = 1 - d.open;
    q.c.min.y = solid ? c.y : 500; q.c.max.y = solid ? c.y + 2.3 : 502;
    const ns = c.bld.facing === 0 || c.bld.facing === 2, w = (ns ? r.x1 - r.x0 : r.z1 - r.z0), cxm = (r.x0 + r.x1) / 2, czm = (r.z0 + r.z1) / 2;
    c.leaf.visible = k > 0.03;
    c.leaf.position.set(ns ? cxm - w * (1 - k) / 2 : cxm, c.y + 1.15, ns ? czm : czm - w * (1 - k) / 2);
    c.leaf.scale.set(ns ? Math.max(0.01, w * k) : r.x1 - r.x0, 2.3, ns ? r.z1 - r.z0 : Math.max(0.01, w * k));
  },
  _inCab() {
    const c = this.cab; if (!c || !this.cur) return false;
    const E = Level11Floors.ELEV, p = Player.position, l = Level11Gen.toLocal(c.bld, p.x, p.z);
    return l.x > E.x0 && l.x < E.x1 && l.z > E.z0 && l.z < 4.6 && Math.abs(p.y - c.y) < 1.8;
  },
  callCab() {
    const c = this.cab, L = this.lift;
    if (!c || L.state !== "idle") return false;
    if (c.floor !== this.cur.floor) this._cabPlace(this.cur.floor);
    c.door.target = 1;
    if (typeof AudioSystem !== "undefined" && AudioSystem._tone) AudioSystem._tone(880, "sine", 0.35, 0.03, "events");
    return true;
  },
  _openPanel() {
    this.lift = { state: "panel", text: "" };
    this._showUI();
  },
  _closePanel() { if (this.lift.state === "panel") { this.lift = { state: "idle" }; this._hideUI(); } },
  // Keys while the panel is open: digits type a floor, Backspace deletes, Up/Down step, Enter goes, G is the garage once found
  panelKey(code, key) {
    const L = this.lift, b = this.cur && this.cur.b;
    if (L.state !== "panel" || !b) return false;
    const val = L.text === "" ? (typeof this.cab.floor === "number" ? this.cab.floor : 1) : parseInt(L.text, 10);
    if (/^[0-9]$/.test(key || "")) { if (L.text.length < 2) L.text += key; }
    else if (code === "Backspace") { if (L.text) L.text = L.text.slice(0, -1); else this._closePanel(); }
    else if (code === "ArrowUp") L.text = String(Math.min(b.floors, val + 1));
    else if (code === "ArrowDown") L.text = String(Math.max(1, val - 1));
    else if (code === "PageUp") L.text = String(Math.min(b.floors, val + 10));
    else if (code === "PageDown") L.text = String(Math.max(1, val - 10));
    else if (code === "KeyG" && this._pb(b).anomaly) return this._goRide("G");
    else if (code === "Enter" || code === "NumpadEnter") { const n = parseInt(L.text || String(val), 10); return this._goRide(n); }
    else return false;
    this._showUI();
    return true;
  },
  _goRide(dest) {
    const err = this.requestRide(dest);
    if (err && typeof HUD !== "undefined" && HUD.toast) HUD.toast(err === "same" ? "YOU ARE ALREADY HERE" : err === "no such floor" ? "NO SUCH FLOOR" : "STEP INSIDE");
    return true;
  },
  requestRide(dest) {
    const L = this.lift, c = this.cab, b = this.cur && this.cur.b, G = Level11Gen;
    if (!c || !b || (L.state !== "idle" && L.state !== "panel")) return "busy";
    if (!this._inCab()) return "not in cab";
    const from = c.floor, pb = this._pb(b);
    if (dest === "G") { if (!pb.anomaly) return "no such floor"; if (from === "G") return "same"; }
    else { if (!Number.isInteger(dest) || dest < 1 || dest > b.floors) return "no such floor"; if (dest === from) return "same"; }
    const n = pb.trips++, fromN = from === "G" ? 1 : from;
    const anomaly = dest === "G" ? true : (from !== "G" && G.anomalyTrip(b, n, fromN, dest));
    const to = anomaly ? "G" : dest, tgt = typeof dest === "number" ? dest : fromN;
    this.lift = { state: "closing", t: 0, from, to, requested: dest, anomaly, dur: anomaly ? 6.5 : Math.max(1.6, Math.min(5.5, 1.4 + 0.07 * Math.abs(tgt - fromN))), shown: fromN, fromN, tgt };
    c.door.target = 0;
    this._showUI();
    return null;
  },
  _lift(dt) {
    const c = this.cab, L = this.lift;
    if (!c) return;
    const d = c.door;
    if (d.open !== d.target) { d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.25); this._cabDoor(); }
    if (L.state === "panel") { if (!this._inCab()) this._closePanel(); }
    else if (L.state === "closing") {
      if (!this._inCab()) { this._pb(this.cur.b).trips = Math.max(0, this._pb(this.cur.b).trips - 1); this.lift = { state: "idle" }; d.target = 1; this._hideUI(); }   // pushed out of the cab: no ride
      else if (d.open <= 0) this._beginTransit();
    }
    else if (L.state === "moving") {
      L.t += dt;
      L.shown = Math.round(L.fromN + (L.tgt - L.fromN) * Math.min(1, L.t / (L.dur * 0.9)));          // the indicator counts floors by time, not by simulation
      this._showUI();
      if (L.t >= L.dur && this._floorsReady(L.to)) this._arrive();
    } else if (L.state === "opening") { if (d.open >= 1) { this.lift = { state: "idle" }; this._hideUI(); } }
  },
  _beginTransit() {
    const L = this.lift, b = this.cur.b;
    L.state = "moving"; L.t = 0;
    if (L.to === "G") {
      const pb = this._pb(b); pb.anomaly = true;
      this.persist.garage.set(b.key, true);
      this.mode = "garage";
      for (const rec of Array.from(this.blocks.values())) this._disposeBlock(rec);
      this._queue.length = 0; this._cur_rec = null; this._dirty = true;
    } else if (this.mode === "garage") { this.mode = "building"; this._lastKey = ""; }
    this._syncFloors(L.to);
    this._pumpFloors(false);
  },
  _arrive() {
    const L = this.lift, c = this.cab, b = this.cur.b, to = L.to, p = Player.position;
    const frameChange = (c.floor === "G") !== (to === "G");
    if (frameChange) {
      const lp = Level11Gen.toLocal(c.bld, p.x, p.z), y0 = c.y;
      this._destroyCab(); this._makeCab(b, to);
      const w = Level11Gen.toWorld(this.cab.bld, lp.x, lp.z);
      p.x = w.x; p.z = w.z; p.y += this.cab.y - y0;
    } else { const y0 = c.y; this._cabPlace(to); p.y += this.cab.y - y0; }
    Player.velocity.set(0, 0, 0);
    this.cur.floor = to;
    this.cab.door.open = 0; this.cab.door.target = 1;
    this._cabDoor();
    this.lift = { state: "opening" };
    this._dirty = true; this._collect(); this._setBase(); this._refreshFixtures();
    this._setAudio("in");
    if (typeof AudioSystem !== "undefined" && AudioSystem._tone) AudioSystem._tone(660, "sine", 0.5, 0.04, "events");
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(to === "G" ? "THE DOORS OPEN ON A PARKING GARAGE" : "FLOOR " + to);
  },
  // the lift indicator and floor selector: one small DOM element
  _showUI() {
    if (typeof document === "undefined" || !document.createElement) return;
    if (!this._el) {
      const el = document.createElement("div");
      el.id = "l11-lift";
      Object.assign(el.style, { position: "fixed", left: "50%", bottom: "18%", transform: "translateX(-50%)", padding: "10px 18px", background: "rgba(10,10,12,0.78)", color: "#e8d9a8", font: "600 20px monospace", letterSpacing: "0.12em", border: "1px solid #6a5a2a", borderRadius: "4px", zIndex: "40", pointerEvents: "none", textAlign: "center", whiteSpace: "pre" });
      if (document.body && document.body.appendChild) document.body.appendChild(el);
      this._el = el;
    }
    const L = this.lift, b = this.cur && this.cur.b, extra = b && this._pb(b).anomaly ? "   G = ?" : "";
    let t = "";
    if (L.state === "panel") t = "FLOOR  " + (L.text || "_") + "\n1-" + (b ? b.floors : "?") + extra + "\nENTER: GO   E: CANCEL";
    else if (L.state === "closing") t = "DOORS CLOSING";
    else if (L.state === "moving") t = (L.tgt >= L.shown ? "\u25B2 " : "\u25BC ") + L.shown;
    this._el.textContent = t;
    this._el.style.display = t ? "block" : "none";
  },
  _hideUI() { if (this._el) this._el.style.display = "none"; },

  /* ------------------------------------------------------------------ interaction */
  _target() {
    if (!this.active || this._leaving) return null;
    const p = Player.position;
    if (this.mode === "street") {
      let best = null, bd = 3.4;
      for (const d of this.doors.values()) { const dist = Math.hypot(d.x - p.x, d.z - p.z); if (dist < bd && p.y < 2) { bd = dist; best = d; } }
      return best && best.open < 0.5 ? { kind: "door", d: best } : null;
    }
    const c = this.cab, cur = this.cur;
    if (!c || !cur) return null;
    if (this.lift.state === "panel") return { kind: "panel" };
    if (this.lift.state !== "idle") return null;
    if (this._inCab()) return { kind: "panel" };
    const rec = this.floors.get(cur.floor);
    if (!rec || !rec.plan.elev) return null;
    const l = Level11Gen.toLocal(c.bld, p.x, p.z), fy = this.floorYOf(cur.b, cur.floor);
    if (Math.abs(p.y - fy) < 1.8 && l.x > -4.8 && l.x < -0.4 && l.z > 4.7 && l.z < 8.4 && !(c.floor === cur.floor && c.door.target === 1)) return { kind: "call" };
    return null;
  },
  tryUse() {
    if (!this.active || this._leaving) return false;
    if (this.lift.state === "panel") { this._closePanel(); return true; }
    const T = this._target();
    if (!T) return false;
    if (T.kind === "door") {
      const d = T.d;
      if (d.locked) {
        if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("THE DOOR IS LOCKED");
        if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional) AudioSystem.playPositional("metal", d.x, 1.1, d.z, { gain: 0.18, bus: "events", max: 25 });
        return true;
      }
      this._enterBuilding(d);
      return true;
    }
    if (T.kind === "call") return this.callCab();
    if (T.kind === "panel") { this._openPanel(); return true; }
    return false;
  },
  prompt() {
    const T = this._target();
    if (!T || typeof HUD === "undefined" || !HUD.toast) return;
    if (T.kind === "door") HUD.toast(T.d.locked ? "LOCKED" : T.d.kind === "g" ? "E  OPEN GARAGE DOOR" : "E  ENTER");
    else if (T.kind === "call") HUD.toast("E  CALL LIFT");
    else if (T.kind === "panel" && this.lift.state === "idle") HUD.toast("E  SELECT FLOOR");
  },

  /* ------------------------------------------------------------------ light and look */
  _refreshFixtures() {
    const f = [];
    if (this.mode !== "street" && this.cur) {
      const rec = this.floors.get(this.cur.floor);
      if (rec) for (const x of rec.fixtures) f.push(x);
      const c = this.cab;
      if (c && c.floor === this.cur.floor) f.push({ x: c.cx, y: c.y + 2.2, z: c.cz, base: 3.2, dist: 7, color: 0xfff2d0 });
    }
    this.fixtures = f;
  },
  _aim(snap) {
    const p = Player.position, ranked = [];
    for (const f of this.fixtures) { const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z) + (f.y - p.y - 1.4) * (f.y - p.y - 1.4) * 0.5; if (d < 34 * 34) ranked.push({ f, d }); }
    ranked.sort((a, b) => a.d - b.d);
    this._want = ranked.slice(0, this.pool.length).map(r => r.f);
    for (let i = 0; i < this.pool.length; i++) { const f = this.poolFx[i]; if (f && !this._want.includes(f) && (snap || !this.fixtures.includes(f))) this.poolFx[i] = null; }
    for (const f of this._want) {
      if (this.poolFx.includes(f)) continue;
      const slot = this.poolFx.indexOf(null);
      if (slot < 0) continue;
      const L = this.pool[slot];
      this.poolFx[slot] = f;
      L.position.set(f.x, f.y, f.z); L.distance = f.dist;
      if (L.color && L.color.setHex) L.color.setHex(f.color);
      this._cur[slot] = snap ? f.base : 0;
    }
    if (snap) for (let i = 0; i < this.pool.length; i++) if (!this.poolFx[i]) { this.pool[i].intensity = 0; this._cur[i] = 0; }
  },
  _fadeLights(dt) {
    const k = Math.min(1, dt * 5);
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) { this._cur[i] = 0; this.pool[i].intensity = 0; continue; }
      const on = this._want.includes(f);
      this._cur[i] += ((on ? f.base : 0) - this._cur[i]) * k;
      if (!on && this._cur[i] < 0.05) { this._cur[i] = 0; this.poolFx[i] = null; this.pool[i].intensity = 0; continue; }
      this.pool[i].intensity = this._cur[i];
    }
  },
  // follow the quality profile in force: the sky distance, how far blocks stream, the point-light pool is fixed at entry
  _applyQuality() {
    this._qn = (typeof Quality !== "undefined" && Quality.name) || "high";
    this.BUILD = Math.round(this._streetFar() * 0.9); this.DROP = this.BUILD + 90;
    if (typeof CameraRig !== "undefined" && CameraRig.camera) { CameraRig.camera.far = this._streetFar() + 20; if (CameraRig.camera.updateProjectionMatrix) CameraRig.camera.updateProjectionMatrix(); }
    this._lastIn = -1;                                                    // recompute the fog distances
    this._lastKey = "";                                                   // and the block queue
  },
  _streetFar() { const n = (typeof Quality !== "undefined" && Quality.name) || "high"; return n === "low" ? 170 : n === "medium" ? 220 : 270; },
  _look(dt, snap) {
    const tgt = this.mode === "street" ? 0 : 1;
    this._in = snap ? tgt : this._in + (tgt - this._in) * Math.min(1, dt * 3);
    const t = this._in;
    if (!snap && Math.abs(t - this._lastIn) < 1e-3 && this._lastMode === this.mode) return;
    this._lastIn = t; this._lastMode = this.mode;
    const O = this.OUT, I = this.mode === "garage" ? this.GAR : this.IN, L = (a, b) => a + (b - a) * t, H = (a, b) => this.lerpHex(a, b, t), far = this._streetFar();
    const fog = H(O.fog, I.fog);
    if (scene.fog) { if (scene.fog.color && scene.fog.color.setHex) scene.fog.color.setHex(fog); scene.fog.near = L(far * 0.28, 3); scene.fog.far = L(far * 0.93, 72); }
    const sky = H(O.sky, I.sky);
    if (scene.background && scene.background.setHex) scene.background.setHex(sky); else scene.background = new THREE.Color(sky);
    if (this._hemi) { this._hemi.intensity = L(O.hemi, I.hemi); if (this._hemi.color && this._hemi.color.setHex) this._hemi.color.setHex(H(O.hemiSky, I.hemiSky)); if (this._hemi.groundColor && this._hemi.groundColor.setHex) this._hemi.groundColor.setHex(H(O.hemiGround, I.hemiGround)); }
    if (this._amb) { this._amb.intensity = L(O.ambI, I.ambI); if (this._amb.color && this._amb.color.setHex) this._amb.color.setHex(H(O.amb, I.amb)); }
    if (this._sun) this._sun.intensity = L(O.sun, I.sun);
    if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28 * L(O.exposure, I.exposure);
  },

  /* ------------------------------------------------------------------ lifecycle */
  reset() {
    const wasActive = this.active;
    this._hideUI();
    this._disposeAllFloors();
    this._destroyCab();
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of Array.from(this.blocks.values())) this._disposeBlock(rec);
    this.blocks = new Map(); this.doors = new Map(); this.floors = new Map();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = []; this.poolFx = []; this._cur = []; this._want = [];
    this.fixtures = []; this.exits = [];
    this._queue = []; this._fq = []; this._cur_rec = null; this._cur_floor = null; this._lastKey = ""; this._lastIn = -1; this._lastMode = "";
    this.colliders.length = 0;
    this.group = null; this.active = false; this.cur = null; this.mode = "street"; this.cab = null; this.lift = { state: "idle" };
    this.time = 0; this._in = 0; this._leaving = false; this._ended = false; this._aud = null; this.baseY = 0; this._entryDoor = null; this._doorOpened = false;
    if (wasActive) {
      if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") { CameraRig.camera.far = CONFIG.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
      if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28;
    }
  },
  // from: where the player came from (Level 9's far exit, Level 10's barn): the run continues in the city
  enter(seed, from) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();                 // the reset chain 5 > 6 > 8 > 9 > 10 > 11
    if (typeof Level9 !== "undefined" && Level9.reset) Level9.reset();      // 9 > 10 > 11 hang off one chain; call it from the nearest end
    if (typeof Level10 !== "undefined" && Level10.reset) Level10.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") { SmilerSystem.reset(); SmilerSystem.detach(); }
    if (typeof HoundSystem !== "undefined") { HoundSystem.reset(); HoundSystem.detach(); }
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.seed = seed >>> 0;
    const run = (typeof GameState !== "undefined" && GameState.runId) || 0;
    if (!this.persist || this.persist.seed !== this.seed || this.persist.run !== run) this.persist = { seed: this.seed, run, taken: new Set(), open: new Set(), bld: new Map(), garage: new Map() };
    this.persist.open.clear();                                          // doors are closed when you arrive: no building is entered
    Level11Gen.init(this.seed);
    this.mats();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level11_City";
    scene.add(this.group);
    const O = this.OUT;
    const hemi = new THREE.HemisphereLight(O.hemiSky, O.hemiGround, O.hemi), amb = new THREE.AmbientLight(O.amb, O.ambI), sun = new THREE.DirectionalLight(0xfff0e0, O.sun);
    sun.position.set(80, 150, 60);
    scene.add(hemi, amb, sun);
    this.ambient.push(hemi, amb, sun);
    this._hemi = hemi; this._amb = amb; this._sun = sun;
    const n = Math.max(4, Math.min(this.q().poolSize || 8, 12));
    for (let i = 0; i < n; i++) { const L = new THREE.PointLight(0xfff0d0, 0, 13, 1.6); scene.add(L); this.ambient.push(L); this.pool.push(L); this.poolFx.push(null); this._cur.push(0); }
    scene.fog = new THREE.Fog(O.fog, this._streetFar() * 0.28, this._streetFar() * 0.93);
    this._applyQuality();
    if (typeof Progression !== "undefined") Progression.levelEntered(11);
    GameState.level = 11;
    if (typeof AudioSystem !== "undefined") AudioSystem.setLevel(GameState.level);
    this._aud = "out";
    GameState.seed = this.seed; GameState.phase = "playing"; GameState.cutscene = false; GameState.exitReached = false;
    if (typeof Flashlight !== "undefined") Flashlight.init();
    const S = Level11Gen.spawn(), b0 = Level11Gen.building(0, 0, 0), dx = b0.x - S.x, dz = b0.z - S.z;
    this.baseY = 0;
    this.spawn.set(S.x, 0, S.z);
    this.spawnYaw = Math.atan2(-dx, -dz);
    Player.position.copy(this.spawn); Player.velocity.set(0, 0, 0); Player.onGround = true; Player.yaw = this.spawnYaw; Player.pitch = 0;
    Level.startPos.copy(this.spawn);
    this.infoText = "CITY · " + b0.id;
    this._look(0, true);
    const obj = document.getElementById("hud-obj"); if (obj) obj.textContent = "Objective: explore the city";
    const lvl = document.getElementById("hud-level-label"); if (lvl) lvl.textContent = "LEVEL 11";
    const seedEl = document.getElementById("hud-seed-val"); if (seedEl) seedEl.textContent = String(this.seed);
    if (typeof PickupSystem !== "undefined") { PickupSystem.group = new THREE.Group(); scene.add(PickupSystem.group); }
    this.stream(true, 140);
    this._aim(true);
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("LEVEL 11 · CITY OF CONCRETE");
  },
  // the way out of the anomalous garage: only the designated exit area does this
  _toLevel1() {
    if (this._leaving) return;
    this._leaving = true;
    this._hideUI();
    const sd = this.seed;
    const go = () => {
      if (typeof Level2 !== "undefined") Level2.reset();
      if (typeof Level3 !== "undefined") Level3.reset();
      if (typeof Level4 !== "undefined") Level4.reset();
      this.reset();
      if (typeof Level1 !== "undefined" && Level1.enter) Level1.enter(sd, { origin: { x: 0, z: 0 }, fx: 0, fz: 1 });
    };
    if (typeof VoidTransition !== "undefined" && VoidTransition.then) VoidTransition.then(go); else go();
  },
  _checkExits() {
    const p = Player.position;
    for (const x of this.exits) if (x.kind === "level1" && p.x >= x.x0 && p.x <= x.x1 && p.z >= x.z0 && p.z <= x.z1 && Math.abs(p.y - x.y) < 1.6) return this._toLevel1();
  },
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    if (this._qn !== ((typeof Quality !== "undefined" && Quality.name) || "high")) this._applyQuality();
    if (!this._leaving) this.stream(false);
    this._pumpFloors(this._onStairs());                                  // on the stairs, never let the next floor be unfinished
    this._doors(dt);
    this._lift(dt);
    if (this.cur && !this._doorOpened && this._entryDoor) { const rec = this.floors.get(this.cur.floor); if (rec && rec.done) { this._entryDoor.target = 1; this._doorOpened = true; } }
    this._trackT -= dt;
    if (this._trackT <= 0) {
      this._trackT = 0.15;
      this._trackFloor();
      if (this.mode === "building" && this.cur && this.lift.state === "idle" && this._doorOpened) {
        // unload once the player has been inside and is back out on the street; or if they opened the door and walked away
        if (this._insideFootprint(this.cur.b, -0.3)) this._wasInside = true;
        if (Player.position.y < 4 && !this._insideFootprint(this.cur.b, this._wasInside ? 0.3 : 7)) this._leaveBuilding();
      }
    }
    this._look(dt, false);
    this._lightT -= dt;
    if (this._lightT <= 0) { this._lightT = 0.2; this._aim(false); }
    this._fadeLights(dt);
    if (this._leaving) return;
    this._checkExits();
    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
    if (this.time - (this._syncT || 0) > 0.6) { this._syncT = this.time; for (const rec of this.floors.values()) this._syncTaken(rec); }
  },
  teleportTo(x, z) {
    if (this.mode !== "street") this._leaveBuildingNow();
    Player.position.set(x, 0, z);
    Player.velocity.set(0, 0, 0);
    this.stream(true, 120);
    this._aim(true);
  },
  _leaveBuildingNow() { if (this.cur) { this.lift = { state: "idle" }; this.mode = "street"; this._leaveBuilding(); } },
  // compact persistent state (taken loot, doors, per-building trip counters, discovered garages): JSON-able
  snapshot() {
    const P = this.persist;
    if (!P) return null;
    for (const rec of this.floors.values()) this._syncTaken(rec);
    return { v: 1, seed: P.seed, taken: Array.from(P.taken), bld: Array.from(P.bld.entries()), garage: Array.from(P.garage.keys()) };
  },
  restore(snap) {
    if (!snap || snap.v !== 1) return false;
    this.persist = { seed: snap.seed, run: (typeof GameState !== "undefined" && GameState.runId) || 0, taken: new Set(snap.taken), open: new Set(), bld: new Map(snap.bld), garage: new Map(snap.garage.map(k => [k, true])) };
    return true;
  }
};

// The lift selector listens for keys only while it is open; core.js still owns movement and E.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("keydown", (e) => {
    if (typeof Level11 === "undefined" || !Level11.active || Level11.lift.state !== "panel" || e.code === "KeyE") return;
    if (Level11.panelKey(e.code, e.key)) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}
