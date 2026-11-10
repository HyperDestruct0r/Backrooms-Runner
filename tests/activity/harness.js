// Headless harness for the Activity System, Level 0 site planner and wall markings.
// Loads the REAL game scripts into a vm with a small THREE/DOM stub. No GPU, no browser:
// it tests logic, generation, state and geometry data, not how anything looks.
const vm = require("vm"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..") + "/";

class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } clone() { return new V3(this.x, this.y, this.z); }
  lerpVectors() { return this; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; } }
const stats = { geoCreated: 0, geoDisposed: 0, matDisposed: 0, meshes: 0, toasts: [] };
class Obj { constructor() { this.userData = {}; this.children = []; this.parent = null; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 }; this.scale = new V3(1, 1, 1); }
  add(...a) { for (const c of a) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); } return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } return this; }
  traverse(f) { f(this); for (const c of this.children) c.traverse ? c.traverse(f) : f(c); } }
class Attr { constructor(a, n) { this.array = a; this.itemSize = n; } get count() { return this.array.length / this.itemSize; } }
class Geo { constructor() { stats.geoCreated++; this.attributes = {}; this.disposed = false; }
  setAttribute(k, v) { this.attributes[k] = v; } setIndex(v) { this.index = v; }
  dispose() { if (!this.disposed) { this.disposed = true; stats.geoDisposed++; } } }
class Mat { clone() { const m = new Mat(this); return m; } constructor(o) { Object.assign(this, o); this.isMaterial = true; this.emissive = { setHex: (h) => { this.emissiveHex = h; } }; this.color = typeof (o && o.color) === "number" ? { setHex: (h) => { this.colorHex = h; } } : (o && o.color) || { setHex() {} }; }
  dispose() { stats.matDisposed++; } }
class PL extends Obj { constructor() { super(); this.intensity = 0; this.distance = 100; this.decay = 1; this.color = { setHex(h) { this.hex = h; } }; this.isLight = true; } }
class PlaneG extends Geo { constructor(w, h) { super(); this.w = w; this.h = h; } }
const THREE = {
  PointLight: PL, PlaneGeometry: PlaneG, Color: class { constructor() {} }, Fog: class { constructor(c, n, f) { this.near = n; this.far = f; } },
  MathUtils: { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
  RepeatWrapping: 1000,
  Vector3: V3, Group: Obj,
  Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; stats.meshes++; } },
  BufferGeometry: Geo, BufferAttribute: Attr, BoxGeometry: Geo,
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat,
  CanvasTexture: class { constructor(c) { this.image = c; } dispose() {} }, SRGBColorSpace: "srgb"
};

function configSource(root) {
  const core = fs.readFileSync((root || ROOT) + "js/core.js", "utf8");
  const a = core.indexOf("const CONFIG = {");
  let depth = 0, i = a + "const CONFIG = ".length;
  for (; i < core.length; i++) { const c = core[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) { i++; break; } } }
  return core.slice(a, i) + ";";
}

function lightingSource(root) {
  const core = fs.readFileSync((root || ROOT) + "js/core.js", "utf8");
  return core.slice(core.indexOf("const LightingSystem = {"));
}

