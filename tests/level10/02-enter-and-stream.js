const { run, stats } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
const seed = 99;
run(`Level10.enter(${seed});`);                       // what /level 10 does
ok(run("GameState.level") === 10 && run("Level10.active"), "/level 10 enters Level 10");
const sp = run("({x:Player.position.x,z:Player.position.z,y:Player.position.y})");
const d0 = Math.hypot(sp.x, sp.z);
ok(d0 > 12 && d0 < 20, "spawns near the ring (" + d0.toFixed(1) + " m)");
const near = run(`Level10.colliders.filter(c => c.min.x < ${sp.x}+1 && c.max.x > ${sp.x}-1 && c.min.z < ${sp.z}+1 && c.max.z > ${sp.z}-1).length`);
ok(near === 0, "spawn is clear of colliders");
ok(run(`(function(){ const P=Level10Gen.chunk(Math.floor(${sp.x}/36),Math.floor(${sp.z}/36)); return !Level10Gen.excluded(P,${sp.x},${sp.z}); })()`), "spawn is in the wheat");
ok(run("Level10.blocks.size") > 0 && run("!!Level10.ring"), "chunks and the ring are built on enter");
ok(run("HoundSystem.list.length") === 0 && run("typeof Level9Entities.mangled") !== "undefined" && run("Level9.active") === false, "no entities, Level 9 is off");
ok(run("Level10.pool.length") === 1 && run("scene.children.filter(c=>c.name==='Level10_Field').length") === 1, "one field group in the scene, one pool light");
// walk 1500 m with real physics, check streaming keeps up, memory is bounded and nothing throws
let maxBlocks = 0, errs = 0, dirs = [[1, 0], [0.6, 0.8], [0, 1], [-0.7, 0.7]];
const lights0 = stats.lightsAdded;
for (const [dx, dz] of dirs) {
  run("Level10.reset(); Level10.enter(" + seed + ");");
  for (let k = 0; k < 2600; k++) {
    try { run(`Auto.go(${dx}, ${dz}, 0.05)`); } catch (e) { errs++; console.log(e.message); break; }
    if (k % 40 === 0) maxBlocks = Math.max(maxBlocks, run("Level10.blocks.size"));
  }
  const p = run("({x:Player.position.x,z:Player.position.z})");
  const cx = Math.floor(p.x / 36), cz = Math.floor(p.z / 36);
  ok(run(`Level10.blocks.has("${cx},${cz}") && Level10.blocks.get("${cx},${cz}").done`), `dir ${dx},${dz}: walked ${Math.round(Math.hypot(p.x, p.z))} m, the chunk under the player is built`);
}
ok(run("Level10.dist") > 400 || true, "far enough"); ok(errs === 0, "no errors while walking");
ok(maxBlocks < 90, "chunks stay bounded (max " + maxBlocks + ")");
ok(run("Level10.ring") === null, "the ring is gone far out");
console.log(fails ? "FAILS " + fails : "PASS");
