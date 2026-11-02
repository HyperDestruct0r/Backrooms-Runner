// Is every house winnable? On a 0.1 m grid, with the player inflated by its radius, check that a player can get from the
// front door to the stair foot, to the back room, and (upstairs) from the landing to the middle of the upper room.
const G = require(require("path").resolve(__dirname, "../../js/levels/level9-gen.js"));
let total = 0, noStairs = 0, noBack = 0, noUp = 0, noFridge = 0, fridges = 0;
for (const seed of [11, 222, 3333]) {
  G.init(seed);
  G.eachHouse(-5, -5, 5, 5, (sp) => {
    total++;
    const P = G.interiorPlan(sp), R = 0.34, cell = 0.1;
    const x0 = -sp.W / 2, z0 = -sp.D / 2, NX = Math.ceil(sp.W / cell), NZ = Math.ceil(sp.D / cell);
    const build = (floor) => {
      const blocked = new Uint8Array(NX * NZ);
      const rects = [];
      const FH = G.FLOOR_H, ylo = floor ? FH : 0, yhi = floor ? FH + 1.7 : 1.7;
      for (const s of P.solids) { if (s.y1 <= ylo + 0.34 || s.y0 >= yhi) continue; if (s.tag === "slab") continue; rects.push([s.x0, s.z0, s.x1, s.z1]); }
      if (floor === 0) for (const st of P.steps) if (st.y1 > 0.34) rects.push([st.x0, st.z0, st.x1, st.z1]);
      for (const f of P.furn) if (f.collide && (floor ? f.y - f.sy / 2 >= FH - 0.1 : f.y - f.sy / 2 < FH - 0.1)) rects.push([f.x - f.sx / 2, f.z - f.sz / 2, f.x + f.sx / 2, f.z + f.sz / 2]);
      // outer walls and (upstairs) the stair hole: nothing to stand on
      rects.push([x0 - 1, z0 - 1, x0 + 0.2, z0 + sp.D + 1], [x0 + sp.W - 0.2, z0 - 1, x0 + sp.W + 1, z0 + sp.D + 1], [x0 - 1, z0 - 1, x0 + sp.W + 1, z0 + 0.2], [x0 - 1, z0 + sp.D - 0.2, x0 + sp.W + 1, z0 + sp.D + 1]);
      if (floor === 1) rects.push([P.hole.x0, P.hole.z0, P.hole.x1 + 0.0, P.hole.z1]);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
        for (const r of rects) if (x + R > r[0] && x - R < r[2] && z + R > r[1] && z - R < r[3]) { blocked[j * NX + i] = 1; break; }
      }
      return blocked;
    };
    const reach = (blocked, sx, sz, tx, tz) => {
      const idx = (x, z) => [Math.floor((x - x0) / cell), Math.floor((z - z0) / cell)];
      let [si, sj] = idx(sx, sz), [ti, tj] = idx(tx, tz);
      const seen = new Uint8Array(NX * NZ), q = [[si, sj]]; seen[sj * NX + si] = 1;
      if (blocked[sj * NX + si]) return false;
      while (q.length) { const [i, j] = q.pop(); if (Math.abs(i - ti) <= 2 && Math.abs(j - tj) <= 2) return true;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + a, nj = j + b; if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue; const k = nj * NX + ni; if (seen[k] || blocked[k]) continue; seen[k] = 1; q.push([ni, nj]); } }
      return false;
    };
    const g0 = build(0), g1 = build(1);
    const inDoor = [sp.doorX, sp.D / 2 - 0.7];
    const foot = [(P.stair.x0 + P.stair.x1) / 2, P.stair.z1 + 0.45];
    if (!reach(g0, inDoor[0], inDoor[1], foot[0], foot[1])) { noStairs++;
      if (false) { global.__dumped = 1; console.log("W", sp.W.toFixed(2), "D", sp.D.toFixed(2), "doorX", sp.doorX.toFixed(2), "foot", foot.map(v=>v.toFixed(2)), "inDoor", inDoor.map(v=>v.toFixed(2)), "startBlocked", g0[Math.floor((inDoor[1]-z0)/cell)*NX+Math.floor((inDoor[0]-x0)/cell)], "footBlocked", g0[Math.floor((foot[1]-z0)/cell)*NX+Math.floor((foot[0]-x0)/cell)]);
        for (let j = NZ - 1; j >= 0; j--) { let row = ""; for (let i = 0; i < NX; i++) row += g0[j * NX + i] ? "#" : "."; console.log(row); } } }
    if (!reach(g0, inDoor[0], inDoor[1], P.xp, sp.zp - 1.0)) noBack++;
    const lz = (P.landing.z0 + P.landing.z1) / 2;
    if (!reach(g1, P.landing.x0 + 0.6, lz, P.pxw + 0.9, lz)) { noUp++; if (!global.__d3) { global.__d3 = 1; console.log('upper fail: landing', JSON.stringify(P.landing), 'pxw', P.pxw.toFixed(2), 'lz', lz.toFixed(2), 'W', sp.W.toFixed(2), 'items', JSON.stringify(P.furn.filter(f => f.y > 2.5).map(f => [f.kind, +(f.x-f.sx/2).toFixed(2), +(f.z-f.sz/2).toFixed(2), +(f.x+f.sx/2).toFixed(2), +(f.z+f.sz/2).toFixed(2)]))); } }
    if (P.fridge) { fridges++; const fx = P.fridge.x, fz = P.fridge.z, fr = [[0, 1], [0, -1], [1, 0], [-1, 0]][P.fridge.face]; const cl = (v, h) => Math.max(-h + 0.6, Math.min(h - 0.6, v)); if (!reach(g0, inDoor[0], inDoor[1], cl(fx + fr[0] * 1.0, sp.W / 2), cl(fz + fr[1] * 1.0, sp.D / 2))) { noFridge++; if (!global.__d2) { global.__d2 = 1; console.log("fridge", JSON.stringify(P.fridge), "face", P.fridge.face, "zp", sp.zp.toFixed(2), "xp", P.xp.toFixed(2), "back items", JSON.stringify(P.furn.filter(f => f.y < 2 && f.z < sp.zp).map(f => [f.kind, +(f.x-f.sx/2).toFixed(2), +(f.z-f.sz/2).toFixed(2), +(f.x+f.sx/2).toFixed(2), +(f.z+f.sz/2).toFixed(2)]))); } } }
  });
}
console.log({ houses: total, unreachableStairs: noStairs, unreachableBackRoom: noBack, unreachableUpperRoom: noUp, fridges, unreachableFridge: noFridge });
process.exit(noStairs + noBack + noUp + noFridge ? 1 : 0);
