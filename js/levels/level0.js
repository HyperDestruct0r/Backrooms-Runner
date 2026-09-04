"use strict";

/* ------------------------------------------------------------------
   SEEDED RNG + PROCEDURAL LEVEL 0
   Modules occupy a cell grid, then stamp tiles for the existing
   collider / mesh / lighting pipeline.
   VERSION 4 entities can query MapGraph / Module records.
   ------------------------------------------------------------------ */
const TILE = { WALL: 1, FLOOR: 0, START: 2, CHECK: 3, EXIT: 4, COLUMN: 5, DEAD: 6 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIR4 = [
  { x: 0, z: -1, name: "N" },
  { x: 1, z: 0, name: "E" },
  { x: 0, z: 1, name: "S" },
  { x: -1, z: 0, name: "W" }
];
function oppDir(d) { return (d + 2) & 3; }

const MapGraph = {
  nodes: [],
  edges: [],
  cellOwner: [],
  reset() {
    this.nodes = [];
    this.edges = [];
    this.cellOwner = [];
  },
  nodeAt(gx, gz) {
    if (!this.cellOwner[gz]) return null;
    const id = this.cellOwner[gz][gx];
    if (id == null) return null;
    return this.nodes[id] || null;
  }
};

const LevelGenerator = {
  CELL: 6,
  GRID_W: 64,
  GRID_H: 56,
  last: null,

  generate(seed) {
    const rng = mulberry32(seed >>> 0);
    const C = this.CELL;
    const W = this.GRID_W;
    const H = this.GRID_H;
    const cols = W * C;
    const rows = H * C;
    const tiles = [];
    for (let z = 0; z < rows; z++) {
      tiles.push(new Array(cols).fill(TILE.WALL));
    }

    MapGraph.reset();
    MapGraph.cellOwner = [];
    for (let z = 0; z < H; z++) MapGraph.cellOwner.push(new Array(W).fill(null));

    const occupied = [];
    for (let z = 0; z < H; z++) occupied.push(new Array(W).fill(false));

    const self = this;
    function inGrid(gx, gz) { return gx >= 0 && gz >= 0 && gx < W && gz < H; }
    function footprintFree(gx, gz, w, h) {
      if (gx < 0 || gz < 0 || gx + w > W || gz + h > H) return false;
      for (let z = gz; z < gz + h; z++) {
        for (let x = gx; x < gx + w; x++) {
          if (occupied[z][x]) return false;
        }
      }
      return true;
    }
    function markFoot(gx, gz, w, h, nodeId) {
      for (let z = gz; z < gz + h; z++) {
        for (let x = gx; x < gx + w; x++) {
          occupied[z][x] = true;
          MapGraph.cellOwner[z][x] = nodeId;
        }
      }
    }
    function localFloor(gx, gz, lx, lz, val) {
      const tx = gx * C + lx;
      const tz = gz * C + lz;
      if (tz >= 0 && tz < rows && tx >= 0 && tx < cols) tiles[tz][tx] = val;
    }
    function carveArm(gx, gz, dir) {
      // 2-tile-wide passage from cell center to an edge
      if (dir === 0) { // N
        for (let z = 0; z <= 3; z++) { localFloor(gx, gz, 2, z, TILE.FLOOR); localFloor(gx, gz, 3, z, TILE.FLOOR); }
      } else if (dir === 2) { // S
        for (let z = 2; z <= 5; z++) { localFloor(gx, gz, 2, z, TILE.FLOOR); localFloor(gx, gz, 3, z, TILE.FLOOR); }
      } else if (dir === 1) { // E
        for (let x = 2; x <= 5; x++) { localFloor(gx, gz, x, 2, TILE.FLOOR); localFloor(gx, gz, x, 3, TILE.FLOOR); }
      } else { // W
        for (let x = 0; x <= 3; x++) { localFloor(gx, gz, x, 2, TILE.FLOOR); localFloor(gx, gz, x, 3, TILE.FLOOR); }
      }
    }
    function carveRoomCell(gx, gz) {
      for (let z = 1; z <= 4; z++) {
        for (let x = 1; x <= 4; x++) localFloor(gx, gz, x, z, TILE.FLOOR);
      }
    }
    function openInternalEdge(gx0, gz0, gx1, gz1) {
      if (gx0 === gx1 && gz1 === gz0 + 1) {
        for (let x = 1; x <= 4; x++) {
          localFloor(gx0, gz0, x, 5, TILE.FLOOR);
          localFloor(gx1, gz1, x, 0, TILE.FLOOR);
        }
      } else if (gx0 === gx1 && gz0 === gz1 + 1) {
        openInternalEdge(gx1, gz1, gx0, gz0);
      } else if (gz0 === gz1 && gx1 === gx0 + 1) {
        for (let z = 1; z <= 4; z++) {
          localFloor(gx0, gz0, 5, z, TILE.FLOOR);
          localFloor(gx1, gz1, 0, z, TILE.FLOOR);
        }
      } else if (gz0 === gz1 && gx0 === gx1 + 1) {
        openInternalEdge(gx1, gz1, gx0, gz0);
      }
    }
    function linkDoor(ax, az, dir) {
      const bx = ax + DIR4[dir].x;
      const bz = az + DIR4[dir].z;
      if (!inGrid(bx, bz) || !occupied[bz][bx]) return false;
      carveArm(ax, az, dir);
      carveArm(bx, bz, oppDir(dir));
      return true;
    }

    function addNode(type, gx, gz, w, h, extra) {
      const node = {
        id: MapGraph.nodes.length,
        type: type,
        gx: gx,
        gz: gz,
        w: w,
        h: h,
        connections: [],
        deadEnd: type === "dead_end",
        hasExit: false,
        hasCheckpoint: false,
        hasStart: type === "start",
        // Persistent per-module lighting profile.
        lightProfile: (function () {
          const r = rng();
          return r < 0.15 ? "DARK" : (r > 0.78 ? "BRIGHT" : "NORMAL");
        })(),
        dark: false,
        skipLights: false,
        anomaly: null,
        extra: extra || null
      };
      MapGraph.nodes.push(node);
      markFoot(gx, gz, w, h, node.id);
      return node;
    }
    function addEdge(a, b, dir) {
      if (a.connections.indexOf(b.id) < 0) a.connections.push(b.id);
      if (b.connections.indexOf(a.id) < 0) b.connections.push(a.id);
      MapGraph.edges.push({ a: a.id, b: b.id, dir: dir });
    }

    const sockets = []; // {gx,gz,dir,nodeId}

    function pushSockets(node, dirs) {
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        let cx = node.gx, cz = node.gz;
        if (d === 1) cx = node.gx + node.w - 1;
        if (d === 2) cz = node.gz + node.h - 1;
        if (d === 0) cz = node.gz;
        if (d === 3) cx = node.gx;
        // pick a perimeter cell for this side
        if (d === 0 || d === 2) cx = node.gx + ((node.w > 1 && rng() > 0.5) ? node.w - 1 : 0);
        if (d === 1 || d === 3) cz = node.gz + ((node.h > 1 && rng() > 0.5) ? node.h - 1 : 0);
        sockets.push({ gx: cx, gz: cz, dir: d, nodeId: node.id });
      }
    }

    function carveModule(node, incomingDir) {
      if (node.type === "room_small" || node.type === "room_large" || node.type === "room_pillar" || node.type === "start" || node.type === "exit_room") {
        for (let z = 0; z < node.h; z++) {
          for (let x = 0; x < node.w; x++) carveRoomCell(node.gx + x, node.gz + z);
        }
        for (let z = 0; z < node.h; z++) {
          for (let x = 0; x < node.w; x++) {
            if (x + 1 < node.w) openInternalEdge(node.gx + x, node.gz + z, node.gx + x + 1, node.gz + z);
            if (z + 1 < node.h) openInternalEdge(node.gx + x, node.gz + z, node.gx + x, node.gz + z + 1);
          }
        }
        if (node.type === "room_pillar" || (node.type === "room_large" && rng() > 0.35)) {
          for (let z = 0; z < node.h; z++) {
            for (let x = 0; x < node.w; x++) {
              localFloor(node.gx + x, node.gz + z, 2, 2, TILE.COLUMN);
              if (rng() > 0.45) localFloor(node.gx + x, node.gz + z, 3, 3, TILE.COLUMN);
            }
          }
        }
        if (node.type === "room_small" && rng() > 0.55) {
          localFloor(node.gx, node.gz, 2, 2, TILE.DEAD);
        }
      } else {
        // corridor family: plus-arms, start with incoming so the join exists
        for (let z = 0; z < node.h; z++) {
          for (let x = 0; x < node.w; x++) {
            localFloor(node.gx + x, node.gz + z, 2, 2, TILE.FLOOR);
            localFloor(node.gx + x, node.gz + z, 3, 2, TILE.FLOOR);
            localFloor(node.gx + x, node.gz + z, 2, 3, TILE.FLOOR);
            localFloor(node.gx + x, node.gz + z, 3, 3, TILE.FLOOR);
          }
        }
        for (let z = 0; z < node.h; z++) {
          for (let x = 0; x < node.w; x++) {
            if (x + 1 < node.w) openInternalEdge(node.gx + x, node.gz + z, node.gx + x + 1, node.gz + z);
            if (z + 1 < node.h) openInternalEdge(node.gx + x, node.gz + z, node.gx + x, node.gz + z + 1);
          }
        }
        if (incomingDir != null) {
          // incoming lands on the attachment cell
        }
      }
    }

    function tryPlace(type, attachGX, attachGZ, incomingDir) {
      let w = 1, h = 1;
      if (type === "hall_long") {
        const len = 2 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
        if (incomingDir === 1 || incomingDir === 3) { w = len; h = 1; }
        else { w = 1; h = len; }
      } else if (type === "room_large" || type === "room_pillar") {
        w = 2; h = 2;
        if (rng() < 0.25) { w = 3; h = 2; }
        if (rng() < 0.12) { w = 2; h = 3; }
      } else if (type === "room_small" && rng() < 0.2) {
        w = 2; h = 1;
      }

      // origin so the attachment cell is on the incoming side of the footprint
      let ox = attachGX, oz = attachGZ;
      if (incomingDir === 1) ox = attachGX; // placed to the east, west cell is attach
      if (incomingDir === 3) ox = attachGX - (w - 1);
      if (incomingDir === 2) oz = attachGZ;
      if (incomingDir === 0) oz = attachGZ - (h - 1);

      if (!footprintFree(ox, oz, w, h)) {
        // try 1x1 fallback
        if (w !== 1 || h !== 1) return tryPlace("corridor", attachGX, attachGZ, incomingDir);
        return null;
      }

      const node = addNode(type, ox, oz, w, h, null);
      carveModule(node, incomingDir);
      return node;
    }

    // --- spine first so shortest path can hit 500–1000m, then branches ---
    const targetPath = CONFIG.gen.minPath + rng() * (CONFIG.gen.maxPath - CONFIG.gen.minPath);
    const spineNeed = Math.ceil(targetPath / 11.5) + 3;

    const startGZ = 4 + Math.floor(rng() * (H - 8));
    const startNode = addNode("start", 2, startGZ, 1, 1, null);
    carveModule(startNode, null);

    const spine = [startNode];
    let cgx = 2, cgz = startGZ, cdir = 1, straight = 0;
    let spineGuard = 0;
    while (spine.length < spineNeed && spineGuard++ < 800) {
      const turnNow = straight >= 2 + Math.floor(rng() * 4);
      const order = [];
      if (turnNow) {
        order.push((cdir + (rng() < 0.5 ? 1 : 3)) & 3);
        order.push(cdir);
        order.push((cdir + (rng() < 0.5 ? 3 : 1)) & 3);
      } else {
        order.push(cdir);
        if (rng() < 0.2) order.push((cdir + 1) & 3);
        if (rng() < 0.2) order.push((cdir + 3) & 3);
      }
      let placed = null, usedDir = -1;
      for (let i = 0; i < order.length; i++) {
        const d = order[i];
        const nx = cgx + DIR4[d].x;
        const nz = cgz + DIR4[d].z;
        if (!inGrid(nx, nz) || occupied[nz][nx]) continue;
        let typ = "corridor";
        if (rng() < 0.16) typ = "hall_long";
        else if (rng() < 0.12) typ = "room_small";
        else if (rng() < 0.05) typ = "junction";
        const node = tryPlace(typ === "hall_long" ? "corridor" : typ, nx, nz, d);
        if (!node) continue;
        if (linkDoor(cgx, cgz, d)) addEdge(spine[spine.length - 1], node, d);
        placed = node;
        usedDir = d;
        cgx = d === 1 ? node.gx + node.w - 1 : d === 3 ? node.gx : node.gx;
        cgz = d === 2 ? node.gz + node.h - 1 : d === 0 ? node.gz : node.gz;
        if (d === 1 || d === 3) { cgx = nx; cgz = nz; }
        else { cgx = nx; cgz = nz; }
        break;
      }
      if (!placed) break;
      spine.push(placed);
      if (usedDir === cdir) straight++;
      else { cdir = usedDir; straight = 0; }
    }

    if (spine.length < 20) return null;

    sockets.length = 0;
    for (let i = 1; i < spine.length - 1; i++) {
      if (rng() < 0.55) {
        const n = spine[i];
        const dirs = [];
        for (let d = 0; d < 4; d++) {
          const nx = n.gx + DIR4[d].x, nz = n.gz + DIR4[d].z;
          if (inGrid(nx, nz) && !occupied[nz][nx]) dirs.push(d);
        }
        if (dirs.length) pushSockets(n, [dirs[Math.floor(rng() * dirs.length)]]);
      }
    }
    pushSockets(startNode, rng() < 0.5 ? [0] : [2]);

    // Grow a large, persistent branching network instead of making the
    // non-spine paths terminate after a handful of modules.
    const branchTarget = Math.min(
      W * H - 24,
      spine.length + 105 + Math.floor(rng() * 75)
    );
    let guard = 0;
    while (MapGraph.nodes.length < branchTarget && sockets.length && guard++ < 2600) {
      const si = Math.floor(rng() * sockets.length);
      const sock = sockets[si];
      sockets.splice(si, 1);
      const ngx = sock.gx + DIR4[sock.dir].x;
      const ngz = sock.gz + DIR4[sock.dir].z;
      if (!inGrid(ngx, ngz)) continue;

      if (occupied[ngz][ngx]) {
        continue;
      }

      const roll = rng();
      let type = "corridor";
      if (roll < 0.24) type = "corridor";
      else if (roll < 0.38) type = "hall_long";
      else if (roll < 0.50) type = "corner";
      else if (roll < 0.66) type = "junction";
      else if (roll < 0.79) type = "room_small";
      else if (roll < 0.90) type = "room_large";
      else type = "room_pillar";

      const node = tryPlace(type, ngx, ngz, sock.dir);
      if (!node) continue;
      if (!linkDoor(sock.gx, sock.gz, sock.dir)) {
        // should not happen; keep growing anyway
      }
      addEdge(MapGraph.nodes[sock.nodeId], node, sock.dir);

      // outgoing sockets except the incoming face
      const out = [];
      if (type === "corridor" || type === "hall_long") {
        out.push(sock.dir);
        if (rng() < 0.52) out.push((sock.dir + 1) & 3);
        if (rng() < 0.42) out.push((sock.dir + 3) & 3);
      } else if (type === "corner") {
        out.push(rng() < 0.5 ? ((sock.dir + 1) & 3) : ((sock.dir + 3) & 3));
        if (rng() < 0.32) out.push(sock.dir);
      } else if (type === "junction") {
        out.push(sock.dir);
        out.push((sock.dir + 1) & 3);
        out.push((sock.dir + 3) & 3);
        if (rng() < 0.28) out.push(oppDir(sock.dir));
      } else {
        const cand = [0, 1, 2, 3].filter((d) => d !== oppDir(sock.dir));
        const extra = 2 + (rng() < 0.38 ? 1 : 0);
        for (let k = 0; k < extra && cand.length; k++) {
          const pick = Math.floor(rng() * cand.length);
          out.push(cand[pick]);
          cand.splice(pick, 1);
        }
      }
      pushSockets(node, out);
    }

    // Deliberately add many cross-connections between nearby occupied modules.
    // This keeps the Level 0 layout maze-like but makes intersections and loops
    // much more common than the old mostly-tree generation.
    const seenLinks = new Set();
    for (let gz = 0; gz < H; gz++) {
      for (let gx = 0; gx < W; gx++) {
        if (!occupied[gz][gx]) continue;
        const a = MapGraph.cellOwner[gz][gx];
        if (a == null) continue;
        for (const d of [1, 2]) {
          const nx = gx + DIR4[d].x, nz = gz + DIR4[d].z;
          if (!inGrid(nx, nz) || !occupied[nz][nx]) continue;
          const b = MapGraph.cellOwner[nz][nx];
          if (b == null || a === b) continue;
          const key = a < b ? a + ':' + b : b + ':' + a;
          if (seenLinks.has(key)) continue;
          seenLinks.add(key);
          if (MapGraph.nodes[a].connections.indexOf(b) >= 0) continue;
          // Higher chance at true junction candidates; still deterministic.
          const chance = (MapGraph.nodes[a].type === 'junction' || MapGraph.nodes[b].type === 'junction') ? 0.82 : 0.48;
          if (rng() < chance && linkDoor(gx, gz, d)) addEdge(MapGraph.nodes[a], MapGraph.nodes[b], d);
        }
      }
    }

    // A few extra branch sockets are opened from existing modules so the
    // network grows sideways rather than terminating as often as before.
    for (let i = 0; i < MapGraph.nodes.length; i++) {
      const n = MapGraph.nodes[i];
      if (!n || n.type === 'start') continue;
      const free = [];
      for (let d = 0; d < 4; d++) {
        const nx = n.gx + DIR4[d].x, nz = n.gz + DIR4[d].z;
        if (inGrid(nx, nz) && !occupied[nz][nx]) free.push(d);
      }
      if (free.length && rng() < 0.62) pushSockets(n, [free[Math.floor(rng() * free.length)]]);
    }

    // Graph distance from start
    const dist = new Array(MapGraph.nodes.length).fill(9999);
    dist[startNode.id] = 0;
    const q = [startNode.id];
    while (q.length) {
      const id = q.shift();
      const n = MapGraph.nodes[id];
      for (let i = 0; i < n.connections.length; i++) {
        const nid = n.connections[i];
        if (dist[nid] > dist[id] + 1) {
          dist[nid] = dist[id] + 1;
          q.push(nid);
        }
      }
    }

    // The exit is selected by actual shortest walking distance, not by the
    // length of the original generation spine. This is important now that
    // Level 0 contains many loops: a 500m-looking route is not enough if a
    // shortcut makes the true shortest path shorter than 500m.
    let exitNode = spine[spine.length - 1];
    if (!exitNode || exitNode.id === startNode.id || dist[exitNode.id] < 12) return null;
    let farCandidates = spine.slice().reverse().filter(n => n && n.id !== startNode.id && dist[n.id] < 9000);
    for (const candidate of farCandidates) {
      if (dist[candidate.id] * C >= CONFIG.gen.minPath) {
        exitNode = candidate;
        // Prefer the original 500–1000m target when possible, but do not
        // reject a valid >500m exit just because the new loop-heavy map
        // made the shortest path longer.
        if (dist[candidate.id] * C <= CONFIG.gen.maxPath) break;
      }
    }

    // Checkpoint about halfway along the primary route.
    let cpNode = null;
    const mid = Math.max(2, Math.floor(dist[exitNode.id] * 0.5));
    let best = 99;
    for (let i = 0; i < MapGraph.nodes.length; i++) {
      if (i === startNode.id || i === exitNode.id) continue;
      const d = Math.abs(dist[i] - mid);
      if (dist[i] < 9000 && d < best) { best = d; cpNode = MapGraph.nodes[i]; }
    }
    if (cpNode) cpNode.hasCheckpoint = true;

    function stampSpecial(node, kind) {
      const cx = node.gx + Math.floor(node.w / 2);
      const cz = node.gz + Math.floor(node.h / 2);
      const lx = 2, lz = 2;
      const tx = cx * C + lx;
      const tz = cz * C + lz;
      const tryFind = (x, z) => {
        if (z < 0 || x < 0 || z >= rows || x >= cols) return null;
        if (tiles[z][x] === TILE.WALL || tiles[z][x] === TILE.COLUMN) return null;
        return { x: x, z: z };
      };
      const center = tryFind(tx, tz);
      if (center) {
        tiles[center.z][center.x] = kind;
        return center;
      }
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const p = tryFind(tx + dx, tz + dz);
          if (p) {
            tiles[p.z][p.x] = kind;
            return p;
          }
        }
      }
      return null;
    }

    function findSpecialCell(node) {
      const cx = node.gx + Math.floor(node.w / 2);
      const cz = node.gz + Math.floor(node.h / 2);
      const tx = cx * C + 2;
      const tz = cz * C + 2;
      const tryFind = (x, z) => {
        if (z < 0 || x < 0 || z >= rows || x >= cols) return null;
        const t = tiles[z][x];
        if (t === TILE.WALL || t === TILE.COLUMN) return null;
        return { x: x, z: z };
      };
      const center = tryFind(tx, tz);
      if (center) return center;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const p = tryFind(tx + dx, tz + dz);
          if (p) return p;
        }
      }
      return null;
    }

    const startStamp = stampSpecial(startNode, TILE.START);
    if (!startStamp) return null;

    function walkable(t) { return t !== TILE.WALL && t !== TILE.COLUMN; }

    // Exact tile walking distance from a point to every reachable floor tile.
    // Int32 is used because the enlarged world can contain >32k tiles.
    function distanceMap(from) {
      const dm = [];
      for (let z = 0; z < rows; z++) dm.push(new Int32Array(cols).fill(-1));
      const tq = [[from.x, from.z]];
      dm[from.z][from.x] = 0;
      let qi = 0;
      while (qi < tq.length) {
        const p = tq[qi++];
        const d0 = dm[p[1]][p[0]];
        for (let d = 0; d < 4; d++) {
          const nx = p[0] + DIR4[d].x, nz = p[1] + DIR4[d].z;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          if (dm[nz][nx] >= 0 || !walkable(tiles[nz][nx])) continue;
          dm[nz][nx] = d0 + 1;
          tq.push([nx, nz]);
        }
      }
      return dm;
    }

    const startDistances = distanceMap(startStamp);

    // First exit remains the original long-route exit, preserving the
    // established 500–1000m objective. Additional exits are chosen from
    // other reachable branches and are separated by real walking distance.
    const firstExitCell = findSpecialCell(exitNode);
    if (!firstExitCell) return null;
    const firstPathMeters = startDistances[firstExitCell.z][firstExitCell.x] * CONFIG.tile;
    if (firstPathMeters < CONFIG.gen.minPath) return null;

    const exitNodes = [exitNode];
    const exitCandidates = [];
    for (let i = 0; i < MapGraph.nodes.length; i++) {
      const n = MapGraph.nodes[i];
      if (!n || n.id === startNode.id || n.id === exitNode.id || n.id === (cpNode ? cpNode.id : -1)) continue;
      if (n.deadEnd || n.type === "dead_end") continue;
      const cell = findSpecialCell(n);
      if (!cell) continue;
      const d0 = startDistances[cell.z][cell.x];
      if (d0 < 0 || d0 * CONFIG.tile < CONFIG.gen.exitSpacing) continue;
      exitCandidates.push({
        node: n,
        cell: cell,
        startM: d0 * CONFIG.tile,
        score: Math.abs(d0 * CONFIG.tile - (firstPathMeters + 700))
      });
    }
    exitCandidates.sort((a, b) => a.score - b.score);

    // Exact tile BFS is expensive on a 288x240 tile field.  The old
    // implementation ran one full BFS for nearly every candidate, which
    // could make the browser appear frozen at the loading screen. Keep
    // the exact validation, but only run it for a small, well-ranked set
    // of candidates. The first candidate selection still uses the exact
    // start-distance map above.
    const candidateLimit = Math.min(exitCandidates.length, 12);
    exitCandidates.length = candidateLimit;

    function tileDistance(a, b, capTiles) {
      const dm = new Int32Array(rows * cols);
      dm.fill(-1);
      const queue = new Int32Array(rows * cols);
      let head = 0, tail = 0;
      const startIdx = a.z * cols + a.x;
      const targetIdx = b.z * cols + b.x;
      dm[startIdx] = 0;
      queue[tail++] = startIdx;
      const cap = capTiles == null ? 1000000 : capTiles;
      while (head < tail) {
        const idx = queue[head++];
        const x = idx % cols;
        const z = (idx / cols) | 0;
        const d0 = dm[idx];
        if (idx === targetIdx) return d0;
        if (d0 >= cap) continue;
        for (let d = 0; d < 4; d++) {
          const nx = x + DIR4[d].x, nz = z + DIR4[d].z;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const ni = nz * cols + nx;
          if (dm[ni] >= 0 || !walkable(tiles[nz][nx])) continue;
          dm[ni] = d0 + 1;
          queue[tail++] = ni;
        }
      }
      return -1;
    }

    const chosenCells = [firstExitCell];
    const exitDistances = [firstPathMeters];
    let previousCell = firstExitCell;

    for (let i = 0; i < exitCandidates.length && exitNodes.length < CONFIG.gen.maxExits; i++) {
      const c = exitCandidates[i];
      let valid = true;
      for (let j = 0; j < chosenCells.length; j++) {
        const dTiles = tileDistance(chosenCells[j], c.cell, Math.ceil(CONFIG.gen.exitSpacing / CONFIG.tile));
        if (dTiles >= 0 && dTiles * CONFIG.tile < CONFIG.gen.exitSpacing) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;

      const fromPrevious = tileDistance(previousCell, c.cell, Math.ceil(CONFIG.gen.exitChainMax / CONFIG.tile) + 2);
      if (fromPrevious < 0 || fromPrevious * CONFIG.tile > CONFIG.gen.exitChainMax) continue;

      exitNodes.push(c.node);
      chosenCells.push(c.cell);
      exitDistances.push(c.startM);
      previousCell = c.cell;
    }

    // Mark the chosen exits only after selection, so rejected candidates
    // never become accidental exit tiles.
    for (let i = 0; i < exitNodes.length; i++) {
      exitNodes[i].hasExit = true;
    }
    const exitStamps = [];
    for (let i = 0; i < exitNodes.length; i++) {
      const stamp = stampSpecial(exitNodes[i], TILE.EXIT);
      if (!stamp) return null;
      exitStamps.push(stamp);
    }

    const cpStamp = cpNode ? stampSpecial(cpNode, TILE.CHECK) : null;
    if (!cpStamp && cpNode) return null;

    // The primary exit must remain hidden from the starting area.
    function visibleLine(ax, az, bx, bz) {
      const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
      if (steps < 8) return true;
      for (let i = 1; i < steps; i++) {
        const x = Math.round(ax + (bx - ax) * (i / steps));
        const z = Math.round(az + (bz - az) * (i / steps));
        if (!walkable(tiles[z][x])) return false;
      }
      return true;
    }
    if (visibleLine(startStamp.x, startStamp.z, exitStamps[0].x, exitStamps[0].z)) return null;

    // Preserve the legacy single-exit fields for compatibility, while
    // exposing the full list to the multi-elevator renderer.
    const pathMeters = exitDistances[0];
    const exitStamp = exitStamps[0];

    // Rare anomalies on non-start modules
    if (rng() < 0.22 && MapGraph.nodes.length > 8) {
      const an = MapGraph.nodes[2 + Math.floor(rng() * (MapGraph.nodes.length - 3))];
      if (an && !an.hasStart && !an.hasExit) {
        const rollA = rng();
        if (rollA < 0.35) { an.anomaly = "object"; an.type = an.type; }
        else if (rollA < 0.6) an.skipLights = true;
        else if (rollA < 0.85) an.dark = true;
        else an.anomaly = "odd_door";
      }
    }

    // carpet speckle
    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        if (tiles[z][x] === TILE.FLOOR && rng() < 0.03) tiles[z][x] = TILE.DEAD;
      }
    }

    const result = {
      seed: seed >>> 0,
      tiles: tiles,
      rows: rows,
      cols: cols,
      modules: MapGraph.nodes,
      startNode: startNode,
      exitNode: exitNode,
      exitNodes: exitNodes,
      checkpointNode: cpNode,
      startStamp: startStamp,
      exitStamp: exitStamp,
      exitStamps: exitStamps,
      exitDistances: exitDistances,
      pathMeters: pathMeters,
      targetPath: targetPath
    };
    this.last = result;
    return result;
  },

  generateValid(seed, maxTries) {
    let s = seed >>> 0;
    // The validation rules are intentionally strict, so a small retry budget
    // can reject a surprisingly large fraction of otherwise random seeds.
    // Keep retries deterministic while making startup generation highly
    // reliable. A valid map is returned as soon as one is found.
    const tries = maxTries || 160;
    for (let i = 0; i < tries; i++) {
      const res = this.generate((s + i * 7919) >>> 0);
      if (res) {
        res.seed = (s + i * 7919) >>> 0;
        return res;
      }
    }
    return this.generate(s) || null;
  }
};

