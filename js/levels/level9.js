"use strict";

/* Level 9 — The Suburbs. Core: streaming, terrain, lights, lifecycle, transitions.
   Pure generation lives in level9-gen.js. Houses, doors and interiors are in level9-houses.js (a mixin on Level9).
   Entities (Hounds, Smilers, the Mangled, the Watch) are in js/entities/level9-entities.js.

   STREAMING (the Level 8 way, with blocks instead of cave tiles)
     A block is the area between four road lines, 56 to 96 m wide. Blocks within BUILD metres of the player are
     built, one generator step at a time inside a small per-frame time budget; blocks farther than DROP are
     disposed. A block is a pure function of (seed, bi, bj): rebuilding it gives the same houses, trees, lamps and
     signs. What the player changes (doors, fridges, bottles) lives in `persist`, outside the blocks, and is
     re-applied whenever a block or interior is rebuilt.
     A block is a handful of merged meshes (vertex colours, one shared material) plus a few dynamic things:
     door leaves near the player and interior geometry for houses whose door is open.
   Colliders are AABBs. `colliders` is what the player collides with (blocks within COLLIDE). `entColliders` is
   a wider set for entities, with a small spatial grid for point queries (isOpen).
   Light: a fixed pool of 6 point lights re-aimed at the nearest streetlamps and lit rooms. The count never
   changes, so shaders are never rebuilt. */

/* A merged-geometry builder. Everything is non-indexed triangles with vertex colours. `push` sets a local frame
   (house yaw is always a multiple of 90 degrees) so houses are written in their own coordinates. */
class L9Builder {
  static get _S() { return L9Builder.__S || (L9Builder.__S = new Float64Array(24)); }
  constructor() { this.p = []; this.n = []; this.c = []; this.pop(); }
  push(theta, ox, oz) { this.cs = Math.round(Math.cos(theta)); this.sn = Math.round(Math.sin(theta)); this.ox = ox; this.oz = oz; }
  pop() { this.cs = 1; this.sn = 0; this.ox = 0; this.oz = 0; }
  get count() { return this.p.length / 3; }
  _v(x, y, z) { return [this.ox + x * this.cs + z * this.sn, y, this.oz - x * this.sn + z * this.cs]; }
  tri(a, b, c, col, ref) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ref) {
      const fx = (a[0] + b[0] + c[0]) / 3 - ref[0], fy = (a[1] + b[1] + c[1]) / 3 - ref[1], fz = (a[2] + b[2] + c[2]) / 3 - ref[2];
      if (nx * fx + ny * fy + nz * fz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
  }
  quad(a, b, c, d, col, ref) { this.tri(a, b, c, col, ref); this.tri(a, c, d, col, ref); }
  // axis-aligned in the local frame, optionally yawed about its own centre by ry. The bottom face is skipped.
  // Hot path (every wall, window and piece of furniture): no temporary arrays, it writes straight into p/n/c.
  box(cx, cy, cz, sx, sy, sz, col, ry) {
    const S = L9Builder._S, hx = sx / 2, hy = sy / 2, hz = sz / 2, co = ry ? Math.cos(ry) : 1, si = ry ? Math.sin(ry) : 0;
    const cs = this.cs, sn = this.sn, ox = this.ox, oz = this.oz;
    for (let k = 0; k < 8; k++) {
      const dx = (k & 4) ? hx : -hx, dy = (k & 2) ? hy : -hy, dz = (k & 1) ? hz : -hz;
      const lx = cx + dx * co + dz * si, lz = cz - dx * si + dz * co;
      S[k * 3] = ox + lx * cs + lz * sn; S[k * 3 + 1] = cy + dy; S[k * 3 + 2] = oz - lx * sn + lz * cs;
    }
    const rx = ox + cx * cs + cz * sn, rz = oz - cx * sn + cz * cs;
    // corner index = x*4 + y*2 + z
    this._face(S, 4, 6, 7, 5, col, rx, cy, rz);   // +x
    this._face(S, 0, 2, 3, 1, col, rx, cy, rz);   // -x
    this._face(S, 2, 6, 7, 3, col, rx, cy, rz);   // +y
    this._face(S, 1, 5, 7, 3, col, rx, cy, rz);   // +z
    this._face(S, 0, 4, 6, 2, col, rx, cy, rz);   // -z
  }
  _face(S, a, b, c, d, col, rx, ry, rz) {
    const ax = S[a * 3], ay = S[a * 3 + 1], az = S[a * 3 + 2], bx = S[b * 3], by = S[b * 3 + 1], bz = S[b * 3 + 2];
    const cx = S[c * 3], cy = S[c * 3 + 1], cz = S[c * 3 + 2], dx = S[d * 3], dy = S[d * 3 + 1], dz = S[d * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = dx - ax, vy = dy - ay, vz = dz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const flip = nx * ((ax + cx) / 2 - rx) + ny * ((ay + cy) / 2 - ry) + nz * ((az + cz) / 2 - rz) < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const p = this.p, n = this.n, k = this.c, r = col[0], g = col[1], bl = col[2];
    // triangles (a,b,c) (a,c,d), reversed when the face points inward
    const t = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (let i = 0; i < 6; i++) {
      const q = t[i] * 3;
      p.push(S[q], S[q + 1], S[q + 2]); n.push(nx, ny, nz); k.push(r, g, bl);
    }
  }
  // low-poly cone / spruce layer
  cone(cx, cy, cz, r, h, sides, col) {
    const apex = this._v(cx, cy + h, cz), ref = this._v(cx, cy + h * 0.3, cz);
    const ring = [];
    for (let i = 0; i < sides; i++) { const a = i / sides * Math.PI * 2; ring.push(this._v(cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r)); }
    for (let i = 0; i < sides; i++) this.tri(ring[i], ring[(i + 1) % sides], apex, col, ref);
  }
  // a blobby canopy: an octahedron-ish lump
  lump(cx, cy, cz, rx, ry, rz, col) {
    const T = this._v(cx, cy + ry, cz), Bt = this._v(cx, cy - ry * 0.5, cz), ref = this._v(cx, cy, cz);
    const ring = [];
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.3; ring.push(this._v(cx + Math.cos(a) * rx, cy + ry * 0.15, cz + Math.sin(a) * rz)); }
    for (let i = 0; i < 6; i++) { this.tri(ring[i], ring[(i + 1) % 6], T, col, ref); this.tri(ring[(i + 1) % 6], ring[i], Bt, col, ref); }
  }
  clear() { this.p.length = 0; this.n.length = 0; this.c.length = 0; }
}

