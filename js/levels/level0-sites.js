"use strict";

/* ------------------------------------------------------------------
   LEVEL 0 SITE PLANNER
   Decides WHERE the Level 0 elevators and their electrical stations go.
   Pure data: no THREE, no DOM, and no draw from the world generator's RNG
   streams, so planning never changes the maze a seed produces.

   Level 0 is unbounded (js/levels/level0-world.js), so the rules are the
   ones the design always asked for, measured the way it asked:

     primary      ONE elevator 100-150 m of WALKING from the start, out of
                  its sight.
     additional   FOUR elevators, one per quadrant around the start
                  (NE, SE, SW, NW), each 500-750 m from the start in a
                  STRAIGHT LINE, and at least 500 m (straight line) from the
                  primary and from every other additional elevator.
     stations     five per elevator, each within 150 m of walking from that
                  elevator (breadth-first over the real tiles, so every one
                  is reachable), none of them near another elevator.

   A candidate that breaks a rule is thrown away and a fresh one is drawn;
   no rule is ever relaxed to make a candidate fit. If a quadrant cannot be
   filled after many fresh draws the plan restarts that quadrant with a new
   stream, and finally throws, so a bad plan can never be used silently.

   Nothing marks the additional elevators: they are ordinary wall facades
   (see Stairwell.buildOne) that the player finds by exploring.
   ------------------------------------------------------------------ */
