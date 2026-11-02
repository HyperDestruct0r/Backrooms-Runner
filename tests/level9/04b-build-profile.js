const { ctx, run } = require("./harness.js");
run(`Level9.enter(31337, 8);`);
for (let k = 0; k < 40; k++) run(`Player.position.x += 40; Level9.stream(true);`);
run(`Level9.__t = {}; for (const n of ["_terrain","_lampsAndSigns","_specialLots","_house","_yard","flush","_spawnMound"]) { const f = Level9[n]; Level9[n] = function(...a){ const t0=performance.now(); const r=f.apply(this,a); (Level9.__t[n]=Level9.__t[n]||[]).push(performance.now()-t0); return r; }; }`);
for (let k = 0; k < 60; k++) run(`Player.position.x += 25; Level9.stream(false); Level9.update(0.05);`);
const T = run("Level9.__t");
for (const k in T) { const t = T[k].slice().sort((a, b) => b - a); console.log(k.padEnd(14), "n", String(t.length).padStart(4), "max", t[0].toFixed(2), "median", t[Math.floor(t.length / 2)].toFixed(2)); }
