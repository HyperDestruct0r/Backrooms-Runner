// Headless harness: a stub THREE + the real game scripts we can run without a GPU.
const vm = require("vm"), fs = require("fs");
const ROOT = require("path").resolve(__dirname, "../..") + "/";
const stats = { geoCreated: 0, geoDisposed: 0, meshes: 0, toasts: [], lightsAdded: 0 };
class V3 { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); } distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); } }
class Obj { constructor() { this.children = []; this.parent = null; this.position = new V3(); this.rotation = { x: 0, y: 0, z: 0 }; this.scale = new V3(1, 1, 1); this.visible = true; }
  add(...a) { for (const c of a) { if (c.parent) c.parent.remove(c); c.parent = this; this.children.push(c); } return this; }
  remove(c) { const i = this.children.indexOf(c); if (i >= 0) { this.children.splice(i, 1); c.parent = null; } return this; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); } lookAt() {} }
class Light extends Obj { constructor(c, i, d, dec) { super(); this.intensity = i || 0; this.distance = d || 0; this.color = { setHex() {} }; stats.lightsAdded++; } }
const THREE = {
  Vector3: V3, Group: Obj, Object3D: Obj, Mesh: class extends Obj { constructor(g, m) { super(); this.geometry = g; this.material = m; stats.meshes++; } },
  Color: class { constructor(h) { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; } setHex() { return this; } },
  BufferGeometry: class { constructor() { stats.geoCreated++; this.attrs = {}; } setAttribute(k, v) { this.attrs[k] = v; } setIndex() {} computeVertexNormals() {} translate() { return this; } computeBoundingSphere() {} dispose() { stats.geoDisposed++; } },
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } },
  BoxGeometry: class { dispose() {} }, PlaneGeometry: class { dispose() {} },
  MeshStandardMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} }, MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
  PointLight: Light, HemisphereLight: Light, AmbientLight: Light, DirectionalLight: Light, SpotLight: Light,
  Fog: class { constructor(c, n, f) { this.near = n; this.far = f; } },
  SRGBColorSpace: "srgb", CanvasTexture: class {}
};
class Generic extends Obj { constructor(...a) { super(); this.repeat = { set() {} }; this.offset = { set() {} }; Object.assign(this, a[0] && typeof a[0] === "object" ? a[0] : {}); } dispose() {} setAttribute() {} computeBoundingSphere() {} clone() { return new Generic(); } }
const THREEP = new Proxy(THREE, { get: (t, p) => (p in t ? t[p] : (typeof p === "string" ? (/^[A-Z]/.test(p) ? Generic : undefined) : undefined)) });
const canvasCtx = () => new Proxy({}, { get: (t, p) => p === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : p === "measureText" ? () => ({ width: 10 }) : p === "createLinearGradient" || p === "createRadialGradient" ? () => ({ addColorStop() {} }) : (() => {}) , set: () => true });
const ctx = vm.createContext({ THREE: THREEP, console, performance, setTimeout, Math, Map, Set, Float32Array, document: { getElementById: () => null, createElement: () => ({ style: {}, width: 0, height: 0, getContext: () => canvasCtx(), toDataURL: () => '' }), body: { appendChild() {} }, pointerLockElement: null, exitPointerLock() {} } });
ctx.window = ctx;
const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
run(`
  var scene = new THREE.Group(); scene.fog = null; scene.background = { setHex() {} };
  var renderer = { toneMappingExposure: 1.28 };
  var CONFIG = { cameraFar: 180, flashlight: { intensity: 42, distance: 68, angle: 0.5 }, player: { radius: 0.34, heightStand: 1.72, walkSpeed: 4.6, sprintSpeed: 8.15 }, items: { interactDist: 1.85 }, entity: { hearLand: 10 }, fogNear: 5, fogFar: 40, sanity: { max: 100 } };
  var GameState = { level: 0, phase: "playing", cutscene: false, elapsed: 0, seed: 0, levelTimes: {} };
  var HUD = { toast(m) { __toasts.push(m); } };
  var Level = { startPos: new THREE.Vector3(), clear() {}, colliders: [] };
  var CameraRig = { camera: { far: 180, updateProjectionMatrix() {}, add() {} }, apply() {} };
  var Flashlight = { enabled: false, light: { distance: 68, intensity: 0 }, init() {} };
  var AudioSystem = { ctx: null, playPositional() {}, _tone() {}, _noise() {}, land() {} };
  var PickupSystem = { list: [], group: null, reset() { this.list = []; this.group = null; }, _addMesh(kind, x, z) { const mesh = new THREE.Mesh({}, { dispose() {} }); this.group.add(mesh); this.list.push({ kind, x, z, mesh, taken: false }); } };
  var Player = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, hp: 100, sanity: 100, onGround: true, damagePlayer(n) { this.hp -= n; __dmg.push(n); }, addSanity(n) {}, getPlayerHP() { return this.hp; }, lastNoise: 0, lastNoisePos: new THREE.Vector3(), wishSprint: false };
  var Game = { complete() { __complete.push(GameState.level); }, gameOver() { __over.push(1); } };
  var Geometries = { box: new THREE.BoxGeometry() };
  var setPauseOverlay = () => {};
`, "stubs");
ctx.__toasts = stats.toasts; ctx.__dmg = []; ctx.__complete = []; ctx.__over = [];
const load = (f) => run(fs.readFileSync(ROOT + f, "utf8"), f);
for (const f of ["js/levels/level9-gen.js", "js/levels/level9.js", "js/levels/level9-houses.js", "js/entities/hound.js", "js/entities/smiler.js", "js/entities/level9-entities.js"]) load(f);
// the real physics from player.js (just the collision functions)
{
  const src = fs.readFileSync(ROOT + "js/systems/player.js", "utf8");
  const a = src.indexOf("const STEP_TOLERANCE"), b = src.indexOf("/* ------------------------------------------------------------------\n   PLAYER");
  run("function aabbOverlap(minA,maxA,minB,maxB){return minA.x<maxB.x&&maxA.x>minB.x&&minA.y<maxB.y&&maxA.y>minB.y&&minA.z<maxB.z&&maxA.z>minB.z;}\n" + src.slice(a, b), "player-physics");
}
module.exports = { ctx, run, stats, V3 };
