// End-to-end wiring on the real code: Level.buildProcedural + chunk streaming + elevator facades + stations +
// PassC + Activity System + markings, in the unbounded world.
const fs = require("fs");
const { makeContext, assert, pass, ROOT } = require("./harness.js");
const h = makeContext(["js/systems/passc.js"]), g = h.g, AS = g.ActivitySystem, L = g.Level;
h.run(`
  var PickupSystem = { generate() {}, reset() {}, beginLevel0() {}, ensureLevel0Around() {} };
  var Level1 = undefined;
  document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });
`, "stubs2");
g.GameState.level = 0; g.GameState.phase = "playing"; L.keepSeconds = 0;
const T = g.CONFIG.tile;
const poolCount = () => { let n = 0; h.ctx.scene.traverse(o => { if (o.isLight) n++; }); return n; };

const seed = 20240607;
const ok = L.buildProcedural(h.ctx.scene, seed, {});
assert(ok === true, "Level 0 builds through the real buildProcedural");
const r = g.LevelGenerator.last;
assert(L.world === r.world && g.MapGraph.provider === r.world, "the level runs on the unbounded world");
assert(AS.visit && AS.visit.levelId === 0 && AS.visit.sets.size === 5 && r.elevatorSites.length === 5, "a visit began during the build: one objective set per elevator (5)");
assert(g.Stairwell.exits.length === 5 && g.Stairwell.exits.every((e, i) => e.siteIndex === i), "every elevator facade was planned from its site, in order");
// ---- a facade exists only while its chunk is loaded
assert(g.Stairwell.cabGroups.filter(Boolean).length < 5, "far elevators are not built at the start (chunk-bound)");
const lightsAtStart = poolCount();
for (let i = 0; i < 5; i++) {
  const e = r.elevatorSites[i];
  g.Player.position.set((e.frontX + 0.5) * T, 0, (e.frontZ + 0.5) * T); L.stream(true);
  assert(g.Stairwell.cabGroups[i] && g.Stairwell.doorPairs[i], "elevator " + i + ": the real facade builder ran when its chunk loaded");
  assert(L.triggers.some(t => t.type === "exit" && t.exitIndex === i), "elevator " + i + ": its exit trigger exists");
  const o = g.Stairwell.exits[i].origin;
  assert(Math.abs(o.x - ((e.x + 0.5) * T + e.fx * T / 2)) < 1e-9 && Math.abs(o.z - ((e.z + 0.5) * T + e.fz * T / 2)) < 1e-9, "facade origin is the wall plane");
  assert(g.Stairwell.exits[i].fx === e.fx && g.Stairwell.exits[i].fz === e.fz, "facade orientation = planned wall direction");
  assert(g.Level0Activities._gauges.some(x => x.setId === "L0-E" + i && x.lamps.length === 5), "elevator " + i + " has a five-lamp power gauge");
  assert(poolCount() === lightsAtStart, "the number of scene lights never changes while streaming (" + poolCount() + ")");
}
pass("elevator facades build when their chunk loads (planned wall plane, orientation, trigger, five-lamp gauge); light count constant at " + lightsAtStart);

// ---- stations: built near, absent far, collider with the chunk, completion survives unload/reload
{
  const s0 = AS.visit.sites.get("L0-E1-S0");
  g.Player.position.set(s0.worldX, 0, s0.worldZ); L.stream(true);
  assert(AS._visuals.has(s0.id), "the station next to the player is built");
  const rec = [...L.chunks.values()].find(c => c.colliders.length && c.group.children.length);
  assert(L.colliders.some(c => c.max.y === 2.0 && c.min.y === 0.2 && Math.abs((c.min.x + c.max.x) / 2 - s0.planeX) < 1.5 && Math.abs((c.min.z + c.max.z) / 2 - s0.planeZ) < 1.5), "the station panel's collider is live next to the player");
  const far = [...AS.visit.sites.values()].filter(s => s.kind === "l0-station" && s.setId === "L0-E3");
  assert(far.length === 5 && far.every(s => !AS._visuals.has(s.id)), "another elevator's distant stations are not built (chunk-bounded)");
  assert(L.chunks.size < 70, "only nearby chunks are loaded (" + L.chunks.size + ")");
  AS.submit(s0.instanceId, g.ElectricalPuzzle.solve(AS.ensureParams(AS.getInstance(s0.instanceId))).rot);
  g.Player.position.set(far[0].worldX, 0, far[0].worldZ); L.stream(true);
  assert(!AS._visuals.has(s0.id), "walking far away unloads the station's chunk");
  assert(!L.colliders.some(c => c.max.y === 2.0 && c.min.y === 0.2 && Math.abs((c.min.x + c.max.x) / 2 - s0.planeX) < 1.5), "its collider left with the chunk");
  g.Player.position.set(s0.worldX, 0, s0.worldZ); L.stream(true);
  assert(AS._visuals.has(s0.id) && AS.getInstance(s0.instanceId).completed, "walking back rebuilds it and it is still completed");
  // independent progress
  assert(AS.progress("L0-E1").done === 1 && AS.progress("L0-E0").done === 0 && AS.progress("L0-E2").done === 0, "completing a station advances only its own elevator");
  pass("stations: built near, absent far, collider travels with the chunk, completion survives unload/reload, progress is per elevator");
}
// ---- Pass C decorations are planned per region and recorded for the markings
{
  const PassC = h.run("PassC", "passc");
  let drawings = 0, crates = 0;
  for (const reg of r.world.regions.values()) if (reg.decor) { drawings += reg.decor.drawings.length; crates += reg.decor.crates.length; }
  assert(drawings > 20, "Pass C planned wall drawings across the loaded regions (" + drawings + ")");
  assert(g.Level0Markings._passCTiles.size >= drawings, "the marking system knows every Pass C drawing it must avoid");
  pass("Pass C drawings (" + drawings + ") and crates (" + crates + ") planned per region; markings avoid their faces");
}
{
  const src = fs.readFileSync(ROOT + "js/systems/player.js", "utf8");
  assert(/ActivitySystem\.isManaged\(0\)\) continue;/.test(src), "walk-in exit trigger is bypassed for managed Level 0");
  pass("walk-in trigger defers to the Activity System");
}
// ---- regenerate = leave and re-enter: everything resets
{
  const oldVisit = AS.visit.id;
  L.buildProcedural(h.ctx.scene, seed, {});
  assert(AS.visit.id !== oldVisit && !AS.getInstance("L0-E1-A0").completed && AS.progress("L0-E1").percent === 0, "rebuilding Level 0 starts a fresh visit");
  assert(g.Level0Activities._gauges.every(x => x.lamps.length === 5) && g.Level0Activities._gauges.length <= 5, "old gauges were disposed, none accumulate (" + g.Level0Activities._gauges.length + ")");
  assert(poolCount() === lightsAtStart, "rebuilding keeps the same light count");
  pass("rebuilding Level 0 resets progress; no gauge or light accumulation");
}
{
  L.clear(h.ctx.scene);
  assert(AS.visit === null && g.Level0Markings.material === null && g.Level0Activities._gauges.length === 0 && AS._listeners.size === 0, "clear ends the visit, drops shared state, removes listeners");
  assert(poolCount() === 0 && L.world === null && g.MapGraph.provider === null && L.colliders.length === 0, "clear removes the light pool and the world");
  pass("Level.clear leaves no visit, gauge, listener, light or world behind");
}
