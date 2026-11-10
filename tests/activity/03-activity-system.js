// Activity System: registration, independent elevator progress, persistence, reset, premature-use guard.
const { makeContext, assert, pass, mapFor } = require("./harness.js");
const h = makeContext(), g = h.g, AS = g.ActivitySystem, P = g.ElectricalPuzzle;
h.run(`var ActivityUI = { opened: [], closed: 0, prompt: null, open(c) { this.opened.push(c); return { close: () => { this.closed++; } }; }, setPrompt(t) { this.prompt = t; } };`, "ui-stub");
const UI = h.ctx.ActivityUI;
const r = mapFor(h, 3);

// --- registration ---
assert(AS.types.has("electrical-restoration"), "electrical type registered");
assert(AS.siteKinds.has("l0-station") && AS.siteKinds.has("l0-elevator"), "Level 0 site kinds registered");
assert(AS.adapters.has(0), "Level 0 adapter registered");
{
  let threw = false; try { AS.registerType({ id: "bad" }); } catch (e) { threw = true; }
  assert(threw, "a type missing its pieces is refused");
  AS.registerType({ id: "demo-type", createParams: () => ({}), verify: (p, s) => s === "ok", ui: { mount() {} } });
  assert(AS.types.has("demo-type"), "future levels can register new types without touching the core");
  AS.types.delete("demo-type");
}
pass("activities register; the core accepts new types and refuses malformed ones");

function enter(res) {
  g.Level.loadGenerated(res); g.Stairwell.planFrom(res);
  g.Level.colliders.length = 0;
  const before = g.Level.colliders.length;
  assert(AS.beginVisit(0, res) === true, "visit starts");
  return g.Level.colliders.length - before;
}
const colliders = enter(r);
assert(colliders === 0, "beginning a visit adds no global colliders: a station's collider belongs to its streamed chunk (06 checks it)");
const E = r.elevatorSites;
assert(AS.visit.sets.size === E.length, "one objective set per elevator");
for (const set of AS.visit.sets.values()) assert(set.required.length === 5 && set.optional.length === 0, "five required stations per set");
{
  const ids = [...AS.visit.instances.keys()];
  assert(new Set(ids).size === ids.length, "instance ids are unique");
  for (const inst of AS.visit.instances.values()) assert(inst.levelId === 0 && inst.setId && inst.params === null, "instance carries level + set and has NOT generated its puzzle yet (lazy)");
}
pass("one objective set per elevator, 5 required instances each, unique ids, puzzles not pre-generated");

// --- independent configurations ---
const A = AS.getSet("L0-E0"), B = AS.getSet("L0-E1");
{
  const pa = AS.ensureParams(AS.getInstance(A.required[0])), pb = AS.ensureParams(AS.getInstance(B.required[0]));
  assert(JSON.stringify(pa.solution) !== JSON.stringify(pb.solution) || pa.seed !== pb.seed, "elevators get separately generated puzzles");
  const seeds = new Set([...AS.visit.instances.values()].map(i => i.seed));
  assert(seeds.size === AS.visit.instances.size, "every instance has its own seed");
}
// --- station progress ---
const solveInst = (inst) => { const p = AS.ensureParams(inst); return P.solve(p).rot; };
const complete = (id) => { const inst = AS.getInstance(id); const res = AS.submit(id, solveInst(inst)); assert(res.ok, "valid solution accepted"); return res; };
assert(AS.canUseElevator(0) === false && AS.canUseElevator(1) === false, "no elevator is usable at the start");
{
  const bad = AS.submit(A.required[0], AS.ensureParams(AS.getInstance(A.required[0])).start);
  assert(!bad.ok && !AS.getInstance(A.required[0]).completed, "an incorrect configuration does not complete the station");
}
for (let k = 0; k < 5; k++) {
  complete(A.required[k]);
  const p = AS.progress("L0-E0");
  assert(p.done === k + 1 && p.percent === 20 * (k + 1), "each station adds exactly 20% (" + p.percent + ")");
  assert(AS.canUseElevator(0) === (k === 4), "elevator A usable only at 100%");
  assert(AS.progress("L0-E1").percent === 0 && AS.canUseElevator(1) === false, "elevator B is untouched by A's stations");
}
assert(AS.submit(A.required[0], solveInst(AS.getInstance(A.required[0]))).already, "completing twice is harmless");
assert(AS.progress("L0-E0").percent === 100, "never exceeds 100%");
pass("20% per station, exact; elevator usable only at 100%; A never affects B; wrong boards rejected");

