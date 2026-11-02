const G = require(require("path").resolve(__dirname, "../../js/levels/level9-gen.js")); G.init(5);
const specs = []; G.eachHouse(-4, -4, 4, 4, s => specs.push(s));
const t0 = process.hrtime.bigint(); for (const s of specs.slice(0, 300)) G.interiorPlan(s); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 300;
let mx = 0; for (const s of specs.slice(0, 300)) { const t = process.hrtime.bigint(); G.interiorPlan(s); mx = Math.max(mx, Number(process.hrtime.bigint() - t) / 1e6); }
console.log("interiorPlan avg", ms.toFixed(2), "ms, max", mx.toFixed(2), "ms");
