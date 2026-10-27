"use strict";

/* Level 4 — "Abandoned Office" (Class 1: habitable, the breather after the station).

   An empty office on a rainy day. Cubicles are mostly gone. Grey-brown carpet, off-white
   walls with a baseboard, a drop ceiling, a few working fluorescent panels. Not yellow,
   not brick.

   - A spine of rooms (about 10 m across, 2.8 m ceiling) joined by short 2.2 m corridors,
     generated from the seed and streamed by distance. A few dead-end side rooms.
   - Exterior walls have windows. Behind every pane is the same fogged grey backdrop, and
     rain runs down the glass. The window light does more of the lighting than the tubes.
   - Furniture is sparse: a desk, a chair, a dead monitor. Some rooms show a worn patch of
     carpet where a desk used to be.
   - Almond water is common here (desks, water coolers). At most 5 in the loaded area.
   - Doors: the one you arrive by (first room) is sealed. The way back to Level 3 is further in, on a
     later or side room. The way forward is on the last room and leads on to Level 5.
   - One entity at most: even seed, one Hound; odd seed, one Smiler. Never both.

   Lighting note: lights are physically based and the scene has no environment map, so a
   fixed pool of point lights follows the player (the light count never changes, so
   streaming causes no shader recompiles). Window light and panel light share the pool. */