// --- premature use guard on the real Stairwell ---
{
  const S = g.Stairwell, GS = g.GameState;
  h.ctx.document.getElementById = () => ({ style: {}, classList: { add() {}, remove() {} }, textContent: "" });
  GS.phase = "playing"; GS.level = 0;
  S.reached = true; GS.exitReached = true;
  S.startSequence(1);                                   // B has no power
  assert(!S.sequenceActive && !S.reached, "an unpowered elevator refuses to start the ride");
  h.run("var AudioSystem = { _tone() {} };", "audio-stub");
  S.doorPairs[0] = { left: { position: {} }, right: { position: {} }, openT: 0 };   // the facade build normally makes these
  S.doorPairs[1] = S.doorPairs[0];
  S.reached = true; GS.exitReached = true;
  S.startSequence(0);                                   // A is at 100%
  assert(S.sequenceActive === true, "a powered elevator starts the ride");
  S.cancelPendingTransition();
  pass("premature elevator use is refused inside Stairwell.startSequence; powered use goes through the existing transition");
}

// --- E interaction at the elevator ---
{
  const kind = AS.siteKinds.get("l0-elevator");
  const siteB = AS.visit.sites.get("L0-E1-D"), siteA = AS.visit.sites.get("L0-E0-D");
  assert(/NO POWER/.test(kind.describe(siteB, AS.visit, AS).prompt) && /0%/.test(kind.describe(siteB, AS.visit, AS).prompt), "locked elevator shows its power percentage");
  assert(/CALL ELEVATOR/.test(kind.describe(siteA, AS.visit, AS).prompt), "powered elevator offers the call");
  assert(/\[E\]/.test(AS.siteKinds.get("l0-station").describe(AS.visit.sites.get("L0-E1-S0"), AS.visit, AS).prompt), "station shows the interaction prompt");
  GameStateReset();
}
function GameStateReset() { g.GameState.exitReached = false; g.Stairwell.reached = false; }

// --- opening/closing the interface never undoes anything ---
{
  const inst = AS.getInstance(B.required[0]);
  g.Player.position.set(0, 0, 0);
  assert(AS.openInterface(inst) && AS.interfaceOpen && g.GameState.inventoryOpen, "interface opens and raises the existing panel flag");
  assert(g.Input.locked === false, "mouse look is released while the panel is open");
  assert(AS.tryUse() === true, "E is swallowed while the panel is open");
  AS.submit(inst.id, solveInst(inst));
  AS.closeInterface({ relock: false });
  assert(!AS.interfaceOpen && !g.GameState.inventoryOpen && UI.closed === 1, "closing releases the panel flag and the UI");
  assert(inst.completed && AS.progress("L0-E1").percent === 20, "closing the interface keeps completion");
  // cancel mid-puzzle keeps earlier stations
  const inst2 = AS.getInstance(B.required[1]);
  AS.openInterface(inst2); AS.closeInterface({ relock: false });
  assert(!inst2.completed && AS.progress("L0-E1").percent === 20, "cancelling does not erase finished stations or grant the open one");
  // guard closes it if the run moves on
  AS.openInterface(inst2); g.GameState.phase = "gameover"; AS.guard();
  assert(!AS.interfaceOpen, "guard closes the panel when the run is no longer playing"); g.GameState.phase = "playing";
  pass("closing/cancelling the interface never undoes or grants progress; guard closes it on death/level change");
}

// --- chunk unload / reload keeps state ---
{
  const grpA = new h.ctx.THREE.Group();
  const site = AS.visit.sites.get("L0-E1-S0"), inst = AS.getInstance(site.instanceId);
  assert(inst.completed, "B's first station is complete");
  const key = "k1", minx = site.worldX - 5, maxx = site.worldX + 5, minz = site.worldZ - 5, maxz = site.worldZ + 5;
  AS.onChunkBuilt(0, key, grpA, minx, minz, maxx, maxz);
  const rec = AS._visuals.get(site.id); assert(rec, "visual built for the loaded chunk");
  assert(rec.root.parent === grpA, "visual is attached to its chunk group");
  const lampOn = rec.root.children.some(m => m.material === g.Level0Activities._mats.lampOn);
  assert(lampOn, "a completed station is built in its restored state");
  AS.onChunkUnloaded(0, key); assert(!AS._visuals.has(site.id), "unloading drops the visual");
  assert(inst.completed && AS.progress("L0-E1").percent === 20, "unloading does not touch completion");
  const grpB = new h.ctx.THREE.Group(); AS.onChunkBuilt(0, key, grpB, minx, minz, maxx, maxz);
  assert(AS._visuals.get(site.id).root.children.some(m => m.material === g.Level0Activities._mats.lampOn), "reloading shows it restored again");
  // a not-yet-restored station reloads unrestored, and completes live
  const s2 = AS.visit.sites.get("L0-E1-S3"), i2 = AS.getInstance(s2.instanceId);
  AS.onChunkBuilt(0, "k2", new h.ctx.THREE.Group(), s2.worldX - 5, s2.worldZ - 5, s2.worldX + 5, s2.worldZ + 5);
  const rec2 = AS._visuals.get(s2.id);
  assert(rec2.root.children.some(m => m.material === g.Level0Activities._mats.lampOff), "an unrestored station shows the fault lamp");
  AS.submit(i2.id, solveInst(i2));
  assert(rec2.root.children.some(m => m.material === g.Level0Activities._mats.lampOn), "completing flips the station's visual live");
  pass("chunk unload/reload: state survives and visuals are rebuilt from it; live completion updates the loaded station");
}

