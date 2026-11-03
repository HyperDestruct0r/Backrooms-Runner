"use strict";

/* Level 10 — The Field. Pure generation layer (no THREE, no DOM, so it can be tested in Node).

   Everything here is a pure function of (seed, integer coordinates). The same seed gives the same field.

   WORLD MODEL
     The ring is at the origin. Level 10 coordinates are its own: the origin is where the player walks in from Level 9.
     Lines. A loose grid of lines, pitch 56 m (+-8 m). Line i along z sits at x = lineX(i), line j along x at z = lineZ(j).
     Plots. A plot is the area between four lines. Wheat fills it.
     Segments. Each stretch of line between two nodes is a hedge (low, always the same height), a fence, a dirt path
       (rare) or nothing. Hedges and fences have one gate gap. A strip of bare ground runs along every one so it can be seen.
     Plot contents. A few plots hold a barn or a shed (empty, with hay), or a lake. Almond water is only ever in a barn.
       One barn, 700 to 1000 m from the origin, holds the way on to Level 11.
     Wheat. Clumps on a 0.9 m jittered grid, each a pure function of its cell. Height is 2.4 to 2.6 m: above the eyes (1.6 m)
       so it blocks the view, below the eyes at the top of a jump (1.6 + 1.14 = 2.74 m). */
