// Level 0 teardown / repeat builds (no resource growth), region eviction + elevator progress persistence, bounded
// bookkeeping, and the tab-hidden pause / audio-suspend handler (extracted from js/core.js and run against stubs).
const { makeContext, assert, pass } = require("./harness.js");
const fs = require("fs"), vm = require("vm"), path = require("path");
const h = makeContext(["js/systems/passc.js"]), g = h.g, L = g.Level, W0 = g.Level0World, T = g.CONFIG.tile;
h.run(`
  var PickupSystem = { generate() {}, reset() {}, beginLevel0() {}, ensureLevel0Around() {} };
  var Level1 = undefined;
  document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });
`, "stubs2");
g.GameState.level = 0; g.GameState.phase = "playing"; g.GameState.dtLast = 1 / 60;
const stats = h.ctx.__stats || h.g.__stats;
const live = () => stats.geoCreated - stats.geoDisposed;
const lights = () => { let n = 0; h.ctx.scene.traverse(o => { if (o.isLight) n++; }); return n; };
const walkTo = (x, z) => { g.Player.position.set((x + 0.5) * T, 0, (z + 0.5) * T); L.stream(true); };

// ---- repeated build -> play -> clear cycles do not accumulate geometry, lights, colliders or worlds
{
  const seed = 483921; const liveAfter = [];
  for (let cycle = 0; cycle < 4; cycle++) {
    assert(L.buildProcedural(h.ctx.scene, seed, {}), "cycle " + cycle + ": level builds");
    const r = g.LevelGenerator.last, sp = r.startStamp;
    walkTo(sp.x, sp.z);
    for (const e of r.elevatorSites.slice(0, 3)) walkTo(e.frontX, e.frontZ);       // stream chunks in three far places
    L.clear(h.ctx.scene);
    assert(L.world === null && L.chunks.size === 0 && L.colliders.length === 0 && L.triggers.length === 0, "cycle " + cycle + ": clear() drops the world, chunks, colliders and triggers");
    assert(lights() === 0 && g.LightingSystem.units.length === 0 && g.LightingSystem.fixtures.length === 0, "cycle " + cycle + ": no lights or fixtures remain in the scene");
    liveAfter.push(live());
  }
  assert(liveAfter[3] <= liveAfter[1] + 4, "live geometry after teardown does not grow across cycles (" + liveAfter.join(", ") + ")");
  pass("4 build/play/clear cycles: world released, no leaked lights/fixtures/colliders, live geometry flat (" + liveAfter.join(" -> ") + ")");
}

// ---- region eviction: tiles, elevators and station progress persist
{
  L.buildProcedural(h.ctx.scene, 777001, {});
  const r = g.LevelGenerator.last, W = L.world, e = r.elevatorSites[2];
  const around = (e) => { let s = ""; for (let z = e.z - 10; z <= e.z + 10; z++) for (let x = e.x - 10; x <= e.x + 10; x++) s += W.tile(x, z); return s; };
  const before = r.elevatorSites.map(around);
  const prog = g.ActivitySystem && g.ActivitySystem.visit ? JSON.stringify(g.ActivitySystem.visit) : null;
  W.evictAll();
  assert(W.regions.size === 0 && W.stats.evicted > 0, "all regions evicted");
  assert(JSON.stringify(r.elevatorSites.map(around)) === JSON.stringify(before), "elevator surroundings are identical after every region is evicted and rebuilt");
  assert(W.stats.regenerated > 0, "evicted regions were rebuilt (" + W.stats.regenerated + ")");
  if (prog) assert(JSON.stringify(g.ActivitySystem.visit) === prog, "activity/elevator progress state is untouched by region eviction");
  // bounded bookkeeping: evicted-key tracking is capped and never grows with exploration
  const w2 = W0.create(5); for (let i = 0; i < 400; i++) { w2.region(i % 40 - 20, Math.floor(i / 40) - 5); w2.maxRegions = 4; w2.trim(0, 0, 0); }
  assert(w2._evictedKeys.size <= 256, "evicted-key set stays capped (" + w2._evictedKeys.size + " <= 256)");
  assert(w2.regions.size <= 4 + 1, "region cache respects its cap during long exploration (" + w2.regions.size + ")");
  assert(w2._seenKeys === undefined, "no unbounded seen-key history");
  // stamped tiles (e.g. elevator doors) survive eviction of their region
  const w3 = W0.create(9); w3.stamp(10, 10, 4); w3.evictAll(); assert(w3.tile(10, 10) === 4, "a stamped tile survives eviction");
  pass("regions can be evicted and rebuilt: identical tiles, stamped tiles and elevators persist; bookkeeping is bounded");
  L.clear(h.ctx.scene);
}

