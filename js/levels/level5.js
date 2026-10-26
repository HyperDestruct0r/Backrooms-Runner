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
   One way back, in the lobby (to the office). One way forward, at the far end (ends the run).

   Spawn is the exact centre of the lobby at baseY. Nothing is placed within 2.5 m of it.
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
  doors: [],
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  exitPos: null,      // just inside the forward door (console `level 5 exit`)
  backPos: null,      // just inside the back door
  baseY: 0,
  S: 16,              // lattice spacing between space centres
  T: 0.3,             // wall thickness
  W: 3.6,             // hall width (interior)
  EH: 3.0,            // hall ceiling height
  ROOM: 5.0,          // guest room interior size
  DIRS: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  TYPES: {
    lobby: { R: 10, H: 4.4 },
    hall: { R: 3.6, H: 3.0 },
    end: { R: 5.0, H: 3.0 },
    nook: { R: 3.6, H: 3.0 }
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
    const a = this.nodes[e.a], b = this.nodes[e.b], D = this.DIRS[e.d];
    const fa = a.R / 2 + this.T, fb = b.R / 2 + this.T;
    const L = this.S - fa - fb;
    const m = fa + L / 2;
    return { mx: a.x + D[0] * m, mz: a.z + D[1] * m, L, alongX: e.d % 2 === 0 };
  },

  _generate(seed, force) {
    const r = this.rng((seed ^ 0x7E57A1C5) >>> 0);
    const S = this.S, T = this.T, DIRS = this.DIRS;
    const cells = new Map(), nodes = [], edges = [];
    const key = (i, j) => i + "," + j;
    const addNode = (i, j, type) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, type: "", R: 0, H: 0,
        open: [false, false, false, false], edges: [], backSide: -1, fwdSide: -1 };
      this.setType(n, type);
      nodes.push(n); cells.set(key(i, j), n); return n;
    };
    const link = (a, b, d) => {
      a.open[d] = true; b.open[(d + 2) % 4] = true;
      const e = { id: edges.length, a: a.id, b: b.id, d, room: null };
      edges.push(e); a.edges.push(e.id); b.edges.push(e.id);
      return e;
    };

    // the spine: a self-avoiding walk that likes to keep going straight
    const count = 8 + Math.floor(r() * 5);
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
    this.setType(cur, "end");
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

    // the way back: lobby wall opposite the hall. The way on: landing wall opposite the hall.
    nodes[0].backSide = (nodes[0].open.indexOf(true) + 2) % 4;
    cur.fwdSide = (cur.open.indexOf(true) + 2) % 4;

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
    const lobby = nodes[0], endN = cur;
    this.spawn.set(lobby.x, this.baseY, lobby.z);
    const bd = DIRS[lobby.backSide], fd = DIRS[endN.fwdSide];
    // face into the hotel: away from the back door (forward is (-sin yaw, -cos yaw))
    this.spawnYaw = Math.atan2(bd[0], bd[1]);
    this.backPos = new THREE.Vector3(lobby.x + bd[0] * (lobby.R / 2 - 1.8), this.baseY, lobby.z + bd[1] * (lobby.R / 2 - 1.8));
    this.exitPos = new THREE.Vector3(endN.x + fd[0] * (endN.R / 2 - 1.8), this.baseY, endN.z + fd[1] * (endN.R / 2 - 1.8));
    this.endNode = endN;
    this.infoText = "SPACES " + spineCount + " · STUBS " + stubs + " · GUEST ROOMS " + rooms.length;
    return true;
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
      plaqueFwd: new THREE.MeshBasicMaterial({ map: this.plaqueTex("WAY ON") })
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
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.time = 0;
    this._ended = false;
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
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
    if (typeof CameraRig !== "undefined" && CameraRig.apply) CameraRig.apply(0);
    this.attachEntities();
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 5 · THE HOTEL");
  },

  // At most one entity: a Hound, and only on an even seed. Never a Smiler.
  attachEntities() {
    if (this.seed % 2 === 0) {
      if (typeof HoundSystem !== "undefined") {
        HoundSystem.attach({ colliders: this.colliders, cap: 1, graceSeconds: 8, graceRadius: 30, minDist: 18, maxDist: 36, seed: this.seed });
      }
    } else if (typeof HoundSystem !== "undefined") HoundSystem.detach();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.detach();
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
    const lobby = node.type === "lobby";
    const wallMat = lobby ? S.wallLobby : S.wallHall;

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
        const p = at((l0 + l1) / 2, dist);
        this.solidBox(rec, wallMat, p.x, (y0 + y1) / 2, p.z, alongZ ? t : len, y1 - y0, alongZ ? len : t);
      };
      if (node.open[d]) {
        piece(L0, -W / 2, 0, H);
        piece(-W / 2, W / 2, this.EH, H);        // header over the opening (lobby only: halls are EH tall)
        piece(W / 2, L1, 0, H);
      } else {
        piece(L0, L1, 0, H);
      }
    }

    if (lobby) this.dressLobby(rec, node);
    else if (node.type === "end") this.dressLanding(rec, node);
    else this.dressJunction(rec, node);

    if (node.backSide >= 0) this.buildDoor(rec, node, node.backSide, "back");
    if (node.fwdSide >= 0) this.buildDoor(rec, node, node.fwdSide, "forward");
    this.group.add(rec.group);
    this.segments.set(key, rec);
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
    const chY = H - 0.9;
    this.cyl(rec, S.brass, cx, H - 0.45, cz, 0.02, 0.9);
    this.cyl(rec, S.brass, cx, chY, cz, 0.75, 0.05);
    this.cyl(rec, S.brass, cx, chY - 0.12, cz, 0.12, 0.2);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      this.sph(rec, S.lampOn, cx + Math.cos(a) * 0.72, chY + 0.1, cz + Math.sin(a) * 0.72, 0.07);
    }
    this.sph(rec, S.lampOn, cx, chY - 0.28, cz, 0.12);
    this.addFixture(rec, cx, chY - 0.1, cz, "chandelier", 7.5, 26, 0xffc890);

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
    let w = wall(-R / 2, 3.2, 1, 0);  this.picture(rec, w.px, w.pz, w.nx, w.nz, 0, 2.0, 0, 1.0, 0.72);
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
    ebox(S.doorLeaf, -0.74, 1.04, s * (q0 + 0.45), 0.06, 2.08, 0.95);

    // bed: head to the far wall, along the left side
    const bp = -1.2, bq = q0 + 3.85;
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
    // a picture over the bed
    const fc = E(bp, s * (q0 + D));
    const alongX = this.edgeGeom(edge).alongX;
    this.picture(rec, fc.x, fc.z, alongX ? 0 : -s, alongX ? -s : 0, 0, 1.75, Math.floor(this.hash(edge.id, 5, 6) * 3), 0.8, 0.6);
    // a number by the door, on the hall side
    const num = 100 * (1 + (edge.id % 4)) + 50 + (edge.id % 40);
    const nc = E(1.0, s * W / 2);
    this.wallPlane(rec, this.numberMat(num), nc.x, nc.z, alongX ? 0 : -s, alongX ? -s : 0, 0, 1.75, 0.26, 0.13, 0.03);
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