const Level4 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  segments: new Map(),
  nodes: [],
  edges: [],
  doors: [],
  spawn: new THREE.Vector3(),
  exitPos: null,     // just inside the forward door
  backPos: null,
  backNode: null,
  baseY: 0,
  S: 16,             // lattice spacing between room centres
  R: 10,             // room interior size
  W: 2.2,            // corridor width
  H: 2.8,            // ceiling height
  T: 0.25,           // wall thickness
  shared: null,
  rainVariants: [],
  rainNodes: [],
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  taken: {},
  // Tunable look. Rooms are lit mostly by ambient plus window light.
  look: { ambient: 1.2, hemi: 0.75, poolSize: 10, fog: 0x808890, fogNear: 10, fogFar: 72 },
  lastKey: "",
  infoText: "",
  time: 0,
  _poolT: 0,
  _sfxT: 12,
  _musicT: 0,
  _musicIdx: 0,
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

  _generate(seed, force) {
    const r = this.rng((seed ^ 0x4F1BBCDD) >>> 0);
    const S = this.S, R = this.R, H = this.H;
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const cells = new Map(), nodes = [], edges = [];
    const key = (i, j) => i + "," + j;
    const addNode = (i, j, role) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, role, open: [false, false, false, false],
        occ: [false, false, false, false], edges: [], dress: null, backSide: -1, arriveSide: -1, fwdSide: -1 };
      nodes.push(n); cells.set(key(i, j), n); return n;
    };
    const link = (a, b, d) => {
      a.open[d] = true; b.open[(d + 2) % 4] = true;
      const e = { id: edges.length, a: a.id, b: b.id, d, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
      return e;
    };

    // the spine starts long enough for the 450 m return. extend() grows it further.
    const count = 40;
    let cur = addNode(0, 0, "start"), last = -1;
    for (let k = 1; k < count; k++) {
      const opts = [];
      for (let d = 0; d < 4; d++) {
        if (!cells.has(key(cur.i + DIRS[d][0], cur.j + DIRS[d][1]))) opts.push(d);
      }
      if (!opts.length) { if (!force) return false; break; }
      const d = (last >= 0 && opts.indexOf(last) >= 0 && r() < 0.45) ? last : opts[Math.floor(r() * opts.length)];
      const nx = addNode(cur.i + DIRS[d][0], cur.j + DIRS[d][1], "spine");
      link(cur, nx, d);
      cur = nx; last = d;
    }
    if (nodes.length < 7 && !force) return false;
    const spineCount = nodes.length;

    // a few dead-end side rooms
    for (let n = 1; n < spineCount - 1; n++) {
      if (r() >= 0.32) continue;
      const base = nodes[n], opts = [];
      for (let d = 0; d < 4; d++) {
        if (!cells.has(key(base.i + DIRS[d][0], base.j + DIRS[d][1]))) opts.push(d);
      }
      if (!opts.length) continue;
      const d = opts[Math.floor(r() * opts.length)];
      const side = addNode(base.i + DIRS[d][0], base.j + DIRS[d][1], "side");
      link(base, side, d);
    }

    // which sides face another room (not exterior)
    for (const n of nodes) {
      for (let d = 0; d < 4; d++) n.occ[d] = cells.has(key(n.i + DIRS[d][0], n.j + DIRS[d][1]));
    }

    // doors. The first room is where you arrive: its arrival wall (arriveSide) is a sealed door, so
    // the spawn, the facing and the dressing are exactly as before. The way forward goes on the last
    // room. The way back to Level 3 is placed further in, after dressing (see below).
    // Each goes on a closed wall, preferably opposite the corridor.
    const pickSide = (n) => {
      const via = n.open.indexOf(true);
      const order = [(via + 2) % 4, (via + 1) % 4, (via + 3) % 4, via];
      for (const d of order) if (!n.open[d]) return d;
      return -1;
    };
    nodes[0].arriveSide = pickSide(nodes[0]);
    // forward door at ~600 m, return at ~450 m. Placed after the route exists.
    const fwdStep = Math.min(nodes.length - 1, Math.round(600 / S));
    const backStep = Math.min(nodes.length - 2, Math.round(450 / S));
    nodes[fwdStep].role = "end";
    nodes[fwdStep].fwdSide = pickSide(nodes[fwdStep]);
    if (backStep > 2 && backStep !== fwdStep) {
      nodes[backStep].backSide = pickSide(nodes[backStep]);
    }

    // dressing is decided here, once, so a room looks the same every time it streams in
    const x0 = (n) => n.x - (R / 2 + this.T), z0 = (n) => n.z - (R / 2 + this.T);
    const panelSpots = [[-2.75, -2.5], [2.75, -2.5], [0.25, 0], [-2.75, 2.5], [2.75, 2.5]];
    for (const n of nodes) {
      const dr = { panels: [], missing: [], stained: [], desk: null, cooler: null, worn: null, windows: [], sites: [] };
      // ceiling panels: most are dead
      panelSpots.forEach((p, idx) => {
        let on = r() < 0.28;
        if (n.role === "start" && (idx === 1 || idx === 3)) on = true;   // the first room is not dark
        dr.panels.push({ x: n.x + p[0], z: n.z + p[1], on, bad: on && r() < 0.3 });
      });
      // a few missing and stained tiles, away from the panels
      const cellPos = (i, j) => ({ x: x0(n) + 0.5 * (i + 0.5), z: z0(n) + 0.5 * (j + 0.5) });
      const free = (c) => dr.panels.every(p => Math.abs(p.x - c.x) > 0.8 && Math.abs(p.z - c.z) > 0.5);
      const addTiles = (list, num) => {
        for (let k = 0; k < num; k++) {
          const c = cellPos(1 + Math.floor(r() * 19), 1 + Math.floor(r() * 19));
          if (free(c)) list.push(c);
        }
      };
      addTiles(dr.missing, r() < 0.6 ? 1 + Math.floor(r() * 2) : 0);
      addTiles(dr.stained, 2 + Math.floor(r() * 3));

      // windows on exterior walls (closed side, no neighbouring room)
      for (let d = 0; d < 4; d++) {
        if (n.open[d] || n.occ[d] || n.arriveSide === d || n.fwdSide === d) continue;
        for (const c of [-3.2, 0, 3.2]) {
          if (r() < 0.8) dr.windows.push({ d, c, blackout: r() < 0.15 });
        }
      }
      // furniture: sparse. Desks and chairs sit against a closed wall.
      const closed = [];
      for (let d = 0; d < 4; d++) if (!n.open[d] && n.arriveSide !== d && n.fwdSide !== d) closed.push(d);
      if (closed.length && n.role !== "start" && r() < 0.32) {
        const d = closed[Math.floor(r() * closed.length)];
        dr.desk = { d, lat: (r() - 0.5) * 4, hasMonitor: r() < 0.7, bottle: r() < 0.55 };
      }
      if (r() < 0.12) {
        const sx = r() < 0.5 ? -1 : 1, sz = r() < 0.5 ? -1 : 1;
        dr.cooler = { x: n.x + sx * (R / 2 - 0.55), z: n.z + sz * (R / 2 - 0.55) };
      }
      if (!dr.desk && r() < 0.4) {
        dr.worn = { x: n.x + (r() < 0.5 ? -2.4 : 2.4), z: n.z + (r() < 0.5 ? -2.4 : 2.4), alongZ: r() < 0.5 };
      }
      n.dress = dr;
    }

    // pickup sites. Water is common (desks, coolers). One energy bar at most, in the whole level.
    for (const n of nodes) {
      const dr = n.dress;
      if (dr.desk && dr.desk.bottle) {
        const p = this.deskSpot(n, dr.desk);
        dr.sites.push({ id: "n" + n.id + ":desk", kind: "almond", x: p.x + p.ox * 0.45, z: p.z + p.oz * 0.45, y: 0.89 });
      }
      if (dr.cooler) {
        for (const o of [-0.09, 0.09]) {
          dr.sites.push({ id: "n" + n.id + ":cooler" + o, kind: "almond", x: dr.cooler.x + o, z: dr.cooler.z, y: 1.09 });
        }
      }
    }
    if (r() < 0.6 && nodes.length > 2) {
      const n = nodes[1 + Math.floor(r() * (nodes.length - 1))];
      if (n.dress.desk) {
        const p = this.deskSpot(n, n.dress.desk);
        n.dress.sites.push({ id: "n" + n.id + ":energy", kind: "energy", x: p.x - p.ox * 0.45, z: p.z - p.oz * 0.45, y: 0.84 });
      } else {
        n.dress.sites.push({ id: "n" + n.id + ":energy", kind: "energy", x: n.x + 3.9, z: n.z + 3.9, y: 0.18 });
      }
    }

    // The way back to Level 3: a later room or a side room, never the first. At least two rooms from
    // the start, never the last room. Placed after dressing and with the same random stream, so
    // nothing else about the level changes. It takes a wall with no desk; any windows on it are dropped.
    // return door is the room at ~450 m, set above. Keep it.
    const backN = nodes[Math.min(nodes.length - 2, Math.round(450 / S))];
    this.backNode = backN;

    this.nodes = nodes;
    this.edges = edges;
    const startN = nodes[0], endN = nodes[Math.min(nodes.length - 1, Math.round(600 / S))];
    const half = R / 2;
    const bd = DIRS[startN.arriveSide] || [0, -1], fd = DIRS[endN.fwdSide] || [0, 1];
    this.spawn.set(startN.x + bd[0] * (half - 2.5), this.baseY, startN.z + bd[1] * (half - 2.5));
    this.spawnYaw = Math.atan2(bd[0], bd[1]);                   // face into the room, away from the arrival wall
    const rd = (backN && backN.backSide >= 0) ? DIRS[backN.backSide] : null;
    this.backPos = rd ? new THREE.Vector3(backN.x + rd[0] * (half - 1.5), this.baseY, backN.z + rd[1] * (half - 1.5)) : null;
    this.exitPos = new THREE.Vector3(endN.x + fd[0] * (half - 2.2), this.baseY, endN.z + fd[1] * (half - 2.2));
    this.exitYaw = Math.atan2(fd[0], fd[1]);                    // face into the room, away from the forward door
    this.endNode = endN;
    this.infoText = "ROOMS " + nodes.length + " · HALLS " + edges.length + " · RETURN ~450m · FORWARD ~600m";
    this._route = nodes.filter(n => n.role === "spine" || n.role === "start" || n.role === "end");
    this._cells = cells;
    this._nodes = nodes;
    this._edges = edges;
    return true;
  },

  // Where a desk sits (centre) and its orientation. Used by both generation and rendering.
  deskSpot(n, desk) {
    const R = this.R, DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const dv = DIRS[desk.d];
    const dist = R / 2 - 0.55;                       // desk is 0.8 deep, back to the wall
    const alongZ = dv[0] !== 0;                      // wall runs along z when it faces +/-x
    return {
      x: alongZ ? n.x + dv[0] * dist : n.x + desk.lat,
      z: alongZ ? n.z + desk.lat : n.z + dv[1] * dist,
      alongZ,
      ox: alongZ ? 0 : 1, oz: alongZ ? 1 : 0,        // direction along the desk's long edge
      dx: dv[0], dz: dv[1]                           // direction of the wall behind it
    };
  },

  /* ------------------------------------------------------------------
     TEXTURES (canvas, like Level 2 and Level 3). One tile covers about 2 m.
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

  // Grey-brown carpet: fine fibre noise plus low, seamless blotches of wear. Not moldy.
  carpetTex() {
    const N = 256, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    let a = 0x1234567;
    const rnd = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
    const TAU = Math.PI * 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const blotch = Math.sin(x / N * TAU * 2 + 1.3) * Math.sin(y / N * TAU * 3 + 0.4) * 7
          + Math.sin(x / N * TAU * 5 + y / N * TAU * 4) * 3;
        const fibre = (rnd() - 0.5) * 24 + ((x + y * 3) % 5 === 0 ? -6 : 0);
        const v = blotch + fibre;
        const i = (y * N + x) * 4;
        d[i] = 142 + v; d[i + 1] = 130 + v * 0.95; d[i + 2] = 116 + v * 0.9; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  // Plastered wall: faint noise and a few long vertical water streaks.
  plasterTex(r0, g0, b0) {
    const N = 256, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    let a = 0x2468ace ^ (r0 * 31);
    const rnd = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const streak = (Math.sin(x * 0.37) + Math.sin(x * 0.11 + 2)) * 1.6;
        const v = (rnd() - 0.5) * 9 + streak - (y > 200 ? (y - 200) * 0.05 : 0);
        const i = (y * N + x) * 4;
        d[i] = r0 + v; d[i + 1] = g0 + v; d[i + 2] = b0 + v * 0.95; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  // Drop ceiling: 4 x 4 tiles of 0.5 m per texture, thin dark grid, pitted surface.
  ceilTex() {
    const N = 256, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    let a = 0x7654321;
    const rnd = () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const line = (x % 64 < 2) || (y % 64 < 2);
        const pit = rnd() < 0.035 ? -26 : 0;
        const v = line ? -128 : (rnd() - 0.5) * 8 + pit;
        const i = (y * N + x) * 4;
        d[i] = 226 + v; d[i + 1] = 224 + v; d[i + 2] = 216 + v; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return this._tex(c);
  },

  // Rain on glass: vertical streaks and beads on a transparent background.
  rainTex(seed) {
    const W = 128, Hh = 256, c = this._canvas(W, Hh), g = c.getContext("2d");
    let a = (0x9E3779B9 ^ (seed * 7919)) >>> 0 || 1;
    const rnd = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    g.clearRect(0, 0, W, Hh);
    g.fillStyle = "rgba(150,165,180,0.10)";         // the glass itself
    g.fillRect(0, 0, W, Hh);
    g.lineCap = "round";
    for (let k = 0; k < 46; k++) {
      const x = rnd() * W, y = rnd() * Hh, len = 30 + rnd() * 90, wob = (rnd() - 0.5) * 4;
      g.strokeStyle = "rgba(226,233,241," + (0.22 + rnd() * 0.3).toFixed(2) + ")";
      g.lineWidth = 1 + rnd() * 1.4;
      for (const oy of [0, -Hh]) {              // draw twice so the texture wraps cleanly
        g.beginPath(); g.moveTo(x, y + oy); g.lineTo(x + wob, y + len + oy); g.stroke();
      }
    }
    for (let k = 0; k < 70; k++) {
      const x = rnd() * W, y = rnd() * Hh, rad = 0.8 + rnd() * 2.2;
      g.fillStyle = "rgba(235,240,246," + (0.3 + rnd() * 0.3).toFixed(2) + ")";
      g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    }
    return this._tex(c);
  },

  // The same grey, fogged nothing behind every pane.
  wellTex() {
    const c = this._canvas(32, 128), g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, "#a3aab1"); grd.addColorStop(0.55, "#8a9198"); grd.addColorStop(1, "#6d747a");
    g.fillStyle = grd; g.fillRect(0, 0, 32, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  // Soft decals laid on the carpet.
  shadeTex() {            // darker toward the walls: dark at the top (the wall side), clear at the bottom
    const c = this._canvas(8, 64), g = c.getContext("2d");
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, "rgba(26,20,14,0.5)"); grd.addColorStop(1, "rgba(26,20,14,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 8, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  pathTex() {             // a worn walking path: lighter, feathered on every edge
    const N = 64, c = this._canvas(N, N), g = c.getContext("2d");
    const img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ex = Math.min(x, N - 1 - x) / (N * 0.42), ey = Math.min(y, N - 1 - y) / (N * 0.42);
        const k = Math.max(0, Math.min(1, Math.min(ex, ey)));
        const i = (y * N + x) * 4;
        d[i] = 204; d[i + 1] = 194; d[i + 2] = 180; d[i + 3] = Math.floor(70 * k * k * (3 - 2 * k));
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  patchTex() {            // where a desk used to be: a faded rectangle with four dents
    const c = this._canvas(128, 64), g = c.getContext("2d");
    g.clearRect(0, 0, 128, 64);
    g.fillStyle = "rgba(210,200,186,0.20)"; g.fillRect(4, 4, 120, 56);
    g.strokeStyle = "rgba(40,34,28,0.22)"; g.lineWidth = 2; g.strokeRect(4, 4, 120, 56);
    g.fillStyle = "rgba(34,28,22,0.38)";
    for (const [x, y] of [[10, 10], [108, 10], [10, 44], [108, 44]]) g.fillRect(x, y, 10, 10);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  plaqueTex(text) {
    const c = this._canvas(256, 48), g = c.getContext("2d");
    g.fillStyle = "#23282c"; g.fillRect(0, 0, 256, 48);
    g.strokeStyle = "#8a949c"; g.lineWidth = 2; g.strokeRect(3, 3, 250, 42);
    g.fillStyle = "#e4e8ea";
    g.font = "bold 24px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 128, 26);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  materialSet() {
    if (this.shared) return;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const decal = (map) => new THREE.MeshStandardMaterial({
      map, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    const carpet = this.carpetTex();
    this.shared = {
      carpet: std({ map: carpet, color: 0xe6ddd2, roughness: 1, metalness: 0 }),
      carpetHall: std({ map: carpet, color: 0xc6bcb0, roughness: 1, metalness: 0 }),
      wallA: std({ map: this.plasterTex(232, 228, 218), color: 0xffffff, roughness: 0.95, metalness: 0 }),
      wallB: std({ map: this.plasterTex(206, 200, 190), color: 0xffffff, roughness: 0.95, metalness: 0 }),
      base: std({ color: 0x4a433c, roughness: 0.8, metalness: 0 }),
      ceil: std({ map: this.ceilTex(), color: 0xeceae4, roughness: 0.95, metalness: 0 }),
      ceilStain: new THREE.MeshStandardMaterial({ color: 0x6a5a3c, transparent: true, opacity: 0.45, roughness: 1, depthWrite: false }),
      panelOn: new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }),
      panelOff: std({ color: 0xaaaca8, roughness: 0.6, metalness: 0 }),
      black: new THREE.MeshBasicMaterial({ color: 0x040404 }),
      desk: std({ color: 0x6c5c4a, roughness: 0.8, metalness: 0 }),
      deskTop: std({ color: 0x80705c, roughness: 0.7, metalness: 0 }),
      chair: std({ color: 0x33373b, roughness: 0.9, metalness: 0 }),
      metal: std({ color: 0x70767a, roughness: 0.5, metalness: 0.15 }),
      monitor: std({ color: 0x1d1e20, roughness: 0.5, metalness: 0 }),
      screen: std({ color: 0x0d0e10, roughness: 0.15, metalness: 0 }),
      cooler: std({ color: 0xdde1e4, roughness: 0.5, metalness: 0 }),
      coolerDark: std({ color: 0x3a4146, roughness: 0.6, metalness: 0 }),
      frame: std({ color: 0x8c9094, roughness: 0.5, metalness: 0.1 }),
      doorLeaf: std({ color: 0x5a5048, roughness: 0.85, metalness: 0 }),
      doorFrame: std({ color: 0x2a2622, roughness: 0.9, metalness: 0 }),
      handle: std({ color: 0xb4aca0, roughness: 0.4, metalness: 0.15 }),
      plaqueBack: new THREE.MeshBasicMaterial({ map: this.plaqueTex("ELEVATOR") }),
      well: new THREE.MeshBasicMaterial({ map: this.wellTex(), side: THREE.BackSide, fog: false }),
      shade: decal(this.shadeTex()),
      path: decal(this.pathTex()),
      patch: decal(this.patchTex())
    };
    // Three rain layers that scroll at slightly different speeds.
    this.rainVariants = [];
    this.shared.rain = [0, 1, 2].map((i) => {
      const t = this.rainTex(i + 1);
      const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
      this.rainVariants.push({ tex: t, speed: 0.34 + i * 0.09 });
      return m;
    });
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    const wasActive = this.active;
    this.stopRain();
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
    this.taken = {};
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.time = 0;
    this._ended = false;
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    // every path that resets Level 4 also clears Level 5, so it can never be left in the scene
    if (typeof Level5 !== "undefined") Level5.reset();
    if (wasActive) {
      if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") {
        CameraRig.camera.far = CONFIG.cameraFar;
        CameraRig.camera.updateProjectionMatrix();
      }
      if (typeof PickupSystem !== "undefined" && PickupSystem.reset && PickupSystem.group) PickupSystem.reset();
    }
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos || []) g.dispose();
    // hand pickups back: remember the ones that were taken, drop the rest
    for (const p of rec.pickups || []) {
      if (p.taken) this.taken[p.l4] = true;
      if (typeof PickupSystem !== "undefined") {
        const i = PickupSystem.list.indexOf(p);
        if (i >= 0) PickupSystem.list.splice(i, 1);
        if (p.mesh && PickupSystem.group) PickupSystem.group.remove(p.mesh);
      }
      if (p.mesh && p.mesh.material && p.mesh.material.dispose) p.mesh.material.dispose();
    }
    rec.pickups = [];
  },

  enter(seed, from) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();     // also resets this level; nothing is built yet
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    this.reset();
    this.seed = seed >>> 0;
    this.generate(this.seed);
    this.materialSet();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level4_Office";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0xcfd6de, 0x6a645c, lk.hemi);
    const amb = new THREE.AmbientLight(0xb8bcc4, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    for (let i = 0; i < lk.poolSize; i++) {
      const L = new THREE.PointLight(0xffe2b8, 0, 16, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 80; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 4;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    // Coming back from Level 5 puts the player at the forward door's side, not at the start.
    const back5 = (from === 5 && this.exitPos);
    const arrival = back5 ? this.exitPos : this.spawn;
    const arrivalYaw = back5 ? this.exitYaw : this.spawnYaw;
    Level.startPos.copy(this.spawn);
    Player.position.copy(arrival);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = arrivalYaw;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find the way forward";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 4";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    if (typeof PickupSystem !== "undefined") {
      PickupSystem.reset();
      PickupSystem.group = new THREE.Group();
      if (scene) scene.add(PickupSystem.group);
    }
    this.stream(true);
    this.assignLights();
    Player.position.copy(arrival);
    Player.yaw = arrivalYaw;
    this.attachEntities();
    this.startRain();
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 4 · OFFICE SECTOR");
  },

  // One entity per run, chosen by the seed: even is a Hound, odd is a Smiler. Never both.
  attachEntities() {
    const common = { colliders: this.colliders, cap: 1, graceSeconds: 3, minDist: 18, maxDist: 36, seed: this.seed };
    if (this.seed % 2 === 0) {
      if (typeof HoundSystem !== "undefined") HoundSystem.attach(common);
      if (typeof SmilerSystem !== "undefined") SmilerSystem.detach();
    } else {
      if (typeof SmilerSystem !== "undefined") {
        SmilerSystem.attach(Object.assign({}, common, {
          margin: 0.55,
          allow: () => true,
          isDark: (x, z) => this.isDarkAt(x, z)
        }));
      }
      if (typeof HoundSystem !== "undefined") HoundSystem.detach();
    }
  },

  // For the console: attach the system this level did not pick, so /spawn can place one
  // by hand. cap 0 and an endless grace mean it never spawns anything on its own.
  attachSpare(kind) {
    const spare = { colliders: this.colliders, cap: 0, graceSeconds: 1e9, minDist: 18, maxDist: 36, seed: this.seed };
    if (kind === "hound" && typeof HoundSystem !== "undefined" && !HoundSystem.attached) HoundSystem.attach(spare);
    if (kind === "smiler" && typeof SmilerSystem !== "undefined" && !SmilerSystem.attached) {
      SmilerSystem.attach(Object.assign({}, spare, { margin: 0.55, allow: () => true }));
    }
  },

  /* ------------------------------------------------------------------
     AUDIO. A quiet rain bed from a looped noise buffer on the ambient bus, and a faint
     music cue near the forward door. Both are synthesised, and both are skipped when
     there is no audio context.
     ------------------------------------------------------------------ */
  startRain() {
    this.stopRain();
    const A = (typeof AudioSystem !== "undefined") ? AudioSystem : null;
    if (!A || !A.ctx || !A.buses || !A.buses.ambient) return;
    try {
      if (A.resume) A.resume();
      const ctx = A.ctx, len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) { lp = lp * 0.72 + (Math.random() * 2 - 1) * 0.28; d[i] = lp; }
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 650;
      const lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = 5200;
      const g = ctx.createGain(); g.gain.value = 0.05;
      src.connect(hp); hp.connect(lpf); lpf.connect(g); g.connect(A.buses.ambient);
      src.start();
      this.rainNodes = [src, hp, lpf, g];
    } catch (e) { this.rainNodes = []; }
  },

  stopRain() {
    for (const n of this.rainNodes) {
      try { if (n.stop) n.stop(); n.disconnect(); } catch (e) { /* already stopped */ }
    }
    this.rainNodes = [];
  },

  /* ------------------------------------------------------------------
     GEOMETRY HELPERS
     ------------------------------------------------------------------ */
  newRec() {
    return { group: new THREE.Group(), colliders: [], fixtures: [], doors: [], pickups: [], geos: [], edge: null };
  },

  // Box with real-size geometry and UVs scaled so a texture tile covers 2 m.
  texBox(rec, mat, x, y, z, sx, sy, sz) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const uv = geo.attributes.uv;
    const T = 2.0;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / T, uv.getY(i) * dims[f][1] / T);
      }
    }
    uv.needsUpdate = true;
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

  solidBox(rec, mat, x, y, z, sx, sy, sz, textured) {
    if (textured) this.texBox(rec, mat, x, y, z, sx, sy, sz);
    else this.deco(rec, mat, x, y, z, sx, sy, sz);
    return this.collider(rec, x - sx / 2, y - sy / 2, z - sz / 2, x + sx / 2, y + sy / 2, z + sz / 2);
  },

  // A flat decal on the floor. Long axis points along (ux, uz).
  floorDecal(rec, mat, x, z, w, l, ux, uz, y) {
    const m = new THREE.Mesh(this.planeGeo, mat);
    m.rotation.order = "YXZ";
    m.rotation.x = -Math.PI / 2;
    m.rotation.y = Math.atan2(-ux, -uz);
    m.scale.set(w, l, 1);
    m.position.set(x, y, z);
    rec.group.add(m);
    return m;
  },

  addFixture(rec, x, y, z, kind, base, dist, color, bad) {
    rec.fixtures.push({
      x, y, z, kind, base, dist, color, bad: !!bad,
      ph: this.hash(Math.round(x * 3), Math.round(z * 3), 3) * 40
    });
  },

  // Dark means no working ceiling panel within 8 m. Window light does not count.
  isDarkAt(x, z) {
    for (const f of this.fixtures) {
      if (f.kind === "panel" && Math.hypot(f.x - x, f.z - z) <= 8) return false;
    }
    return true;
  },

  assignLights() {
    if (!this.pool.length) return;
    const p = Player.position;
    const cand = [];
    for (const f of this.fixtures) {
      const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z);
      if (d < 30 * 30) cand.push({ f, d });
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
      } else this.pool[i].intensity = 0;
    }
  },

  /* ------------------------------------------------------------------
     ROOMS
     ------------------------------------------------------------------ */
  buildNode(node) {
    const key = "n" + node.id;
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    rec.edge = { ax: node.x, az: node.z, bx: node.x, bz: node.z };
    const R = this.R, H = this.H, t = this.T, W = this.W;
    const S = this.shared, dr = node.dress;
    const cx = node.x, cz = node.z, full = R + 2 * t;
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const wallMat = this.hash(node.id, 7, 3) < 0.5 ? S.wallA : S.wallB;

    // floor (top face at y = 0) and the drop ceiling slab (underside at y = H)
    this.texBox(rec, S.carpet, cx, -0.1, cz, full, 0.2, full);
    this.collider(rec, cx - full / 2, -0.5, cz - full / 2, cx + full / 2, 0.02, cz + full / 2);
    this.texBox(rec, S.ceil, cx, H + 0.1, cz, full, 0.2, full);
    this.collider(rec, cx - full / 2, H, cz - full / 2, cx + full / 2, H + 0.2, cz + full / 2);

    // walls, one side at a time, cut around corridor openings and windows
    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d][0], dz = DIRS[d][1];
      const alongZ = dx !== 0;                       // this wall runs along z
      const L0 = alongZ ? -(R / 2 + t) : -R / 2, L1 = alongZ ? (R / 2 + t) : R / 2;
      const dist = R / 2 + t / 2;
      const at = (l, dd) => alongZ ? { x: cx + dx * dd, z: cz + l } : { x: cx + l, z: cz + dz * dd };
      const piece = (l0, l1, y0, y1, solid) => {
        const len = l1 - l0;
        if (len < 0.01 || y1 - y0 < 0.01) return;
        const p = at((l0 + l1) / 2, dist);
        const sx = alongZ ? t : len, sz = alongZ ? len : t;
        if (solid) this.solidBox(rec, wallMat, p.x, (y0 + y1) / 2, p.z, sx, y1 - y0, sz, true);
        else this.texBox(rec, wallMat, p.x, (y0 + y1) / 2, p.z, sx, y1 - y0, sz);
      };
      const cut = (l0, l1, y0, y1) => {              // collider only
        const p = at((l0 + l1) / 2, dist);
        const sx = alongZ ? t : l1 - l0, sz = alongZ ? l1 - l0 : t;
        this.collider(rec, p.x - sx / 2, y0, p.z - sz / 2, p.x + sx / 2, y1, p.z + sz / 2);
      };
      const open = node.open[d];
      const wins = dr.windows.filter(w => w.d === d);
      const openings = [];
      if (open) openings.push({ l0: -W / 2, l1: W / 2, y0: 0, y1: 2.2, type: "hall" });
      for (const w of wins) openings.push({ l0: w.c - 1.1, l1: w.c + 1.1, y0: 0.9, y1: 2.3, type: "window", w });
      openings.sort((a, b) => a.l0 - b.l0);
      let cursor = L0;
      for (const o of openings) {
        piece(cursor, o.l0, 0, H, true);
        if (o.type === "hall") {
          piece(o.l0, o.l1, o.y1, H, false);
          cut(o.l0, o.l1, o.y1, H);                   // header: keeps a jump out of the opening
        } else {
          piece(o.l0, o.l1, 0, o.y0, false);          // sill wall
          piece(o.l0, o.l1, o.y1, H, false);          // header wall
          cut(o.l0, o.l1, 0, H);                      // the glass is solid
          this.buildWindow(rec, node, d, o.w, at, dist);
        }
        cursor = o.l1;
      }
      piece(cursor, L1, 0, H, true);

      // baseboard and the darker carpet along the wall, everywhere except across a corridor
      const spans = [];
      let c2 = L0;
      for (const o of openings.filter(q => q.type === "hall")) { spans.push([c2, o.l0]); c2 = o.l1; }
      spans.push([c2, L1]);
      for (const [a, b] of spans) {
        if (b - a < 0.05) continue;
        const p = at((a + b) / 2, R / 2 - 0.015);
        this.deco(rec, S.base, p.x, 0.05, p.z, alongZ ? 0.03 : b - a, 0.1, alongZ ? b - a : 0.03);
        const lo = Math.max(a, alongZ ? -R / 2 : -R / 2), hi = Math.min(b, R / 2);
        if (hi - lo > 0.3) {
          const q = at((lo + hi) / 2, R / 2 - 0.45);
          this.floorDecal(rec, S.shade, q.x, q.z, hi - lo, 0.9, dx, dz, 0.006);
        }
      }
      // a worn path from the middle of the room out through each corridor
      if (open) {
        const q = at(0, R / 4);
        this.floorDecal(rec, S.path, q.x, q.z, 1.5, R / 2 + 0.6, dx, dz, 0.004);
      }
    }
    // ceiling: panels set into the grid, missing and stained tiles
    for (const p of dr.panels) {
      this.deco(rec, p.on ? S.panelOn : S.panelOff, p.x, H - 0.02, p.z, 1.0, 0.04, 0.5);
      if (p.on) this.addFixture(rec, p.x, H - 0.4, p.z, "panel", 3.6, 14, 0xffe2b4, p.bad);
    }
    for (const c of dr.missing) {
      const m = new THREE.Mesh(this.planeGeo, S.black);
      m.rotation.x = Math.PI / 2; m.scale.set(0.46, 0.46, 1); m.position.set(c.x, H - 0.003, c.z);
      rec.group.add(m);
    }
    for (const c of dr.stained) {
      const m = new THREE.Mesh(this.planeGeo, S.ceilStain);
      m.rotation.x = Math.PI / 2; m.scale.set(0.46, 0.46, 1); m.position.set(c.x, H - 0.003, c.z);
      rec.group.add(m);
    }

    // furniture
    if (dr.desk) this.buildDesk(rec, node, dr.desk);
    if (dr.cooler) this.buildCooler(rec, dr.cooler);
    if (dr.worn) {
      this.floorDecal(rec, S.patch, dr.worn.x, dr.worn.z, 1.9, 1.0, dr.worn.alongZ ? 0 : 1, dr.worn.alongZ ? 1 : 0, 0.005);
    }

    // doors
    if (node.arriveSide >= 0) this.buildDoor(rec, node, node.arriveSide, "sealed");
    if (node.backSide >= 0) this.buildDoor(rec, node, node.backSide, "back");
    if (node.fwdSide >= 0) this.buildDoor(rec, node, node.fwdSide, "forward");

    // pickups (almond water everywhere, one rare energy bar), capped in the loaded area
    this.placeSites(rec, dr.sites);

    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  buildWindow(rec, node, d, w, at, dist) {
    const S = this.shared, R = this.R, t = this.T;
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const dx = DIRS[d][0], dz = DIRS[d][1], alongZ = dx !== 0;
    const face = Math.atan2(-dx, -dz);                  // plane normal points into the room
    const y0 = 0.9, y1 = 2.3, ww = 2.2, hh = y1 - y0;
    const p = at(w.c, dist);
    const place = (mesh, ox, oy, oz) => { mesh.position.set(p.x + ox, oy, p.z + oz); rec.group.add(mesh); return mesh; };
    // frame: sill ledge, head rail and two jambs
    const sill = this.deco(rec, S.frame, p.x - dx * 0.05, y0 + 0.025, p.z - dz * 0.05,
      alongZ ? t + 0.1 : ww + 0.2, 0.05, alongZ ? ww + 0.2 : t + 0.1);
    const head = this.deco(rec, S.frame, p.x, y1 - 0.025, p.z, alongZ ? 0.08 : ww, 0.05, alongZ ? ww : 0.08);
    for (const s of [-1, 1]) {
      const lat = at(w.c + s * (ww / 2 - 0.025), dist);
      this.deco(rec, S.frame, lat.x, (y0 + y1) / 2, lat.z, alongZ ? 0.08 : 0.05, hh, alongZ ? 0.05 : 0.08);
    }
    if (w.blackout) {
      // blacked out from inside: a black plate flush with the glass
      const m = new THREE.Mesh(this.planeGeo, S.black);
      m.scale.set(ww, hh, 1); m.rotation.y = face;
      place(m, -dx * 0.02, (y0 + y1) / 2, -dz * 0.02);
      return;
    }
    // The pane, with rain running down it. Each pane gets its own UV offset so the
    // streaks differ from window to window even though the layers are shared.
    const geo = new THREE.PlaneGeometry(ww, hh);
    const uv = geo.attributes.uv;
    const ou = this.hash(node.id, Math.round(w.c * 10), 11), ov = this.hash(node.id, Math.round(w.c * 10), 12);
    for (let i = 0; i < (uv.count || 0); i++) uv.setXY(i, uv.getX(i) * 1.0 + ou, uv.getY(i) * 1.4 + ov);
    uv.needsUpdate = true;
    rec.geos.push(geo);
    const variant = Math.floor(this.hash(node.id, Math.round(w.c * 10), 13) * 3) % 3;
    const pane = new THREE.Mesh(geo, S.rain[variant]);
    pane.rotation.y = face;
    place(pane, 0, (y0 + y1) / 2, 0);
    // Behind every pane is the same grey nothing: a shallow box seen from inside.
    const wellDepth = 1.3;
    const well = new THREE.Mesh(this.box, S.well);
    well.scale.set(alongZ ? wellDepth : ww + 0.5, hh + 0.5, alongZ ? ww + 0.5 : wellDepth);
    place(well, dx * (wellDepth / 2 + 0.02), (y0 + y1) / 2, dz * (wellDepth / 2 + 0.02));
    // grey light from the window onto the carpet
    this.addFixture(rec, p.x - dx * 0.9, 1.6, p.z - dz * 0.9, "window", 6.0, 13, 0xa9b8ca, false);
  },

  buildDesk(rec, node, desk) {
    const S = this.shared, p = this.deskSpot(node, desk);
    const L = 1.6, D = 0.8;
    const sx = p.alongZ ? D : L, sz = p.alongZ ? L : D;
    // top, two end panels, and a modesty panel facing the room
    this.deco(rec, S.deskTop, p.x, 0.725, p.z, sx, 0.05, sz);
    for (const s of [-1, 1]) {
      this.deco(rec, S.desk, p.x + p.ox * s * (L / 2 - 0.025), 0.35, p.z + p.oz * s * (L / 2 - 0.025),
        p.alongZ ? D : 0.05, 0.7, p.alongZ ? 0.05 : D);
    }
    this.deco(rec, S.desk, p.x + p.dx * (D / 2 - 0.04), 0.5, p.z + p.dz * (D / 2 - 0.04),
      p.alongZ ? 0.03 : L - 0.1, 0.45, p.alongZ ? L - 0.1 : 0.03);
    this.collider(rec, p.x - sx / 2, 0, p.z - sz / 2, p.x + sx / 2, 0.75, p.z + sz / 2);
    // dead monitor
    if (desk.hasMonitor) {
      const mx = p.x - p.dx * 0.05 + p.ox * 0.2, mz = p.z - p.dz * 0.05 + p.oz * 0.2;
      this.deco(rec, S.monitor, mx, 0.765, mz, 0.22, 0.03, 0.18);
      this.deco(rec, S.monitor, mx, 0.84, mz, 0.05, 0.14, 0.05);
      const body = this.deco(rec, S.monitor, mx, 1.02, mz,
        p.alongZ ? 0.04 : 0.5, 0.32, p.alongZ ? 0.5 : 0.04);
      const face = new THREE.Mesh(this.planeGeo, S.screen);
      face.scale.set(0.45, 0.27, 1);
      face.rotation.y = Math.atan2(-p.dx, -p.dz);
      face.position.set(mx - p.dx * 0.022, 1.02, mz - p.dz * 0.022);
      rec.group.add(face);
    }
    // chair, pushed out and turned a little
    const cxp = p.x - p.dx * (D / 2 + 0.55) + p.ox * 0.15, czp = p.z - p.dz * (D / 2 + 0.55) + p.oz * 0.15;
    const g = new THREE.Group();
    g.position.set(cxp, 0, czp);
    g.rotation.y = (this.hash(node.id, 21, 5) - 0.5) * 1.2 + Math.atan2(-p.dx, -p.dz);
    const part = (mat, x, y, z, a, b, c) => {
      const m = new THREE.Mesh(this.box, mat);
      m.position.set(x, y, z); m.scale.set(a, b, c); g.add(m);
    };
    part(S.chair, 0, 0.45, 0, 0.46, 0.07, 0.46);          // seat
    part(S.chair, 0, 0.72, 0.21, 0.44, 0.5, 0.05);        // back
    part(S.metal, 0, 0.22, 0, 0.06, 0.4, 0.06);           // stem
    part(S.metal, 0, 0.04, 0, 0.5, 0.04, 0.5);            // base
    rec.group.add(g);
    this.collider(rec, cxp - 0.26, 0, czp - 0.26, cxp + 0.26, 0.95, czp + 0.26);
  },

  buildCooler(rec, c) {
    const S = this.shared;
    this.deco(rec, S.cooler, c.x, 0.5, c.z, 0.38, 1.0, 0.38);
    this.deco(rec, S.coolerDark, c.x, 0.62, c.z, 0.3, 0.12, 0.4);          // tap recess
    this.deco(rec, S.coolerDark, c.x, 0.05, c.z, 0.4, 0.1, 0.4);           // plinth
    this.collider(rec, c.x - 0.2, 0, c.z - 0.2, c.x + 0.2, 1.02, c.z + 0.2);
  },

  buildDoor(rec, node, d, kind) {
    const S = this.shared, R = this.R, half = R / 2;
    const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const dx = DIRS[d][0], dz = DIRS[d][1];
    const alongX = dz !== 0;                         // wall runs along x
    const doorSide = alongX ? dz : dx;
    const cx = node.x, cz = node.z, leafW = 0.92;
    // frame and a black void behind the leaf, both flush with the wall
    const fx = alongX ? cx : cx + doorSide * (half - 0.015), fz = alongX ? cz + doorSide * (half - 0.015) : cz;
    this.deco(rec, S.doorFrame, fx, 1.1, fz, alongX ? leafW + 0.18 : 0.03, 2.2, alongX ? 0.03 : leafW + 0.18);
    const vx = alongX ? cx : cx + doorSide * (half - 0.03), vz = alongX ? cz + doorSide * (half - 0.03) : cz;
    this.deco(rec, S.black, vx, 1.03, vz, alongX ? leafW : 0.03, 2.06, alongX ? 0.03 : leafW);
    if (kind === "sealed") {
      // the door you arrived by: shut for good. A plain leaf in the frame, no handle, no mark, no trigger.
      const sx = alongX ? cx : cx + doorSide * (half - 0.09), sz = alongX ? cz + doorSide * (half - 0.09) : cz;
      this.deco(rec, S.doorLeaf, sx, 1.03, sz, alongX ? leafW : 0.06, 2.05, alongX ? 0.06 : leafW);
      return;
    }
    const depth = doorSide * (half - 0.09);
    const hx = alongX ? cx - leafW / 2 : cx + depth, hz = alongX ? cz + depth : cz - leafW / 2;
    const pivot = new THREE.Group();
    pivot.position.set(hx, 0, hz);
    const leaf = new THREE.Mesh(this.box, S.doorLeaf);
    leaf.scale.set(alongX ? leafW : 0.06, 2.05, alongX ? 0.06 : leafW);
    leaf.position.set(alongX ? leafW / 2 : 0, 1.03, alongX ? 0 : leafW / 2);
    pivot.add(leaf);
    const handle = new THREE.Mesh(this.box, S.handle);
    handle.scale.set(alongX ? 0.16 : 0.08, 0.1, alongX ? 0.08 : 0.16);
    handle.position.set(alongX ? leafW * 0.8 : -doorSide * 0.06, 1.05, alongX ? -doorSide * 0.06 : leafW * 0.8);
    pivot.add(handle);
    rec.group.add(pivot);
    const door = {
      kind, pivot, open: 0, used: false, gone: false,
      x: alongX ? cx : cx + doorSide * half, z: alongX ? cz + doorSide * half : cz,
      swing: alongX ? (doorSide > 0 ? 1 : -1) : (doorSide > 0 ? -1 : 1)
    };
    rec.doors.push(door);
    const lx = cx + dx * (half - 0.1), lz = cz + dz * (half - 0.1);
    if (kind === "back") {
      // small plaque over the door: this one is the way back to the elevator
      const m = new THREE.Mesh(this.planeGeo, S.plaqueBack);
      m.scale.set(0.7, 0.13, 1);
      m.rotation.y = Math.atan2(-dx, -dz);
      m.position.set(lx, 2.35, lz);
      rec.group.add(m);
    } else {
      // a warm strip over the forward door so it can be found from across a dark room
      this.deco(rec, S.panelOn, lx, 2.32, lz, alongX ? 0.7 : 0.06, 0.05, alongX ? 0.06 : 0.7);
      this.addFixture(rec, cx + dx * (half - 0.7), 2.2, cz + dz * (half - 0.7), "door", 2.6, 8, 0xffd9a0, false);
    }
  },

  // Almond water and the rare energy bar. At most 5 bottles in the loaded area.
  placeSites(rec, sites) {
    if (typeof PickupSystem === "undefined" || !PickupSystem.group) return;
    for (const s of sites) {
      if (this.taken[s.id]) continue;
      if (s.kind === "almond") {
        let live = 0;
        for (const p of PickupSystem.list) if (p.l4 && p.kind === "almond" && !p.taken) live++;
        if (live >= 5) continue;                      // will be offered again if this room streams in later
      }
      PickupSystem._addMesh(s.kind, s.x, s.z);
      const p = PickupSystem.list[PickupSystem.list.length - 1];
      p.l4 = s.id;
      p.mesh.position.y = s.y;
      rec.pickups.push(p);
    }
  },

  /* ------------------------------------------------------------------
     CORRIDORS
     ------------------------------------------------------------------ */
  buildEdge(edge) {
    const key = String(edge.id);
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    rec.edge = edge;
    const S = this.shared, R = this.R, H = this.H, t = this.T, W = this.W;
    const L = this.S - R - 2 * t;                    // between the outer faces of the two rooms
    const alongX = edge.d % 2 === 0;
    const mx = (edge.ax + edge.bx) / 2, mz = (edge.az + edge.bz) / 2;
    const sx = alongX ? L : W + 2 * t, sz = alongX ? W + 2 * t : L;
    this.texBox(rec, S.carpetHall, mx, -0.1, mz, sx, 0.2, sz);
    this.collider(rec, mx - sx / 2, -0.5, mz - sz / 2, mx + sx / 2, 0.02, mz + sz / 2);
    this.texBox(rec, S.ceil, mx, H + 0.1, mz, sx, 0.2, sz);
    this.collider(rec, mx - sx / 2, H, mz - sz / 2, mx + sx / 2, H + 0.2, mz + sz / 2);
    const wallMat = this.hash(edge.id, 9, 4) < 0.5 ? S.wallA : S.wallB;
    for (const s of [-1, 1]) {
      const off = s * (W / 2 + t / 2);
      const x = alongX ? mx : mx + off, z = alongX ? mz + off : mz;
      this.solidBox(rec, wallMat, x, H / 2, z, alongX ? L : t, H, alongX ? t : L, true);
      const bo = s * (W / 2 - 0.015);
      this.deco(rec, S.base, alongX ? mx : mx + bo, 0.05, alongX ? mz + bo : mz, alongX ? L : 0.03, 0.1, alongX ? 0.03 : L);
    }
    // one panel in the middle of the corridor, usually dead
    const on = this.hash(edge.id, 5, 6) < 0.25;
    this.deco(rec, on ? S.panelOn : S.panelOff, mx, H - 0.02, mz, alongX ? 1.0 : 0.5, 0.04, alongX ? 0.5 : 1.0);
    if (on) this.addFixture(rec, mx, H - 0.4, mz, "panel", 3.6, 14, 0xffe2b4, this.hash(edge.id, 6, 7) < 0.3);
    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  // Grow the office ahead of the player. Deterministic from the seed.
  extend(px, pz) {
    if (!this._route || !this._cells) return;
    const S = this.S, DIRS = this.DIRS || [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const need = Math.ceil(Math.max(0, pz) / S) + 8;
    const cells = this._cells, nodes = this._nodes, edges = this._edges, route = this._route;
    const key = (i, j) => i + "," + j;
    const addNode = (i, j, role) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, role, open: [false, false, false, false],
        occ: [false, false, false, false], edges: [], dress: { panels: [], missing: [], stained: [], desk: null, cooler: null, worn: null, windows: [], sites: [] },
        backSide: -1, arriveSide: -1, fwdSide: -1 };
      nodes.push(n); cells.set(key(i, j), n); return n;
    };
    const link = (a, b, d) => {
      a.open[d] = true; b.open[(d + 2) % 4] = true;
      const e = { id: edges.length, a: a.id, b: b.id, d, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
    };
    let cur = route[route.length - 1];
    while (route.length < need) {
      const h = this.hash(route.length, 1, 5);
      let d = 1;
      if (h > 0.75) d = h > 0.88 ? 0 : 2;
      const di = DIRS[d];
      if (cells.has(key(cur.i + di[0], cur.j + di[1]))) d = 1;
      const di2 = DIRS[d];
      if (cells.has(key(cur.i + di2[0], cur.j + di2[1]))) break;
      const nx = addNode(cur.i + di2[0], cur.j + di2[1], "spine");
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
  stream(force) {
    if (!this.active || !this.group) return;
    const px = Player.position.x, pz = Player.position.z;
    this.extend(px, pz);
    const key = Math.floor(px / 8) + "," + Math.floor(pz / 8);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    // Fog ends at 50 m, so rooms past ~44 m are hardly visible anyway. Windows make rooms mesh-heavy.
    const BUILD = 44, DROP = 60;
    const near = [];
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d < BUILD && !this.segments.has("n" + n.id)) near.push({ d, n });
    }
    for (const e of this.edges) {
      const d = Math.hypot((e.ax + e.bx) / 2 - px, (e.az + e.bz) / 2 - pz);
      if (d < BUILD && !this.segments.has(String(e.id))) near.push({ d, e });
    }
    near.sort((a, b) => a.d - b.d);
    for (const it of near) { if (it.n) this.buildNode(it.n); else this.buildEdge(it.e); }
    for (const [k, rec] of Array.from(this.segments.entries())) {
      const e = rec.edge;
      const d = Math.hypot((e.ax + e.bx) / 2 - px, (e.az + e.bz) / 2 - pz);
      if (d > DROP) { this.disposeSegment(rec); this.segments.delete(k); }
    }
    // the collider array is read live by the Hound and the Smiler: rebuild it in place
    this.colliders.length = 0;
    this.doors = [];
    this.fixtures = [];
    for (const rec of this.segments.values()) {
      for (const c of rec.colliders) this.colliders.push(c);
      for (const d of rec.doors) this.doors.push(d);
      for (const f of rec.fixtures) this.fixtures.push(f);
    }
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
    if (best.kind === "back" && typeof HUD !== "undefined") HUD.toast("LEVEL 3");
    return true;
  },

  prompt() {
    const p = Player.position;
    for (const d of this.doors) {
      if (d.used || Math.hypot(p.x - d.x, p.z - d.z) > 2.0) continue;
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(d.kind === "back" ? "E  RETURN TO LEVEL 3" : "E  OPEN DOOR");
      return;
    }
  },

  finish() {
    if (this._ended) return;
    this._ended = true;
    GameState.exitReached = true;
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 4 CLEARED");
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

    // rain runs down every pane
    for (const v of this.rainVariants) {
      v.tex.offset.y = (v.tex.offset.y + v.speed * dt) % 1;
    }

    // light pool: re-aim at the nearest fixtures. Window light is steady; a few panels stutter softly.
    this._poolT -= dt;
    if (this._poolT <= 0) { this._poolT = 0.2; this.assignLights(); }
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) continue;
      const t = this.time + f.ph;
      let k = 1;
      if (f.kind === "panel") {
        const sN = Math.sin(t * 19.0) * Math.sin(t * 6.1);
        k = f.bad ? (sN > 0.4 ? 0.45 : 1) : (sN > 0.97 ? 0.8 : 1);
      } else if (f.kind === "window") {
        k = 0.94 + 0.06 * Math.sin(t * 0.9);          // clouds
      }
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
          setTimeout(() => { if (typeof Level3 !== "undefined") Level3.enter(sd, 4); }, 0);
        } else if (typeof Level5 !== "undefined" && Level5.enter) {
          // the forward door now leads on to Level 5; finish() is only the fallback if it is missing
          const sd = this.seed;
          setTimeout(() => Level5.enter(sd, 4), 0);
        } else {
          this.finish();
        }
      }
    }

    // faint music from beyond the forward door, only when you are near it
    if (this.exitPos && typeof AudioSystem !== "undefined" && AudioSystem.ctx && AudioSystem._tone) {
      const dist = Math.hypot(p.x - this.exitPos.x, p.z - this.exitPos.z);
      if (dist < 30) {
        this._musicT -= dt;
        if (this._musicT <= 0) {
          this._musicT = 1.5;
          const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 698.46];
          const f = notes[this._musicIdx++ % notes.length];
          const gain = 0.04 * Math.pow(1 - dist / 30, 2);
          AudioSystem._tone(f, "sine", 1.6, Math.max(0.0005, gain), "ambient");
          AudioSystem._tone(f * 2, "sine", 1.2, Math.max(0.0003, gain * 0.35), "ambient");
        }
      }
    }

    // very quiet building noises, far between
    this._sfxT -= dt;
    if (this._sfxT <= 0) {
      this._sfxT = 14 + Math.random() * 16;
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
