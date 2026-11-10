"use strict";

/* ------------------------------------------------------------------
   LEVEL 0 WORLD  —  deterministic, lazily generated, unbounded.

   Level 0 used to be one pre-generated 384 x 336 tile map (about 770 x 670 m)
   that was built, path-searched and collided as a whole. That cannot hold
   elevators 500-750 m (straight line) from the start in four directions, so the
   map is now a lattice of REGIONS, each a pure function of (seed, rx, rz):

     region        48 x 48 cells  =  288 x 288 tiles  =  576 x 576 m
     cell          6 x 6 tiles (12 m): the unit the old module generator used
     tile          2 m; stored in a Uint8Array per region (83 KB)

   A region is generated the first time something asks for one of its tiles,
   with the same module vocabulary as before (corridors, corners, junctions,
   long halls, small rooms; spine of straight runs, branching sockets and
   cross-connections that make loops). Only the nearby regions are kept; a
   region that is dropped is rebuilt identically when needed again.

   Seams. Neighbouring regions agree on PORTS: one doorway per shared edge,
   at cell positions derived from a hash of the edge itself (not of either
   region), so both sides carve matching arms. Every region connects all of its
   ports (and, in region 0,0, the start room) into one network before it grows
   anything else, then a flood fill erases any pocket that did not join. So every
   region is internally connected and every pair of neighbours is joined: the
   whole unbounded map is connected, with no pre-computation.

   No DOM, no THREE. Pure data. Tile values are the TILE constants of level0.js
   (re-declared here as numbers so this file can load first).
   ------------------------------------------------------------------ */
const L0W_RT = 288;   // tiles per region side (see Level0World.RT)
const Level0World = {
  CELL: 6,          // tiles per cell
  RC: 48,           // cells per region side
  RT: L0W_RT,       // tiles per region side (RC * CELL); a multiple of the 24-tile mesh chunk
  CHUNK: 24,        // tiles per streamed mesh chunk
  cfg: { growMin: 330, growSpread: 100 },
  PORTS_PER_EDGE: 1,   // doorways per shared region edge (1 matches the old map's corridor density)
  T_FLOOR: 0, T_WALL: 1, T_START: 2, T_EXIT: 4, T_COLUMN: 5, T_DEAD: 6,
  DIR: [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }],

  /* ---------------- hashing / rng ---------------- */
  hash(a, b, c, d) {
    let h = ((a | 0) ^ 0x9E3779B9) >>> 0;
    h = Math.imul(h ^ ((b | 0) + 0x7F4A7C15), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 15) ^ ((c | 0) + 0x165667B1), 0xC2B2AE35) >>> 0;
    h = Math.imul(h ^ (h >>> 13) ^ ((d | 0) + 0x27D4EB2F), 0x85EBCA6B) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  },
  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  create(seed, opts) {
    const w = Object.create(Level0World.WorldProto);
    w.seed = seed >>> 0;
    w.regions = new Map();
    w.overrides = new Map();        // region key -> [[tx, tz, value], ...] (elevator tiles, start tile)
    w.pinned = new Set();
    w.maxRegions = (opts && opts.maxRegions) || 30;
    w.stats = { generated: 0, regenerated: 0, evicted: 0, genMs: 0, maxGenMs: 0, syncGenerated: 0, syncGenMs: 0, floodFixes: 0, portRepairs: 0 };
    // Keys of regions that were evicted and have not been rebuilt yet: only used to count rebuilds in stats, so it is
    // capped (oldest dropped first). Nothing in generation depends on it.
    w._evictedKeys = new Set();
    w._lrx = 1e9; w._lrz = 1e9; w._lastRegion = null; w._lastKey = null;
    w.startTile = null;
    return w;
  }
};

