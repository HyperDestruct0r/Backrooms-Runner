// How close does a fixed pool of K point lights get to the lighting Level 0 had when EVERY fixture in the loaded
// chunks carried a point light? Same falloff three.js uses (1/d with a smooth cutoff at 100 m, decay 1), no shadows.
// "old" = all fixtures in the chunks the old streamer would have loaded for that yaw; "pool" = the K nearest fixtures.
// Reports the mean ratio of irradiance (pool / old) over random positions, and what gain would restore the mean.
const { makeContext } = require("../activity/harness.js");
const h = makeContext(["js/systems/passc.js"]), g = h.g, L = g.Level, T = g.CONFIG.tile;
h.run(`var PickupSystem = { generate() {}, reset() {}, beginLevel0() {}, ensureLevel0Around() {} }; var Level1 = undefined; document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });`, "x");
g.GameState.level = 0; g.GameState.phase = "playing";
L.buildProcedural(h.ctx.scene, 20240607, {});
const W = L.world, S = 24, RT = g.Level0World.RC * 6;
function rng(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const r = rng(7);
const fixtureAt = (cx, cz) => { const rx = Math.floor(cx * S / RT), rz = Math.floor(cz * S / RT), reg = W.region(rx, rz); const lk = (cx * S - rx * RT) / S + (RT / S) * ((cz * S - rz * RT) / S); return reg.lightsByChunk[lk] || []; };
const E = (px, pz, ls) => { let e = 0; for (const l of ls) { const wx = (l.tx + 0.5) * T, wz = (l.tz + 0.5) * T, dx = wx - px, dz = wz - pz, dy = g.CONFIG.wallH - 0.34 - 1.0; const d = Math.sqrt(dx * dx + dz * dz + dy * dy); if (d >= 100) continue; const w = 1 - Math.pow(d / 100, 4); e += (3.3 * (l.profile === "BRIGHT" ? 1.42 : 1.16)) / Math.max(d, 0.1) * w * w * (dy / d); } return e; };
const Ks = [6, 10, 14, 16, 24, 32];
const sums = Object.fromEntries(Ks.map(k => [k, []])); let n = 0;
const reg0 = W.region(0, 0);
const cand = [];
for (let z = 20; z < RT - 20; z += 3) for (let x = 20; x < RT - 20; x += 3) if (reg0.tiles[z * RT + x] === 0) cand.push([x, z]);
for (let s = 0; s < 400; s++) {
  const [tx, tz] = cand[Math.floor(r() * cand.length)], px = (tx + 0.5) * T, pz = (tz + 0.5) * T;
  g.Player.yaw = r() * Math.PI * 2;
  const cx = Math.floor(tx / S), cz = Math.floor(tz / S);
  let old = []; for (const [dx, dz] of L.wantedChunks(cx, cz, px, pz)) old = old.concat(fixtureAt(cx + dx, cz + dz));
  const all = []; for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) for (const l of fixtureAt(cx + dx, cz + dz)) all.push(l);
  all.sort((a, b) => Math.hypot(a.tx - tx, a.tz - tz) - Math.hypot(b.tx - tx, b.tz - tz));
  const eOld = E(px, pz, old); if (eOld <= 0) continue; n++;
  for (const k of Ks) sums[k].push(E(px, pz, all.slice(0, k)) / eOld);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
console.log("positions sampled:", n, "(old light count in view ~ " + (function () { let t = 0, c = 0; for (let i = 0; i < 30; i++) { const [tx, tz] = cand[i * 7]; g.Player.yaw = i; let o = 0; for (const [dx, dz] of L.wantedChunks(Math.floor(tx / S), Math.floor(tz / S), (tx + .5) * T, (tz + .5) * T)) o += fixtureAt(Math.floor(tx / S) + dx, Math.floor(tz / S) + dz).length; t += o; c++; } return Math.round(t / c); })() + " point lights at once)");
for (const k of Ks) console.log("K=" + String(k).padStart(2) + "  pool/old irradiance: mean " + mean(sums[k]).toFixed(2) + "  p10 " + q(sums[k], .1).toFixed(2) + "  p90 " + q(sums[k], .9).toFixed(2) + "   gain to restore the mean: x" + (1 / mean(sums[k])).toFixed(2));
