// Quality profiles + dynamic render-scale governor, logic only (no GPU, no real browser).
// Usage: node tests/perf/quality.js
"use strict";
const fs = require("fs"), vm = require("vm"), path = require("path");
let bad = 0;
const pass = (m) => console.log("PASS " + m), fail = (m) => { bad++; console.log("FAIL " + m); };
const assert = (c, m) => (c ? pass(m) : fail(m));

function make(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.storage || {});
  const calls = { pool: [], ratio: [], size: 0, budget: [] };
  const ctx = {
    console, Math,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    DeviceMode: { mobile: !!opts.mobile },
    navigator: Object.assign({}, opts.nav),
    GameState: { phase: "playing" },
    LightingSystem: { poolGain: 1, setPoolSize(n) { calls.pool.push(n); } },
    Level: { meshBudgetMs: 0 },
    renderer: { setPixelRatio(r) { calls.ratio.push(r); }, setSize() { calls.size++; } },
    window: { innerWidth: 800, innerHeight: 600 }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../../js/systems/quality.js"), "utf8") + "\n;this.Quality = Quality;", ctx);
  return { Q: ctx.Quality, ctx, calls, store };
}
const run = (Q, ms, seconds) => { const n = Math.round(seconds * 1000 / ms); for (let i = 0; i < n; i++) Q.frame(ms); };

