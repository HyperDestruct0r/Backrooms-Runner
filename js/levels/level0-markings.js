"use strict";

/* ------------------------------------------------------------------
   LEVEL 0 WALL MARKINGS
   Pencil, pen and marker left on the walls by whoever was here before.
   Atmosphere only: nothing here is progression, and nothing points at an
   elevator.

   Deterministic: whether a wall face carries a mark, and exactly what it
   is, depends only on the world seed and the face's identity (wall tile +
   facing). Chunks can unload and rebuild any number of times and always
   produce the same marks.

   Rendering: one hand-drawn glyph atlas (a canvas, drawn once), one shared
   material, and ONE merged quad mesh per streamed chunk. Each mark is a
   quad lying 6 mm in front of the wall plane inside a single tile face
   (never wider than the face), so it cannot hang over an opening.
   ------------------------------------------------------------------ */
const Level0Markings = {
  cfg: {
    baseChance: 0.03,        // per eligible wall face
    clusterChance: 0.06,      // per 16 x 16 tile region
    clusterFaceChance: 0.20,
    clusterRadius: 5,
    clusterCell: 16,
    spacing: 4,               // tiles: no two marks closer than this outside clusters
    clusterSpacing: 1,
    tierUncommon: 0.76,       // roll < 0.76 common, < 0.975 uncommon, else rare
    tierRare: 0.975,
    lift: 0.006,              // metres in front of the wall plane
    liftClearTiles: 3,        // kept clear around elevators
    stationClearTiles: 2      // ... and stations
  },

  ATLAS: 1024, CELLS: 8,
  material: null, atlasTex: null,
  _env: null, _envKey: null,
  _passC: new Set(),         // "wx,wz,d" faces taken by the older Pass C drawings
  _passCTiles: new Set(),

  /* ---------------- hashing ---------------- */
  h(seed, a, b, c) {
    let h = (seed ^ 0x9E3779B9) >>> 0;
    h = Math.imul(h ^ (a + 0x7F4A7C15 | 0), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 15) ^ (b + 0x165667B1 | 0), 0xC2B2AE35) >>> 0;
    h = Math.imul(h ^ (h >>> 13) ^ (c + 0x27D4EB2F | 0), 0x85EBCA6B) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  },
  u01(seed, a, b, c) { return this.h(seed, a, b, c) / 4294967296; },
  stream(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /* ---------------- glyph catalogue ----------------
     w,h: base size in metres at scale 1 (aspect of the drawing).
     y: [lo, hi] centre height range, in metres.                    */
  GLYPHS: null,
  buildCatalogue() {
    const G = [];
    const add = (id, tier, w, h, y, draw, extra) => G.push(Object.assign({ id, tier, w, h, y, draw }, extra || {}));
    const A = [0.55, 1.9], LOW = [0.3, 1.1], MID = [0.8, 2.0];
    // ---- common ----
    ["up", "down", "left", "right"].forEach((dir) => {
      add("arrow-" + dir, "common", 0.5, 0.5, A, (c, R) => Level0Markings.dArrow(c, R, dir, false), { arrow: dir });
      add("arrow2-" + dir, "common", 0.55, 0.55, A, (c, R) => Level0Markings.dArrow(c, R, dir, true), { arrow: dir });
    });
    add("x", "common", 0.36, 0.36, A, (c, R) => Level0Markings.dX(c, R));
    add("circle", "common", 0.34, 0.34, A, (c, R) => Level0Markings.dCircle(c, R));
    add("triangle", "common", 0.38, 0.34, A, (c, R) => Level0Markings.dPoly(c, R, [[.5, .08], [.95, .9], [.05, .9], [.5, .08]]));
    add("square", "common", 0.34, 0.34, A, (c, R) => Level0Markings.dPoly(c, R, [[.1, .1], [.9, .12], [.88, .9], [.1, .88], [.1, .1]]));
    add("spiral", "common", 0.4, 0.4, A, (c, R) => Level0Markings.dSpiral(c, R));
    add("zigzag", "common", 0.55, 0.3, A, (c, R) => Level0Markings.dPoly(c, R, [[.05, .7], [.25, .25], [.45, .75], [.65, .25], [.85, .72], [.97, .35]]));
    add("plus", "common", 0.3, 0.3, A, (c, R) => Level0Markings.dPoly(c, R, [[.5, .05], [.5, .95]], [[.05, .5], [.95, .5]]));
    add("tick", "common", 0.34, 0.3, A, (c, R) => Level0Markings.dPoly(c, R, [[.1, .55], [.38, .88], [.92, .12]]));
    add("dots", "common", 0.4, 0.2, A, (c, R) => Level0Markings.dDots(c, R, 3));
    add("star", "common", 0.38, 0.38, A, (c, R) => Level0Markings.dPoly(c, R, [[.5, .05], [.78, .95], [.05, .38], [.95, .38], [.22, .95], [.5, .05]]));
    for (let i = 0; i < 3; i++) add("stick-" + i, "common", 0.34, 0.7, LOW, (c, R) => Level0Markings.dStick(c, R, i));
    add("scribble-loop", "common", 0.45, 0.35, A, (c, R) => Level0Markings.dScribble(c, R, "loop"));
    add("scribble-hatch", "common", 0.4, 0.4, A, (c, R) => Level0Markings.dScribble(c, R, "hatch"));
    add("scribble-cross", "common", 0.35, 0.35, A, (c, R) => Level0Markings.dScribble(c, R, "cross"));
    // ---- uncommon ----
    for (let i = 0; i < 3; i++) add("eye-" + i, "uncommon", 0.62, 0.36, MID, (c, R) => Level0Markings.dEye(c, R, i));
    add("warn-triangle", "uncommon", 0.5, 0.46, MID, (c, R) => Level0Markings.dWarn(c, R), { ink: "red" });
    [["RUN", 0.75], ["NO", 0.5], ["HELP", 0.85], ["LEAVE", 1.0], ["STOP", 0.85], ["BACK", 0.85]].forEach(([w, wm]) =>
      add("word-" + w.toLowerCase(), "uncommon", wm, 0.3, MID, (c, R) => Level0Markings.dWord(c, R, w), { word: w }));
    for (let i = 0; i < 2; i++) add("map-" + i, "uncommon", 0.9, 0.7, MID, (c, R) => Level0Markings.dMap(c, R, i));
    for (let i = 0; i < 2; i++) add("tally-" + i, "uncommon", 0.6, 0.34, A, (c, R) => Level0Markings.dTally(c, R, i));
    add("row-x", "uncommon", 0.9, 0.22, A, (c, R) => Level0Markings.dRow(c, R));
    for (let i = 0; i < 2; i++) add("human-" + i, "uncommon", 0.5, 0.95, LOW, (c, R) => Level0Markings.dHuman(c, R, i));
    add("door", "uncommon", 0.4, 0.8, LOW, (c, R) => Level0Markings.dDoor(c, R));
    add("stairs", "uncommon", 0.55, 0.45, A, (c, R) => Level0Markings.dPoly(c, R, [[.05, .9], [.05, .7], [.3, .7], [.3, .5], [.55, .5], [.55, .3], [.8, .3], [.8, .1], [.97, .1]]));
    add("hand", "uncommon", 0.4, 0.5, MID, (c, R) => Level0Markings.dHand(c, R));
    // ---- rare ----
    add("entity-tall", "rare", 0.6, 1.5, LOW, (c, R) => Level0Markings.dEntityTall(c, R), { entity: true });
    add("entity-smiler", "rare", 0.9, 0.9, MID, (c, R) => Level0Markings.dEntitySmiler(c, R), { entity: true });
    add("entity-hound", "rare", 1.2, 0.8, LOW, (c, R) => Level0Markings.dEntityHound(c, R), { entity: true });
    add("entity-beast", "rare", 1.1, 1.3, LOW, (c, R) => Level0Markings.dEntityBeast(c, R), { entity: true });
    add("big-eye", "rare", 1.6, 1.0, MID, (c, R) => Level0Markings.dEye(c, R, 2, true));
    add("crowd", "rare", 1.5, 0.8, LOW, (c, R) => Level0Markings.dCrowd(c, R));
    add("eye-grid", "rare", 1.3, 1.0, MID, (c, R) => Level0Markings.dEyeGrid(c, R));
    add("spiral-eyes", "rare", 1.2, 1.2, MID, (c, R) => Level0Markings.dSpiralEyes(c, R));
    add("tally-wall", "rare", 1.5, 0.9, MID, (c, R) => Level0Markings.dTallyWall(c, R));
    add("many-faces", "rare", 1.4, 1.0, MID, (c, R) => Level0Markings.dFaces(c, R));
    G.forEach((g, i) => { g.cell = i; });
    return G;
  },
  catalogue() { return this.GLYPHS || (this.GLYPHS = this.buildCatalogue()); },
  byTier(tier) { const k = "_t_" + tier; return this[k] || (this[k] = this.catalogue().filter(g => g.tier === tier)); },

  /* ---------------- planning (pure) ---------------- */

  // env: { seed, T, wallH, isWall(x,z), isFloor(x,z), reserved:Set("x,z") of FLOOR tiles to keep clear }
  makeEnv(o) { return o; },

  currentEnv() {
    const last = (typeof LevelGenerator !== "undefined") ? LevelGenerator.last : null;
    if (!last || typeof Level === "undefined") return null;
    const key = last.seed + ":" + (last.elevatorSites ? last.elevatorSites.length : 0);
    if (this._env && this._envKey === key) return this._env;
    const reserved = new Set();
    const mark = (x, z, r) => { for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) reserved.add((x + dx) + "," + (z + dz)); };
    for (const e of (last.elevatorSites || [])) {
      mark(e.x, e.z, this.cfg.liftClearTiles);
      for (const s of e.stations) mark(s.x, s.z, this.cfg.stationClearTiles);
    }
    this._envKey = key;
    this._env = {
      seed: last.seed >>> 0, T: CONFIG.tile, wallH: CONFIG.wallH, reserved,
      isWall: (x, z) => Level.inBounds(x, z) && Level.getTile(x, z) === TILE.WALL,
      isFloor: (x, z) => { if (!Level.inBounds(x, z)) return false; const t = Level.getTile(x, z); return t !== TILE.WALL && t !== TILE.COLUMN; }
    };
    return this._env;
  },

  // Is (wx,wz,d) a face that COULD carry a mark, and with what luck?
  candidate(env, wx, wz, d) {
    const cfg = this.cfg, seed = env.seed;
    // The cheap structural tests come first (a tile lookup each): almost every face in a chunk is buried in wall
    // and can never carry a mark, so the hashes below only run for the few that face a floor. The result is the same.
    if (!env.isWall(wx, wz)) return null;
    const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
    const fx = wx + DX[d], fz = wz + DZ[d];
    if (!env.isFloor(fx, fz)) return null;                     // faces onto a wall, a column or nothing
    const cc = cfg.clusterCell, rx = Math.floor(wx / cc), rz = Math.floor(wz / cc);
    // a cluster cell's centre never changes: look it up once per cell instead of hashing for every face
    const ck = (rx + 65536) * 131072 + (rz + 65536);
    const cm = env._cl || (env._cl = new Map());
    let cl = cm.get(ck);
    if (cl === undefined) {
      cl = null;
      if (this.u01(seed, rx, rz, 0xC1) < cfg.clusterChance) cl = { x: rx * cc + (this.h(seed, rx, rz, 0xC2) % cc), z: rz * cc + (this.h(seed, rx, rz, 0xC3) % cc), rx, rz };
      cm.set(ck, cl);
    }
    let p = cfg.baseChance, cluster = null;
    if (cl && Math.max(Math.abs(wx - cl.x), Math.abs(wz - cl.z)) <= cfg.clusterRadius) { p = cfg.clusterFaceChance; cluster = { rx, rz }; }
    const luck = this.u01(seed, wx, wz, d * 7 + 1);
    if (luck >= p) return null;
    if (env.reserved && env.reserved.has(fx + "," + fz)) return null;
    if (this._passCTiles.has(wx + "," + wz)) return null;      // an older Pass C drawing is here
    return { wx, wz, d, cluster, priority: this.h(seed, wx, wz, d * 7 + 2) };
  },

  planFace(env, wx, wz, d, memo) {
    // numeric memo keys: this runs for every wall face in a chunk and its neighbourhood, and string keys made it the
    // most expensive part of building a chunk. Candidates use the negative half of the key space.
    const key = ((wx + 65536) * 131072 + (wz + 65536)) * 4 + d;
    if (memo && memo.has(key)) return memo.get(key);
    const c = this.candidate(env, wx, wz, d);
    let out = null;
    if (c) {
      const r = c.cluster ? this.cfg.clusterSpacing : this.cfg.spacing;
      let beaten = false;
      for (let dz = -r; dz <= r && !beaten; dz++) {
        for (let dx = -r; dx <= r && !beaten; dx++) {
          for (let k = 0; k < 4; k++) {
            if (!dx && !dz && k === d) continue;
            const o = this.candidateMemo(env, wx + dx, wz + dz, k, memo);
            if (!o) continue;
            if (o.priority < c.priority || (o.priority === c.priority && (o.wx < wx || (o.wx === wx && (o.wz < wz || (o.wz === wz && k < d)))))) { beaten = true; break; }
          }
        }
      }
      if (!beaten) out = this.describe(env, c);
    }
    if (memo) memo.set(key, out);
    return out;
  },
  candidateMemo(env, wx, wz, d, memo) {
    if (!memo) return this.candidate(env, wx, wz, d);
    const key = -(((wx + 65536) * 131072 + (wz + 65536)) * 4 + d) - 1;
    if (memo.has(key)) return memo.get(key);
    const c = this.candidate(env, wx, wz, d);
    memo.set(key, c);
    return c;
  },

  // Everything about one mark, from the face's own hash.
  describe(env, c) {
    const cfg = this.cfg, seed = env.seed, R = this.stream(this.h(seed, c.wx, c.wz, c.d * 7 + 3));
    let roll = R();
    let tier = roll < cfg.tierUncommon ? "common" : roll < cfg.tierRare ? "uncommon" : "rare";
    if (c.cluster && tier === "rare") tier = "uncommon";        // clusters are small scribbles, not showpieces
    const pool = this.byTier(tier);
    // clusters share one "hand": same pen, same family of glyphs
    let hand = c.cluster ? this.h(seed, c.cluster.rx, c.cluster.rz, 0xC4) : this.h(seed, c.wx, c.wz, c.d * 7 + 4);
    const g = pool[Math.floor(R() * pool.length)];
    const inkKeys = ["pencil", "pencil", "blue", "marker", "brown"];
    let ink = g.ink || inkKeys[hand % inkKeys.length];
    if (tier === "rare" && !g.ink && R() < 0.5) ink = "red";
    const faded = R() < 0.28;
    const alpha = faded ? 0.28 + R() * 0.22 : 0.62 + R() * 0.33;
    let scale = tier === "common" ? 0.85 + R() * 0.7 : tier === "uncommon" ? 0.9 + R() * 0.45 : 1.0 + R() * 0.3;
    let w = g.w * scale, h = g.h * scale;
    const maxW = 1.86;
    if (w > maxW) { h *= maxW / w; w = maxW; }
    const tilt = (g.arrow ? 0.14 : 0.08) * (R() * 2 - 1);
    const hwEff = (w / 2) * Math.cos(tilt) + (h / 2) * Math.abs(Math.sin(tilt));
    const hhEff = (h / 2) * Math.cos(tilt) + (w / 2) * Math.abs(Math.sin(tilt));
    const uMax = Math.max(0, env.T / 2 - hwEff - 0.05);
    const u = (R() * 2 - 1) * uMax;
    let y = g.y[0] + R() * (g.y[1] - g.y[0]);
    y = Math.max(hhEff + 0.12, Math.min(env.wallH - 0.12 - hhEff, y));
    return { wx: c.wx, wz: c.wz, d: c.d, tier, glyph: g.id, cell: g.cell, entity: !!g.entity, ink, alpha, w, h, u, y, tilt, cluster: !!c.cluster };
  },

  planChunk(env, x0, z0, x1, z1) {
    const out = [], memo = new Map();
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      for (let d = 0; d < 4; d++) {
        const m = this.planFace(env, x, z, d, memo);
        if (m) out.push(m);
      }
    }
    return out;
  },

  /* ---------------- geometry ---------------- */
  INK: {   // linear-space RGB
    pencil: [0.030, 0.030, 0.034], blue: [0.004, 0.012, 0.090], marker: [0.003, 0.003, 0.003],
    red: [0.150, 0.008, 0.006], brown: [0.050, 0.024, 0.010]
  },
  quads(env, marks) {
    const n = marks.length, pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8), col = new Float32Array(n * 16), idx = new Uint16Array(n * 6);
    const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0], T = env.T, cells = this.CELLS, half = 0.5 / this.ATLAS;
    marks.forEach((m, i) => {
      const nx = DX[m.d], nz = DZ[m.d], rx = nz, rz = -nx;
      const cx = (m.wx + 0.5) * T + nx * (T / 2 + this.cfg.lift) + rx * m.u, cz = (m.wz + 0.5) * T + nz * (T / 2 + this.cfg.lift) + rz * m.u;
      const c = Math.cos(m.tilt), s = Math.sin(m.tilt), hw = m.w / 2, hh = m.h / 2;
      // corners in (right, up): bl, br, tr, tl
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      for (let k = 0; k < 4; k++) {
        const a = pts[k][0] * c - pts[k][1] * s, b = pts[k][0] * s + pts[k][1] * c;
        const o = i * 12 + k * 3;
        pos[o] = cx + rx * a; pos[o + 1] = m.y + b; pos[o + 2] = cz + rz * a;
        nor[o] = nx; nor[o + 1] = 0; nor[o + 2] = nz;
      }
      const cxI = m.cell % cells, cyI = (m.cell / cells) | 0, u0 = cxI / cells + half, u1 = (cxI + 1) / cells - half, v1 = 1 - cyI / cells - half, v0 = 1 - (cyI + 1) / cells + half;
      uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
      const rgb = this.INK[m.ink] || this.INK.pencil;
      for (let k = 0; k < 4; k++) col.set([rgb[0], rgb[1], rgb[2], m.alpha], i * 16 + k * 4);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    return { pos, nor, uv, col, idx };
  },

  /* ---------------- scene integration ---------------- */
  buildChunk(group, x0, z0, x1, z1) {
    const env = this.currentEnv();
    if (!env) return null;
    const marks = this.planChunk(env, x0, z0, x1, z1);
    if (!marks.length) return { mesh: null, x0, z0, x1, z1, count: 0 };
    const q = this.quads(env, marks);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(q.pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(q.nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(q.uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(q.col, 4));
    geo.setIndex(new THREE.BufferAttribute(q.idx, 1));
    const mesh = new THREE.Mesh(geo, this.getMaterial());
    mesh.name = "L0_marks";
    mesh.renderOrder = 1;
    group.add(mesh);
    return { mesh, geo, group, x0, z0, x1, z1, count: marks.length };
  },

  disposeChunk(rec) {
    const m = rec && rec.markings;
    if (!m) return;
    if (m.mesh && m.mesh.parent) m.mesh.parent.remove(m.mesh);
    if (m.geo) m.geo.dispose();      // the material and atlas are shared and stay
    rec.markings = null;
  },

  // Older Pass C drawings claim some faces; keep clear of them. They are
  // generated after the first chunks exist, so loaded chunks are rebuilt.
  reserveFaces(faces) {
    this._passC.clear(); this._passCTiles.clear();
    for (const f of faces) { this._passC.add(f[0] + "," + f[1] + "," + f[2]); this._passCTiles.add(f[0] + "," + f[1]); }
    if (typeof Level === "undefined" || !Level.chunks) return;
    for (const [, rec] of Level.chunks) {
      if (!rec.markings) continue;
      const { x0, z0, x1, z1 } = rec.markings, group = rec.group;
      this.disposeChunk(rec);
      rec.markings = this.buildChunk(group, x0, z0, x1, z1);
    }
  },
  // Reserve more faces without forgetting earlier ones (the unbounded world plans decorations region by region).
  addReservedFaces(faces) {
    for (const f of faces) { this._passC.add(f[0] + "," + f[1] + "," + f[2]); this._passCTiles.add(f[0] + "," + f[1]); }
  },
  resetPassC() { this._passC.clear(); this._passCTiles.clear(); },
  // Level cleared: drop the shared atlas/material (Level.clear disposes them with the chunks).
  resetShared() { this.material = null; this.atlasTex = null; this._env = null; this._envKey = null; this.resetPassC(); },

  getMaterial() {
    if (this.material) return this.material;
    const tex = this.makeAtlas();
    this.atlasTex = tex;
    this.material = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      roughness: 1, metalness: 0, color: 0xffffff
    });
    return this.material;
  },

  /* ---------------- atlas: the drawings themselves ---------------- */
  makeAtlas() {
    const N = this.ATLAS, cell = N / this.CELLS;
    const cv = document.createElement("canvas"); cv.width = cv.height = N;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, N, N);
    const gl = this.catalogue();
    gl.forEach((g) => {
      const cx = (g.cell % this.CELLS) * cell, cy = ((g.cell / this.CELLS) | 0) * cell;
      const R = this.stream(0xB4C400 + g.cell * 7919);
      ctx.save();
      ctx.beginPath(); ctx.rect(cx, cy, cell, cell); ctx.clip();
      ctx.translate(cx, cy);
      const pad = 7, S = cell - pad * 2;
      // drawing space: 0..1 in x and y, y down
      const api = {
        ctx, R, S, pad,
        P: (u, v) => [pad + u * S, pad + v * S],
        line: (pts, w, jit) => this.strokePath(ctx, R, pts.map(p => [pad + p[0] * S, pad + p[1] * S]), w, jit == null ? 1.6 : jit)
      };
      ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineCap = "round"; ctx.lineJoin = "round";
      g.draw(api, R);
      if (g.cell % 3 === 0) this.erase(ctx, R, cell);          // partly rubbed out
      ctx.restore();
    });
    const tex = new THREE.CanvasTexture(cv);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  },
  strokePath(ctx, R, pts, w, jit) {
    if (pts.length < 2) return;
    ctx.lineWidth = w;
    ctx.beginPath();
    const j = () => (R() - 0.5) * jit * 2;
    ctx.moveTo(pts[0][0] + j(), pts[0][1] + j());
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1][0] + pts[i][0]) / 2 + j(), mz = (pts[i - 1][1] + pts[i][1]) / 2 + j();
      ctx.quadraticCurveTo(mx, mz, pts[i][0] + j() * 0.6, pts[i][1] + j() * 0.6);
    }
    ctx.stroke();
  },
  erase(ctx, R, cell) {
    ctx.save(); ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 4; i++) {
      ctx.lineWidth = 6 + R() * 12; ctx.globalAlpha = 0.5 + R() * 0.5; ctx.beginPath();
      ctx.moveTo(R() * cell, R() * cell); ctx.lineTo(R() * cell, R() * cell); ctx.stroke();
    }
    ctx.globalAlpha = 0.6;
    for (let i = 0; i < 70; i++) ctx.fillRect(R() * cell, R() * cell, 1 + R() * 3, 1 + R() * 3);
    ctx.restore();
  },
  W(R, thin) { return thin ? 2.6 + R() * 0.8 : 3.6 + R() * 1.4; },

  /* individual drawings: a = {ctx,R,S,pad,P,line} ; points in 0..1 */
  dArrow(a, R, dir, fat) {
    const w = this.W(R, !fat) + (fat ? 1.5 : 0);
    let shaft = [[0.1, 0.5], [0.9, 0.5]], head = [[0.65, 0.22], [0.92, 0.5], [0.65, 0.78]];
    const rot = { right: (p) => p, left: (p) => [1 - p[0], p[1]], down: (p) => [p[1], p[0]], up: (p) => [p[1], 1 - p[0]] }[dir];
    a.line(shaft.map(rot), w); a.line(head.map(rot), w);
    if (fat) a.line([[0.1, 0.42], [0.8, 0.42]].map(rot), 2);
  },
  dX(a, R) { const w = this.W(R); a.line([[.12, .12], [.88, .9]], w); a.line([[.88, .1], [.14, .88]], w); },
  dCircle(a, R) { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14 * 6.6 + R() * 0.2; pts.push([0.5 + 0.4 * Math.cos(t), 0.5 + 0.4 * Math.sin(t)]); } a.line(pts, this.W(R)); },
  dPoly(a, R, p1, p2) { a.line(p1, this.W(R)); if (p2) a.line(p2, this.W(R)); },
  dSpiral(a, R) { const pts = []; for (let i = 0; i < 36; i++) { const t = i / 36 * 13, r = 0.05 + t * 0.03; pts.push([0.5 + r * Math.cos(t), 0.5 + r * Math.sin(t)]); } a.line(pts, 3.2); },
  dDots(a, R, n) { for (let i = 0; i < n; i++) { const p = a.P(0.2 + i * 0.3, 0.5 + (R() - 0.5) * 0.1); a.ctx.beginPath(); a.ctx.arc(p[0], p[1], 4 + R() * 2, 0, 7); a.ctx.fill(); } },
  dScribble(a, R, kind) {
    const pts = [];
    if (kind === "loop") for (let i = 0; i < 26; i++) { const t = i / 26 * 18; pts.push([0.1 + i / 26 * 0.8 + 0.12 * Math.cos(t), 0.5 + 0.28 * Math.sin(t * 1.1)]); }
    else if (kind === "hatch") for (let i = 0; i < 9; i++) { pts.push([0.1 + R() * 0.1, 0.1 + i * 0.1]); pts.push([0.9 - R() * 0.1, 0.18 + i * 0.1]); }
    else for (let i = 0; i < 14; i++) pts.push([0.1 + R() * 0.8, 0.1 + R() * 0.8]);
    a.line(pts, 2.6, 1.2);
  },
  dStick(a, R, v) {
    const w = this.W(R); const ctx = a.ctx, hp = a.P(0.5, 0.13);
    ctx.lineWidth = w; ctx.beginPath(); ctx.arc(hp[0], hp[1], a.S * 0.1, 0, 7); ctx.stroke();
    a.line([[.5, .25], [.5, .62]], w);
    if (v === 1) { a.line([[.2, .12], [.5, .38], [.8, .12]], w); } else if (v === 2) { a.line([[.5, .35], [.8, .3]], w); a.line([[.5, .35], [.25, .5]], w); } else a.line([[.2, .45], [.5, .35], [.8, .45]], w);
    if (v === 2) { a.line([[.5, .62], [.78, .72], [.85, .95]], w); a.line([[.5, .62], [.3, .85], [.2, .95]], w); }
    else { a.line([[.5, .62], [.3, .95]], w); a.line([[.5, .62], [.7, .95]], w); }
  },
  dEye(a, R, v, big) {
    const w = this.W(R, !big), ctx = a.ctx;
    a.line([[.04, .5], [.25, .22], [.5, .15], [.75, .22], [.96, .5], [.75, .78], [.5, .85], [.25, .78], [.04, .5]], w);
    const c = a.P(0.5, 0.5);
    ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c[0], c[1], a.S * (v === 1 ? 0.1 : 0.16), 0, 7); ctx.stroke();
    if (v !== 1) { ctx.beginPath(); ctx.arc(c[0], c[1], a.S * 0.06, 0, 7); ctx.fill(); }
    if (v === 1) a.line([[.5, .38], [.5, .62]], w + 1);
    if (v === 2 || big) for (let i = 0; i < 6; i++) { const x = 0.15 + i * 0.14; a.line([[x, 0.12 - (i % 2) * 0.04], [x + (x - 0.5) * 0.18, 0.0 + 0.02]], 2.4); }
  },
  dWarn(a, R) { const w = this.W(R); a.line([[.5, .06], [.95, .92], [.05, .92], [.5, .06]], w); a.line([[.5, .36], [.5, .66]], w + 1); a.line([[.5, .78], [.5, .8]], w + 2); },
  FONT: {
    R: [[[0, 1], [0, 0], [.8, 0], [.9, .25], [.8, .5], [0, .5]], [[.45, .5], [.95, 1]]],
    U: [[[0, 0], [0, .8], [.2, 1], [.8, 1], [1, .8], [1, 0]]],
    N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
    O: [[[.5, 0], [.9, .15], [1, .5], [.9, .85], [.5, 1], [.1, .85], [0, .5], [.1, .15], [.5, 0]]],
    H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, .5], [1, .5]]],
    E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, .5], [.7, .5]]],
    L: [[[0, 0], [0, 1], [1, 1]]],
    P: [[[0, 1], [0, 0], [.9, 0], [1, .25], [.9, .5], [0, .5]]],
    A: [[[0, 1], [.5, 0], [1, 1]], [[.2, .65], [.8, .65]]],
    V: [[[0, 0], [.5, 1], [1, 0]]],
    S: [[[1, .1], [.7, 0], [.2, 0], [0, .2], [.2, .45], [.8, .55], [1, .8], [.8, 1], [.3, 1], [0, .9]]],
    T: [[[0, 0], [1, 0]], [[.5, 0], [.5, 1]]],
    B: [[[0, 0], [0, 1], [.7, 1], [.9, .8], [.7, .5], [0, .5]], [[.7, .5], [.9, .3], [.7, 0], [0, 0]]],
    C: [[[1, .1], [.7, 0], [.2, 0], [0, .2], [0, .8], [.2, 1], [.7, 1], [1, .9]]],
    K: [[[0, 0], [0, 1]], [[1, 0], [0, .55]], [[.25, .45], [1, 1]]]
  },
  dWord(a, R, word) {
    const n = word.length, gap = 0.06, cw = (1 - gap * (n - 1)) / n, w = this.W(R, true) + 0.4;
    for (let i = 0; i < n; i++) {
      const g = this.FONT[word[i]]; if (!g) continue;
      const x0 = i * (cw + gap), sk = (R() - 0.5) * 0.08, yo = (R() - 0.5) * 0.08;
      for (const st of g) a.line(st.map(p => [x0 + p[0] * cw + sk * (1 - p[1]), 0.18 + p[1] * 0.64 + yo]), w, 1.2);
    }
  },
  dMap(a, R, v) {
    const w = 2.8;
    if (v === 0) {
      a.line([[.05, .05], [.95, .05], [.95, .95], [.05, .95], [.05, .05]], w);
      a.line([[.05, .45], [.5, .45], [.5, .95]], w); a.line([[.5, .45], [.5, .05]], w); a.line([[.5, .7], [.95, .7]], w);
      a.line([[.65, .28], [.85, .5]], w + 1); a.line([[.85, .28], [.65, .5]], w + 1);
    } else {
      a.line([[.1, .85], [.1, .4], [.45, .4], [.45, .15], [.85, .15], [.85, .6], [.6, .6], [.6, .9]], w);
      a.line([[.1, .85], [.2, .78]], w + 1); a.line([[.6, .9], [.7, .82]], w + 1);
      a.line([[.75, .3], [.95, .5]], w + 1); a.line([[.95, .3], [.75, .5]], w + 1);
    }
  },
  dTally(a, R, v) {
    const w = this.W(R, true), groups = v === 0 ? 1 : 2;
    for (let g = 0; g < groups; g++) {
      const x0 = g * 0.52;
      for (let i = 0; i < 4; i++) a.line([[x0 + 0.06 + i * 0.1, .15 + R() * .05], [x0 + 0.06 + i * 0.1 + (R() - .5) * .04, .85]], w);
      a.line([[x0 + 0.0, .72], [x0 + 0.46, .28]], w);
    }
  },
  dRow(a, R) { const w = this.W(R, true); for (let i = 0; i < 6; i++) { const x = 0.06 + i * 0.16; a.line([[x, .2], [x + .1, .8]], w); a.line([[x + .1, .2], [x, .8]], w); } },
  dHuman(a, R, v) {
    const w = this.W(R, true), ctx = a.ctx;
    const body = (ox, sc) => {
      const hp = a.P(ox + 0.5 * sc, 0.12);
      ctx.lineWidth = w; ctx.beginPath(); ctx.arc(hp[0], hp[1], a.S * 0.09 * sc, 0, 7); ctx.stroke();
      a.line([[ox + .5 * sc, .22], [ox + .3 * sc, .55], [ox + .7 * sc, .55], [ox + .5 * sc, .22]], w);
      a.line([[ox + .3 * sc, .55], [ox + .3 * sc, .95]], w); a.line([[ox + .7 * sc, .55], [ox + .7 * sc, .95]], w);
      a.line([[ox + .5 * sc, .26], [ox + .15 * sc, .5]], w); a.line([[ox + .5 * sc, .26], [ox + .85 * sc, .5]], w);
      ctx.beginPath(); ctx.arc(hp[0] - 4, hp[1] - 1, 1.6, 0, 7); ctx.arc(hp[0] + 4, hp[1] - 1, 1.6, 0, 7); ctx.fill();
    };
    if (v === 0) body(0, 1); else { body(-0.05, 0.55); body(0.5, 0.55); a.line([[.34, .5], [.5, .5]], w); }
  },
  dDoor(a, R) { const w = this.W(R, true); a.line([[.15, .95], [.15, .08], [.85, .08], [.85, .95]], w); a.line([[.15, .95], [.85, .95]], w); const c = a.P(0.72, 0.55); a.ctx.beginPath(); a.ctx.arc(c[0], c[1], 3.5, 0, 7); a.ctx.fill(); },
  dHand(a, R) { const w = this.W(R, true); a.line([[.2, .95], [.18, .55], [.1, .35]], w); a.line([[.18, .55], [.28, .15]], w); a.line([[.35, .55], [.42, .08]], w); a.line([[.5, .55], [.58, .1]], w); a.line([[.65, .6], [.78, .22]], w); a.line([[.2, .95], [.7, .95], [.68, .6]], w); },
  dEntityTall(a, R) {
    const w = 3.2, ctx = a.ctx, hp = a.P(0.5, 0.07);
    ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(hp[0], hp[1], a.S * 0.07, a.S * 0.05, 0, 0, 7); ctx.stroke();
    a.line([[.5, .12], [.5, .6]], w); a.line([[.5, .22], [.3, .4], [.18, .78]], w); a.line([[.5, .22], [.72, .42], [.86, .8]], w);
    a.line([[.5, .6], [.4, .8], [.45, .99]], w); a.line([[.5, .6], [.62, .82], [.55, .99]], w);
    for (let i = 0; i < 5; i++) a.line([[.5, .3 + i * .07], [.5 + (i % 2 ? .1 : -.1), .33 + i * .07]], 2);
  },
  dEntitySmiler(a, R) {
    const w = 3.4, ctx = a.ctx, c = a.P(0.5, 0.5);
    ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c[0], c[1], a.S * 0.44, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(a.P(0.34, 0.38)[0], a.P(0.34, 0.38)[1], a.S * 0.06, 0, 7); ctx.arc(a.P(0.66, 0.38)[0], a.P(0.66, 0.38)[1], a.S * 0.06, 0, 7); ctx.fill();
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16 * Math.PI; pts.push([0.5 - Math.cos(t) * 0.34, 0.6 + Math.sin(t) * 0.22]); }
    a.line(pts, w); for (let i = 1; i < 16; i++) a.line([[pts[i][0], pts[i][1] - .02], [pts[i][0], pts[i][1] + .05]], 1.8);
  },
  dEntityHound(a, R) {
    const w = 3.2, ctx = a.ctx;
    ctx.lineWidth = w; const b = a.P(0.45, 0.5); ctx.beginPath(); ctx.ellipse(b[0], b[1], a.S * 0.3, a.S * 0.15, -0.05, 0, 7); ctx.stroke();
    for (const x of [.25, .35, .6, .7]) a.line([[x, .62], [x + (R() - .5) * .05, .95]], w);
    a.line([[.72, .42], [.9, .32], [1, .4], [.95, .5], [.78, .52]], w); a.line([[.82, .33], [.8, .18]], w); a.line([[.17, .45], [.03, .3]], w);
    a.ctx.beginPath(); a.ctx.arc(a.P(.88, .38)[0], a.P(.88, .38)[1], 2.5, 0, 7); a.ctx.fill();
  },
  dEntityBeast(a, R) {
    const w = 3.6;
    a.line([[.3, .15], [.2, .02]], w); a.line([[.7, .15], [.8, .02]], w);
    a.line([[.3, .15], [.5, .12], [.7, .15], [.75, .3], [.5, .36], [.25, .3], [.3, .15]], w);
    a.line([[.25, .32], [.1, .6], [.05, .98]], w); a.line([[.75, .32], [.9, .6], [.95, .98]], w);
    a.line([[.25, .35], [.3, .7], [.35, .98]], w); a.line([[.75, .35], [.7, .7], [.65, .98]], w);
    a.line([[.4, .22], [.45, .24]], 4); a.line([[.6, .22], [.55, .24]], 4);
  },
  dCrowd(a, R) { for (let i = 0; i < 7; i++) { const ox = i * 0.13 - 0.05, sc = 0.3 + (i % 3) * 0.04; this.dStick({ ctx: a.ctx, S: a.S * sc, pad: a.pad + ox * a.S * 1.05 + a.S * 0.05, P: (u, v) => [a.pad + ox * a.S * 1.05 + a.S * 0.05 + u * a.S * sc, a.pad + a.S * (1 - sc) + v * a.S * sc], line: (pts, w, j) => this.strokePath(a.ctx, R, pts.map(p => [a.pad + ox * a.S * 1.05 + a.S * 0.05 + p[0] * a.S * sc, a.pad + a.S * (1 - sc) + p[1] * a.S * sc]), w * 0.7, 0.8) }, R, i % 3); } },
  dEyeGrid(a, R) { for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const sx = 0.31, ox = c * 0.34 + 0.02, oy = r * 0.33 + 0.08; a.line([[ox, oy + .12], [ox + sx / 2, oy], [ox + sx, oy + .12], [ox + sx / 2, oy + .24], [ox, oy + .12]], 2.4); const p = a.P(ox + sx / 2, oy + .12); a.ctx.beginPath(); a.ctx.arc(p[0], p[1], 3, 0, 7); a.ctx.fill(); } },
  dSpiralEyes(a, R) { for (let i = 0; i < 9; i++) { const t = i / 9 * 11, r = 0.06 + t * 0.034, x = 0.5 + r * Math.cos(t), y = 0.5 + r * Math.sin(t); a.line([[x - .06, y], [x, y - .035], [x + .06, y], [x, y + .035], [x - .06, y]], 2.2); const p = a.P(x, y); a.ctx.beginPath(); a.ctx.arc(p[0], p[1], 2.4, 0, 7); a.ctx.fill(); } },
  dTallyWall(a, R) { for (let g = 0; g < 4; g++) for (let r = 0; r < 2; r++) { const x0 = g * 0.25 + 0.01, y0 = r * 0.5 + 0.05; for (let i = 0; i < 4; i++) a.line([[x0 + i * 0.045, y0], [x0 + i * 0.045 + (R() - .5) * .02, y0 + .38]], 2.6); a.line([[x0 - .02, y0 + .3], [x0 + .2, y0 + .06]], 2.6); } },
  dFaces(a, R) { for (let i = 0; i < 6; i++) { const cx = 0.17 + (i % 3) * 0.33, cy = 0.27 + ((i / 3) | 0) * 0.45, c = a.P(cx, cy); a.ctx.lineWidth = 2.4; a.ctx.beginPath(); a.ctx.arc(c[0], c[1], a.S * 0.12, 0, 7); a.ctx.stroke(); a.ctx.beginPath(); a.ctx.arc(c[0] - 4, c[1] - 2, 1.6, 0, 7); a.ctx.arc(c[0] + 4, c[1] - 2, 1.6, 0, 7); a.ctx.fill(); a.line([[cx - .05, cy + .05], [cx, cy + .08 + (i % 2) * .02], [cx + .05, cy + .05]], 2); } }
};

if (typeof module !== "undefined" && module.exports) module.exports = { Level0Markings };