const SpawnManager = {
  apply(result) {
    if (!result || !result.startStamp) return;
    const w = Level.tileToWorld(result.startStamp.x, result.startStamp.z);
    Level.startPos.set(w.x, 0, w.z);
  }
};

const DebugPath = {
  visible: false,
  line: null,
  refreshT: 0,
  toggle() {
    if (this.visible) this.hide();
    else this.show();
  },
  show() {
    this.visible = true;
    this.refreshT = 0;
    this.rebuild();
  },
  hide() {
    this.visible = false;
    if (this.line && scene) {
      scene.remove(this.line);
      if (this.line.geometry) this.line.geometry.dispose();
    }
    this.line = null;
  },
  walkable(t) {
    return t !== TILE.WALL && t !== TILE.COLUMN;
  },
  rebuild() {
    if (this.line && scene) {
      scene.remove(this.line);
      if (this.line.geometry) this.line.geometry.dispose();
      this.line = null;
    }
    if (!this.visible || !Level.tiles) return;
    const T = CONFIG.tile;
    const sx = Math.floor(Player.position.x / T);
    const sz = Math.floor(Player.position.z / T);
    let ex = -1, ez = -1, exitIndex = 0;
    const result = LevelGenerator.last;
    const stamps = result && (result.exitStamps || (result.exitStamp ? [result.exitStamp] : []));
    if (!stamps || !stamps.length || !Level.inBounds(sx, sz)) return;
    // The actual nearest exit is chosen by walking distance after BFS,
    // rather than by straight-line distance.
    ex = stamps[0].x; ez = stamps[0].z;
    const cols = Level.cols, rows = Level.rows;
    const dist = [];
    const prev = [];
    for (let z = 0; z < rows; z++) {
      dist.push(new Int16Array(cols).fill(-1));
      prev.push(new Int32Array(cols).fill(-1));
    }
    let startX = sx, startZ = sz;
    if (!this.walkable(Level.getTile(startX, startZ))) {
      let found = false;
      for (let r = 1; r <= 4 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const x = sx + dx, z = sz + dz;
            if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) {
              startX = x; startZ = z; found = true;
            }
          }
        }
      }
      if (!found) return;
    }
    const q = [[startX, startZ]];
    dist[startZ][startX] = 0;
    let qi = 0;
    while (qi < q.length) {
      const p = q[qi++];
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        if (dist[nz][nx] >= 0) continue;
        if (!this.walkable(Level.getTile(nx, nz))) continue;
        dist[nz][nx] = dist[p[1]][p[0]] + 1;
        prev[nz][nx] = p[0] | (p[1] << 16);
        q.push([nx, nz]);
      }
    }
    // Select the closest exit by actual navigable distance.
    let bestExitTiles = Infinity;
    for (let i = 0; i < stamps.length; i++) {
      const dd = dist[stamps[i].z][stamps[i].x];
      if (dd >= 0 && dd < bestExitTiles) {
        bestExitTiles = dd;
        exitIndex = i;
        ex = stamps[i].x;
        ez = stamps[i].z;
      }
    }
    if (bestExitTiles === Infinity) return;

    const pts = [new THREE.Vector3(Player.position.x, 0.35, Player.position.z)];
    const tiles = [];
    let cx = ex, cz = ez;
    while (!(cx === startX && cz === startZ)) {
      tiles.push([cx, cz]);
      const pr = prev[cz][cx];
      if (pr < 0) break;
      cx = pr & 65535;
      cz = pr >>> 16;
    }
    tiles.reverse();
    for (let i = 0; i < tiles.length; i += 2) {
      const w = Level.tileToWorld(tiles[i][0], tiles[i][1]);
      pts.push(new THREE.Vector3(w.x, 0.28, w.z));
    }
    const last = Level.tileToWorld(ex, ez);
    pts.push(new THREE.Vector3(last.x, 0.25, last.z));
    const routeStair = Stairwell.exits && Stairwell.exits[exitIndex]
      ? Stairwell.exits[exitIndex]
      : (Stairwell.exits && Stairwell.exits[0] ? Stairwell.exits[0] : null);
    if (routeStair) {
      const botAlong = routeStair.depth * 0.10;
      const bot = routeStair.local(0, botAlong);
      pts.push(new THREE.Vector3(bot.x, 0.35, bot.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7ec8ff }));
    if (scene) scene.add(this.line);
  },
  update(dt) {
    if (!this.visible) return;
    if (!GameState.debug) { this.hide(); return; }
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.45;
      this.rebuild();
    }
  }
};

