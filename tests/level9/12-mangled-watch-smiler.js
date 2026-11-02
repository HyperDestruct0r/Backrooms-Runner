const { ctx, run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run(`Level9.enter(31415, 8);`);
const step = (n, fn) => { for (let i = 0; i < n; i++) { if (fn) fn(i); run("GameState.elapsed += 0.05; Level9.update(0.05); HoundSystem.update(0.05); SmilerSystem.update(0.05);"); } };

// ---- Smiler gating
const lamp = run(`(function(){ const f = Level9.fixtures.find(f => f.kind === "lamp" && f.on && !f.flick); return f ? { x: f.x, z: f.z } : null; })()`);
run(`Player.position.set(${lamp.x} + 2.5, 0, ${lamp.z}); Level9.update(0.05);`);
ok(run("Level9.lightAt(Player.position.x, Player.position.z)") > 0.5, "under a working streetlamp it is bright: " + run("Level9.lightAt(Player.position.x, Player.position.z)").toFixed(2));
ok(run("Level9Entities.smilerAllowed()") === false, "Smilers are not allowed to hunt you in lamplight");
run(`(function(){ Player.position.set(${lamp.x} + 40, 0, ${lamp.z} + 3); Level9.stream(true); for (let i=0;i<400;i++){ const x=Player.position.x+(i%20)*2, z=Player.position.z+Math.floor(i/20)*2; if (Level9.isOpen(x,z,0.5,0.2,1.9) && Level9.lightAt(x,z)===0 && !Level9Entities.houseAt(x,z)) { Player.position.set(x,0,z); break; } } Level9.stream(true); Level9.update(0.05); })()`);
const dark = run("Level9.lightAt(Player.position.x, Player.position.z)");
console.log("   a dark spot: light", dark.toFixed(2));
ok(dark < 0.22 && run("Level9Entities.smilerAllowed()") === true, "in the dark Smilers are allowed");
const insideId = run(`(function(){ for (const r of Level9.blocks.values()) for (const h of r.houses) return h.id; })()`);
const inside = run(`(function(){ const h = Array.from(Level9.blocks.values()).flatMap(r=>r.houses)[0]; const p = Level9Gen.localToWorld(h.sp, 0, 0); return [p.x, p.z]; })()`);
ok(run(`Level9Entities.isDarkSpot(${inside[0]}, ${inside[1]})`) === false, "Smilers never spawn inside a house footprint");
ok(run("SmilerSystem.opts.cap") <= 2, "Smiler cap is small: " + run("SmilerSystem.opts.cap"));

// ---- Mangled distribution at runtime
const popAt = (x, z, ticks = 12) => {
  run(`Level9.enter(31415, 8); Level9.teleportTo(${x}, ${z});`);
  let mx = 0;
  for (let i = 0; i < ticks; i++) { run(`Player.position.x += 9; Level9.stream(true); Level9.update(0.5); Level9Entities._popT = 0;`); mx = Math.max(mx, run("Level9Entities.mangled.length")); }
  return mx;
};
let nearSeen = 0, farSeen = 0;
const sp = run("[Level9.spawn.x, Level9.spawn.z]");
for (let k = 0; k < 8; k++) { nearSeen += popAt(sp[0] + 120 + k * 45, sp[1] + (k % 2 ? 60 : -60)) > 0 ? 1 : 0; }
for (let k = 0; k < 8; k++) { farSeen += popAt(sp[0] + 2300 + k * 90, sp[1] + (k % 3) * 70) > 0 ? 1 : 0; }
console.log("   spots with a Mangled: within 500 m", nearSeen, "/8 ; beyond 2000 m", farSeen, "/8");
ok(nearSeen === 0, "no Mangled near the start");
ok(farSeen >= 3, "established threat deep in");

// ---- Mangled behaviour
run(`Level9.enter(31415, 8); Level9.teleportTo(${sp[0] + 2600}, ${sp[1] + 10}); Level9Entities.reset(); Level9Entities.attach(Level9);`);
// find a dark open spot: stand at a point with no light
const stand = run(`(function(){ for (let i=0;i<200;i++){ const x=Player.position.x+(i%20)*3, z=Player.position.z+Math.floor(i/20)*3; if (Level9.isOpen(x,z,0.5,0.2,1.9) && Level9.lightAt(x,z)===0) { Player.position.set(x,0,z); return [x,z]; } } return null; })()`);
ok(stand, "found a dark open spot");
run("Level9.stream(true); Level9Entities.force('mangled');");
ok(run("Level9Entities.mangled.length") === 1, "forced a Mangled");
const m = () => run("Level9Entities.mangled[0]");
const states = new Set(); let minD = 99, hits = 0, hp0 = run("Player.hp");
step(600, () => { const e = run("Level9Entities.mangled[0] && [Level9Entities.mangled[0].state, Math.hypot(Level9Entities.mangled[0].x-Player.position.x, Level9Entities.mangled[0].z-Player.position.z)]"); if (e) { states.add(e[0]); minD = Math.min(minD, e[1]); } });
console.log("   player in the dark, 30 s: states seen", [...states].join(","), "closest", minD.toFixed(1), "hp", hp0, "->", run("Player.hp"));
ok(states.has("stalk") && states.has("lunge") && states.has("recover"), "stalks, lunges, then has to recover (not a straight chaser)");
ok(run("Player.hp") < hp0, "it can hurt you in the dark");
// retreat: in light it holds back
run("Player.hp = 100; HoundSystem.dying = false;");
run(`Level9.teleportTo(${lamp.x + 2.5 + 0}, ${lamp.z});`);
run("Level9Entities.mangled.forEach(e => Level9Entities._freeMangled(e)); Level9Entities.mangled.length = 0;");
// the lamp must be loaded: rebuild around it
run(`(function(){ const f = Level9.fixtures.find(f => f.kind==='lamp' && f.on && !f.flick); Player.position.set(f.x + 2.5, 0, f.z); Level9.stream(true); })()`);
const lampLit = run("Level9.lightAt(Player.position.x, Player.position.z)");
ok(lampLit > 0.5, "standing in lamplight: " + lampLit.toFixed(2));
run(`(function(){ for (let i=0;i<60;i++){ const a=i/60*6.28, r=14, x=Player.position.x+Math.cos(a)*r, z=Player.position.z+Math.sin(a)*r; if (Level9.isOpen(x,z,0.4,0.3,1.4) && Level9._chk===undefined) { const e = Level9Entities._makeMangled({id:'lt', x, z, temper: 0.5}); if (e) { e.state='stalk'; break; } } } })()`);
let minLit = 99, lunged = false;
step(200, () => { const e = run("Level9Entities.mangled[0] && [Level9Entities.mangled[0].state, Math.hypot(Level9Entities.mangled[0].x-Player.position.x, Level9Entities.mangled[0].z-Player.position.z)]"); if (e) { minLit = Math.min(minLit, e[1]); if (e[0] === "lunge") lunged = true; } });
console.log("   player in lamplight, first 10 s: closest", minLit.toFixed(1), "lunged", lunged);
ok(minLit > 6 && !lunged, "it hangs back from the light instead of charging in");
// but light is not a wall: it eventually crosses
step(1000, () => { const e = run("Level9Entities.mangled[0] && Level9Entities.mangled[0].state"); if (e === "lunge") lunged = true; });
ok(lunged, "light is not an absolute barrier: with time it will cross it");

// ---- The Watch
run(`Level9.enter(31415, 8); Level9.teleportTo(${sp[0] + 80}, ${sp[1] - 8.5});`);
run("Player.yaw = -Math.PI/2;");
run("Level9Entities.force('watch');");
const W = () => run("Level9Entities.watch && [Level9Entities.watch.state, Level9Entities.watch.mode, +Level9Entities.watch.o.toFixed(2), +Math.hypot(Level9Entities.watch.x-Player.position.x, Level9Entities.watch.z-Player.position.z).toFixed(1)]");
step(60);
const w0 = W();
console.log("   watch after spawn:", JSON.stringify(w0));
ok(w0 && w0[0] === "observe" && w0[2] > 0.3, "it appears and observes (opacity " + (w0 && w0[2]) + ")");
ok(w0 && w0[3] >= 11, "from a distance (" + (w0 && w0[3]) + " m)");
// shining the torch on it changes nothing
run("Flashlight.enabled = true;"); step(100);
ok(W()[0] === "observe" || W()[0] === "fadeout", "flashlight alone does not provoke it: " + W()[0]);
// walking up to it: it withdraws, never attacks, and fades out if you actually reach it
let wst = new Set(), md = 99;
const approach = (speed) => { run(`(function(){ const w=Level9Entities.watch; if(!w||w.state==="absent") return; const dx=w.x-Player.position.x, dz=w.z-Player.position.z, d=Math.hypot(dx,dz)||1; Player.velocity.x=dx/d*${speed}; Player.velocity.z=dz/d*${speed}; Player.position.x+=dx/d*${speed}*0.05; Player.position.z+=dz/d*${speed}*0.05; })()`); const q = W(); if (q && q[0] !== 'absent') { wst.add(q[0]); md = Math.min(md, q[3]); } };
step(500, () => approach(4.6));
console.log("   walking at it for 25 s: states", [...wst].join(","), "closest", md);
ok(!wst.has("strike") && wst.has("withdraw"), "walking at it makes it withdraw, and it never attacks");
ok(md >= 3.4, "a walker never catches it: closest " + md + " m");
// sustained sprinting after it: first it keeps its distance, then turns hostile, and rarely strikes
run("Level9Entities.watch.state = 'absent'; Level9Entities.watch.timer = 0; Level9Entities.watch.pursuit = 0; Player.hp = 100;");
step(40); wst = new Set(); md = 99;
let tStrike = -1, hpBefore = run("Player.hp"), tStart = 0;
run("SmilerSystem.opts.cap = 0;");
for (let i = 0; i < 1800 && tStrike < 0; i++) { const w = W(); if (w && w[0] === "absent") { run("Level9Entities.watch.timer = 0;"); } step(1, () => approach(8.15)); const q = W(); if (q && q[0] === "strike" && tStrike < 0) tStrike = i * 0.05; }
for (let i = 0; i < 80; i++) step(1, () => approach(2));
console.log("   sprinting at it: states", [...wst].join(","), "first strike at", tStrike.toFixed(1), "s, hp", hpBefore, "->", run("Player.hp"));
ok(run("Player.hp") < hpBefore, "and the strike hurts: hp " + hpBefore + " -> " + run("Player.hp"));
ok(wst.has("withdraw") && tStrike > 5, "a strike needs sustained pursuit (" + tStrike.toFixed(1) + " s), not one dash");
console.log(fails ? "FAILS " + fails : "PASS");
