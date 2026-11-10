// Level 0 wall markings: attachment, orientation, determinism, sparsity, rarity, spacing, exclusions, leaks.
const { makeContext, assert, pass, mapFor, stats } = require("./harness.js");
const h = makeContext(), g = h.g, M = g.Level0Markings, T = g.CONFIG.tile, TILE = g.TILE;
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];

function envFor(r) {
  const reserved = new Set(), mk = (x, z, k) => { for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) reserved.add((x + a) + "," + (z + b)); };
  for (const e of r.elevatorSites) { mk(e.x, e.z, 3); for (const s of e.stations) mk(s.x, s.z, 2); }
  return { seed: r.seed, T, wallH: g.CONFIG.wallH, reserved,
    isWall: (x, z) => r.world.tile(x, z) === TILE.WALL,
    isFloor: (x, z) => { const t = r.world.tile(x, z); return t !== TILE.WALL && t !== TILE.COLUMN; } };
}
// The unbounded world is tested over a fixed window: region (0,0), 288 x 288 tiles (a multiple of every chunk size used here except 512).
const WIN = 288;
function planAll(r, env, size) {
  size = Math.min(size, WIN);
  let out = [];
  for (let z0 = 0; z0 < WIN; z0 += size) for (let x0 = 0; x0 < WIN; x0 += size) out = out.concat(M.planChunk(env, x0, z0, Math.min(WIN, x0 + size), Math.min(WIN, z0 + size)));
  return out;
}
const key = (m) => m.wx + "," + m.wz + "," + m.d;

let totals = { marks: 0, faces: 0, common: 0, uncommon: 0, rare: 0, entity: 0, cluster: 0 }, perMap = [];
for (let i = 1; i <= 10; i++) {
  const r = mapFor(h, i), env = envFor(r);
  let faces = 0;
  for (let z = 0; z < WIN; z++) for (let x = 0; x < WIN; x++) for (let d = 0; d < 4; d++) if (env.isWall(x, z) && env.isFloor(x + DX[d], z + DZ[d])) faces++;
  const marks = planAll(r, env, 24);

  // --- determinism and chunk-independence: any chunking, any number of rebuilds, same marks
  const again = planAll(r, env, 24), other = planAll(r, env, 144), whole = planAll(r, env, 512);
  assert(JSON.stringify(marks) === JSON.stringify(again), "rebuilding every chunk gives byte-identical marks");
  const norm = (a) => JSON.stringify(a.map(key).sort());
  assert(norm(marks) === norm(other) && norm(marks) === norm(whole), "the set of marks does not depend on how the map is cut into chunks (no flicker/duplicates on reload)");
  const seen = new Set(); for (const m of marks) { assert(!seen.has(key(m)), "no face carries two marks"); seen.add(key(m)); }

  for (const m of marks) {
    const fx = m.wx + DX[m.d], fz = m.wz + DZ[m.d];
    assert(env.isWall(m.wx, m.wz) && env.isFloor(fx, fz), "every mark is on a wall face that borders walkable floor");
    assert(!env.reserved.has(fx + "," + fz), "no mark near an elevator or station");
    // fits inside one tile face: cannot hang over an opening or the next chunk
    const hw = (m.w / 2) * Math.cos(m.tilt) + (m.h / 2) * Math.abs(Math.sin(m.tilt));
    assert(Math.abs(m.u) + hw <= T / 2 + 1e-6, "mark stays within its own tile face");
    assert(m.y - m.h / 2 * 0.5 > 0.05 && m.y + m.h / 2 * 0.5 < g.CONFIG.wallH, "mark lies between floor and ceiling");
    totals[m.tier]++; if (m.entity) totals.entity++; if (m.cluster) totals.cluster++;
  }
  // entity drawings are never common
  assert(marks.filter(m => m.entity).every(m => m.tier === "rare"), "entity drawings only appear in the rare tier");
  // spacing: outside clusters, no two marks within `spacing` tiles of each other
  const loose = marks.filter(m => !m.cluster);
  for (let a = 0; a < loose.length; a++) for (let b = a + 1; b < loose.length; b++) {
    const d = Math.max(Math.abs(loose[a].wx - loose[b].wx), Math.abs(loose[a].wz - loose[b].wz));
    assert(d > M.cfg.spacing || (loose[a].cluster || loose[b].cluster), "isolated marks are never closer than " + M.cfg.spacing + " tiles (got " + d + ")");
  }
  totals.marks += marks.length; totals.faces += faces; perMap.push(marks.length);
}
pass("10 maps: identical on rebuild and under any chunk partition; one mark per face; inside the tile face; clear of lifts/stations; isolated marks spaced");
const frac = totals.marks / totals.faces;
assert(frac > 0.005 && frac < 0.04, "sparse: " + (frac * 100).toFixed(2) + "% of wall faces carry a mark");
const rareShare = totals.rare / totals.marks;
assert(rareShare > 0.003 && rareShare < 0.05, "rare marks are rare (" + (rareShare * 100).toFixed(2) + "%)");
assert(totals.common > totals.uncommon && totals.uncommon > totals.rare, "common > uncommon > rare");
assert(totals.entity / totals.marks < 0.03, "entity drawings are a small minority (" + (totals.entity / totals.marks * 100).toFixed(2) + "%)");
pass("density " + (frac * 100).toFixed(2) + "% of wall faces (" + Math.min(...perMap) + "-" + Math.max(...perMap) + " marks per map); tiers common/uncommon/rare = " + totals.common + "/" + totals.uncommon + "/" + totals.rare + "; entity drawings " + totals.entity);