// ---- detection
{
  const d = (mobile, nav) => make({ mobile, nav }).Q.detect({ mobile, navigator: nav });
  assert(d(false, { deviceMemory: 1, hardwareConcurrency: 2 }) === "high", "desktop pointer -> High even with low reported cores/memory");
  assert(d(true, { deviceMemory: 8, hardwareConcurrency: 8 }) === "medium", "capable phone -> Medium");
  assert(d(true, { deviceMemory: 2, hardwareConcurrency: 8 }) === "low", "phone with <=3 GB -> Low");
  assert(d(true, { deviceMemory: 8, hardwareConcurrency: 4 }) === "low", "phone with <=4 cores -> Low");
  assert(d(true, {}) === "medium", "phone reporting nothing -> Medium");
}
// ---- init, persistence, switching
{
  const t = make({ mobile: true, nav: { deviceMemory: 8, hardwareConcurrency: 8 } });
  t.Q.init();
  assert(t.Q.mode === "auto" && t.Q.name === "medium", "fresh start: auto mode resolves to Medium on a capable phone");
  assert(t.calls.pool.at(-1) === 12 && t.ctx.LightingSystem.poolGain === 1.18 && t.ctx.Level.meshBudgetMs === 5, "Medium applies pool 12 / gain 1.18 / 5 ms chunk budget");
  t.Q.setMode("low");
  assert(t.Q.name === "low" && t.calls.pool.at(-1) === 6 && t.ctx.LightingSystem.poolGain === 1.3 && t.ctx.Level.meshBudgetMs === 3, "switching to Low updates pool, gain and chunk budget");
  assert(t.Q.scale === 0.85 && t.calls.ratio.at(-1) === 0.85, "Low starts at its max render scale (0.85)");
  t.Q.setMode("high");
  assert(t.calls.pool.at(-1) === 24 && t.ctx.LightingSystem.poolGain === 1.07 && t.Q.scale === 1 && t.calls.ratio.at(-1) === 1, "switching to High restores 24 lights, gain 1.07, scale 1");
  assert(t.store[t.Q.KEY] === "high", "the choice is persisted");
  // manual choice survives a reload, auto detection does not overwrite it
  const t2 = make({ mobile: true, nav: { deviceMemory: 2 }, storage: t.store });
  t2.Q.init();
  assert(t2.Q.mode === "high" && t2.Q.name === "high", "a saved manual choice beats auto detection after reload");
  t2.Q.apply(); t2.Q.apply();
  assert(t2.Q.name === "high", "re-applying (level transitions) keeps the manual profile");
  t2.Q.setMode("bogus");
  assert(t2.Q.mode === "auto", "an unknown mode falls back to Auto");
  const t3 = make({ storage: { "backroomsRunner.quality.v1": "garbage" } }); t3.Q.init();
  assert(t3.Q.mode === "auto" && t3.Q.name === "high", "a corrupt saved value is ignored; desktop Auto -> High");
}
// ---- profile table is monotonic: High >= Medium >= Low
{
  const { Q } = make(), P = Q.PROFILES;
  assert(P.high.poolSize > P.medium.poolSize && P.medium.poolSize > P.low.poolSize, "light budgets decrease High > Medium > Low");
  assert(P.high.fogFar > P.medium.fogFar && P.medium.fogFar > P.low.fogFar, "fog distance decreases High > Medium > Low");
  assert(P.high.poolGain < P.medium.poolGain && P.medium.poolGain < P.low.poolGain, "gain compensation increases as lights are dropped");
  assert(!P.high.dynamic && P.high.scaleMin === 1 && P.high.scaleMax === 1, "High never scales resolution");
  assert(make().Q.level0Fog.call(Object.assign(make().Q, { name: "high" })).far === 175, "High keeps the original 175 m fog");
}
// ---- governor
{
  const t = make({ mobile: true, nav: { deviceMemory: 8, hardwareConcurrency: 8 } }); t.Q.setMode("medium");
  t.calls.ratio.length = 0;
  run(t.Q, 16, 20);
  assert(t.Q.scale === 1 && t.calls.ratio.length === 0, "fast frames at max scale cause no change");
  // isolated spikes
  for (let s = 0; s < 20; s++) { run(t.Q, 16, 1); t.Q.frame(240); }
  assert(t.Q.scale === 1, "isolated 240 ms spikes do not lower the scale");
  t.Q.frame(400); t.Q.frame(5000);
  assert(t.Q._n < 1000 && t.Q.scale === 1, "frames over 250 ms (tab switches/loads) are ignored");
  // sustained slowness steps down, bounded by scaleMin, without rapid oscillation
  run(t.Q, 40, 120);
  assert(Math.abs(t.Q.scale - 0.75) < 1e-9, "sustained 40 ms frames lower the scale to Medium's floor (0.75) and stop there (" + t.Q.scale.toFixed(2) + ")");
  const changes = t.calls.ratio.length;
  run(t.Q, 40, 60);
  assert(t.calls.ratio.length === changes, "no further changes once at the floor");
  // steady cool-down: each step takes >= 3 s
  const t1 = make({ mobile: true }); t1.Q.setMode("medium"); t1.calls.ratio.length = 0; run(t1.Q, 40, 10);
  assert(t1.calls.ratio.length <= 3, "at most ~1 resolution change per 3 s while slow (" + t1.calls.ratio.length + " in 10 s)");
  // recovery
  run(t.Q, 10, 120);
  assert(t.Q.scale === 1, "scale recovers to 1.0 once frames are fast again (" + t.Q.scale.toFixed(2) + ")");
  // hysteresis: frames between 0.7x and 1.15x of target hold the scale
  const t4 = make({ mobile: true }); t4.Q.setMode("medium"); run(t4.Q, 40, 10); const held = t4.Q.scale; t4.calls.ratio.length = 0;
  run(t4.Q, 20, 60);
  assert(t4.Q.scale === held && t4.calls.ratio.length === 0, "frames in the dead band (14-25 ms on Medium) hold the scale; no oscillation");
  // not while paused / menu
  const t5 = make({ mobile: true }); t5.Q.setMode("medium"); t5.ctx.GameState.phase = "paused"; run(t5.Q, 100, 60);
  assert(t5.Q.scale === 1, "the governor does not run outside the playing phase");
  // Low floor
  const t6 = make({ mobile: true }); t6.Q.setMode("low"); run(t6.Q, 80, 200);
  assert(Math.abs(t6.Q.scale - 0.55) < 1e-9, "Low never goes below 0.55 (" + t6.Q.scale.toFixed(2) + ")");
  // High never changes, even when slow
  const t7 = make(); t7.Q.setMode("high"); t7.calls.ratio.length = 0; run(t7.Q, 100, 60);
  assert(t7.Q.scale === 1 && t7.calls.ratio.length === 0, "High does not scale even on slow frames (user's setting is respected)");
  // switching profile resets the scale to the new profile's max
  t6.Q.setMode("medium");
  assert(t6.Q.scale === 1, "switching profile resets the governor");
}
// ---- a profile change during a Level 0 run updates live fog and camera far; other levels are untouched
{
  const t = make({ mobile: true }); let proj = 0;
  t.ctx.GameState.level = 0; t.ctx.Level.world = {}; t.ctx.scene = { fog: { near: 58, far: 175 } };
  t.ctx.CameraRig = { camera: { far: 180, updateProjectionMatrix() { proj++; } } };
  t.Q.setMode("low");
  assert(t.ctx.scene.fog.far === 125 && t.ctx.scene.fog.near === 42 && t.ctx.CameraRig.camera.far === 130 && proj === 1, "Level 0: switching to Low shortens the live fog (42-125 m) and camera far (130)");
  t.Q.setMode("high");
  assert(t.ctx.scene.fog.far === 175 && t.ctx.scene.fog.near === 58 && t.ctx.CameraRig.camera.far === 180, "Level 0: switching back to High restores 58-175 m fog and far 180");
  t.ctx.GameState.level = 2; t.ctx.scene.fog = { near: 7, far: 56 }; t.Q.setMode("low");
  assert(t.ctx.scene.fog.far === 56 && t.ctx.CameraRig.camera.far === 180, "other levels keep their own fog and camera far across a profile change");
  const t2 = make({ mobile: true }); t2.Q.setMode("medium"); assert(true, "no scene/Level at menu: applying a profile does not throw");
}
console.log(bad ? bad + " FAILED" : "all quality checks passed");
process.exit(bad ? 1 : 0);
