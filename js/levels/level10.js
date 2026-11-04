"use strict";

/* Level 10 — The Field. Core: streaming, terrain, structures, the ring, the look lerp, lifecycle, transitions.
   Pure generation lives in level10-gen.js. No entities live here.

   STREAMING (the Level 9 way, with 36 m chunks)
     Chunks within BUILD metres of the player are built one generator step at a time inside a small per-frame budget;
     chunks farther than DROP are disposed. A chunk is a pure function of (seed, ci, cj). What the player changes
     (a taken bottle) lives in `persist`. Colliders are AABBs. Light: a fixed pool of one point light for the exit barn,
     plus a hemisphere and an ambient light. No sun.

   THE ENTRANCE (no Void, no cutscene, no fade)
     Level 9's field-break exit calls Level10.enter(seed, "level9", exit). The player stands in the clearing of a thick ring
     of wheat at the origin. Sky, fog and light are Level 9's night at the ring and lerp to overcast with distance from it
     (Level10Gen.lerpT). Walking back into the clearing before the lock returns to Level 9 at its field break (Level 9
     rebuilds). At LOCK metres the ring is removed, the look is final, and the way back is gone: Level 9 is not rebuilt. */
const Level10 = {
  active: false,
  seed: 0,
  group: null,
  ring: null,
  colliders: [],
  blocks: new Map(),
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  baseY: 0,
  exitPos: null,
  infoText: "",
  time: 0,
  dist: 0,
  locked: false,
  BUILD: 44,
  DROP: 80,
  COLLIDE: 40,
  BUDGET: 3.5,
  // Level 9's night, as set by Level9.enter (the same numbers: the lerp starts exactly there)
  NIGHT: { fog: 0x1c1e1d, fogNear: 8, fogFar: 38, sky: 0x1c1e1d, hemiSky: 0x5a6c7a, hemiGround: 0x1a2218, hemi: 0.85, amb: 0x66707a, ambI: 1.05, moon: 0.9, exposure: 1.15 },
  DAY: { fog: 0xd8dce0, fogNear: 6, fogFar: 48, sky: 0xe4e8ec, hemiSky: 0xe8ecf0, hemiGround: 0x8a8678, hemi: 1.1, amb: 0xd0d4d8, ambI: 1.2, moon: 0, exposure: 1.2 },
  persist: null,
  fixtures: [],
  exits: [],
  pool: [], poolFx: [], _cur: [], _want: [],
  ambient: [],
  _queue: [], _lastKey: "", _lightT: 0, _cur_rec: null, _dirty: false, _grid: null,
  _ended: false, _leaving: false, _armed: false, _t: -1,

  /* ------------------------------------------------------------------ materials and colours */
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
      wheat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }),
      emi: new THREE.MeshBasicMaterial({ vertexColors: true })
    };
    return this.M;
  },
  lerpHex(a, b, t) {
    const ch = (s) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  },

  /* ------------------------------------------------------------------ chunk records */
  newRec(ci, cj) {
    const C = Level10Gen.CHUNK;
    return {
      key: ci + "," + cj, ci, cj, B: { x0: ci * C, z0: cj * C, x1: ci * C + C, z1: cj * C + C }, group: new THREE.Group(), geos: [], colliders: [],
      fixtures: [], exits: [], pickups: [], lit: new L9Builder(), wheat: new L9Builder(), emi: new L9Builder(), P: null, gen: null, done: false, dist: 0
    };
  },
  collider(rec, x0, y0, z0, x1, y1, z1, tag) {
    const c = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
    if (tag) c.tag = tag;
    rec.colliders.push(c);
    return c;
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
  flush(rec) {
    const M = this.mats();
    this._mesh(rec.group, rec.geos, rec.lit, M.lit);
    this._mesh(rec.group, rec.geos, rec.wheat, M.wheat);
    this._mesh(rec.group, rec.geos, rec.emi, M.emi);
  },
  _blockDist(B, px, pz) { return Math.hypot(Math.max(0, B.x0 - px, px - B.x1), Math.max(0, B.z0 - pz, pz - B.z1)); },

  /* ------------------------------------------------------------------ chunk build (a generator) */
  *_buildChunk(rec) {
    const G = Level10Gen, P = rec.P = G.chunk(rec.ci, rec.cj);
    this._ground(rec, P);
    this._lines(rec, P);
    for (const st of P.structs) this._structure(rec, st);
    for (const lk of P.lakes) this._lake(rec, lk);
    this.flush(rec);
    yield;
    const cells = Math.round(G.CHUNK / G.CELL), g0 = rec.ci * cells, h0 = rec.cj * cells, rows = cells / 4;
    for (let band = 0; band < 4; band++) {
      this._wheat(rec, P, g0, h0 + band * rows, cells, rows);
      this.flush(rec);
      yield;
    }
    rec.done = true;
  },

  _ground(rec, P) {
    const b = rec.lit, C = Level10Gen.CHUNK;
    b.box((P.x0 + P.x1) / 2, -0.25, (P.z0 + P.z1) / 2, C, 0.5, C, this.col(0x3f382a), 0);
    for (const r of P.verges) b.box((r.x0 + r.x1) / 2, 0.006, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.012, r.z1 - r.z0, this.col(0x66603f), 0);
    for (const r of P.paths) b.box((r.x0 + r.x1) / 2, 0.012, (r.z0 + r.z1) / 2, r.x1 - r.x0, 0.024, r.z1 - r.z0, this.col(0x76664a), 0);
  },

  _lines(rec, P) {
    const G = Level10Gen, b = rec.lit;
    for (const r of P.hedges) {
      const alongX = r.axis === "H", len = alongX ? r.x1 - r.x0 : r.z1 - r.z0, n = Math.max(1, Math.round(len / 2)), step = len / n;
      for (let k = 0; k < n; k++) {
        const t0 = (alongX ? r.x0 : r.z0) + k * step, k2 = 0.85 + 0.2 * G.hash(Math.round(r.x0 * 3) + k, Math.round(r.z0 * 3), 461);
        if (alongX) b.box(t0 + step / 2, G.HEDGE_H / 2, (r.z0 + r.z1) / 2, step, G.HEDGE_H, r.z1 - r.z0, this.col(0x2f4226, k2), 0);
        else b.box((r.x0 + r.x1) / 2, G.HEDGE_H / 2, t0 + step / 2, r.x1 - r.x0, G.HEDGE_H, step, this.col(0x2f4226, k2), 0);
      }
      this.collider(rec, r.x0, 0, r.z0, r.x1, G.HEDGE_H, r.z1, "hedge");
    }
    const wood = this.col(0x6b6455);
    for (const r of P.fences) {
      const alongX = r.axis === "H", a0 = alongX ? r.x0 : r.z0, a1 = alongX ? r.x1 : r.z1, cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      for (let t = Math.ceil(a0 / 2.4) * 2.4; t < a1; t += 2.4) {
        if (alongX) b.box(t, G.FENCE_H / 2, cz, 0.12, G.FENCE_H, 0.12, wood, 0); else b.box(cx, G.FENCE_H / 2, t, 0.12, G.FENCE_H, 0.12, wood, 0);
      }
      for (const y of [0.45, 0.85]) {
        if (alongX) b.box((a0 + a1) / 2, y, cz, a1 - a0, 0.09, 0.05, wood, 0); else b.box(cx, y, (a0 + a1) / 2, 0.05, 0.09, a1 - a0, wood, 0);
      }
      this.collider(rec, r.x0, 0, r.z0, r.x1, G.FENCE_H, r.z1, "fence");
    }
  },

  // a box in a structure's local frame as a world AABB collider
  _lbox(rec, st, lx0, y0, lz0, lx1, y1, lz1, tag) {
    const a = Level10Gen.local(st, lx0, lz0), c = Level10Gen.local(st, lx1, lz1);
    this.collider(rec, Math.min(a.x, c.x), y0, Math.min(a.z, c.z), Math.max(a.x, c.x), y1, Math.max(a.z, c.z), tag);
  },

  _structure(rec, st) {
    const G = Level10Gen, b = rec.lit, barn = st.kind === "barn";
    const hw = st.w / 2, hd = st.d / 2, t = st.t, wH = st.wallH, rH = st.ridgeH, dw = st.doorW / 2, dh = st.doorH;
    const wall = this.col(barn ? 0x5a3d33 : 0x6a6050), roof = this.col(barn ? 0x4b4c4a : 0x57503f), hay = [0xb39a55, 0xa38a4a, 0xc0a860];
    b.push(st.yaw, st.x, st.z);
    b.box(0, 0.012, 0, st.w - 2 * t, 0.024, st.d - 2 * t, this.col(0x3b3426), 0);                     // floor
    b.box(0, wH / 2, -hd + t / 2, st.w, wH, t, wall, 0);                                                // back
    b.box(-(hw - t / 2), wH / 2, 0, t, wH, st.d, wall, 0);                                              // sides
    b.box(hw - t / 2, wH / 2, 0, t, wH, st.d, wall, 0);
    const fw = hw - dw;                                                                                 // front, with the door
    b.box(-(dw + fw / 2), wH / 2, hd - t / 2, fw, wH, t, wall, 0);
    b.box(dw + fw / 2, wH / 2, hd - t / 2, fw, wH, t, wall, 0);
    b.box(0, (dh + wH) / 2, hd - t / 2, st.doorW, wH - dh, t, wall, 0);
    this._lbox(rec, st, -hw, 0, -hd, hw, wH, -hd + t, "wall");
    this._lbox(rec, st, -hw, 0, -hd, -hw + t, wH, hd, "wall");
    this._lbox(rec, st, hw - t, 0, -hd, hw, wH, hd, "wall");
    this._lbox(rec, st, -hw, 0, hd - t, -dw, wH, hd, "wall");
    this._lbox(rec, st, dw, 0, hd - t, hw, wH, hd, "wall");
    this._lbox(rec, st, -dw, dh, hd - t, dw, wH, hd, "wall");
    // gabled roof: each slope and each gable is drawn from both sides (the material is single-sided)
    const eY = wH - 0.2, ov = 0.5, V = (x, y, z) => b._v(x, y, z);
    const in1 = V(0, wH - 1, 0), up1 = V(0, rH + 4, 0);
    for (const s of [-1, 1]) {
      const a = V(s * (hw + ov), eY, -hd - ov), c = V(0, rH, -hd - ov), d = V(0, rH, hd + ov), e = V(s * (hw + ov), eY, hd + ov);
      b.quad(a, c, d, e, roof, in1);
      b.quad(V(s * (hw + ov), eY - 0.1, -hd - ov), V(0, rH - 0.1, -hd - ov), V(0, rH - 0.1, hd + ov), V(s * (hw + ov), eY - 0.1, hd + ov), roof, up1);
    }
    for (const s of [-1, 1]) {
      const z = s * hd;
      b.tri(V(-hw, wH, z), V(hw, wH, z), V(0, rH, z), wall, V(0, wH, 0));
      b.tri(V(-hw, wH, z - s * t), V(hw, wH, z - s * t), V(0, rH, z - s * t), wall, V(0, wH, s * (hd + 4)));
    }
    if (!barn) this._lbox(rec, st, -hw - ov, wH - 0.2, -hd - ov, hw + ov, rH, hd + ov, "roof");
    // hay: stacks (solid) and loose patches (flat)
    for (const k of st.loose) b.box(k.lx, 0.04, k.lz, k.sx, 0.05, k.sz, this.col(hay[Math.floor(k.c * 3) % 3], 0.85), k.c * 3);
    st.stacks.forEach((s, n) => {
      for (let y = 0; y < s.n; y++) b.box(s.lx, 0.25 + y * 0.5, s.lz, s.fx, 0.5, s.fz, this.col(hay[(n + y) % 3], 0.9 + 0.1 * ((n * 7 + y) % 3)), 0);
      this._lbox(rec, st, s.lx - s.fx / 2, 0, s.lz - s.fz / 2, s.lx + s.fx / 2, s.n * 0.5, s.lz + s.fz / 2, "hay");
    });
    b.pop();
    if (st.water && !this.persist.taken.has(st.id) && typeof PickupSystem !== "undefined" && PickupSystem.group) {
      const w = G.local(st, st.water.lx, st.water.lz);
      PickupSystem._addMesh("almond", w.x, w.z);
      const q = PickupSystem.list[PickupSystem.list.length - 1];
      q.l10 = st.id;
      q.mesh.position.y = st.water.y + 0.17;
      rec.pickups.push(q);
    }
    if (st.exit) {
      const e = G.exitInfo();
      rec.exits.push({ kind: "level11", x: e.x, z: e.z, r: 1.5 });
      rec.fixtures.push({ x: e.light.x, y: e.light.y, z: e.light.z, base: 7, dist: 15, color: 0xffd9a0, kind: "exit", on: true });
    }
  },

  _lake(rec, lk) {
    const G = Level10Gen, b = rec.lit, e = rec.emi, N = 24, r = lk.r;
    const ring = (rr, y) => { const o = []; for (let k = 0; k < N; k++) { const a = k / N * Math.PI * 2; o.push([lk.x + Math.cos(a) * rr, y, lk.z + Math.sin(a) * rr]); } return o; };
    const sh = ring(r + 2.2, 0.02), wa = ring(r, 0.035), up = [lk.x, -3, lk.z], mud = this.col(0x4c4435), water = this.col(0x7b8488);
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      b.quad(sh[k], sh[k2], [wa[k2][0], 0.02, wa[k2][2]], [wa[k][0], 0.02, wa[k][2]], mud, up);
      e.tri(wa[k], wa[k2], [lk.x, 0.035, lk.z], water, up);
    }
    // still water you cannot wade into: strips of AABBs just inside the shore
    const n = 12, sw = 2 * r / n;
    for (let k = 0; k < n; k++) {
      const xc = lk.x - r + (k + 0.5) * sw, dx = xc - lk.x, hz = Math.sqrt(Math.max(0, r * r - dx * dx)) * 0.96;
      if (hz > 0.3) this.collider(rec, xc - sw / 2, 0, lk.z - hz, xc + sw / 2, 1.5, lk.z + hz, "water");
    }
  },

  /* ------------------------------------------------------------------ wheat */
  // one clump: two crossed tapered quads, dark at the foot and gold at the head. Normals are horizontal, so the
  // hemisphere and ambient light give both faces the same brightness.
  _blade(b, x, z, yaw, w, h, lean, cb, ct) {
    for (let k = 0; k < 2; k++) {
      const a = yaw + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), hx = ca * w / 2, hz = -sa * w / 2, tx = ca * lean, tz = -sa * lean;
      const nx = sa, nz = ca;
      const P = [x - hx, 0, z - hz, x + hx, 0, z + hz, x + hx * 0.45 + tx, h, z + hz * 0.45 + tz, x - hx * 0.45 + tx, h, z - hz * 0.45 + tz];
      const C = [cb, cb, ct, ct];
      for (const q of [0, 1, 2, 0, 2, 3]) {
        b.p.push(P[q * 3], P[q * 3 + 1], P[q * 3 + 2]);
        b.n.push(nx, 0, nz);
        b.c.push(C[q][0], C[q][1], C[q][2]);
      }
    }
  },
  _wheatColors(tone, shade) {
    const green = [0.52, 0.5, 0.2], gold = [0.78, 0.64, 0.27], t = tone;
    const top = [(green[0] + (gold[0] - green[0]) * t) * shade, (green[1] + (gold[1] - green[1]) * t) * shade, (green[2] + (gold[2] - green[2]) * t) * shade];
    return [[top[0] * 0.38, top[1] * 0.38, top[2] * 0.3], top];
  },
  _wheat(rec, P, g0, h0, nx, nz) {
    const G = Level10Gen, b = rec.wheat, clear = this.locked ? 0 : G.RING.clear, tones = new Map();
    for (let gj = h0; gj < h0 + nz; gj++) for (let gi = g0; gi < g0 + nx; gi++) {
      const c = G.clump(gi, gj);
      if (clear && c.x * c.x + c.z * c.z < clear * clear) continue;
      if (G.excluded(P, c.x, c.z)) continue;
      const pl = G.plotIn(P, c.x, c.z), key = pl.i + "," + pl.j;
      let tone = tones.get(key);
      if (tone == null) { tone = G.hash(pl.i, pl.j, 451); tones.set(key, tone); }
      const cols = this._wheatColors(0.2 + 0.8 * tone, c.shade);
      this._blade(b, c.x, c.z, c.yaw, c.w, c.h, c.lean, cols[0], cols[1]);
    }
  },

  /* ------------------------------------------------------------------ the ring: dense wheat round the entrance */
  _buildRing() {
    const G = Level10Gen, R = G.RING, M = this.mats(), grp = new THREE.Group(), geos = [], b = new L9Builder(), lit = new L9Builder();
    const sp = 0.5, n = Math.ceil(R.outer / sp);
    for (let gj = -n; gj <= n; gj++) for (let gi = -n; gi <= n; gi++) {
      const x = (gi + G.hash(gi, gj, 471)) * sp, z = (gj + G.hash(gi, gj, 472)) * sp, d = Math.hypot(x, z);
      if (d < R.clear || d > R.outer) continue;
      const h = G.WHEAT_H * (G.WHEAT_LO + (G.WHEAT_HI - G.WHEAT_LO) * G.hash(gi, gj, 473)), cols = this._wheatColors(0.45, 0.85 + 0.25 * G.hash(gi, gj, 474));
      this._blade(b, x, z, G.hash(gi, gj, 475) * Math.PI, 1.2 + 0.3 * G.hash(gi, gj, 476), h, (G.hash(gi, gj, 477) - 0.5) * 0.3, cols[0], cols[1]);
    }
    lit.box(0, 0.012, 0, R.clear * 2 - 0.4, 0.024, R.clear * 2 - 0.4, this.col(0x5a4f38), 0);          // the trodden clearing
    this._mesh(grp, geos, b, M.wheat);
    this._mesh(grp, geos, lit, M.lit);
    this.group.add(grp);
    this.ring = { group: grp, geos };
  },
  _removeRing() {
    if (!this.ring) return;
    if (this.ring.group.parent) this.ring.group.parent.remove(this.ring.group);
    for (const g of this.ring.geos) g.dispose();
    this.ring = null;
  },

  /* ------------------------------------------------------------------ streaming */
  _plan(px, pz) {
    const G = Level10Gen, C = G.CHUNK, ci = Math.floor(px / C), cj = Math.floor(pz / C), q = [], R = Math.ceil(this.BUILD / C) + 1;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = ci + di, j = cj + dj, key = i + "," + j;
      if (this.blocks.has(key)) continue;
      const dd = this._blockDist({ x0: i * C, z0: j * C, x1: i * C + C, z1: j * C + C }, px, pz);
      if (dd < this.BUILD) q.push({ d: dd, i, j, key });
    }
    q.sort((a, c) => a.d - c.d);
    this._queue = q;
    for (const rec of Array.from(this.blocks.values())) if (this._blockDist(rec.B, px, pz) > this.DROP) this._disposeChunk(rec);
  },
  _disposeChunk(rec) {
    for (const q of rec.pickups) {
      if (q.taken && q.l10) this.persist.taken.add(q.l10);
      if (q.mesh) { if (q.mesh.parent) q.mesh.parent.remove(q.mesh); if (q.mesh.material && q.mesh.material.dispose) q.mesh.material.dispose(); }
      if (typeof PickupSystem !== "undefined") { const i = PickupSystem.list.indexOf(q); if (i >= 0) PickupSystem.list.splice(i, 1); }
    }
    rec.pickups.length = 0;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos) g.dispose();
    rec.disposed = true;
    this.blocks.delete(rec.key);
    this._dirty = true;
  },
  // force: build everything within maxDist now (and nothing farther); otherwise build inside the frame budget
  stream(force, maxDist) {
    if (!this.active || !this.group || this._leaving) return;
    const p = Player.position, key = Math.floor(p.x / 8) + "," + Math.floor(p.z / 8);
    if (force || key !== this._lastKey) { this._lastKey = key; this._plan(p.x, p.z); }
    const t0 = performance.now();
    let guard = 0;
    for (;;) {
      if (++guard > 5000) break;
      if (!this._cur_rec) {
        const it = this._queue[0];
        if (!it) break;
        if (force && maxDist != null && it.d > maxDist) break;
        this._queue.shift();
        if (this.blocks.has(it.key)) continue;
        const rec = this.newRec(it.i, it.j);
        rec.gen = this._buildChunk(rec);
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
    const p = Player.position, a = this.colliders;
    a.length = 0;
    this.fixtures = []; this.exits = [];
    for (const rec of this.blocks.values()) {
      rec.dist = this._blockDist(rec.B, p.x, p.z);
      for (const f of rec.fixtures) this.fixtures.push(f);
      for (const x of rec.exits) this.exits.push(x);
      if (rec.dist < this.COLLIDE) for (const c of rec.colliders) a.push(c);
    }
  },

  /* ------------------------------------------------------------------ light: one point light for the exit barn */
  _aim(snap) {
    const p = Player.position, ranked = [];
    for (const f of this.fixtures) { const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z); if (d < 60 * 60) ranked.push({ f, d }); }
    ranked.sort((a, b) => a.d - b.d);
    this._want = ranked.slice(0, this.pool.length).map(r => r.f);
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (f && !this._want.includes(f) && (snap || !this.fixtures.includes(f))) this.poolFx[i] = null;
    }
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

  /* ------------------------------------------------------------------ the look: Level 9's night -> overcast, by distance */
  _look(t) {
    if (Math.abs(t - this._t) < 1e-4) return;
    this._t = t;
    const N = this.NIGHT, D = this.DAY, L = (a, b) => a + (b - a) * t, H = (a, b) => this.lerpHex(a, b, t);
    const fog = H(N.fog, D.fog);
    if (scene.fog) { if (scene.fog.color && scene.fog.color.setHex) scene.fog.color.setHex(fog); scene.fog.near = L(N.fogNear, D.fogNear); scene.fog.far = L(N.fogFar, D.fogFar); }
    const sky = H(N.sky, D.sky);
    if (scene.background && scene.background.setHex) scene.background.setHex(sky); else scene.background = new THREE.Color(sky);
    if (this._hemi) { this._hemi.intensity = L(N.hemi, D.hemi); if (this._hemi.color && this._hemi.color.setHex) this._hemi.color.setHex(H(N.hemiSky, D.hemiSky)); if (this._hemi.groundColor && this._hemi.groundColor.setHex) this._hemi.groundColor.setHex(H(N.hemiGround, D.hemiGround)); }
    if (this._amb) { this._amb.intensity = L(N.ambI, D.ambI); if (this._amb.color && this._amb.color.setHex) this._amb.color.setHex(H(N.amb, D.amb)); }
    if (this._moon) this._moon.intensity = L(N.moon, D.moon);          // reaches 0: there is no sun
    if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28 * L(N.exposure, D.exposure);
  },

  /* ------------------------------------------------------------------ lifecycle */
  reset() {
    const wasActive = this.active;
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of Array.from(this.blocks.values())) this._disposeChunk(rec);
    this._removeRing();
    this.blocks = new Map();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = []; this.poolFx = []; this._cur = []; this._want = [];
    this.fixtures = []; this.exits = [];
    this._queue = []; this._cur_rec = null; this._lastKey = ""; this._t = -1;
    this.colliders.length = 0;
    this.group = null;
    this.active = false; this.locked = false; this._armed = false;
    this.time = 0; this.dist = 0;
    this._leaving = false; this._ended = false;
    this.exitPos = null;
    if (wasActive) {
      if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") { CameraRig.camera.far = CONFIG.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
      if (typeof renderer !== "undefined" && renderer) renderer.toneMappingExposure = 1.28;
    }
  },

  // from: "level9" when walking in from Level 9's field break (seamless: nothing but a world swap hidden by the ring)
  enter(seed, from, via) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof Level5 !== "undefined") Level5.reset();
    if (typeof Level6 !== "undefined") Level6.reset();
    if (typeof Level8 !== "undefined") Level8.reset();              // also resets Level 9, which resets this
    if (typeof Level9 !== "undefined") Level9.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") { SmilerSystem.reset(); SmilerSystem.detach(); }
    if (typeof HoundSystem !== "undefined") { HoundSystem.reset(); HoundSystem.detach(); }
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.seed = seed >>> 0;
    this.from9 = via || null;                                          // the Level 9 field break we came through
    const run = (typeof GameState !== "undefined" && GameState.runId) || 0;
    if (!this.persist || this.persist.seed !== this.seed || this.persist.run !== run) this.persist = { seed: this.seed, run, taken: new Set() };
    Level10Gen.init(this.seed);
    this.mats();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level10_Field";
    scene.add(this.group);
    const N = this.NIGHT;
    const hemi = new THREE.HemisphereLight(N.hemiSky, N.hemiGround, N.hemi);
    const amb = new THREE.AmbientLight(N.amb, N.ambI);
    const moon = new THREE.DirectionalLight(0x8396ad, N.moon);       // Level 9's moon, faded to nothing by the lerp
    moon.position.set(-30, 60, -20);
    scene.add(hemi, amb, moon);
    this.ambient.push(hemi, amb, moon);
    this._hemi = hemi; this._amb = amb; this._moon = moon;
    const L = new THREE.PointLight(0xffd9a0, 0, 15, 1.5);
    scene.add(L);
    this.ambient.push(L);
    this.pool.push(L); this.poolFx.push(null); this._cur.push(0);
    scene.fog = new THREE.Fog(N.fog, N.fogNear, N.fogFar);
    if (CameraRig.camera) { CameraRig.camera.far = 46; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 10; if (typeof AudioSystem !== 'undefined') AudioSystem.setLevel(GameState.level);
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    if (typeof Flashlight !== "undefined") Flashlight.init();
    const fromL9 = from === "level9";
    if (fromL9) {                                                       // the player is already standing in the clearing
      Player.position.set(0, this.baseY, 0);
      this.spawn.set(0, this.baseY, 0);
      this._armed = false;
    } else {
      const S = Level10Gen.spawnInfo();
      this.spawn.set(S.x, this.baseY, S.z);
      this.spawnYaw = S.yaw;
      Player.position.copy(this.spawn);
      Player.velocity.set(0, 0, 0);
      Player.onGround = true;
      Player.yaw = S.yaw;
      Player.pitch = 0;
      this._armed = true;
    }
    Level.startPos.copy(this.spawn);
    const ex = Level10Gen.exitInfo();
    this.exitPos = new THREE.Vector3(ex.x, this.baseY, ex.z);
    this.infoText = "FIELD · WAY ON ~" + Math.round(ex.dist) + "m";
    this._look(Level10Gen.lerpT(Math.hypot(Player.position.x, Player.position.z)));
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find a way on";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 10";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    if (typeof PickupSystem !== "undefined") { PickupSystem.group = new THREE.Group(); scene.add(PickupSystem.group); }
    this._buildRing();
    this.stream(true, 26);
    this._aim(true);
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    if (!fromL9 && typeof HUD !== "undefined") HUD.toast("LEVEL 10 · THE FIELD");
  },

  /* ------------------------------------------------------------------ transitions */
  // Back through the ring before the lock: Level 9 rebuilds at its field break
  _back() {
    if (this._leaving) return;
    this._leaving = true;
    const sd = this.seed;
    if (typeof Level9 !== "undefined" && Level9.enter) Level9.enter(sd, "level10", this.from9 || null);
  },
  _lock() {
    this.locked = true;
    this._look(1);
    this._removeRing();                    // the ring is gone and Level 9 is not rebuilt. No toast, no wall, no Void
  },
  // Level 11 is not built yet: the run ends here for now
  finish() {
    if (this._ended) return;
    this._ended = true;
    this._leaving = true;
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("LEVEL 11 IS NOT BUILT YET");
    GameState.exitReached = true;
    if (typeof Game !== "undefined" && Game.complete) Game.complete();
  },
  _checkExits() {
    const p = Player.position;
    if (p.y > this.baseY + 0.9) return;
    for (const x of this.exits) if (Math.hypot(p.x - x.x, p.z - x.z) <= x.r) return this.finish();
  },

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    if (!this._leaving) this.stream(false);
    this._lightT -= dt;
    if (this._lightT <= 0) { this._lightT = 0.2; this._aim(false); }
    this._fadeLights(dt);
    if (this._leaving) return;
    const p = Player.position, d = Math.hypot(p.x, p.z);
    this.dist = d;
    if (!this.locked) {
      if (d >= Level10Gen.LOCK) this._lock();
      else {
        this._look(Level10Gen.lerpT(d));
        if (!this._armed) { if (d > Level10Gen.RING.clear + 0.8) this._armed = true; }
        else if (d < 1.6) return this._back();
      }
    }
    this._checkExits();
  },

  teleportTo(x, z) {
    Player.position.set(x, this.baseY, z);
    Player.velocity.set(0, 0, 0);
    this.stream(true);
    this._aim(true);
  }
};
