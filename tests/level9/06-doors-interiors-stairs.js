const { ctx, run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run(`Level9.enter(2468, 8);`);
// find an unlocked and a locked house near the spawn
const find = (pred) => run(`(function(){ for (const rec of Level9.blocks.values()) for (const h of rec.houses) if (${pred}) return h.id; return null; })()`);
const goto = (id, where) => run(`(function(){ const q="${id}".split(",").map(Number); const lot=Level9Gen.block(q[0],q[1]).lots.find(l=>l.id==="${id}"); const sp=Level9Gen.houseSpec(lot); const p=Level9Gen.localToWorld(sp, sp.doorX, sp.D/2 + ${where}); Player.position.set(p.x,0,p.z); Player.velocity.set(0,0,0); Level9.stream(true); Level9._dT=0; Level9.update(0.3); return [p.x,p.z]; })()`);
const lockedId = find("h.sp.locked"), openId = find("!h.sp.locked");
ok(lockedId && openId, "found locked " + lockedId + " and unlocked " + openId);

// locked door
goto(lockedId, 1.3); stats.toasts.length = 0;
ok(run("Level9.tryUse()") === true && stats.toasts.includes("THE DOOR IS LOCKED"), "locked door says locked, does not open");
ok(run(`Level9.persist.open.has("${lockedId}")`) === false, "locked door state unchanged");

// unlocked door: open, interior built, passable
goto(openId, 1.3);
const hasInterior = () => run(`!!Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").interior`);
ok(!hasInterior(), "interior NOT built before opening");
const colBefore = run("Level9.colliders.length");
ok(run("Level9.tryUse()") === true, "unlocked door accepts E");
ok(hasInterior(), "interior built on open");
for (let i = 0; i < 30; i++) run("Level9.update(0.05)");
ok(run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").door.a`) === 1, "door finished swinging open");
const dcol = run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").door.collider.min.y`);
ok(dcol > 100, "door collider parked while open");
ok(run("Level9.colliders.length") > colBefore, "interior colliders added: +" + (run("Level9.colliders.length") - colBefore));

// walk through the door with the real physics
const walkTo = (id, lx, lz, speed = 3) => run(`(function(){
  const h=Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${id}"); const G=Level9Gen;
  let steps=0; const tgt=G.localToWorld(h.sp, ${lx}, ${lz});
  while (steps++ < 600) { const dx=tgt.x-Player.position.x, dz=tgt.z-Player.position.z, d=Math.hypot(dx,dz); if (d<0.25) break;
    Player.velocity.x=dx/d*${speed}; Player.velocity.z=dz/d*${speed}; Player.velocity.y -= 24 * 0.02; Physics.moveAndCollide(Player.position, Player.velocity, 0.34, 1.72, 0.02); if (Player.onGround) Player.velocity.y = 0; }
  return [steps, Player.position.x, Player.position.y, Player.position.z]; })()`);
run("Level.colliders = Level9.colliders; Player.onGround = true;");
let r = walkTo(openId, run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").sp.doorX`), -0.5);
const l = run(`Level9Gen.worldToLocal(Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").sp, ${r[1]}, ${r[3]})`);
const sp = run(`(function(){const s=Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").sp; return {W:s.W,D:s.D,doorX:s.doorX,zp:s.zp,garage:s.garage}})()`);
ok(l.z < sp.D / 2 - 0.5, `walked in through the open door: local z ${l.z.toFixed(2)} (front wall at ${(sp.D / 2).toFixed(2)})`);

// closed door blocks the player
goto(lockedId, 3);                         // stand outside a locked door and push in
r = walkTo(lockedId, run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${lockedId}").sp.doorX`), -1);
const l2 = run(`Level9Gen.worldToLocal(Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${lockedId}").sp, ${r[1]}, ${r[3]})`);
const D2 = run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${lockedId}").sp.D`);
ok(l2.z > D2 / 2, "locked door stops the player outside (local z " + l2.z.toFixed(2) + " > " + (D2 / 2).toFixed(2) + ")");

// STAIRS with the real physics: from inside the open house, up to the landing and into the upper room
goto(openId, 1.3);
walkTo(openId, sp.doorX, sp.D / 2 - 1.2);
const plan = run(`(function(){ const p = Level9Gen.interiorPlan(Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").sp); return {stair:p.stair, pxw:p.pxw, steps:p.steps.length, hole:p.hole, landing:p.landing}; })()`);
const sx = (plan.stair.x0 + plan.stair.x1) / 2;
walkTo(openId, sx, plan.stair.z1 + 0.45);                 // the approach to the stair foot
walkTo(openId, sx, plan.stair.z1 - 0.05, 1.6);             // onto the first step
let t = walkTo(openId, sx, plan.stair.z0 + 0.3, 2.6);     // climb
console.log("   after climb y =", t[2].toFixed(2), "steps", t[0]);
ok(t[2] > 2.7, "climbed the stairs under real physics: y=" + t[2].toFixed(2));
// onto the landing, through the doorway into the upper room
const lz = (plan.landing.z0 + plan.landing.z1) / 2;
t = walkTo(openId, plan.landing.x0 + 0.6, plan.stair.z0 - 0.5, 2.6);
t = walkTo(openId, plan.landing.x0 + 0.6, lz, 2.6);
const y1 = t[2];
t = walkTo(openId, plan.pxw + 1.6, lz, 2.6);
const lu = run(`Level9Gen.worldToLocal(Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").sp, ${t[1]}, ${t[3]})`);
ok(Math.abs(t[2] - 3.0) < 0.1 && lu.x > plan.pxw + 1.0, `reached the upper room via the landing (y=${t[2].toFixed(2)}, local x=${lu.x.toFixed(2)} > partition ${plan.pxw.toFixed(2)})`);
// and down again
t = walkTo(openId, plan.landing.x0 + 0.6, lz, 2.6);
t = walkTo(openId, sx, plan.stair.z0 + 0.2, 2.6);
t = walkTo(openId, sx, plan.stair.z1 + 0.5, 2.6);
for (let i = 0; i < 40; i++) run("Player.velocity.y -= 0.48; Physics.moveAndCollide(Player.position, Player.velocity, 0.34, 1.72, 0.02); if (Player.onGround) Player.velocity.y = 0;");
ok(run("Player.position.y") < 0.3, "came back down to the ground floor: y=" + run("Player.position.y").toFixed(2));

// persistence: leave, interior unloads, return, door still open and interior rebuilt
run(`Player.position.set(Player.position.x + 400, 0, Player.position.z); Level9.stream(true); Level9.update(0.6);`);
ok(run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}")`) === undefined, "far house and its interior are unloaded");
goto(openId, 6);
for (let i = 0; i < 20; i++) run("Level9.update(0.6)");
ok(hasInterior(), "interior rebuilt on return (door was left open)");
ok(run(`Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${openId}").door.target`) === 1, "door still open on return");
// close it again
goto(openId, 1.3);
ok(run("Level9.tryUse()") === true && run(`Level9.persist.open.has("${openId}")`) === false, "door closes again and the state is saved");
console.log(fails ? "FAILS " + fails : "PASS");
