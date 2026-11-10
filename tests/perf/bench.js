// Reproducible CPU-side benchmark of Level 0, runnable against ANY checkout (the new tree or the original Pass 4 tree):
//   node --expose-gc tests/perf/bench.js [--root /path/to/other/checkout/] [--json]
// It measures what can be measured without a GPU: world build time, per-frame streaming/lighting cost while walking,
// scene object counts (an upper bound for draw calls), light count, GC activity, retained heap, collision and
// path-search cost. It does NOT measure rendering time on a GPU: there is none here (see README "Performance").
const path = require("path"), fs = require("fs"), v8 = require("v8");
const { PerformanceObserver } = require("perf_hooks");
const args = process.argv.slice(2);
const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : null;
const ROOT = path.resolve(rootArg || path.join(__dirname, "../..")) + "/";
const { makeContext } = require("../activity/harness.js");
const T = 2;
const SEEDS = [20240607, 483921, 777001];
const out = { root: ROOT, node: process.version, cpu: require("os").cpus()[0].model.trim(), cores: require("os").cpus().length };

function ctxFor() {
  const h = makeContext(["js/systems/passc.js"], { root: ROOT });
  h.run(`var PickupSystem = { generate() {}, reset() {}, beginLevel0() {}, ensureLevel0Around() {} }; var Level1 = undefined; var makeWorldBox = () => new THREE.BoxGeometry(); document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });`, "x");
  h.g.GameState.level = 0; h.g.GameState.phase = "playing"; h.g.GameState.dtLast = 1 / 60;
  return h;
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]; };
const gcWatch = () => { const ev = []; const ob = new PerformanceObserver((l) => { for (const e of l.getEntries()) ev.push(e.duration); }); ob.observe({ entryTypes: ["gc"] }); return { stop() { ob.disconnect(); return ev; } }; };
const sceneStats = (h) => { let meshes = 0, lights = 0, groups = 0; h.ctx.scene.traverse((o) => { if (o.isLight) lights++; else if (o.geometry || o.material || o.name === undefined && false) meshes++; }); return { meshes, lights }; };

// ---- 1. build time (generation + plan + collider/mesh build of the first view)
{
  const t = [];
  for (const seed of SEEDS) { const h = ctxFor(); const t0 = performance.now(); const ok = h.g.Level.buildProcedural(h.ctx.scene, seed, {}); t.push(performance.now() - t0); if (!ok) throw new Error("build failed"); }
  out.buildMs = { runs: t.map(Math.round), median: Math.round(q(t, .5)), max: Math.round(Math.max(...t)) };
}