const ExitManager = {
  worldPos() {
    if (GameState.level === 1 && typeof Level1 !== "undefined" && Level1.exitPosition) {
      return Level1.exitPosition.clone();
    }
    const list = Stairwell.exits && Stairwell.exits.length
      ? Stairwell.exits
      : [];
    if (list.length) {
      let best = list[0].origin;
      let bestD = Math.hypot(best.x - Player.position.x, best.z - Player.position.z);
      for (let i = 1; i < list.length; i++) {
        const o = list[i].origin;
        const d = Math.hypot(o.x - Player.position.x, o.z - Player.position.z);
        if (d < bestD) { best = o; bestD = d; }
      }
      return best.clone();
    }
    const res = LevelGenerator.last;
    if (!res) return null;
    const stamp = res.exitStamp || (res.exitStamps && res.exitStamps[0]);
    if (!stamp) return null;
    const w = Level.tileToWorld(stamp.x, stamp.z);
    return new THREE.Vector3(w.x, 0, w.z);
  }
};

const ExitLocator = {
  active:false, el:null, lastToast:0,
  init(){
    if(this.el) return;
    this.el=document.getElementById("exit-waypoint");
    if(!this.el) return;
  },
  toggle(){
    this.init();
    if(GameState.level!==1){ this.active=false; this.el.style.display="none"; return; }
    this.active=!this.active;
    this.el.style.display=this.active?"block":"none";
    HUD.toast(this.active?"NEAREST LEVEL 1 EXIT SHOWN":"EXIT LOCATOR OFF");
  },
  hide(){ if(this.el) this.el.style.display="none"; this.active=false; },
  update(){
    if(!this.active || GameState.level!==1 || !Level1.exitPosition || !CameraRig.camera || !this.el) return;
    const dx=Level1.exitPosition.x-Player.position.x, dz=Level1.exitPosition.z-Player.position.z;
    const dist=Math.hypot(dx,dz);
    const fx=-Math.sin(Player.yaw), fz=-Math.cos(Player.yaw);
    const rightX=Math.cos(Player.yaw), rightZ=-Math.sin(Player.yaw);
    const side=dx*rightX+dz*rightZ;
    const forward=dx*fx+dz*fz;
    const angle=Math.atan2(side,forward);
    const clamped=Math.max(-1.0,Math.min(1.0,angle/1.45));
    this.el.style.left=(50+clamped*42).toFixed(1)+"%";
    this.el.style.top=(forward>0?"17%":"83%");
    this.el.querySelector(".exit-arrow").style.transform=`rotate(${(angle*180/Math.PI).toFixed(1)}deg)`;
    this.el.querySelector(".exit-distance").textContent="EXIT "+dist.toFixed(0)+"m";
  }
};

