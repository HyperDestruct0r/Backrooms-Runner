const { ctx, run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run(`Level9.enter(777, 8);`, "enter");
const walk = (dx, dz, meters) => {
  let maxBlocks = 0, maxCol = 0, maxMs = 0, sumMs = 0, frames = 0;
  const steps = Math.floor(meters / 0.4);   // 8 m/s at 0.05 dt
  for (let i = 0; i < steps; i++) {
    run(`Player.position.x += ${dx * 0.4}; Player.position.z += ${dz * 0.4}; GameState.elapsed += 0.05;`);
    const t0 = process.hrtime.bigint();
    run(`Level9.update(0.05);`);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    maxMs = Math.max(maxMs, ms); sumMs += ms; frames++;
    maxBlocks = Math.max(maxBlocks, run("Level9.blocks.size")); maxCol = Math.max(maxCol, run("Level9.colliders.length"));
  }
  return { maxBlocks, maxCol, maxMs: maxMs.toFixed(1), avgMs: (sumMs / frames).toFixed(2) };
};
for (const [dx, dz, name] of [[1, 0, "east"], [0, 1, "south"], [-0.7071, -0.7071, "northwest"]]) {
  const r = walk(dx, dz, 1500);
  console.log(name, JSON.stringify(r), "geo created", stats.geoCreated, "disposed", stats.geoDisposed, "live", stats.geoCreated - stats.geoDisposed);
  ok(r.maxBlocks <= 30, name + " blocks bounded " + r.maxBlocks);
  ok(r.maxCol < 6000, name + " colliders bounded " + r.maxCol);
}
const live = stats.geoCreated - stats.geoDisposed;
const liveBlocks = run("Array.from(Level9.blocks.values()).reduce((n,r)=>n+r.geos.length,0)");
ok(live === liveBlocks, `no leaked geometry: live ${live} vs referenced ${liveBlocks}`);
// revisit: same layout after returning
run(`Player.position.set(0,0,0); Level9.stream(true);`);
const sig = () => run(`Array.from(Level9.blocks.values()).map(r=>r.key+":"+r.houses.length+":"+r.colliders.length).sort().join("|")`);
const s1 = sig();
run(`Player.position.set(900,0,900); Level9.stream(true); Level9.update(0.05);`);
run(`Player.position.set(0,0,0); Level9.stream(true);`);
ok(sig() === s1, "revisiting the spawn rebuilds the identical blocks");
console.log(fails ? "FAILS " + fails : "PASS");
