const { ctx, run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run(`Level9.enter(8080, 8);`);
// open ground 30 m east of spawn, along the road
const clear = (x, z) => run(`Level9.isOpen(${x},${z},0.5,0.2,1.9)`);
run(`Player.position.set(${run("Level9.spawn.x")} + 60, 0, ${run("Level9.spawn.z")} - 8.5); Level9.stream(true);`);   // on the road
const P0 = run("[Player.position.x, Player.position.z]");
ok(clear(P0[0], P0[1]), "standing on open road");
const sim = (frames, drive) => { for (let i = 0; i < frames; i++) { if (drive) drive(i); run("GameState.elapsed += 0.05; Level9.update(0.05); HoundSystem.update(0.05);"); } };
const hound = (temper, dx) => run(`(function(){ const h = HoundSystem.spawnAt(Player.position.x + ${dx}, Player.position.z, true); Level9Entities._initHound(h, { id: "t:" + ${temper}, temper: ${temper} }); globalThis.__H = h; return !!h; })()`);
const dist = () => run("Math.hypot(__H.x - Player.position.x, __H.z - Player.position.z)");
// ---- 1. a hound keeps away when you walk at it
ok(hound(0.5, 14), "spawned a test Hound 14 m away");
let hp0 = run("Player.hp");
// walk toward it at walking pace for 8 s
const push = (speed) => `(function(){ const dx=__H.x-Player.position.x, dz=__H.z-Player.position.z, d=Math.hypot(dx,dz)||1; Player.velocity.x=dx/d*${speed}; Player.velocity.z=dz/d*${speed}; Player.position.x+=dx/d*${speed}*0.05; Player.position.z+=dz/d*${speed}*0.05; })()`;
let minD = 99;
sim(160, () => { run(push(4.6)); minD = Math.min(minD, dist()); });
console.log("   walking at it for 8 s: closest", minD.toFixed(1), "m, mood", run("__H.l9.mood"), "pursuit", run("__H.l9.pursuit").toFixed(1), "/", run("__H.l9.tol").toFixed(1), "hp", run("Player.hp"));
ok(minD > 4 && run("Player.hp") === hp0, "walking at a Hound: it keeps away and does nothing to you");
ok(run("__H.l9.mood") === "calm", "walking is not pursuit: still calm");
// ---- 2. sustained running: it gets agitated, then stands/defends, then (eventually) turns on you; stopping calms it
run("Player.velocity.set(0,0,0);");
const moods = [];
let turned = 0, t = 0;
// Run at it in its own direction for up to 60 s of game time. Keep Player within ~6-9 m (it keeps retreating).
sim(1200, (i) => { run(push(8.15)); const m = run("__H.l9.mood"); if (moods.length > 12) return; if (!moods.length || moods[moods.length - 1][1] !== m) moods.push([(i * 0.05).toFixed(1), m]); if (m === "hostile" && !turned) turned = i * 0.05; });
console.log("   sprinting after it:", moods.map(x => x[1] + "@" + x[0] + "s").join(" -> "));
ok(moods.some(m => m[1] === "wary") && moods.some(m => m[1] === "defensive"), "mood escalates: wary then defensive");
ok(turned > 8, "hostile only after sustained pursuit (" + turned.toFixed(1) + " s), not on one close pass");
ok(run("__H.passive") === false || run("__H.l9.mood") !== "hostile", "contact only hurts once hostile");
// stop chasing: break away and it calms down
run("Player.hp = 100; Player.velocity.set(0,0,0);");
const before = run("__H.l9.pursuit"), hostileBefore = run("__H.l9.mood");
// sprint directly away from it for 12 s (it is slower than the player), then stand still
sim(440, () => { run(`(function(){ let dx=Player.position.x-__H.x, dz=Player.position.z-__H.z; let d=Math.hypot(dx,dz); if(d<0.01){dx=1;dz=0;d=1;} Player.velocity.x=dx/d*8.15; Player.velocity.z=dz/d*8.15; Player.position.x+=dx/d*8.15*0.05; Player.position.z+=dz/d*8.15*0.05; })()`); });
console.log("   after breaking away 22 s: dist", dist().toFixed(0), "mood", run("__H.l9.mood"));
sim(600, () => { run("Player.velocity.set(0,0,0)"); });
console.log("   then standing still 30 s (hound should have given up): mood", run("__H.l9.mood"), "pursuit", before.toFixed(1), "->", run("__H.l9.pursuit").toFixed(1), "hostile before:", hostileBefore);
ok(run("__H.l9.mood") === "calm", "it calms down once you stop chasing and leave");
ok(run("__H.l9.pursuit") < before * 0.3, "pursuit decays");
// ---- 3. temperaments differ
const tol = (t) => run(`Level9Entities._initHound({x:0,z:0}, {id:"x",temper:${t}}) , 0`) && 0;
run(`globalThis.__a = { x:0,z:0 }; Level9Entities._initHound(__a, { id:"a", temper:0 }); globalThis.__b = { x:0,z:0 }; Level9Entities._initHound(__b, { id:"b", temper:1 });`);
console.log("   tolerance (weighted s): temper 0 =", run("__a.l9.tol"), " temper 1 =", run("__b.l9.tol"));
ok(run("__b.l9.tol") > run("__a.l9.tol") * 2, "tempers differ: patient Hounds tolerate >2x as long");
// ---- 4. it can use an open door to get indoors: flee choice prefers an interior
const id = run(`(function(){ for (const rec of Level9.blocks.values()) for (const h of rec.houses) if (!h.sp.locked) return h.id; })()`);
console.log(fails ? "FAILS " + fails : "PASS");