const Stairwell = {
  // Kept under the old internal name so the existing generator/debug code
  // remains compatible. Visually and mechanically this is now a concrete
  // elevator exit, not a stairwell.
  exits: [],
  origin: null,
  hole: null,
  minY: -10,
  reached: false,
  width: 4.6,
  depth: 5.2,
  height: 3.2,
  fx: 0, fz: 1, rx: 1, rz: 0,
  sequenceActive: false,
  sequenceT: 0,
  sequenceDuration: 6.5,
  sequenceExitIndex: -1,
  cabGroups: [],
  avatarGroups: [],
  doorPairs: [],

  reset() {
    this.exits = [];
    this.origin = null;
    this.hole = null;
    this.minY = -10;
    this.reached = false;
    this.sequenceActive = false;
    this.sequenceT = 0;
    this.sequenceExitIndex = -1;
    for (const g of this.cabGroups) { if (g && scene) scene.remove(g); }
    this.cabGroups = [];
    this.avatarGroups = [];
    this.doorPairs = [];
    GameState.exitReached = false;
    GameState.elevatorShake = 0;
    const ov = document.getElementById('elevator-sequence');
    if (ov) ov.style.display = 'none';
  },

  planOne(result, stamp, exitNode) {
    const ex = stamp.x, ez = stamp.z;
    const w = Level.tileToWorld(ex, ez);
    const dirs = [
      { fx: 0, fz: 1, rx: 1, rz: 0 },
      { fx: 0, fz: -1, rx: -1, rz: 0 },
      { fx: 1, fz: 0, rx: 0, rz: -1 },
      { fx: -1, fz: 0, rx: 0, rz: 1 }
    ];
    let best = dirs[0], bestScore = -1e9;
    // Face the direction the player approaches from. The exit stamp is in
    // the center of a generated module, so this selects a broad open side
    // rather than trying to extend a staircase into neighboring modules.
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      let score = 0, behindRun = 0;
      for (let ss = 1; ss <= 5; ss++) {
        const tx = ex - Math.round(d.fx * ss), tz = ez - Math.round(d.fz * ss);
        if (!Level.inBounds(tx, tz)) break;
        const t = Level.getTile(tx, tz);
        if (t === TILE.WALL || t === TILE.COLUMN) break;
        behindRun++;
      }
      score += behindRun * 20;
      if (exitNode && exitNode.connections) {
        for (let c = 0; c < exitNode.connections.length; c++) {
          const nb = MapGraph.nodes[exitNode.connections[c]];
          if (!nb) continue;
          const ndx = (exitNode.gx + exitNode.w * 0.5) - (nb.gx + nb.w * 0.5);
          const ndz = (exitNode.gz + exitNode.h * 0.5) - (nb.gz + nb.h * 0.5);
          const cx = Math.abs(ndx) >= Math.abs(ndz) ? (ndx >= 0 ? 1 : -1) : 0;
          const cz = Math.abs(ndx) >= Math.abs(ndz) ? 0 : (ndz >= 0 ? 1 : -1);
          if (cx === d.fx && cz === d.fz) score += 35;
        }
      }
      if (score > bestScore) { bestScore = score; best = d; }
    }

    const elevator = {
      fx: best.fx, fz: best.fz, rx: best.rx, rz: best.rz,
      // Center the cab on the special tile. Its front doors face the
      // approach direction (-fx,-fz), so the player enters straight ahead.
      origin: new THREE.Vector3(w.x, 0, w.z),
      hole: null,
      minY: -10,
      width: 4.6,
      depth: 5.2,
      height: 3.2,
      steps: 0,
      rise: 0,
      run: 0,
      landingAfter: 0,
      landingLen: 3.8,
      exitStamp: stamp,
      exitNode: exitNode,
      local(side, along) {
        return { x: this.origin.x + this.rx * side + this.fx * along,
                 z: this.origin.z + this.rz * side + this.fz * along };
      }
    };
    const half = elevator.width * 0.5;
    const halfD = elevator.depth * 0.5;
    // Cut only the elevator shaft footprint from the Level 0 floor. The
    // cabin floor covers it before descent and moves down with the cab.
    const corners = [
      elevator.local(-half, -halfD), elevator.local(half, -halfD),
      elevator.local(-half, halfD), elevator.local(half, halfD)
    ];
    let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
    for (const c of corners) { minx=Math.min(minx,c.x); maxx=Math.max(maxx,c.x); minz=Math.min(minz,c.z); maxz=Math.max(maxz,c.z); }
    elevator.hole = {minx:minx-0.10,maxx:maxx+0.10,minz:minz-0.10,maxz:maxz+0.10};
    elevator.minY = -11;
    return elevator;
  },

  planFrom(result) {
    this.reset();
    if (!result || !result.exitStamps || !result.exitStamps.length) return;
    const nodes = result.exitNodes || [];
    for (let i=0;i<result.exitStamps.length;i++) {
      const st=this.planOne(result,result.exitStamps[i],nodes[i]||result.exitNode);
      if(st) this.exits.push(st);
    }
    if(this.exits.length){
      const first=this.exits[0];
      this.origin=first.origin; this.hole=first.hole; this.minY=first.minY;
      this.fx=first.fx; this.fz=first.fz; this.rx=first.rx; this.rz=first.rz;
      this.width=first.width; this.depth=first.depth; this.height=first.height;
    }
  },

  local(side, along) {
    if(this.exits.length) return this.exits[0].local(side,along);
    return {x:this.origin.x+this.rx*side+this.fx*along,z:this.origin.z+this.rz*side+this.fz*along};
  },

  containsWorld(x,z){
    for(const st of this.exits){const h=st.hole;if(h&&x>=h.minx&&x<=h.maxx&&z>=h.minz&&z<=h.maxz)return true;}
    return false;
  },
  nearConcrete(x,z){
    for(const st of this.exits){
      const h=st.hole;if(!h||!st.origin)continue;
      const pad=2.4;
      if(x>=h.minx-pad&&x<=h.maxx+pad&&z>=h.minz-pad&&z<=h.maxz+pad)return true;
    }
    return false;
  },
  playerInside(){
    for(const st of this.exits){const h=st.hole;if(h&&Player.position.x>=h.minx&&Player.position.x<=h.maxx&&Player.position.z>=h.minz&&Player.position.z<=h.maxz)return true;}
    return false;
  },
  addBox(group,mat,cx,cy,cz,sx,sy,sz){const m=new THREE.Mesh(Geometries.box,mat);m.scale.set(sx,sy,sz);m.position.set(cx,cy,cz);group.add(m);return m;},
  addCol(minx,miny,minz,maxx,maxy,maxz){Level.addBoxCollider(minx,miny,minz,maxx,maxy,maxz);},
  span(st,along,across){return{x:Math.abs(st.rx)*across+Math.abs(st.fx)*along,z:Math.abs(st.rz)*across+Math.abs(st.fz)*along};},
  slab(group,st,mat,side,along,y,alongLen,across,thick){const p=st.local(side,along),sz=this.span(st,alongLen,across);this.addBox(group,mat,p.x,y,p.z,sz.x,thick,sz.z);return p;},

  buildOne(sceneRef,st,index){
    const g=new THREE.Group();
    g.name='ConcreteElevator_'+index;

    // A deliberately realistic industrial elevator: concrete shaft/lobby,
    // recessed metal doors, concrete wall panels, a proper cab ceiling,
    // control panel, handrail, floor threshold and practical lighting.
    const concrete = Materials.concrete;
    const concreteDark = Materials.concreteDark;
    const concreteLight = new THREE.MeshStandardMaterial({
      map: Materials.concrete.map || null,
      color: 0xc2c2bd,
      emissive: 0x161716, emissiveIntensity: 0.22,
      roughness: 0.91,
      metalness: 0.02
    });
    const concreteEdge = new THREE.MeshStandardMaterial({
      map: Materials.concrete.map || null,
      color: 0x94948f,
      emissive: 0x0a0b0a, emissiveIntensity: 0.10,
      roughness: 0.96,
      metalness: 0.02
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x777a78,
      roughness: 0.62,
      metalness: 0.58
    });
    const steelDark = new THREE.MeshStandardMaterial({
      color: 0x343735,
      roughness: 0.72,
      metalness: 0.5
    });
    const brushed = new THREE.MeshStandardMaterial({
      color: 0x9a9d99,
      roughness: 0.42,
      metalness: 0.78
    });
    const black = new THREE.MeshStandardMaterial({
      color: 0x161817,
      roughness: 0.8,
      metalness: 0.18
    });
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x696b68,
      roughness: 0.76,
      metalness: 0.25
    });
    const buttonMat = new THREE.MeshStandardMaterial({
      color: 0xb7b8b3,
      roughness: 0.32,
      metalness: 0.72
    });
    const indicatorMat = new THREE.MeshStandardMaterial({
      color: 0xd7ddd7,
      emissive: 0x6f7b73,
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.1
    });

    const W=st.width, D=st.depth, H=st.height, half=W/2, halfD=D/2;
    const p=st.origin;
    const L=(side,along)=>st.local(side,along);
    const sref=sceneRef||scene;

    // ---------- Concrete shaft / exterior frame ----------
    // Keep the shaft visually substantial but leave the actual entrance open.
    const shaftDepth = D + 1.25;
    const shaftBottom = -12;
    const wallT = 0.34;
    // Keep the shaft walls behind the elevator face. They must not project
    // several metres into the Level 0 approach corridor.
    const shaftAlongCenter = (0.70);
    for(const side of [-1,1]){
      const q=L(side*(half+wallT*0.5),shaftAlongCenter);
      const sz=this.span(st,shaftDepth,wallT);
      this.addBox(g,concreteEdge,q.x,(shaftBottom+H)/2,q.z,sz.x,H-shaftBottom,sz.z);
    }
    const back=L(0,halfD+0.55);
    const backSz=this.span(st,wallT,W+wallT*2);
    this.addBox(g,concreteEdge,back.x,(shaftBottom+H)/2,back.z,backSz.x,H-shaftBottom,backSz.z);

    // Large concrete entrance surround, intentionally lighter than the shaft.
    const jambW=0.48, lintelH=0.42;
    for(const side of [-1,1]){
      const q=L(side*(half+jambW*0.5-0.04),-halfD+0.18);
      const sz=this.span(st,0.55,jambW);
      this.addBox(g,concreteLight,q.x,H*0.5,q.z,sz.x,H,sz.z);
    }
    const ql=L(0,-halfD+0.18);
    const qls=this.span(st,0.55,W+jambW*2-0.08);
    this.addBox(g,concreteLight,ql.x,H-lintelH*0.5,ql.z,qls.x,lintelH,qls.z);

    // Concrete panel seams on the exterior surround — subtle, not decorative.
    for(const side of [-1,1]){
      for(const yy of [0.92,1.86,2.78]){
        const q=L(side*(half+0.012),-halfD+0.22);
        const sz=this.span(st,0.07,0.24);
        this.addBox(g,concreteEdge,q.x,yy,q.z,sz.x,0.028,sz.z);
      }
    }
    const topSeam=L(0,-halfD+0.205);
    const topSeamSz=this.span(st,0.07,W-0.9);
    this.addBox(g,concreteEdge,topSeam.x,2.48,topSeam.z,topSeamSz.x,0.025,topSeamSz.z);

    // ---------- Elevator cab ----------
    // The cabin floor sits at Level 0 until the sequence begins, then the
    // whole group descends. This keeps the exit self-contained.
    this.addBox(g,concreteLight,p.x,-0.08,p.z,W,0.16,D);
    this.addBox(g,concreteEdge,p.x,-0.17,p.z,W+0.08,0.12,D+0.08);

    // Back wall with large concrete panels and central seam.
    const backCab=L(0,halfD-0.08);
    const backCabSz=this.span(st,0.20,W);
    this.addBox(g,concreteLight,backCab.x,H*0.5,backCab.z,backCabSz.x,H,backCabSz.z);
    const backSeam=L(0,halfD-0.185);
    const seamSz=this.span(st,0.025,0.035);
    this.addBox(g,concreteEdge,backSeam.x,1.65,backSeam.z,seamSz.x,3.0,seamSz.z);

    // Side walls, with shallow panel strips.
    for(const side of [-1,1]){
      const q=L(side*(half-0.12),0);
      const sz=this.span(st,D-0.24,0.24);
      this.addBox(g,concreteLight,q.x,H*0.5,q.z,sz.x,H,sz.z);
      for(const along of [-1.35,0,1.35]){
        const sq=L(side*(half-0.245),along);
        const ssz=this.span(st,0.028,0.035);
        this.addBox(g,concreteEdge,sq.x,1.62,sq.z,ssz.x,2.82,ssz.z);
      }
    }

    // Ceiling recess and practical fluorescent light.
    this.addBox(g,concreteEdge,p.x,H-0.08,p.z,W,0.16,D);
    const ceilingInset=L(0,0.12);
    const csz=this.span(st,2.25,0.44);
    this.addBox(g,black,ceilingInset.x,H-0.18,ceilingInset.z,csz.x,0.08,csz.z);
    const lsz=this.span(st,1.95,0.16);
    this.addBox(g,Materials.light,ceilingInset.x,H-0.12,ceilingInset.z,lsz.x,0.055,lsz.z);

    // Recessed metal door pocket around the front opening.
    const doorH=2.46;
    const doorW=(W-0.34)/2;
    const pocketY=doorH*0.5;
    const pocketL=L(-half+0.17+doorW*0.5,-halfD+0.19);
    const pocketR=L(half-0.17-doorW*0.5,-halfD+0.19);
    const doorSize=this.span(st,0.12,doorW);
    const dl=this.addBox(g,brushed,pocketL.x,pocketY,pocketL.z,doorSize.x,doorH,doorSize.z);
    const dr=this.addBox(g,brushed,pocketR.x,pocketY,pocketR.z,doorSize.x,doorH,doorSize.z);
    dl.userData.elevatorDoor=true;
    dr.userData.elevatorDoor=true;
    const pair={left:dl,right:dr,openLeft:pocketL.x,openRight:pocketR.x,st:st,doorW:doorW,doorH:doorH};
    this.doorPairs[index]=pair;

    // Door seams and top/bottom tracks.
    const center=L(0,-halfD+0.13);
    const seamSize=this.span(st,0.10,0.032);
    this.addBox(g,steelDark,center.x,doorH/2,center.z,seamSize.x,doorH,seamSize.z);
    const track=this.span(st,0.34,W-0.46);
    this.addBox(g,steelDark,center.x,0.105,center.z,track.x,0.06,track.z);
    this.addBox(g,steelDark,center.x,doorH+0.015,center.z,track.x,0.05,track.z);

    // ---------- Real elevator controls ----------
    const cp=L(-half+0.34,0.08);
    // Panel stands slightly proud of the concrete wall.
    const cps=this.span(st,0.46,0.46);
    this.addBox(g,panelMat,cp.x,1.30,cp.z,cps.x,1.00,cps.z);
    const screen=L(-half+0.34,0.08);
    const ss=this.span(st,0.06,0.25);
    this.addBox(g,black,screen.x,1.68,screen.z,ss.x,0.18,ss.z);
    this.addBox(g,indicatorMat,screen.x,1.68,screen.z,ss.x*0.72,0.045,ss.z*0.62);
    for(let i=0;i<3;i++){
      const b=L(-half+0.34,0.95+i*0.18);
      const bs=this.span(st,0.05,0.07);
      this.addBox(g,buttonMat,b.x,1.38-i*0.18,b.z,bs.x,0.075,bs.z);
    }

    // Handrail on the back wall: unmistakably elevator-like, but industrial.
    const railMat=brushed;
    const railY=0.92;
    const railL=L(-half+0.48,halfD-0.28);
    const railR=L(half-0.48,halfD-0.28);
    const railSpan=this.span(st,0.10,W-0.96);
    this.addBox(g,railMat, p.x,railY,railL.z,railSpan.x,0.075,railSpan.z);
    for(const side of [-1,1]){
      const rq=L(side*(half-0.52),halfD-0.28);
      const rs=this.span(st,0.10,0.045);
      this.addBox(g,railMat,rq.x,railY*0.65,rq.z,rs.x,0.50,rs.z);
    }

    // Threshold at the entrance.
    const threshold=L(0,-halfD+0.02);
    const ths=this.span(st,0.24,W-0.26);
    this.addBox(g,brushed,threshold.x,0.075,threshold.z,ths.x,0.10,ths.z);

    // Small warning/maintenance plate above the doors.
    const plate=L(0,-halfD+0.03);
    const ps=this.span(st,0.04,0.44);
    this.addBox(g,steelDark,plate.x,2.68,plate.z,ps.x,0.16,ps.z);
    const ptxt=L(0,-halfD+0.055);
    const pts=this.span(st,0.02,0.27);
    this.addBox(g,indicatorMat,ptxt.x,2.68,ptxt.z,pts.x,0.035,pts.z);

    // Lighting: a strong cabin ceiling light + softer shaft/lobby light.
    if(sref){
      const cabLight=new THREE.PointLight(0xfff3d7,2.4,8.0,1.5);
      cabLight.position.set(ceilingInset.x,H-0.30,ceilingInset.z);
      sref.add(cabLight); LightingSystem.lights.push(cabLight);
      const lobbyLight=new THREE.PointLight(0xe6e8e2,1.65,8.5,1.55);
      const lp=L(0,-halfD-0.55);
      lobbyLight.position.set(lp.x,2.65,lp.z);
      sref.add(lobbyLight); LightingSystem.lights.push(lobbyLight);
      const facadeL=L(-half-0.55,-halfD-0.45);
      const facadeR=L(half+0.55,-halfD-0.45);
      const fl=new THREE.PointLight(0xf0ead2,1.15,5.5,1.8); fl.position.set(facadeL.x,2.0,facadeL.z);
      const fr=new THREE.PointLight(0xf0ead2,1.15,5.5,1.8); fr.position.set(facadeR.x,2.0,facadeR.z);
      sref.add(fl,fr); LightingSystem.lights.push(fl,fr);
    }

    // Simple visible player avatar for the descent cinematic. It is intentionally
    // stylized and neutral so the first-person player can see their own body.
    const avatar=new THREE.Group(); avatar.name='PlayerCinematicAvatar';
    const suit=new THREE.MeshStandardMaterial({color:0x60645f,roughness:0.82,metalness:0.04});
    const skin=new THREE.MeshStandardMaterial({color:0xb59a80,roughness:0.9,metalness:0});
    const torso=new THREE.Mesh(Geometries.box,suit); torso.scale.set(0.42,0.92,0.25); torso.position.y=1.08;
    const head=new THREE.Mesh(Geometries.box,skin); head.scale.set(0.30,0.34,0.28); head.position.y=1.72;
    const legL=new THREE.Mesh(Geometries.box,suit); legL.scale.set(0.15,0.68,0.16); legL.position.set(-0.12,0.34,0);
    const legR=new THREE.Mesh(Geometries.box,suit); legR.scale.set(0.15,0.68,0.16); legR.position.set(0.12,0.34,0);
    avatar.add(torso,head,legL,legR); avatar.position.set(p.x,p.y+0.02,p.z); avatar.rotation.y=Math.atan2(-st.fx,-st.fz); g.add(avatar);
    this.avatarGroups=this.avatarGroups||[]; this.avatarGroups[index]=avatar;

    sceneRef.add(g);
    this.cabGroups[index]=g;

    // Static floor collider lets the player stand inside before descent.
    const h=st.hole;
    this.addCol(h.minx+0.08,-0.02,h.minz+0.08,h.maxx-0.08,0.04,h.maxz-0.08);

    // Enter only from the intended front-facing corridor.
    const trCenter=L(0,-halfD*0.72);
    const trW=W*0.74, trD=1.05;
    const a=L(-trW/2,-halfD-trD/2), b=L(trW/2,-halfD+trD/2);
    Level.triggers.push({type:'exit',exitIndex:index,minx:Math.min(a.x,b.x),maxx:Math.max(a.x,b.x),minz:Math.min(a.z,b.z),maxz:Math.max(a.z,b.z)});
  },

  build(sceneRef){
    if(!this.exits.length||!Level.group)return;
    for(let i=0;i<this.exits.length;i++)this.buildOne(sceneRef,this.exits[i],i);
  },

  startSequence(index){
    if(this.sequenceActive||GameState.phase!=='playing')return;
    this.sequenceActive=true; this.sequenceT=0; this.sequenceExitIndex=index|0; this.reached=true; GameState.exitReached=true; GameState.cinematicCamera=true;
    clearInput();
    const pair=this.doorPairs[this.sequenceExitIndex];
    if(pair){
      // Capture the initial world-space door positions in the elevator's
      // local frame. The group itself remains at the cab origin.
      pair.startL=pair.left.position.clone(); pair.startR=pair.right.position.clone();
      const c=pair.startL.clone().add(pair.startR).multiplyScalar(0.5);
      pair.closeL=c.clone().add(new THREE.Vector3(pair.st.rx*0.012,0,pair.st.rz*0.012));
      pair.closeR=c.clone().add(new THREE.Vector3(-pair.st.rx*0.012,0,-pair.st.rz*0.012));
    }
    const ov=document.getElementById('elevator-sequence');
    if(ov)ov.style.display='flex';
    setPauseOverlay(false);
    const status=document.getElementById('elevator-status');
    if(status)status.textContent='DOORS CLOSING';
    const bar=document.getElementById('elevator-fill'); if(bar)bar.style.width='0%';
    if(document.pointerLockElement)document.exitPointerLock();
    AudioSystem._tone&&AudioSystem._tone(72,'sine',0.18,0.05,'events');
  },

  update(dt){
    if(!this.sequenceActive)return;
    this.sequenceT+=dt;
    const t=this.sequenceT, dur=this.sequenceDuration;
    const pair=this.doorPairs[this.sequenceExitIndex];
    const g=this.cabGroups[this.sequenceExitIndex];
    const st=this.exits[this.sequenceExitIndex];
    const openPhase=0.8, closePhase=1.6;
    if(pair){
      const q=Math.min(1,Math.max(0,(t-openPhase)/(closePhase-openPhase)));
      // Doors slide toward the center seam.
      pair.left.position.lerpVectors(pair.startL,pair.closeL,q);
      pair.right.position.lerpVectors(pair.startR,pair.closeR,q);
    }
    let descend=0;
    if(t>=1.6) descend=Math.min(10.5, (t-1.6)/(dur-1.6)*10.5);
    if(g)g.position.y=-descend;
    if(st){
      Player.position.x=st.origin.x; Player.position.z=st.origin.z; Player.position.y=-descend;
      Player.velocity.set(0,0,0); Player.onGround=true;
      Player.yaw=Math.atan2(-st.fx,-st.fz);
      Player.pitch*=0.96;
    }
    GameState.elevatorShake = t>1.55 ? Math.min(1,0.35+0.65*Math.sin(t*9)*Math.sin(t*3.1)) : 0;
    const status=document.getElementById('elevator-status');
    const bar=document.getElementById('elevator-fill');
    if(t<1.6){if(status)status.textContent='DOORS CLOSING';}
    else if(t<2.4){if(status)status.textContent='ELEVATOR DEPARTING';}
    else if(t<5.7){if(status)status.textContent='DESCENDING — LEVEL 1';}
    else if(status)status.textContent='ARRIVING';
    if(bar)bar.style.width=Math.min(100,(t/dur)*100).toFixed(1)+'%';
    const floor=document.getElementById('elevator-floor');
    if(floor){const depth=Math.min(10.5,Math.max(0,descend));floor.textContent='DEPTH  −'+depth.toFixed(1)+' m';}
    // Keep the avatar centered in the cab while the cabin descends.
    const avatar=this.avatarGroups&&this.avatarGroups[this.sequenceExitIndex];
    if(avatar){avatar.position.y=0.02; avatar.rotation.y=Math.atan2(-st.fx,-st.fz);}
    if(t>=dur){
      if(status)status.textContent='LEVEL 1 — DOORS OPENING';
      const openT=Math.min(1,(t-dur)/1.25);
      if(pair){
        const eased=1-Math.pow(1-openT,3);
        const far=pair.doorW*0.92;
        pair.left.position.x=pair.startL.x + (pair.startL.x < pair.startR.x ? -far : far)*eased;
        pair.right.position.x=pair.startR.x + (pair.startR.x > pair.startL.x ? far : -far)*eased;
      }
      if(openT>=1){
        this.sequenceActive=false;
        GameState.elevatorShake=0;
        GameState.cinematicCamera=false;
        if(g)g.visible=false;
        if(this.avatarGroups&&this.avatarGroups[this.sequenceExitIndex]) this.avatarGroups[this.sequenceExitIndex]=null;
        const exitSeed=((GameState.seed^0x51f15e5d)>>>0)||1;
        Level1.enter(exitSeed, st);
        const exitForward=new THREE.Vector3(st.fx,0,st.fz);
        Player.position.set(st.origin.x + exitForward.x*3.2, st.minY||-10.5, st.origin.z + exitForward.z*3.2);
        Player.yaw=Math.atan2(-st.fx,-st.fz); Player.pitch=0;
        /* Preserve total run time across the Level 0 → Level 1 transition. */
        GameState.distance=0; GameState.exitReached=false;
        GameState.elevatorShake=0;
        const ov=document.getElementById('elevator-sequence');if(ov)ov.style.display='none';
        if(document.getElementById('hud-obj'))document.getElementById('hud-obj').textContent='Objective: explore Level 1';
        const lvlLabel=document.getElementById('hud-level-label'); if(lvlLabel)lvlLabel.textContent='LEVEL 1';
        renderer.domElement.requestPointerLock();
      }
    }
  }
};

