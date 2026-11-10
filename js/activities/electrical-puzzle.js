"use strict";

/* ------------------------------------------------------------------
   ELECTRICAL PUZZLE (pure logic: no DOM, no THREE)

   A grid of rotatable circuit pieces. One fixed power source feeds from
   the left edge; every LOAD (a fixed, lamp-like terminal) must end up
   connected back to it. Pieces carry connectors on their sides; two
   neighbouring pieces are joined only when BOTH have a connector facing
   each other.

   Generation is solution-first, never "random and hope":
     1. grow a circuit tree from the source to the loads (and a few
        dead-end spurs) on the grid  -> this is a known-valid solution;
     2. derive each cell's piece type and its solved rotation from that
        tree, lock some pieces at their solved rotation (hints), add
        decoy pieces and damaged cells that are not on the tree;
     3. scramble the free pieces;
     4. validate: the stored solution powers every load, the scramble is
        not already solved, and an independent search (it does not read the
        stored solution) also finds a solution;
     5. on any failure retry with a derived seed; after the retry budget
        fall back to a fixed, hand-checked template.

   Directions: 0 = N, 1 = E, 2 = S, 3 = W.  Connector masks: N=1 E=2 S=4 W=8.
   ------------------------------------------------------------------ */
const ElectricalPuzzle = {
  N: 1, E: 2, S: 4, W: 8,
  DX: [0, 1, 0, -1],
  DZ: [-1, 0, 1, 0],

  // base connector mask of each piece at rotation 0
  BASE: { end: 1, line: 5, elbow: 3, tee: 11, cross: 15 },
  // number of visibly different rotations
  SYMMETRY: { end: 4, line: 2, elbow: 4, tee: 4, cross: 1 },

  // five stations, easiest to hardest
  PROFILES: [
    { w: 4, h: 3, loads: 1, spurs: 0, decoys: 0.25, blocks: 0, lockFrac: 0.50 },
    { w: 4, h: 4, loads: 1, spurs: 1, decoys: 0.35, blocks: 1, lockFrac: 0.35 },
    { w: 5, h: 4, loads: 2, spurs: 1, decoys: 0.40, blocks: 1, lockFrac: 0.25 },
    { w: 5, h: 5, loads: 2, spurs: 2, decoys: 0.45, blocks: 2, lockFrac: 0.15 },
    { w: 6, h: 5, loads: 3, spurs: 2, decoys: 0.50, blocks: 2, lockFrac: 0.05 }
  ],

  // fixed fallback circuits ('.' empty). Digits are the SOLVED connector mask in hex
  // (1..f); 'S' marks the source cell, 'L' a load. Hand-checked by the unit test.
  FALLBACKS: [
    { w: 4, h: 3, rows: ["SAC.", "..5.", "..3L"] },
    { w: 4, h: 4, rows: ["SC..", ".5..", ".3AL", "...."] }
  ],


  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  rotMask(mask, r) {
    r = ((r % 4) + 4) % 4;
    return ((mask << r) | (mask >> (4 - r))) & 15;
  },
  maskOf(cell, rot) { return cell && cell.kind !== "block" ? this.rotMask(cell.base, rot) : 0; },
  idx(p, x, z) { return z * p.w + x; },
  opposite(d) { return (d + 2) & 3; },

  /* ---- evaluation ------------------------------------------------ */

  // Which cells does the source power, given a rotation per cell?
  evaluate(p, rot) {
    const powered = new Uint8Array(p.w * p.h);
    const q = [p.source];
    powered[p.source] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const i = q[qi], x = i % p.w, z = (i / p.w) | 0;
      const m = this.maskOf(p.cells[i], rot[i]);
      for (let d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        const nx = x + this.DX[d], nz = z + this.DZ[d];
        if (nx < 0 || nz < 0 || nx >= p.w || nz >= p.h) continue;
        const ni = nz * p.w + nx;
        if (powered[ni] || !p.cells[ni]) continue;
        if (this.maskOf(p.cells[ni], rot[ni]) & (1 << this.opposite(d))) { powered[ni] = 1; q.push(ni); }
      }
    }
    let lit = 0;
    for (const l of p.loads) if (powered[l]) lit++;
    return { powered, litLoads: lit, totalLoads: p.loads.length, solved: lit === p.loads.length };
  },

  isSolved(p, rot) { return this.evaluate(p, rot).solved; },

  // The ONLY completion test. `rot` comes from the player; fixed pieces are
  // always read at their locked rotation, so a tampered array cannot unlock them.
  verify(p, rot) {
    if (!p || !rot || rot.length !== p.w * p.h) return false;
    const r = new Array(rot.length);
    for (let i = 0; i < r.length; i++) {
      const c = p.cells[i];
      if (!c) { r[i] = 0; continue; }
      const v = rot[i] | 0;
      r[i] = c.fixed ? c.solvedRot : ((v % 4) + 4) % 4;
    }
    return this.isSolved(p, r);
  },

  /* ---- independent solver ------------------------------------------ */
  // Grows the powered network outward from the source, trying rotations of
  // pieces it newly touches. Reads piece kinds and fixed rotations only,
  // never the stored solution.
  solve(p, budget) {
    budget = budget || 200000;
    const W = p.w, n = p.w * p.h;
    const rot = new Array(n).fill(-1);
    const closed = new Set(); // "i>d" edges declared not-connected
    let nodes = 0;
    for (let i = 0; i < n; i++) {
      const c = p.cells[i];
      if (!c) rot[i] = 0;
      else if (c.fixed) rot[i] = c.solvedRot;
    }
    const mask = (i) => rot[i] < 0 ? 0 : this.maskOf(p.cells[i], rot[i]);
    const flood = () => {
      const seen = new Uint8Array(n);
      const q = [p.source]; seen[p.source] = 1;
      let frontier = null;
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], x = i % W, z = (i / W) | 0, m = mask(i);
        for (let d = 0; d < 4; d++) {
          if (!(m & (1 << d))) continue;
          const nx = x + this.DX[d], nz = z + this.DZ[d];
          if (nx < 0 || nz < 0 || nx >= p.w || nz >= p.h) continue;
          const ni = nz * W + nx;
          if (!p.cells[ni] || seen[ni]) continue;
          if (rot[ni] < 0) { if (!frontier && !closed.has(i + ">" + d)) frontier = { from: i, d, to: ni }; continue; }
          if (mask(ni) & (1 << this.opposite(d))) { seen[ni] = 1; q.push(ni); }
        }
      }
      return { seen, frontier };
    };
    const search = () => {
      if (++nodes > budget) return "budget";
      const { seen, frontier } = flood();
      let all = true;
      for (const l of p.loads) if (!seen[l]) { all = false; break; }
      if (all) return true;
      if (!frontier) return false;
      const c = p.cells[frontier.to], need = 1 << this.opposite(frontier.d);
      const tried = new Set();
      for (let r = 0; r < 4; r++) {
        const m = this.rotMask(c.base, r);
        if (!(m & need) || tried.has(m)) continue;
        tried.add(m);
        rot[frontier.to] = r;
        const res = search();
        if (res) return res;
        rot[frontier.to] = -1;
      }
      // option: this connector simply dangles
      const key = frontier.from + ">" + frontier.d;
      closed.add(key);
      const res = search();
      closed.delete(key);
      return res;
    };
    const res = search();
    if (res === true) return { solved: true, rot: rot.map(v => v < 0 ? 0 : v), nodes };
    return { solved: false, budgetExceeded: res === "budget", nodes };
  },

  /* ---- generation ----------------------------------------------------- */

  generate(seed, difficulty) {
    const d = Math.max(0, Math.min(this.PROFILES.length - 1, difficulty | 0));
    const prof = this.PROFILES[d];
    const tries = 24;
    for (let a = 0; a < tries; a++) {
      const p = this._attempt((seed + Math.imul(a, 0x9E3779B1)) >>> 0, d, prof);
      if (p && this._validate(p)) { p.attempts = a + 1; p.fallback = false; return p; }
    }
    // Last resort: a hand-checked circuit, scrambled by the same machinery.
    for (let a = 0; a < 40; a++) {
      const p = this._fromTemplate(this.FALLBACKS[d < 2 ? d : 1], (seed ^ 0xFA11BAC) + a, d);
      if (p && this._validate(p)) { p.attempts = tries + a + 1; p.fallback = true; return p; }
    }
    throw new Error("ElectricalPuzzle: no valid puzzle for seed " + seed + " difficulty " + d);
  },

  _validate(p) {
    // (1) the stored solution powers every load
    if (!this.isSolved(p, p.solution)) return false;
    // (2) the scrambled start is NOT already solved
    if (this.isSolved(p, p.start)) return false;
    // (3) fixed pieces start at their solved rotation
    for (let i = 0; i < p.cells.length; i++) {
      const c = p.cells[i];
      if (c && c.fixed && p.start[i] !== c.solvedRot) return false;
    }
    // (4) an independent search finds a solution too (when it finishes in budget)
    const s = this.solve(p, 150000);
    if (s.solved) return this.verify(p, s.rot);
    return !!s.budgetExceeded; // inconclusive search: (1) already proved solvability
  },

  _attempt(seed, d, prof) {
    const R = this.rng(seed), W = prof.w, H = prof.h, n = W * H;
    const idx = (x, z) => z * W + x;
    const inb = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
    // --- circuit tree ---
    const links = new Array(n).fill(0);            // solved connector mask per cell
    const inTree = new Uint8Array(n);
    const reserved = new Uint8Array(n);            // source / loads: never passed through
    const sz = Math.floor(R() * H), source = idx(0, sz);
    inTree[source] = 1; reserved[source] = 1;
    // loads: spread over the right-hand side, away from the source
    const loads = [];
    let guard = 0;
    while (loads.length < prof.loads && guard++ < 200) {
      const x = Math.floor(W * 0.5 + R() * (W * 0.5)), z = Math.floor(R() * H);
      const i = idx(Math.min(W - 1, x), z);
      if (reserved[i]) continue;
      if (Math.abs(i % W - source % W) + Math.abs(((i / W) | 0) - sz) < 3) continue;
      loads.push(i); reserved[i] = 1;
    }
    if (loads.length < prof.loads) return null;
    const link = (a, b) => {
      const ax = a % W, az = (a / W) | 0, bx = b % W, bz = (b / W) | 0;
      for (let k = 0; k < 4; k++) if (ax + this.DX[k] === bx && az + this.DZ[k] === bz) {
        links[a] |= 1 << k; links[b] |= 1 << this.opposite(k); return;
      }
    };
    // path from a target cell back into the tree: random-weight shortest path
    const connect = (target) => {
      const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
      const done = new Uint8Array(n);
      dist[target] = 0;
      for (let step = 0; step < n; step++) {
        let u = -1, best = Infinity;
        for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
        if (u < 0) break;
        done[u] = 1;
        if (inTree[u] && u !== target) {
          // walk back to the target
          let c = u;
          while (c !== target) { const pv = prev[c]; link(c, pv); inTree[pv] = 1; c = pv; }
          inTree[target] = 1;
          return true;
        }
        const ux = u % W, uz = (u / W) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = ux + this.DX[k], nz = uz + this.DZ[k];
          if (!inb(nx, nz)) continue;
          const ni = idx(nx, nz);
          if (done[ni]) continue;
          // sources and loads are endpoints only: reaching one is allowed only
          // as the target itself, and joining the tree may not happen at one
          if (reserved[ni] && ni !== source) continue;
          if (ni === source) continue;                    // the source keeps one link
          if (inTree[ni] && reserved[ni]) continue;
          const w = dist[u] + 1 + R() * 1.6;
          if (w < dist[ni]) { dist[ni] = w; prev[ni] = u; }
        }
      }
      return false;
    };
    // the source's single link: first step towards the first load
    {
      const first = loads[0];
      // route first load to a neighbour of the source, then link the source in
      const sx = 0, sz2 = sz;
      const nbs = [];
      for (let k = 0; k < 4; k++) {
        const nx = sx + this.DX[k], nz = sz2 + this.DZ[k];
        if (inb(nx, nz) && !reserved[idx(nx, nz)]) nbs.push(idx(nx, nz));
      }
      if (!nbs.length) return null;
      const nb = nbs[Math.floor(R() * nbs.length)];
      inTree[nb] = 1; link(source, nb);
      if (!connect(first)) return null;
    }
    for (let li = 1; li < loads.length; li++) if (!connect(loads[li])) return null;
    // dead-end spurs: short stubs hanging off the tree
    for (let s = 0; s < prof.spurs; s++) {
      const cand = [];
      for (let i = 0; i < n; i++) if (inTree[i] && !reserved[i]) cand.push(i);
      if (!cand.length) break;
      let at = cand[Math.floor(R() * cand.length)];
      const len = 1 + Math.floor(R() * 2);
      for (let k = 0; k < len; k++) {
        const opts = [];
        const ax = at % W, az = (at / W) | 0;
        for (let q = 0; q < 4; q++) {
          const nx = ax + this.DX[q], nz = az + this.DZ[q];
          if (inb(nx, nz) && !inTree[idx(nx, nz)]) opts.push(idx(nx, nz));
        }
        if (!opts.length) break;
        const nx = opts[Math.floor(R() * opts.length)];
        link(at, nx); inTree[nx] = 1; at = nx;
      }
    }
    // --- pieces from the tree ---
    const cells = new Array(n).fill(null), solution = new Array(n).fill(0);
    const kindOf = (m) => {
      const c = ((m & 1) ? 1 : 0) + ((m & 2) ? 1 : 0) + ((m & 4) ? 1 : 0) + ((m & 8) ? 1 : 0);
      if (c === 1) return "end";
      if (c === 4) return "cross";
      if (c === 3) return "tee";
      return (m === 5 || m === 10) ? "line" : "elbow";
    };
    const treeCells = [];
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      const m = links[i], kind = kindOf(m);
      let rot = 0;
      for (let r = 0; r < 4; r++) if (this.rotMask(this.BASE[kind], r) === m) { rot = r; break; }
      cells[i] = { kind, base: this.BASE[kind], fixed: false, solvedRot: rot, role: i === source ? "source" : loads.indexOf(i) >= 0 ? "load" : "wire", tree: true };
      solution[i] = rot;
      if (i === source || loads.indexOf(i) >= 0) cells[i].fixed = true;   // source and loads are bolted down
      else treeCells.push(i);
    }
    // hints: lock a share of the on-circuit pieces at their solved rotation
    const lockN = Math.round(treeCells.length * prof.lockFrac);
    const order = treeCells.slice().sort(() => R() - 0.5);
    for (let k = 0; k < lockN; k++) {
      const c = cells[order[k]];
      if (this.SYMMETRY[c.kind] > 1) c.fixed = true;
    }
    // decoys and damaged cells off the circuit
    const empties = [];
    for (let i = 0; i < n; i++) if (!cells[i]) empties.push(i);
    empties.sort(() => R() - 0.5);
    let blocks = 0;
    for (const i of empties) {
      if (blocks < prof.blocks && R() < 0.5) { cells[i] = { kind: "block", base: 0, fixed: true, solvedRot: 0, role: "block" }; blocks++; continue; }
      if (R() < prof.decoys) {
        const kinds = ["line", "elbow", "elbow", "tee"];
        const kind = kinds[Math.floor(R() * kinds.length)];
        cells[i] = { kind, base: this.BASE[kind], fixed: false, solvedRot: Math.floor(R() * 4), role: "decoy" };
      }
    }
    // --- scramble ---
    const start = new Array(n).fill(0);
    let misplaced = 0, freeCount = 0;
    for (let i = 0; i < n; i++) {
      const c = cells[i];
      if (!c) continue;
      if (c.fixed) { start[i] = c.solvedRot; continue; }
      const sym = this.SYMMETRY[c.kind];
      freeCount++;
      const r = Math.floor(R() * 4);
      start[i] = r;
      if (this.rotMask(c.base, r) !== this.rotMask(c.base, c.solvedRot)) misplaced++;
    }
    if (freeCount && misplaced < Math.min(2, freeCount)) return null;
    return {
      version: 1, seed: seed >>> 0, difficulty: d, w: W, h: H,
      cells, source, loads, solution, start,
      lockedCount: cells.filter(c => c && c.fixed && c.tree && c.role === "wire").length
    };
  },

  _fromTemplate(tpl, seed, d) {
    const R = this.rng(seed >>> 0), W = tpl.w, H = tpl.h, n = W * H;
    const cells = new Array(n).fill(null), solution = new Array(n).fill(0);
    let source = -1; const loads = [];
    const kindOf = (m) => {
      const c = [1, 2, 4, 8].filter(b => m & b).length;
      if (c === 1) return "end"; if (c === 4) return "cross"; if (c === 3) return "tee";
      return (m === 5 || m === 10) ? "line" : "elbow";
    };
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const ch = tpl.rows[z][x], i = z * W + x;
      if (ch === ".") continue;
      let m;
      if (ch === "S") { source = i; m = 2; }          // source feeds east
      else if (ch === "L") { loads.push(i); m = 8; }  // loads take from the west
      else m = parseInt(ch, 16);
      const kind = kindOf(m);
      let rot = 0;
      for (let r = 0; r < 4; r++) if (this.rotMask(this.BASE[kind], r) === m) { rot = r; break; }
      cells[i] = { kind, base: this.BASE[kind], fixed: ch === "S" || ch === "L", solvedRot: rot, role: ch === "S" ? "source" : ch === "L" ? "load" : "wire", tree: true };
      solution[i] = rot;
    }
    const start = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const c = cells[i]; if (!c) continue;
      start[i] = c.fixed ? c.solvedRot : Math.floor(R() * 4);
    }
    return { version: 1, seed: seed >>> 0, difficulty: d, w: W, h: H, cells, source, loads, solution, start, lockedCount: 0 };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ElectricalPuzzle };
