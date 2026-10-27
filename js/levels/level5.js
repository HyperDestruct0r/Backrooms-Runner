"use strict";

/* Level 5 — the Terror Hotel. Class 5.
   A kept 1930s hotel: patterned carpet, dark wood, warm low light. Not an office, not brick.

   Layout (from the seed, streamed by distance, same approach as Level 4):
     - a spine of 8 to 12 spaces on a 16 m lattice. The first is the lobby (wide, tall, bright),
       the last is a small landing with the way forward. Everything between is a hall.
     - halls are straight 3.6 m wide corridors with numbered doors on both walls. Almost all
       are closed and do nothing.
     - a few guest rooms open off the sides of halls (bed, side table, lamp). They dead-end.
     - up to two dead-end stub halls branch off the spine. They dead-end too.
   - three landmarks, so the hotel reads as a hotel. The lobby is a reception (desk, pigeonhole rack, chair, sign).
     A ballroom (one at most, off a hall at least four spaces along) and a dining room with a kitchen behind it
     (off another hall) are placed from the seed on free lattice cells. They are placed LAST, from their own random
     stream, and only if they clear every other space: the spine, the stubs, the guest rooms and the two real doors
     are exactly where they were without them. A landmark that does not fit is skipped.
   One way back, to the office: NOT in the lobby (that wall is blank, you arrived by it). It is a door in
   the hall two spaces along the spine, 30 m or more from the spawn. One way forward, at the far end
   (ends the run).

   Spawn is the exact centre of the lobby at baseY. The lobby has no door but the way into the hotel. Nothing is placed within 2.5 m of it.
   Lights are a fixed pool of point lights re-aimed at the nearest fixtures, so streaming never
   changes the light count and never forces a shader recompile. */