// opts.files: extra scripts to load after the Level 0 core.
// opts.root: load the game from another checkout (the benchmark compares against the original Pass 4 tree).
function makeContext(extraFiles, opts) {
  const root = (opts && opts.root) || ROOT;
  const canvasStub = () => ({ getContext: () => new Proxy({}, { get: (t, p) => (p === "measureText" ? () => ({ width: 10 }) : () => {}) }), width: 0, height: 0 });
  const elements = {};
  const ctx = vm.createContext({
    THREE, console, Math, Map, Set, Int32Array, Int16Array, Float32Array, Uint16Array, Uint8Array, Float64Array, Int8Array, Uint32Array, Array, Object, Number, String, JSON, Promise, Error,
    performance, setTimeout, clearTimeout,
    document: { getElementById: (id) => elements[id] || null, createElement: () => canvasStub(), pointerLockElement: null, exitPointerLock() {}, addEventListener() {}, removeEventListener() {} },
    __stats: stats
  });
  ctx.window = ctx;
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(configSource(root), "CONFIG");
  run(`
    var GameState = { level: 0, phase: "playing", cutscene: false, elapsed: 0, seed: 0, inventoryOpen: false, exitReached: false };
    var HUD = { toasts: [], toast(m) { this.toasts.push(m); } };
    var Player = { position: new THREE.Vector3(), yaw: 0 };
    var Input = { locked: true, keys: {} };
    var DeviceMode = { mobile: false };
    var Geometries = { box: new THREE.BoxGeometry(), lightPanel: new THREE.BoxGeometry(), lightHousing: new THREE.BoxGeometry(), floorTile: new THREE.BoxGeometry(), column: new THREE.BoxGeometry(), beam: new THREE.BoxGeometry() };
    var Texmap = { clone() { return { repeat: { set() {} }, wrapS: 0, wrapT: 0, dispose() {} }; }, repeat: { set() {} }, dispose() {} };
    var Materials = { carpet: new THREE.MeshStandardMaterial({ map: Texmap }), ceiling: new THREE.MeshStandardMaterial({ map: Texmap }), light: new THREE.MeshStandardMaterial({ emissiveIntensity: 1 }), lightHousing: new THREE.MeshStandardMaterial({}) };
    for (const k of ["wall", "column", "concrete", "concreteDark", "chair", "propDark", "crate", "crateDark", "passCBlack"]) Materials[k] = new THREE.MeshStandardMaterial({ map: Texmap });
    var AudioSystem = { playPositional() {} };
    var Quality = undefined;
    var scene = new THREE.Group();
    var renderer = { domElement: { requestPointerLock() {} } };
    var clearInput = () => { Input.keys = {}; };
    var setPauseOverlay = () => {};
  `, "stubs");
  run(lightingSource(root), "LightingSystem");
  const load = (f) => { if (fs.existsSync(root + f)) run(fs.readFileSync(root + f, "utf8"), f); };
  for (const f of ["js/systems/activity-system.js", "js/activities/electrical-puzzle.js", "js/activities/electrical.js", "js/levels/level0-sites.js", "js/levels/level0-world.js", "js/levels/level0.js", "js/levels/level0-activities.js", "js/levels/level0-markings.js"].concat(extraFiles || [])) load(f);
  run(`globalThis.__g = {}; for (const n of ["ActivitySystem","ElectricalPuzzle","Level0Sites","Level0World","MergedBoxes","LightingSystem","LevelGenerator","Level","Stairwell","Level0Activities","Level0Markings","TILE","CONFIG","GameState","HUD","Player","Input","MapGraph","PassC","EntitySystem","EncounterManager","PickupSystem"]) { try { globalThis.__g[n] = eval(n); } catch (e) {} }`, "export");
  return { ctx, run, load, g: ctx.__g, stats, elements };
}

function assert(cond, msg) { if (!cond) { console.log("FAIL " + msg); process.exitCode = 1; throw new Error(msg); } }
const pass = (m) => console.log("PASS " + m);

// A generated Level 0 map, cached per seed (generation is the slow part).
const cache = new Map();
function mapFor(h, i) {
  const key = i;
  if (cache.has(key)) return cache.get(key);
  const r = h.g.LevelGenerator.generateValid((i * 104729 + 11) >>> 0, 160);
  cache.set(key, r);
  return r;
}

// Independent breadth-first walking distances over a result's tiles (does not reuse the planner's).
function walkMap(g, r, sx, sz) {
  const { tiles, rows, cols } = r, TILE = g.TILE;
  const d = new Int32Array(rows * cols).fill(-1), q = new Int32Array(rows * cols);
  let hd = 0, tl = 0; d[sz * cols + sx] = 0; q[tl++] = sz * cols + sx;
  while (hd < tl) {
    const i = q[hd++], x = i % cols, z = (i / cols) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
      const ni = nz * cols + nx; if (d[ni] >= 0) continue;
      const t = tiles[nz][nx]; if (t === TILE.WALL || t === TILE.COLUMN) continue;
      d[ni] = d[i] + 1; q[tl++] = ni;
    }
  }
  return d;
}
module.exports = { makeContext, assert, pass, mapFor, walkMap, ROOT, stats, THREE };