const Level10Gen = {
  seed: 0,
  CHUNK: 36,                 // 40 wheat cells
  CELL: 0.9,
  WHEAT_H: 2.5, WHEAT_LO: 0.96, WHEAT_HI: 1.04,
  HEDGE_H: 0.9, HEDGE_T: 0.8,
  FENCE_H: 1.0, FENCE_T: 0.12,
  SP: 56, JIT: 16,
  VERGE: 1.5, PATH_W: 2.6, GATE_W: 3.2,
  RING: { clear: 2.6, outer: 12, free: 26 },       // clearing radius, outer radius, nothing else is built within `free`
  LOCK: 150, LERP_FROM: 12, LERP_TO: 120,
  EXIT: { min: 700, max: 1000 },
  SPAWN_DIST: 15,

  _segs: new Map(), _plots: new Map(), _exit: null,

  /* ------------------------------------------------------------------ hashing (the Level 9 way) */
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

  init(seed) {
    this.seed = seed >>> 0;
    this._segs = new Map(); this._plots = new Map(); this._exit = null;
    this._computeExit();
  },

  /* ------------------------------------------------------------------ lines */
  lineX(i) { return i * this.SP + Math.round((this.hash(i, 0, 401) - 0.5) * this.JIT); },
  lineZ(j) { return j * this.SP + Math.round((this.hash(0, j, 402) - 0.5) * this.JIT); },
  indexAt(v, axis) {
    const f = axis === 0 ? (k) => this.lineX(k) : (k) => this.lineZ(k);
    let i = Math.floor(v / this.SP);
    while (f(i + 1) <= v) i++;
    while (f(i) > v) i--;
    return i;
  },
  rectDist(px, pz, x0, z0, x1, z1) { return Math.hypot(Math.max(0, x0 - px, px - x1), Math.max(0, z0 - pz, pz - z1)); },

  /* ------------------------------------------------------------------ segments */
  // axis "H": along x from node (i,j) to (i+1,j). axis "V": along z from node (i,j) to (i,j+1).
  seg(axis, i, j) {
    const key = axis + i + "," + j, hit = this._segs.get(key);
    if (hit) return hit;
    if (this._segs.size > 4000) this._segs.clear();
    const H = axis === "H";
    const a = H ? this.lineX(i) : this.lineZ(j), b = H ? this.lineX(i + 1) : this.lineZ(j + 1), line = H ? this.lineZ(j) : this.lineX(i);
    const near = H ? this.rectDist(0, 0, a, line, b, line) : this.rectDist(0, 0, line, a, line, b);
    let type = "none";
    if (near >= this.RING.free) {
      const h = this.hash(i, j, H ? 411 : 412);
      type = h < 0.60 ? "hedge" : h < 0.78 ? "fence" : h < 0.825 ? "path" : "none";
    }
    const S = { axis, i, j, type, a, b, line, parts: [], band: null, gate: null };
    if (type !== "none") {
      const V = this.VERGE;
      S.band = H ? { x0: a - V, z0: line - V, x1: b + V, z1: line + V } : { x0: line - V, z0: a - V, x1: line + V, z1: b + V };
      if (type !== "path") {
        const T = (type === "hedge" ? this.HEDGE_T : this.FENCE_T) / 2, len = b - a;
        const g = a + len * (0.25 + 0.5 * this.hash(i, j, 413)), gw = this.GATE_W / 2;
        S.gate = g;
        const spans = [[a - T, g - gw], [g + gw, b + T]];
        for (const [s0, s1] of spans) S.parts.push(H ? { x0: s0, z0: line - T, x1: s1, z1: line + T } : { x0: line - T, z0: s0, x1: line + T, z1: s1 });
      }
    }
    this._segs.set(key, S);
    return S;
  },

  /* ------------------------------------------------------------------ plots */
  // local frame helper: yaw is a multiple of 90 degrees (same convention as Level 9's L9Builder)
  local(st, lx, lz) {
    const cs = Math.round(Math.cos(st.yaw)), sn = Math.round(Math.sin(st.yaw));
    return { x: st.x + lx * cs + lz * sn, z: st.z - lx * sn + lz * cs };
  },
  plot(i, j) {
    const key = i + "," + j, hit = this._plots.get(key);
    if (hit) return hit;
    if (this._plots.size > 3000) this._plots.clear();
    const x0 = this.lineX(i), x1 = this.lineX(i + 1), z0 = this.lineZ(j), z1 = this.lineZ(j + 1);
    const P = { i, j, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, kind: "wheat", st: null, lake: null, tone: this.hash(i, j, 451) };
    const ex = this._exit;
    const isExit = ex && ex.i === i && ex.j === j;
    const free = this.rectDist(0, 0, x0, z0, x1, z1) >= this.RING.free + 4;
    const roll = this.hash(i, j, 421);
    let kind = "wheat";
    if (isExit) kind = "barn";
    else if (free) kind = roll < 0.022 ? "barn" : roll < 0.035 ? "shed" : roll < 0.055 ? "lake" : "wheat";
    P.kind = kind;
    const jx = (this.hash(i, j, 424) - 0.5) * 8, jz = (this.hash(i, j, 425) - 0.5) * 8;
    if (kind === "barn" || kind === "shed") P.st = this._struct(P, kind, isExit, P.cx + jx, P.cz + jz);
    else if (kind === "lake") P.lake = { id: "lake:" + key, x: P.cx + jx * 0.5, z: P.cz + jz * 0.5, r: 9 + 4 * this.hash(i, j, 426) };
    this._plots.set(key, P);
    return P;
  },

  _struct(P, kind, isExit, x, z) {
    const i = P.i, j = P.j, barn = kind === "barn";
    const st = {
      id: kind + ":" + i + "," + j, kind, exit: !!isExit, x, z, i, j,
      yaw: Math.floor(this.hash(i, j, 422) * 4) * Math.PI / 2,
      w: barn ? 9 : 4.2, d: barn ? 14 : 5.4, t: barn ? 0.3 : 0.2,
      wallH: barn ? 4.4 : 2.5, ridgeH: barn ? 6.6 : 3.2,
      doorW: barn ? 3.6 : 1.5, doorH: barn ? 3.4 : 2.0,
      stacks: [], loose: [], water: null, exitAt: null
    };
    const r = this.trng(i, j, 423), hw = st.w / 2, hd = st.d / 2, t = st.t;
    if (barn) {
      // stacks along both side walls, the centre aisle and the door end stay clear
      const fx = 1.2, fz = 0.9, sx = hw - t - fx / 2 - 0.05;
      for (const s of [-1, 1]) for (let lz = -hd + t + fz / 2 + 0.05; lz < hd - 3.6; lz += 1.0) {
        if (r() < 0.55) st.stacks.push({ lx: s * sx, lz, fx, fz, n: 1 + Math.floor(r() * 3) });
      }
    } else {
      const fx = 0.9, fz = 0.8;
      for (const s of [-1, 1]) if (r() < 0.75) st.stacks.push({ lx: s * (hw - t - fx / 2 - 0.05), lz: -hd + t + fz / 2 + 0.05, fx, fz, n: 1 + Math.floor(r() * 2) });
      if (r() < 0.5) st.stacks.push({ lx: (r() < 0.5 ? -1 : 1) * (hw - t - fx / 2 - 0.05), lz: -hd + t + fz * 1.5 + 0.3, fx, fz, n: 1 });
    }
    const nLoose = barn ? 6 + Math.floor(r() * 4) : 3 + Math.floor(r() * 3);
    for (let k = 0; k < nLoose; k++) st.loose.push({ lx: (r() - 0.5) * (st.w - 2 * t - 1.2), lz: (r() - 0.5) * (st.d - 2 * t - 1.2), sx: 0.9 + r() * 1.5, sz: 0.8 + r() * 1.2, c: r() });
    if (barn && st.stacks.length && this.hash(i, j, 427) < 0.14) {
      const s = st.stacks[Math.floor(r() * st.stacks.length)];
      st.water = { lx: s.lx, lz: s.lz, y: s.n * 0.5 };
    }
    if (isExit) st.exitAt = { lx: 0, lz: -hd + 2.8 };
    return st;
  },

  /* ------------------------------------------------------------------ the way on */
  _computeExit() {
    const L = this.EXIT, ang = this.hash(0, 0, 441) * Math.PI * 2, dist = L.min + this.hash(0, 0, 442) * (L.max - L.min);
    const tx = Math.cos(ang) * dist, tz = Math.sin(ang) * dist;
    this._exit = { i: this.indexAt(tx, 0), j: this.indexAt(tz, 1) };
  },
  // { x, z, dist, light:{x,y,z}, st } for the barn that holds the way to Level 11
  exitInfo() {
    const E = this._exit, st = this.plot(E.i, E.j).st, p = this.local(st, st.exitAt.lx, st.exitAt.lz), l = this.local(st, 0, -st.d / 2 + 4);
    return { x: p.x, z: p.z, dist: Math.hypot(p.x, p.z), light: { x: l.x, y: 3.4, z: l.z }, st };
  },

  spawnInfo() {
    const a = this.hash(0, 0, 443) * Math.PI * 2, d = this.SPAWN_DIST;
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
  },

  /* ------------------------------------------------------------------ the look: distance from the ring -> 0..1 */
  lerpT(d) {
    const u = Math.max(0, Math.min(1, (d - this.LERP_FROM) / (this.LERP_TO - this.LERP_FROM)));
    return u * u * (3 - 2 * u);
  },

  /* ------------------------------------------------------------------ wheat */
  cellPos(gi, gj) { return { x: (gi + this.hash(gi, gj, 431)) * this.CELL, z: (gj + this.hash(gi, gj, 432)) * this.CELL }; },
  clump(gi, gj) {
    const p = this.cellPos(gi, gj);
    return {
      x: p.x, z: p.z, yaw: this.hash(gi, gj, 433) * Math.PI, w: 0.18 + 0.12 * this.hash(gi, gj, 434),
      h: this.WHEAT_H * (this.WHEAT_LO + (this.WHEAT_HI - this.WHEAT_LO) * this.hash(gi, gj, 435)),
      lean: (this.hash(gi, gj, 436) - 0.5) * 0.3, shade: 0.88 + 0.24 * this.hash(gi, gj, 437)
    };
  },

  /* ------------------------------------------------------------------ one chunk's plan */
  chunk(ci, cj) {
    const C = this.CHUNK, x0 = ci * C, z0 = cj * C, x1 = x0 + C, z1 = z0 + C;
    const P = { ci, cj, x0, z0, x1, z1, hedges: [], fences: [], paths: [], verges: [], structs: [], lakes: [], excl: [], circles: [], lx: [], lz: [] };
    const clip = (r) => {
      const a = Math.max(r.x0, x0), b = Math.max(r.z0, z0), c = Math.min(r.x1, x1), d = Math.min(r.z1, z1);
      return a < c && b < d ? { x0: a, z0: b, x1: c, z1: d } : null;
    };
    const iA = this.indexAt(x0 - 3, 0), iB = this.indexAt(x1 + 3, 0), jA = this.indexAt(z0 - 3, 1), jB = this.indexAt(z1 + 3, 1);
    for (let i = iA; i <= iB + 1; i++) P.lx.push({ i, x: this.lineX(i) });
    for (let j = jA; j <= jB + 1; j++) P.lz.push({ j, z: this.lineZ(j) });
    for (const axis of ["H", "V"]) for (let j = jA; j <= jB; j++) for (let i = iA; i <= iB; i++) {
      // H segments at node (i, j) are the ones along row j; V segments at node (i, j) are along column i
      const S = this.seg(axis, i, j);
      if (S.type === "none") continue;
      const band = clip(S.band);
      if (!band) continue;
      P.verges.push(band); P.excl.push(band);
      if (S.type === "path") {
        const h = this.PATH_W / 2, r = axis === "H" ? { x0: S.a - h, z0: S.line - h, x1: S.b + h, z1: S.line + h } : { x0: S.line - h, z0: S.a - h, x1: S.line + h, z1: S.b + h };
        const c = clip(r); if (c) P.paths.push(c);
      } else for (const part of S.parts) {
        const c = clip(part);
        if (c) (S.type === "hedge" ? P.hedges : P.fences).push(Object.assign(c, { axis }));
      }
    }
    // plots that touch this chunk (a structure's yard reaches 11 m past its centre, a lake's shore 16 m)
    const pA = this.indexAt(x0 - 22, 0), pB = this.indexAt(x1 + 22, 0), qA = this.indexAt(z0 - 22, 1), qB = this.indexAt(z1 + 22, 1);
    for (let j = qA; j <= qB; j++) for (let i = pA; i <= pB; i++) {
      const pl = this.plot(i, j);
      if (pl.st) {
        const s = pl.st, odd = Math.round(Math.sin(s.yaw)) !== 0, ex = (odd ? s.d : s.w) / 2 + 2.5, ez = (odd ? s.w : s.d) / 2 + 2.5;
        P.excl.push({ x0: s.x - ex, z0: s.z - ez, x1: s.x + ex, z1: s.z + ez });
        if (s.x >= x0 && s.x < x1 && s.z >= z0 && s.z < z1) P.structs.push(s);
      } else if (pl.lake) {
        const l = pl.lake;
        P.circles.push({ x: l.x, z: l.z, r: l.r + 3 });
        if (l.x >= x0 && l.x < x1 && l.z >= z0 && l.z < z1) P.lakes.push(l);
      }
    }
    return P;
  },
  // which plot (i, j) a point is in, from a chunk plan's line lists
  plotIn(P, x, z) {
    let i = P.lx[0].i, j = P.lz[0].j;
    for (const l of P.lx) if (l.x <= x) i = l.i;
    for (const l of P.lz) if (l.z <= z) j = l.j;
    return { i, j };
  },
  excluded(P, x, z) {
    for (const r of P.excl) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
    for (const c of P.circles) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return true; }
    return false;
  }
};