const Level5 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  segments: new Map(),
  nodes: [],
  edges: [],
  rooms: [],
  endNode: null,
  backNode: null,
  doors: [],
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  exitPos: null,      // just inside the forward door (console `level 5 exit`)
  backPos: null,      // just inside the back door
  landmarks: { ballroom: null, dining: null },
  ballPos: null,      // just inside the ballroom doors (console `level 5 ballroom`)
  dinePos: null,      // just inside the dining room (console `level 5 dining`)
  baseY: 0,
  S: 16,              // lattice spacing between space centres
  T: 0.3,             // wall thickness
  W: 3.6,             // hall width (interior)
  EH: 3.0,            // hall ceiling height
  ROOM: 5.0,          // guest room interior size
  DOOR_W: 2.4,        // cased opening into the ballroom (double doors) and the dining room
  DOOR_H: 2.5,
  KITCHEN: { w: 6.0, d: 5.0 },   // kitchen interior: across the dining wall x out from it
  DIRS: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  TYPES: {
    lobby: { R: 10, H: 4.4 },
    hall: { R: 3.6, H: 3.0 },
    end: { R: 5.0, H: 3.0 },
    nook: { R: 3.6, H: 3.0 },
    ballroom: { R: 12, H: 5.6 },
    dining: { R: 9, H: 3.0 }
  },
  shared: null,
  numMats: {},
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  // Warm and low. The lobby is lit by its chandelier; halls by a few pendants; rooms by a lamp.
  look: { ambient: 0.62, hemi: 0.34, poolSize: 8, fog: 0x15100c, fogNear: 6, fogFar: 42 },
  lastKey: "",
  infoText: "",
  time: 0,
  _poolT: 0,
  _sfxT: 14,
  _promptT: 0,
  _ended: false,

  hash(x, z, salt) {
    let h = (this.seed >>> 0) ^ Math.imul((x | 0) + (salt || 0), 0x45d9f3b) ^ Math.imul((z | 0) - (salt || 0), 0x27d4eb2d);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  /* ------------------------------------------------------------------
     GENERATION
     ------------------------------------------------------------------ */
  generate(seed) {
    for (let attempt = 0; attempt < 24; attempt++) {
      if (this._generate((seed + Math.imul(attempt, 7919)) >>> 0, false)) return;
    }
    this._generate(seed >>> 0, true);
  },

  setType(n, type) {
    n.type = type;
    n.R = this.TYPES[type].R;
    n.H = this.TYPES[type].H;
  },

  // Geometry of the hall between two linked spaces, centred on the clear span between them.
  edgeGeom(e) {
    return this._spanGeom(this.nodes[e.a], this.nodes[e.b], e.d);
  },

  // The same geometry for any two space-like objects {x, z, R}, linked or not (placement probes with it).
  _spanGeom(a, b, d) {
    const D = this.DIRS[d];
    const fa = a.R / 2 + this.T, fb = b.R / 2 + this.T;
    const L = this.S - fa - fb;
    const m = fa + L / 2;
    return { mx: a.x + D[0] * m, mz: a.z + D[1] * m, L, alongX: d % 2 === 0 };
  },

  _generate(seed, force) {
    const r = this.rng((seed ^ 0x7E57A1C5) >>> 0);
    const S = this.S, T = this.T, DIRS = this.DIRS;
    const cells = new Map(), nodes = [], edges = [];
    const key = (i, j) => i + "," + j;
    const addNode = (i, j, type) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, type: "", R: 0, H: 0,
        open: [false, false, false, false], edges: [], backSide: -1, arriveSide: -1, fwdSide: -1 };
      this.setType(n, type);
      nodes.push(n); cells.set(key(i, j), n); return n;
    };
    const link = (a, b, d) => {
      a.open[d] = true; b.open[(d + 2) % 4] = true;
      const e = { id: edges.length, a: a.id, b: b.id, d, room: null };
      edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
      return e;
    };

    // the spine starts long enough for the 750 m return. extend() grows it further.
    const count = 60;
    let cur = addNode(0, 0, "lobby"), last = -1;
    for (let k = 1; k < count; k++) {
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (!cells.has(key(cur.i + DIRS[d][0], cur.j + DIRS[d][1]))) opts.push(d);
      }
      if (!opts.length) { if (!force) return false; break; }
      const d = (last >= 0 && opts.indexOf(last) >= 0 && r() < 0.5) ? last : opts[Math.floor(r() * opts.length)];
      const nx = addNode(cur.i + DIRS[d][0], cur.j + DIRS[d][1], "hall");
      link(cur, nx, d);
      cur = nx; last = d;
    }
    if (nodes.length < 8 && !force) return false;
    const spineCount = nodes.length;

    // up to two dead-end stub halls
    let stubs = 0;
    for (let n = 1; n < spineCount - 1 && stubs < 2; n++) {
      if (r() >= 0.28) continue;
      const base = nodes[n], opts = [];
      for (let d = 0; d < 4; d++) {
        if (!cells.has(key(base.i + DIRS[d][0], base.j + DIRS[d][1]))) opts.push(d);
      }
      if (!opts.length) continue;
      const d = opts[Math.floor(r() * opts.length)];
      const side = addNode(base.i + DIRS[d][0], base.j + DIRS[d][1], "nook");
      link(base, side, d);
      stubs++;
    }

    // The lobby is where you arrive: its wall opposite the hall (arriveSide) has no door at all, and
    // that is the side the spawn faces away from. The way back to the office is NOT in the lobby: it is
    // a door on a closed wall of the hall two spaces along the spine. The way on: landing wall
    // opposite the hall.
    nodes[0].arriveSide = (nodes[0].open.indexOf(true) + 2) % 4;
    // return at ~750 m, forward at ~900 m
    const backStep = Math.min(nodes.length - 2, Math.round(750 / S));
    const fwdStep = Math.min(nodes.length - 1, Math.round(900 / S));
    const backN = nodes[backStep];
    const fwdN = nodes[fwdStep];
    this.setType(fwdN, "end");
    fwdN.fwdSide = (fwdN.open.indexOf(true) + 2) % 4;
    for (let k = 0; k < 4; k++) {
      const d = (backN.open.indexOf(true) + 2 + k) % 4;
      if (!backN.open[d]) { backN.backSide = d; break; }
    }
    this.backNode = backN;

    // guest rooms off the sides of halls. A room is placed only if its box clears every other space.
    const rects = [];
    const rectOf = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
    for (const n of nodes) {
      const f = n.R / 2 + T;
      rects.push({ owner: "n" + n.id, x0: n.x - f, x1: n.x + f, z0: n.z - f, z1: n.z + f });
    }
    const saved = this.nodes; this.nodes = nodes;      // edgeGeom reads this.nodes
    for (const e of edges) {
      const g = this.edgeGeom(e), hw = this.W / 2 + T;
      rects.push(Object.assign({ owner: "e" + e.id }, g.alongX
        ? rectOf(g.mx - g.L / 2, g.mx + g.L / 2, g.mz - hw, g.mz + hw)
        : rectOf(g.mx - hw, g.mx + hw, g.mz - g.L / 2, g.mz + g.L / 2)));
    }
    const q0 = this.W / 2 + T, q1 = q0 + this.ROOM + T, hp = this.ROOM / 2 + T;
    const roomRect = (g, s) => g.alongX
      ? rectOf(g.mx - hp, g.mx + hp, s > 0 ? g.mz + q0 : g.mz - q1, s > 0 ? g.mz + q1 : g.mz - q0)
      : rectOf(s > 0 ? g.mx + q0 : g.mx - q1, s > 0 ? g.mx + q1 : g.mx - q0, g.mz - hp, g.mz + hp);
    const clear = (rc, own) => {
      for (const o of rects) {
        if (o.owner === own) continue;
        if (rc.x0 < o.x1 + 0.4 && rc.x1 > o.x0 - 0.4 && rc.z0 < o.z1 + 0.4 && rc.z1 > o.z0 - 0.4) return false;
      }
      return true;
    };
    const rooms = [];
    const tryRoom = (e, prob) => {
      if (rooms.length >= 4 || e.room) return;
      if (nodes[e.a].type === "lobby" || nodes[e.b].type === "lobby") return;
      if (r() >= prob) return;
      const g = this.edgeGeom(e), s = r() < 0.5 ? -1 : 1;
      for (const side of [s, -s]) {
        const rc = roomRect(g, side);
        if (!clear(rc, "e" + e.id)) continue;
        e.room = { side };
        rc.owner = "r" + e.id; rects.push(rc);
        rooms.push(e);
        return;
      }
    };
    for (const e of edges) tryRoom(e, 0.45);
    for (let pass = 0; rooms.length < 2 && pass < 2; pass++) for (const e of edges) tryRoom(e, 1);
    this.nodes = saved;

    this.nodes = nodes;
    this.edges = edges;
    this.rooms = rooms;
    // landmarks last: own random stream, every probe checked against every rect above
    const lm = this.placeLandmarks({ seed, nodes, edges, cells, rects, addNode, link, backN, fwdN });
    const lobby = nodes[0], endN = fwdN;
    this.spawn.set(lobby.x, this.baseY, lobby.z);
    const bd = DIRS[lobby.arriveSide], fd = DIRS[endN.fwdSide], rd = DIRS[backN.backSide];
    // face into the hotel: away from the lobby's blank back wall (forward is (-sin yaw, -cos yaw))
    this.spawnYaw = Math.atan2(bd[0], bd[1]);
    this.backPos = new THREE.Vector3(backN.x + rd[0] * (backN.R / 2 - 1.2), this.baseY, backN.z + rd[1] * (backN.R / 2 - 1.2));
    this.exitPos = new THREE.Vector3(endN.x + fd[0] * (endN.R / 2 - 1.8), this.baseY, endN.z + fd[1] * (endN.R / 2 - 1.8));
    this.endNode = endN;
    this.landmarks = lm;
    this.ballPos = this.dinePos = null;
    for (const [nd, field, inset] of [[lm.ballroom, "ballPos", 2.2], [lm.dining, "dinePos", 1.6]]) {
      if (!nd) continue;
      const K = DIRS[nd.open.indexOf(true)];
      this[field] = new THREE.Vector3(nd.x + K[0] * (nd.R / 2 - inset), this.baseY, nd.z + K[1] * (nd.R / 2 - inset));
    }
    this.infoText = "SPACES " + spineCount + " · STUBS " + stubs + " · GUEST ROOMS " + rooms.length +
      " · BALLROOM " + (lm.ballroom ? "YES" : "NO") + " · DINING " + (lm.dining ? "YES" : "NO") + " · RETURN ~750m";
    this._route = nodes.filter(n => n.type === "hall" || n.type === "lobby" || n.type === "end");
    this._cells = cells;
    this._nodes = nodes;
    this._edges = edges;
    return true;
  },

  /* Ballroom, and dining room + kitchen. Each hangs off a spine hall on a free lattice cell, like a stub does, joined by an
     ordinary hall. The kitchen is an annex on one of the dining room's other three walls, like a guest room is on a hall.
     Draws come from a stream of their own, so the spine, stubs, guest rooms and both real doors do not move.
     Every probe is checked against every other space (rects) with the same 0.4 m margin guest rooms use. */
  placeLandmarks(c) {
    const { nodes, rects, addNode, link, backN, fwdN } = c;
    const T = this.T, W = this.W, S = this.S, DIRS = this.DIRS, KIT = this.KITCHEN;
    const r = this.rng((c.seed ^ 0x4C4D4B53) >>> 0);
    const out = { ballroom: null, dining: null };
    const rectOf = (x0, x1, z0, z1) => ({ x0, x1, z0, z1 });
    const clashes = (rc, o) => rc.x0 < o.x1 + 0.4 && rc.x1 > o.x0 - 0.4 && rc.z0 < o.z1 + 0.4 && rc.z1 > o.z0 - 0.4;
    const hit = (rc, skip, extra) => {
      for (const o of rects) { if (skip.indexOf(o.owner) < 0 && clashes(rc, o)) return true; }
      for (const o of extra || []) { if (clashes(rc, o)) return true; }
      return false;
    };
    const nodeRect = (n) => { const f = n.R / 2 + T; return rectOf(n.x - f, n.x + f, n.z - f, n.z + f); };
    const spanRect = (a, b, d) => {
      const g = this._spanGeom(a, b, d), hw = W / 2 + T;
      return g.alongX ? rectOf(g.mx - g.L / 2, g.mx + g.L / 2, g.mz - hw, g.mz + hw)
        : rectOf(g.mx - hw, g.mx + hw, g.mz - g.L / 2, g.mz + g.L / 2);
    };
    // the kitchen's footprint on side s of node n: across the wall by its width, out from the wall's outer face
    const annexRect = (n, s) => {
      const K = DIRS[s], o0 = n.R / 2 + T, o1 = o0 + KIT.d + T, hw = KIT.w / 2 + T;
      return K[0] !== 0
        ? rectOf(Math.min(n.x + K[0] * o0, n.x + K[0] * o1), Math.max(n.x + K[0] * o0, n.x + K[0] * o1), n.z - hw, n.z + hw)
        : rectOf(n.x - hw, n.x + hw, Math.min(n.z + K[1] * o0, n.z + K[1] * o1), Math.max(n.z + K[1] * o0, n.z + K[1] * o1));
    };
    // the host junction and every hall already meeting at it: the new hall touches them at the corners, by design
    const own = (h) => ["n" + h.id].concat(h.edges.map((id) => "e" + id));
    const free = (h, d) => !h.open[d] && !c.cells.has((h.i + DIRS[d][0]) + "," + (h.j + DIRS[d][1]));
    // hosts: spine halls only, never the way-back hall, and well short of the forward door
    const hi = Math.min(backN.id, fwdN.id) - 3;
    const candidates = (lo, top, skipId) => {
      const list = [];
      for (let k = lo; k <= Math.min(top, hi) && k < nodes.length; k++) {
        const h = nodes[k];
        if (h.type !== "hall" || h.id === skipId) continue;
        for (let d = 0; d < 4; d++) if (free(h, d)) list.push({ h, d });
      }
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t; }
      return list;
    };

    // ballroom: off a hall at least three spaces along, so at least four from the lobby
    let ballHost = -1;
    for (const { h, d } of candidates(3, 14, -1)) {
      const D = DIRS[d];
      const probe = { x: (h.i + D[0]) * S, z: (h.j + D[1]) * S, R: this.TYPES.ballroom.R };
      const nr = nodeRect(probe), er = spanRect(h, probe, d);
      if (hit(nr, []) || hit(er, own(h))) continue;
      const b = addNode(h.i + D[0], h.j + D[1], "ballroom");
      const e = link(h, b, d);
      nr.owner = "n" + b.id; er.owner = "e" + e.id;
      rects.push(nr, er);
      out.ballroom = b; ballHost = h.id;
      break;
    }

    // dining room, and its kitchen on one of the other three walls (seeded order). No kitchen, no dining room.
    for (const { h, d } of candidates(2, 22, ballHost)) {
      const D = DIRS[d];
      const probe = { x: (h.i + D[0]) * S, z: (h.j + D[1]) * S, R: this.TYPES.dining.R };
      const nr = nodeRect(probe), er = spanRect(h, probe, d);
      if (hit(nr, []) || hit(er, own(h))) continue;
      const sides = [d, (d + 1) % 4, (d + 3) % 4];            // the far wall and the two side walls: (d + 2) is the entrance
      for (let i = sides.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)), t = sides[i]; sides[i] = sides[j]; sides[j] = t; }
      let ks = -1, ar = null;
      for (const s of sides) {
        const rc = annexRect(probe, s);
        if (hit(rc, [], [er])) continue;
        ks = s; ar = rc; break;
      }
      if (ks < 0) continue;
      const dn = addNode(h.i + D[0], h.j + D[1], "dining");
      const e = link(h, dn, d);
      dn.kitchen = { side: ks };
      nr.owner = "n" + dn.id; er.owner = "e" + e.id; ar.owner = "a" + dn.id;
      rects.push(nr, er, ar);
      out.dining = dn;
      break;
    }
    return out;
  },

  /* ------------------------------------------------------------------
     TEXTURES (canvas, like the other levels)
     ------------------------------------------------------------------ */
  _canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  },

  _tex(c) {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  },

  _noise(seed) {
    let a = seed >>> 0 || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  // Hotel carpet: deep oxblood ground, gold diamond lattice, small medallions. 64 px period.
  carpetTex() {
    const N = 256, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    const rnd = this._noise(0x5ca1ab1e);
    const P = 64, h = P / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = x % P, py = y % P;
        const dx = Math.abs(px - h), dy = Math.abs(py - h), dd = dx + dy;
        let r = 40, gg = 12, b = 16;
        if (Math.abs(dd - 27) < 1.6) { r = 118; gg = 84; b = 44; }
        else if (Math.abs(dd - 20) < 1.2) { r = 104; gg = 22; b = 28; }
        else if (dd < 11) {
          if ((dx < 3 && dy < 9) || (dy < 3 && dx < 9)) { r = 112; gg = 34; b = 36; }
          else { r = 70; gg = 16; b = 22; }
        }
        const cx = Math.min(px, P - px), cy = Math.min(py, P - py);
        if (cx * cx + cy * cy < 9) { r = 108; gg = 78; b = 40; }
        const n = (rnd() - 0.5) * 16;
        const i = (y * N + x) * 4;
        d[i] = r + n; d[i + 1] = gg + n * 0.7; d[i + 2] = b + n * 0.7; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  // Wall: dark wood wainscot to 1.05 m, a chair rail, then dark green plaster, crown at the top.
  // One tile is 2 m wide and `hm` metres tall, so the wainscot never repeats up a tall wall.
  wallTex(hm) {
    const N = 256, Hp = Math.round(N * hm / 2), c = this._canvas(N, Hp), g = c.getContext("2d");
    const img = g.createImageData(N, Hp), d = img.data;
    const rnd = this._noise(0x0badf00d ^ Hp);
    const ppm = Hp / hm;
    for (let y = 0; y < Hp; y++) {
      const m = (Hp - y) / ppm;                 // metres above the floor
      for (let x = 0; x < N; x++) {
        let r, gg, b;
        if (m < 0.1) { r = 38; gg = 22; b = 14; }                             // skirting
        else if (m < 1.05) {                                                  // panelled wainscot
          const px = x % 128, pm = m - 0.1;
          const inPanel = px > 10 && px < 118 && pm > 0.1 && pm < 0.85;
          const edge = inPanel && (px < 15 || px > 113 || pm < 0.16 || pm > 0.79);
          const grain = Math.sin(x * 0.55 + Math.sin(y * 0.05) * 3) * 4;
          if (inPanel) { r = (edge ? 52 : 70) + grain; gg = (edge ? 30 : 42) + grain * 0.6; b = (edge ? 19 : 26) + grain * 0.4; }
          else { r = 56 + grain; gg = 33 + grain * 0.6; b = 21 + grain * 0.4; }
        } else if (m < 1.17) { r = 94; gg = 62; b = 38; }                     // chair rail
        else if (m > hm - 0.22) { r = 72; gg = 46; b = 29; }                  // crown
        else {                                                                // plaster
          const stripe = (x % 32 < 3) ? 4 : 0;
          const damask = (((x % 64) - 32) * ((x % 64) - 32) + ((y % 96) - 48) * ((y % 96) - 48) < 90) ? 5 : 0;
          r = 36 + stripe + damask; gg = 48 + stripe + damask; b = 40 + stripe + damask;
        }
        const n = (rnd() - 0.5) * 8;
        const i = (y * N + x) * 4;
        d[i] = r + n; d[i + 1] = gg + n; d[i + 2] = b + n; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  // Dark painted plaster ceiling.
  ceilTex() {
    const N = 128, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    const rnd = this._noise(0x0c317a11);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = (rnd() - 0.5) * 8;
        const i = (y * N + x) * 4;
        d[i] = 46 + v; d[i + 1] = 36 + v; d[i + 2] = 31 + v; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  rugTex() {
    const W = 256, Hh = 160, c = this._canvas(W, Hh), g = c.getContext("2d");
    g.fillStyle = "#4a1216"; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = "#9a7a3a"; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, Hh - 16);
    g.strokeStyle = "#2a0a0c"; g.lineWidth = 3; g.strokeRect(20, 20, W - 40, Hh - 40);
    g.fillStyle = "#6a1c20";
    g.beginPath(); g.moveTo(W / 2, 30); g.lineTo(W - 50, Hh / 2); g.lineTo(W / 2, Hh - 30); g.lineTo(50, Hh / 2); g.closePath(); g.fill();
    g.strokeStyle = "#b08c46"; g.lineWidth = 3; g.stroke();
    g.fillStyle = "#b08c46";
    g.beginPath(); g.arc(W / 2, Hh / 2, 12, 0, Math.PI * 2); g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  plaqueTex(text) {
    const c = this._canvas(256, 64), g = c.getContext("2d");
    g.fillStyle = "#8c6c34"; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = "#d2b068"; g.lineWidth = 3; g.strokeRect(4, 4, 248, 56);
    g.fillStyle = "#1c120a";
    g.font = "bold 30px serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  numberMat(n) {
    if (this.numMats[n]) return this.numMats[n];
    const c = this._canvas(128, 64), g = c.getContext("2d");
    g.fillStyle = "#9a7a3c"; g.fillRect(0, 0, 128, 64);
    g.strokeStyle = "#d8b870"; g.lineWidth = 3; g.strokeRect(3, 3, 122, 58);
    g.fillStyle = "#1c120a";
    g.font = "bold 40px serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(n), 64, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.1 });
    this.numMats[n] = m;
    return m;
  },

  pictureTex(k) {
    const W = 128, Hh = 96, c = this._canvas(W, Hh), g = c.getContext("2d");
    if (k === 0) {                       // dusk landscape
      g.fillStyle = "#3a2a3a"; g.fillRect(0, 0, W, Hh);
      g.fillStyle = "#8a5a3a"; g.fillRect(0, 40, W, 14);
      g.fillStyle = "#2a3a2a";
      g.beginPath(); g.moveTo(0, 96); g.lineTo(0, 60); g.lineTo(40, 48); g.lineTo(80, 64); g.lineTo(128, 52); g.lineTo(128, 96); g.closePath(); g.fill();
      g.fillStyle = "#d8b070"; g.beginPath(); g.arc(92, 30, 9, 0, Math.PI * 2); g.fill();
    } else if (k === 1) {                // portrait in an oval
      g.fillStyle = "#2a2018"; g.fillRect(0, 0, W, Hh);
      g.fillStyle = "#6a5440"; g.beginPath(); g.arc(64, 48, 36, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#b89878"; g.beginPath(); g.arc(64, 40, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#3a2a22"; g.fillRect(48, 56, 32, 30);
    } else {                             // still life
      g.fillStyle = "#2a2a22"; g.fillRect(0, 0, W, Hh);
      g.fillStyle = "#5a3a22"; g.fillRect(0, 64, W, 32);
      g.fillStyle = "#7a2a2a"; g.beginPath(); g.arc(46, 58, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#8a8a4a"; g.beginPath(); g.arc(78, 62, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#4a5a6a"; g.fillRect(92, 30, 14, 34);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  materialSet() {
    if (this.shared) return;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const wallHall = std({ map: this.wallTex(3.0), roughness: 0.9, metalness: 0 });
    wallHall.userData.tv = 3.0;
    const wallLobby = std({ map: this.wallTex(4.4), roughness: 0.9, metalness: 0 });
    wallLobby.userData.tv = 4.4;
    const decal = (map) => new THREE.MeshStandardMaterial({
      map, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    this.shared = {
      carpet: std({ map: this.carpetTex(), roughness: 1, metalness: 0 }),
      wallHall, wallLobby,
      ceil: std({ map: this.ceilTex(), roughness: 1, metalness: 0 }),
      beam: std({ color: 0x2c1a10, roughness: 0.8, metalness: 0 }),
      wood: std({ color: 0x3a2314, roughness: 0.7, metalness: 0 }),
      woodLight: std({ color: 0x5a3a22, roughness: 0.65, metalness: 0 }),
      brass: std({ color: 0xa88a48, roughness: 0.45, metalness: 0.15 }),
      doorLeaf: std({ color: 0x3b2417, roughness: 0.75, metalness: 0 }),
      doorPanel: std({ color: 0x2e1a10, roughness: 0.8, metalness: 0 }),
      doorFrame: std({ color: 0x24140c, roughness: 0.85, metalness: 0 }),
      fabric: std({ color: 0x5a1a1c, roughness: 1, metalness: 0 }),
      linen: std({ color: 0xcfc4b0, roughness: 1, metalness: 0 }),
      blanket: std({ color: 0x6a1f22, roughness: 1, metalness: 0 }),
      marble: std({ color: 0x8a8478, roughness: 0.4, metalness: 0 }),
      black: new THREE.MeshBasicMaterial({ color: 0x030303 }),
      lampOn: new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }),
      shade: std({ color: 0x8a6a3a, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }),
      rug: decal(this.rugTex()),
      pic: [0, 1, 2].map((k) => std({ map: this.pictureTex(k), roughness: 0.6, metalness: 0 })),
      plaqueBack: new THREE.MeshBasicMaterial({ map: this.plaqueTex("OFFICE") }),
      plaqueFwd: new THREE.MeshBasicMaterial({ map: this.plaqueTex("WAY ON") }),
      // the three landmark signs: made once here with the other two, never per room
      plaqueRecep: new THREE.MeshBasicMaterial({ map: this.plaqueTex("RECEPTION") }),
      plaqueBall: new THREE.MeshBasicMaterial({ map: this.plaqueTex("BALLROOM") }),
      plaqueDine: new THREE.MeshBasicMaterial({ map: this.plaqueTex("DINING") })
    };
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    this.sphGeo = new THREE.SphereGeometry(1, 12, 8);
    this.shadeGeo = new THREE.CylinderGeometry(0.5, 1, 1, 14, 1, true);
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    const wasActive = this.active;
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of this.segments.values()) this.disposeSegment(rec);
    this.segments.clear();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = [];
    this.poolFx = [];
    this.fixtures = [];
    this.colliders.length = 0;
    this.doors = [];
    this.nodes = [];
    this.edges = [];
    this.rooms = [];
    this.landmarks = { ballroom: null, dining: null };
    this.ballPos = this.dinePos = null;
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.time = 0;
    this._ended = false;
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();     // leaving or rebuilding Level 5 removes the Beast
    if (wasActive && typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") {
      CameraRig.camera.far = CONFIG.cameraFar;
      CameraRig.camera.updateProjectionMatrix();
    }
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos || []) g.dispose();
  },

  enter(seed, from) {
    // every other level goes first. Level 3 also resets Level 4, but both are named so the order is plain.
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);     // also empties Level 0's colliders
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.colliders.length = 0;
    this.seed = seed >>> 0;
    this.generate(this.seed);
    this.materialSet();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level5_Hotel";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0xd8b890, 0x2a1a12, lk.hemi);
    const amb = new THREE.AmbientLight(0xc8a888, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    for (let i = 0; i < lk.poolSize; i++) {
      const L = new THREE.PointLight(0xffc890, 0, 18, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 80; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 5;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = this.spawnYaw;
    Player.pitch = 0;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find the way on";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 5";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this.stream(true);
    this.assignLights();
    Player.position.copy(this.spawn);        // streaming never moves the player; the spawn is re-applied anyway
    Player.velocity.set(0, 0, 0);
    Player.yaw = this.spawnYaw;
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    this.attachEntities();
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 5 · THE HOTEL");
  },

  // One entity, and only one: the Beast (Entity 18). No Hound and no Smiler of Level 5's own.
  // (`/spawn hound` still works through attachSpare below.)
  attachEntities() {
    if (typeof HoundSystem !== "undefined") HoundSystem.detach();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.detach();
    if (typeof BeastSystem !== "undefined") {
      BeastSystem.attach({
        colliders: this.colliders, cap: 1, graceSeconds: 20, minDist: 25, maxDist: 40, seed: this.seed,
        avoid: (x, z, m) => this._inBallroom(x, z, m),
        canSpawn: (x, z) => this._beastMaySpawn(x, z)
      });
    }
  },

  // The Beast never enters the ballroom: its square (inside face of the walls, plus a margin).
  _inBallroom(x, z, m) {
    const b = this.landmarks && this.landmarks.ballroom;
    if (!b) return false;
    const h = b.R / 2 + this.T + (m || 0);
    return Math.abs(x - b.x) < h && Math.abs(z - b.z) < h;
  },

  // Where a natural Beast spawn is allowed: a space or a hall, never the lobby, never the ballroom.
  // Guest rooms and the kitchen are not spaces or halls, so it does not spawn in them either.
  _beastMaySpawn(x, z) {
    for (const n of this.nodes) {
      const h = n.R / 2 + this.T;
      if (Math.abs(x - n.x) < h && Math.abs(z - n.z) < h) return n.type !== "lobby" && n.type !== "ballroom";
    }
    const hw = this.W / 2 + this.T;
    for (const e of this.edges) {
      const g = this.edgeGeom(e);
      const ax = g.alongX ? g.L / 2 : hw, az = g.alongX ? hw : g.L / 2;
      if (Math.abs(x - g.mx) < ax && Math.abs(z - g.mz) < az) return true;
    }
    return false;
  },

  // For the console: attach a Hound that never spawns by itself, so /spawn hound can place one.
  attachSpare(kind) {
    if (kind === "hound" && typeof HoundSystem !== "undefined" && !HoundSystem.attached) {
      HoundSystem.attach({ colliders: this.colliders, cap: 0, graceSeconds: 1e9, minDist: 18, maxDist: 36, seed: this.seed });
    }
  },

  /* ------------------------------------------------------------------
     GEOMETRY HELPERS
     ------------------------------------------------------------------ */
  newRec() {
    return { group: new THREE.Group(), colliders: [], fixtures: [], doors: [], geos: [], edge: null };
  },

  // UVs from world position, so a texture runs on unbroken across wall pieces and rooms.
  // th: metres per tile horizontally. tv: metres per tile vertically.
  _uv(geo, cx, cy, cz, th, tv) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const wx = cx + pos.getX(i), wy = cy + pos.getY(i), wz = cz + pos.getZ(i);
      const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i));
      let u, v;
      if (ay > 0.5) { u = wx / th; v = wz / th; }
      else if (ax > 0.5) { u = wz / th; v = wy / tv; }
      else { u = wx / th; v = wy / tv; }
      uv.setXY(i, u, v);
    }
    uv.needsUpdate = true;
  },

  texBox(rec, mat, x, y, z, sx, sy, sz) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const tv = (mat.userData && mat.userData.tv) || 2;
    this._uv(geo, x, y, z, 2, tv);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    rec.group.add(m);
    rec.geos.push(geo);
    return m;
  },

  deco(rec, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    rec.group.add(m);
    return m;
  },

  collider(rec, x0, y0, z0, x1, y1, z1) {
    const c = { min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) };
    rec.colliders.push(c);
    return c;
  },

  solidBox(rec, mat, x, y, z, sx, sy, sz) {
    this.texBox(rec, mat, x, y, z, sx, sy, sz);
    return this.collider(rec, x - sx / 2, y - sy / 2, z - sz / 2, x + sx / 2, y + sy / 2, z + sz / 2);
  },

  cyl(rec, mat, x, y, z, r, h) {
    const m = new THREE.Mesh(this.cylGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(r, h, r);
    rec.group.add(m);
    return m;
  },

  sph(rec, mat, x, y, z, r) {
    const m = new THREE.Mesh(this.sphGeo, mat);
    m.position.set(x, y, z);
    m.scale.set(r, r, r);
    rec.group.add(m);
    return m;
  },

  // Box standing on a wall. (px, pz) is the point on the wall's inner face, (nx, nz) the normal into
  // the room, lat the offset along the wall. It sticks out `dep` from the face.
  wallBox(rec, mat, px, pz, nx, nz, lat, y, w, h, dep) {
    const lx = nz !== 0 ? 1 : 0, lz = nx !== 0 ? 1 : 0;
    return this.deco(rec, mat, px + nx * dep / 2 + lx * lat, y, pz + nz * dep / 2 + lz * lat,
      nx !== 0 ? dep : w, h, nx !== 0 ? w : dep);
  },

  wallPlane(rec, mat, px, pz, nx, nz, lat, y, w, h, dep) {
    const lx = nz !== 0 ? 1 : 0, lz = nx !== 0 ? 1 : 0;
    const m = new THREE.Mesh(this.planeGeo, mat);
    m.position.set(px + nx * dep + lx * lat, y, pz + nz * dep + lz * lat);
    m.rotation.y = Math.atan2(nx, nz);
    m.scale.set(w, h, 1);
    rec.group.add(m);
    return m;
  },

  // A framed picture on a wall.
  picture(rec, px, pz, nx, nz, lat, y, variant, w, h) {
    w = w || 0.9; h = h || 0.65;
    this.wallBox(rec, this.shared.brass, px, pz, nx, nz, lat, y, w + 0.12, h + 0.12, 0.05);
    this.wallPlane(rec, this.shared.pic[variant % 3], px, pz, nx, nz, lat, y, w, h, 0.056);
  },

  addFixture(rec, x, y, z, kind, base, dist, color) {
    rec.fixtures.push({ x, y, z, kind, base, dist, color, ph: this.hash(Math.round(x * 3), Math.round(z * 3), 3) * 40 });
  },

  // A hanging lamp: rod, shade, bulb, and one pooled light.
  pendant(rec, x, z, H, base, dist) {
    const S = this.shared;
    this.cyl(rec, S.brass, x, H - 0.2, z, 0.015, 0.4);
    const sh = new THREE.Mesh(this.shadeGeo, S.shade);
    sh.position.set(x, H - 0.5, z);
    sh.scale.set(0.3, 0.26, 0.3);
    rec.group.add(sh);
    this.sph(rec, S.lampOn, x, H - 0.55, z, 0.075);
    this.addFixture(rec, x, H - 0.62, z, "pendant", base, dist, 0xffc48a);
  },

  /* ------------------------------------------------------------------
     LIGHTS
     ------------------------------------------------------------------ */
  assignLights() {
    if (!this.pool.length) return;
    const p = Player.position;
    const cand = [];
    for (const f of this.fixtures) {
      const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z);
      if (d < 36 * 36) cand.push({ f, d });
    }
    cand.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const c = cand[i];
      this.poolFx[i] = c ? c.f : null;
      if (c) {
        const L = this.pool[i];
        L.position.set(c.f.x, c.f.y, c.f.z);
        L.distance = c.f.dist;
        if (L.color && L.color.setHex) L.color.setHex(c.f.color);
        L.intensity = c.f.base;
      } else this.pool[i].intensity = 0;
    }
  },

  /* ------------------------------------------------------------------
     SPACES (lobby, hall junctions, landing, stub ends)
     ------------------------------------------------------------------ */
  buildNode(node) {
    const key = "n" + node.id;
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    rec.edge = { ax: node.x, az: node.z, bx: node.x, bz: node.z };
    const S = this.shared, DIRS = this.DIRS, t = this.T, W = this.W;
    const R = node.R, H = node.H, cx = node.x, cz = node.z, full = R + 2 * t;
    const lobby = node.type === "lobby", ball = node.type === "ballroom", dine = node.type === "dining";
    const wallMat = (lobby || ball) ? S.wallLobby : S.wallHall;
    // landmark entrances are cased openings, not the full hall width. Everything else is cut exactly as before.
    const ow = (ball || dine) ? this.DOOR_W : W, oh = (ball || dine) ? this.DOOR_H : this.EH;
    const split = this.TYPES.lobby.H;      // the lobby wall texture is one tile, 4.4 m tall

    // floor (top face at y 0) and ceiling slab (underside at y H)
    this.texBox(rec, S.carpet, cx, -0.1, cz, full, 0.2, full);
    this.collider(rec, cx - full / 2, -0.5, cz - full / 2, cx + full / 2, 0.02, cz + full / 2);
    this.texBox(rec, S.ceil, cx, H + 0.1, cz, full, 0.2, full);
    this.collider(rec, cx - full / 2, H, cz - full / 2, cx + full / 2, H + 0.2, cz + full / 2);

    // walls one side at a time. x-facing sides own the corners. An open side is cut for a hall.
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d][0], dz = DIRS[d][1];
      const alongZ = dx !== 0;
      const L0 = alongZ ? -(R / 2 + t) : -R / 2, L1 = alongZ ? (R / 2 + t) : R / 2;
      const dist = R / 2 + t / 2;
      const at = (l, dd) => alongZ ? { x: cx + dx * dd, z: cz + l } : { x: cx + l, z: cz + dz * dd };
      const piece = (l0, l1, y0, y1) => {
        const len = l1 - l0;
        if (len < 0.01 || y1 - y0 < 0.01) return;
        const p = at((l0 + l1) / 2, dist), sx = alongZ ? t : len, sz = alongZ ? len : t;
        if (ball && y1 > split + 0.01) {
          // taller than one wall tile: the tile to 4.4 m, a plaster band above it. One collider for the whole piece.
          if (y0 < split - 0.01) {
            const cl = this.solidBox(rec, wallMat, p.x, (y0 + split) / 2, p.z, sx, split - y0, sz);
            cl.max.y = y1;
            this.texBox(rec, S.ceil, p.x, (split + y1) / 2, p.z, sx, y1 - split, sz);
          } else this.solidBox(rec, S.ceil, p.x, (y0 + y1) / 2, p.z, sx, y1 - y0, sz);
          return;
        }
        this.solidBox(rec, wallMat, p.x, (y0 + y1) / 2, p.z, sx, y1 - y0, sz);
      };
      if (node.open[d]) {
        piece(L0, -ow / 2, 0, H);
        piece(-ow / 2, ow / 2, oh, H);           // header over the opening (lobby, ballroom, dining; halls are EH tall)
        piece(ow / 2, L1, 0, H);
      } else if (dine && node.kitchen && node.kitchen.side === d) {
        piece(L0, -0.55, 0, H);                  // the door through to the kitchen
        piece(-0.55, 0.55, 2.2, H);
        piece(0.55, L1, 0, H);
      } else {
        piece(L0, L1, 0, H);
      }
    }

    if (lobby) this.dressLobby(rec, node);
    else if (node.type === "end") this.dressLanding(rec, node);
    else if (ball) this.dressBallroom(rec, node);
    else if (dine) this.dressDining(rec, node);
    else this.dressJunction(rec, node);

    if (node.backSide >= 0) this.buildDoor(rec, node, node.backSide, "back");     // only the hall two spaces in
    if (node.fwdSide >= 0) this.buildDoor(rec, node, node.fwdSide, "forward");
    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  // Chandelier: rod, ring, hub, candle bulbs, one pooled light.
  chandelier(rec, x, z, H, base, dist, candles) {
    const S = this.shared, chY = H - 0.9, n = candles || 8;
    this.cyl(rec, S.brass, x, H - 0.45, z, 0.02, 0.9);
    this.cyl(rec, S.brass, x, chY, z, 0.75, 0.05);
    this.cyl(rec, S.brass, x, chY - 0.12, z, 0.12, 0.2);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      this.sph(rec, S.lampOn, x + Math.cos(a) * 0.72, chY + 0.1, z + Math.sin(a) * 0.72, 0.07);
    }
    this.sph(rec, S.lampOn, x, chY - 0.28, z, 0.12);
    this.addFixture(rec, x, chY - 0.1, z, "chandelier", base, dist, 0xffc890);
  },

  // A table lamp standing on a surface whose top is at y0.
  tableLamp(rec, x, y0, z) {
    const S = this.shared;
    this.cyl(rec, S.brass, x, y0 + 0.1, z, 0.06, 0.2);
    const sh = new THREE.Mesh(this.shadeGeo, S.shade);
    sh.position.set(x, y0 + 0.34, z); sh.scale.set(0.15, 0.2, 0.15); rec.group.add(sh);
    this.sph(rec, S.lampOn, x, y0 + 0.3, z, 0.05);
    this.addFixture(rec, x, y0 + 0.5, z, "lamp", 1.4, 8, 0xffb070);
  },

  // A frame for dressing one space. a runs along K (toward the open side), l runs across it. K is axis-aligned, so a box
  // sized (da, dl) lands exactly on x and z. Only the shared box/cylinder/sphere geometry and shared materials are used.
  frame(rec, cx, cz, K) {
    const L = this, ux = K[0], uz = K[1], vx = -uz, vz = ux;
    const P = (a, l) => ({ x: cx + ux * a + vx * l, z: cz + uz * a + vz * l });
    const dims = (da, dl) => ux !== 0 ? [da, dl] : [dl, da];
    return {
      rec, ux, uz, vx, vz, P,
      box(mat, a, y, l, da, h, dl) { const p = P(a, l), d = dims(da, dl); return L.deco(rec, mat, p.x, y, p.z, d[0], h, d[1]); },
      tex(mat, a, y, l, da, h, dl) { const p = P(a, l), d = dims(da, dl); return L.texBox(rec, mat, p.x, y, p.z, d[0], h, d[1]); },
      solid(mat, a, y, l, da, h, dl) { const p = P(a, l), d = dims(da, dl); return L.solidBox(rec, mat, p.x, y, p.z, d[0], h, d[1]); },
      col(a, l, da, dl, y0, y1) {
        const p = P(a, l), d = dims(da, dl);
        return L.collider(rec, p.x - d[0] / 2, y0, p.z - d[1] / 2, p.x + d[0] / 2, y1, p.z + d[1] / 2);
      },
      cyl(mat, a, y, l, r, h) { const p = P(a, l); return L.cyl(rec, mat, p.x, y, p.z, r, h); },
      sph(mat, a, y, l, r) { const p = P(a, l); return L.sph(rec, mat, p.x, y, p.z, r); },
      wall(a, l, na, nl) { const p = P(a, l); return { px: p.x, pz: p.z, nx: ux * na + vx * nl, nz: uz * na + vz * nl }; },
      picture(a, l, na, nl, y, variant, w, h) { const q = this.wall(a, l, na, nl); L.picture(rec, q.px, q.pz, q.nx, q.nz, 0, y, variant, w, h); },
      pendant(a, l, H, base, dist) { const p = P(a, l); L.pendant(rec, p.x, p.z, H, base, dist); },
      lamp(a, y0, l) { const p = P(a, l); L.tableLamp(rec, p.x, y0, p.z); }
    };
  },

  // A dining chair at (a, l) facing (fa, fl): seat block and an upholstered back on the far side. Two meshes.
  chair(F, a, l, fa, fl) {
    const S = this.shared;
    F.box(S.woodLight, a, 0.22, l, 0.46, 0.44, 0.46);
    F.box(S.fabric, a - fa * 0.2, 0.74, l - fl * 0.2, fa ? 0.06 : 0.46, 0.56, fl ? 0.06 : 0.46);
  },

  // A round table in a floor-length cloth with a candle, and four chairs (skip: a direction to leave the chair out).
  // The collider covers the table and its chairs in one box, so nobody snags on a chair back.
  roundTable(F, a, l, skip) {
    const S = this.shared;
    F.cyl(S.linen, a, 0.38, l, 0.7, 0.76);
    F.cyl(S.blanket, a, 0.768, l, 0.42, 0.016);
    F.cyl(S.brass, a, 0.81, l, 0.05, 0.08);
    F.sph(S.lampOn, a, 0.88, l, 0.035);
    for (const [da, dl] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (skip && skip[0] === da && skip[1] === dl) continue;
      this.chair(F, a + da * 0.98, l + dl * 0.98, -da, -dl);
    }
    F.col(a, l, 2.5, 2.5, 0, 0.95);
  },

  // The cased opening in a landmark's wall on its open side: jambs, a head, a sign on the hall side. Double leaves for the ballroom.
  entrance(F, node, plaque, leaves) {
    const S = this.shared, t = this.T, hw = node.R / 2, ow = this.DOOR_W, dh = this.DOOR_H;
    for (const sg of [-1, 1]) F.box(S.doorFrame, hw + t / 2, dh / 2, sg * (ow / 2 + 0.06), t + 0.06, dh, 0.12);
    F.box(S.doorFrame, hw + t / 2, dh - 0.07, 0, t + 0.06, 0.14, ow + 0.24);
    const p = F.P(hw + t, 0);
    this.wallPlane(F.rec, plaque, p.x, p.z, F.ux, F.uz, 0, 2.78, 0.9, 0.2, 0.012);
    if (!leaves) return;
    // two leaves thrown back into the room, square to the wall, either side of the opening
    for (const sg of [-1, 1]) {
      const lc = sg * (ow / 2 - 0.04), ac = hw - 0.58;
      F.box(S.doorLeaf, ac, 1.22, lc, 1.16, 2.4, 0.06);
      for (const py of [0.75, 1.7]) F.box(S.doorPanel, ac, py, lc - sg * 0.04, 0.8, 0.7, 0.04);
      F.box(S.brass, hw - 1.05, 1.15, lc - sg * 0.05, 0.1, 0.08, 0.1);
      F.col(ac, lc, 1.16, 0.08, 0, 2.4);
    }
  },

  // Coffer beams over a room: a grid of dark wood across the ceiling.
  coffers(rec, cx, cz, R, H, step) {
    const S = this.shared, n = Math.floor(R / step);
    for (let i = 0; i < n; i++) {
      const o = -R / 2 + (i + 0.5) * R / n;
      this.deco(rec, S.beam, cx + o, H - 0.1, cz, 0.28, 0.2, R);
      this.deco(rec, S.beam, cx, H - 0.1, cz + o, R, 0.2, 0.28);
    }
  },

  dressLobby(rec, node) {
    const S = this.shared, DIRS = this.DIRS;
    const R = node.R, H = node.H, cx = node.x, cz = node.z;
    const o = DIRS[node.open.indexOf(true)];             // toward the hotel
    const ux = o[0], uz = o[1], vx = -uz, vz = ux;
    const P = (u, v) => ({ x: cx + ux * u + vx * v, z: cz + uz * u + vz * v });
    const dimX = (du, dv) => ux !== 0 ? du : dv, dimZ = (du, dv) => ux !== 0 ? dv : du;
    const box = (mat, u, v, y, du, h, dv) => {
      const p = P(u, v);
      return this.deco(rec, mat, p.x, y, p.z, dimX(du, dv), h, dimZ(du, dv));
    };
    const col = (u, v, du, dv, y0, y1) => {
      const p = P(u, v), sx = dimX(du, dv), sz = dimZ(du, dv);
      this.collider(rec, p.x - sx / 2, y0, p.z - sz / 2, p.x + sx / 2, y1, p.z + sz / 2);
    };
    const wall = (u, v, nu, nv) => {                     // point on a wall + its normal, in world terms
      const p = P(u, v);
      return { px: p.x, pz: p.z, nx: ux * nu + vx * nv, nz: uz * nu + vz * nv };
    };

    this.coffers(rec, cx, cz, R, H, 2.5);

    // rug, centred on the spawn. A flat decal, no collider.
    const rp = P(0, 0), rug = new THREE.Mesh(this.planeGeo, S.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(rp.x, 0.03, rp.z);
    rug.scale.set(dimX(5.2, 3.4), dimZ(5.2, 3.4), 1);
    rec.group.add(rug);

    // chandelier over the middle of the room: ring, arms, candle bulbs
    this.chandelier(rec, cx, cz, H, 7.5, 26, 8);

    // sofa against one side wall
    box(S.fabric, -1.6, 4.35, 0.225, 2.4, 0.45, 0.95);
    box(S.fabric, -1.6, 4.715, 0.7, 2.4, 0.5, 0.22);
    box(S.fabric, -2.7, 4.35, 0.6, 0.2, 0.3, 0.95);
    box(S.fabric, -0.5, 4.35, 0.6, 0.2, 0.3, 0.95);
    col(-1.6, 4.35, 2.4, 0.95, 0, 0.95);

    // round table with two chairs, in the far corner from the doors
    const tu = -2.6, tv = -3.0;
    const tp = P(tu, tv);
    this.cyl(rec, S.marble, tp.x, 0.72, tp.z, 0.65, 0.06);
    this.cyl(rec, S.wood, tp.x, 0.36, tp.z, 0.09, 0.7);
    this.cyl(rec, S.wood, tp.x, 0.03, tp.z, 0.36, 0.06);
    col(tu, tv, 1.3, 1.3, 0, 0.78);
    for (const dv of [-1.2, 1.2]) {
      box(S.woodLight, tu, tv + dv, 0.22, 0.5, 0.44, 0.5);
      box(S.fabric, tu, tv + dv, 0.47, 0.46, 0.08, 0.46);
      box(S.woodLight, tu, tv + dv + (dv > 0 ? 0.22 : -0.22), 0.78, 0.46, 0.55, 0.06);
      col(tu, tv + dv, 0.5, 0.5, 0, 0.95);
    }

    // pictures
    // the blank back wall: no door here. A large picture hangs where one might be expected.
    let w = wall(-R / 2, 0, 1, 0);    this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.1, 1, 1.2, 0.9);
    w = wall(-R / 2, 3.2, 1, 0);      this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.0, 0, 1.0, 0.72);
    w = wall(-R / 2, -3.2, 1, 0);     this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.0, 1, 0.7, 0.9);
    w = wall(2.4, -R / 2, 0, 1);      this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.0, 2, 1.1, 0.75);
    w = wall(1.6, R / 2, 0, -1);      this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.0, 0, 1.3, 0.8);

    // wall sconces flanking the back door and the way into the hotel
    const sconce = (u, v, nu, nv) => {
      const s = wall(u, v, nu, nv);
      this.wallBox(rec, S.brass, s.px, s.pz, s.nx, s.nz, 0, 2.15, 0.14, 0.3, 0.1);
      this.wallBox(rec, S.lampOn, s.px, s.pz, s.nx, s.nz, 0, 2.38, 0.1, 0.12, 0.14);
    };
    sconce(-R / 2, 1.9, 1, 0); sconce(-R / 2, -1.9, 1, 0);
    sconce(R / 2, 2.6, -1, 0); sconce(R / 2, -2.6, -1, 0);
    const f1 = P(-R / 2 + 0.7, 0), f2 = P(R / 2 - 0.7, 0);
    this.addFixture(rec, f1.x, 2.3, f1.z, "sconce", 2.0, 11, 0xffb878);
    this.addFixture(rec, f2.x, 2.3, f2.z, "sconce", 1.8, 11, 0xffb878);

    // RECEPTION. On the flank of the wall that holds the way into the hotel, so it is in view from the spawn: a pigeonhole
    // rack on the wall, the desk facing the room, the clerk's chair between them, a sign. Nothing within 3.3 m of the spawn.
    const rv = -3.4;
    box(S.doorFrame, R / 2 - 0.07, rv, 1.45, 0.14, 1.0, 2.2);                // dark back of the rack
    const rows = 4, cols = 6;
    for (let k = 0; k <= rows; k++) box(S.woodLight, R / 2 - 0.08, rv, 0.97 + k * 0.245, 0.16, 0.04, 2.24);
    for (let k = 0; k <= cols; k++) box(S.woodLight, R / 2 - 0.08, rv - 1.1 + k * (2.2 / cols), 1.45, 0.16, 1.0, 0.03);
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      if (this.hash(rr, cc, 71) > 0.4) continue;                               // a key in some of the pigeonholes
      box(S.brass, R / 2 - 0.12, rv - 1.1 + (cc + 0.5) * (2.2 / cols), 1.0 + rr * 0.245 + 0.1, 0.03, 0.11, 0.03);
    }
    // the desk: wood body, marble top, panelled front, solid
    box(S.wood, R / 2 - 1.3, rv, 0.5, 0.7, 1.0, 2.6);
    box(S.marble, R / 2 - 1.3, rv, 1.03, 0.86, 0.06, 2.8);
    for (const dv of [-0.9, 0, 0.9]) box(S.woodLight, R / 2 - 1.67, rv + dv, 0.5, 0.04, 0.6, 0.7);
    col(R / 2 - 1.3, rv, 0.86, 2.8, 0, 1.06);
    // on the desk: lamp, bell, ledger
    const lp = P(R / 2 - 0.95, rv - 0.85);
    this.tableLamp(rec, lp.x, 1.06, lp.z);
    const bp = P(R / 2 - 1.55, rv + 0.5);
    this.cyl(rec, S.brass, bp.x, 1.09, bp.z, 0.06, 0.04);
    this.sph(rec, S.brass, bp.x, 1.12, bp.z, 0.025);
    box(S.blanket, R / 2 - 1.4, rv - 0.3, 1.09, 0.3, 0.05, 0.4);
    box(S.linen, R / 2 - 1.4, rv - 0.3, 1.12, 0.26, 0.02, 0.36);
    // the clerk's chair behind it, back to the rack
    box(S.woodLight, R / 2 - 0.5, rv, 0.22, 0.5, 0.44, 0.5);
    box(S.fabric, R / 2 - 0.5, rv, 0.47, 0.46, 0.08, 0.46);
    box(S.woodLight, R / 2 - 0.28, rv, 0.78, 0.06, 0.55, 0.46);
    col(R / 2 - 0.5, rv, 0.5, 0.5, 0, 0.95);
    // the sign, over the rack
    const rs = wall(R / 2, rv, -1, 0);
    this.wallPlane(rec, S.plaqueRecep, rs.px, rs.pz, rs.nx, rs.nz, 0, 2.5, 0.9, 0.225, 0.01);
  },

  // The ballroom: 12 x 12 m, 5.6 m high, cased double doors on its one open side. A raised parquet dance floor in a brass
  // inlay, a stage with a piano and drapes at the far end, tables down both sides, pilasters, three chandeliers.
  // a runs from the middle toward the doors (+6), l across.
  dressBallroom(rec, node) {
    const S = this.shared, DIRS = this.DIRS;
    const R = node.R, H = node.H, cx = node.x, cz = node.z, h = R / 2;
    const F = this.frame(rec, cx, cz, DIRS[node.open.indexOf(true)]);
    this.coffers(rec, cx, cz, R, H, 3.0);
    for (const sg of [-1, 1]) {                                   // cornice
      F.box(S.beam, sg * (h - 0.11), H - 0.13, 0, 0.22, 0.26, R);
      F.box(S.beam, 0, H - 0.13, sg * (h - 0.11), R, 0.26, 0.22);
    }
    this.entrance(F, node, S.plaqueBall, true);

    // dance floor: parquet a few cm proud of the carpet (visual only), brass inlay round it
    F.box(S.woodLight, 0, 0.02, 0, 7.0, 0.04, 6.0);
    for (const sg of [-1, 1]) {
      F.box(S.brass, sg * 3.47, 0.04, 0, 0.06, 0.016, 6.06);
      F.box(S.brass, 0, 0.04, sg * 2.97, 7.0, 0.016, 0.06);
    }
    // stage across the far wall: wood body, trim, brass edge. 0.33 m up: a jump, not a walk.
    F.box(S.wood, -4.99, 0.165, 0, 2.0, 0.33, 7.0);
    F.box(S.woodLight, -4.99, 0.318, 0, 2.04, 0.03, 7.04);
    F.box(S.brass, -3.98, 0.2, 0, 0.04, 0.06, 7.0);
    F.col(-4.99, 0, 2.0, 7.0, 0, 0.33);
    // piano on the stage, stool, drapes and valance behind
    F.box(S.wood, -5.6, 0.955, -1.7, 0.7, 1.25, 1.5);
    F.box(S.linen, -5.2, 1.05, -1.7, 0.16, 0.04, 1.4);
    F.box(S.fabric, -4.6, 0.555, -1.7, 0.4, 0.45, 0.4);
    F.col(-5.55, -1.7, 0.8, 1.6, 0.33, 1.6);
    for (const sg of [-1, 1]) F.box(S.blanket, -h + 0.06, 2.5, sg * 3.1, 0.12, 4.4, 1.2);
    F.box(S.blanket, -h + 0.06, 4.6, 0, 0.12, 0.6, 7.4);
    for (const sg of [-1, 1]) {                                   // stage sconces, and their pooled light
      F.box(S.brass, -h + 0.06, 2.6, sg * 4.2, 0.12, 0.3, 0.14);
      F.box(S.lampOn, -h + 0.1, 2.83, sg * 4.2, 0.1, 0.12, 0.1);
      const p = F.P(-h + 0.7, sg * 4.2);
      this.addFixture(rec, p.x, 2.7, p.z, "sconce", 2.2, 12, 0xffb878);
    }
    // chandeliers down the middle
    for (const a of [-3.0, 0, 3.0]) { const p = F.P(a, 0); this.chandelier(rec, p.x, p.z, H, a === 0 ? 8 : 6.5, 24, 6); }
    // tables down both sides
    for (const sg of [-1, 1]) for (const a of [-1.6, 2.4]) this.roundTable(F, a, sg * 4.3);
    // pilasters and pictures along the side walls
    for (const sg of [-1, 1]) {
      for (const a of [-4.2, -1.4, 1.4, 4.2]) F.box(S.beam, a, 2.15, sg * (h - 0.07), 0.5, 4.3, 0.14);
      [-2.8, 0, 2.8].forEach((a, i) => F.picture(a, sg * h, 0, -sg, 2.7, i + (sg > 0 ? 1 : 0), 1.4, 1.0));
    }
  },

  // The dining room: 9 x 9 m, four round tables with four chairs each leaving a cross of aisle, a sideboard, pendants over the
  // tables. A door in one of the other three walls leads to the kitchen.
  dressDining(rec, node) {
    const S = this.shared, DIRS = this.DIRS;
    const R = node.R, H = node.H, cx = node.x, cz = node.z, h = R / 2;
    const F = this.frame(rec, cx, cz, DIRS[node.open.indexOf(true)]);
    const KK = DIRS[node.kitchen.side];
    const ka = KK[0] * F.ux + KK[1] * F.uz, kl = KK[0] * F.vx + KK[1] * F.vz;   // which wall, in (a, l)
    this.coffers(rec, cx, cz, R, H, 3.0);
    this.entrance(F, node, S.plaqueDine, false);
    for (const [a, l] of [[-2.4, -2.4], [-2.4, 2.4], [2.4, -2.4], [2.4, 2.4]]) {
      this.roundTable(F, a, l);
      F.pendant(a, l, H, 3.0, 14);
    }
    // sideboard centred on the first of far / left / right that is not the kitchen's wall
    let sw = null;
    for (const w of [[-1, 0], [0, 1], [0, -1]]) if (!(w[0] === ka && w[1] === kl)) { sw = w; break; }
    const sa = sw[0] * (h - 0.27), sl = sw[1] * (h - 0.27), alongL = sw[0] !== 0;
    const da = alongL ? 0.5 : 2.4, dl = alongL ? 2.4 : 0.5;
    F.box(S.wood, sa, 0.45, sl, da, 0.9, dl);
    F.box(S.woodLight, sa, 0.92, sl, da + 0.04, 0.04, dl + 0.04);
    F.col(sa, sl, da, dl, 0, 0.95);
    F.lamp(sa + (alongL ? 0 : 0.8), 0.94, sl + (alongL ? 0.8 : 0));
    // pictures: one over the sideboard, two on each other wall, kept off the kitchen door
    let v = 0;
    for (const w of [[-1, 0], [0, 1], [0, -1], [1, 0]]) {
      const isSide = w[0] === sw[0] && w[1] === sw[1];
      const offs = isSide ? [0] : [-2.6, 2.6];
      for (const o of offs) {
        const a = w[0] !== 0 ? w[0] * h : o, l = w[0] !== 0 ? o : w[1] * h;
        F.picture(a, l, -w[0], -w[1], isSide ? 1.95 : 1.9, v++, isSide ? 1.3 : 0.9, isSide ? 0.9 : 0.65);
      }
    }
    this.buildKitchen(rec, node);
  },

  // The kitchen: an annex on the dining room's wall, 6 m across and 5 m out. Marble floor and tile band, a range with a hood,
  // a prep island with a pot rack, a counter with a sink, a cabinet with shelves. The door is open against its near wall.
  buildKitchen(rec, node) {
    const S = this.shared, t = this.T, H = node.H, KIT = this.KITCHEN;
    const F = this.frame(rec, node.x, node.z, this.DIRS[node.kitchen.side]);
    const a0 = node.R / 2 + t, kd = KIT.d, kw = KIT.w, a1 = a0 + kd, hl = kw / 2, full = kw + 2 * t, len = kd + t;
    const ac = a0 + len / 2;
    F.tex(S.marble, ac, -0.1, 0, len, 0.2, full);
    F.col(ac, 0, len, full, -0.5, 0.02);
    F.tex(S.ceil, ac, H + 0.1, 0, len, 0.2, full);
    F.col(ac, 0, len, full, H, H + 0.2);
    for (const sg of [-1, 1]) F.solid(S.wallHall, a0 + kd / 2, H / 2, sg * (hl + t / 2), kd, H, t);
    F.solid(S.wallHall, a1 + t / 2, H / 2, 0, t, H, full);
    // door: frame in the dining wall, leaf open against the kitchen side
    for (const sg of [-1, 1]) F.box(S.doorFrame, node.R / 2 + t / 2, 1.12, sg * 0.6, t + 0.04, 2.24, 0.1);
    F.box(S.doorFrame, node.R / 2 + t / 2, 2.25, 0, t + 0.04, 0.1, 1.3);
    F.box(S.doorLeaf, a0 + 0.5, 1.04, -0.72, 0.95, 2.08, 0.06);
    // tile band
    for (const sg of [-1, 1]) {
      F.box(S.marble, a0 + kd / 2, 0.75, sg * (hl - 0.02), kd, 1.5, 0.04);
      F.box(S.marble, a0 + 0.02, 0.75, sg * 1.83, 0.04, 1.5, 2.34);
    }
    F.box(S.marble, a1 - 0.02, 0.75, 0, 0.04, 1.5, kw);
    // range on the far wall, hood and flue
    F.box(S.black, a1 - 0.4, 0.45, 0, 0.75, 0.9, 1.7);
    F.col(a1 - 0.4, 0, 0.75, 1.7, 0, 0.92);
    for (const [da, dl] of [[-0.17, -0.45], [-0.17, 0.45], [0.17, -0.45], [0.17, 0.45]]) F.cyl(S.brass, a1 - 0.4 + da, 0.92, dl, 0.1, 0.02);
    F.cyl(S.brass, a1 - 0.57, 1.02, -0.45, 0.13, 0.2);
    F.cyl(S.brass, a1 - 0.23, 1.0, 0.45, 0.11, 0.16);
    F.box(S.brass, a1 - 0.35, 2.1, 0, 0.8, 0.5, 1.8);
    F.box(S.brass, a1 - 0.2, 2.675, 0, 0.35, 0.65, 0.4);
    // prep island
    F.box(S.wood, a0 + 2.1, 0.44, 0, 0.9, 0.88, 2.2);
    F.box(S.marble, a0 + 2.1, 0.905, 0, 0.98, 0.05, 2.3);
    F.box(S.woodLight, a0 + 2.1, 0.94, 0.5, 0.35, 0.03, 0.5);
    F.col(a0 + 2.1, 0, 0.98, 2.3, 0, 0.93);
    F.box(S.brass, a0 + 2.1, 2.3, 0, 0.05, 0.05, 1.8);
    for (const l of [-0.6, 0, 0.6]) { F.cyl(S.brass, a0 + 2.1, 2.2, l, 0.01, 0.2); F.cyl(S.brass, a0 + 2.1, 2.02, l, 0.09, 0.16); }
    // counter and sink down the left wall
    F.box(S.wood, a0 + 3.05, 0.44, -(hl - 0.33), 3.7, 0.88, 0.66);
    F.box(S.marble, a0 + 3.05, 0.905, -(hl - 0.36), 3.76, 0.05, 0.72);
    F.box(S.black, a0 + 2.2, 0.935, -(hl - 0.36), 0.8, 0.012, 0.5);
    F.cyl(S.brass, a0 + 2.2, 1.08, -(hl - 0.05), 0.02, 0.3);
    F.cyl(S.brass, a0 + 4.2, 1.0, -(hl - 0.36), 0.13, 0.16);
    F.col(a0 + 3.05, -(hl - 0.36), 3.76, 0.72, 0, 0.93);
    // cabinet and two shelves of pots and plates down the right wall
    F.box(S.wood, a0 + 3.0, 0.45, hl - 0.25, 3.2, 0.9, 0.5);
    F.box(S.woodLight, a0 + 3.0, 0.92, hl - 0.27, 3.24, 0.04, 0.54);
    F.col(a0 + 3.0, hl - 0.27, 3.24, 0.54, 0, 0.95);
    for (const y of [1.55, 2.0]) F.box(S.wood, a0 + 3.0, y, hl - 0.17, 3.2, 0.04, 0.3);
    for (let i = 0; i < 3; i++) F.cyl(S.brass, a0 + 1.9 + i * 0.5, 1.67, hl - 0.17, 0.12, 0.2);
    for (let i = 0; i < 3; i++) F.cyl(S.linen, a0 + 3.4 + i * 0.4, 2.07, hl - 0.17, 0.14, 0.1);
    // one pendant between the island and the range
    F.pendant(a0 + 3.7, 0, H, 3.0, 14);
  },

  // The landing at the far end: a small square room, the way on straight ahead.
  dressLanding(rec, node) {
    const S = this.shared, DIRS = this.DIRS;
    const R = node.R, H = node.H, cx = node.x, cz = node.z;
    this.coffers(rec, cx, cz, R, H, 2.5);
    this.pendant(rec, cx, cz, H, 3.0, 14);
    const d = node.fwdSide, fd = DIRS[d];
    // pictures on the side walls
    const side = (d + 1) % 4, sd = DIRS[side];
    const px = cx + sd[0] * R / 2, pz = cz + sd[1] * R / 2;
    this.picture(rec, px, pz, -sd[0], -sd[1], 0, 1.9, 1, 0.7, 0.9);
    const px2 = cx - sd[0] * R / 2, pz2 = cz - sd[1] * R / 2;
    this.picture(rec, px2, pz2, sd[0], sd[1], 0, 1.9, 2, 0.9, 0.65);
    // a warm lamp by the door so it can be found from down the hall
    this.addFixture(rec, cx + fd[0] * (R / 2 - 0.7), 2.2, cz + fd[1] * (R / 2 - 0.7), "door", 2.4, 12, 0xffd0a0);
  },

  // Hall junctions and the dead-end stub ends.
  dressJunction(rec, node) {
    const S = this.shared, DIRS = this.DIRS;
    const R = node.R, H = node.H, cx = node.x, cz = node.z;
    this.deco(rec, S.beam, cx, H - 0.1, cz, 0.28, 0.2, R);
    this.deco(rec, S.beam, cx, H - 0.1, cz, R, 0.2, 0.28);
    this.pendant(rec, cx, cz, H, 3.0, 15);
    const closed = [];
    for (let d = 0; d < 4; d++) if (!node.open[d]) closed.push(d);
    if (node.type === "nook" && closed.length) {
      // the stub dead-ends here: a console table, a lamp and a picture on the end wall
      const open = node.open.indexOf(true), d = (open + 2) % 4, D = DIRS[d];
      const wx = cx + D[0] * R / 2, wz = cz + D[1] * R / 2;
      const nx = -D[0], nz = -D[1];
      this.picture(rec, wx, wz, nx, nz, 0, 1.95, Math.floor(this.hash(node.id, 3, 5) * 3), 0.9, 0.65);
      const tx = wx + nx * 0.25, tz = wz + nz * 0.25;
      const alongX = D[0] === 0;
      const sx = alongX ? 1.3 : 0.45, sz = alongX ? 0.45 : 1.3;
      this.deco(rec, S.wood, tx, 0.4, tz, sx, 0.08, sz);
      this.deco(rec, S.wood, tx, 0.2, tz, sx - 0.1, 0.4, sz - 0.1);
      this.collider(rec, tx - sx / 2, 0, tz - sz / 2, tx + sx / 2, 0.84, tz + sz / 2);
      this.cyl(rec, S.brass, tx, 0.5, tz, 0.07, 0.12);
      const sh = new THREE.Mesh(this.shadeGeo, S.shade);
      sh.position.set(tx, 0.72, tz); sh.scale.set(0.16, 0.2, 0.16); rec.group.add(sh);
      this.sph(rec, S.lampOn, tx, 0.68, tz, 0.05);
      this.addFixture(rec, tx, 0.85, tz, "lamp", 1.4, 8, 0xffb070);
    } else {
      // one picture on a closed wall, sometimes
      for (const d of closed) {
        if (d === node.backSide) continue;                   // the return door is on this wall
        if (this.hash(node.id, d, 9) > 0.55) continue;
        const D = DIRS[d];
        this.picture(rec, cx + D[0] * R / 2, cz + D[1] * R / 2, -D[0], -D[1], 0, 1.9, Math.floor(this.hash(node.id, d, 4) * 3), 0.8, 0.6);
        break;
      }
    }
  },

  /* ------------------------------------------------------------------
     DOORS (the two real ones)
     ------------------------------------------------------------------ */
  buildDoor(rec, node, d, kind) {
    const S = this.shared, DIRS = this.DIRS, half = node.R / 2;
    const dx = DIRS[d][0], dz = DIRS[d][1];
    const alongX = dz !== 0;                         // wall runs along x
    const doorSide = alongX ? dz : dx;
    const cx = node.x, cz = node.z, leafW = 0.95;
    // frame, and a black void behind the leaf, both flush with the wall
    const fx = alongX ? cx : cx + doorSide * (half - 0.015), fz = alongX ? cz + doorSide * (half - 0.015) : cz;
    this.deco(rec, S.doorFrame, fx, 1.12, fz, alongX ? leafW + 0.22 : 0.03, 2.24, alongX ? 0.03 : leafW + 0.22);
    const vx = alongX ? cx : cx + doorSide * (half - 0.03), vz = alongX ? cz + doorSide * (half - 0.03) : cz;
    this.deco(rec, S.black, vx, 1.03, vz, alongX ? leafW : 0.03, 2.06, alongX ? 0.03 : leafW);
    const depth = doorSide * (half - 0.09);
    const hx = alongX ? cx - leafW / 2 : cx + depth, hz = alongX ? cz + depth : cz - leafW / 2;
    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, hz);
    const leaf = new THREE.Mesh(this.box, S.doorLeaf);
    leaf.scale.set(alongX ? leafW : 0.06, 2.05, alongX ? 0.06 : leafW);
    leaf.position.set(alongX ? leafW / 2 : 0, 1.03, alongX ? 0 : leafW / 2);
    pivot.add(leaf);
    for (const py of [0.6, 1.5]) {                    // two raised panels on the face
      const pan = new THREE.Mesh(this.box, S.doorPanel);
      pan.scale.set(alongX ? 0.62 : 0.08, py < 1 ? 0.7 : 0.75, alongX ? 0.08 : 0.62);
      pan.position.set(alongX ? leafW / 2 : -doorSide * 0.02, py + 0.03, alongX ? -doorSide * 0.02 : leafW / 2);
      pivot.add(pan);
    }
    const handle = new THREE.Mesh(this.box, S.brass);
    handle.scale.set(alongX ? 0.14 : 0.1, 0.08, alongX ? 0.1 : 0.14);
    handle.position.set(alongX ? leafW * 0.82 : -doorSide * 0.07, 1.02, alongX ? -doorSide * 0.07 : leafW * 0.82);
    pivot.add(handle);
    rec.group.add(pivot);
    rec.doors.push({
      kind, pivot, open: 0, used: false, gone: false,
      x: alongX ? cx : cx + doorSide * half, z: alongX ? cz + doorSide * half : cz,
      swing: alongX ? (doorSide > 0 ? 1 : -1) : (doorSide > 0 ? -1 : 1)
    });
    // the mark over the door. Back: the office. Forward: the way on.
    const lx = cx + dx * (half - 0.1), lz = cz + dz * (half - 0.1);
    const m = new THREE.Mesh(this.planeGeo, kind === "back" ? S.plaqueBack : S.plaqueFwd);
    m.scale.set(0.7, 0.175, 1);
    m.rotation.y = Math.atan2(-dx, -dz);
    m.position.set(lx, 2.42, lz);
    rec.group.add(m);
    if (kind === "forward") {
      this.deco(rec, S.lampOn, lx, 2.3, lz, alongX ? 0.7 : 0.05, 0.04, alongX ? 0.05 : 0.7);
    }
  },

  /* ------------------------------------------------------------------
     HALLS (and the guest rooms off them)
     ------------------------------------------------------------------ */
  buildEdge(edge) {
    const key = String(edge.id);
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    const g = this.edgeGeom(edge), L = g.L, mx = g.mx, mz = g.mz, alongX = g.alongX;
    rec.edge = { ax: mx, az: mz, bx: mx, bz: mz };
    const S = this.shared, t = this.T, W = this.W, H = this.EH;
    const E = (p, q) => alongX ? { x: mx + p, z: mz + q } : { x: mx + q, z: mz + p };
    const sxz = (dp, dq) => alongX ? [dp, dq] : [dq, dp];
    const ebox = (mat, p, y, q, dp, h, dq) => {
      const c = E(p, q), s = sxz(dp, dq);
      return this.deco(rec, mat, c.x, y, c.z, s[0], h, s[1]);
    };
    const esolid = (mat, p, y, q, dp, h, dq) => {
      const c = E(p, q), s = sxz(dp, dq);
      return this.solidBox(rec, mat, c.x, y, c.z, s[0], h, s[1]);
    };
    // hall floor and ceiling
    const full = W + 2 * t;
    let c = E(0, 0), s = sxz(L, full);
    this.texBox(rec, S.carpet, c.x, -0.1, c.z, s[0], 0.2, s[1]);
    this.collider(rec, c.x - s[0] / 2, -0.5, c.z - s[1] / 2, c.x + s[0] / 2, 0.02, c.z + s[1] / 2);
    this.texBox(rec, S.ceil, c.x, H + 0.1, c.z, s[0], 0.2, s[1]);
    this.collider(rec, c.x - s[0] / 2, H, c.z - s[1] / 2, c.x + s[0] / 2, H + 0.2, c.z + s[1] / 2);

    // side walls. A guest room cuts a 1.1 m doorway through the wall at the middle of the hall.
    const room = edge.room;
    const wallPiece = (side, p0, p1, y0, y1) => {
      if (p1 - p0 < 0.01 || y1 - y0 < 0.01) return;
      esolid(S.wallHall, (p0 + p1) / 2, (y0 + y1) / 2, side * (W / 2 + t / 2), p1 - p0, y1 - y0, t);
    };
    for (const side of [-1, 1]) {
      if (room && room.side === side) {
        wallPiece(side, -L / 2, -0.55, 0, H);
        wallPiece(side, 0.55, L / 2, 0, H);
        wallPiece(side, -0.55, 0.55, 2.2, H);
      } else wallPiece(side, -L / 2, L / 2, 0, H);
    }

    // coffer beams across the hall, and two pendants
    const nb = Math.max(2, Math.round(L / 3.2));
    for (let i = 0; i < nb; i++) ebox(S.beam, (i + 0.5) * L / nb - L / 2, H - 0.1, 0, 0.28, 0.2, W);
    for (const p of [-L / 4, L / 4]) {
      const pc = E(p, 0);
      this.pendant(rec, pc.x, pc.z, H, 3.2, 15);
    }

    // numbered doors on both walls. Closed. They do nothing.
    const pitch = 3.9;
    const nd = Math.max(1, Math.floor((L - 3.8) / pitch) + 1);
    for (const side of [-1, 1]) {
      for (let k = 0; k < nd; k++) {
        const p = -((nd - 1) * pitch) / 2 + k * pitch + (side > 0 ? 0.6 : -0.6);
        if (room && room.side === side && Math.abs(p) < 1.7) continue;
        if (Math.abs(p) > L / 2 - 1.2) continue;
        const num = 100 * (1 + (edge.id % 4)) + 1 + ((edge.id * 6 + k * 2 + (side > 0 ? 1 : 0)) % 98);
        this.hallDoor(rec, E, alongX, side, p, num);
      }
    }
    // a picture between doors, now and then
    for (const side of [-1, 1]) {
      if (this.hash(edge.id, side, 12) > 0.5) continue;
      if (room && room.side === side) continue;
      const p = (this.hash(edge.id, side, 13) - 0.5) * (L - 6);
      const w = alongX ? { px: mx, pz: mz + side * W / 2, nx: 0, nz: -side } : { px: mx + side * W / 2, pz: mz, nx: -side, nz: 0 };
      // only if clear of any door on this wall
      let ok = true;
      for (let k = 0; k < nd; k++) {
        const dp = -((nd - 1) * pitch) / 2 + k * pitch + (side > 0 ? 0.6 : -0.6);
        if (Math.abs(dp - p) < 1.5) ok = false;
      }
      if (ok) this.picture(rec, w.px, w.pz, w.nx, w.nz, p, 1.9, Math.floor(this.hash(edge.id, side, 14) * 3), 0.7, 0.5);
    }

    if (room) this.buildRoom(rec, edge, E, ebox, esolid, sxz, L);
    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  // A closed guest-room door on a hall wall: frame, leaf, two panels, handle, number plate.
  hallDoor(rec, E, alongX, side, p, num) {
    const S = this.shared, W = this.W;
    const c = E(p, side * W / 2);
    const nx = alongX ? 0 : -side, nz = alongX ? -side : 0;
    this.wallBox(rec, S.doorFrame, c.x, c.z, nx, nz, 0, 1.1, 1.17, 2.2, 0.05);
    this.wallBox(rec, S.doorLeaf, c.x, c.z, nx, nz, 0, 1.04, 0.95, 2.08, 0.08);
    this.wallBox(rec, S.doorPanel, c.x, c.z, nx, nz, 0, 0.62, 0.66, 0.7, 0.095);
    this.wallBox(rec, S.doorPanel, c.x, c.z, nx, nz, 0, 1.52, 0.66, 0.75, 0.095);
    this.wallBox(rec, S.brass, c.x, c.z, nx, nz, 0.34, 1.02, 0.1, 0.08, 0.13);
    this.wallPlane(rec, this.numberMat(num), c.x, c.z, nx, nz, 0, 2.42, 0.26, 0.13, 0.062);
  },

  // A guest room off a hall: floor, ceiling, three walls, an open door, a bed, a side table, a lamp.
  buildRoom(rec, edge, E, ebox, esolid, sxz, L) {
    const S = this.shared, t = this.T, W = this.W, H = this.EH, s = edge.room.side;
    const q0 = W / 2 + t, D = this.ROOM, hw = D / 2 + t;
    const qc = s * (q0 + (D + t) / 2);                     // lateral centre of the room including its far wall
    const sz = D + t;
    // floor and ceiling
    let c = E(0, qc), z = sxz(2 * hw, sz);
    this.texBox(rec, S.carpet, c.x, -0.1, c.z, z[0], 0.2, z[1]);
    this.collider(rec, c.x - z[0] / 2, -0.5, c.z - z[1] / 2, c.x + z[0] / 2, 0.02, c.z + z[1] / 2);
    this.texBox(rec, S.ceil, c.x, H + 0.1, c.z, z[0], 0.2, z[1]);
    this.collider(rec, c.x - z[0] / 2, H, c.z - z[1] / 2, c.x + z[0] / 2, H + 0.2, c.z + z[1] / 2);
    // far wall and the two side walls
    esolid(S.wallHall, 0, H / 2, s * (q0 + D + t / 2), 2 * hw, H, t);
    for (const sp of [-1, 1]) esolid(S.wallHall, sp * (D / 2 + t / 2), H / 2, s * (q0 + D / 2), t, H, D);
    // door frame on the hall wall, and the leaf swung open against the room's near wall
    for (const sp of [-1, 1]) ebox(S.doorFrame, sp * 0.6, 1.12, s * (W / 2 + t / 2), 0.1, 2.24, t + 0.04);
    ebox(S.doorFrame, 0, 2.25, s * (W / 2 + t / 2), 1.3, 0.1, t + 0.04);
    // one visual variant, from the seed: the bed on the other side, and sometimes a curtained window on the far wall
    const mir = this.hash(edge.id, 8, 31) < 0.5 ? -1 : 1, win = this.hash(edge.id, 9, 32) < 0.5;
    ebox(S.doorLeaf, -0.74 * mir, 1.04, s * (q0 + 0.45), 0.06, 2.08, 0.95);

    // bed: head to the far wall, along the left side (or the right, when mirrored)
    const bp = -1.2 * mir, bq = q0 + 3.85;
    esolid(S.wood, bp, 0.275, s * bq, 1.5, 0.35, 2.1);      // frame + collider
    const lastC = rec.colliders[rec.colliders.length - 1];
    lastC.min.y = 0; lastC.max.y = 0.66;
    ebox(S.linen, bp, 0.55, s * bq, 1.44, 0.2, 2.0);
    ebox(S.blanket, bp, 0.66, s * (bq - 0.5), 1.46, 0.04, 1.1);
    ebox(S.linen, bp, 0.68, s * (bq + 0.78), 0.9, 0.12, 0.34);
    ebox(S.wood, bp, 0.78, s * (q0 + D - 0.06), 1.6, 0.95, 0.08);
    // side table with a lamp, between the bed and the door end of the room
    const tp = 0.0, tq = q0 + 4.55;
    esolid(S.woodLight, tp, 0.28, s * tq, 0.5, 0.56, 0.45);
    const tc = rec.colliders[rec.colliders.length - 1];
    tc.min.y = 0;
    const lc = E(tp, s * tq);
    this.cyl(rec, S.brass, lc.x, 0.62, lc.z, 0.06, 0.12);
    const sh = new THREE.Mesh(this.shadeGeo, S.shade);
    sh.position.set(lc.x, 0.82, lc.z); sh.scale.set(0.15, 0.2, 0.15); rec.group.add(sh);
    this.sph(rec, S.lampOn, lc.x, 0.78, lc.z, 0.05);
    this.addFixture(rec, lc.x, 0.95, lc.z, "lamp", 1.5, 9, 0xffb070);
    if (win) {
      const wp = 1.5 * mir, wq = s * (q0 + D - 0.03);
      ebox(S.doorFrame, wp, 1.55, wq, 1.3, 1.5, 0.06);
      ebox(S.black, wp, 1.55, s * (q0 + D - 0.065), 1.1, 1.3, 0.03);
      ebox(S.wood, wp, 0.78, s * (q0 + D - 0.1), 1.45, 0.05, 0.16);
      for (const cp of [-0.62, 0.62]) ebox(S.fabric, wp + cp, 1.5, s * (q0 + D - 0.1), 0.34, 1.75, 0.1);
    }
    // a picture over the bed
    const fc = E(bp, s * (q0 + D));
    const alongX = this.edgeGeom(edge).alongX;
    this.picture(rec, fc.x, fc.z, alongX ? 0 : -s, alongX ? -s : 0, 0, 1.75, Math.floor(this.hash(edge.id, 5, 6) * 3), 0.8, 0.6);
    // a number by the door, on the hall side
    const num = 100 * (1 + (edge.id % 4)) + 50 + (edge.id % 40);
    const nc = E(1.0, s * W / 2);
    this.wallPlane(rec, this.numberMat(num), nc.x, nc.z, alongX ? 0 : -s, alongX ? -s : 0, 0, 1.75, 0.26, 0.13, 0.03);
  },

  // Grow the hotel ahead of the player.
  extend(px, pz) {
    if (!this._route || !this._cells) return;
    const S = this.S, DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const need = Math.ceil(Math.max(0, pz) / S) + 8;
    const cells = this._cells, nodes = this._nodes, edges = this._edges, route = this._route;
    const key = (i, j) => i + "," + j;
    const addNode = (i, j, type) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, type, R: 3.6, H: 3.0,
        open: [false, false, false, false], edges: [], backSide: -1, arriveSide: -1, fwdSide: -1 };
      nodes.push(n); cells.set(key(i, j), n); return n;
    };
    const link = (a, b, d) => {
      a.open[d] = true; b.open[(d + 2) % 4] = true;
      const e = { id: edges.length, a: a.id, b: b.id, d, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
    };
    let cur = route[route.length - 1];
    while (route.length < need) {
      const h = this.hash(route.length, 2, 9);
      let d = 1;
      if (h > 0.78) d = h > 0.9 ? 0 : 2;
      const di = DIRS[d];
      if (cells.has(key(cur.i + di[0], cur.j + di[1]))) d = 1;
      const di2 = DIRS[d];
      if (cells.has(key(cur.i + di2[0], cur.j + di2[1]))) break;
      const nx = addNode(cur.i + di2[0], cur.j + di2[1], "hall");
      link(cur, nx, d);
      route.push(nx);
      cur = nx;
    }
    this.nodes = nodes;
    this.edges = edges;
  },

  /* ------------------------------------------------------------------
     STREAMING
     ------------------------------------------------------------------ */
  // The collider array is read live by the player and the Hound: rebuild it in place.
  _collect() {
    this.colliders.length = 0;
    this.doors = [];
    this.fixtures = [];
    for (const rec of this.segments.values()) {
      for (const c of rec.colliders) this.colliders.push(c);
      for (const d of rec.doors) this.doors.push(d);
      for (const f of rec.fixtures) this.fixtures.push(f);
    }
  },

  stream(force) {
    if (!this.active || !this.group) return;
    const px = Player.position.x, pz = Player.position.z;
    this.extend(px, pz);
    const key = Math.floor(px / 8) + "," + Math.floor(pz / 8);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const BUILD = 46, DROP = 62;
    const near = [];
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d < BUILD && !this.segments.has("n" + n.id)) near.push({ d, n });
    }
    for (const e of this.edges) {
      const g = this.edgeGeom(e);
      const d = Math.hypot(g.mx - px, g.mz - pz);
      if (d < BUILD && !this.segments.has(String(e.id))) near.push({ d, e });
    }
    near.sort((a, b) => a.d - b.d);
    for (const it of near) { if (it.n) this.buildNode(it.n); else this.buildEdge(it.e); }
    for (const [k, rec] of Array.from(this.segments.entries())) {
      const e = rec.edge;
      const d = Math.hypot(e.ax - px, e.az - pz);
      if (d > DROP) { this.disposeSegment(rec); this.segments.delete(k); }
    }
    this._collect();
  },

  /* ------------------------------------------------------------------
     INTERACTION
     ------------------------------------------------------------------ */
  tryUse() {
    if (!this.active) return false;
    const p = Player.position;
    let best = null, bestD = 2.1;
    for (const d of this.doors) {
      if (!d.pivot.parent || d.used) continue;
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (!best) return false;
    best.used = true;
    return true;
  },

  prompt() {
    const p = Player.position;
    for (const d of this.doors) {
      if (d.used || Math.hypot(p.x - d.x, p.z - d.z) > 2.0) continue;
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(d.kind === "back" ? "E  RETURN TO THE OFFICE" : "E  OPEN DOOR");
      return;
    }
  },

  // The forward door ends the run, the same way Level 4's used to. There is no Level 6.
  finish() {
    if (this._ended) return;
    this._ended = true;
    GameState.exitReached = true;
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 5 CLEARED");
    if (typeof Game !== "undefined" && Game.complete) Game.complete();
  },

  /* ------------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------------ */
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.stream(false);
    const p = Player.position;

    // re-aim the light pool. The chandelier and lamps hold steady; hall pendants drift a hair.
    this._poolT -= dt;
    if (this._poolT <= 0) { this._poolT = 0.2; this.assignLights(); }
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) continue;
      const k = f.kind === "pendant" ? 0.97 + 0.03 * Math.sin((this.time + f.ph) * 1.3) : 1;
      this.pool[i].intensity = f.base * k;
    }

    // doors swing open, then do their thing
    for (const d of this.doors) {
      if (!d.used || d.open >= 1) continue;
      d.open = Math.min(1, d.open + dt / 0.7);
      d.pivot.rotation.y = d.open * 1.55 * d.swing;
      if (d.open >= 1 && !d.gone) {
        d.gone = true;
        if (d.kind === "back") {
          const sd = this.seed;
          if (typeof BeastSystem !== "undefined") BeastSystem.detach();
          setTimeout(() => { if (typeof Level4 !== "undefined") Level4.enter(sd, 5); }, 0);
        } else {
          this.finish();
        }
      }
    }

    // very quiet building noises, far between
    this._sfxT -= dt;
    if (this._sfxT <= 0) {
      this._sfxT = 16 + Math.random() * 18;
      if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional) {
        const ang = Math.random() * Math.PI * 2, rr = 10 + Math.random() * 14;
        const k = ["creak", "thump"][Math.floor(Math.random() * 2)];
        AudioSystem.playPositional(k, p.x + Math.cos(ang) * rr, 1.5, p.z + Math.sin(ang) * rr, { gain: 0.035, bus: "events", max: 50 });
      }
    }

    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
  }
};