const Level0Sites = {
  settings: {
    primaryWalkMin: 100,      // m, walking distance from the start
    primaryWalkMax: 150,
    sightlineMaxM: 34,        // longest unobstructed view onto the doors, from the open side (primary)
    sightlineFallbackM: 52,   // (additional elevators)
    extraCount: 4,
    extraEuclidMin: 500,      // m, straight line from the start
    extraEuclidMax: 750,
    extraSpacingMin: 500,     // m, straight line between any two elevators
    quadrantMarginDeg: 12,    // keep bearings this far from the axes, so each elevator is clearly in its quadrant
    searchRadiusTiles: 22,    // facade search around each drawn target point
    drawsPerQuadrant: 160,
    quadrantRestarts: 6,
    stationsPerElevator: 5,
    stationWalkMin: 14,       // m from the elevator
    stationWalkMax: 150,
    stationMinSepM: 18,       // straight line, between stations
    stationMinFromLiftM: 9,
    stationFallbackSepM: 11,
    clearTilesAroundLift: 3,  // tiles kept free of wall markings
    clearTilesAroundStation: 2
  },

  QUADRANTS: [
    { name: "NE", sx: 1, sz: -1, base: -90 },
    { name: "SE", sx: 1, sz: 1, base: 0 },
    { name: "SW", sx: -1, sz: 1, base: 90 },
    { name: "NW", sx: -1, sz: -1, base: 180 }
  ],

  DIRS: [
    { fx: 0, fz: -1 }, { fx: 1, fz: 0 }, { fx: 0, fz: 1 }, { fx: -1, fz: 0 }
  ],

  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /* ctx: { world, start:{x,z}, tileSize, seed } -> { elevators, report } (throws if a rule cannot be met) */
  planWorld(ctx) {
    const S = this.settings, world = ctx.world, T = ctx.tileSize, start = ctx.start;
    const seed = (ctx.seed ^ 0x51E7A70) >>> 0;
    const isWall = (x, z) => world.tile(x, z) === 1;
    const isFloor = (x, z) => { const t = world.tile(x, z); return t !== 1 && t !== 5; };
    const isStart = (x, z) => world.tile(x, z) === 2;

    // Breadth-first walking distance in a window around (sx, sz); steps <= maxSteps.
    const bfs = (sx, sz, maxSteps) => {
      const R = maxSteps + 1, N = 2 * R + 1;
      const d = new Int16Array(N * N).fill(-1), q = new Int32Array(N * N);
      let h = 0, t = 0;
      const idx = (x, z) => (z - sz + R) * N + (x - sx + R);
      d[idx(sx, sz)] = 0; q[t++] = idx(sx, sz);
      while (h < t) {
        const i = q[h++], ix = i % N, iz = (i / N) | 0, d0 = d[i];
        if (d0 >= maxSteps) continue;
        const x = ix + sx - R, z = iz + sz - R;
        for (let k = 0; k < 4; k++) {
          const nx = x + this.DIRS[k].fx, nz = z + this.DIRS[k].fz;
          if (!isFloor(nx, nz)) continue;
          const ni = idx(nx, nz);
          if (d[ni] >= 0) continue;
          d[ni] = d0 + 1; q[t++] = ni;
        }
      }
      return {
        steps(x, z) { const ix = x - sx + R, iz = z - sz + R; if (ix < 0 || iz < 0 || ix >= N || iz >= N) return -1; return d[iz * N + ix]; },
        walkM(x, z) { const v = this.steps(x, z); return v < 0 ? Infinity : v * T; }
      };
    };

    // A facade site is a floor tile E with a solid 3 x 3 wall block behind it (so the cabin sits in wall mass),
    // floor either side of E and in front of it. f points from E into the wall.
    const siteAt = (x, z) => {
      if (!isFloor(x, z) || isStart(x, z)) return null;
      const out = [];
      for (let di = 0; di < 4; di++) {
        const f = this.DIRS[di], rx = -f.fz, rz = f.fx;
        let ok = true;
        for (let k = 1; k <= 3 && ok; k++) for (let l = -1; l <= 1; l++) if (!isWall(x + f.fx * k + rx * l, z + f.fz * k + rz * l)) { ok = false; break; }
        if (!ok) continue;
        for (let l = -1; l <= 1; l++) {
          if (!isFloor(x + rx * l, z + rz * l)) ok = false;
          if (!isFloor(x - f.fx + rx * l, z - f.fz + rz * l)) ok = false;
        }
        if (ok) out.push({ x, z, di, fx: f.fx, fz: f.fz, rx, rz });
      }
      return out.length ? out : null;
    };

    // Longest straight view onto the door plane from the open side.
    const sightline = (s) => {
      const px = s.x + 0.5 + s.fx * 0.45, pz = s.z + 0.5 + s.fz * 0.45;
      let best = 0;
      for (let a = -80; a <= 80; a += 8) {
        const ang = a * Math.PI / 180, c = Math.cos(ang), sn = Math.sin(ang);
        const nx = -s.fx, nz = -s.fz;
        const dx = nx * c - nz * sn, dz = nx * sn + nz * c;
        let d = 0;
        for (; d < 90; d += 0.25) if (!isFloor(Math.floor(px + dx * d), Math.floor(pz + dz * d))) break;
        if (d > best) best = d;
      }
      return best * T;
    };
    const startCanSee = (s) => {
      const ax = start.x + 0.5, az = start.z + 0.5, bx = s.x + 0.5 + s.fx * 0.4, bz = s.z + 0.5 + s.fz * 0.4;
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (!isFloor(Math.floor(ax + (bx - ax) * t), Math.floor(az + (bz - az) * t))) return false;
      }
      return true;
    };

    // Flat wall panel: a floor tile with solid wall behind it AND behind both neighbours along the wall.
    const wallPanelDirs = (x, z) => {
      const out = [];
      if (!isFloor(x, z) || isStart(x, z)) return out;
      for (let di = 0; di < 4; di++) {
        const f = this.DIRS[di], rx = -f.fz, rz = f.fx;
        if (isWall(x + f.fx, z + f.fz) && isWall(x + f.fx + rx, z + f.fz + rz) && isWall(x + f.fx - rx, z + f.fz - rz) &&
            isFloor(x + rx, z + rz) && isFloor(x - rx, z - rz)) out.push(di);
      }
      return out;
    };

    const lifts = [], taken = [];
    const euclid = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) * T;

    const placeStations = (elev, rand) => {
      const R = Math.ceil(S.stationWalkMax / T);
      const map = bfs(elev.frontX, elev.frontZ, R);
      const pool = [];
      for (let z = elev.frontZ - R; z <= elev.frontZ + R; z++) {
        for (let x = elev.frontX - R; x <= elev.frontX + R; x++) {
          const dm = map.walkM(x, z);
          if (dm < S.stationWalkMin || dm > S.stationWalkMax) continue;
          const dirs = wallPanelDirs(x, z);
          if (!dirs.length) continue;
          pool.push({ x, z, walk: dm, di: dirs[Math.floor(rand() * dirs.length)] });
        }
      }
      if (pool.length < S.stationsPerElevator) return null;
      const tooNearLift = (p, m) => { for (const l of lifts.concat([elev])) if (euclid(p, l) < m) return true; return false; };
      for (const sep of [S.stationMinSepM, S.stationFallbackSepM]) {
        const chosen = [];
        for (let i = 0; i < S.stationsPerElevator; i++) {
          const target = S.stationWalkMin + (S.stationWalkMax - S.stationWalkMin) * (i + 0.5) / S.stationsPerElevator;
          let best = null, bestScore = Infinity;
          for (const p of pool) {
            if (tooNearLift(p, S.stationMinFromLiftM)) continue;
            let near = false;
            for (const c of chosen) if (euclid(p, c) < sep) { near = true; break; }
            if (near) continue;
            for (const c of taken) if (euclid(p, c) < sep) { near = true; break; }
            if (near) continue;
            const score = Math.abs(p.walk - target) + rand() * 14;
            if (score < bestScore) { bestScore = score; best = p; }
          }
          if (!best) break;
          chosen.push(best);
        }
        if (chosen.length === S.stationsPerElevator) {
          chosen.sort((a, b) => a.walk - b.walk);
          return chosen.map((p, i) => ({
            x: p.x, z: p.z, fx: this.DIRS[p.di].fx, fz: this.DIRS[p.di].fz,
            rx: -this.DIRS[p.di].fz, rz: this.DIRS[p.di].fx, walkFromElevator: p.walk, order: i
          }));
        }
      }
      return null;
    };

    const tryCommit = (s, rand) => {
      const elev = {
        x: s.x, z: s.z, fx: s.fx, fz: s.fz, rx: s.rx, rz: s.rz,
        frontX: s.x - s.fx, frontZ: s.z - s.fz,
        walkStart: s.walkStart == null ? null : s.walkStart,
        euclidStart: euclid(s, start), sightlineM: s.sight
      };
      const stations = placeStations(elev, rand);
      if (!stations) return null;
      elev.stations = stations;
      lifts.push(elev);
      for (const st of stations) taken.push(st);
      return elev;
    };

    const bearing = (e) => Math.atan2(e.z - start.z, e.x - start.x) * 180 / Math.PI;

    /* ---- primary: 100-150 m of walking, not in view of the start ---- */
    {
      const R = Math.ceil(S.primaryWalkMax / T);
      const map = bfs(start.x, start.z, R);
      const rand = this.rng(seed ^ 0x1111);
      const cands = [];
      for (let z = start.z - R; z <= start.z + R; z++) {
        for (let x = start.x - R; x <= start.x + R; x++) {
          const wm = map.walkM(x, z);
          if (wm < S.primaryWalkMin || wm > S.primaryWalkMax) continue;
          const sites = siteAt(x, z);
          if (!sites) continue;
          for (const s of sites) { s.walkStart = wm; cands.push(s); }
        }
      }
      const mid = (S.primaryWalkMin + S.primaryWalkMax) / 2;
      const good = [];
      for (const s of cands) {
        if (startCanSee(s)) continue;
        s.sight = sightline(s);
        if (s.sight > S.sightlineMaxM) continue;
        good.push({ s, k: Math.abs(s.walkStart - mid) + s.sight * 0.25 + rand() * 6 });
      }
      good.sort((a, b) => a.k - b.k);
      let primary = null;
      for (let i = 0; i < Math.min(good.length, 24) && !primary; i++) primary = tryCommit(good[i].s, rand);
      if (!primary) throw new Error("Level0Sites: no primary elevator site 100-150 m from the start");
      primary.primary = true; primary.quadrant = null;
    }

    /* ---- four additional elevators, one per quadrant ---- */
    const stats = { draws: [], restarts: [] };
    for (let qi = 0; qi < this.QUADRANTS.length; qi++) {
      const Q = this.QUADRANTS[qi];
      let placed = null;
      for (let restart = 0; restart < S.quadrantRestarts && !placed; restart++) {
        const rand = this.rng(seed ^ Math.imul(qi + 1, 0x9E3779B1) ^ Math.imul(restart + 1, 0x85EBCA6B));
        for (let draw = 0; draw < S.drawsPerQuadrant && !placed; draw++) {
          const ang = (Q.base + S.quadrantMarginDeg + rand() * (90 - 2 * S.quadrantMarginDeg)) * Math.PI / 180;
          const r = S.extraEuclidMin + rand() * (S.extraEuclidMax - S.extraEuclidMin);
          const cx = Math.floor(start.x + 0.5 + Math.cos(ang) * r / T), cz = Math.floor(start.z + 0.5 + Math.sin(ang) * r / T);
          const found = [], rad = S.searchRadiusTiles;
          for (let z = cz - rad; z <= cz + rad; z++) {
            for (let x = cx - rad; x <= cx + rad; x++) {
              const e = Math.hypot(x - start.x, z - start.z) * T;
              if (e < S.extraEuclidMin || e > S.extraEuclidMax) continue;
              const sites = siteAt(x, z);
              if (sites) found.push(sites[Math.floor(rand() * sites.length)]);
            }
          }
          for (let i = found.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = found[i]; found[i] = found[j]; found[j] = t; }
          let tries = 0;
          for (const s of found) {
            if (tries >= 8) break;
            const dx = s.x - start.x, dz = s.z - start.z;
            if (Math.sign(dx) !== Q.sx || Math.sign(dz) !== Q.sz) continue;
            const off = ((Math.atan2(dz, dx) * 180 / Math.PI - Q.base) % 360 + 360) % 360;
            if (off < S.quadrantMarginDeg - 1e-6 || off > 90 - S.quadrantMarginDeg + 1e-6) continue;
            let ok = true;
            for (const l of lifts) if (euclid(s, l) < S.extraSpacingMin) { ok = false; break; }
            if (!ok) continue;
            s.sight = sightline(s);
            if (s.sight > S.sightlineFallbackM) continue;
            tries++;
            placed = tryCommit(s, rand);
            if (placed) { stats.draws.push(draw + 1); break; }
          }
        }
        if (!placed) stats.restarts.push(qi);
      }
      if (!placed) throw new Error("Level0Sites: no elevator site for quadrant " + Q.name);
      placed.quadrant = Q.name;
    }

    lifts.forEach((l, i) => { l.index = i; });
    let minSp = Infinity;
    for (let i = 0; i < lifts.length; i++) for (let j = i + 1; j < lifts.length; j++) minSp = Math.min(minSp, euclid(lifts[i], lifts[j]));
    const report = {
      count: lifts.length,
      euclidFromStart: lifts.map(l => Math.round(l.euclidStart)),
      bearingDeg: lifts.map(l => Math.round(bearing(l))),
      quadrant: lifts.map(l => l.quadrant),
      sightlineM: lifts.map(l => Math.round(l.sightlineM || 0)),
      primaryWalkM: Math.round(lifts[0].walkStart),
      spacingMinM: Math.round(minSp),
      draws: stats.draws, restarts: stats.restarts
    };
    return { elevators: lifts, report };
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { Level0Sites };