/* ------------------------------------------------------------------
   LEVEL / MAP — consumes generated tiles
   ------------------------------------------------------------------ */

const MAP_STRINGS_UNUSED = [
  "################################################",
  "#..............####..............####..........#",
  "#..............####..............####..........#",
  "#..##########..####..##########.........####...#",
  "#..#........#..####..#........#.........#  #...#",
  "#..#........#........#........#.........#  #...#",
  "#..#...C....#........#...C....##########.......#",
  "#..#........##########.........................#",
  "#..#........#........+........+....#####..######",
  "#...........#.........................###......#",
  "#...........#..#####.....##.....##....###......#",
  "#####..######..#...#.....##.....##.............#",
  "#..............#...#..............##...........#",
  "#..S...........#...#..............##.....K.....#",
  "#..............#####..######..###########..#####",
  "#.....................#....#...................#",
  "##########.....C......#....#.....C....##########",
  "#........#............#....#............#......#",
  "#........#..#######...######...#######..#......#",
  "#........#..#.....#............#.....#..#......#",
  "#...........#.....+............+.....#.........#",
  "#...........#.....#....####....#.....#.........#",
  "#####..######.....#....#  #....#.....######..###",
  "#.................#....#  #....#...............#",
  "#..###########..........  ...........########..#",
  "#..#.........#...C............C......#......#..#",
  "#..#.........#.......................#......#..#",
  "#..#....C....##########...###########.......#..#",
  "#..#........................................#..#",
  "#..######################.###################..#",
  "#......................#...#...................#",
  "#......................#...#..............E....#",
  "#..#####..######..######...######..#####.......#",
  "#..#...........#...............#...............#",
  "#..#...........#...............#..###########..#",
  "#..............#####.....C.....#...............#",
  "#..............................#...............#",
  "################################################"
];

