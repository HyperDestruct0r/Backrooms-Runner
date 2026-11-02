const { ctx, run } = require("./harness.js");
run(`Level9.enter(31337, 8);`);
// warm up the JIT by building a lot
for (let k = 0; k < 40; k++) run(`Player.position.x += 40; Level9.stream(true);`);
run(`Level9.__t = []; const _g = Level9._buildBlock; Level9._buildBlock = function*(rec){ const it = _g.call(this, rec); while(true){ const t0=performance.now(); const r = it.next(); Level9.__t.push(performance.now()-t0); if (r.done) return; yield; } };`);
for (let k = 0; k < 60; k++) run(`Player.position.x += 25; Level9.stream(false); Level9.update(0.05);`);
const t = run(`Level9.__t`).slice().sort((a, b) => b - a);
console.log("steps", t.length, "max", t[0].toFixed(2), "p95", t[Math.floor(t.length * 0.05)].toFixed(2), "median", t[Math.floor(t.length / 2)].toFixed(2));
console.log("top 8", t.slice(0, 8).map(x => x.toFixed(1)).join(" "));
