const { ctx, run, stats } = require("./harness.js");
const fs = require("fs");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const seed = 99;
run(`Level9.enter(${seed}, 8);`);
// ---- almond water
const found = run(`(function(){ const G=Level9Gen; let a=null,b=null; for (let bj=-6;bj<=6&&!(a&&b);bj++) for (let bi=-6;bi<=6;bi++) for (const l of G.block(bi,bj).lots) { if (l.kind!=="house") continue; const s=G.houseSpec(l); if (s.locked||!s.fridge) continue; if (s.bottle && !a) a=l.id; if (!s.bottle && !b) b=l.id; } return {a,b}; })()`);
ok(found.a && found.b, "found a bottle house " + found.a + " and an empty-fridge house " + found.b);
const tp = (id, d) => run(`(function(){ const q="${id}".split(",").map(Number); const lot=Level9Gen.block(q[0],q[1]).lots.find(l=>l.id==="${id}"); const sp=Level9Gen.houseSpec(lot); const p=Level9Gen.localToWorld(sp, sp.doorX, sp.D/2+${d}); Player.position.set(p.x,0,p.z); Level9.stream(true); Level9._dT=0; Level9.update(0.3); })()`);
const house = (id) => `Array.from(Level9.blocks.values()).flatMap(r=>r.houses).find(h=>h.id==="${id}")`;
const toFridge = (id) => run(`(function(){ const h=${house("__ID__".replace("__ID__", id))}; const w=Level9._fridgeWorld(h); const f=h.interior.plan.fridge; const fr=[[0,1],[0,-1],[1,0],[-1,0]][f.face]; const l={x:f.x+fr[0]*1.2,z:f.z+fr[1]*1.2}; const p=Level9Gen.localToWorld(h.sp,l.x,l.z); Player.position.set(p.x,0,p.z); })()`);
for (const [label, id, wantBottle] of [["bottle", found.a, true], ["empty", found.b, false]]) {
  tp(id, 1.3); run("Level9.tryUse()"); toFridge(id);
  const before = run("PickupSystem.list.length");
  ok(run("Level9.tryUse()") === true, label + ": E opens the fridge");
  ok(run("PickupSystem.list.length") - before === (wantBottle ? 1 : 0), label + ": bottle appears only when it should (" + (run("PickupSystem.list.length") - before) + ")");
  ok(run("Level9.tryUse()") === false, label + ": second E falls through to the normal pickup");
  if (wantBottle) {
    run(`PickupSystem.list[PickupSystem.list.length-1].taken = true;`);       // the player takes it (PickupSystem.tryPickup does this)
    run(`Level9._interiors();`);
    ok(run(`Level9.persist.taken.has("${id}")`), "taking it is remembered");
    run(`Player.position.set(Player.position.x+500,0,Player.position.z); Level9.stream(true); Level9.update(0.6);`);
    ok(run("PickupSystem.list.length") === before, "interior unload removes the pickup entry (no leak)");
    tp(id, 6); for (let i = 0; i < 10; i++) run("Level9.update(0.6)");
    ok(run(`!!${house(id)}.interior`), "house rebuilt");
    ok(run("PickupSystem.list.filter(p=>!p.taken).length") === 0, "collected bottle does NOT come back");
    ok(run(`Level9.persist.fridge.has("${id}")`), "fridge stays open");
  }
}
// bottle statistics over a big area: fridge 25%, bottle share of fridges 15-20% before cap
const stat = run(`(function(){ const G=Level9Gen; let n=0,f=0,c=0,b=0,l=0; for (let bj=-12;bj<=12;bj++) for (let bi=-12;bi<=12;bi++) for (const x of G.block(bi,bj).lots) { if (x.kind!=="house") continue; const s=G.houseSpec(x); n++; if(s.locked)l++; if(s.fridge){f++; if(G.lh(x,24)<0.175)c++; if(s.bottle)b++;} } return {n,f,c,b,l}; })()`);
console.log("   houses", stat.n, "locked", (stat.l / stat.n * 100).toFixed(1) + "%", "fridge", (stat.f / stat.n * 100).toFixed(1) + "%", "bottle roll/fridge", (stat.c / stat.f * 100).toFixed(1) + "%", "accepted after cap", stat.b);
ok(stat.l / stat.n > 0.63 && stat.l / stat.n < 0.71, "locked share ~67%");
ok(stat.f / stat.n > 0.22 && stat.f / stat.n < 0.28, "fridge share ~25%");
ok(stat.c / stat.f > 0.15 && stat.c / stat.f < 0.20, "bottle roll 15-20% of fridges");

// ---- exits
const exits = run(`Level9Gen.exitList()`);
const byKind = (k) => exits.filter(e => e.kind === k).sort((a, b) => a.dist - b.dist);
console.log("   exits:", exits.map(e => e.kind + "@" + Math.round(e.dist)).join(" "));
ok(byKind("level11").length === 1 && byKind("level11")[0].dist >= 2000, "exactly one Level 11 exit, " + Math.round(byKind("level11")[0].dist) + " m out");
ok(byKind("level8").length === 1 && byKind("level8")[0].dist > 120, "one way back to Level 8, " + Math.round(byKind("level8")[0].dist) + " m out");
ok(byKind("level10")[0].dist > 250 && byKind("level10")[0].dist < 760, "nearest Level 10 exit " + Math.round(byKind("level10")[0].dist) + " m");
ok(run("Level9.spawn.x") !== byKind("level8")[0].x, "arrival point is not the return hole");
const stand = (e) => run(`(function(){ const e=${JSON.stringify(e)}; Player.position.set(e.x, 0, e.z); Level9.stream(true); Level9.update(0.05); })()`);
// level 10 / 11: run ends (not built)
for (const [k, n] of [["level10", 10], ["level11", 11]]) {
  run(`Level9.enter(${seed}, 8);`);
  const e = k === 'level10' ? run('Level9Gen.exitList()').filter(q=>q.kind==='level10').sort((a,b)=>a.dist-b.dist)[0] : byKind(k)[0];
  const S = run('Level9Gen.special()'); const lot = k === 'level11' ? S.exit11 : S.fields[0].lot; const L = run(`Level9Gen.block(${lot.bi},${lot.bj}).lots.find(l=>l.id==='${lot.id}')`); const ax = e.x + L.nx * 6, az = e.z + L.nz * 6;
  run(`Player.position.set(${ax}, 0, ${az}); Level9.stream(true); Level9.update(0.05);`);
  ok(run("Level9._ended") === false, k + ": not triggered from 6 m");
  // the exit point itself must be standable: walk to it with real physics
  run("Level.colliders = Level9.colliders");
  const r = run(`(function(){ const tx=${e.x}, tz=${e.z}; for (let i=0;i<400;i++){ const dx=tx-Player.position.x, dz=tz-Player.position.z, d=Math.hypot(dx,dz); if(d<0.3)break; Player.velocity.x=dx/d*3; Player.velocity.z=dz/d*3; Player.velocity.y-=0.48; Physics.moveAndCollide(Player.position,Player.velocity,0.34,1.72,0.02); if(Player.onGround)Player.velocity.y=0; Level9.update(0.02);} return [Player.position.x-tx, Player.position.z-tz, Level9._ended]; })()`);
  ok(r[2] === true, `${k}: reachable on foot from 6 m, triggers the exit (off by ${r[0].toFixed(1)},${r[1].toFixed(1)})`);
  ok(stats.toasts.includes("LEVEL " + n + " IS NOT BUILT YET"), k + ": says the level is not built yet");
}
fs.writeFileSync("/tmp/ok", "x");
console.log(fails ? "FAILS " + fails : "PASS");