// ---- 2. walking: a fixed 500 m route, 60 simulated frames per second, smooth turning
function route(h, seed) {
  const g = h.g, L = g.Level, sp = g.LevelGenerator.last.startStamp, key = (x, z) => (x + 65536) * 131072 + (z + 65536);
  const dist = new Map([[key(sp.x, sp.z), 0]]), prev = new Map([[key(sp.x, sp.z), null]]); const qq = [[sp.x, sp.z]]; let far = qq[0], fd = 0;
  for (let qi = 0; qi < qq.length; qi++) {
    const [x, z] = qq[qi], d = dist.get(key(x, z)); if (d >= 250) break; if (d > fd) { fd = d; far = [x, z]; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, k = key(nx, nz); if (dist.has(k)) continue; const t = L.getTile(nx, nz); if (t === g.TILE.WALL || t === g.TILE.COLUMN) continue; dist.set(k, d + 1); prev.set(k, [x, z]); qq.push([nx, nz]); }
  }
  const p = []; let c = far; while (c) { p.push(c); c = prev.get(key(c[0], c[1])); } return p.reverse();
}
function walk(seed) {
  const h = ctxFor(), g = h.g, L = g.Level;
  L.buildProcedural(h.ctx.scene, seed, {});
  const rt = route(h, seed);
  const frameMs = [], gc = gcWatch();
  let builds0 = L.stats ? L.stats.chunksBuilt : 0, yaw = 0, frames = 0, simNow = 0;
  const realNow = performance.now.bind(performance);
  if (L.keepSeconds !== undefined) performance.now = () => realNow() + simNow;       // lets the new code's keep-alive timers elapse in simulated time
  let maxMeshes = 0, maxLights = 0, lightsSeen = new Set(), maxUnits = 0;
  // per-chunk build cost (new tree only): explains the frame-time tail, since a frame that builds a chunk pays for it
  const chunkMs = [];
  if (L.buildChunk && L.stats) { const orig = L.buildChunk; L.buildChunk = function () { const t = realNow(); const r = orig.apply(this, arguments); chunkMs.push(realNow() - t); return r; }; }
  for (let i = 1; i < rt.length; i++) {
    const a = rt[i - 1], b = rt[i], dx = b[0] - a[0], dz = b[1] - a[1], steps = Math.ceil(T / (4.6 / 60));
    const want = Math.atan2(-dx, -dz);
    for (let s = 0; s < steps; s++) {
      let dy = want - yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; yaw += dy * Math.min(1, 6 / 60);
      g.Player.yaw = yaw; g.Player.position.set((a[0] + 0.5 + dx * s / steps) * T, 0, (a[1] + 0.5 + dz * s / steps) * T);
      const t0 = realNow();
      L.stream(false);
      g.LightingSystem.update(1 / 60);
      frameMs.push(realNow() - t0); simNow += 1000 / 60; frames++;
      if ((frames & 31) === 0) { const st = sceneStats(h); maxMeshes = Math.max(maxMeshes, st.meshes); lightsSeen.add(st.lights); maxLights = Math.max(maxLights, st.lights); maxUnits = Math.max(maxUnits, g.LightingSystem.units.length); }
    }
  }
  performance.now = realNow;
  const ev = gc.stop(), st = sceneStats(h);
  // objects still in the scene graph that belong to no loaded chunk (leaked fixtures/housings)
  let ownedByChunks = 0; for (const c of L.chunks.values()) ownedByChunks += c.group.children.length;
  return { meters: Math.round(rt.length * T), frames, p50: q(frameMs, .5), p95: q(frameMs, .95), p99: q(frameMs, .99), max: Math.max(...frameMs), over4: frameMs.filter(x => x > 4).length, over16: frameMs.filter(x => x > 16.7).length,
    chunkBuilds: (L.stats ? L.stats.chunksBuilt : null), maxMeshes, finalMeshes: st.meshes, finalLights: st.lights, lightCounts: [...lightsSeen].sort((x, y) => x - y), maxFixtureUnits: maxUnits,
    sceneChildrenOfLevelGroup: L.group ? L.group.children.length : null, loadedChunks: L.chunks.size, colliders: L.colliders.length,
    chunkBuildMs: chunkMs.length ? { n: chunkMs.length, p50: q(chunkMs, .5), p95: q(chunkMs, .95), max: Math.max(...chunkMs) } : null,
    gcEvents: ev.length, gcMs: ev.reduce((x, y) => x + y, 0) };
}
{
  const runs = SEEDS.map((s) => walk(s));
  const agg = (k) => Math.round(q(runs.map(r => r[k]), .5) * 100) / 100;
  out.walk = { runs, median: { p50: agg("p50"), p95: agg("p95"), p99: agg("p99"), max: Math.round(Math.max(...runs.map(r => r.max)) * 10) / 10 } };
}

// ---- 3. retained heap after a build (gc first)
if (global.gc) {
  global.gc(); const base = process.memoryUsage().heapUsed;
  const h = ctxFor(); h.g.Level.buildProcedural(h.ctx.scene, SEEDS[0], {}); global.gc();
  out.heapMB = Math.round((process.memoryUsage().heapUsed - base) / 1048576 * 10) / 10;
  const L = h.g.Level; out.heapDetail = { colliders: L.colliders.length, tilesBytes: L.world ? [...L.world.regions.values()].reduce((a, r) => a + r.tiles.length, 0) : (L.rows * L.cols), regions: L.world ? L.world.regions.size : 0 };
}