// --- geometry: lies ON the wall plane, faces the floor, wound toward the viewer ---
{
  const r = mapFor(h, 2), env = envFor(r), marks = planAll(r, env, 24).slice(0, 400);
  const q = M.quads(env, marks);
  marks.forEach((m, i) => {
    const nx = DX[m.d], nz = DZ[m.d];
    const planeC = (m.d === 0 || m.d === 2) ? (m.wz + 0.5) * T + nz * T / 2 : (m.wx + 0.5) * T + nx * T / 2;
    for (let k = 0; k < 4; k++) {
      const o = i * 12 + k * 3, x = q.pos[o], y = q.pos[o + 1], z = q.pos[o + 2];
      const off = (m.d === 0 || m.d === 2) ? (z - planeC) * nz : (x - planeC) * nx;
      assert(Math.abs(off - M.cfg.lift) < 1e-4, "every vertex sits " + M.cfg.lift * 1000 + " mm off the wall plane (not floating)");
      assert(q.nor[o] === nx && q.nor[o + 2] === nz, "normal points out of the wall toward the floor");
      assert(y > 0 && y < g.CONFIG.wallH, "vertex within wall height");
    }
    // counter-clockwise as seen from the floor side
    const p = (k) => [q.pos[i * 12 + k * 3], q.pos[i * 12 + k * 3 + 1], q.pos[i * 12 + k * 3 + 2]];
    const a = p(0), b = p(1), c = p(2), e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert(n[0] * nx + n[2] * nz > 0, "front face points into the room (readable, not mirrored)");
  });
  pass("400 quads: on the wall plane (6 mm), facing the floor tile, correct winding");
}

// --- chunk integration: one mesh per chunk, geometry disposed on unload, no leaks, deterministic reload ---
{
  const r = mapFor(h, 4); g.Level.loadGenerated(r); g.LevelGenerator.last = r; g.GameState.seed = r.seed;
  h.run("document.createElement = () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), width: 0, height: 0 });", "canvas");
  const grp = () => new h.ctx.THREE.Group();
  const before = stats.geoCreated - stats.geoDisposed;
  let withMarks = null;
  for (let cz = 0; cz < 12 && !withMarks; cz++) for (let cx = 0; cx < 12 && !withMarks; cx++) { const gp = grp(); const rec = M.buildChunk(gp, cx * 24, cz * 24, cx * 24 + 24, cz * 24 + 24); if (rec && rec.count) withMarks = { rec, gp, cx, cz }; else if (rec && rec.geo) rec.geo.dispose(); }
  assert(withMarks, "found a chunk with marks");
  assert(withMarks.gp.children.filter(c => c.name === "L0_marks").length === 1, "exactly one merged mesh per chunk");
  const mat = withMarks.rec.mesh.material;
  const second = M.buildChunk(grp(), withMarks.cx * 24, withMarks.cz * 24, withMarks.cx * 24 + 24, withMarks.cz * 24 + 24);
  assert(second.mesh.material === mat, "all chunks share one material (no per-chunk materials)");
  assert(Buffer.compare(Buffer.from(withMarks.rec.geo.attributes.position.array.buffer), Buffer.from(second.geo.attributes.position.array.buffer)) === 0, "reloading a chunk rebuilds identical geometry");
  const holder = { markings: second }; const live = stats.geoCreated - stats.geoDisposed;
  M.disposeChunk(holder);
  assert(stats.geoCreated - stats.geoDisposed === live - 1 && holder.markings === null, "unloading disposes the chunk's geometry");
  const mkSrc = require("fs").readFileSync(__dirname + "/../../js/levels/level0.js", "utf8");
  assert(/Level0Markings\.disposeChunk\(rec\)/.test(mkSrc) && /Level0Markings\.buildChunk\(g,/.test(mkSrc) && /Level0Markings\.resetShared\(\)/.test(mkSrc), "Level 0 chunk build/unload/clear call the marking system");
  M.resetShared(); assert(M.material === null, "level clear drops the shared material/atlas");
  pass("one merged mesh per chunk, one shared material, identical rebuild, geometry disposed on unload, shared state dropped on clear");
}

// --- Pass C drawings: faces they take are avoided ---
{
  const r = mapFor(h, 5), env = envFor(r);
  const base = planAll(r, env, 24);
  assert(base.length > 5, "have marks to test against");
  const taken = base.slice(0, 5).map(m => [m.wx, m.wz, m.d]);
  M.reserveFaces(taken);
  const after = planAll(r, env, 24);
  for (const t of taken) assert(!after.some(m => m.wx === t[0] && m.wz === t[1]), "no mark on a wall tile an older drawing occupies");
  M.resetPassC();
  pass("faces claimed by the existing Pass C drawings are kept clear");
}