const Level9 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],          // the player's
  entColliders: [],       // wider, for entities
  blocks: new Map(),      // "bi,bj" -> rec
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  baseY: 0,
  exitPos: null,          // beside the nearest real exit (console)
  backPos: null,
  infoText: "",
  time: 0,
  stepTol: 0.34,          // the one physics change: boxes this low are stepped onto (stairs, kerbs). player.js reads it
  BUILD: 42,              // build blocks closer than this (distance to the block's rectangle). Fog is gone by 21 m
  DROP: 78,
  COLLIDE: 28,
  ENT: 80,
  BUDGET: 3.5,            // ms of block building per frame
  look: { ambient: 1.05, hemi: 0.85, moon: 0.9, fog: 0x1c1e1d, fogNear: 8, fogFar: 38, poolSize: 6, exposure: 1.15 },
  flashRange: 0.5,
  flashPower: 0.5,
  persist: null,
  fixtures: [],
  pool: [], poolFx: [], _cur: [], _want: [],
  ambient: [],
  exits: [],
  _queue: [], _lastKey: "", _lightT: 0, _promptT: 0, _intT: 0, _ended: false, _flashSet: false, _leaving: false,
  _grid: null,
  _colT: 0,
  _ambT: [6, 30, 40],

  /* ------------------------------------------------------------------
     MATERIALS AND COLOURS
     ------------------------------------------------------------------ */
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
      doors: new Map(),
      handle: new THREE.MeshStandardMaterial({ color: 0x8a8a80, roughness: 0.5, metalness: 0.5 }),
      fridge: new THREE.MeshStandardMaterial({ color: 0x6a6e70, roughness: 0.6, metalness: 0.2 })
    };
    this.unit = new THREE.BoxGeometry(1, 1, 1);
    return this.M;
  },
  doorMat(hex) {
    const M = this.mats();
    let m = M.doors.get(hex);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9, metalness: 0 }); M.doors.set(hex, m); }
    return m;
  },

  /* ------------------------------------------------------------------
     BLOCK RECORDS
     ------------------------------------------------------------------ */
  newRec(bi, bj) {
    return {
      key: bi + "," + bj, bi, bj, B: Level9Gen.block(bi, bj), group: new THREE.Group(), geos: [], colliders: [], fixtures: [],
      houses: [], lit: new L9Builder(), emi: new L9Builder(), rects: [], exits: [], lamps: [], critters: null,
      gen: null, done: false, dist: 0
    };
  },
  collider(rec, x0, y0, z0, x1, y1, z1, tag) {
    const c = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
    if (tag) c.tag = tag;
    rec.colliders.push(c);
    return c;
  },
  // flush the builders into meshes
  flush(rec) {
    const M = this.mats();
    for (const [b, mat] of [[rec.lit, M.lit], [rec.emi, M.emi]]) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      rec.group.add(m);
      rec.geos.push(g);
      b.clear();
    }
  },

  _blockDist(B, px, pz) {
    return Math.hypot(Math.max(0, B.x0 - px, px - B.x1), Math.max(0, B.z0 - pz, pz - B.z1));
  },

  /* ------------------------------------------------------------------
     BLOCK BUILD (a generator: one yield per chunk of work)
     ------------------------------------------------------------------ */
  *_buildBlock(rec) {
    const G = Level9Gen, B = rec.B;
    this._terrain(rec);
    this.flush(rec);
    yield;
    this._lampsAndSigns(rec);
    yield;
    this._specialLots(rec);
    this.flush(rec);
    yield;
    let n = 0;
    for (const lot of B.lots) {
      if (lot.kind !== "house") continue;
      yield* this._house(rec, lot);                       // a house is three steps
      if (++n % 3 === 0) { this.flush(rec); yield; }       // the flush (typed arrays) is a step of its own
    }
    this.flush(rec);
    yield;
    for (const lot of B.lots) { this._yard(rec, lot); yield; }
    this._spawnMound(rec);
    this.flush(rec);
    // critter spawn points are decided by the generator, read by the entity layer
    rec.critters = G.blockCritters(rec.bi, rec.bj);
    rec.done = true;
  },

  _terrain(rec) {
    const G = Level9Gen, B = rec.B, b = rec.lit, bi = rec.bi, bj = rec.bj;
    const w = B.x1 - B.x0, d = B.z1 - B.z0;
    const g = [0x1c2a1c, 0x1f2d1e, 0x1a271a, 0x20291b][(bi * 3 + bj * 5 & 3 + 4) % 4];
    b.box(B.cx, -0.25, B.cz, w, 0.5, d, this.col(0x1b281b), 0);
    // lawn patches per lot band
    for (const lot of B.lots) {
      const k = 0.9 + G.lh(lot, 61) * 0.25;
      const px = lot.nx !== 0 ? 19 : lot.w, pz = lot.nx !== 0 ? lot.w : 19;
      const c = G.lotPoint(lot, 9.5, 0);
      b.box(c.x, 0.006, c.z, px, 0.012, pz, this.col(g, k), 0);
    }
    const asphalt = 0x131416;
    // road along x on the south side (segment owned by this block), and along z on the west side
    const rwS = B.rw[0], rwW = B.rw[3];
    const shade = (a, c) => 0.9 + G.hash(a, c, 62) * 0.2;
    if (B.roads[0]) {
      b.box(B.cx, 0.015, B.z0, w + 0.0, 0.03, rwS * 2, this.col(asphalt, shade(bi, bj)), 0);
      if (G.arterialH(bj)) this._dashes(b, B.x0 + rwW, B.x1 - B.rw[1], B.z0, true);
    }
    if (B.roads[3]) {
      b.box(B.x0, 0.015, B.cz, rwW * 2, 0.03, d, this.col(asphalt, shade(bj, bi)), 0);
      if (G.arterialV(bi)) this._dashes(b, B.z0 + rwS, B.z1 - B.rw[2], B.x0, false);
    }
    // the intersection pad at this block's south-west corner
    {
      const any = B.roads[0] || B.roads[3] || G.segH(bi - 1, bj) || G.segV(bi, bj - 1);
      if (any) b.box(B.x0, 0.016, B.z0, B.rw[3] * 2, 0.03, B.rw[0] * 2, this.col(asphalt, shade(bi + 1, bj + 1)), 0);
    }
    // sidewalks along each side that has a road
    const sw = G.SW, cw = 0x403f3b;
    if (B.roads[0]) b.box((B.ix0 + B.ix1) / 2, 0.03, B.iz0 - sw / 2, B.ix1 - B.ix0, 0.06, sw, this.col(cw), 0);
    if (B.roads[2]) b.box((B.ix0 + B.ix1) / 2, 0.03, B.iz1 + sw / 2, B.ix1 - B.ix0, 0.06, sw, this.col(cw), 0);
    if (B.roads[3]) b.box(B.ix0 - sw / 2, 0.03, (B.iz0 + B.iz1) / 2, sw, 0.06, B.iz1 - B.iz0, this.col(cw), 0);
    if (B.roads[1]) b.box(B.ix1 + sw / 2, 0.03, (B.iz0 + B.iz1) / 2, sw, 0.06, B.iz1 - B.iz0, this.col(cw), 0);
  },

  _dashes(b, a0, a1, line, alongX) {
    const col = this.col(0x6b6128);
    for (let t = a0 + 3; t < a1 - 3; t += 6) {
      if (alongX) b.box(t, 0.035, line, 2.4, 0.01, 0.16, col, 0);
      else b.box(line, 0.035, t, 0.16, 0.01, 2.4, col, 0);
    }
  },

  _lampsAndSigns(rec) {
    const G = Level9Gen, B = rec.B, b = rec.lit, e = rec.emi;
    const pole = this.col(0x2b2d2f);
    for (const L of G.blockLamps(B)) {
      // pole and an arm reaching toward the road
      const toward = L.side === 0 ? [0, -1] : L.side === 2 ? [0, 1] : L.side === 3 ? [-1, 0] : [1, 0];
      b.box(L.x, 2.6, L.z, 0.16, 5.2, 0.16, pole, 0);
      const ax = L.x + toward[0] * 0.6, az = L.z + toward[1] * 0.6;
      b.box(ax, 5.15, az, toward[0] ? 1.2 : 0.1, 0.1, toward[1] ? 1.2 : 0.1, pole, 0);
      const hx = L.x + toward[0] * 1.15, hz = L.z + toward[1] * 1.15;
      const dead = L.status === "dead";
      (dead ? b : e).box(hx, 5.05, hz, 0.55, 0.14, 0.3, dead ? this.col(0x1a1a1a) : this.col(0xffa94d), dead ? 0.35 : 0);
      this.collider(rec, L.x - 0.1, 0, L.z - 0.1, L.x + 0.1, 5.2, L.z + 0.1, "lamp");
      const rec2 = { x: hx, z: hz, status: L.status };
      rec.lamps.push(rec2);
      if (!dead) rec.fixtures.push({ x: hx, y: 4.8, z: hz, base: 17, dist: 24, color: 0xffa24a, ph: L.ph, kind: "lamp", flick: L.status === "flicker", on: true, lamp: rec2 });
    }
    // street-name sign at this block's south-west corner
    if (G.hash(rec.bi, rec.bj, 71) < 0.6) {
      const sx = B.x0 + B.rw[3] + 0.9, sz = B.z0 + B.rw[0] + 0.9;
      b.box(sx, 1.3, sz, 0.08, 2.6, 0.08, pole, 0);
      b.box(sx, 2.55, sz, 0.9, 0.2, 0.04, this.col(0x1f4a35), 0);
      b.box(sx, 2.55, sz + 0.03, 0.62, 0.05, 0.02, this.col(0x8a8f86), 0);
      b.box(sx + 0.45, 2.15, sz, 0.04, 0.2, 0.9, this.col(0x1f4a35), 0);
      this.collider(rec, sx - 0.06, 0, sz - 0.06, sx + 0.06, 2.6, sz + 0.06, "sign");
    }
    // arrow signs on the segments this block owns (south H, west V)
    for (const [axis, i, j] of [["H", rec.bi, rec.bj], ["V", rec.bi, rec.bj]]) {
      for (const s of G.segmentSigns(axis, i, j)) this._arrowSign(rec, s);
    }
  },

  _arrowSign(rec, s) {
    const b = rec.lit, e = rec.emi, ux = s.dx, uz = s.dz;
    const post = this.col(0x2b2d2f), y = 2.0, ry = Math.atan2(-uz, ux);
    b.box(s.x, 1.1, s.z, 0.08, 2.2, 0.08, post, 0);
    b.box(s.x, y, s.z, 1.1, 0.8, 0.05, this.col(s.real ? 0x8f7c24 : 0x8a7a30), ry);
    // the arrow: a shaft and a head, in black, a hair in front of the panel
    const n = [s.nx, s.nz], f = 0.04;
    const P = (u, v) => [s.x + ux * u + n[0] * f, y + v, s.z + uz * u + n[1] * f];
    const ref = [s.x - n[0] * 2, y, s.z - n[1] * 2], k = this.col(0x0c0c0a);
    b.quad(P(-0.4, -0.06), P(0.12, -0.06), P(0.12, 0.06), P(-0.4, 0.06), k, ref);
    b.tri(P(0.1, -0.24), P(0.42, 0), P(0.1, 0.24), k, ref);
    if (s.real) e.box(s.x, y + 0.44, s.z, 1.1, 0.03, 0.05, this.col(0xb8741f, 0.8), ry);     // a faint amber edge
    this.collider(rec, s.x - 0.06, 0, s.z - 0.06, s.x + 0.06, 2.2, s.z + 0.06, "sign");
  },

  /* ------------------------------------------------------------------
     SPECIAL LOTS: the way back, field breaks, the Level 11 culvert
     ------------------------------------------------------------------ */
  _specialLots(rec) {
    const G = Level9Gen, b = rec.lit, e = rec.emi;
    for (const lot of rec.B.lots) {
      if (!lot.special) continue;
      const p = G.exitPoint(lot), theta = Math.atan2(lot.nx, lot.nz);
      if (lot.special === "hole8") {
        const r = G.trng(lot.bi, lot.bj, 311);
        b.box(p.x, 0.045, p.z, 3.4, 0.01, 3.4, this.col(0x010101), 0);
        b.box(p.x, 0.02, p.z, 4.6, 0.04, 4.6, this.col(0x2a2118), 0);
        for (let i = 0; i < 9; i++) {
          const a = i / 9 * Math.PI * 2 + r() * 0.3, rr = 2.5 + r() * 0.5, h = 0.35 + r() * 0.5, s = 0.7 + r() * 0.5;
          const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
          b.box(x, h / 2, z, s, h, s * 0.8, this.col(0x4c4a45, 0.85 + r() * 0.3), r() * 3);
          this.collider(rec, x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2, "rock");
        }
        rec.exits.push({ kind: "level8", x: p.x, z: p.z, r: 1.5 });
        rec.fixtures.push({ x: p.x, y: 1.4, z: p.z, base: 5, dist: 11, color: 0x8aa0b8, ph: 1.1, kind: "exit", on: true });
      } else if (lot.special === "field10") {
        const r = G.trng(lot.bi, lot.bj, 312);
        b.push(theta, p.x, p.z);
        const path = this.col(0x3a3626);
        b.box(0, 0.02, 6.5, 2.6, 0.02, 13, path, 0);          // the worn path from the road
        for (let i = 0; i < 150; i++) {                      // wheat
          const x = (r() - 0.5) * 9, z = -3.2 + r() * 6.2;
          if (z > -0.4 && Math.abs(x) < 1.5 && z > 1.5) continue;
          const h = 0.8 + r() * 0.5;
          b.box(x, h / 2, z, 0.07, h, 0.07, this.col(r() < 0.5 ? 0x6b6a2c : 0x59592a, 0.8 + r() * 0.3), r() * 3);
        }
        for (const sx of [-1.7, 1.7]) b.box(sx, 0.6, 9.5, 0.1, 1.2, 0.1, this.col(0x3a3128), 0);
        b.pop();
        rec.exits.push({ kind: "level10", x: p.x, z: p.z, r: 2.0, nx: lot.nx, nz: lot.nz });
        rec.fixtures.push({ x: p.x, y: 1.6, z: p.z, base: 3.5, dist: 10, color: 0xd8c27a, ph: 2.2, kind: "exit", on: true });
      } else if (lot.special === "exit11") {
        b.push(theta, p.x, p.z);
        const W = 0x5a5a56, K = 0x050505;
        // a concrete culvert mouth, opening toward +z (the road)
        b.box(-2.0, 1.6, 0, 1.0, 3.2, 3.4, this.col(W), 0);
        b.box(2.0, 1.6, 0, 1.0, 3.2, 3.4, this.col(W), 0);
        b.box(0, 2.9, 0, 5.0, 0.6, 3.4, this.col(W), 0);
        b.box(0, 1.0, -0.8, 3.0, 2.0, 1.6, this.col(K), 0);
        for (let i = 0; i < 6; i++) b.box(-2.0 + (i % 2 ? 0.5 : 0), 0.25 + i * 0.5, 1.72, 0.4, 0.22, 0.04, this.col(i % 2 ? 0x9a7d1f : 0x15130f), 0);
        b.box(0, 0.02, 4.5, 3.2, 0.02, 7, this.col(0x2a2926), 0);
        b.pop();
        const cs = Math.round(Math.cos(theta)), sn = Math.round(Math.sin(theta));
        const loc = (lx, lz) => ({ x: p.x + lx * cs + lz * sn, z: p.z - lx * sn + lz * cs });
        const wall = (lx0, lz0, lx1, lz1, y1) => {
          const a = loc(lx0, lz0), c = loc(lx1, lz1);
          this.collider(rec, Math.min(a.x, c.x), 0, Math.min(a.z, c.z), Math.max(a.x, c.x), y1, Math.max(a.z, c.z), "culvert");
        };
        wall(-2.5, -1.7, -1.5, 1.7, 3.2);          // left pier
        wall(1.5, -1.7, 2.5, 1.7, 3.2);            // right pier
        wall(-1.5, -1.7, 1.5, -1.6, 3.2);          // the back of the opening, so nothing walks into the void
        const m = loc(0, -0.2);
        rec.exits.push({ kind: "level11", x: m.x, z: m.z, r: 1.6 });
        const lp = loc(0, 2.2);
        rec.fixtures.push({ x: lp.x, y: 2.4, z: lp.z, base: 8, dist: 14, color: 0xff3a2a, ph: 0.4, kind: "exit", on: true, flick: true });
        e.box(lp.x, 2.6, lp.z, 0.3, 0.2, 0.3, this.col(0xd02a1a), 0);
      }
    }
  },

  // The sealed hole the player climbed out of: a rock-capped mound behind the spawn
  _spawnMound(rec) {
    if (rec.bi !== 0 || rec.bj !== 0) return;
    const S = Level9Gen.spawnInfo(), b = rec.lit;
    b.box(S.mx, 0.12, S.mz, 2.6, 0.24, 2.6, this.col(0x2a2118), 0);
    b.box(S.mx, 0.36, S.mz, 1.9, 0.26, 1.9, this.col(0x4c4a45), 0.3);
    b.box(S.mx + 0.5, 0.62, S.mz - 0.3, 0.8, 0.5, 0.7, this.col(0x57544e), 0.8);
    b.box(S.mx - 0.4, 0.58, S.mz + 0.4, 0.7, 0.42, 0.6, this.col(0x45433d), -0.4);
    this.collider(rec, S.mx - 1.2, 0, S.mz - 1.2, S.mx + 1.2, 0.8, S.mz + 1.2, "mound");
    rec.sealed = { x: S.mx, z: S.mz };
  },

  /* ------------------------------------------------------------------
     STREAMING
     ------------------------------------------------------------------ */
  _plan(px, pz) {
    const G = Level9Gen, bi = G.indexAt(px, 0), bj = G.indexAt(pz, 1), q = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = bi + di, j = bj + dj, key = i + "," + j;
      if (this.blocks.has(key)) continue;
      const dd = this._blockDist(G.block(i, j), px, pz);
      if (dd < this.BUILD) q.push({ d: dd, i, j, key });
    }
    q.sort((a, c) => a.d - c.d);
    this._queue = q.filter(it => !this._pending || !this._pending.has(it.key));
    for (const rec of Array.from(this.blocks.values())) if (this._blockDist(rec.B, px, pz) > this.DROP) this._disposeBlock(rec);
  },

  _disposeBlock(rec) {
    for (const h of rec.houses) this._disposeHouse(h);
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos) g.dispose();
    rec.disposed = true;
    this.blocks.delete(rec.key);
    if (this._pending) this._pending.delete(rec.key);
    this._dirty = true;
  },

  stream(force) {
    if (!this.active || !this.group || this._leaving) return;
    const p = Player.position, key = Math.floor(p.x / 8) + "," + Math.floor(p.z / 8);
    if (force || key !== this._lastKey) { this._lastKey = key; this._plan(p.x, p.z); }
    const t0 = performance.now();
    let guard = 0;
    for (;;) {
      if (++guard > 5000) break;
      if (!this._cur_rec) {
        const it = this._queue.shift();
        if (!it) break;
        if (this.blocks.has(it.key)) continue;
        const rec = this.newRec(it.i, it.j);
        rec.gen = this._buildBlock(rec);
        this.blocks.set(rec.key, rec);
        this.group.add(rec.group);
        this._cur_rec = rec;
      }
      const rec = this._cur_rec, r = rec.gen.next();
      this._dirty = true;
      if (r.done) { this._cur_rec = null; rec.gen = null; }
      if (!force && performance.now() - t0 > this.BUDGET) break;
    }
    if (this._cur_rec && this._cur_rec.disposed) this._cur_rec = null;
    if (this._dirty) { this._dirty = false; this._collect(); }
  },

  _collect() {
    const p = Player.position, a = this.colliders, e = this.entColliders;
    a.length = 0; e.length = 0;
    this.fixtures = [];
    this.exits = [];
    const grid = new Map();
    const put = (c) => {
      const x0 = Math.floor(c.min.x / 8), x1 = Math.floor(c.max.x / 8), z0 = Math.floor(c.min.z / 8), z1 = Math.floor(c.max.z / 8);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const k = x + "," + z; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(c); }
    };
    for (const rec of this.blocks.values()) {
      rec.dist = this._blockDist(rec.B, p.x, p.z);
      for (const f of rec.fixtures) this.fixtures.push(f);
      for (const x of rec.exits) this.exits.push(x);
      const near = rec.dist < this.COLLIDE, far = rec.dist < this.ENT;
      const add = (c) => { if (near) a.push(c); if (far) { e.push(c); put(c); } };
      for (const c of rec.colliders) add(c);
      for (const h of rec.houses) {
        if (h.door && h.door.collider) add(h.door.collider);
        const I = h.interior;
        if (I) { for (const c of I.colliders) add(c); for (const f of I.fixtures) this.fixtures.push(f); }
      }
    }
    this._grid = grid;
  },

  // Is a body of radius r at (x, z) clear of everything between y0 and y1? (entities)
  isOpen(x, z, r, y0, y1) {
    const g = this._grid;
    if (!g) return false;
    r = r || 0.35; y0 = y0 == null ? 0.6 : y0; y1 = y1 == null ? 0.7 : y1;
    const cx0 = Math.floor((x - r) / 8), cx1 = Math.floor((x + r) / 8), cz0 = Math.floor((z - r) / 8), cz1 = Math.floor((z + r) / 8);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const l = g.get(cx + "," + cz);
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (c.max.y <= y0 || c.min.y >= y1) continue;
        if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return false;
      }
    }
    // only where blocks are loaded
    return this.blocks.has(Level9Gen.indexAt(x, 0) + "," + Level9Gen.indexAt(z, 1));
  },

  /* ------------------------------------------------------------------
     LIGHT
     ------------------------------------------------------------------ */
  // 0..1: how lit a ground point is by the world (lamps, lit rooms). The flashlight is separate.
  lightAt(x, z) {
    let lv = 0;
    for (const f of this.fixtures) {
      if (!f.on || f.kind === "exit") continue;
      const d = Math.hypot(f.x - x, f.z - z), R = f.kind === "lamp" ? 13 : 6;
      if (d >= R) continue;
      const k = (1 - d / R) * (f.kind === "lamp" ? 1.15 : 0.7) * (f.lamp && f.lamp.status === "flicker" ? (f._lv == null ? 1 : f._lv) : 1);
      if (k > lv) lv = k;
    }
    return Math.min(1, lv);
  },
  // is (x, z) inside the player's flashlight cone?
  flashAt(x, z) {
    if (typeof Flashlight === "undefined" || !Flashlight.enabled) return false;
    const P = Player.position, dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d > CONFIG.flashlight.distance * this.flashRange || d < 0.3) return false;
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    return (fx * dx + fz * dz) / d > Math.cos(CONFIG.flashlight.angle * 0.9);
  },

  _aim(snap) {
    const p = Player.position, want = [];
    const ranked = [];
    for (const f of this.fixtures) {
      if (!f.on) continue;
      const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z);
      if (d < 38 * 38) ranked.push({ f, d });
    }
    ranked.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length && i < ranked.length; i++) want.push(ranked[i].f);
    this._want = want;
    for (let i = 0; i < this.pool.length; i++) { const f = this.poolFx[i]; if (f && !want.includes(f) && (snap || !this.fixtures.includes(f))) this.poolFx[i] = null; }
    for (const f of want) {
      if (this.poolFx.includes(f)) continue;
      let slot = this.poolFx.indexOf(null);
      if (slot < 0 && snap) slot = this.poolFx.findIndex(x => !want.includes(x));
      if (slot < 0) continue;
      this._load(slot, f, snap);
    }
    if (snap) for (let i = 0; i < this.pool.length; i++) { if (!this.poolFx[i]) { this.pool[i].intensity = 0; this._cur[i] = 0; } else this._cur[i] = this.poolFx[i].base; }
  },
  _load(slot, f, snap) {
    const L = this.pool[slot];
    this.poolFx[slot] = f;
    L.position.set(f.x, f.y, f.z);
    L.distance = f.dist;
    if (L.color && L.color.setHex) L.color.setHex(f.color);
    if (!snap) this._cur[slot] = 0;
  },
  _fadeLights(dt) {
    const k = Math.min(1, dt * 5), want = this._want || [];
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) continue;
      const on = want.includes(f) && f.on;
      let flick = 1;
      if (f.flick) {                                       // a bad tube: mostly steady, now and then a stutter
        const t = this.time * 1.0 + f.ph, s = Math.sin(t * 17.0) * Math.sin(t * 5.3) + Math.sin(t * 0.7);
        flick = s > 1.0 ? 0.15 : s > 0.8 ? 0.6 : 1;
        f._lv = flick;
      }
      this._cur[i] += ((on ? f.base : 0) - this._cur[i]) * k;
      if (!on && this._cur[i] < 0.05) {
        this._cur[i] = 0; this.poolFx[i] = null; this.pool[i].intensity = 0;
        const next = want.find(w => !this.poolFx.includes(w));
        if (next) this._load(i, next, false);
        continue;
      }
      this.pool[i].intensity = this._cur[i] * flick * (0.97 + 0.03 * Math.sin(this.time * 1.3 + f.ph));
    }
  },

  /* ------------------------------------------------------------------
     FLASHLIGHT: half range, half strength
     ------------------------------------------------------------------ */
  _flashLimit() {
    if (typeof Flashlight === "undefined" || !Flashlight.light || typeof CONFIG === "undefined") return;
    const want = CONFIG.flashlight.distance * this.flashRange;
    if (Flashlight.light.distance !== want) Flashlight.light.distance = want;
    if (Flashlight.enabled) Flashlight.light.intensity = CONFIG.flashlight.intensity * this.flashPower;
    this._flashSet = true;
  },
  _flashRestore() {
    if (!this._flashSet) return;
    this._flashSet = false;
    if (typeof Flashlight !== "undefined" && Flashlight.light && typeof CONFIG !== "undefined") {
      Flashlight.light.distance = CONFIG.flashlight.distance;
      if (Flashlight.enabled) Flashlight.light.intensity = CONFIG.flashlight.intensity;
    }
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    const wasActive = this.active;
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of this.blocks.values()) { for (const h of rec.houses) this._disposeHouse(h); for (const g of rec.geos) g.dispose(); }
    this.blocks = new Map();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = []; this.poolFx = []; this._cur = []; this._want = [];
    this.fixtures = []; this.exits = [];
    this._queue = []; this._cur_rec = null; this._lastKey = ""; this._grid = null;
    this.colliders.length = 0; this.entColliders.length = 0;
    this.group = null;
    this.active = false;
    this.time = 0;
    this._leaving = false; this._ended = false;
    this.exitPos = null; this.backPos = null;
    this._flashRestore();
    if (typeof Level9Entities !== "undefined") Level9Entities.reset();
    if (typeof Level10 !== "undefined" && Level10.reset) Level10.reset();      // Level 10 hangs off this reset chain
    if (wasActive) {
      if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") { CameraRig.camera.far = CONFIG.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
      if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28;
    }
  },

  enter(seed, from, at) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();      // also clears Levels 5, 6 and 8
    if (typeof Level5 !== "undefined") Level5.reset();
    if (typeof Level6 !== "undefined") Level6.reset();
    if (typeof Level8 !== "undefined") Level8.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") { SmilerSystem.reset(); SmilerSystem.detach(); }
    if (typeof HoundSystem !== "undefined") { HoundSystem.reset(); HoundSystem.detach(); }
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.seed = seed >>> 0;
    // what the player changed survives leaving and coming back, but not a new run or another seed
    const el = (typeof GameState !== "undefined" && GameState.elapsed) || 0;
    const run = (typeof GameState !== "undefined" && GameState.runId) || 0;
    if (!this.persist || this.persist.seed !== this.seed || this.persist.run !== run || el < this.persist.t) this.persist = { seed: this.seed, run, t: 0, open: new Set(), taken: new Set(), fridge: new Set() };
    Level9Gen.init(this.seed);
    this.mats();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level9_Suburbs";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0x5a6c7a, 0x1a2218, lk.hemi);
    const amb = new THREE.AmbientLight(0x66707a, lk.ambient);
    const moon = new THREE.DirectionalLight(0x8396ad, lk.moon);
    moon.position.set(-30, 60, -20);
    scene.add(hemi, amb, moon);
    this.ambient.push(hemi, amb, moon);
    this._hemi = hemi; this._amb = amb; this._moon = moon;
    for (let i = 0; i < lk.poolSize; i++) {
      const L = new THREE.PointLight(0xffa24a, 0, 22, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L); this.poolFx.push(null); this._cur.push(0);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 46; CameraRig.camera.updateProjectionMatrix(); }
    if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28 * lk.exposure;
    GameState.level = 9;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    if (typeof Flashlight !== "undefined") Flashlight.init();
    this._flashLimit();
    const S = Level9Gen.spawnInfo();
    let sx = S.x, sz = S.z, syaw = S.yaw;
    if (from === "level10") {            // back out of the field: on the worn path, a few metres from the wheat, facing the road
      const f = at || Level9Gen.exitList().filter(e => e.kind === "level10").sort((a, b) => a.dist - b.dist)[0];
      if (f && f.nx != null) { sx = f.x + f.nx * 4; sz = f.z + f.nz * 4; syaw = Math.atan2(-f.nx, -f.nz); }
    }
    this.spawn.set(sx, this.baseY, sz);
    this.spawnYaw = syaw;
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = this.spawnYaw;
    Player.pitch = 0;
    const ex = Level9Gen.exitList().filter(e => e.kind === "level10")[0] || null;
    this.exitPos = ex ? new THREE.Vector3(ex.x, this.baseY, ex.z) : null;
    this.exitInfo = ex;
    const hole = Level9Gen.exitList().filter(e => e.kind === "level8")[0];
    this.backPos = hole ? new THREE.Vector3(hole.x, this.baseY, hole.z) : null;
    this.infoText = "SUBURBS" + (ex ? " · NEAREST FIELD ~" + Math.round(ex.dist) + "m" : "");
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find a way on";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 9";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    if (typeof PickupSystem !== "undefined") { PickupSystem.group = new THREE.Group(); scene.add(PickupSystem.group); }
    this.stream(true);
    this._aim(true);
    if (typeof Level9Entities !== "undefined") Level9Entities.attach(this);
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    if (typeof HUD !== "undefined" && from !== "level10") HUD.toast("LEVEL 9 · THE SUBURBS");
  },

  /* ------------------------------------------------------------------
     TRANSITIONS
     ------------------------------------------------------------------ */
  _remember() { if (this.persist) this.persist.t = (typeof GameState !== "undefined" && GameState.elapsed) || 0; },

  goBack() {
    if (this._leaving) return;
    this._leaving = true;
    this._remember();
    const sd = this.seed;
    setTimeout(() => {
      const go = () => { if (typeof Level8 !== "undefined") Level8.enter(sd, 9); };
      if (typeof VoidTransition !== "undefined") VoidTransition.then(go); else go();
    }, 0);
  },

  // The field break: walk in, and you are in Level 10. No Void, no fade. Level 9 is torn down and rebuilt if you come back
  toField(x) {
    if (this._leaving) return;
    if (typeof Level10 === "undefined" || !Level10.enter) return this.finish(10);
    this._leaving = true;
    this._remember();
    Level10.enter(this.seed, "level9", x);
  },

  // Level 11 is not built yet: the run ends here for now
  finish(which) {
    if (this._ended) return;
    this._ended = true;
    this._leaving = true;
    this._remember();
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("LEVEL " + which + " IS NOT BUILT YET");
    GameState.exitReached = true;
    const done = () => {
      if (typeof Game !== "undefined" && Game.complete) Game.complete();
      setTimeout(() => { if (GameState.phase === "complete" && document.pointerLockElement) document.exitPointerLock(); }, 2000);
    };
    if (typeof VoidTransition !== "undefined") VoidTransition.then(done); else done();
  },

  _checkExits() {
    const p = Player.position;
    if (p.y > this.baseY + 0.9) return;
    for (const x of this.exits) {
      if (Math.hypot(p.x - x.x, p.z - x.z) > x.r) continue;
      if (x.kind === "level8") return this.goBack();
      if (x.kind === "level10") return this.toField(x);
      if (x.kind === "level11") return this.finish(11);
    }
  },

  /* ------------------------------------------------------------------
     AMBIENCE: sparse. Silence and distance matter more than noise.
     ------------------------------------------------------------------ */
  _ambience(dt) {
    if (typeof AudioSystem === "undefined" || !AudioSystem.ctx) return;
    const p = Player.position, T = this._ambT;
    T[0] -= dt; T[1] -= dt; T[2] -= dt;
    if (T[0] <= 0) {                                        // a gust of wind
      T[0] = 9 + Math.random() * 14;
      AudioSystem._noise(2.6, 0.035, "ambient", null, 120, 420);
    }
    if (T[1] <= 0) {                                        // a dog, far off: two short barks, very quiet
      T[1] = 28 + Math.random() * 50;
      const bark = () => {
        if (!this.active || !AudioSystem.ctx) return;
        AudioSystem._tone(260 + Math.random() * 50, "sawtooth", 0.13, 0.012, "ambient");
        AudioSystem._noise(0.14, 0.012, "ambient", null, 500, 1500);
      };
      bark();
      setTimeout(bark, 380 + Math.random() * 120);
    }
    if (T[2] <= 0) {
      T[2] = 1.1 + Math.random() * 0.6;
      let near = null, nd = 5.5;
      for (const f of this.fixtures) {
        if (f.kind !== "lamp" || !f.on) continue;
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        if (d < nd) { nd = d; near = f; }
      }
      if (near) AudioSystem.playPositional("flicker", near.x, near.y, near.z, { gain: near.flick ? 0.2 : 0.09, bus: "electrical", max: 20, ref: 2 });
      else T[2] = 3;
    }
  },

  /* ------------------------------------------------------------------
     INTERACTION AND UPDATE
     ------------------------------------------------------------------ */
  tryUse() {
    if (!this.active) return false;
    return this.useNearest();            // level9-houses.js
  },

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this._flashLimit();
    if (!this._leaving) this.stream(false);
    this._doors(dt);                       // level9-houses.js
    this._intT -= dt;
    if (this._intT <= 0) { this._intT = 0.5; this._interiors(); }
    this._lightT -= dt;
    if (this._lightT <= 0) { this._lightT = 0.2; this._aim(false); }
    this._fadeLights(dt);
    if (!this._leaving) this._checkExits();
    if (!this.active) return;               // walked into Level 10
    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
    this._ambience(dt);
    if (typeof Level9Entities !== "undefined" && !this._leaving) Level9Entities.update(dt);
  },

  // ---- console / debug
  setLook(key, v) {
    if (!(key in this.look)) return false;
    this.look[key] = v;
    if (key === "ambient" && this._amb) this._amb.intensity = v;
    if (key === "hemi" && this._hemi) this._hemi.intensity = v;
    if (key === "moon" && this._moon) this._moon.intensity = v;
    if ((key === "fogNear" || key === "fogFar") && scene.fog) { scene.fog.near = this.look.fogNear; scene.fog.far = this.look.fogFar; }
    if (key === "exposure" && typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28 * v;
    return true;
  },
  teleportTo(x, z) {
    Player.position.set(x, this.baseY, z);
    Player.velocity.set(0, 0, 0);
    this.stream(true);
    this._aim(true);
  }
};