Level0World.WorldProto = {
  /* ---------------- region lookup ---------------- */
  // Regions are keyed by a plain number (no string is built per lookup: tile() runs millions of times a minute).
  key(rx, rz) { return (rx + 32768) * 65536 + (rz + 32768); },
  region(rx, rz) {
    if (rx === this._lrx && rz === this._lrz) return this._lastRegion;
    const k = (rx + 32768) * 65536 + (rz + 32768);
    let r = this.regions.get(k);
    if (!r) r = this._make(rx, rz, k);
    r.touched = this._tick = (this._tick || 0) + 1;
    this._lrx = rx; this._lrz = rz; this._lastRegion = r;
    return r;
  },
  _make(rx, rz, k) {
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const r = Level0World.generateRegion(this, rx, rz);
    const sk = rx + "," + rz, ov = this.overrides.get(sk);
    if (ov) for (const o of ov) r.tiles[(o[1] - rz * Level0World.RT) * Level0World.RT + (o[0] - rx * Level0World.RT)] = o[2];
    this.regions.set(k, r);
    const dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    this.stats.generated++; this.stats.genMs += dt; if (dt > this.stats.maxGenMs) this.stats.maxGenMs = dt;
    this.stats.syncGenerated++; this.stats.syncGenMs += dt;     // built whole because a tile was needed before the sliced prefetch finished
    if (this._evictedKeys.delete(k)) this.stats.regenerated++;
    return r;
  },
  // Start building a region in slices; the caller advances it with step() and adopts the result when done.
  beginRegion(rx, rz) { return { rx, rz, it: Level0World.regionSteps(this, rx, rz), t0: 0 }; },
  stepRegion(job, budgetMs) {
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const start = now();
    if (this.has(job.rx, job.rz)) return true;                  // someone needed it sooner and built it whole
    for (;;) {
      const t0 = now(); const r = job.it.next(); job.t0 += now() - t0;
      if (r.done) { this._adopt(job.rx, job.rz, r.value, job.t0); return true; }
      if (now() - start >= budgetMs) return false;
    }
  },
  _adopt(rx, rz, r, ms) {
    const k = (rx + 32768) * 65536 + (rz + 32768), sk = rx + "," + rz, ov = this.overrides.get(sk);
    if (ov) for (const o of ov) r.tiles[(o[1] - rz * Level0World.RT) * Level0World.RT + (o[0] - rx * Level0World.RT)] = o[2];
    r.touched = this._tick = (this._tick || 0) + 1;
    this.regions.set(k, r);
    this.stats.generated++; this.stats.genMs += ms; if (ms > this.stats.maxGenMs) this.stats.maxGenMs = ms;
    if (this._evictedKeys.delete(k)) this.stats.regenerated++;
  },
  has(rx, rz) { return this.regions.has((rx + 32768) * 65536 + (rz + 32768)); },

  /* ---------------- tiles ---------------- */
  tile(tx, tz) {
    tx = Math.floor(tx); tz = Math.floor(tz);
    const rx = Math.floor(tx / L0W_RT), rz = Math.floor(tz / L0W_RT);
    const r = (rx === this._lrx && rz === this._lrz) ? this._lastRegion : this.region(rx, rz);
    return r.tiles[(tz - rz * L0W_RT) * L0W_RT + (tx - rx * L0W_RT)];
  },
  // Writes a tile that must survive the region being dropped and rebuilt.
  stamp(tx, tz, value) {
    const RT = Level0World.RT;
    const rx = Math.floor(tx / RT), rz = Math.floor(tz / RT), k = rx + "," + rz;
    const r = this.region(rx, rz);
    r.tiles[(tz - rz * RT) * RT + (tx - rx * RT)] = value;
    let list = this.overrides.get(k);
    if (!list) this.overrides.set(k, list = []);
    list.push([tx, tz, value]);
  },
  isFloor(tx, tz) { const t = this.tile(tx, tz); return t !== 1 && t !== 5; },
  isWall(tx, tz) { return this.tile(tx, tz) === 1; },

  /* ---------------- module graph ---------------- */
  nodeAt(gx, gz) {
    const RC = Level0World.RC;
    const rx = Math.floor(gx / RC), rz = Math.floor(gz / RC);
    const r = this.region(rx, rz);
    const i = r.owner[(gz - rz * RC) * RC + (gx - rx * RC)];
    return i < 0 ? null : r.nodes[i];
  },
  nodeById(id) {
    const rid = Math.floor(id / 1024), local = id - rid * 1024;
    const rx = Math.floor(rid / 4096) - 2048, rz = (rid % 4096) - 2048;
    const r = this.regions.get((rx + 32768) * 65536 + (rz + 32768));
    return r ? (r.nodes[local] || null) : null;
  },

  /* ---------------- residency ---------------- */
  pin(rx, rz) { this.pinned.add(rx + "," + rz); },
  _evict(k) {
    this.regions.delete(k); this.stats.evicted++;
    this._evictedKeys.add(k);
    if (this._evictedKeys.size > 256) this._evictedKeys.delete(this._evictedKeys.values().next().value);
  },
  // Forget every resident region (pinned or not). Tile overrides are kept, so rebuilt regions come back identical.
  evictAll() { for (const k of Array.from(this.regions.keys())) this._evict(k); this._drop(); },
  _drop() { this._lrx = 1e9; this._lrz = 1e9; this._lastRegion = null; },
  // Drop regions beyond the cap, farthest first. Pinned regions (elevator and
  // station neighbourhoods) and anything within `keep` regions of the player stay.
  trim(prx, prz, keep) {
    if (this.regions.size <= this.maxRegions) return 0;
    const cands = [];
    for (const [k, r] of this.regions) {
      if (this.pinned.has(r.rx + "," + r.rz)) continue;
      const d = Math.max(Math.abs(r.rx - prx), Math.abs(r.rz - prz));
      if (d <= keep) continue;
      cands.push([d * 1e6 - r.touched, k]);
    }
    cands.sort((a, b) => b[0] - a[0]);
    let n = 0;
    while (this.regions.size > this.maxRegions && n < cands.length) {
      this._evict(cands[n++][1]);
    }
    this._drop();
    return n;
  }
};