const Level = {
  cols: 0,
  rows: 0,
  tiles: [],
  colliders: [], // axis-aligned boxes {min,max} THREE.Vector3
  triggers: [],
  startPos: new THREE.Vector3(2, 0, 2),
  group: null,
  darkFogGroup: null,
  worldMin: new THREE.Vector3(),
  worldMax: new THREE.Vector3(),

  inBounds(tx, tz) {
    return tz >= 0 && tz < this.rows && tx >= 0 && tx < this.cols;
  },
  getTile(tx, tz) {
    if (!this.inBounds(tx, tz)) return TILE.WALL;
    return this.tiles[tz][tx];
  },
  isSolidTile(t) {
    return t === TILE.WALL;
  },
  tileToWorld(tx, tz) {
    return {
      x: (tx + 0.5) * CONFIG.tile,
      z: (tz + 0.5) * CONFIG.tile
    };
  },

  loadGenerated(result) {
    this.tiles = result.tiles;
    this.rows = result.rows;
    this.cols = result.cols;
    this.worldMin.set(0, -1, 0);
    this.worldMax.set(this.cols * CONFIG.tile, CONFIG.wallH + 2, this.rows * CONFIG.tile);
    this.triggers.length = 0;
    this.pathMeters = result.pathMeters || 0;
    this.targetPath = result.targetPath || 0;
  },

  clear(sceneRef) {
    const s = sceneRef || scene;
    LightingSystem.clear(s);
    if (this.group && s) {
      this.group.traverse((obj) => {
        if (obj.geometry && obj.geometry.dispose) {
          const shared = obj.geometry === Geometries.box ||
            obj.geometry === Geometries.lightPanel ||
            obj.geometry === Geometries.lightHousing ||
            obj.geometry === Geometries.floorTile ||
            obj.geometry === Geometries.column ||
            obj.geometry === Geometries.beam;
          if (!shared) obj.geometry.dispose();
        }
      });
      s.remove(this.group);
    }
    if (this.darkFogGroup && s) {
      this.darkFogGroup.traverse((obj) => {
        if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
      });
      s.remove(this.darkFogGroup);
    }
    this.group = null;
    this.darkFogGroup = null;
    this.colliders.length = 0;
    this.triggers.length = 0;
    Stairwell.reset();
    if (typeof DebugPath !== "undefined") DebugPath.hide();
  },

  /* Greedy horizontal merge of wall runs, then emit box colliders.
     Corners stay closed because adjacent runs meet at tile edges. */
  buildColliders() {
    this.colliders.length = 0;
    const T = CONFIG.tile;
    const H = CONFIG.wallH;

    const used = [];
    for (let z = 0; z < this.rows; z++) used.push(new Array(this.cols).fill(false));

    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        if (used[z][x] || !this.isSolidTile(this.getTile(x, z))) continue;
        let x2 = x;
        while (x2 + 1 < this.cols && this.isSolidTile(this.getTile(x2 + 1, z)) && !used[z][x2 + 1]) x2++;
        let z2 = z;
        let canGrow = true;
        while (canGrow && z2 + 1 < this.rows) {
          for (let xx = x; xx <= x2; xx++) {
            if (!this.isSolidTile(this.getTile(xx, z2 + 1)) || used[z2 + 1][xx]) { canGrow = false; break; }
          }
          if (canGrow) z2++;
        }
        for (let zz = z; zz <= z2; zz++) {
          for (let xx = x; xx <= x2; xx++) used[zz][xx] = true;
        }
        this.addBoxCollider(x * T, 0, z * T, (x2 + 1) * T, H, (z2 + 1) * T);
      }
    }

    // Invisible world envelope so the player cannot leave the map
    const W = this.cols * T;
    const D = this.rows * T;
    const thick = 2;
    const holes = Stairwell.exits.map((st) => st.hole).filter(Boolean);

    // Keep the world boundary solid everywhere except the actual elevator
    // openings. Multiple exits are handled by horizontal strips so one
    // opening can never accidentally seal another.
    const zCuts = [0, D];
    for (let i = 0; i < holes.length; i++) {
      zCuts.push(Math.max(0, holes[i].minz), Math.min(D, holes[i].maxz));
    }
    zCuts.sort((a, b) => a - b);
    const uniqueZ = [];
    for (let i = 0; i < zCuts.length; i++) {
      if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
    }
    for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
      const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
      if (z1 - z0 < 0.01) continue;
      const midZ = (z0 + z1) * 0.5;
      const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
      const xCuts = [0, W];
      for (let i = 0; i < active.length; i++) {
        xCuts.push(Math.max(0, active[i].minx), Math.min(W, active[i].maxx));
      }
      xCuts.sort((a, b) => a - b);
      const uniqueX = [];
      for (let i = 0; i < xCuts.length; i++) {
        if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
      }
      for (let xi = 0; xi < uniqueX.length - 1; xi++) {
        const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
        const midX = (x0 + x1) * 0.5;
        const insideHole = active.some((h) => midX >= h.minx && midX <= h.maxx);
        if (!insideHole && x1 - x0 > 0.01) {
          this.addBoxCollider(x0, -2, z0, x1, 0.0, z1);
        }
      }
    }

    // Slightly oversized side/top boundary walls.
    this.addBoxCollider(-thick, -2, -thick, 0, H + 2, D + thick);
    this.addBoxCollider(W, -2, -thick, W + thick, H + 2, D + thick);
    this.addBoxCollider(-thick, -2, -thick, W + thick, H + 2, 0);
    this.addBoxCollider(-thick, -2, D, W + thick, H + 2, D + thick);
    this.addBoxCollider(-thick, H, -thick, W + thick, H + 2, D + thick); // ceiling slab

    // Column colliders
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        if (this.getTile(x, z) !== TILE.COLUMN) continue;
        const w = this.tileToWorld(x, z);
        const r = 0.32;
        this.addBoxCollider(w.x - r, 0, w.z - r, w.x + r, H, w.z + r);
      }
    }
  },

  addBoxCollider(minx, miny, minz, maxx, maxy, maxz) {
    this.colliders.push({
      min: new THREE.Vector3(minx, miny, minz),
      max: new THREE.Vector3(maxx, maxy, maxz)
    });
  },

  buildMeshes(scene) {
    this.group = new THREE.Group();
    this.group.name = "LevelMeshes";
    const T = CONFIG.tile;
    const H = CONFIG.wallH;

    // One floor and one ceiling covering the playable bounds (few draw calls)
    const worldW = this.cols * T;
    const worldD = this.rows * T;
    const floorMap = Materials.carpet.map.clone();
    floorMap.repeat.set(worldW / 2, worldD / 2);
    floorMap.needsUpdate = true;
    const floorMat = Materials.carpet.clone();
    floorMat.map = floorMap;
    const addFloorRect = (minx, minz, maxx, maxz) => {
      const w = maxx - minx, d = maxz - minz;
      if (w < 0.05 || d < 0.05) return;
      const geo = new THREE.PlaneGeometry(w, d);
      const mesh = new THREE.Mesh(geo, floorMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((minx + maxx) * 0.5, 0, (minz + maxz) * 0.5);
      this.group.add(mesh);
    };
    const holes = Stairwell.exits.map((st) => st.hole).filter(Boolean);
    if (!holes.length) {
      addFloorRect(0, 0, worldW, worldD);
    } else {
      const zCuts = [0, worldD];
      for (let i = 0; i < holes.length; i++) {
        zCuts.push(Math.max(0, holes[i].minz), Math.min(worldD, holes[i].maxz));
      }
      zCuts.sort((a, b) => a - b);
      const uniqueZ = [];
      for (let i = 0; i < zCuts.length; i++) {
        if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
      }
      for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
        const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
        const midZ = (z0 + z1) * 0.5;
        const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
        const xCuts = [0, worldW];
        for (let i = 0; i < active.length; i++) {
          xCuts.push(Math.max(0, active[i].minx), Math.min(worldW, active[i].maxx));
        }
        xCuts.sort((a, b) => a - b);
        const uniqueX = [];
        for (let i = 0; i < xCuts.length; i++) {
          if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
        }
        for (let xi = 0; xi < uniqueX.length - 1; xi++) {
          const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
          const insideHole = active.some((h) => midZ >= h.minz && midZ <= h.maxz && ((x0+x1)*0.5) >= h.minx && ((x0+x1)*0.5) <= h.maxx);
          if (!insideHole && x1 - x0 > 0.05 && z1 - z0 > 0.05) addFloorRect(x0, z0, x1, z1);
        }
      }
    }
    // Ceiling, but with real vertical openings above the elevators.
    // This prevents the exit from becoming a low-ceiling tunnel and lets
    // the player descend naturally into the concrete structure.
    const ceilMap = Materials.ceiling.map.clone();
    ceilMap.repeat.set(worldW / 2, worldD / 2);
    ceilMap.needsUpdate = true;
    const ceilMat = Materials.ceiling.clone();
    ceilMat.map = ceilMap;
    const addCeilRect = (minx, minz, maxx, maxz) => {
      const w = maxx - minx, d = maxz - minz;
      if (w < 0.05 || d < 0.05) return;
      const geo = new THREE.PlaneGeometry(w, d);
      const mesh = new THREE.Mesh(geo, ceilMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set((minx + maxx) * 0.5, H, (minz + maxz) * 0.5);
      this.group.add(mesh);
    };
    if (!holes.length) {
      addCeilRect(0, 0, worldW, worldD);
    } else {
      const zCuts = [0, worldD];
      for (let i = 0; i < holes.length; i++) {
        zCuts.push(Math.max(0, holes[i].minz), Math.min(worldD, holes[i].maxz));
      }
      zCuts.sort((a, b) => a - b);
      const uniqueZ = [];
      for (let i = 0; i < zCuts.length; i++) {
        if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
      }
      for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
        const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
        const midZ = (z0 + z1) * 0.5;
        const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
        const xCuts = [0, worldW];
        for (let i = 0; i < active.length; i++) {
          xCuts.push(Math.max(0, active[i].minx), Math.min(worldW, active[i].maxx));
        }
        xCuts.sort((a, b) => a - b);
        const uniqueX = [];
        for (let i = 0; i < xCuts.length; i++) {
          if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
        }
        for (let xi = 0; xi < uniqueX.length - 1; xi++) {
          const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
          const insideHole = active.some((h) => midZ >= h.minz && midZ <= h.maxz && ((x0 + x1) * 0.5) >= h.minx && ((x0 + x1) * 0.5) <= h.maxx);
          if (!insideHole && x1 - x0 > 0.05 && z1 - z0 > 0.05) addCeilRect(x0, z0, x1, z1);
        }
      }
    }



    // Wall meshes from same merged regions as colliders (skip envelope)
    const used = [];
    for (let z = 0; z < this.rows; z++) used.push(new Array(this.cols).fill(false));
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        if (used[z][x] || !this.isSolidTile(this.getTile(x, z))) continue;
        let x2 = x;
        while (x2 + 1 < this.cols && this.isSolidTile(this.getTile(x2 + 1, z)) && !used[z][x2 + 1]) x2++;
        let z2 = z;
        let canGrow = true;
        while (canGrow && z2 + 1 < this.rows) {
          for (let xx = x; xx <= x2; xx++) {
            if (!this.isSolidTile(this.getTile(xx, z2 + 1)) || used[z2 + 1][xx]) { canGrow = false; break; }
          }
          if (canGrow) z2++;
        }
        for (let zz = z; zz <= z2; zz++) for (let xx = x; xx <= x2; xx++) used[zz][xx] = true;

        const sx = (x2 - x + 1) * T;
        const sz = (z2 - z + 1) * T;
        // Level 0 walls remain normal Backrooms wallpaper all the way to the elevator.
        // The elevator facade provides its own concrete surround; recoloring nearby
        // procedural wall runs was causing large black-looking slabs beside the exit.
        const wallMat = (((x + z) % 3 === 0) ? Materials.wallAlt : Materials.wall);
        const mesh = new THREE.Mesh(makeWorldBox(sx, H, sz, 0.5), wallMat);
        mesh.position.set((x + x2 + 1) * T * 0.5, H * 0.5, (z + z2 + 1) * T * 0.5);
        this.group.add(mesh);

        const trim = new THREE.Mesh(Geometries.box, Materials.wallTrim);
        trim.scale.set(sx + 0.03, 0.11, sz + 0.03);
        trim.position.set(mesh.position.x, 0.055, mesh.position.z);
        this.group.add(trim);

        const cap = new THREE.Mesh(Geometries.box, Materials.wallTrim);
        cap.scale.set(sx + 0.03, 0.06, sz + 0.03);
        cap.position.set(mesh.position.x, H - 0.03, mesh.position.z);
        this.group.add(cap);
      }
    }

    // Columns, frames, special pads
    for (let z = 0; z < this.rows; z++) {
      for (let x = 0; x < this.cols; x++) {
        const t = this.getTile(x, z);
        const w = this.tileToWorld(x, z);

        if (t === TILE.COLUMN) {
          const col = new THREE.Mesh(Geometries.column, Materials.column);
          col.position.set(w.x, H * 0.5, w.z);
          this.group.add(col);
        }
        if (t === TILE.START) {
          this.startPos.set(w.x, 0, w.z);
        }
        if (t === TILE.CHECK) {
          const pad = new THREE.Mesh(Geometries.box, Materials.checkpoint);
          pad.scale.set(1.6, 0.06, 1.6);
          pad.position.set(w.x, 0.03, w.z);
          this.group.add(pad);
          const cpId = "cp" + Checkpoints.list.filter((c) => c.id !== "start").length;
          this.triggers.push({ type: "checkpoint", id: cpId, minx: w.x - 1.2, maxx: w.x + 1.2, minz: w.z - 1.2, maxz: w.z + 1.2 });
          Checkpoints.register(cpId, new THREE.Vector3(w.x, 0, w.z), 0);
        }
      }
    }

    // IMPORTANT PERFORMANCE FIX:
    // Older revisions created a fluorescent fixture for roughly every
    // third walkable tile. In a 48x40 module world that can mean thousands
    // of THREE.Mesh objects, making startup appear frozen at 52%.
    // Lighting is now generated once per procedural module instead.
    // DARK modules receive no overhead fixtures at all.
    for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
      const mod = MapGraph.nodes[ni];
      if (!mod) continue;
      const profile = mod.lightProfile || "NORMAL";
      if (profile === "DARK") continue;

      const centerX = Math.floor(mod.gx + mod.w * 0.5) * LevelGenerator.CELL + 2;
      const centerZ = Math.floor(mod.gz + mod.h * 0.5) * LevelGenerator.CELL + 2;
      const candidates = [];

      // Use the module center and, for larger/bright modules, one or two
      // additional positions. Find actual walkable tiles before placing.
      candidates.push([centerX, centerZ]);
      if (profile === "BRIGHT" && (mod.w * mod.h >= 2)) {
        candidates.push([mod.gx * LevelGenerator.CELL + 2, mod.gz * LevelGenerator.CELL + 2]);
        if (mod.w * mod.h >= 4) {
          candidates.push([(mod.gx + mod.w - 1) * LevelGenerator.CELL + 3,
                           (mod.gz + mod.h - 1) * LevelGenerator.CELL + 3]);
        }
      }

      const usedLightTiles = [];
      for (let ci = 0; ci < candidates.length; ci++) {
        const tx = candidates[ci][0], tz = candidates[ci][1];
        if (!this.inBounds(tx, tz) || this.getTile(tx, tz) === TILE.WALL || this.getTile(tx, tz) === TILE.COLUMN) continue;
        let duplicate = false;
        for (let ui = 0; ui < usedLightTiles.length; ui++) {
          if (usedLightTiles[ui][0] === tx && usedLightTiles[ui][1] === tz) { duplicate = true; break; }
        }
        if (duplicate) continue;
        usedLightTiles.push([tx, tz]);
        const w = this.tileToWorld(tx, tz);
        const scale = profile === "BRIGHT" ? 1.22 : 0.98;
        const withPoint = profile === "BRIGHT" && LightingSystem.lights.length < 34;
        LightingSystem.addFluorescent(scene, w.x, H - 0.06, w.z, withPoint, scale);
      }
    }

    // ------------------------------------------------------------------
    // DARK FOG VOLUMES
    // ------------------------------------------------------------------
    // DARK modules are not just unlit rooms anymore. Each one gets a
    // translucent fog volume so the darkness reads as a physical pocket
    // of dense haze when viewed from outside. The material is deliberately
    // subtle so walls remain visible through it. A weak side tint is added
    // on connected sides that lead into a lit module, giving the fog a
    // slight sense of illumination without adding expensive volumetric fog.
    this.darkFogGroup = new THREE.Group();
    this.darkFogGroup.name = "Level0DarkFog";

    const darkFogMaterial = new THREE.MeshBasicMaterial({
      color: 0x17191c,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const darkFogEdgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x2a2d30,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const fogGlowMaterial = new THREE.MeshBasicMaterial({
      color: 0xb5b0a0,
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
      const mod = MapGraph.nodes[ni];
      if (!mod || mod.lightProfile !== "DARK") continue;

      const minX = mod.gx * LevelGenerator.CELL * T + 0.35;
      const minZ = mod.gz * LevelGenerator.CELL * T + 0.35;
      const width = Math.max(2, mod.w * LevelGenerator.CELL * T - 0.70);
      const depth = Math.max(2, mod.h * LevelGenerator.CELL * T - 0.70);
      const fogHeight = Math.max(2.8, H - 0.45);

      // Main volume. Slightly inset from the walls so it feels like haze
      // occupying the room rather than a black wall pasted over it.
      const volume = new THREE.Mesh(
        new THREE.BoxGeometry(width, fogHeight, depth),
        darkFogMaterial
      );
      volume.position.set(minX + width * 0.5, fogHeight * 0.5, minZ + depth * 0.5);
      this.darkFogGroup.add(volume);

      // A larger, much weaker shell softens the visible boundary from
      // outside the room.
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.8, fogHeight + 0.35, depth + 0.8),
        darkFogEdgeMaterial
      );
      edge.position.copy(volume.position);
      edge.position.y += 0.12;
      this.darkFogGroup.add(edge);

      // Connected modules are effectively doorways. Put a very subtle
      // lighter vertical sheet just inside the dark room on lit sides.
      // This makes the fog closest to a fluorescent-lit room look a little
      // less opaque on that side without turning the room bright.
      for (let ci = 0; ci < mod.connections.length; ci++) {
        const neighbor = MapGraph.nodes[mod.connections[ci]];
        if (!neighbor || neighbor.lightProfile === "DARK") continue;

        const dx = neighbor.gx - mod.gx;
        const dz = neighbor.gz - mod.gz;
        let glow;

        if (Math.abs(dx) >= Math.abs(dz) && dx !== 0) {
          const x = dx > 0 ? minX + width - 0.28 : minX + 0.28;
          glow = new THREE.Mesh(new THREE.PlaneGeometry(depth * 0.72, fogHeight * 0.72), fogGlowMaterial);
          glow.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2;
          glow.position.set(x, fogHeight * 0.52, minZ + depth * 0.5);
        } else if (dz !== 0) {
          const z = dz > 0 ? minZ + depth - 0.28 : minZ + 0.28;
          glow = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.72, fogHeight * 0.72), fogGlowMaterial);
          glow.rotation.y = dz > 0 ? 0 : Math.PI;
          glow.position.set(minX + width * 0.5, fogHeight * 0.52, z);
        }

        if (glow) this.darkFogGroup.add(glow);
      }
    }

    scene.add(this.darkFogGroup);

    // A small number of structural beams are placed per module instead of
    // per tile. This preserves the industrial ceiling language without
    // creating thousands of separate THREE.Mesh objects during startup.
    for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
      const mod = MapGraph.nodes[ni];
      if (!mod || mod.lightProfile === "DARK") continue;
      const tx = Math.floor(mod.gx + mod.w * 0.5) * LevelGenerator.CELL + 2;
      const tz = Math.floor(mod.gz + mod.h * 0.5) * LevelGenerator.CELL + 2;
      if (!this.inBounds(tx, tz) || this.getTile(tx, tz) === TILE.WALL || this.getTile(tx, tz) === TILE.COLUMN) continue;
      const w = this.tileToWorld(tx, tz);
      if (Stairwell.containsWorld(w.x, w.z)) continue;
      const beam = new THREE.Mesh(Geometries.beam, Materials.beam);
      beam.scale.set(T * Math.min(4.2, Math.max(2.0, mod.w * 1.8)), 1, T * 0.28);
      beam.position.set(w.x, H - 0.14, w.z);
      this.group.add(beam);
    }

    // Rare anomaly props (no gameplay effect)
    for (let i = 0; i < MapGraph.nodes.length; i++) {
      const n = MapGraph.nodes[i];
      if (n.anomaly !== "object" && n.anomaly !== "odd_door") continue;
      const w = this.tileToWorld(n.gx * LevelGenerator.CELL + 3, n.gz * LevelGenerator.CELL + 3);
      if (n.anomaly === "object") {
        const box = new THREE.Mesh(Geometries.box, Materials.frame);
        box.scale.set(0.7, 1.15, 0.45);
        box.position.set(w.x, 0.58, w.z);
        this.group.add(box);
      } else {
        const frame = new THREE.Mesh(Geometries.box, Materials.wallTrim);
        frame.scale.set(1.6, 2.4, 0.12);
        frame.position.set(w.x, 1.2, w.z);
        this.group.add(frame);
      }
    }

    scene.add(this.group);
  },

  buildHandcrafted(sceneRef) {
    this.buildProcedural(sceneRef, GameState.seed || 483921);
  },

  buildProcedural(sceneRef, seed) {
    const result = LevelGenerator.generateValid(seed, 160);
    if (!result) {
      console.warn("Procedural generation failed; retrying with a fresh seed");
      const retrySeed = ((seed ^ 0x9e3779b9) >>> 0);
      const retry = LevelGenerator.generateValid(retrySeed, 160);
      if (!retry) {
        const startSeed = document.getElementById("start-seed");
        if (startSeed) startSeed.textContent = "LEVEL 0 GENERATION FAILED — PRESS R TO RETRY";
        return false;
      }
      return this.buildProcedural(sceneRef, retry.seed);
    }
    GameState.seed = result.seed;
    Checkpoints.reset();
    this.clear(sceneRef);
    // Level 1 deliberately removes scene.fog. Recreate the Level 0 fog
    // before loading meshes so DARK/NORMAL/BRIGHT modules work again after
    // returning from Level 1 or pressing G to regenerate.
    if (sceneRef) {
      sceneRef.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
      sceneRef.background = new THREE.Color(CONFIG.fogColor);
    }
    this.loadGenerated(result);
    Stairwell.planFrom(result);
    this.buildColliders();
    this.buildMeshes(sceneRef);
    Stairwell.build(sceneRef);
    SpawnManager.apply(result);
    PickupSystem.generate(result.seed);
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(result.seed);
    const startSeed = document.getElementById("start-seed");
    if (startSeed) startSeed.textContent = "LEVEL 0 · SEED " + result.seed;
    return true;
  },

  queryTriggers(px, pz, fn) {
    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      if (px >= t.minx && px <= t.maxx && pz >= t.minz && pz <= t.maxz) fn(t);
    }
  }
};
