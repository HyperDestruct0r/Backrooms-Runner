const { run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const seed = 99;
run(`Level10.enter(${seed});`);
const e = run("(function(){ const x=Level10Gen.exitInfo(); return {x:x.x,z:x.z,d:x.dist,st:{x:x.st.x,z:x.st.z,yaw:x.st.yaw,d:x.st.d}}; })()");
// approach from the door end: 8 m out on the door axis, then walk in with real physics
const door = run(`Level10Gen.local(Level10Gen.exitInfo().st, 0, ${e.st.d / 2 + 8})`);
run(`Player.position.set(${door.x}, 0, ${door.z}); Level10.stream(true); Level10.update(0.05);`);
ok(run("Level10._ended") === false && run("Level10.exits.length") === 1, "exit barn built, not triggered from outside");
stats.toasts.length = 0; run("__complete.length = 0; __void.calls = 0");
let n = 0;
while (!run("Level10._ended") && n++ < 1500) { const p = run("({x:Player.position.x,z:Player.position.z})"); run(`Walk.step(${e.x - p.x}, ${e.z - p.z}, 0.02)`); }
ok(run("Level10._ended"), "walked in through the door and reached the way on (" + n + " steps)");
ok(stats.toasts.includes("LEVEL 11 IS NOT BUILT YET"), "toasts LEVEL 11 IS NOT BUILT YET");
ok(run("__complete.length") === 1 && run("__complete")[0] === 10, "calls Game.complete");
ok(run("__void.calls") === 0, "no Void");
// physics: wheat has no colliders and can be walked through; hedges stop you and can be jumped; gates are open
run(`Level10.enter(${seed});`);
const fx = run(`(function(){ const G=Level10Gen; for (let j=-8;j<=8;j++) for (let i=-8;i<=8;i++) { const s=G.seg("V",i,j); if (s.type==="hedge") return {x:s.line, a:s.a, b:s.b, g:s.gate}; } })()`);
const zz = fx.a + 6;                                          // away from the gate
run(`Player.position.set(${fx.x - 6}, 0, ${zz}); Level10.stream(true, 40); Level10.update(0.05);`);
for (let i = 0; i < 300; i++) run("Walk.step(1, 0, 0.02)");
ok(Math.abs(run("Player.position.x") - (fx.x - 0.4 - 0.34)) < 0.3 && run("Player.position.x") < fx.x, "a hedge blocks walking (stopped at x=" + run("Player.position.x").toFixed(2) + " of " + fx.x + ")");
// sprint-jump over it
run(`Player.position.set(${fx.x - 6}, 0, ${zz}); Player.velocity.set(0,0,0); Level10.update(0.05);`);
let crossed = false;
for (let i = 0; i < 400 && !crossed; i++) {
  const p = run("({x:Player.position.x})");
  run(`Level.colliders = Level10.colliders; Player.velocity.x = 8.5; Player.velocity.z = 0; if (${fx.x - p.x} < 2.2 && Player.onGround) { Player.velocity.y = 7.4; Player.onGround = false; } Player.velocity.y -= 24*0.02; Physics.moveAndCollide(Player.position, Player.velocity, 0.34, 1.72, 0.02); Level10.update(0.02);`);
  if (run("Player.position.x") > fx.x + 1) crossed = true;
}
ok(crossed, "a hedge (0.9 m, always the same height) can be jumped");
run(`Player.position.set(${fx.x - 6}, 0, ${fx.a + (fx.g - fx.a)}); Player.velocity.set(0,0,0); Level10.update(0.05);`);
for (let i = 0; i < 300; i++) run("Walk.step(1, 0, 0.02)");
ok(run("Player.position.x") > fx.x + 3, "the gate lets you walk straight through");
// wheat adds no colliders at all: every collider is a hedge, fence, wall, hay, roof or water
const tags = run("Array.from(new Set(Level10.blocks.size ? Array.from(Level10.blocks.values()).flatMap(r=>r.colliders.map(c=>c.tag)) : []))");
ok(tags.every(t => ["hedge", "fence", "wall", "hay", "roof", "water"].includes(t)), "colliders are only AABBs of: " + tags.join(","));
// the lake blocks wading, the walls of a barn block walking through
const L = run(`(function(){ const G=Level10Gen; for (let j=-20;j<=20;j++) for (let i=-20;i<=20;i++) { const p=G.plot(i,j); if (p.lake) return p.lake; } })()`);
run(`Player.position.set(${L.x - L.r - 6}, 0, ${L.z}); Player.velocity.set(0,0,0); Level10.stream(true, 40); Level10.update(0.05);`);
for (let i = 0; i < 400; i++) run("Walk.step(1, 0, 0.02)");
ok(run("Player.position.x") < L.x - L.r * 0.5, "a lake cannot be walked into (stopped at " + (run("Player.position.x") - L.x).toFixed(1) + " from its centre, r " + L.r.toFixed(1) + ")");
// almond water: only appears in a barn, is a normal pickup, a taken one does not come back
const B = run(`(function(){ const G=Level10Gen; for (let j=-30;j<=30;j++) for (let i=-30;i<=30;i++) { const p=G.plot(i,j); if (p.st && p.st.water) return {x:p.st.x,z:p.st.z,id:p.st.id}; } })()`);
run(`Player.position.set(${B.x}, 0, ${B.z}); Level10.stream(true, 40);`);
ok(run("PickupSystem.list.filter(q=>q.kind==='almond').length") === 1, "the barn with water has one almond water");
run("PickupSystem.list[0].taken = true; Player.position.set(2000, 0, 2000); Level10.stream(true, 40);");
ok(run(`Level10.persist.taken.has("${B.id}")`), "taking it is remembered");
run(`Player.position.set(${B.x}, 0, ${B.z}); Level10.stream(true, 40);`);
ok(run("PickupSystem.list.filter(q=>q.kind==='almond'&&!q.taken).length") === 0, "a taken bottle does not come back");
console.log(fails ? "FAILS " + fails : "PASS");
