// The unbounded Level 0 world: deterministic regions, seams, connectivity, streaming, colliders, merged geometry,
// resource leaks, pooled lights.
const { makeContext, assert, pass } = require("./harness.js");
const h = makeContext(["js/systems/passc.js"]), g = h.g, L = g.Level, W0 = g.Level0World, T = g.CONFIG.tile, TILE = g.TILE;
h.run(`
  var PickupSystem = { generate() {}, reset() {}, beginLevel0() {}, ensureLevel0Around() {} };
  var Level1 = undefined;
  document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });
`, "stubs2");
g.GameState.level = 0; g.GameState.phase = "playing";
const RT = W0.RT;

// ---- regions: deterministic, seam-matched, connected
{
  for (const seed of [1, 483921, 20240607, 4000000000]) {
    const w = W0.create(seed);
    let portRepairs = 0;
    for (let rz = -2; rz <= 1; rz++) for (let rx = -2; rx <= 1; rx++) w.region(rx, rz);
    for (let rz = -2; rz <= 1; rz++) for (let rx = -2; rx < 1; rx++) for (let z = 0; z < RT; z++) {
      const a = w.tile(rx * RT + RT - 1, rz * RT + z) !== TILE.WALL, b = w.tile((rx + 1) * RT, rz * RT + z) !== TILE.WALL;
      assert(a === b, "east/west seam agrees (seed " + seed + ")");
    }
    for (let rz = -2; rz < 1; rz++) for (let rx = -2; rx <= 1; rx++) for (let x = 0; x < RT; x++) {
      const a = w.tile(rx * RT + x, rz * RT + RT - 1) !== TILE.WALL, b = w.tile(rx * RT + x, (rz + 1) * RT) !== TILE.WALL;
      assert(a === b, "north/south seam agrees (seed " + seed + ")");
    }
    assert(w.stats.portRepairs === 0, "no region needed a port repair (" + w.stats.portRepairs + ")");
    // each region is one connected network that reaches all four of its doorways
    for (const reg of w.regions.values()) {
      assert(reg.ports.length === 4, "four doorways per region");
      let first = null; const total = [];
      for (let i = 0; i < reg.tiles.length; i++) if (reg.tiles[i] !== TILE.WALL && reg.tiles[i] !== TILE.COLUMN) { first = i; break; }
      const seen = new Uint8Array(reg.tiles.length), st = [first]; seen[first] = 1; let n = 1;
      while (st.length) { const i = st.pop(), x = i % RT, z = (i / RT) | 0; for (const j of [x > 0 ? i - 1 : -1, x < RT - 1 ? i + 1 : -1, z > 0 ? i - RT : -1, z < RT - 1 ? i + RT : -1]) if (j >= 0 && !seen[j] && reg.tiles[j] !== TILE.WALL && reg.tiles[j] !== TILE.COLUMN) { seen[j] = 1; st.push(j); n++; } }
      let open = 0; for (let i = 0; i < reg.tiles.length; i++) if (reg.tiles[i] !== TILE.WALL && reg.tiles[i] !== TILE.COLUMN) open++;
      assert(n === open, "every open tile of a region is connected (" + n + "/" + open + ")");
    }
  }
  pass("4 seeds x 16 regions: seams match exactly, every region is one connected network with all four doorways, no repairs needed");
  // same region twice, and after dropping, is byte-identical; a different seed differs
  const a = W0.create(99), b = W0.create(99), c = W0.create(100);
  const ra = a.region(-3, 2), rb = b.region(-3, 2), rc = c.region(-3, 2);
  assert(Buffer.compare(Buffer.from(ra.tiles), Buffer.from(rb.tiles)) === 0 && Buffer.compare(Buffer.from(ra.tiles), Buffer.from(rc.tiles)) !== 0, "regions are a pure function of (seed, region)");
  const snap = Buffer.from(ra.tiles); a.regions.clear(); a._drop();
  assert(Buffer.compare(snap, Buffer.from(a.region(-3, 2).tiles)) === 0, "a region rebuilt after being dropped is identical");
  // negative coordinates
  assert(a.tile(-1, -1) === a.region(-1, -1).tiles[(RT - 1) * RT + RT - 1] && a.tile(-RT, -RT) === a.region(-1, -1).tiles[0], "tile lookup is correct across negative coordinates");
  pass("deterministic per (seed, region); identical after eviction; correct for negative coordinates");
  // memory: LRU keeps the cache bounded, pinned regions stay
  const w = W0.create(5); w.maxRegions = 10; w.pin(0, 0);
  for (let rx = 0; rx < 30; rx++) w.region(rx, 0);
  w.trim(29, 0, 2);
  assert(w.regions.size <= 10 + 0 && w.has(0, 0) && w.has(29, 0) && w.has(28, 0), "trim keeps pinned and nearby regions, drops the farthest (" + w.regions.size + ")");
  pass("region cache is bounded: farthest dropped, pinned and nearby kept");
}
// ---- module graph over regions
{
  const w = W0.create(31337); g.MapGraph.reset(); g.MapGraph.provider = w;
  const reg = w.region(0, 0);
  let linked = 0;
  for (const n of reg.nodes.slice(0, 60)) {
    assert(g.MapGraph.nodeAt(n.gx, n.gz) === n, "nodeAt finds the node at its own cell");
    assert(g.MapGraph.nodeById(n.id) === n, "nodeById resolves a global id");
    for (const c of g.MapGraph.connectedCells(n)) { assert(Number.isFinite(c.gx) && Number.isFinite(c.gz), "connected cell is a cell"); linked++; }
  }
  const port = reg.nodes.find(n => n.portLinks);
  assert(port && g.MapGraph.connectedCells(port).some(c => Math.floor(c.gx / W0.RC) !== 0 || Math.floor(c.gz / W0.RC) !== 0), "a doorway node links across the region border");
  assert(g.MapGraph.nodeAt(-1, -1) !== undefined, "nodeAt works at negative cells");
  g.MapGraph.provider = null;
  pass("MapGraph over regions: nodeAt / nodeById / connectedCells (including across a region border) agree (" + linked + " links checked)");
}
// ---- merged wall geometry == the sum of BoxGeometry faces, wound outward
{
  const items = [[1, 1, 1, 4, 2, 6, 4 | 8], [10, 1, 5, 2, 2, 2, 0]];
  const geo = g.MergedBoxes.build(items, 0.5);
  const nFaces = 4 + 6;
  assert(geo.attributes.position.count === nFaces * 4 && geo.index.count === nFaces * 6, "face count: skipped faces are really absent (" + geo.attributes.position.count / 4 + ")");
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, U = geo.attributes.uv.array, I = geo.index.array;
  for (let f = 0; f < nFaces; f++) for (let t = 0; t < 2; t++) {
    const a = I[f * 6 + t * 3], b = I[f * 6 + t * 3 + 1], c = I[f * 6 + t * 3 + 2];
    const e1 = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert(n[0] * N[a * 3] + n[1] * N[a * 3 + 1] + n[2] * N[a * 3 + 2] > 0, "triangle winds toward its normal (face " + f + ")");
  }
  // wall UV scale: a +z face 4 m wide, 2 m tall at 0.5 tiles/m -> u 0..2, v 0..1 (as applyBoxUVs did)
  let found = false;
  for (let f = 0; f < nFaces; f++) if (N[f * 12 + 2] === 1 && Math.abs(P[f * 12] - P[f * 12 + 3]) > 3) { assert(Math.abs(U[f * 8 + 2] - 2) < 1e-6 && Math.abs(U[f * 8 + 1] - 1) < 1e-6, "wall UVs scale as before"); found = true; }
  assert(found, "found the +z face");
  pass("merged box geometry: correct face set, outward winding, original wall UV scale");
}
// ---- build a level and stream a long walk
const seed = 20240607;
assert(L.buildProcedural(h.ctx.scene, seed, {}) === true, "level builds");
const r = g.LevelGenerator.last, W = r.world;
const solid = (x, z) => { const t = W.tile(x, z); return t === TILE.WALL; };
const covered = (x, z) => { const wx = (x + 0.5) * T, wz = (z + 0.5) * T; for (const c of L.colliders) if (wx >= c.min.x && wx <= c.max.x && wz >= c.min.z && wz <= c.max.z && c.min.y < 1 && c.max.y > 1) return true; return false; };
{
  // colliders vs tiles: for chunks around the start, a tile centre is inside a collider exactly when the tile is solid
  g.Player.position.set(r.startStamp.x * T + 1, 0, r.startStamp.z * T + 1); L.stream(true);
  let checked = 0;
  for (let z = r.startStamp.z - 40; z <= r.startStamp.z + 40; z++) for (let x = r.startStamp.x - 40; x <= r.startStamp.x + 40; x++) {
    const t = W.tile(x, z);
    if (t === TILE.WALL) assert(covered(x, z), "solid tile " + x + "," + z + " has a collider"); else assert(!covered(x, z), "open tile " + x + "," + z + " has none");
    checked++;
  }
  const floor = L.colliders.filter(c => c.max.y === 0 && c.min.y === -2).length, ceil = L.colliders.filter(c => c.min.y === g.CONFIG.wallH).length;
  assert(floor >= 25 && ceil >= 25, "floor and ceiling slabs for the 5x5 chunks around the player (" + floor + "/" + ceil + ")");
  pass("colliders match the tiles exactly around the player (" + checked + " tiles), with floor and ceiling slabs");
}
// route: BFS path from the start to elevator 1's front, then walk it frame by frame
const route = (() => {
  const e = r.elevatorSites[1], sx = r.startStamp.x, sz = r.startStamp.z, key = (x, z) => (x + 65536) * 131072 + (z + 65536);
  const prev = new Map([[key(sx, sz), null]]); const q = [[sx, sz]];
  for (let qi = 0; qi < q.length; qi++) {
    const [x, z] = q[qi]; if (x === e.frontX && z === e.frontZ) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, k = key(nx, nz); if (prev.has(k)) continue; const t = W.tile(nx, nz); if (t === TILE.WALL || t === TILE.COLUMN) continue; prev.set(k, [x, z]); q.push([nx, nz]); }
  }
  const path = []; let c = [e.frontX, e.frontZ];
  while (c) { path.push(c); c = prev.get(key(c[0], c[1])); }
  return path.reverse();
})();
{
  L.keepSeconds = 0.5;
  let maxChunks = 0, maxColl = 0, maxUnits = 0, maxFix = 0, maxRegions = 0, lights0 = null, lightsVary = false, frames = 0, bad = 0;
  const lightCount = () => { let n = 0; h.ctx.scene.traverse(o => { if (o.isLight) n++; }); return n; };
  lights0 = lightCount();
  const gen0 = { generated: W.stats.generated, sync: W.stats.syncGenerated, syncMs: W.stats.syncGenMs };
  g.GameState.dtLast = 1 / 60;
  const t0 = Date.now();
  // wall-clock stand-in for the sweep timer
  let simNow = 0; const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + simNow;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = b[0] - a[0], dz = b[1] - a[1], steps = Math.ceil(T / (4.6 / 60));
    g.Player.yaw = Math.atan2(-dx, -dz);
    for (let s = 0; s < steps; s++) {
      g.Player.position.set((a[0] + 0.5 + dx * s / steps) * T, 0, (a[1] + 0.5 + dz * s / steps) * T);
      L.stream(false); simNow += 1000 / 60; frames++;
      if ((frames & 15) === 0) {
        if (lightCount() !== lights0) lightsVary = true;
        maxChunks = Math.max(maxChunks, L.chunks.size); maxColl = Math.max(maxColl, L.colliders.length);
        maxUnits = Math.max(maxUnits, g.LightingSystem.units.length); maxFix = Math.max(maxFix, g.LightingSystem.fixtures.length); maxRegions = Math.max(maxRegions, W.regions.size);
        // the player's own surroundings are always solid where they should be
        const tx = Math.floor(g.Player.position.x / T), tz = Math.floor(g.Player.position.z / T);
        for (let zz = tz - 1; zz <= tz + 1; zz++) for (let xx = tx - 1; xx <= tx + 1; xx++) if (solid(xx, zz) !== covered(xx, zz)) bad++;
      }
    }
  }
  performance.now = realNow;
  assert(bad === 0, "colliders matched the tiles around the player for the whole walk (" + bad + " mismatches)");
  assert(!lightsVary, "the scene's light count never changed during a " + Math.round(route.length * T) + " m walk");
  assert(maxChunks < 80, "loaded chunks stay bounded (max " + maxChunks + ")");
  assert(maxColl < 3000, "live colliders stay bounded (max " + maxColl + ")");
  assert(maxRegions <= W.maxRegions, "region cache stays within its cap (" + maxRegions + ")");
  // units/fixtures must equal what the loaded chunks own: nothing leaks as chunks unload
  let owned = 0; for (const c of L.chunks.values()) owned += c.lights.length;
  assert(g.LightingSystem.units.length === owned, "fixture units == fixtures owned by loaded chunks (" + g.LightingSystem.units.length + " / " + owned + "): no leak");
  assert(g.LightingSystem.fixtures.length === g.LightingSystem.units.length, "no orphaned fixture panels");
  let housings = 0; h.ctx.scene.traverse(o => { if (o.name === "L0_housings") housings++; });
  assert(housings === L.chunks.size - [...L.chunks.values()].filter(c => !c.lights.length).length, "one merged housing mesh per chunk with lights; none left behind by unloaded chunks");
  assert(L.stats.chunksUnloaded > 20, "chunks really were unloaded (" + L.stats.chunksUnloaded + ")");
  console.log("INFO region gen during the walk (build-time planning excluded): " + (W.stats.generated - gen0.generated) + " regions, " + (W.stats.syncGenerated - gen0.sync) + " built synchronously (" + (W.stats.syncGenMs - gen0.syncMs).toFixed(0) + " ms), slowest single build " + W.stats.maxGenMs.toFixed(0) + " ms; build-time planning built " + gen0.sync + " regions synchronously");
  pass("walked " + Math.round(route.length * T) + " m (" + frames + " frames) to a far elevator: " + L.stats.chunksBuilt + " chunks built, " + L.stats.chunksUnloaded + " unloaded; max loaded " + maxChunks + " chunks / " + maxColl + " colliders / " + maxUnits + " fixtures / " + maxRegions + " regions; light count constant; no leaked fixtures; colliders correct throughout");
}
// ---- unload/rebuild determinism of a chunk
{
  const e = r.elevatorSites[2]; g.Player.position.set((e.frontX + 0.5) * T, 0, (e.frontZ + 0.5) * T); L.stream(true);
  const cx = Math.floor(e.frontX / 24), cz = Math.floor(e.frontZ / 24), key = cx + "," + cz;
  const snap = () => { const c = L.chunks.get(key); const walls = c.group.children.find(o => o.name === "L0_walls"); return { w: Buffer.from(walls.geometry.attributes.position.array.buffer).toString("base64"), st: c.lights.map(u => u.state).join(","), n: c.lights.length }; };
  const s1 = snap(); L.unloadChunk(key); L.buildChunk(cx, cz); const s2 = snap();
  assert(s1.w === s2.w && s1.st === s2.st && s1.n > 0, "a chunk rebuilt after unload is identical: walls and every fixture's state");
  pass("unload + rebuild gives an identical chunk (walls, fixtures and their states)");
}
