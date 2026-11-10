// Level 0 elevator + station placement in the unbounded world, verified with an INDEPENDENT breadth-first walk
// (it does not use the planner's own search) and plain geometry.
//   1 primary (100-150 m walking from the start, out of sight) + 4 additional, one per quadrant,
//   each 500-750 m from the start and >= 500 m from every other elevator, in STRAIGHT-LINE distance.
const { makeContext, assert, pass } = require("./harness.js");
const h = makeContext(), g = h.g, T = g.CONFIG.tile, S = g.Level0Sites.settings, TILE = g.TILE;
const N = +process.env.SEEDS || 24;
const seedOf = (i) => ((i * 104729 + 11) >>> 0);

// independent BFS over world tiles from (sx,sz); returns walking steps to each requested target (Map key -> steps)
function walkTo(world, sx, sz, targets, capNodes) {
  const key = (x, z) => (x + 65536) * 131072 + (z + 65536);
  const want = new Map(targets.map((t, i) => [key(t.x, t.z), i]));
  const out = new Array(targets.length).fill(-1);
  const dist = new Map(); let q = [[sx, sz]]; dist.set(key(sx, sz), 0); let left = targets.length;
  for (let qi = 0; qi < q.length && left > 0 && qi < capNodes; qi++) {
    const [x, z] = q[qi], d = dist.get(key(x, z));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (dist.has(k)) continue;
      const t = world.tile(nx, nz); if (t === TILE.WALL || t === TILE.COLUMN) continue;
      dist.set(k, d + 1); q.push([nx, nz]);
      if (want.has(k)) { out[want.get(k)] = d + 1; left--; }
    }
  }
  return out;
}
const eu = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) * T;
const quadOf = (e, sp) => (e.x > sp.x ? (e.z < sp.z ? "NE" : "SE") : (e.z < sp.z ? "NW" : "SW"));

const stat = { euclid: [], spacing: [], primaryWalk: [], stationWalk: [], reachWalk: [], draws: [], restarts: 0, genMs: [] };
for (let i = 1; i <= N; i++) {
  const t0 = Date.now(); const r = g.LevelGenerator.generateValid(seedOf(i), 24); stat.genMs.push(Date.now() - t0);
  assert(r && r.world, "seed " + i + " generates a world");
  const W = r.world, sp = r.startStamp, E = r.elevatorSites;
  assert(E.length === 5, "five elevators: one primary + four additional (got " + E.length + ")");
  assert(r.exitStamps.length === 5 && r.exitNodes.length === 5 && r.exitDistances.length === 5, "legacy exit arrays match the sites");
  assert(E[0].primary === true && E.slice(1).every(e => !e.primary), "only the first elevator is the primary");

  // ---- quadrants: exactly one additional elevator in each of NE, SE, SW, NW
  const quads = E.slice(1).map(e => quadOf(e, sp)).sort().join(",");
  assert(quads === "NE,NW,SE,SW", "one additional elevator per quadrant (got " + quads + ")");
  assert(E.slice(1).map(e => e.quadrant).sort().join(",") === "NE,NW,SE,SW", "the plan labels agree with the geometry");

  // ---- straight-line distances (Euclidean, never walking)
  E.slice(1).forEach((e) => {
    const d = eu(e, sp);
    assert(d >= 500 && d <= 750, "additional elevator is 500-750 m from the start in a straight line (got " + d.toFixed(0) + ")");
    stat.euclid.push(d);
    // not close to an axis: clearly inside its quadrant
    const ang = Math.abs(Math.atan2(e.z - sp.z, e.x - sp.x) * 180 / Math.PI); const off = Math.min(ang % 90, 90 - (ang % 90));
    assert(off >= S.quadrantMarginDeg - 0.5, "bearing is at least " + S.quadrantMarginDeg + " degrees from the axes (" + off.toFixed(1) + ")");
  });
  let minSp = Infinity;
  for (let a = 0; a < E.length; a++) for (let b = a + 1; b < E.length; b++) {
    const d = eu(E[a], E[b]); minSp = Math.min(minSp, d);
    assert(d >= 500, "elevators " + a + " and " + b + " are >= 500 m apart in a straight line (got " + d.toFixed(0) + ")");
  }
  stat.spacing.push(minSp);

  // ---- primary: 100-150 m of walking, not visible from the start
  const fronts = E.map(e => ({ x: e.frontX, z: e.frontZ }));
  const wsp = walkTo(W, sp.x, sp.z, fronts, 3000000);
  assert(wsp[0] * T >= 100 - 2 && wsp[0] * T <= 150 + 2, "primary is ~100-150 m of walking from the start (front tile " + (wsp[0] * T) + ")");
  stat.primaryWalk.push(wsp[0] * T);
  {
    const e = E[0], ax = sp.x + 0.5, az = sp.z + 0.5, bx = e.x + 0.5 + e.fx * 0.4, bz = e.z + 0.5 + e.fz * 0.4;
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25); let blocked = false;
    for (let s = 1; s < n && !blocked; s++) { const f = s / n, tt = W.tile(Math.floor(ax + (bx - ax) * f), Math.floor(az + (bz - az) * f)); if (tt === TILE.WALL || tt === TILE.COLUMN) blocked = true; }
    assert(blocked, "primary elevator is not in line of sight of the start");
  }
  // ---- every elevator is reachable from the start through the generated world (the maze really connects)
  wsp.forEach((w, k) => { assert(w > 0, "elevator " + k + " is reachable on foot from the start"); if (k) stat.reachWalk.push(w * T); });

  E.forEach((e, k) => {
    assert(e.sightlineM <= S.sightlineFallbackM, "no long clear sightline onto the doors (" + e.sightlineM + " m)");
    for (let a = 1; a <= 3; a++) for (let l = -1; l <= 1; l++) assert(W.tile(e.x + e.fx * a + e.rx * l, e.z + e.fz * a + e.rz * l) === TILE.WALL, "wall mass behind the doors");
    assert(W.tile(e.x, e.z) === TILE.EXIT, "the elevator tile is stamped EXIT in the world");
    assert(e.stations.length === 5, "five stations per elevator");
    const fromLift = walkTo(W, e.frontX, e.frontZ, e.stations.map(s => ({ x: s.x, z: s.z })), 400000);
    e.stations.forEach((s, si) => {
      const ws = fromLift[si] * T;
      assert(fromLift[si] >= 0 && ws <= S.stationWalkMax + 0.01, "station within 150 m of walking of ITS elevator (" + ws + ")");
      assert(ws >= S.stationWalkMin, "station not on top of the elevator");
      stat.stationWalk.push(ws);
      assert(W.tile(s.x + s.fx, s.z + s.fz) === TILE.WALL, "station is mounted on a wall");
      for (let l = -1; l <= 1; l++) assert(W.tile(s.x + s.fx + s.rx * l, s.z + s.fz + s.rz * l) === TILE.WALL, "station wall is continuous (no opening)");
      // not accidentally associated with another elevator: its own lift is the nearest, by a wide margin
      const dOwn = eu(s, e);
      E.forEach((o, ok) => { if (ok !== k) assert(eu(s, o) > dOwn + 200, "station " + si + " of elevator " + k + " is far from elevator " + ok + " (" + eu(s, o).toFixed(0) + " m)"); });
    });
  });
  const all = []; E.forEach((e) => e.stations.forEach(s => all.push(s)));
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) assert(eu(all[a], all[b]) >= S.stationFallbackSepM - 1e-6, "stations are not on top of one another");
  stat.draws.push(...r.siteReport.draws); stat.restarts += r.siteReport.restarts.length;
}
pass(N + " seeds: five elevators each; one additional elevator per quadrant; 500-750 m from the start and >= 500 m from every other elevator, in straight-line distance");
pass("primary 100-150 m of walking and out of sight; every elevator reachable on foot; five wall stations each, <= 150 m of walking from their own elevator and far from any other");