// ---- 4. micro: collision resolve (the function every frame runs several times)
{
  const h = ctxFor(), g = h.g, L = g.Level; L.buildProcedural(h.ctx.scene, SEEDS[0], {});
  const sp = g.LevelGenerator.last.startStamp; g.Player.position.set((sp.x + 0.5) * T, 0, (sp.z + 0.5) * T); L.stream(true);
  const src = fs.readFileSync(ROOT + "js/systems/player.js", "utf8");
  const a = src.indexOf("function aabbOverlap"), b = src.indexOf("const Physics = {");
  const vm = require("vm");
  const ctx = vm.createContext({ THREE: h.ctx.THREE, GameState: { noclip: false, creative: false }, Player: { flying: false }, Level: L, console, Math, stepTolerance: () => 0.4, _overlap: {} });
  vm.runInContext(src.slice(a, b) + "\nglobalThis.__r = resolveAxis;", ctx);
  const pos = new h.ctx.THREE.Vector3(L.startPos.x, 0, L.startPos.z), N = 200000, gc = gcWatch();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { pos.x = L.startPos.x + (i % 7) * 0.01; ctx.__r(pos, 0.32, 1.7, "x"); ctx.__r(pos, 0.32, 1.7, "z"); ctx.__r(pos, 0.32, 1.7, "y"); }
  const ms = performance.now() - t0, ev = gc.stop();
  out.resolveAxis = { calls: N * 3, boxes: L.colliders.length, usPerCall: Math.round(ms / (N * 3) * 1000 * 100) / 100, gcEvents: ev.length };
}

// ---- 5. micro: entity path search (a chased entity repaths about every 0.35 s)
{
  const h = ctxFor(), g = h.g, L = g.Level; L.buildProcedural(h.ctx.scene, SEEDS[0], {});
  const sp = g.LevelGenerator.last.startStamp; g.Player.position.set((sp.x + 0.5) * T, 0, (sp.z + 0.5) * T); L.stream(true);
  const src = fs.readFileSync(ROOT + "js/systems/atmosphere.js", "utf8");
  const a = src.indexOf("  buildPath(tx, tz) {"), b = src.indexOf("  setPathToWorld(wx, wz) {");
  const nw = src.indexOf("const NavWindow = {"), nwEnd = src.indexOf("const EntitySystem = {");
  const code = (nw >= 0 ? src.slice(nw, nwEnd) : "") + "\nglobalThis.__E = {\n position: { x: 0, z: 0 },\n tileOf(p) { return { x: Math.floor(p.x / CONFIG.tile), z: Math.floor(p.z / CONFIG.tile) }; },\n walkable(t) { return t !== TILE.WALL && t !== TILE.COLUMN; },\n" + src.slice(a, b) + "};";
  const vm = require("vm");
  const ctx = vm.createContext({ THREE: h.ctx.THREE, Level: L, CONFIG: g.CONFIG, TILE: g.TILE, DIR4: [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }], console, Math, Int16Array, Int32Array, Uint32Array, Array });
  vm.runInContext(code, ctx);
  const E = ctx.__E; E.position = { x: (sp.x + 0.5) * T, z: (sp.z + 0.5) * T };
  // targets: tiles at random offsets around the start that are walkable
  const targets = []; for (let dz = -60; dz <= 60; dz += 3) for (let dx = -60; dx <= 60; dx += 3) { const x = sp.x + dx, z = sp.z + dz; if (L.getTile(x, z) === 0) targets.push([x, z]); }
  const N = 300, gc = gcWatch(); let found = 0; const t0 = performance.now();
  for (let i = 0; i < N; i++) { const t = targets[i % targets.length]; if (E.buildPath(t[0], t[1]).length) found++; }
  const ms = performance.now() - t0, ev = gc.stop();
  out.buildPath = { searches: N, found, msPerSearch: Math.round(ms / N * 100) / 100, gcEvents: ev.length, gcMs: Math.round(ev.reduce((x, y) => x + y, 0) * 10) / 10 };
}
console.log(args.includes("--json") ? JSON.stringify(out) : JSON.stringify(out, null, 1));