// --- elevator B's own five finish it independently ---
{
  for (const id of B.required) if (!AS.getInstance(id).completed) AS.submit(id, solveInst(AS.getInstance(id)));
  assert(AS.canUseElevator(1) && AS.progress("L0-E1").percent === 100, "B becomes usable from its own five stations");
  assert(AS.canUseElevator(0), "A remains usable (switching elevators preserves progress)");
  pass("any one elevator's five stations suffice; progress at each elevator is preserved independently");
}

// --- optional activities and rewards (data structures only) ---
{
  g.Level.colliders.length = 0;
  AS.adapters.set(99, { buildPlan: () => ({ seed: 1, sites: [], sets: [{ id: "X", label: "x", meta: {}, activities: [
    { id: "x-r", typeId: "electrical-restoration", required: true, seed: 5, difficulty: 0, rewards: [{ type: "progress" }] },
    { id: "x-o", typeId: "electrical-restoration", required: false, seed: 6, difficulty: 0, rewards: [{ type: "info", text: "A found note" }, { type: "discovery", id: "d1", text: "hidden room" }, { type: "item", itemId: "almondWater", qty: 1 }] }] }] }) });
  h.run("var Inventory = { got: [], addItem(id, n) { this.got.push([id, n]); return n; } };", "inv");
  AS.beginVisit(99, null);
  assert(AS.progress("X").total === 1, "optional activity is not counted in the objective");
  assert(AS.canUseElevator.call({ visit: AS.visit, setForExit: () => "X", progress: AS.progress.bind(AS) }, 0) === false, "optional activity cannot power anything");
  AS.submit("x-o", AS.types.get("electrical-restoration") && P.solve(AS.ensureParams(AS.getInstance("x-o"))).rot);
  assert(AS.progress("X").percent === 0, "finishing an optional activity gives no power");
  const opt = AS.getInstance("x-o");
  assert(opt.rewardResults.includes("A found note") && opt.rewardResults.includes("hidden room") && opt.rewardResults.some(t => /almondWater/.test(t)), "info, discovery and item rewards are granted");
  assert(h.ctx.Inventory.got.length === 1, "item reward reaches the inventory exactly once");
  AS.grantRewards(opt); assert(h.ctx.Inventory.got.length === 1, "rewards are granted only once");
  AS.endVisit(null);
  pass("optional activities: never required for power; info/discovery/item reward hooks work and grant once");
}

// --- reset on leaving and re-entering Level 0 ---
{
  enter(r);
  const A2 = AS.getSet("L0-E0");
  AS.submit(A2.required[0], solveInst(AS.getInstance(A2.required[0])));
  assert(AS.progress("L0-E0").percent === 20, "progress exists in the visit");
  const idBefore = AS.visit.id;
  g.Level.clear(h.ctx.scene);                            // what every other level's enter() calls
  assert(AS.visit === null, "leaving Level 0 ends the visit");
  enter(r);
  assert(AS.visit.id !== idBefore && AS.progress("L0-E0").percent === 0 && AS.progress("L0-E1").percent === 0, "re-entering Level 0 resets all stations and elevators");
  assert(!AS.getInstance("L0-E0-A0").completed, "the first station is unrestored again");
  // the same seed rebuilds the same layout, so only the state resets
  assert(r.elevatorSites.length === AS.visit.sets.size, "same world, fresh progress");
  // Level 1 enter path ends the visit through its own one-liner
  const l1 = require("fs").readFileSync(__dirname + "/../../js/levels/level1.js", "utf8");
  assert(/ActivitySystem\.endVisit\(0\)/.test(l1), "Level1.enter ends the Level 0 visit");
  // regenerating or a Test-Beta result (no sites) is unmanaged
  assert(AS.beginVisit(0, { elevatorSites: [] }) === false && AS.visit === null && AS.canUseElevator(0) === true, "a Level 0 without planned sites falls back to legacy elevators");
  pass("leaving then re-entering Level 0 resets everything; unplanned (Test Beta) Level 0 keeps legacy elevators");
}
