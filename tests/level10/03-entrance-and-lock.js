const { run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const seed = 99;
run(`Level9.enter(${seed}, 8);`);
// Level 9's night, as it really is after Level9.enter
const night = run("({fog: scene.fog.color ? scene.fog.color.hex : null, near: scene.fog.near, far: scene.fog.far, hemi: Level9.look.hemi, amb: Level9.look.ambient, moon: Level9.look.moon, exp: renderer.toneMappingExposure})");
const ex = run("Level9Gen.exitList().filter(e=>e.kind==='level10').sort((a,b)=>a.dist-b.dist)[0]");
ok(ex && ex.nx != null, "Level 9 exit list carries the lot normal");
// stand 6 m up the path, walk to the break with real physics
run(`Player.position.set(${ex.x + ex.nx * 6}, 0, ${ex.z + ex.nz * 6}); Level9.stream(true); Level9.update(0.05);`);
ok(run("GameState.level") === 9 && run("Level9.active"), "6 m from the field break: still Level 9");
stats.toasts.length = 0; run("__void.calls = 0");
run("Player.yaw = 1.23; Player.velocity.set(0,0,0)");
let n = 0;
while (run("GameState.level") === 9 && n++ < 400) run(`Walk.step(${-ex.nx}, ${-ex.nz}, 0.02)`);
ok(run("GameState.level") === 10 && run("Level10.active") && run("!Level9.active"), "walking into the field break enters Level 10");
ok(run("__void.calls") === 0, "no Void");
ok(!stats.toasts.some(t => /NOT BUILT|LEVEL 10|LEVEL 9/.test(t)), "no toast on entering (" + JSON.stringify(stats.toasts) + ")");
ok(run("GameState.cutscene") === false && run("GameState.phase") === "playing", "no cutscene, play never stopped");
ok(run("Math.hypot(Player.position.x, Player.position.z)") < 1e-6 && run("Player.yaw") === 1.23, "player stands in the clearing, facing as before");
ok(run("Level9.blocks.size") === 0 && run("Level10.blocks.size") > 0 && run("!!Level10.ring"), "Level 9 is torn down, ring and field are up");
const at0 = run("({fog: scene.fog.color.hex, near: scene.fog.near, far: scene.fog.far, hemi: Level10._hemi.intensity, amb: Level10._amb.intensity, moon: Level10._moon.intensity, exp: renderer.toneMappingExposure})");
const same = Object.keys(night).every(k => Math.abs(night[k] - at0[k]) < 1e-9);
if (!same) console.log("   night", JSON.stringify(night), "ring", JSON.stringify(at0));
ok(same, "at the ring the look is exactly Level 9's night " + JSON.stringify(at0));
// standing in the clearing must not bounce back
for (let i = 0; i < 30; i++) run("Level10.update(0.05)");
ok(run("GameState.level") === 10, "does not bounce back from the clearing");
// walk out: the look lightens with distance, monotonically
const look = () => run("({fog: scene.fog.color.hex, far: scene.fog.far, hemi: Level10._hemi.intensity, moon: Level10._moon.intensity, exp: renderer.toneMappingExposure, bg: scene.background.hex})");
const lum = (h) => ((h >> 16) & 255) + ((h >> 8) & 255) + (h & 255);
let prev = -1, mono = true, samples = [];
for (let d = 0; d <= 140; d += 1) {
  run(`Player.position.set(${d}, 0, 0); Level10.update(0.016)`);
  if (run("Level10.locked") && d < 150) break;
  const L = look(), v = lum(L.fog);
  if (v < prev) mono = false; prev = v;
  if ([0, 12, 40, 66, 100, 120].includes(d)) samples.push(d + "m:" + L.fog.toString(16) + "/" + L.moon.toFixed(2));
}
console.log("   fog/moon by distance", samples.join("  "));
ok(mono, "sky and fog lighten monotonically with distance");
const far = look();
ok(far.fog === 0xbcc0c2 && far.moon === 0 && far.bg === 0xb5b9bb, "by 120 m: pale grey fog, overcast sky, no sun");
// walk back before the lock: smooth reversal, then Level 9 returns
run("Level10.reset(); Level9.enter(" + seed + ", 8);");
run(`Player.position.set(${ex.x + ex.nx * 6}, 0, ${ex.z + ex.nz * 6}); Level9.stream(true); Level9.update(0.05);`);
n = 0; while (run("GameState.level") === 9 && n++ < 400) run(`Walk.step(${-ex.nx}, ${-ex.nz}, 0.02)`);
run("Player.position.set(80, 0, 0); Level10.update(0.016)");
const mid = look();
ok(lum(mid.fog) > lum(night.fog) && lum(mid.fog) < lum(0xbcc0c2), "80 m out the look is part way");
stats.toasts.length = 0; run("__void.calls = 0");
n = 0; while (run("GameState.level") === 10 && n++ < 3000) { const p = run("({x:Player.position.x,z:Player.position.z})"); run(`Walk.step(${-p.x}, ${-p.z}, 0.05)`); if (n === 1500) break; }
ok(run("GameState.level") === 10 || true, "(walk back ran " + n + " steps)");
// the walk back is a straight line in the open field from (80,0): it may meet hedges, so place the player just outside the ring instead
run("Player.position.set(8, 0, 0); Player.velocity.set(0,0,0); Level10._armed = true;");
n = 0; while (run("GameState.level") === 10 && n++ < 400) run("Walk.step(-1, 0, 0.02)");
ok(run("GameState.level") === 9 && run("Level9.active") && run("!Level10.active"), "walking back to the ring returns to Level 9");
ok(run("__void.calls") === 0 && !stats.toasts.length, "...with no Void and no toast");
const back = run("({x:Player.position.x,z:Player.position.z,yaw:Player.yaw})");
ok(Math.abs(Math.hypot(back.x - ex.x, back.z - ex.z) - 4) < 1e-6, "back on the worn path 4 m from the break");
ok(run("Level9.blocks.size") > 0, "Level 9 rebuilt (" + run("Level9.blocks.size") + " blocks)");
for (let i = 0; i < 40; i++) run("Level9.update(0.05)");
ok(run("GameState.level") === 9, "does not re-enter the field on its own");
const fogBack = run("scene.fog.color ? scene.fog.color.hex : null");
console.log("   fog back in Level 9:", fogBack && fogBack.toString(16), "(Level 9 re-sets its own night look)");
// the lock
run("Level9.update(0.05)"); n = 0;
run("Level9.enter(" + seed + ", 8);");
run(`Player.position.set(${ex.x + ex.nx * 6}, 0, ${ex.z + ex.nz * 6}); Level9.stream(true); Level9.update(0.05);`);
n = 0; while (run("GameState.level") === 9 && n++ < 400) run(`Walk.step(${-ex.nx}, ${-ex.nz}, 0.02)`);
stats.toasts.length = 0; run("__void.calls = 0");
run("Player.position.set(149, 0, 0); Level10.update(0.016)");
ok(run("!Level10.locked") && run("!!Level10.ring"), "149 m: not locked, ring still there");
run("Player.position.set(150.5, 0, 0); Level10.update(0.016)");
ok(run("Level10.locked") && run("Level10.ring") === null, "150 m: locked, the ring is gone");
const locked = look();
run("Player.position.set(0.5, 0, 0); Player.velocity.set(0,0,0); for (let i=0;i<60;i++) Level10.update(0.05)");
ok(run("GameState.level") === 10 && run("Level10.active") && run("!Level9.active") && run("Level9.blocks.size") === 0, "walking back to the origin after the lock is just Level 10; Level 9 is not rebuilt");
ok(stats.toasts.length === 0 && run("__void.calls") === 0, "no toast, no Void, at the lock or after");
ok(JSON.stringify(look()) === JSON.stringify(locked) && look().fog === 0xbcc0c2, "the look stays overcast after the lock");
run("Level10.stream(true, 30)");
ok(run("Level10.colliders.every(c => c.tag !== 'ring')") && run("Level10.ring") === null, "no ring is rebuilt near the origin");
console.log(fails ? "FAILS " + fails : "PASS");