// ---- determinism: same seed, same everything (also after the regions are dropped and rebuilt)
{
  const a = g.LevelGenerator.generateValid(777001, 24), b = g.LevelGenerator.generateValid(777001, 24);
  assert(JSON.stringify(a.elevatorSites) === JSON.stringify(b.elevatorSites) && a.seed === b.seed, "same seed gives the same elevators and stations");
  const c = g.LevelGenerator.generateValid(777002, 24);
  assert(JSON.stringify(a.elevatorSites) !== JSON.stringify(c.elevatorSites), "a different seed gives a different plan");
  // tiles around every elevator are identical after the world forgets and rebuilds them
  const snap = (W, e) => { let s = ""; for (let z = e.z - 8; z <= e.z + 8; z++) for (let x = e.x - 8; x <= e.x + 8; x++) s += W.tile(x, z); return s; };
  const before = a.elevatorSites.map(e => snap(a.world, e));
  a.world.evictAll();
  const after = a.elevatorSites.map(e => snap(a.world, e));
  assert(JSON.stringify(before) === JSON.stringify(after), "a dropped region is rebuilt identically, elevator tiles included");
  assert(a.world.stats.regenerated > 0, "regions really were regenerated");
  pass("deterministic for a seed; regions rebuilt after being dropped are identical (EXIT tiles persist)");
}
// ---- no guidance anywhere
{
  const r = g.LevelGenerator.generateValid(seedOf(1), 24), keys = Object.keys(r).join(",");
  assert(!/marker|beacon|compass|waypoint/i.test(keys), "no marker/beacon fields on the generation result");
  const fs = require("fs");
  const src = fs.readFileSync(__dirname + "/../../js/levels/level0-activities.js", "utf8") + fs.readFileSync(__dirname + "/../../js/levels/level0-sites.js", "utf8") + fs.readFileSync(__dirname + "/../../js/levels/level0-world.js", "utf8");
  assert(!/PointLight\(|beacon|waypoint|compass/i.test(src), "the Level 0 planner/world add no lights, beacons or compass");
  pass("no markers, beams or direction indicators reveal the additional elevators");
}
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
const r0 = (v) => Math.round(v);
console.log("INFO elevators per map: 5 (1 primary + 4 additional, one per quadrant), " + N + " seeds");
console.log("INFO additional elevator straight-line distance from start: " + r0(q(stat.euclid, 0)) + "-" + r0(q(stat.euclid, 1)) + " m (median " + r0(q(stat.euclid, .5)) + ")");
console.log("INFO closest pair of elevators per map: " + r0(q(stat.spacing, 0)) + "-" + r0(q(stat.spacing, 1)) + " m straight line");
console.log("INFO walking distance start -> additional elevator: " + r0(q(stat.reachWalk, 0)) + "-" + r0(q(stat.reachWalk, 1)) + " m (median " + r0(q(stat.reachWalk, .5)) + ")");
console.log("INFO primary walking distance " + r0(q(stat.primaryWalk, 0)) + "-" + r0(q(stat.primaryWalk, 1)) + " m; station walking distance " + r0(q(stat.stationWalk, 0)) + "-" + r0(q(stat.stationWalk, 1)) + " m");
console.log("INFO candidate redraws per quadrant: median " + q(stat.draws, .5) + ", max " + Math.max(...stat.draws) + "; quadrant restarts needed: " + stat.restarts);
console.log("INFO generateValid ms: median " + q(stat.genMs, .5) + ", p95 " + q(stat.genMs, .95) + ", max " + Math.max(...stat.genMs));
