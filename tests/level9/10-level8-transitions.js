const { ctx, run, stats } = require("./harness.js");
const fs = require("fs");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run(fs.readFileSync(require("path").resolve(__dirname, "../../js/levels/level8.js"), "utf8"), "level8.js");
run(`Level8.enter(555, 6);`);
ok(run("Level8.active && !Level9.active"), "Level 8 entered, Level 9 idle");
const sealed = run("Level8.exitPos") !== null;
// Level 8 exit -> Level 9 (the real finish path; no VoidTransition in the harness, so it is immediate)
run("Level8.finish()");
ok(run("Level9.active && !Level8.active && GameState.level === 9"), "Level 8 exit leads into Level 9 (Level 8 reset)");
ok(run("Level9.seed") === 555, "Level 9 inherits the seed");
// open a door in Level 9, leave through the hole, come back
const id = run(`(function(){ for (const rec of Level9.blocks.values()) for (const h of rec.houses) if (!h.sp.locked) return h.id; })()`);
run(`(function(){ const h=Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${id}"); const p=Level9Gen.localToWorld(h.sp,h.sp.doorX,h.sp.D/2+1.3); Player.position.set(p.x,0,p.z); Level9.update(0.3); Level9.tryUse(); })()`);
ok(run(`Level9.persist.open.has("${id}")`), "opened a door in Level 9");
run("GameState.elapsed = 50;");
const hole = run("Level9.backPos");
const S = run("Level9Gen.special()"), L = run(`Level9Gen.block(${S.hole8.bi},${S.hole8.bj}).lots.find(l=>l.id==='${S.hole8.id}')`);
run(`Player.position.set(${hole.x + L.nx * 6}, 0, ${hole.z + L.nz * 6}); Level9.stream(true); Level9.update(0.05); Level.colliders = Level9.colliders;`);
const r = run(`(function(){ const tx=${hole.x}, tz=${hole.z}; for (let i=0;i<500;i++){ if (!Level9.active) break; const dx=tx-Player.position.x, dz=tz-Player.position.z, d=Math.hypot(dx,dz); if(d<0.3)break; Player.velocity.x=dx/d*3; Player.velocity.z=dz/d*3; Player.velocity.y-=0.48; Physics.moveAndCollide(Player.position,Player.velocity,0.34,1.72,0.02); if(Player.onGround)Player.velocity.y=0; Level9.update(0.02);} return Level9._leaving; })()`);
ok(r === true, "walking into the hole starts the trip back to Level 8");
setTimeout(() => {
  ok(run("Level8.active && !Level9.active && GameState.level === 8"), "arrived back in Level 8");
  const P = run("[Player.position.x, Player.position.z]"), X = run("[Level8.exitPos.x, Level8.exitPos.z]");
  ok(Math.hypot(P[0] - X[0], P[1] - X[1]) < 1, "placed beside a Level 8 exit hole, not the sealed arrival door");
  // and down again: same seed -> same suburb, same door left open
  run("Level8.finish()");
  ok(run("Level9.active && Level9.seed") === 555, "descended again");
  ok(run(`Level9.persist.open.has("${id}")`), "the door left open is still open after the round trip");
  ok(run("Level9.look.fogFar === 21 && scene.fog.far === 21"), "fog restored on re-entry");
  // new run (elapsed reset) forgets
  run("GameState.elapsed = 1; Level9.enter(555, 8);");
  ok(run(`Level9.persist.open.has("${id}")`) === false, "a new run (clock reset) starts with fresh doors");
  // leaving to another level restores the flashlight
  run("Flashlight.enabled = true; Level9._flashLimit();");
  const lim = run("Flashlight.light.intensity");
  run("Level9.reset();");
  ok(run("Flashlight.light.distance") === 68 && run("Flashlight.light.intensity") === 42, `flashlight restored on leaving (was ${lim} at half power)`);
  console.log(fails ? "FAILS " + fails : "PASS");
}, 50);
