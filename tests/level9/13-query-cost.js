const { ctx, run } = require("./harness.js");
run(`Level9.enter(2024, 8);`);
for (let k = 0; k < 30; k++) run(`Player.position.x += 40; Level9.stream(true);`);
const n = run("[Level9.entColliders.length, Level9.colliders.length, Level9.blocks.size]");
const t0 = process.hrtime.bigint(); for (let i = 0; i < 200; i++) run("Level9._collect()"); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
const t1 = process.hrtime.bigint(); for (let i = 0; i < 2000; i++) run("Level9.lightAt(Player.position.x, Player.position.z)"); const lm = Number(process.hrtime.bigint() - t1) / 1e6 / 2000;
const t2 = process.hrtime.bigint(); for (let i = 0; i < 2000; i++) run("Level9.isOpen(Player.position.x+3, Player.position.z+2, 0.35, 0.6, 0.7)"); const om = Number(process.hrtime.bigint() - t2) / 1e6 / 2000;
const t3 = process.hrtime.bigint(); for (let i = 0; i < 500; i++) run("Level9Entities.houseAt(Player.position.x, Player.position.z)"); const hm = Number(process.hrtime.bigint() - t3) / 1e6 / 500;
console.log({ entColliders: n[0], playerColliders: n[1], blocks: n[2], collectMs: ms.toFixed(3), lightAtMs: lm.toFixed(4), isOpenMs: om.toFixed(4), houseAtMs: hm.toFixed(4) });
