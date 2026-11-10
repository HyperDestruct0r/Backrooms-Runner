/* Run with: node tests/transitions/physical-shell.js */
"use strict";
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

class Group {
  constructor() { this.children = []; this.position = vec3(); this.rotation = { y: 0 }; this.parent = null; }
  add(obj) { this.children.push(obj); obj.parent = this; }
  remove(obj) { this.children = this.children.filter(x => x !== obj); obj.parent = null; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse ? c.traverse(fn) : fn(c); }
}
function vec3() { return { x: 0, y: 0, z: 0, set(x,y,z) { this.x=x; this.y=y; this.z=z; } }; }
class Mesh { constructor(geometry, material) { this.geometry=geometry; this.material=material; this.position=vec3(); this.parent=null; } }
class Material { dispose() { this.disposed=true; } }
class Geometry { dispose() { this.disposed=true; } }
const scene = new Group();
const overlay = { classList: { add(){}, remove(){} }, setAttribute(){}, querySelector(){ return null; } };
const context = {
  console, Math, Number, Promise, Date, setTimeout, clearTimeout,
  performance: { now: () => Date.now() },
  requestAnimationFrame: fn => setTimeout(() => fn(Date.now()), 0),
  document: { pointerLockElement: null, getElementById: id => id === "void-overlay" ? overlay : null },
  scene,
  Player: { position: { x: 3, y: 0, z: 4, set(x,y,z){this.x=x;this.y=y;this.z=z;} }, yaw: 0 },
  THREE: {
    Group, Mesh, BoxGeometry: Geometry,
    MeshStandardMaterial: Material, MeshBasicMaterial: Material
  },
  setPauseOverlay() {},
  GameState: { phase: "playing" },
  DeviceMode: { mobile: true }
};
vm.createContext(context);
const source = fs.readFileSync("js/systems/void.js", "utf8") + "\nglobalThis.__vt = VoidTransition;";
vm.runInContext(source, context);
(async () => {
  const vt = context.__vt;
  const oldLevel = new Group();
  scene.add(oldLevel);
  const ok = await vt.then(async () => {
    assert(vt._physicalShell && vt._physicalShell.root.parent === scene, "shell should be independent of level groups");
    scene.remove(oldLevel); // simulate old-level teardown
    assert(vt._physicalShell.root.parent === scene, "shell must survive old-level teardown");
    context.Player.position.set(20, 0, 30); // destination spawn
  }, { from: 3, to: 4, physical: true, minHold: 0 });
  assert.strictEqual(ok, true, "transition should complete");
  assert.strictEqual(vt._physicalShell, null, "shell should clean up after opening");
  assert.strictEqual(scene.children.length, 0, "temporary scene objects should be removed");
  process.stdout.write("PASS physical transition shell survives level teardown and cleans up\n");
})().catch(err => { console.error(err); process.exitCode = 1; });
