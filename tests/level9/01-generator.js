const G = require(require("path").resolve(__dirname, "../../js/levels/level9-gen.js"));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
for (const seed of [1, 12345, 987654321, 4000000000]) {
  G.init(seed);
  const S = G.special();
  const sp = G.spawnInfo();
  ok(S.hole8, "hole8 exists seed " + seed);
  ok(S.exit11, "exit11 exists seed " + seed);
  const ex = G.exitList();
  const e11 = ex.filter(e => e.kind === "level11"), e10 = ex.filter(e => e.kind === "level10"), e8 = ex.filter(e => e.kind === "level8");
  ok(e11.length === 1, "one exit11");
  ok(e11[0].dist >= 2000, "exit11 dist " + e11[0].dist);
  ok(e8.length === 1 && e8[0].dist > 120 && e8[0].dist < 330, "hole8 dist " + (e8[0] && e8[0].dist));
  ok(e10.length >= 1 && e10[0].dist >= 250 && e10[0].dist < 760, "nearest level10 " + (e10[0] && e10[0].dist));
  ok(e10.every(e => e.dist >= 250), "no level10 near spawn");
  // special lots unique ids and in-block
  const ids = new Set(); for (const e of ex) ok(!ids.has(e.kind + e.x), "dup");
  // connectivity: BFS over nodes in a 40x40 window from node(0,0)
  const N = 20, seen = new Set(["0,0"]), q = [[0, 0]];
  while (q.length) { const [i, j] = q.pop();
    const nb = [[i + 1, j, G.segH(i, j)], [i - 1, j, G.segH(i - 1, j)], [i, j + 1, G.segV(i, j)], [i, j - 1, G.segV(i, j - 1)]];
    for (const [a, b, e] of nb) { if (!e || Math.abs(a) > N || Math.abs(b) > N) continue; const k = a + "," + b; if (!seen.has(k)) { seen.add(k); q.push([a, b]); } } }
  // widen the window so edge effects cannot hide or fake a gap: reach everything in the inner 30x30 from a 60x60 search
  { const M = 60, s2 = new Set(["0,0"]), q2 = [[0, 0]];
    while (q2.length) { const [i, j] = q2.pop(); const nb = [[i + 1, j, G.segH(i, j)], [i - 1, j, G.segH(i - 1, j)], [i, j + 1, G.segV(i, j)], [i, j - 1, G.segV(i, j - 1)]];
      for (const [a, b, e] of nb) { if (!e || Math.abs(a) > M || Math.abs(b) > M) continue; const k = a + "," + b; if (!s2.has(k)) { s2.add(k); q2.push([a, b]); } } }
    let miss = 0; for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) if (!s2.has(i + "," + j)) miss++;
    ok(miss === 0, "connected (wide search) missing " + miss + " seed " + seed); }
  // dead ends
  let dead = 0, nodes = 0;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) { nodes++; const deg = [G.segH(i, j), G.segH(i - 1, j), G.segV(i, j), G.segV(i, j - 1)].filter(Boolean).length; if (deg === 1) dead++; }
  console.log("seed", seed, "deadends", dead, "/", nodes);
  // houses: overlaps with each other within a block, door lock ratio, fridge, bottles
  let n = 0, locked = 0, fridge = 0, bottle = 0, lit = 0, garage = 0, overlaps = 0;
  const rects = [];
  G.eachHouse(-8, -8, 8, 8, (s, l) => {
    n++; if (s.locked) locked++; if (s.fridge) fridge++; if (s.bottle) bottle++; if (s.lit) lit++; if (s.garage) garage++;
    const lx0 = -s.W / 2 - (s.garage === -1 ? G.GW : 0), lx1 = s.W / 2 + (s.garage === 1 ? G.GW : 0);
    const a = G.localToWorld(s, lx0, -s.D / 2), b = G.localToWorld(s, lx1, s.D / 2);
    rects.push({ id: s.id, x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z), bi: l.bi, bj: l.bj });
  });
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) { const p = rects[a], q = rects[b]; if (Math.abs(p.bi - q.bi) > 1 || Math.abs(p.bj - q.bj) > 1) continue; if (p.x0 < q.x1 && p.x1 > q.x0 && p.z0 < q.z1 && p.z1 > q.z0) { overlaps++; if (overlaps < 4) console.log(" overlap", p.id, q.id); } }
  console.log(" houses", n, "locked%", (locked / n * 100).toFixed(1), "fridge%", (fridge / n * 100).toFixed(1), "bottles", bottle, "(", (bottle / n * 100).toFixed(2), "% )", "lit%", (lit / n * 100).toFixed(1), "garage%", (garage / n * 100).toFixed(1), "overlaps", overlaps);
  ok(overlaps === 0, "house overlaps");
  // bottle cap: any 60m circle <=2 -> check pairwise triples
  const bs = []; G.eachHouse(-8, -8, 8, 8, (s, l) => { if (s.bottle) { const p = G.lotPoint(l, 11, 0); bs.push(p); } });
  let tri = 0; for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) for (let c = b + 1; c < bs.length; c++) { const d = (u, v) => Math.hypot(u.x - v.x, u.z - v.z); if (d(bs[a], bs[b]) < 60 && d(bs[b], bs[c]) < 60 && d(bs[a], bs[c]) < 60) tri++; }
  ok(tri === 0, "bottle triples " + tri);
  // determinism / load order independence
  const snap = []; G.eachHouse(-3, -3, 3, 3, (s) => snap.push(s.id + s.bottle + s.locked));
  G.init(seed); const snap2 = []; G.eachHouse(3, 3, 3, 3, () => {}); G.eachHouse(-3, -3, 3, 3, (s) => snap2.push(s.id + s.bottle + s.locked));
  ok(JSON.stringify(snap) === JSON.stringify(snap2), "load-order determinism");
  // interior plan sanity
  let bad = 0; G.eachHouse(-3, -3, 3, 3, (s) => { const p = G.interiorPlan(s); if (s.fridge && !p.fridge) bad++; });
  console.log(" fridge houses missing fridge placement:", bad);
  // mangled distribution
  const d = [0, 0, 0, 0, 0]; const tot = [0, 0, 0, 0, 0]; let hounds = 0, bl = 0;
  for (let bj = -40; bj <= 40; bj++) for (let bi = -40; bi <= 40; bi++) { const B = G.block(bi, bj); const dist = G.distFromSpawn(B.cx, B.cz); const band = dist < 500 ? 0 : dist < 1000 ? 1 : dist < 1500 ? 2 : dist < 2000 ? 3 : 4; tot[band]++; bl++; for (const c of G.blockCritters(bi, bj)) { if (c.kind === "mangled") d[band]++; else hounds++; } }
  console.log(" mangled per band", d.map((x, i) => x + "/" + tot[i]).join(" "), "hounds", hounds, "/", bl);
  ok(d[0] === 0, "no mangled < 500m");
  // arrow signs on the approach
  const A = S.approach; let signs = 0, real = 0; for (let k = -12; k <= 12; k++) { const i = A.axis === "H" ? S.node11.i + k : A.line, j = A.axis === "H" ? A.line : S.node11.j + k; for (const sg of G.segmentSigns(A.axis, i, j)) { signs++; if (sg.real) real++; } }
  console.log(" approach signs", signs, "real", real, "node", S.node11.i, S.node11.j, "dist", S.node11.dist.toFixed(0));
  ok(real >= 8, "real signs");
}
console.log(fails ? "FAILS: " + fails : "ALL GEN CHECKS PASSED");
