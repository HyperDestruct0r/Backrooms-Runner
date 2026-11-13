"use strict";

/* Level 8 — The Cave System. Class 2.
   An endless set of rocky chambers joined by short, crooked passages. A crossing, not a place to live.

   This follows Level 3: nothing is laid out up front. The cave is a lattice of tiles, every tile is a pure
   function of (seed, i, j), and the tiles around the player are built on demand and dropped once the player
   has left them. Same seed = same cave, whatever route was walked.

     - A tile is 22 m square and holds one chamber (a box, 1 m grid) with a lobe on about half of them, so the
       outline is not a box. Chambers differ in size and ceiling: wide halls, mid rooms, low crawl rooms
       (2.2 to 2.55 m, mind your head) and small side rooms. Ceilings dip in the tall ones.
     - Neighbouring chambers are joined by a short passage, 2 m wide, with a dogleg jog most of the time.
       Every tile has a path back to the spawn tile (each tile links toward it), and about one in five of the
       other neighbour pairs is linked too, so there are loops and dead ends.
     - The arrival door sits in the spawn chamber and is sealed. The way back to Level 6 is a different door,
       a few tiles in (about 90 to 110 m of walking).
     - Exits: candidate points sit on a 400 m grid. For each one the seed decides whether it is real. A real
       exit is a hole (or a narrow shaft) in the floor of that tile's chamber: the floor mesh and the floor
       collider both have a gap. A candidate that is not real is ordinary cave and is not marked in any way.
       None is real within 500 m of the spawn. Every 1000 m by 1000 m region has at least one, and at least
       one is within 1000 m of the spawn. Standing in a real exit starts a drop that ends the level.
   Colliders are AABBs: wall cells merged into boxes, ceiling slabs, floor boxes, and rock props (boulders and
   pillars) that are plain footprint boxes. Each live tile is one merged mesh with one shared canvas-generated
   rock material (vertex colours give the variation). Stalactites, stalagmites and thin floor slabs are visual
   only. Light: a fixed pool of 4 point lights re-aimed at the nearest lit chambers (the count never changes).
   No water, no entities, no audio of its own. */