/* ==================================================================
   REGION GENERATOR
   ================================================================== */
Level0World.edgePorts = function (world, kind, a, b) {
  // two cell positions along an edge, 2..29, at least 9 apart; a pure function of the edge
  const h1 = Level0World.hash(world.seed, kind === "H" ? 0x48 : 0x56, a, b);
  const h2 = Level0World.hash(world.seed, kind === "H" ? 0x68 : 0x76, a, b);
  if (Level0World.PORTS_PER_EDGE <= 1) return [4 + (h1 % (Level0World.RC - 8))];      // 4 .. RC-5
  const half = Level0World.RC >> 1;
  return [2 + (h1 % (half - 4)), half + 1 + (h2 % (half - 3))];
};

// The generator is a generator function so a region can be built a slice at a time (see Level._work: regions the
// player is walking toward are built a millisecond or two per frame, never in one 10-50 ms block). Run to the end in
// one go it behaves exactly as a plain function; yielding changes nothing about what is produced.
Level0World.generateRegion = function (world, rx, rz) {
  const it = Level0World.regionSteps(world, rx, rz);
  let r; do { r = it.next(); } while (!r.done);
  return r.value;
};
Level0World.regionSteps = function* (world, rx, rz) {
  const L = Level0World, C = L.CELL, W = L.RC, H = L.RC, RT = L.RT, DIR = L.DIR;
  const WALL = L.T_WALL, FLOOR = L.T_FLOOR, COLUMN = L.T_COLUMN, DEAD = L.T_DEAD;
  const Cfg = L.cfg;
  const rng = L.rng(L.hash(world.seed, rx, rz, 0x4C30));
  const tiles = new Uint8Array(RT * RT).fill(WALL);
  const owner = new Int16Array(W * H).fill(-1);
  const nodes = [];
  const rid = (rx + 2048) * 4096 + (rz + 2048);
  const gxBase = rx * W, gzBase = rz * W;
  const opp = (d) => (d + 2) & 3;
  const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < W && gz < H;
  const occ = (gx, gz) => owner[gz * W + gx] >= 0;

  function footprintFree(gx, gz, w, h) {
    if (gx < 0 || gz < 0 || gx + w > W || gz + h > H) return false;
    for (let z = gz; z < gz + h; z++) for (let x = gx; x < gx + w; x++) if (owner[z * W + x] >= 0) return false;
    return true;
  }
  function localFloor(gx, gz, lx, lz, val) {
    const tx = gx * C + lx, tz = gz * C + lz;
    if (tz >= 0 && tz < RT && tx >= 0 && tx < RT) tiles[tz * RT + tx] = val;
  }
  function carveArm(gx, gz, dir) {
    if (dir === 0) for (let z = 0; z <= 3; z++) { localFloor(gx, gz, 2, z, FLOOR); localFloor(gx, gz, 3, z, FLOOR); }
    else if (dir === 2) for (let z = 2; z <= 5; z++) { localFloor(gx, gz, 2, z, FLOOR); localFloor(gx, gz, 3, z, FLOOR); }
    else if (dir === 1) for (let x = 2; x <= 5; x++) { localFloor(gx, gz, x, 2, FLOOR); localFloor(gx, gz, x, 3, FLOOR); }
    else for (let x = 0; x <= 3; x++) { localFloor(gx, gz, x, 2, FLOOR); localFloor(gx, gz, x, 3, FLOOR); }
  }
  function carveRoomCell(gx, gz) { for (let z = 1; z <= 4; z++) for (let x = 1; x <= 4; x++) localFloor(gx, gz, x, z, FLOOR); }
  function openInternalEdge(gx0, gz0, gx1, gz1) {
    if (gx0 === gx1 && gz1 === gz0 + 1) {
      for (let x = 1; x <= 4; x++) { localFloor(gx0, gz0, x, 5, FLOOR); localFloor(gx1, gz1, x, 0, FLOOR); }
    } else if (gx0 === gx1 && gz0 === gz1 + 1) openInternalEdge(gx1, gz1, gx0, gz0);
    else if (gz0 === gz1 && gx1 === gx0 + 1) {
      for (let z = 1; z <= 4; z++) { localFloor(gx0, gz0, 5, z, FLOOR); localFloor(gx1, gz1, 0, z, FLOOR); }
    } else if (gz0 === gz1 && gx0 === gx1 + 1) openInternalEdge(gx1, gz1, gx0, gz0);
  }
  function linkDoor(ax, az, dir) {
    const bx = ax + DIR[dir].x, bz = az + DIR[dir].z;
    if (!inGrid(bx, bz) || !occ(bx, bz)) return false;
    carveArm(ax, az, dir); carveArm(bx, bz, opp(dir));
    return true;
  }
  function addNode(type, gx, gz, w, h) {
    const node = {
      id: rid * 1024 + nodes.length, type, gx: gxBase + gx, gz: gzBase + gz, w, h,
      connections: [], portLinks: null, deadEnd: false, hasExit: false, hasStart: type === "start",
      lightProfile: "NORMAL", dark: false, skipLights: false, anomaly: null, extra: null,
      _lgx: gx, _lgz: gz
    };
    nodes.push(node);
    for (let z = gz; z < gz + h; z++) for (let x = gx; x < gx + w; x++) owner[z * W + x] = nodes.length - 1;
    return node;
  }
  function addEdge(a, b) {
    if (a.connections.indexOf(b.id) < 0) a.connections.push(b.id);
    if (b.connections.indexOf(a.id) < 0) b.connections.push(a.id);
  }
  const sockets = [];
  function pushSockets(node, dirs) {
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      let cx = node._lgx, cz = node._lgz;
      if (d === 1) cx = node._lgx + node.w - 1;
      if (d === 2) cz = node._lgz + node.h - 1;
      if (d === 0) cz = node._lgz;
      if (d === 3) cx = node._lgx;
      if (d === 0 || d === 2) cx = node._lgx + ((node.w > 1 && rng() > 0.5) ? node.w - 1 : 0);
      if (d === 1 || d === 3) cz = node._lgz + ((node.h > 1 && rng() > 0.5) ? node.h - 1 : 0);
      sockets.push({ gx: cx, gz: cz, dir: d, nodeIdx: nodes.indexOf(node) });
    }
  }
  function carveModule(node) {
    const gx = node._lgx, gz = node._lgz;
    if (node.type === "room_small" || node.type === "start") {
      for (let z = 0; z < node.h; z++) for (let x = 0; x < node.w; x++) carveRoomCell(gx + x, gz + z);
      for (let z = 0; z < node.h; z++) for (let x = 0; x < node.w; x++) {
        if (x + 1 < node.w) openInternalEdge(gx + x, gz + z, gx + x + 1, gz + z);
        if (z + 1 < node.h) openInternalEdge(gx + x, gz + z, gx + x, gz + z + 1);
      }
      if (node.type === "room_small" && rng() > 0.55) localFloor(gx, gz, 2, 2, DEAD);
    } else {
      for (let z = 0; z < node.h; z++) for (let x = 0; x < node.w; x++) {
        localFloor(gx + x, gz + z, 2, 2, FLOOR); localFloor(gx + x, gz + z, 3, 2, FLOOR);
        localFloor(gx + x, gz + z, 2, 3, FLOOR); localFloor(gx + x, gz + z, 3, 3, FLOOR);
      }
      for (let z = 0; z < node.h; z++) for (let x = 0; x < node.w; x++) {
        if (x + 1 < node.w) openInternalEdge(gx + x, gz + z, gx + x + 1, gz + z);
        if (z + 1 < node.h) openInternalEdge(gx + x, gz + z, gx + x, gz + z + 1);
      }
    }
  }
  function tryPlace(type, attGX, attGZ, incomingDir) {
    let w = 1, h = 1;
    if (type === "hall_long") {
      const len = 2 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
      if (incomingDir === 1 || incomingDir === 3) { w = len; h = 1; } else { w = 1; h = len; }
    } else if (type === "room_small" && rng() < 0.2) { w = 2; h = 1; }
    let ox = attGX, oz = attGZ;
    if (incomingDir === 3) ox = attGX - (w - 1);
    if (incomingDir === 0) oz = attGZ - (h - 1);
    if (!footprintFree(ox, oz, w, h)) {
      if (w !== 1 || h !== 1) return tryPlace("corridor", attGX, attGZ, incomingDir);
      return null;
    }
    const node = addNode(type, ox, oz, w, h);
    carveModule(node);
    return node;
  }
  const linkNodes = (a, b, dir, ax, az) => { if (linkDoor(ax, az, dir)) { addEdge(a, b); return true; } return false; };

  /* ---- seeds: the start room (region 0,0) and the border ports ---- */
  const seeds = [];     // { gx, gz, node, port: dir | -1 }
  let startNode = null;
  if (rx === 0 && rz === 0) {
    startNode = addNode("start", W >> 1, H >> 1, 1, 1);
    carveModule(startNode);
    seeds.push({ gx: W >> 1, gz: H >> 1, node: startNode, port: -1 });
  }
  const portCells = [];
  for (let dir = 0; dir < 4; dir++) {
    // canonical edge identity: shared by the two regions that meet there
    let kind, ea, eb;
    if (dir === 0) { kind = "H"; ea = rx; eb = rz; }
    else if (dir === 2) { kind = "H"; ea = rx; eb = rz + 1; }
    else if (dir === 3) { kind = "V"; ea = rx; eb = rz; }
    else { kind = "V"; ea = rx + 1; eb = rz; }
    const ps = L.edgePorts(world, kind, ea, eb);
    for (const p of ps) {
      const gx = dir === 1 ? W - 1 : dir === 3 ? 0 : p;
      const gz = dir === 0 ? 0 : dir === 2 ? H - 1 : p;
      if (occ(gx, gz)) continue;
      const node = addNode("corridor", gx, gz, 1, 1);
      carveModule(node);
      carveArm(gx, gz, dir);                      // the doorway across the region border
      node.portLinks = [{ gx: gxBase + gx + DIR[dir].x, gz: gzBase + gz + DIR[dir].z }];
      seeds.push({ gx, gz, node, port: dir });
      portCells.push({ gx, gz, dir });
    }
  }

  yield;
  /* ---- connect every seed into one network ---- */
  // Directed walk with straight runs (the old spine), then a guaranteed shortest-path fallback.
  function connectSeed(s) {
    // direct link to an adjacent node?
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (const d of order) {
      const nx = s.gx + DIR[d].x, nz = s.gz + DIR[d].z;
      if (inGrid(nx, nz) && occ(nx, nz) && nodes[owner[nz * W + nx]] !== s.node && nodes[owner[nz * W + nx]].connections.length > 0) {
        if (linkNodes(s.node, nodes[owner[nz * W + nx]], d, s.gx, s.gz)) return true;
      }
    }
    // targets: any occupied cell that already belongs to the network
    const netCells = [];
    for (let i = 0; i < nodes.length; i++) if (nodes[i] !== s.node && (nodes[i].connections.length > 0 || nodes[i] === seeds[0].node)) netCells.push(nodes[i]);
    if (!netCells.length) return true;               // first seed: the network is just this node
    let best = netCells[0], bd = Infinity;
    for (const n of netCells) { const d = Math.abs(n._lgx - s.gx) + Math.abs(n._lgz - s.gz); if (d < bd) { bd = d; best = n; } }
    const tx = best._lgx, tz = best._lgz;
    let path = null;
    // directed walk
    for (let attempt = 0; attempt < 6 && !path; attempt++) {
      const cells = []; const seen = new Set([s.gz * W + s.gx]);
      let cx = s.gx, cz = s.gz, dir = s.port >= 0 ? opp(s.port) : (Math.abs(tx - cx) >= Math.abs(tz - cz) ? (tx > cx ? 1 : 3) : (tz > cz ? 2 : 0));
      let straight = 0, guard = 0, ok = false;
      while (guard++ < 220) {
        const turnNow = straight >= 2 + Math.floor(rng() * 4);
        const cand = [];
        if (turnNow) {
          const toward = [];
          if (tx !== cx) toward.push(tx > cx ? 1 : 3);
          if (tz !== cz) toward.push(tz > cz ? 2 : 0);
          for (const d of toward) if (d !== dir && d !== opp(dir)) cand.push(d);
          cand.push((dir + (rng() < 0.5 ? 1 : 3)) & 3); cand.push(dir); cand.push((dir + 1) & 3); cand.push((dir + 3) & 3);
        } else {
          cand.push(dir);
          if (rng() < 0.25) cand.push((dir + 1) & 3);
          if (rng() < 0.25) cand.push((dir + 3) & 3);
          cand.push((dir + 1) & 3); cand.push((dir + 3) & 3);
        }
        let moved = false;
        for (const d of cand) {
          const nx = cx + DIR[d].x, nz = cz + DIR[d].z;
          if (!inGrid(nx, nz)) continue;
          if (occ(nx, nz)) {
            const o = nodes[owner[nz * W + nx]];
            if (o === s.node || !(o.connections.length > 0 || o === seeds[0].node)) continue;
            cells.push({ gx: cx, gz: cz, d, end: o }); ok = true; moved = true; break;     // reached the network
          }
          if (seen.has(nz * W + nx)) continue;
          seen.add(nz * W + nx);
          cells.push({ gx: cx, gz: cz, d }); cx = nx; cz = nz;
          if (d === dir) straight++; else { dir = d; straight = 0; }
          moved = true; break;
        }
        if (!moved || ok) break;
      }
      if (ok) path = cells;
    }
    if (!path) {
      // shortest path over free cells to any network cell (randomised neighbour order)
      const prev = new Int16Array(W * H).fill(-2), q = [s.gz * W + s.gx];
      prev[s.gz * W + s.gx] = -1;
      let found = -1, endNode = null, fromCell = -1, endDir = 0;
      for (let qi = 0; qi < q.length && found < 0; qi++) {
        const c = q[qi], cx = c % W, cz = (c / W) | 0;
        const od = [0, 1, 2, 3]; for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = od[i]; od[i] = od[j]; od[j] = t; }
        for (const d of od) {
          const nx = cx + DIR[d].x, nz = cz + DIR[d].z;
          if (!inGrid(nx, nz)) continue;
          const ni = nz * W + nx;
          if (occ(nx, nz)) {
            const o = nodes[owner[ni]];
            if (c === s.gz * W + s.gx || o === s.node) continue;
            if (o.connections.length > 0 || o === seeds[0].node) { found = ni; endNode = o; fromCell = c; endDir = d; break; }
            continue;
          }
          if (prev[ni] !== -2) continue;
          prev[ni] = c; q.push(ni);
        }
      }
      if (found < 0) return false;
      const rev = []; let c = fromCell;
      while (c !== -1) { rev.push(c); c = prev[c]; }
      rev.reverse();
      path = [];
      for (let i = 0; i < rev.length; i++) {
        const cx = rev[i] % W, cz = (rev[i] / W) | 0;
        let d;
        if (i + 1 < rev.length) { const nx = rev[i + 1] % W, nz = (rev[i + 1] / W) | 0; d = nx > cx ? 1 : nx < cx ? 3 : nz > cz ? 2 : 0; }
        else d = endDir;
        path.push({ gx: cx, gz: cz, d, end: i + 1 === rev.length ? endNode : undefined });
      }
    }
    // commit: the path steps are cells to occupy; step i links cell i to cell i+1
    let prevNode = s.node, pgx = s.gx, pgz = s.gz;
    for (let i = 0; i < path.length; i++) {
      const st = path[i];
      if (i === 0 && !(st.gx === s.gx && st.gz === s.gz)) return false;
      const d = st.d;
      const nx = st.gx + DIR[d].x, nz = st.gz + DIR[d].z;
      if (st.end) { linkNodes(prevNode, st.end, d, st.gx, st.gz); return true; }
      let nn = null;
      if (!occ(nx, nz)) {
        const typ = rng() < 0.07 ? "room_small" : "corridor";
        nn = addNode(typ, nx, nz, 1, 1); carveModule(nn);
      } else nn = nodes[owner[nz * W + nx]];
      if (!linkNodes(prevNode, nn, d, st.gx, st.gz)) return false;
      prevNode = nn; pgx = nx; pgz = nz;
    }
    return true;
  }
  for (let i = 0; i < seeds.length; i++) {
    if (i === 0) { if (!seeds[0].node.connections.length) { /* the first seed anchors the network */ } continue; }
    if (!connectSeed(seeds[i])) { world.stats.portRepairs++; }
    yield;
  }

  /* ---- branches: sockets, growth, cross-connections (as the old generator) ---- */
  for (let i = 0; i < nodes.length; i++) {
    if (rng() < 0.5) {
      const n = nodes[i], dirs = [];
      for (let d = 0; d < 4; d++) { const nx = n._lgx + DIR[d].x, nz = n._lgz + DIR[d].z; if (inGrid(nx, nz) && !occ(nx, nz)) dirs.push(d); }
      if (dirs.length) pushSockets(n, [dirs[Math.floor(rng() * dirs.length)]]);
    }
  }
  // branches grow on top of the connecting paths until the region has the old map's local density
  const target = Math.min(W * H - 24, nodes.length + Cfg.growMin + Math.floor(rng() * Cfg.growSpread));
  let guard = 0;
  while (nodes.length < target && sockets.length && guard++ < 6000) {
    if ((guard & 31) === 0) yield;
    const si = Math.floor(rng() * sockets.length), sock = sockets[si];
    sockets.splice(si, 1);
    const ngx = sock.gx + DIR[sock.dir].x, ngz = sock.gz + DIR[sock.dir].z;
    if (!inGrid(ngx, ngz) || occ(ngx, ngz)) continue;
    const roll = rng();
    let type = "corridor";
    if (roll < 0.20) type = "hall_long"; else if (roll < 0.39) type = "corner"; else if (roll < 0.61) type = "junction"; else if (roll < 0.70) type = "room_small";
    const node = tryPlace(type, ngx, ngz, sock.dir);
    if (!node) continue;
    linkDoor(sock.gx, sock.gz, sock.dir);
    addEdge(nodes[sock.nodeIdx], node);
    const out = [];
    if (type === "corridor" || type === "hall_long") {
      out.push(sock.dir);
      if (rng() < 0.52) out.push((sock.dir + 1) & 3);
      if (rng() < 0.42) out.push((sock.dir + 3) & 3);
    } else if (type === "corner") {
      out.push(rng() < 0.5 ? ((sock.dir + 1) & 3) : ((sock.dir + 3) & 3));
      if (rng() < 0.32) out.push(sock.dir);
    } else if (type === "junction") {
      out.push(sock.dir, (sock.dir + 1) & 3, (sock.dir + 3) & 3);
      if (rng() < 0.28) out.push(opp(sock.dir));
    } else {
      const cand = [0, 1, 2, 3].filter((d) => d !== opp(sock.dir));
      const extra = 2 + (rng() < 0.38 ? 1 : 0);
      for (let k = 0; k < extra && cand.length; k++) { const pick = Math.floor(rng() * cand.length); out.push(cand[pick]); cand.splice(pick, 1); }
    }
    pushSockets(node, out);
  }
  yield;
  // loops: link adjacent modules that are not yet connected
  const seenLinks = new Set();
  for (let gz = 0; gz < H; gz++) for (let gx = 0; gx < W; gx++) {
    if (gx === 0 && (gz & 7) === 0) yield;
    if (!occ(gx, gz)) continue;
    const a = owner[gz * W + gx];
    for (const d of [1, 2]) {
      const nx = gx + DIR[d].x, nz = gz + DIR[d].z;
      if (!inGrid(nx, nz) || !occ(nx, nz)) continue;
      const b = owner[nz * W + nx];
      if (a === b) continue;
      const key = a < b ? a + ":" + b : b + ":" + a;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      if (nodes[a].connections.indexOf(nodes[b].id) >= 0) continue;
      const chance = (nodes[a].type === "junction" || nodes[b].type === "junction") ? 0.82 : 0.48;
      if (rng() < chance && linkDoor(gx, gz, d)) addEdge(nodes[a], nodes[b]);
    }
  }
  // sideways growth sockets (kept from the old generator; consumed by nothing here, but they
  // advance the RNG identically per region, which keeps this function stable)
  for (let i = 0; i < nodes.length; i++) rng();

  /* ---- labels: corner / junction / hall by connectivity (labels only) ---- */
  for (const n of nodes) {
    if (n.type === "room_small" || n.type === "start" || n.w * n.h > 1) continue;
    const c = n.connections.length + (n.portLinks ? 1 : 0);
    if (c >= 3) n.type = "junction";
    else if (c === 2) {
      // straight through or a bend?
      let dx = 0, dz = 0, bend = false, first = true;
      for (const id of n.connections) {
        const o = nodes[id - rid * 1024]; if (!o) continue;
        const ax = Math.sign(o._lgx - n._lgx), az = Math.sign(o._lgz - n._lgz);
        if (first) { dx = ax; dz = az; first = false; } else if (ax !== dx || az !== dz) { if (!(ax === -dx && az === -dz)) bend = true; }
      }
      n.type = bend ? "corner" : "corridor";
    }
  }

  /* ---- decoration of the tile map: columns none; speckle; one rare anomaly ---- */
  if (rng() < 0.07 && nodes.length > 8) {
    const an = nodes[2 + Math.floor(rng() * (nodes.length - 3))];
    if (an && !an.hasStart) {
      const r = rng();
      if (r < 0.35) an.anomaly = "object"; else if (r < 0.6) an.skipLights = true; else if (r < 0.85) an.dark = true; else an.anomaly = "odd_door";
    }
  }
  yield;
  for (let i = 0; i < tiles.length; i++) { if (tiles[i] === FLOOR && rng() < 0.03) tiles[i] = DEAD; if ((i & 16383) === 0) yield; }
  yield;

  /* ---- start tile ---- */
  let startTile = null;
  if (startNode) {
    const tx = startNode._lgx * C + 2, tz = startNode._lgz * C + 2;
    if (tiles[tz * RT + tx] !== WALL && tiles[tz * RT + tx] !== COLUMN) { tiles[tz * RT + tx] = L.T_START; startTile = { x: rx * RT + tx, z: rz * RT + tz }; }
  }

  /* ---- connectivity guarantee: flood fill from the first seed, erase pockets, repair ports ---- */
  const seed0 = seeds[0];
  const st0 = (seed0.node._lgz * C + 2) * RT + (seed0.node._lgx * C + 2);
  const seen = new Uint8Array(RT * RT), stack = new Int32Array(RT * RT);
  let sp = 0, start0 = st0;
  if (tiles[start0] === WALL || tiles[start0] === COLUMN) {
    // the anchor tile is always carved (centre of a node); scan for any floor as a last resort
    for (let i = 0; i < tiles.length; i++) if (tiles[i] !== WALL && tiles[i] !== COLUMN) { start0 = i; break; }
  }
  function* flood(from) {
    sp = 0; stack[sp++] = from; seen[from] = 1;
    let pops = 0;
    while (sp) {
      if ((++pops & 4095) === 0) yield;
      const i = stack[--sp], x = i % RT, z = (i / RT) | 0;
      if (x > 0) { const j = i - 1; if (!seen[j] && tiles[j] !== WALL && tiles[j] !== COLUMN) { seen[j] = 1; stack[sp++] = j; } }
      if (x < RT - 1) { const j = i + 1; if (!seen[j] && tiles[j] !== WALL && tiles[j] !== COLUMN) { seen[j] = 1; stack[sp++] = j; } }
      if (z > 0) { const j = i - RT; if (!seen[j] && tiles[j] !== WALL && tiles[j] !== COLUMN) { seen[j] = 1; stack[sp++] = j; } }
      if (z < RT - 1) { const j = i + RT; if (!seen[j] && tiles[j] !== WALL && tiles[j] !== COLUMN) { seen[j] = 1; stack[sp++] = j; } }
    }
  }
  yield* flood(start0);
  yield;
  // any port tile not reached: carve an L corridor to the anchor, then flood again
  for (const p of portCells) {
    const tx = p.gx * C + 2, tz = p.gz * C + 2, i = tz * RT + tx;
    if (seen[i]) continue;
    world.stats.portRepairs++;
    const ax = start0 % RT, az = (start0 / RT) | 0;
    for (let x = Math.min(tx, ax); x <= Math.max(tx, ax); x++) { tiles[tz * RT + x] = FLOOR; tiles[(tz + 1) * RT + x] = FLOOR; }
    for (let z = Math.min(tz, az); z <= Math.max(tz, az); z++) { tiles[z * RT + ax] = FLOOR; tiles[z * RT + ax + 1] = FLOOR; }
    yield* flood(start0);
  }
  let fixes = 0;
  for (let i = 0; i < tiles.length; i++) { if (!seen[i] && tiles[i] !== WALL && tiles[i] !== COLUMN) { tiles[i] = WALL; fixes++; } if ((i & 16383) === 0) yield; }
  world.stats.floodFixes += fixes;

  /* ---- light sites per mesh chunk (24 x 24 tiles; RT/24 chunks per region side) ---- */
  const lightsByChunk = {};
  for (const n of nodes) {
    if (n.lightProfile === "DARK") continue;
    const tx = Math.floor(n._lgx + n.w * 0.5) * C + 2, tz = Math.floor(n._lgz + n.h * 0.5) * C + 2;
    if (tx < 0 || tz < 0 || tx >= RT || tz >= RT || tiles[tz * RT + tx] === WALL || tiles[tz * RT + tx] === COLUMN) continue;
    const ck = Math.floor(tx / L.CHUNK) + (RT / L.CHUNK) * Math.floor(tz / L.CHUNK);
    (lightsByChunk[ck] || (lightsByChunk[ck] = [])).push({ tx: rx * RT + tx, tz: rz * RT + tz, profile: n.lightProfile, node: n });
  }

  return {
    rx, rz, tiles, owner, nodes, lightsByChunk, ports: portCells, startTile,
    touched: 0, decor: null, pickups: null
  };
};

if (typeof module !== "undefined" && module.exports) module.exports = { Level0World };