// ---- long exploration: region cache and loaded chunks stay bounded while moving 20 regions away
{
  L.buildProcedural(h.ctx.scene, 20240607, {});
  const W = L.world; g.GameState.dtLast = 1 / 60; L.keepSeconds = 0;
  let maxReg = 0, maxChunks = 0;
  for (let i = 0; i < 40; i++) { walkTo(i * 250, (i % 5) * 80); L.stream(true); for (let k = 0; k < 40; k++) L.stream(false); maxReg = Math.max(maxReg, W.regions.size); maxChunks = Math.max(maxChunks, L.chunks.size); }
  assert(maxReg <= W.maxRegions + 12, "regions stay near the cap during a 10 km teleport tour (max " + maxReg + ", cap " + W.maxRegions + ")");
  assert(maxChunks < 90, "loaded chunks stay bounded (" + maxChunks + ")");
  assert(lights() === g.LightingSystem.poolSize || lights() === 0 || lights() <= 24, "light count stays within the pool (" + lights() + ")");
  pass("40 far jumps: max " + maxReg + " regions, " + maxChunks + " chunks, " + lights() + " lights in the scene");
  L.clear(h.ctx.scene);
}

// ---- tab hidden: pause on touch devices, suspend audio, resume only what we suspended
{
  const src = fs.readFileSync(path.join(__dirname, "../../js/core.js"), "utf8");
  const a = src.indexOf('document.addEventListener("visibilitychange"'), b = src.indexOf("\n});", a) + 4;
  assert(a > 0, "found the visibilitychange handler");
  const mk = (mobile) => {
    const calls = { overlay: null, reset: 0, suspend: 0, resume: 0, clear: 0 };
    const ctx = { document: { hidden: false, addEventListener(t, f) { ctx.__f = f; }, getElementById: () => ({ style: {} }) },
      clearInput() { calls.clear++; }, setPauseOverlay(v) { calls.overlay = v; }, Input: { locked: true },
      GameState: { phase: "playing", inventoryOpen: false, cutscene: false }, DeviceMode: { mobile }, Stairwell: { sequenceActive: false },
      MobileControls: { resetToggles() { calls.reset++; } },
      AudioSystem: { ctx: { state: "running", suspend() { calls.suspend++; this.state = "suspended"; }, resume() { calls.resume++; this.state = "running"; } } }, typeof: undefined };
    vm.createContext(ctx); vm.runInContext(src.slice(a, b), ctx); return { ctx, calls };
  };
  for (const mobile of [true, false]) {
    const { ctx, calls } = mk(mobile);
    ctx.document.hidden = true; ctx.__f();
    assert(calls.suspend === 1 && ctx.AudioSystem._suspendedByHide, (mobile ? "touch" : "desktop") + ": hiding the tab suspends audio");
    assert(calls.clear === 1, (mobile ? "touch" : "desktop") + ": hiding drops held input");
    assert(mobile ? (calls.overlay === true && ctx.Input.locked === false && calls.reset === 1) : (calls.overlay === null && ctx.Input.locked === true), (mobile ? "touch: run is paused and toggles reset" : "desktop: no forced pause (pointer lock handles it)"));
    ctx.document.hidden = false; ctx.__f();
    assert(calls.resume === 1 && !ctx.AudioSystem._suspendedByHide, (mobile ? "touch" : "desktop") + ": showing the tab resumes the audio we suspended");
    ctx.document.hidden = false; ctx.__f(); assert(calls.resume === 1, "no spurious resume when nothing was suspended");
  }
  const { ctx, calls } = mk(true); ctx.AudioSystem.ctx.state = "suspended"; ctx.document.hidden = true; ctx.__f(); ctx.document.hidden = false; ctx.__f();
  assert(calls.suspend === 0 && calls.resume === 0, "audio that was already suspended by the user/browser is not resumed by us");
  const m = mk(true); m.ctx.GameState.inventoryOpen = true; m.ctx.document.hidden = true; m.ctx.__f();
  assert(m.calls.overlay === null, "touch: no pause overlay while the inventory is open");
  pass("tab-hidden handler: pause (touch only), audio suspend/resume, input cleared, guards for inventory and pre-suspended audio");
}