const Level8 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  doors: [],
  tiles: new Map(),     // live tiles: "i,j" -> { i, j, group, geos, colliders, fixtures, doors, hole, d }
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  exitPos: null,        // beside the nearest real exit to the spawn (console `level 8 exit`)
  exitInfo: null,       // { x, z, dist } of that exit
  backPos: null,        // just inside the way-back door
  baseY: 0,
  CAP: 8.5,             // solid rock above every ceiling goes up to here
  TILE: 4,              // metres per texture tile
  P: 22,                // tile pitch, metres
  BUILD: 28,            // build tiles closer than this (distance to the tile's square); fog is gone by 26 m
  DROP: 36,             // drop tiles farther than this
  NOW: 5,               // tiles closer than this are built the same frame, the rest one per frame
  COLLIDE: 24,          // only tiles closer than this contribute colliders
  EXIT: { pitch: 400, offset: 200, near: 500, region: 1000, chance: 0.28, pref: 950 },
  DIRS: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  shared: null,
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  look: { ambient: 0.58, hemi: 0.34, poolSize: 4, fog: 0x0b0a09, fogNear: 2.5, fogFar: 26 },
  flashRange: 0.25,     // flashlight range here, as a share of normal
  flashPower: 0.5,
  infoText: "",
  time: 0,
  _lightT: 0,
  _promptT: 0,
  _ended: false,
  _flashSet: false,
  _dropping: false,
  _dropT: 0,

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  // Stateless hash of (seed, a, b, salt): the same inputs always give the same number.
  h32(a, b, c) {
    let h = (this.seed >>> 0) ^ Math.imul((a | 0) + 0x9e3779b9, 0x45d9f3b) ^ Math.imul((b | 0) - 0x7f4a7c15, 0x27d4eb2d) ^ Math.imul((c | 0) + 0x165667b1, 0x85ebca6b);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  },
  hash(a, b, c) { return this.h32(a, b, c) / 4294967296; },
  trng(a, b, c) { const r = this.rng(this.h32(a, b, c)); r(); r(); return r; },

  /* ------------------------------------------------------------------
     LATTICE: which tiles are linked. Pure functions of the seed.
     ------------------------------------------------------------------ */
  // Every tile except the spawn tile has one link toward the spawn tile, so the whole lattice is connected.
  _parent(i, j) {
    if (i === 0 && j === 0) return null;
    const si = Math.sign(i), sj = Math.sign(j);
    if (i === 0) return [0, j - sj];
    if (j === 0) return [i - si, 0];
    return this.hash(i, j, 11) < 0.5 ? [i - si, j] : [i, j - sj];
  },
  // d 0: (i,j)-(i+1,j)   d 1: (i,j)-(i,j+1)
  _linked(i, j, d) {
    const bi = d === 0 ? i + 1 : i, bj = d === 0 ? j : j + 1;
    const pa = this._parent(i, j), pb = this._parent(bi, bj);
    if (pa && pa[0] === bi && pa[1] === bj) return true;
    if (pb && pb[0] === i && pb[1] === j) return true;
    return this.hash(i, j, 20 + d) < 0.22;
  },
  // side s of tile (i,j): 0 +x, 1 +z, 2 -x, 3 -z
  _side(i, j, s) {
    return s === 0 ? this._linked(i, j, 0) : s === 1 ? this._linked(i, j, 1) : s === 2 ? this._linked(i - 1, j, 0) : this._linked(i, j - 1, 1);
  },
  _sidePass(i, j, s) {
    return s === 0 ? this._passage(i, j, 0) : s === 1 ? this._passage(i, j, 1) : s === 2 ? this._passage(i - 1, j, 0) : this._passage(i, j - 1, 1);
  },

  /* ------------------------------------------------------------------
     EXITS: candidates on a 400 m grid, the seed decides which are real
     ------------------------------------------------------------------ */
  _spawnPt() {
    if (!this._sp) { const c = this._chamber(0, 0); this._sp = { x: Math.floor(c.cx) + 0.5, z: Math.floor(c.cz) + 0.5 }; }
    return this._sp;
  },

  // The hole of the tile's exit chamber. It only depends on (seed, i, j), never on the chamber, so the exit logic
  // can ask where a hole would be before the chamber exists.
  holeOf(i, j) {
    const key = i + "," + j, hit = this._holes.get(key);
    if (hit) return hit;
    const P = this.P, ci = i * P, cj = j * P, r = this.trng(i, j, 80);
    const ox = Math.floor(r() * 3) - 1, shaft = r() < 0.45;
    const cells = [];
    let cx, cz;
    if (shaft) {                                   // a narrow shaft: 2 by 2
      for (let z = cj - 1; z < cj + 1; z++) for (let x = ci + ox - 1; x < ci + ox + 1; x++) cells.push([x, z]);
      cx = ci + ox; cz = cj;
    } else {                                       // a hole: 3 by 3 with ragged corners
      const gone = [r() < 0.55, r() < 0.55, r() < 0.55, r() < 0.55];
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
        const k = (x === 0 && z === 0) ? 0 : (x === 2 && z === 0) ? 1 : (x === 0 && z === 2) ? 2 : (x === 2 && z === 2) ? 3 : -1;
        if (k >= 0 && gone[k]) continue;
        cells.push([ci + ox - 1 + x, cj - 1 + z]);
      }
      cx = ci + ox + 0.5; cz = cj + 0.5;
    }
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const mask = new Set();
    for (const c of cells) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0] + 1); z0 = Math.min(z0, c[1]); z1 = Math.max(z1, c[1] + 1); mask.add(c[0] + "," + c[1]); }
    const hole = { i, j, shaft, cells, mask, x0, x1, z0, z1, cx, cz, ax: x1 + 1.5, az: cz };
    this._holes.set(key, hole);
    return hole;
  },

  // Candidate (a, b) sits at (400a + 200, 400b + 200). Its tile gets the hole if the candidate is real.
  _cand(a, b) {
    const key = a + "," + b, hit = this._cands.get(key);
    if (hit) return hit;
    const E = this.EXIT, P = this.P, H = P / 2;
    const x = E.pitch * a + E.offset, z = E.pitch * b + E.offset;
    const i = Math.floor((x + H) / P), j = Math.floor((z + H) / P);
    const hole = this.holeOf(i, j), sp = this._spawnPt();
    const d = Math.hypot(hole.cx - sp.x, hole.cz - sp.z);
    const c = { a, b, i, j, hole, d, ok: d >= E.near, nat: this.hash(a, b, 31) < E.chance };
    this._cands.set(key, c);
    return c;
  },

  // The one candidate forced real so that an exit always lies within 1000 m of the spawn.
  _nearForced() {
    if (this._nf !== undefined) return this._nf;
    const E = this.EXIT;
    let best = null, bh = 2, any = false;
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
      const c = this._cand(a, b);
      if (!c.ok || c.d >= E.pref) continue;
      if (c.nat) any = true;
      const h = this.hash(a, b, 33);
      if (h < bh) { bh = h; best = c; }
    }
    this._nf = any ? null : best;
    return this._nf;
  },

  _isReal(a, b) {
    const key = a + "," + b, hit = this._real.get(key);
    if (hit !== undefined) return hit;
    const E = this.EXIT, c = this._cand(a, b), nf = this._nearForced();
    const isNf = (q) => !!nf && q.a === nf.a && q.b === nf.b;          // by coordinates: cached candidates may be rebuilt
    let real = false;
    if (c.ok) {
      if (c.nat || isNf(c)) real = true;
      else {
        // region rule: at least one real exit in every 1000 by 1000 region, judged by where the hole is
        const u = Math.floor(c.hole.cx / E.region), v = Math.floor(c.hole.cz / E.region);
        const a0 = Math.floor((E.region * u - E.offset) / E.pitch) - 1, a1 = Math.ceil((E.region * (u + 1) - E.offset) / E.pitch) + 1;
        const b0 = Math.floor((E.region * v - E.offset) / E.pitch) - 1, b1 = Math.ceil((E.region * (v + 1) - E.offset) / E.pitch) + 1;
        const list = [];
        let has = false;
        for (let aa = a0; aa <= a1; aa++) for (let bb = b0; bb <= b1; bb++) {
          const cc = this._cand(aa, bb);
          if (!cc.ok || Math.floor(cc.hole.cx / E.region) !== u || Math.floor(cc.hole.cz / E.region) !== v) continue;
          if (cc.nat || isNf(cc)) has = true;
          list.push(cc);
        }
        if (!has && list.length) {
          list.sort((p, q) => ((p.d < E.pref ? 0 : 1) - (q.d < E.pref ? 0 : 1)) || (this.hash(p.a, p.b, 32) - this.hash(q.a, q.b, 32)));
          real = list[0].a === a && list[0].b === b;
        }
      }
    }
    this._real.set(key, real);
    return real;
  },

  // Is tile (i, j) the tile of a real exit?
  isExitTile(i, j) {
    const E = this.EXIT, P = this.P, H = P / 2;
    const a = Math.round((i * P - E.offset) / E.pitch), b = Math.round((j * P - E.offset) / E.pitch);
    if (Math.floor((E.pitch * a + E.offset + H) / P) !== i || Math.floor((E.pitch * b + E.offset + H) / P) !== j) return false;
    return this._isReal(a, b);
  },

  // All real exits within `range` metres of the spawn, nearest first (console and tests).
  realExits(range) {
    const E = this.EXIT, n = Math.ceil(range / E.pitch) + 1, out = [];
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      if (!this._isReal(a, b)) continue;
      const c = this._cand(a, b);
      if (c.d <= range) out.push({ a, b, i: c.i, j: c.j, x: c.hole.cx, z: c.hole.cz, dist: c.d, shaft: c.hole.shaft });
    }
    out.sort((p, q) => p.dist - q.dist);
    return out;
  },

  /* ------------------------------------------------------------------
     CHAMBERS AND PASSAGES: pure functions of (seed, i, j)
     ------------------------------------------------------------------ */
  _chamber(i, j) {
    const key = i + "," + j, hit = this._chs.get(key);
    if (hit) return hit;
    const P = this.P, ci = i * P, cj = j * P, r = this.trng(i, j, 1);
    const ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const spawn = i === 0 && j === 0, exit = this.isExitTile(i, j);
    let kind, w, l, h, jx = 0, jz = 0;
    if (spawn) {                                    // never a low one, roomy, no jitter
      kind = r() < 0.5 ? "wide" : "mid"; w = ri(11, 13); l = ri(9, 11);
      h = kind === "wide" ? 4.6 + r() * 1.6 : 3.4 + r() * 0.9;
    } else if (exit) {                              // room for a hole and a clear approach
      kind = r() < 0.5 ? "wide" : "mid"; w = ri(11, 13); l = ri(9, 11);
      h = kind === "wide" ? 4.6 + r() * 1.6 : 3.4 + r() * 0.9;
    } else {
      const k = r();
      kind = k < 0.25 ? "wide" : k < 0.55 ? "mid" : k < 0.8 ? "low" : "small";
      if (kind === "wide") { w = ri(11, 14); l = ri(9, 12); h = 4.6 + r() * 2.0; }
      else if (kind === "mid") { w = ri(8, 11); l = ri(7, 10); h = 3.3 + r() * 1.0; }
      else if (kind === "low") { w = ri(10, 13); l = ri(8, 11); h = 2.2 + r() * 0.35; }
      else { w = ri(6, 8); l = ri(6, 8); h = 2.6 + r() * 1.2; }
      jx = ri(-1, 1); jz = ri(-1, 1);
    }
    h = Math.round(h * 100) / 100;
    const x0 = ci + jx - Math.floor(w / 2), z0 = cj + jz - Math.floor(l / 2);
    const rect = { x0, x1: x0 + w, z0, z1: z0 + l, h };
    const c = { i, j, kind, h, rect, lobe: null, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, spawn, exit: exit ? this.holeOf(i, j) : null,
      lit: spawn || exit ? true : this.hash(i, j, 41) < 0.62 };
    // a lobe on about half of them, on a side that has no passage, kept inside the tile's inner box
    if (kind !== "small" && r() < 0.58) {
      const free = [0, 1, 2, 3].filter(s => !this._side(i, j, s));
      if (free.length) {
        const side = free[Math.floor(r() * free.length)], lh = side % 2 === 0, lsg = (side === 0 || side === 1) ? 1 : -1;
        const lface = lh ? (lsg > 0 ? rect.x1 : rect.x0) : (lsg > 0 ? rect.z1 : rect.z0);
        const inner = (lh ? ci : cj) + lsg * 9;
        const extMax = Math.abs(inner - lface);
        const mlo = lh ? rect.z0 : rect.x0, mhi = lh ? rect.z1 : rect.x1;
        const len = ri(4, 7), room = (mhi - mlo) - 2 - len;
        if (extMax >= 2 && room >= 0) {
          const ext = Math.min(ri(3, 5), extMax), lat0 = mlo + 1 + ri(0, room), lat1 = lat0 + len;
          const a0 = Math.min(lface - lsg * 2, lface + lsg * ext), a1 = Math.max(lface - lsg * 2, lface + lsg * ext);
          const lobe = lh ? { x0: a0, x1: a1, z0: lat0, z1: lat1 } : { x0: lat0, x1: lat1, z0: a0, z1: a1 };
          lobe.h = kind === "low" ? h : Math.round(Math.max(2.4, h - (0.3 + r() * 0.9)) * 100) / 100;
          c.lobe = lobe;
        }
      }
    }
    this._chs.set(key, c);
    return c;
  },

  // The passage from tile (i,j) to (i+1,j) [d 0] or (i,j+1) [d 1]: a short 2 m wide run, jogged most of the time.
  _passage(i, j, d) {
    const key = i + "," + j + "," + d, hit = this._pass.get(key);
    if (hit) return hit;
    const A = this._chamber(i, j).rect, B = (d === 0 ? this._chamber(i + 1, j) : this._chamber(i, j + 1)).rect;
    const r = this.trng(i, j, 50 + d), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const al = (R) => d === 0 ? [R.x0, R.x1] : [R.z0, R.z1];
    const lt = (R) => d === 0 ? [R.z0, R.z1] : [R.x0, R.x1];
    const mk = (a0, a1, l0, l1, h) => d === 0 ? { x0: a0, x1: a1, z0: l0, z1: l1, h } : { x0: l0, x1: l1, z0: a0, z1: a1, h };
    const pt = (a, l) => d === 0 ? { x: a, z: l } : { x: l, z: a };
    const face = al(A)[1], bface = al(B)[0], G = bface - face;
    const la = lt(A), lb = lt(B);
    const oA = ri(la[0] + 2, la[1] - 2);
    let oB = oA + (r() < 0.25 ? 0 : ri(-5, 5));
    oB = Math.max(lb[0] + 2, Math.min(lb[1] - 2, oB));
    const h = Math.round((2.3 + r() * 0.3) * 100) / 100, pieces = [];
    if (oA === oB) pieces.push(mk(face, bface, oA - 1, oA + 1, h));
    else {
      const a = ri(1, Math.max(1, G - 3));
      pieces.push(mk(face, face + a, oA - 1, oA + 1, h));
      pieces.push(mk(face + a, face + a + 2, Math.min(oA, oB) - 1, Math.max(oA, oB) + 1, h));
      pieces.push(mk(face + a + 2, bface, oB - 1, oB + 1, h));
    }
    const p = { d, pieces, mouthA: pt(face, oA), mouthB: pt(bface, oB), len: G };
    this._pass.set(key, p);
    return p;
  },

  /* ------------------------------------------------------------------
     TILE DATA: the raster of one tile (24 by 24 cells: the tile plus a 1 cell margin), props and door spots
     ------------------------------------------------------------------ */
  _tileData(i, j) {
    const key = i + "," + j, hit = this._td.get(key);
    if (hit) return hit;
    const P = this.P, H = P / 2, DIRS = this.DIRS;
    const ch = this._chamber(i, j), r = this.trng(i, j, 2), ri = (a, b) => a + Math.floor(r() * (b - a + 1));
    const ox = i * P - H - 1, oz = j * P - H - 1, W = P + 2, D = P + 2, n = W * D;
    const open = new Uint8Array(n), kind = new Uint8Array(n), blk = new Uint8Array(n), hole = new Uint8Array(n);
    const hg = new Float32Array(n);
    const inb = (x, z) => x >= ox && z >= oz && x < ox + W && z < oz + D;
    const ix = (x, z) => (z - oz) * W + (x - ox);
    const paint = (rc, h, k, onlyEmpty) => {
      for (let z = Math.max(rc.z0, oz); z < Math.min(rc.z1, oz + D); z++) for (let x = Math.max(rc.x0, ox); x < Math.min(rc.x1, ox + W); x++) {
        const q = ix(x, z);
        if (onlyEmpty && open[q]) continue;
        open[q] = 1; kind[q] = k; hg[q] = h;
      }
    };
    paint(ch.rect, ch.rect.h, 1);
    if (ch.lobe) paint(ch.lobe, ch.lobe.h, 1, true);
    const mouths = [];
    for (let s = 0; s < 4; s++) {
      if (!this._side(i, j, s)) continue;
      const p = this._sidePass(i, j, s);
      for (const pc of p.pieces) paint(pc, pc.h, 2);
      mouths.push(s <= 1 ? p.mouthA : p.mouthB);
    }
    // ceiling dips in the taller chambers
    if (ch.h >= 3.4) {
      const M = ch.rect;
      for (let k = 0, cnt = ri(1, 3); k < cnt; k++) {
        const dw = ri(3, 5), dd = ri(3, 5);
        const dx = ri(M.x0 + 1, Math.max(M.x0 + 1, M.x1 - dw - 1)), dz = ri(M.z0 + 1, Math.max(M.z0 + 1, M.z1 - dd - 1));
        const drop = 0.5 + r() * 0.5;
        for (let z = dz; z < dz + dd; z++) for (let x = dx; x < dx + dw; x++) {
          if (!inb(x, z)) continue;
          const q = ix(x, z);
          if (open[q] && kind[q] === 1) hg[q] = Math.round(Math.max(2.4, hg[q] - drop) * 100) / 100;
        }
      }
    }
    for (let q = 0; q < n; q++) if (open[q]) hg[q] = Math.round(hg[q] * 100) / 100;
    if (ch.exit) for (const c of ch.exit.cells) hole[ix(c[0], c[1])] = 1;

    const d = { i, j, ch, ox, oz, W, D, open, kind, blk, hole, hg, ix, inb, mouths, props: [], sealSp: null, backSp: null };
    const sp0 = this._spawnPt();

    // rock props: boulders and pillars as footprint boxes, kept off passages, the spawn, the hole and the chamber's centre
    const nearKind2 = (x, z, pad) => { for (let zz = z - pad; zz <= z + pad; zz++) for (let xx = x - pad; xx <= x + pad; xx++) if (inb(xx, zz) && kind[ix(xx, zz)] === 2) return true; return false; };
    d.nearKind2 = nearKind2;
    const M = ch.rect, area = (M.x1 - M.x0) * (M.z1 - M.z0);
    if (area >= 56) {
      const num = ch.kind === "wide" ? ri(3, 5) : ch.kind === "mid" ? ri(2, 3) : ri(1, 2);
      const rects = ch.lobe ? [M, ch.lobe] : [M];
      for (let k = 0, tries = 0; k < num && tries < 40; tries++) {
        const R = rects[ri(0, rects.length - 1)];
        const fw = ri(1, 3), fd = ri(1, 3);
        const px = ri(R.x0 + 3, Math.max(R.x0 + 3, R.x1 - fw - 3)), pz = ri(R.z0 + 3, Math.max(R.z0 + 3, R.z1 - fd - 3));
        let ok = true;
        for (let zz = pz - 2; zz < pz + fd + 2 && ok; zz++) for (let xx = px - 2; xx < px + fw + 2; xx++) {
          if (!inb(xx, zz) || !open[ix(xx, zz)] || blk[ix(xx, zz)] || hole[ix(xx, zz)]) { ok = false; break; }
        }
        if (!ok || nearKind2(px + (fw >> 1), pz + (fd >> 1), 2 + Math.max(fw, fd))) continue;
        const mx = px + fw / 2, mz = pz + fd / 2;
        if (Math.hypot(mx - ch.cx, mz - ch.cz) < 2.5 + Math.max(fw, fd) / 2) continue;
        if (ch.spawn && Math.hypot(mx - sp0.x, mz - sp0.z) < 4.5 + Math.max(fw, fd)) continue;
        if (ch.exit && Math.hypot(mx - ch.exit.cx, mz - ch.exit.cz) < 6.5 + Math.max(fw, fd) / 2) continue;
        const ceil = hg[ix(px, pz)];
        const pillar = fw <= 2 && fd <= 2 && ceil < 6 && r() < 0.35;
        const h = pillar ? ceil : 0.6 + r() * 0.9;
        d.props.push({ x0: px, z0: pz, x1: px + fw, z1: pz + fd, h, pillar });
        for (let zz = pz; zz < pz + fd; zz++) for (let xx = px; xx < px + fw; xx++) blk[ix(xx, zz)] = 1;
        k++;
      }
    }
    if (ch.spawn) d.sealSp = this._doorSpot(d, 70, sp0);
    if (this._back && this._back.i === i && this._back.j === j) d.backSp = this._doorSpot(d, 71, null);
    this._td.set(key, d);
    return d;
  },

  // A door spot on a wall of the chamber: a flat 3 cell run of wall with free floor in front, away from passages.
  _doorSpot(d, salt, avoid) {
    const { ch, open, kind, blk, hole, ix, inb, nearKind2 } = d, DIRS = this.DIRS;
    const r = this.trng(d.i, d.j, salt);
    const freeAt = (x, z) => inb(x, z) && open[ix(x, z)] && !blk[ix(x, z)] && !hole[ix(x, z)];
    const list = [], seen = new Set();
    for (const R of (ch.lobe ? [ch.rect, ch.lobe] : [ch.rect])) for (let z = R.z0; z < R.z1; z++) for (let x = R.x0; x < R.x1; x++) {
      for (let s = 0; s < 4; s++) {
        const key = x + "," + z + "," + s;
        if (seen.has(key)) continue;
        const Dv = DIRS[s], Lv = [Math.abs(Dv[1]), Math.abs(Dv[0])];
        let ok = true;
        for (let t = -1; t <= 1 && ok; t++) {
          const cx = x + Lv[0] * t, cz = z + Lv[1] * t;
          if (!freeAt(cx, cz) || kind[ix(cx, cz)] !== 1 || (inb(cx + Dv[0], cz + Dv[1]) && open[ix(cx + Dv[0], cz + Dv[1])])) { ok = false; break; }
          for (let k = 1; k <= 2; k++) { const bx = cx - Dv[0] * k, bz = cz - Dv[1] * k; if (!freeAt(bx, bz)) { ok = false; break; } }
        }
        if (!ok || nearKind2(x, z, 2)) continue;
        if (ch.exit && Math.hypot(x - ch.exit.cx, z - ch.exit.cz) < 6) continue;
        seen.add(key);
        list.push({ x: x + 0.5 + Dv[0] * 0.5, z: z + 0.5 + Dv[1] * 0.5, side: s, ci: x, cj: z });
      }
    }
    let best = null, bs = -1e9;
    for (const sp of list) {
      if (avoid && Math.hypot(sp.x - avoid.x, sp.z - avoid.z) <= 3.5) continue;
      let m = 1e9;
      for (const p of d.mouths) m = Math.min(m, Math.hypot(sp.x - p.x, sp.z - p.z));
      const sc = m + r() * (salt === 70 ? 0.5 : 4);
      if (sc > bs) { bs = sc; best = sp; }
    }
    return best;
  },

  // The way back sits a few tiles in: about 90 to 110 m of walking, never in the spawn tile.
  _pickBack() {
    const tiles = [];
    for (let i = -4; i <= 4; i++) { const j = 4 - Math.abs(i); tiles.push([i, j]); if (j) tiles.push([i, -j]); }
    const start = Math.floor(this.hash(0, 0, 60) * tiles.length);
    for (let k = 0; k < tiles.length; k++) {
      const t = tiles[(start + k) % tiles.length], d = this._tileData(t[0], t[1]);
      const sp = this._doorSpot(d, 71, null);
      if (sp) { d.backSp = sp; this._back = { i: t[0], j: t[1] }; return d; }
    }
    return null;
  },

  // First stretch on enter: only the spawn is decided here. Everything else comes from stream().
  generate(seed) {
    this.seed = seed >>> 0;
    this._chs = new Map(); this._pass = new Map(); this._td = new Map(); this._holes = new Map();
    this._cands = new Map(); this._real = new Map(); this._nf = undefined; this._sp = null; this._back = null;
    const c0 = this._chamber(0, 0), sp = this._spawnPt();
    this.spawn.set(sp.x, this.baseY, sp.z);
    const sides = [0, 1, 2, 3].filter(s => this._side(0, 0, s));
    const d0 = this.DIRS[sides[Math.floor(this.hash(0, 0, 61) * sides.length)] || 0];
    this.spawnYaw = Math.atan2(-d0[0], -d0[1]);       // forward is (-sin yaw, -cos yaw): face a passage
    const bd = this._pickBack();
    const inward = (s, m) => new THREE.Vector3(s.x - this.DIRS[s.side][0] * m, this.baseY, s.z - this.DIRS[s.side][1] * m);
    this.backPos = bd ? inward(bd.backSp, 1.0) : null;
    const ex = this.realExits(1500)[0];
    this.exitInfo = ex || null;
    this.exitPos = ex ? new THREE.Vector3(this.holeOf(ex.i, ex.j).ax, this.baseY, this.holeOf(ex.i, ex.j).az) : null;
    this.infoText = "ENDLESS" + (ex ? " · NEAREST EXIT ~" + Math.round(ex.dist) + "m" : "");
    return c0;
  },

  /* ------------------------------------------------------------------
     MATERIAL (one shared rock material, one canvas texture)
     ------------------------------------------------------------------ */
  rockTex() {
    const N = 256, c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N), d = img.data;
    const rnd = this.rng(0x8C0FFEE);
    const grids = [8, 16, 32, 64].map(sz => { const a = new Float32Array(sz * sz); for (let i = 0; i < a.length; i++) a[i] = rnd(); return { sz, a }; });
    const smooth = (t) => t * t * (3 - 2 * t);
    const samp = (gr, x, y) => {                     // tileable value noise, x and y in [0, N)
      const s = gr.sz, f = s / N, fx = x * f, fy = y * f, ax = Math.floor(fx), ay = Math.floor(fy);
      const tx = smooth(fx - ax), ty = smooth(fy - ay), a = gr.a;
      const p = (xx, yy) => a[(yy % s) * s + (xx % s)];
      const top = p(ax, ay) * (1 - tx) + p(ax + 1, ay) * tx, bot = p(ax, ay + 1) * (1 - tx) + p(ax + 1, ay + 1) * tx;
      return top * (1 - ty) + bot * ty;
    };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const s0 = samp(grids[0], x, y), s1 = samp(grids[1], x, y), s2 = samp(grids[2], x, y), s3 = samp(grids[3], x, y);
        let b = 0.52 + (s0 * 0.5 + s1 * 0.28 + s2 * 0.14 + s3 * 0.08 - 0.5) * 0.95;
        b += Math.sin((y + s0 * 40) * (Math.PI * 2 / 64)) * 0.045;              // strata
        const ridge = 1 - Math.abs(s2 * 2 - 1);
        if (ridge > 0.94) b -= 0.22;                                           // cracks
        b = Math.max(0.12, Math.min(1, b));
        const i = (y * N + x) * 4;
        d[i] = Math.min(255, b * 236); d[i + 1] = Math.min(255, b * 218); d[i + 2] = Math.min(255, b * 196); d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  materialSet() {
    if (this.shared) return;
    this.shared = {
      rock: new THREE.MeshStandardMaterial({ map: this.rockTex(), vertexColors: true, roughness: 1, metalness: 0 }),
      door: new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.8, metalness: 0.2 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.9, metalness: 0.1 }),
      pit: new THREE.MeshBasicMaterial({ color: 0x040403 })
    };
  },

  /* ------------------------------------------------------------------
     GEOMETRY (everything merged into one BufferGeometry)
     ------------------------------------------------------------------ */
  _unit() {
    if (this._u) return this._u;
    const P = [], N = [];
    const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const f of faces) {
      const a = f[0] ? [0, 1, 0] : [1, 0, 0], b = f[2] ? [0, 1, 0] : [0, 0, 1];
      const base = P.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push(f[0] * 0.5 + a[0] * u * 0.5 + b[0] * v * 0.5, f[1] * 0.5 + a[1] * u * 0.5 + b[1] * v * 0.5, f[2] * 0.5 + a[2] * u * 0.5 + b[2] * v * 0.5);
        N.push(f[0], f[1], f[2]);
      }
    }
    // one winding per face, chosen so the triangles face outward
    const idx = [];
    for (let fi = 0; fi < 6; fi++) {
      const f = faces[fi], b = fi * 4;
      const a = f[0] ? [0, 1, 0] : [1, 0, 0], c = f[2] ? [0, 1, 0] : [0, 0, 1];
      const e1 = [a[0], a[1], a[2]], e2 = [c[0], c[1], c[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const dot = cr[0] * f[0] + cr[1] * f[1] + cr[2] * f[2];
      if (dot > 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    // cone, 5 sides, open at the base, tip at +0.5
    const cp = [], cn = [], ci = [];
    for (let k = 0; k < 5; k++) {
      const a0 = k / 5 * Math.PI * 2, a1 = (k + 1) / 5 * Math.PI * 2, am = (a0 + a1) / 2;
      const nx = Math.cos(am) * 0.9, nz = Math.sin(am) * 0.9, ny = 0.44, nl = Math.hypot(nx, ny, nz);
      const b = cp.length / 3;
      cp.push(Math.cos(a0), -0.5, Math.sin(a0), Math.cos(a1), -0.5, Math.sin(a1), 0, 0.5, 0);
      for (let q = 0; q < 3; q++) cn.push(nx / nl, ny / nl, nz / nl);
      ci.push(b, b + 2, b + 1);
    }
    this._u = { P, N, idx, cp, cn, ci };
    return this._u;
  },

  _mk() { return { pos: [], nor: [], uv: [], col: [], idx: [], n: 0 }; },

  // One transformed box: centre, size, optional rotation (yaw, then small pitch and roll) and a brightness.
  _box(b, cx, cy, cz, sx, sy, sz, ry, rx, rz, shade) {
    const u = this._unit(), T = this.TILE;
    const cY = Math.cos(ry || 0), sY = Math.sin(ry || 0), cX = Math.cos(rx || 0), sX = Math.sin(rx || 0), cZ = Math.cos(rz || 0), sZ = Math.sin(rz || 0);
    const rot = (x, y, z) => {
      let x1 = x * cZ - y * sZ, y1 = x * sZ + y * cZ, z1 = z;           // roll
      const y2 = y1 * cX - z1 * sX, z2 = y1 * sX + z1 * cX;             // pitch
      return [x1 * cY + z2 * sY, y2, -x1 * sY + z2 * cY];               // yaw
    };
    const base = b.n;
    for (let i = 0; i < u.P.length; i += 3) {
      const p = rot(u.P[i] * sx, u.P[i + 1] * sy, u.P[i + 2] * sz), nn = rot(u.N[i], u.N[i + 1], u.N[i + 2]);
      const wx = p[0] + cx, wy = p[1] + cy, wz = p[2] + cz;
      b.pos.push(wx, wy, wz); b.nor.push(nn[0], nn[1], nn[2]);
      if (Math.abs(nn[1]) > 0.6) b.uv.push(wx / T, wz / T); else if (Math.abs(nn[0]) > Math.abs(nn[2])) b.uv.push(wz / T, wy / T); else b.uv.push(wx / T, wy / T);
      this._tint(b, wy, shade);
    }
    for (const k of u.idx) b.idx.push(k + base);
    b.n += u.P.length / 3;
  },

  // A cone: a stalactite (tip down from the ceiling at y) or a stalagmite (tip up from the floor).
  _cone(b, x, y, z, rad, len, down, shade) {
    const u = this._unit(), T = this.TILE, base = b.n;
    for (let i = 0; i < u.cp.length; i += 3) {
      const py = u.cp[i + 1] + 0.5;
      const wx = x + u.cp[i] * rad, wz = z + u.cp[i + 2] * rad, wy = down ? y - len * py : y + len * py;
      b.pos.push(wx, wy, wz); b.nor.push(u.cn[i], down ? -u.cn[i + 1] : u.cn[i + 1], u.cn[i + 2]);
      b.uv.push(wx / T, wy / T);
      this._tint(b, wy, shade);
    }
    // the stored winding faces outward for a tip-up cone; flipping it in y mirrors it, so a stalactite swaps two indices
    if (down) for (let k = 0; k < u.ci.length; k += 3) b.idx.push(u.ci[k] + base, u.ci[k + 2] + base, u.ci[k + 1] + base);
    else for (let k = 0; k < u.ci.length; k += 3) b.idx.push(u.ci[k] + base, u.ci[k + 1] + base, u.ci[k + 2] + base);
    b.n += u.cp.length / 3;
  },

  _tint(b, wy, shade) {
    const hf = 0.6 + 0.4 * Math.min(1, Math.max(0, wy) / 3) - 0.22 * Math.min(1, Math.max(0, wy - 3) / 4);
    const v = Math.max(0.15, hf * (shade === undefined ? 1 : shade));
    b.col.push(v * 1.02, v, v * 0.96);
  },

  _geo(b) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    return g;
  },

  // Greedy merge of grid cells into rectangles. key(i,j) returns a number to group by, or -1 for none.
  _rects(W, D, key) {
    const used = new Uint8Array(W * D), out = [];
    for (let j = 0; j < D; j++) {
      for (let i = 0; i < W; i++) {
        if (used[j * W + i]) continue;
        const k = key(i, j);
        if (k < 0) continue;
        let w = 1;
        while (i + w < W && !used[j * W + i + w] && key(i + w, j) === k) w++;
        let h = 1;
        for (;;) {
          if (j + h >= D) break;
          let ok = true;
          for (let t = 0; t < w; t++) if (used[(j + h) * W + i + t] || key(i + t, j + h) !== k) { ok = false; break; }
          if (!ok) break;
          h++;
        }
        for (let q = 0; q < h; q++) for (let t = 0; t < w; t++) used[(j + q) * W + i + t] = 1;
        out.push({ i, j, w, h, k });
      }
    }
    return out;
  },

  /* ------------------------------------------------------------------
     TILE BUILD: one merged mesh per live tile, AABB colliders, doors, a pit under a real exit
     ------------------------------------------------------------------ */
  _buildTile(i, j) {
    const key = i + "," + j;
    if (this.tiles.has(key)) return this.tiles.get(key);
    const d = this._tileData(i, j), ch = d.ch, P = this.P, CAP = this.CAP;
    const { ox, oz, W, D, open, kind, hole, hg, ix } = d;
    const rec = { i, j, group: new THREE.Group(), geos: [], colliders: [], fixtures: [], doors: [], hole: ch.exit, d, dist: 0 };
    rec.group.name = "Level8_Tile_" + key;
    const r = this.trng(i, j, 3), b = this._mk();
    const col = (x0, y0, z0, x1, y1, z1, floor) => {
      const c = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) };
      if (floor) c.floor = true;
      rec.colliders.push(c);
    };
    const inside = (a, c) => a >= 1 && c >= 1 && a <= P && c <= P;     // the tile's own cells (the 1 cell margin is not ours)
    const wx = (a) => a + ox, wz = (c) => c + oz;

    // walls: every closed cell touching an open cell (8 neighbours), 1 m thick, floor to CAP
    const isWall = (a, c) => {
      if (!inside(a, c) || open[c * W + a]) return false;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (open[(c + dj) * W + a + di]) return true;
      return false;
    };
    for (const q of this._rects(W, D, (a, c) => isWall(a, c) ? 1 : -1)) {
      const x0 = wx(q.i), z0 = wz(q.j), x1 = x0 + q.w, z1 = z0 + q.h;
      this._box(b, (x0 + x1) / 2, CAP / 2, (z0 + z1) / 2, q.w, CAP, q.h, 0, 0, 0, 0.78 + r() * 0.3);
      col(x0, 0, z0, x1, CAP, z1);
    }
    // ceiling: one slab per run of equal height, from the ceiling up to CAP
    for (const q of this._rects(W, D, (a, c) => inside(a, c) && open[c * W + a] ? Math.round(hg[c * W + a] * 100) : -1)) {
      const x0 = wx(q.i), z0 = wz(q.j), x1 = x0 + q.w, z1 = z0 + q.h, h = q.k / 100;
      this._box(b, (x0 + x1) / 2, (h + CAP) / 2, (z0 + z1) / 2, q.w, CAP - h, q.h, 0, 0, 0, 0.7 + r() * 0.3);
      col(x0, h, z0, x1, CAP, z1);
    }
    // floor: top face at y 0. The mesh skips the hole, and so does the collider.
    for (const q of this._rects(W, D, (a, c) => inside(a, c) && open[c * W + a] && !hole[c * W + a] ? 1 : -1)) {
      const x0 = wx(q.i), z0 = wz(q.j);
      this._box(b, x0 + q.w / 2, -0.2, z0 + q.h / 2, q.w, 0.4, q.h, 0, 0, 0, 0.85 + r() * 0.2);
    }
    if (!ch.exit) col(ox + 1, -0.5, oz + 1, ox + 1 + P, 0.02, oz + 1 + P, true);
    else for (const q of this._rects(W, D, (a, c) => inside(a, c) && !hole[c * W + a] ? 1 : -1)) col(wx(q.i), -0.5, wz(q.j), wx(q.i) + q.w, 0.02, wz(q.j) + q.h, true);

    // rock props: footprint collider, a few tilted boxes for the look
    for (const p of d.props) {
      col(p.x0, 0, p.z0, p.x1, p.h, p.z1);
      const fw = p.x1 - p.x0, fd = p.z1 - p.z0, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      if (p.pillar) {
        const hh = p.h;
        this._box(b, cx, hh * 0.18, cz, fw * 0.92, hh * 0.36 + 0.02, fd * 0.92, (r() - 0.5) * 0.5, 0, 0, 0.9);
        this._box(b, cx, hh * 0.5, cz, fw * 0.58, hh * 0.34, fd * 0.58, (r() - 0.5) * 0.6, 0, 0, 0.95);
        this._box(b, cx, hh * 0.84, cz, fw * 0.86, hh * 0.34 + 0.02, fd * 0.86, (r() - 0.5) * 0.5, 0, 0, 0.9);
      } else {
        const hh = p.h;
        this._box(b, cx, hh * 0.3, cz, fw * 0.86, hh * 0.62, fd * 0.86, (r() - 0.5) * 0.6, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2, 0.85 + r() * 0.25);
        this._box(b, cx + (r() - 0.5) * fw * 0.2, hh * 0.68, cz + (r() - 0.5) * fd * 0.2, fw * 0.55, hh * 0.5, fd * 0.55, r() * 3, (r() - 0.5) * 0.3, (r() - 0.5) * 0.3, 0.9 + r() * 0.25);
        if (fw * fd >= 4) this._box(b, cx + fw * 0.3, 0.2, cz - fd * 0.3, 0.7, 0.4, 0.6, r() * 3, 0, 0, 1);
      }
    }

    // visual only: thin uneven floor slabs, stalactites, stalagmites
    const cellOpen = (x, z) => { const a = Math.floor(x) - ox, c = Math.floor(z) - oz; return a >= 0 && c >= 0 && a < W && c < D && open[c * W + a] && !hole[c * W + a]; };
    const rects = ch.lobe ? [ch.rect, ch.lobe] : [ch.rect];
    const M = ch.rect, area = (M.x1 - M.x0) * (M.z1 - M.z0);
    const nsl = Math.max(2, Math.min(10, Math.round(area / 18)));
    for (let k = 0, t = 0; k < nsl && t < 30; t++) {
      const R = rects[Math.floor(r() * rects.length)];
      const x = R.x0 + 1.5 + r() * Math.max(0.1, R.x1 - R.x0 - 3), z = R.z0 + 1.5 + r() * Math.max(0.1, R.z1 - R.z0 - 3);
      const sw = 1.2 + r() * 2.3, sd = 1.2 + r() * 2.3;
      if (!cellOpen(x - sw / 2, z - sd / 2) || !cellOpen(x + sw / 2, z + sd / 2) || !cellOpen(x - sw / 2, z + sd / 2) || !cellOpen(x + sw / 2, z - sd / 2)) continue;
      const top = 0.03 + r() * 0.04;
      this._box(b, x, top / 2, z, sw, top, sd, r() * 3, 0, 0, 0.75 + r() * 0.45);
      k++;
    }
    const nst = Math.max(6, Math.min(40, Math.round(area / 6)));
    for (let k = 0, t = 0; k < nst && t < 80; t++) {
      const R = rects[Math.floor(r() * rects.length)];
      const x = R.x0 + 0.6 + r() * (R.x1 - R.x0 - 1.2), z = R.z0 + 0.6 + r() * (R.z1 - R.z0 - 1.2);
      const a = Math.floor(x) - ox, c = Math.floor(z) - oz, q = c * W + a;
      if (!open[q] || kind[q] !== 1) continue;
      const h = hg[q], low = h < 3.0;
      const len = low ? 0.12 + r() * 0.25 : 0.3 + r() * 1.3, rad = Math.min(0.3, 0.06 + len * 0.16 + r() * 0.05);
      this._cone(b, x, h, z, rad, len, true, 0.85 + r() * 0.3);
      if (r() < 0.3 && !d.blk[q] && cellOpen(x + 0.5, z + 0.3) && cellOpen(x, z) && cellOpen(x + 0.9, z + 0.7)) this._cone(b, x + 0.5, 0, z + 0.3, rad * 0.9, (low ? 0.1 : 0.2) + r() * 0.5, false, 0.8 + r() * 0.3);
      k++;
    }
    const geo = this._geo(b);
    rec.geos.push(geo);
    rec.group.add(new THREE.Mesh(geo, this.shared.rock));

    // a real exit: the shaft under the gap in the floor, unlit and dark
    if (ch.exit) {
      const h = ch.exit, pb = this._mk(), DEPTH = 30;
      for (const c of h.cells) {
        for (let s = 0; s < 4; s++) {
          const dv = this.DIRS[s];
          if (h.mask.has((c[0] + dv[0]) + "," + (c[1] + dv[1]))) continue;
          const px = c[0] + 0.5 + dv[0] * 0.45, pz = c[1] + 0.5 + dv[1] * 0.45;
          this._box(pb, px, -DEPTH / 2, pz, dv[0] ? 0.1 : 1, DEPTH, dv[1] ? 0.1 : 1, 0, 0, 0, 1);
        }
      }
      this._box(pb, (h.x0 + h.x1) / 2, -DEPTH - 0.1, (h.z0 + h.z1) / 2, h.x1 - h.x0 + 1, 0.2, h.z1 - h.z0 + 1, 0, 0, 0, 1);
      const pg = this._geo(pb);
      rec.geos.push(pg);
      rec.group.add(new THREE.Mesh(pg, this.shared.pit));
    }

    if (d.sealSp) this.addDoor(rec, d.sealSp, "sealed");
    if (d.backSp) this.addDoor(rec, d.backSp, "back");

    // one fixture per lit chamber, hung in the middle of it
    if (ch.lit) {
      const span = Math.max(M.x1 - M.x0, M.z1 - M.z0);
      rec.fixtures.push({
        x: ch.cx, y: Math.min(ch.h - 0.7, 3.0), z: ch.cz,
        base: ch.kind === "wide" ? 15 : ch.kind === "low" ? 10 : 12, dist: Math.max(16, Math.min(26, span * 1.1 + 6)),
        color: 0xd9c4a2, ph: r() * 6.28
      });
    }
    this.tiles.set(key, rec);
    this.group.add(rec.group);
    return rec;
  },

  // A door flat against the inner face of a wall: the sealed arrival door, or the way back.
  addDoor(rec, sp, kind) {
    const S = this.shared, D = this.DIRS[sp.side];
    const alongX = D[0] === 0;                       // the wall runs along x
    const put = (mat, off, y, w, h, dep) => {
      const m = new THREE.Mesh(this.boxGeo, mat);
      const o = off + dep / 2;
      m.position.set(sp.x - D[0] * o, y, sp.z - D[1] * o);
      m.scale.set(alongX ? w : dep, h, alongX ? dep : w);
      rec.group.add(m);
      return m;
    };
    put(S.frame, 0, 1.15, 1.2, 2.3, 0.05);
    put(S.door, 0.05, 1.05, 0.95, 2.1, 0.04);
    if (kind === "sealed") {                         // two bars across it: it will not open
      put(S.frame, 0.09, 0.9, 1.1, 0.12, 0.05);
      put(S.frame, 0.09, 1.5, 1.1, 0.12, 0.05);
    } else put(S.frame, 0.09, 1.0, 0.1, 0.08, 0.05);   // a handle
    rec.doors.push({ kind, x: sp.x, z: sp.z, used: false, gone: false, t: 0 });
  },

  /* ------------------------------------------------------------------
     LIGHTS: a fixed pool of 4, re-aimed at the nearest lit chambers. Fades in and out, never changes count.
     ------------------------------------------------------------------ */
  assignLights() {
    this._aim(true);
  },

  _aim(snap) {
    const p = Player.position, want = [];
    const ranked = this.fixtures.map(f => ({ f, d: (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z) })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length && i < ranked.length; i++) want.push(ranked[i].f);
    this._want = want;
    for (let i = 0; i < this.pool.length; i++) {                 // keep a slot on its fixture while it is still wanted
      const f = this.poolFx[i];
      if (f && !want.includes(f) && snap) this.poolFx[i] = null;
    }
    for (const f of want) {
      if (this.poolFx.includes(f)) continue;
      let slot = this.poolFx.indexOf(null);
      if (slot < 0 && snap) slot = this.poolFx.findIndex(x => !want.includes(x));
      if (slot < 0) continue;                                    // otherwise wait for a slot to fade out
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
      const on = want.includes(f);
      this._cur[i] += ((on ? f.base : 0) - this._cur[i]) * k;
      if (!on && this._cur[i] < 0.05) {                          // fully faded: free the slot, give it to a wanted fixture
        this._cur[i] = 0;
        this.poolFx[i] = null;
        this.pool[i].intensity = 0;
        const next = want.find(w => !this.poolFx.includes(w));
        if (next) this._load(i, next, false);
        continue;
      }
      this.pool[i].intensity = this._cur[i] * (0.96 + 0.04 * Math.sin(this.time * 1.3 + f.ph));
    }
  },

  /* ------------------------------------------------------------------
     STREAMING (the Level 3 way): build the tiles near the player, drop the ones left behind
     ------------------------------------------------------------------ */
  _tileDist(i, j, px, pz) {
    const P = this.P, H = P / 2;
    return Math.hypot(Math.max(0, Math.abs(px - i * P) - H), Math.max(0, Math.abs(pz - j * P) - H));
  },

  _disposeTile(rec) {
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos) g.dispose();
    this.tiles.delete(rec.i + "," + rec.j);
  },

  _plan(px, pz) {
    const P = this.P, H = P / 2, pi = Math.floor((px + H) / P), pj = Math.floor((pz + H) / P);
    const q = [];
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const i = pi + di, j = pj + dj, key = i + "," + j;
      if (this.tiles.has(key)) continue;
      const dd = this._tileDist(i, j, px, pz);
      if (dd < this.BUILD) q.push({ d: dd, i, j, key });
    }
    q.sort((a, b) => a.d - b.d);
    this._queue = q;
    for (const rec of Array.from(this.tiles.values())) if (this._tileDist(rec.i, rec.j, px, pz) > this.DROP) this._disposeTile(rec);
    // forget the cached chambers, passages and tile rasters of tiles far behind: they are rebuilt identically on demand
    const far = (key) => { const s = key.split(","); return Math.abs(+s[0] - pi) > 6 || Math.abs(+s[1] - pj) > 6; };
    for (const m of [this._td, this._chs, this._pass, this._holes]) for (const k of Array.from(m.keys())) if (far(k)) m.delete(k);
    if (this._cands.size > 600) { this._cands.clear(); this._real.clear(); }
  },

  _collect() {
    const p = Player.position;
    this.colliders.length = 0;
    this.doors.length = 0;
    this.fixtures = [];
    for (const rec of this.tiles.values()) {
      rec.dist = this._tileDist(rec.i, rec.j, p.x, p.z);
      for (const f of rec.fixtures) this.fixtures.push(f);
      for (const dr of rec.doors) this.doors.push(dr);
      if (rec.dist < this.COLLIDE) for (const c of rec.colliders) this.colliders.push(c);
    }
  },

  // Called every frame, and with force on enter. Cheap unless the player has moved into a new 6 m cell.
  stream(force) {
    if (!this.active || !this.group || this._dropping) return;
    const p = Player.position, key = Math.floor(p.x / 6) + "," + Math.floor(p.z / 6);
    let changed = false;
    if (force || key !== this._lastKey) { this._lastKey = key; this._plan(p.x, p.z); changed = true; }
    let built = 0;
    while (this._queue.length) {
      const it = this._queue[0];
      if (!force && it.d >= this.NOW && built >= 1) break;          // far tiles are spread over frames; near ones never wait
      this._queue.shift();
      if (this.tiles.has(it.key)) continue;
      this._buildTile(it.i, it.j);
      built++; changed = true;
    }
    if (changed) {
      this._collect();
      this.infoText = this._info0 + " · TILES " + this.tiles.size;
      this._aim(!!force);
    }
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  _flashRestore() {
    if (!this._flashSet) return;
    this._flashSet = false;
    if (typeof Flashlight !== "undefined" && Flashlight.light && typeof CONFIG !== "undefined") {
      Flashlight.light.distance = CONFIG.flashlight.distance;
      if (Flashlight.enabled) Flashlight.light.intensity = CONFIG.flashlight.intensity;
    }
  },

  reset() {
    const wasActive = this.active;
    if (typeof Level9 !== "undefined" && Level9.reset) Level9.reset();      // Level 9 hangs off this reset chain
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of this.tiles.values()) for (const g of rec.geos) g.dispose();
    this.tiles = new Map();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = [];
    this.poolFx = [];
    this.fixtures = [];
    this._cur = [];
    this._want = [];
    this._queue = [];
    this._lastKey = "";
    this.colliders.length = 0;
    this.doors.length = 0;
    this._chs = new Map(); this._pass = new Map(); this._td = new Map(); this._holes = new Map();
    this._cands = new Map(); this._real = new Map(); this._nf = undefined; this._sp = null; this._back = null;
    this.group = null;
    this.active = false;
    this.time = 0;
    this.baseY = 0;
    this._dropping = false;
    this._dropT = 0;
    this._ended = false;
    this.exitPos = null; this.exitInfo = null; this.backPos = null;
    this._flashRestore();
    this._good = null;
    if (wasActive && typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") {
      CameraRig.camera.far = CONFIG.cameraFar;
      CameraRig.camera.updateProjectionMatrix();
    }
  },

  enter(seed, from) {
    // every other level goes first (Level 4's reset also clears Level 5, which clears Level 6, which clears this)
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof Level5 !== "undefined") Level5.reset();
    if (typeof Level6 !== "undefined") Level6.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") { SmilerSystem.reset(); SmilerSystem.detach(); }
    if (typeof HoundSystem !== "undefined") { HoundSystem.reset(); HoundSystem.detach(); }
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.generate(seed);
    this._info0 = this.infoText;
    this.materialSet();
    this.boxGeo = this.boxGeo || new THREE.BoxGeometry(1, 1, 1);
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level8_CaveSystem";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0x8a8478, 0x1a1815, lk.hemi);
    const amb = new THREE.AmbientLight(0x9a9488, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    for (let i = 0; i < lk.poolSize; i++) {            // the fixed pool: 4 lights, never more, never fewer
      const L = new THREE.PointLight(0xd9c4a2, 0, 20, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
      this._cur.push(0);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 50; CameraRig.camera.updateProjectionMatrix(); }
    if (typeof Progression !== 'undefined') Progression.levelEntered(8); GameState.level = 8; if (typeof AudioSystem !== 'undefined') AudioSystem.setLevel(GameState.level);
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    if (typeof Flashlight !== "undefined") Flashlight.init();
    this._flashLimit();
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = this.spawnYaw;
    if (from === 9 && this.exitPos) {                  // climbing back up: beside the nearest hole, not at the sealed arrival door
      Player.position.copy(this.exitPos);
      Player.yaw = 0;
    }
    Player.pitch = 0;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: cross";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 8";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this._good = new THREE.Vector3().copy(Player.position);
    this.stream(true);                                 // the first stretch: every tile within BUILD of the spawn
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 8 · THE CAVE SYSTEM");
  },


  // The flashlight works here, at about a quarter of its range and half its strength.
  _flashLimit() {
    if (typeof Flashlight === "undefined" || !Flashlight.light || typeof CONFIG === "undefined") return;
    const want = CONFIG.flashlight.distance * this.flashRange;
    if (Flashlight.light.distance !== want) Flashlight.light.distance = want;
    if (Flashlight.enabled) Flashlight.light.intensity = CONFIG.flashlight.intensity * this.flashPower;
    this._flashSet = true;
  },

  /* ------------------------------------------------------------------
     INTERACTION
     ------------------------------------------------------------------ */
  tryUse() {
    if (!this.active) return false;
    const p = Player.position;
    let best = null, bestD = 2.1;
    for (const d of this.doors) {
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (!best) return false;
    if (best.kind === "sealed") {
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("THIS DOOR IS SEALED");
      return true;
    }
    if (best.used) return true;
    best.used = true;
    best.t = 0;
    return true;
  },

  prompt() {
    const p = Player.position;
    for (const d of this.doors) {
      if (d.kind !== "back" || d.used || Math.hypot(p.x - d.x, p.z - d.z) > 2.0) continue;
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("E  GO BACK");
      return;
    }
  },

  // A real exit leads down to Level 9 (the end of the run if that level is missing).
  finish() {
    if (this._ended) return;
    this._ended = true;
    if (typeof Level9 !== "undefined" && Level9.enter) {
      const sd = this.seed;
      const go = () => Level9.enter(sd, 8);
      if (typeof VoidTransition !== "undefined") VoidTransition.then(go); else go();
      return;
    }
    GameState.exitReached = true;
    const done = () => {
      if (typeof Game !== "undefined" && Game.complete) Game.complete();
      // the Void asks for pointer lock again when it clears; keep the cursor free on the results screen
      setTimeout(() => { if (GameState.phase === "complete" && document.pointerLockElement) document.exitPointerLock(); }, 2000);
    };
    if (typeof VoidTransition !== "undefined") VoidTransition.then(done); else done();
  },

  goBack() {
    const sd = this.seed;
    setTimeout(() => {
      const go = () => { if (typeof Level6 !== "undefined") Level6.enter(sd, 8); };
      if (typeof VoidTransition !== "undefined") VoidTransition.then(go); else go();
    }, 0);
  },

  // Last line of defence behind the colliders: the player is always in an open cell of the cave. If a bad frame ever

  // Last line of defence behind the colliders: the player is always in an open cell of a built tile. If a bad frame
  // ever leaves them anywhere else, they go back to the last good spot.
  _keepIn() {
    const p = Player.position, P = this.P, H = P / 2;
    const rec = this.tiles.get(Math.floor((p.x + H) / P) + "," + Math.floor((p.z + H) / P));
    if (!rec) return;
    const d = rec.d, a = Math.floor(p.x) - d.ox, c = Math.floor(p.z) - d.oz;
    if (a >= 0 && c >= 0 && a < d.W && c < d.D && d.open[c * d.W + a]) {
      if (!this._good) this._good = new THREE.Vector3();
      this._good.set(p.x, p.y, p.z);
    } else if (this._good) {
      p.copy(this._good);
      Player.velocity.set(0, 0, 0);
    }
  },

  // Standing in a real exit (the player's centre over a hole cell, on the floor) starts the drop.
  _checkHole() {
    const p = Player.position, P = this.P, H = P / 2;
    const rec = this.tiles.get(Math.floor((p.x + H) / P) + "," + Math.floor((p.z + H) / P));
    if (!rec || !rec.hole || p.y > this.baseY + 0.45) return;
    if (!rec.hole.mask.has(Math.floor(p.x) + "," + Math.floor(p.z))) return;
    this._startDrop(rec.hole);
  },

  // The floor colliders go, and the floor clamp in the physics (which reads baseY) is lifted, so gravity does the rest.
  _startDrop(hole) {
    this._dropping = true;
    this._dropT = 0;
    this._dropHole = hole;
    this.baseY = -80;
    for (let k = this.colliders.length - 1; k >= 0; k--) if (this.colliders[k].floor) this.colliders.splice(k, 1);
    if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(typeof Level9 !== "undefined" ? "LEVEL 9" : "LEVEL 9 IS NOT BUILT YET");
  },

  _dropStep(dt) {
    this._dropT += dt;
    const p = Player.position, h = this._dropHole, k = Math.min(1, dt * 6);
    p.x += (h.cx - p.x) * k;                            // stay in the shaft while falling
    p.z += (h.cz - p.z) * k;
    Player.velocity.x = 0;
    Player.velocity.z = 0;
    if (this._dropT >= 1.1) this.finish();
  },

  /* ------------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------------ */
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this._flashLimit();
    if (this._dropping) this._dropStep(dt);
    else { this.stream(false); this._keepIn(); this._checkHole(); }

    this._lightT -= dt;
    if (this._lightT <= 0) { this._lightT = 0.2; this._aim(false); }
    this._fadeLights(dt);

    for (const d of this.doors) {
      if (!d.used || d.gone) continue;
      d.t += dt;
      if (d.t < 0.6) continue;
      d.gone = true;
      this.goBack();
    }

    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
  }
};
