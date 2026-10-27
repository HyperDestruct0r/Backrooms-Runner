"use strict";

/* Level 3 — "Electrical Station" (Class 4: unsafe, unsecure, high entity count).

   Built from the Backrooms wiki description:
   - claustrophobic, narrow tunnels of yellow brick with iron doors
   - small pipes along the walls and ceiling (some leak almond water)
   - hallway iron doors that open, and LOCKED iron doors that only show a black void
   - randomly segmented rooms, with hidden electrical rooms (generators, breaker
     boxes, old computers / monitors, fluorescent lights)
   - machinery that is hostile: faulty junctions arc when you walk past
   - exit: an elevator to Level 4, which has to be powered by a button elsewhere
   - entrance: the door at the end of Level 2

   Layout is a lattice graph. Every node is a small square room, every edge is a
   short corridor. Everything is generated from the seed and streamed by distance.

   Lighting note: lights are physically based and the scene has no environment map,
   so materials stay at low metalness and a fixed pool of point lights follows the
   player (the light count never changes, so streaming causes no shader recompiles).

   The elevator leads to Level 4 (the office). Level 4's back door returns here, to the elevator.

   Not done yet: entities (Wretch etc.). */
const Level3 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  segments: new Map(),
  nodes: [],
  edges: [],
  gates: [],
  locked: [],
  arcs: [],
  spawn: new THREE.Vector3(),
  exitPos: null,
  buttonPos: null,
  elevator: null,
  backNode: null,
  powered: false,
  baseY: 0,
  S: 16,        // lattice spacing between room centres
  R: 6,         // room size
  W: 2.6,       // corridor width
  H: 2.9,       // ceiling height
  shared: null,
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  vents: [],
  look: { ambient: 0.8, hemi: 0.5, poolSize: 10, fog: 0x1a140c, fogNear: 6, fogFar: 46 },
  lastKey: "",
  infoText: "",
  time: 0,
  _poolT: 0,
  _sfxT: 3,
  _ventHurt: 0,
  _promptT: 0,
  _arrived: false,

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
      if (this._generate((seed + Math.imul(attempt, 7919)) >>> 0)) return;
    }
    this._generate(seed >>> 0, true);
  },

  _generate(seed, force) {
    const r = this.rng(seed);
    const S = this.S;
    const nodes = [], edges = [];
    const at = new Map();
    const key = (i, j) => i + "," + j;
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const mk = (i, j) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, edges: [], dirs: {}, role: "hall", free: [] };
      nodes.push(n); at.set(key(i, j), n); return n;
    };
    const link = (a, b, main) => {
      const e = {
        id: edges.length, a: a.id, b: b.id, main: !!main,
        ax: a.x, az: a.z, bx: b.x, bz: b.z, len: S,
        alongX: a.z === b.z, gate: false, locked: 0, arc: false, leak: false
      };
      edges.push(e);
      a.edges.push(e.id); b.edges.push(e.id);
      a.dirs[Math.sign(b.i - a.i) + "," + Math.sign(b.j - a.j)] = e.id;
      b.dirs[Math.sign(a.i - b.i) + "," + Math.sign(a.j - b.j)] = e.id;
      return e;
    };
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; }
      return a;
    };
    const freeDirs = (n) => D.filter(d => !at.has(key(n.i + d[0], n.j + d[1])));

    // main route: a long walk that prefers going straight. The level extends further
    // on demand (see extend), so the route here is only the first stretch.
    const want = 20;
    let cur = mk(0, 0);
    const route = [cur];
    let hd = [0, 1];
    while (route.length <= want) {
      let order;
      if (route.length === 1) order = [[0, 1]];
      else order = r() < 0.5 ? [hd].concat(shuffle(D.filter(d => d !== hd))) : shuffle(D);
      let pick = null;
      for (const d of order) {
        if (!at.has(key(cur.i + d[0], cur.j + d[1]))) { pick = d; break; }
      }
      if (!pick) break;
      const next = mk(cur.i + pick[0], cur.j + pick[1]);
      link(cur, next, true);
      route.push(next);
      cur = next; hd = pick;
    }
    if (route.length < 10 && !force) return false;

    const spawnNode = route[0];
    spawnNode.role = "spawn";
    const exitNode = null;

    // dead-end branches off the route. Dead ends are electrical rooms or empty.
    const branch = (from, maxSteps) => {
      const opts = shuffle(freeDirs(from));
      if (!opts.length) return null;
      const d = opts[0];
      const steps = 1 + Math.floor(r() * maxSteps);
      let node = from, last = null;
      for (let s = 0; s < steps; s++) {
        const ni = node.i + d[0], nj = node.j + d[1];
        if (at.has(key(ni, nj))) break;
        const nn = mk(ni, nj);
        link(node, nn, false);
        node = nn; last = nn;
      }
      return last;
    };

    // the button room: roughly halfway along the route
    let buttonNode = null;
    const mid = Math.floor(route.length * 0.5);
    for (let k = 0; k < route.length - 2 && !buttonNode; k++) {
      const idx = 1 + ((mid - 1 + k) % (route.length - 2));
      buttonNode = branch(route[idx], 2);
    }
    if (buttonNode) buttonNode.role = "button";

    for (let i = 1; i < route.length - 1; i++) {
      if (r() < 0.55) {
        const end = branch(route[i], 3);
        if (end && end.role === "hall") end.role = r() < 0.6 ? "electrical" : "dead";
      }
      if (r() < 0.2) {
        const end = branch(route[i], 2);
        if (end && end.role === "hall") end.role = r() < 0.5 ? "electrical" : "dead";
      }
    }

    // a few loops so it is not a pure tree
    for (const n of nodes.slice()) {
      for (const d of [[1, 0], [0, 1]]) {
        const o = at.get(key(n.i + d[0], n.j + d[1]));
        if (!o || n.dirs[d[0] + "," + d[1]] != null) continue;
        if (n.role === "elevator" || o.role === "elevator") continue;
        if (r() < 0.2) link(n, o, false);
      }
    }

    // anything that is a leaf and still plain becomes electrical/dead
    for (const n of nodes) {
      if (n.role === "hall" && n.edges.length === 1) n.role = r() < 0.5 ? "electrical" : "dead";
    }

    // free sides of each node (used for dressing and elevator placement)
    for (const n of nodes) {
      n.free = D.filter(d => n.dirs[d[0] + "," + d[1]] == null);
    }
    // elevator opens onto a free side, preferring straight ahead
    const ahead = hd;
    let elevDir = exitNode.free.find(d => d[0] === ahead[0] && d[1] === ahead[1]) || exitNode.free[0];
    exitNode.elevDir = elevDir || [0, 1];
    exitNode.free = exitNode.free.filter(d => d !== elevDir);

    // per-edge dressing
    for (const e of edges) {
      const first = e.id === 0;
      e.gate = !first && r() < 0.42;
      e.locked = (r() < 0.5 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
      e.arc = !first && r() < (e.main ? 0.14 : 0.24);
      e.leak = r() < 0.35;
      e.pipeSide = r() < 0.5 ? -1 : 1;
      e.flip = r() < 0.5 ? -1 : 1;
      e.steam = !first && r() < 0.2;
    }
    // never put an arc and a gate on the same short corridor
    for (const e of edges) { if (e.arc && e.gate) e.gate = false; if (e.steam && (e.arc || e.gate)) e.steam = false; }

    // The return and the elevator are placed by extend() once the route reaches them.
    let backNode = null;

    this.nodes = nodes;
    this.edges = edges;
    this.backNode = backNode;
    this.seedUsed = seed;
    this.exitNode = exitNode;
    this.buttonNode = buttonNode;
    this.exitPos = new THREE.Vector3(exitNode.x, this.baseY, exitNode.z);
    this.buttonPos = buttonNode ? new THREE.Vector3(buttonNode.x, this.baseY, buttonNode.z) : null;
    this.spawn.set(0, this.baseY, 0);
    this.infoText = "ROOMS " + nodes.length + " · HALLS " + edges.length + " · ROUTE " + route.length +
      (buttonNode ? "" : " · NO BUTTON");
    this._route = route;
    this._at = at;
    this._edges = edges;
    this._nodes = nodes;
    return true;
  },

  // Grow the main route and side branches out to cover the player's position.
  // Deterministic: the same seed always extends the same way.
  extend(px, pz) {
    if (!this._route) return;
    const S = this.S;
    const need = Math.ceil(Math.max(0, pz) / S) + 6;
    const r = this.rng((this.seedUsed || this.seed) ^ 0x9e3779b9);
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const key = (i, j) => i + "," + j;
    const at = this._at, nodes = this._nodes, edges = this._edges, route = this._route;
    const mk = (i, j) => {
      const n = { id: nodes.length, i, j, x: i * S, z: j * S, edges: [], dirs: {}, role: "hall", free: [] };
      nodes.push(n); at.set(key(i, j), n); return n;
    };
    const link = (a, b, main) => {
      const e = {
        id: edges.length, a: a.id, b: b.id, main: !!main,
        ax: a.x, az: a.z, bx: b.x, bz: b.z, len: S,
        alongX: a.z === b.z, gate: false, locked: 0, arc: false, leak: false,
        pipeSide: 1, flip: 1, steam: false
      };
      edges.push(e);
      a.edges.push(e.id); b.edges.push(e.id);
      a.dirs[Math.sign(b.i - a.i) + "," + Math.sign(b.j - a.j)] = e.id;
      b.dirs[Math.sign(a.i - b.i) + "," + Math.sign(a.j - b.j)] = e.id;
      return e;
    };
    let cur = route[route.length - 1];
    let hd = [0, 1];
    while (route.length <= need) {
      const h = this.hash(route.length, 0, 3);
      let pick = hd;
      if (h > 0.72) pick = h > 0.86 ? [1, 0] : [-1, 0];
      if (at.has(key(cur.i + pick[0], cur.j + pick[1]))) pick = [0, 1];
      if (at.has(key(cur.i + pick[0], cur.j + pick[1]))) break;
      const next = mk(cur.i + pick[0], cur.j + pick[1]);
      const e = link(cur, next, true);
      e.gate = h < 0.3; e.arc = h > 0.8; e.leak = h > 0.4 && h < 0.7;
      route.push(next);
      cur = next; hd = pick;
      // side branch
      if (this.hash(next.i, next.j, 7) < 0.4) {
        const side = h > 0.5 ? [1, 0] : [-1, 0];
        if (!at.has(key(next.i + side[0], next.j + side[1]))) {
          const sn = mk(next.i + side[0], next.j + side[1]);
          link(next, sn, false);
          sn.role = this.hash(sn.i, sn.j, 8) < 0.5 ? "electrical" : "dead";
        }
      }
    }
    // place the return at ~100 m and the elevator at ~200 m, once the route is long enough
    const backStep = Math.round(100 / S);
    const exitStep = Math.round(200 / S);
    if (!this.backNode && route.length > backStep) {
      const n = route[backStep];
      n.free = D.filter(d => n.dirs[d[0] + "," + d[1]] == null);
      if (n.free.length) { n.backDir = n.free[n.free.length - 1]; this.backNode = n; }
    }
    if (!this.exitNode && route.length > exitStep) {
      const n = route[exitStep];
      n.role = "elevator";
      n.free = D.filter(d => n.dirs[d[0] + "," + d[1]] == null);
      n.elevDir = n.free[0] || [0, 1];
      this.exitNode = n;
      this.exitPos = new THREE.Vector3(n.x, this.baseY, n.z);
    }
    this.nodes = nodes;
    this.edges = edges;
  },

  /* ------------------------------------------------------------------
     MATERIALS
     ------------------------------------------------------------------ */
  brickTex() {
    const size = 256;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2b2418";
    ctx.fillRect(0, 0, size, size);
    const rowH = 32, bw = 64;
    for (let row = 0; row < size / rowH; row++) {
      const off = (row % 2) * (bw / 2);
      for (let col = -1; col < size / bw + 1; col++) {
        const h = this.hash(row * 31 + col, row * 17 - col, 77);
        const base = 150 + Math.floor(h * 40);
        const rr = base + 30, gg = base + 2 - Math.floor(h * 12), bb = base - 92;
        ctx.fillStyle = "rgb(" + rr + "," + gg + "," + bb + ")";
        ctx.fillRect(col * bw + off + 2, row * rowH + 2, bw - 4, rowH - 4);
        // chips and soot
        for (let k = 0; k < 6; k++) {
          const hx = this.hash(row * 7 + col + k, k * 13 + row, 91);
          const hy = this.hash(k * 5 + col, row * 3 + k, 92);
          ctx.fillStyle = hx > 0.5 ? "rgba(20,14,6,0.28)" : "rgba(255,230,160,0.10)";
          ctx.fillRect(col * bw + off + 4 + hx * (bw - 12), row * rowH + 4 + hy * (rowH - 12), 3 + hy * 5, 2 + hx * 3);
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },

  grimeTex(base) {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const d = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const h = n - Math.floor(n);
        const v = base + (h - 0.5) * 22 + (h > 0.93 ? 18 : 0) - (h < 0.05 ? 20 : 0);
        const i = (y * size + x) * 4;
        d[i] = v + 4; d[i + 1] = v + 1; d[i + 2] = v - 6; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  },

  // Small engraved-looking plate, drawn on a canvas.
  plaqueTex(text) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 48;
    const g = c.getContext("2d");
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
    this.shared = {
      brick: std({ map: this.brickTex(), color: 0xe0d8c8, roughness: 0.95, metalness: 0 }),
      floor: std({ map: this.grimeTex(130), color: 0xc8c0b0, roughness: 0.98, metalness: 0 }),
      ceil: std({ map: this.grimeTex(150), color: 0xc0b8a8, roughness: 0.95, metalness: 0 }),
      pipe: std({ color: 0xa0a6aa, roughness: 0.5, metalness: 0.15 }),
      pipeRust: std({ color: 0x9a6a4c, roughness: 0.65, metalness: 0.1 }),
      hotPipe: std({ color: 0xd8602f, emissive: 0x8a2c0c, emissiveIntensity: 0.9, roughness: 0.45, metalness: 0.1 }),
      iron: std({ color: 0x4c5054, roughness: 0.55, metalness: 0.2 }),
      ironLight: std({ color: 0x70767a, roughness: 0.5, metalness: 0.2 }),
      voidDark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      tube: new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false }),
      tubeDead: std({ color: 0x4a4640, roughness: 0.8 }),
      generator: std({ color: 0x78906a, roughness: 0.6, metalness: 0.15 }),
      panel: std({ color: 0x9aa0a4, roughness: 0.5, metalness: 0.15 }),
      screen: new THREE.MeshBasicMaterial({ color: 0x5cffa8, toneMapped: false }),
      screenOff: new THREE.MeshBasicMaterial({ color: 0x0a1410 }),
      desk: std({ color: 0x5c5040, roughness: 0.85 }),
      warn: new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false }),
      warnOff: std({ color: 0x5a4a28, roughness: 0.6 }),
      red: new THREE.MeshBasicMaterial({ color: 0xff3a2a, toneMapped: false }),
      green: new THREE.MeshBasicMaterial({ color: 0x3aff6a, toneMapped: false }),
      arc: new THREE.MeshBasicMaterial({ color: 0xbfe4ff, toneMapped: false }),
      steam: new THREE.MeshBasicMaterial({ color: 0xe8ecee, transparent: true, opacity: 0, depthWrite: false }),
      puddle: new THREE.MeshStandardMaterial({ color: 0xb89a50, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.55 }),
      elevator: std({ color: 0xa8acb0, roughness: 0.4, metalness: 0.25 }),
      elevatorIn: std({ color: 0x6a6e72, roughness: 0.5, metalness: 0.15 }),
      plaque: new THREE.MeshBasicMaterial({ map: this.plaqueTex("OFFICE SECTOR") })
    };
    this.pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.planeGeo = new THREE.PlaneGeometry(1, 1);
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of this.segments.values()) this.disposeSegment(rec);
    this.segments.clear();
    this.vents = [];
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = [];
    this.poolFx = [];
    this.fixtures = [];
    this.vents = [];
    this.colliders.length = 0;
    this.gates = [];
    this.locked = [];
    this.arcs = [];
    this.nodes = [];
    this.edges = [];
    this.elevator = null;
    this.group = null;
    this.active = false;
    this.powered = false;
    this._arrived = false;
    this.lastKey = "";
    this.time = 0;
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    // Level 4 hangs off this reset, so every path that already resets Level 3 clears it too.
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") {
      CameraRig.camera.far = CONFIG.cameraFar;
      CameraRig.camera.updateProjectionMatrix();
    }
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset && PickupSystem.group) PickupSystem.reset();
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos || []) g.dispose();
    if (rec.gates) this.gates = this.gates.filter(x => rec.gates.indexOf(x) < 0);
    if (rec.locked) this.locked = this.locked.filter(x => rec.locked.indexOf(x) < 0);
    if (rec.arcs) this.arcs = this.arcs.filter(x => rec.arcs.indexOf(x) < 0);
    if (rec.vents) this.vents = this.vents.filter(x => rec.vents.indexOf(x) < 0);
  },

  enter(seed, from) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    this.reset();
    this.seed = seed >>> 0;
    this.generate(this.seed);
    this.materialSet();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level3_ElectricalStation";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0xd8c090, 0x6a5a40, lk.hemi);
    const amb = new THREE.AmbientLight(0xb8a47c, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    for (let i = 0; i < lk.poolSize; i++) {
      const L = new THREE.PointLight(0xffd89a, 0, 16, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 80; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 3;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = Math.PI;
    // Coming back from Level 4 means the elevator already worked.
    if (from === 4) this.powered = true;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = from === 4 ? "Objective: reach the elevator" : "Objective: restore power, find the elevator";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 3";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this.stream(true);
    this.assignLights();
    this.placeBottles();
    Player.position.copy(this.spawn);
    Player.yaw = Math.PI;
    if (from === 4 && this.exitPos) this.stepOutOfElevator();
    if (typeof HoundSystem !== "undefined") {
      HoundSystem.attach({
        colliders: this.colliders,
        cap: 4,
        graceSeconds: 5,
        graceRadius: 50,
        minDist: 18,
        maxDist: 42,
        seed: this.seed
      });
    }
    if (typeof SmilerSystem !== "undefined") {
      SmilerSystem.attach({
        colliders: this.colliders,
        cap: 3,
        graceSeconds: 5,
        minDist: 15,
        maxDist: 32,
        seed: this.seed,
        margin: 0.55,
        allow: () => true,
        isDark: (x, z) => this.isDarkAt(x, z)
      });
    }
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 3 · ELECTRICAL STATION");
  },

  // Stand just outside the elevator doors, facing into the room. Not inside the
  // car, or the elevator would send the player straight back.
  stepOutOfElevator() {
    // the exit room is far from the spawn, so it has to be streamed in before it can be found
    Player.position.copy(this.exitPos);
    this.stream(true);
    if (this.elevator) {
      const ux = this.elevator.doorX - this.elevator.innerX, uz = this.elevator.doorZ - this.elevator.innerZ;
      const u = Math.hypot(ux, uz) || 1;
      Player.position.set(this.elevator.doorX + ux / u * 1.4, this.baseY, this.elevator.doorZ + uz / u * 1.4);
      Player.yaw = Math.atan2(-ux / u, -uz / u);
    } else {
      Player.position.copy(this.exitPos);
    }
    Player.velocity.set(0, 0, 0);
    this.stream(true);
    this.assignLights();
  },

  placeBottles() {
    if (typeof PickupSystem === "undefined") return;
    if (!PickupSystem.group) {
      PickupSystem.group = new THREE.Group();
      if (scene) scene.add(PickupSystem.group);
    }
    for (const n of this.nodes) {
      if (n.role !== "electrical") continue;
      if (this.hash(n.id, 3, 5) > 0.55) continue;
      PickupSystem._addMesh("almond", n.x + 1.2, n.z - 1.2);
    }
  },

  /* ------------------------------------------------------------------
     GEOMETRY HELPERS
     ------------------------------------------------------------------ */
  // Box with real-size geometry and UVs scaled so bricks tile at ~2 m.
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

  solid(rec, mat, x, y, z, sx, sy, sz, textured) {
    if (textured) this.texBox(rec, mat, x, y, z, sx, sy, sz);
    else {
      const m = new THREE.Mesh(this.box, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      rec.group.add(m);
    }
    const c = {
      min: new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
      max: new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2)
    };
    rec.colliders.push(c);
    return c;
  },

  deco(rec, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    rec.group.add(m);
    return m;
  },

  pipeRun(rec, mat, x, y, z, alongX, len, radius) {
    const p = new THREE.Mesh(this.pipeGeo, mat);
    p.scale.set(radius, len, radius);
    if (alongX) p.rotation.z = Math.PI / 2; else p.rotation.x = Math.PI / 2;
    p.position.set(x, y, z);
    rec.group.add(p);
    return p;
  },

  newRec() {
    return { group: new THREE.Group(), colliders: [], lights: [], fixtures: [], vents: [], geos: [], gates: [], locked: [], arcs: [], edge: null };
  },

  // Register a light fixture. The actual PointLights are a small pool (see assignLights).
  addLight(rec, x, y, z, intensity, dist) {
    const info = {
      x, y, z, base: intensity * 3.4, dist: dist + 4,
      ph: this.hash(Math.round(x * 3), Math.round(z * 3), 3) * 40,
      bad: this.hash(Math.round(x * 3), Math.round(z * 3), 9) < 0.3
    };
    rec.fixtures.push(info);
    return info;
  },

  // Dark when no working fixture in the fixture list is within 8 m.
  isDarkAt(x, z) {
    for (const f of this.fixtures) {
      if (Math.hypot(f.x - x, f.z - z) <= 8) return false;
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
      if (c) { this.pool[i].position.set(c.f.x, c.f.y, c.f.z); this.pool[i].distance = c.f.dist; }
      else this.pool[i].intensity = 0;
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
    const R = this.R, W = this.W, H = this.H, by = this.baseY;
    const t = 0.3;
    const outer = R + 2 * t;

    // floor + ceiling
    this.texBox(rec, this.shared.floor, node.x, by - 0.07, node.z, outer, 0.14, outer);
    rec.colliders.push({
      min: new THREE.Vector3(node.x - outer / 2, by - 0.5, node.z - outer / 2),
      max: new THREE.Vector3(node.x + outer / 2, by + 0.02, node.z + outer / 2)
    });
    this.solid(rec, this.shared.ceil, node.x, by + H + 0.1, node.z, outer, 0.2, outer, true);

    // walls, with openings toward each corridor (and the elevator)
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const has = node.dirs[d[0] + "," + d[1]] != null;
      const isElev = node.elevDir && node.elevDir[0] === d[0] && node.elevDir[1] === d[1];
      const ow = isElev ? 2.2 : (has ? W : 0);
      const wx = node.x + d[0] * (R / 2 + t / 2);
      const wz = node.z + d[1] * (R / 2 + t / 2);
      const alongWall = d[0] !== 0 ? "z" : "x";
      const full = outer;
      if (ow === 0) {
        const sx = d[0] !== 0 ? t : full, sz = d[0] !== 0 ? full : t;
        this.solid(rec, this.shared.brick, wx, by + H / 2, wz, sx, H, sz, true);
      } else {
        const piece = (full - ow) / 2;
        const off = ow / 2 + piece / 2;
        for (const s of [-1, 1]) {
          const px = alongWall === "x" ? wx + s * off : wx;
          const pz = alongWall === "z" ? wz + s * off : wz;
          const sx = d[0] !== 0 ? t : piece, sz = d[0] !== 0 ? piece : t;
          this.solid(rec, this.shared.brick, px, by + H / 2, pz, sx, H, sz, true);
        }
        // lintel above the opening keeps the wall solid up to the ceiling
        const lh = 0.0;
        if (lh > 0) this.solid(rec, this.shared.brick, wx, by + H - lh / 2, wz, d[0] !== 0 ? t : ow, lh, d[0] !== 0 ? ow : t, true);
      }
    }

    // a ceiling pipe bundle through every room
    this.pipeRun(rec, this.shared.pipe, node.x - 1.2, by + H - 0.28, node.z, false, R, 0.11);
    this.pipeRun(rec, this.shared.pipeRust, node.x + 1.3, by + H - 0.22, node.z, true, R, 0.07);

    // room light
    const dead = this.hash(node.id, 1, 11) < (node.role === "dead" ? 0.45 : 0.15);
    this.deco(rec, dead ? this.shared.tubeDead : this.shared.tube, node.x, by + H - 0.06, node.z, 0.14, 0.06, 1.6);
    if (!dead) this.addLight(rec, node.x, by + H - 0.3, node.z, 1.6, 12);

    this.dressRoom(rec, node);

    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  dressRoom(rec, node) {
    const by = this.baseY, R = this.R;
    const free = node.free || [];
    if (node.role === "electrical" && free.length) {
      // generator against one wall
      const d = free[0];
      const gx = node.x + d[0] * (R / 2 - 0.65), gz = node.z + d[1] * (R / 2 - 0.65);
      const gw = d[0] !== 0 ? 0.9 : 1.7, gd = d[0] !== 0 ? 1.7 : 0.9;
      this.solid(rec, this.shared.generator, gx, by + 0.55, gz, gw, 1.1, gd);
      const okLamp = this.hash(node.id, 2, 12) > 0.3;
      this.deco(rec, okLamp ? this.shared.green : this.shared.red,
        gx - d[0] * 0.48, by + 0.95, gz - d[1] * 0.48, 0.12, 0.12, 0.12);
      // breaker panel on the next free wall (or the same wall, beside it)
      const d2 = free[1] || d;
      const bx = node.x + d2[0] * (R / 2 - 0.08), bz = node.z + d2[1] * (R / 2 - 0.08);
      const bw = d2[0] !== 0 ? 0.12 : 1.1, bd = d2[0] !== 0 ? 1.1 : 0.12;
      this.deco(rec, this.shared.panel, bx + (d2 === d ? d2[1] * 1.9 : 0), by + 1.45, bz + (d2 === d ? d2[0] * 1.9 : 0), bw, 1.4, bd);
      for (let k = 0; k < 6; k++) {
        const ox = (k % 3 - 1) * 0.28, oy = (k < 3 ? 0.25 : -0.15);
        const lit = this.hash(node.id, k, 13) > 0.5;
        const sx = d2[0] !== 0 ? 0.04 : 0.1, sz = d2[0] !== 0 ? 0.1 : 0.04;
        this.deco(rec, lit ? this.shared.warn : this.shared.warnOff,
          bx - d2[0] * 0.08 + (d2[0] !== 0 ? 0 : ox) + (d2 === d ? d2[1] * 1.9 : 0),
          by + 1.45 + oy,
          bz - d2[1] * 0.08 + (d2[0] !== 0 ? ox : 0) + (d2 === d ? d2[0] * 1.9 : 0),
          sx, 0.1, sz);
      }
      // an old desk with a monitor in the corner
      const cx = node.x - 1.7;
      const cz = node.z + 1.9;
      if (!(Math.abs(cx - gx) < 1.4 && Math.abs(cz - gz) < 1.4)) {
        this.solid(rec, this.shared.desk, cx, by + 0.38, cz, 1.3, 0.76, 0.65);
        const on = this.hash(node.id, 4, 14) > 0.4;
        this.deco(rec, on ? this.shared.screen : this.shared.screenOff, cx, by + 1.0, cz, 0.55, 0.38, 0.06);
        this.deco(rec, this.shared.iron, cx, by + 0.82, cz + 0.05, 0.2, 0.06, 0.2);
      }
    }
    if (node.role === "button" && free.length) {
      const d = free[0];
      const px = node.x + d[0] * (R / 2 - 0.08), pz = node.z + d[1] * (R / 2 - 0.08);
      const sx = d[0] !== 0 ? 0.12 : 0.6, sz = d[0] !== 0 ? 0.6 : 0.12;
      this.deco(rec, this.shared.panel, px, by + 1.2, pz, sx, 0.9, sz);
      const btn = this.deco(rec, this.powered ? this.shared.green : this.shared.red,
        px - d[0] * 0.09, by + 1.25, pz - d[1] * 0.09, d[0] !== 0 ? 0.08 : 0.22, 0.22, d[0] !== 0 ? 0.22 : 0.08);
      this.addLight(rec, px - d[0] * 0.8, by + 1.6, pz - d[1] * 0.8, 0.9, 6);
      rec.button = { mesh: btn, x: px - d[0] * 0.5, z: pz - d[1] * 0.5 };
      this.buttonRec = rec.button;
    }
    if (node.role === "spawn" && free.length) {
      // the door you came in by: sealed. No mark, no trigger, nothing happens if you use it.
      const d = free[0];
      const px = node.x + d[0] * (R / 2 - 0.06), pz = node.z + d[1] * (R / 2 - 0.06);
      const sx = d[0] !== 0 ? 0.1 : 1.2, sz = d[0] !== 0 ? 1.2 : 0.1;
      this.deco(rec, this.shared.ironLight, px, by + 1.1, pz, sx, 2.25, sz);
      this.deco(rec, this.shared.iron, px - d[0] * 0.05, by + 1.1, pz - d[1] * 0.05,
        d[0] !== 0 ? 0.06 : 0.9, 2.05, d[0] !== 0 ? 0.9 : 0.06);
    }
    if (node === this.backNode && node.backDir) {
      // the way back to Level 2: further in, marked with the hazard plate
      const d = node.backDir;
      const px = node.x + d[0] * (R / 2 - 0.06), pz = node.z + d[1] * (R / 2 - 0.06);
      const sx = d[0] !== 0 ? 0.1 : 1.2, sz = d[0] !== 0 ? 1.2 : 0.1;
      this.deco(rec, this.shared.ironLight, px, by + 1.1, pz, sx, 2.25, sz);
      this.deco(rec, this.shared.iron, px - d[0] * 0.05, by + 1.1, pz - d[1] * 0.05,
        d[0] !== 0 ? 0.06 : 0.9, 2.05, d[0] !== 0 ? 0.9 : 0.06);
      this.deco(rec, this.shared.warn, px - d[0] * 0.09, by + 2.35, pz - d[1] * 0.09,
        d[0] !== 0 ? 0.05 : 0.3, 0.12, d[0] !== 0 ? 0.3 : 0.05);
      rec.back = { x: px - d[0] * 0.6, z: pz - d[1] * 0.6 };
    }
    if (node.role === "elevator") this.buildElevator(rec, node);
  },

  buildElevator(rec, node) {
    const by = this.baseY, R = this.R, H = this.H, t = 0.3;
    const d = node.elevDir;
    const depth = 2.6, wid = 2.2;
    const ex = node.x + d[0] * (R / 2 + t + depth / 2);
    const ez = node.z + d[1] * (R / 2 + t + depth / 2);
    const dx = d[0] !== 0, // car runs along x
      along = depth, across = wid + 0.6;
    const sx = dx ? along : across, sz = dx ? across : along;
    // floor + ceiling
    this.deco(rec, this.shared.elevatorIn, ex, by - 0.05, ez, sx, 0.1, sz);
    rec.colliders.push({ min: new THREE.Vector3(ex - sx / 2, by - 0.5, ez - sz / 2), max: new THREE.Vector3(ex + sx / 2, by + 0.02, ez + sz / 2) });
    this.solid(rec, this.shared.elevatorIn, ex, by + H + 0.1, ez, sx, 0.2, sz);
    // back wall and side walls
    const bw = 0.2;
    this.solid(rec, this.shared.elevatorIn, ex + d[0] * (depth / 2 - bw / 2), by + H / 2, ez + d[1] * (depth / 2 - bw / 2),
      dx ? bw : across, H, dx ? across : bw);
    for (const s of [-1, 1]) {
      const px = dx ? ex : ex + s * (wid / 2 + 0.2);
      const pz = dx ? ez + s * (wid / 2 + 0.2) : ez;
      this.solid(rec, this.shared.elevatorIn, px, by + H / 2, pz, dx ? depth : 0.2, H, dx ? 0.2 : depth);
    }
    this.deco(rec, this.shared.tube, ex, by + H - 0.06, ez, dx ? 1.2 : 0.2, 0.06, dx ? 0.2 : 1.2);
    this.addLight(rec, ex, by + H - 0.35, ez, 1.1, 8);
    // sliding doors in the room wall opening
    const doorX = node.x + d[0] * (R / 2 + t / 2);
    const doorZ = node.z + d[1] * (R / 2 + t / 2);
    const leaves = [];
    for (const s of [-1, 1]) {
      const leafW = wid / 2;
      const cx0 = dx ? doorX : doorX + s * leafW / 2;
      const cz0 = dx ? doorZ + s * leafW / 2 : doorZ;
      const mesh = this.deco(rec, this.shared.elevator, cx0, by + 1.1, cz0, dx ? 0.1 : leafW, 2.2, dx ? leafW : 0.1);
      const col = {
        min: new THREE.Vector3(cx0 - (dx ? 0.1 : leafW) / 2, by, cz0 - (dx ? leafW : 0.1) / 2),
        max: new THREE.Vector3(cx0 + (dx ? 0.1 : leafW) / 2, by + 2.2, cz0 + (dx ? leafW : 0.1) / 2)
      };
      rec.colliders.push(col);
      leaves.push({ mesh, col, s, x0: cx0, z0: cz0 });
    }
    // lintel strip above the doors
    this.deco(rec, this.shared.elevator, doorX, by + 2.2 + (H - 2.2) / 2, doorZ, dx ? 0.3 : wid + 0.2, H - 2.2, dx ? wid + 0.2 : 0.3);
    // status light above the doors
    const lamp = this.deco(rec, this.powered ? this.shared.green : this.shared.red,
      doorX - d[0] * 0.2, by + 2.45, doorZ - d[1] * 0.2, 0.3, 0.12, 0.3);
    // plaque on the lintel above the doors, facing the room
    const plaque = new THREE.Mesh(this.planeGeo, this.shared.plaque);
    plaque.scale.set(1.0, 0.19, 1);
    plaque.position.set(doorX - d[0] * 0.16, by + 2.68, doorZ - d[1] * 0.16);
    plaque.rotation.y = Math.atan2(-d[0], -d[1]);
    rec.group.add(plaque);
    rec.elevator = { leaves, lamp, dx, open: this.powered ? 1 : 0, wid };
    this.elevator = {
      rec: rec.elevator,
      doorX, doorZ,
      innerX: ex, innerZ: ez
    };
    if (this.powered) this.setElevatorOpen(1);
  },

  setElevatorOpen(f) {
    if (!this.elevator) return;
    const e = this.elevator.rec;
    e.open = f;
    for (const lf of e.leaves) {
      const off = lf.s * (e.wid / 2 - 0.1) * f;
      const nx = e.dx ? lf.x0 : lf.x0 + off;
      const nz = e.dx ? lf.z0 + off : lf.z0;
      lf.mesh.position.x = nx; lf.mesh.position.z = nz;
      const w = e.wid / 2;
      const hx = (e.dx ? 0.1 : w) / 2, hz = (e.dx ? w : 0.1) / 2;
      if (f > 0.7) { lf.col.min.set(0, 1e6, 0); lf.col.max.set(0, 1e6 + 1, 0); }
      else {
        lf.col.min.set(nx - hx, this.baseY, nz - hz);
        lf.col.max.set(nx + hx, this.baseY + 2.2, nz + hz);
      }
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
    const W = this.W, H = this.H, R = this.R, by = this.baseY;
    const dx = edge.bx - edge.ax, dz = edge.bz - edge.az;
    const ux = dx / edge.len, uz = dz / edge.len;
    const px = -uz, pz = ux;
    const alongX = edge.alongX;
    const L = edge.len - R;
    const mx = (edge.ax + edge.bx) / 2, mz = (edge.az + edge.bz) / 2;
    // local (a along corridor, b across) -> world
    const wx = (a, b) => mx + ux * a + px * b;
    const wz = (a, b) => mz + uz * a + pz * b;
    // world box from local size
    const abox = (mat, a, y, b, sa, sy, sb, solid, textured) => {
      const X = wx(a, b), Z = wz(a, b);
      const sx = alongX ? sa : sb, sz = alongX ? sb : sa;
      if (solid) return this.solid(rec, mat, X, y, Z, sx, sy, sz, textured);
      return this.deco(rec, mat, X, y, Z, sx, sy, sz);
    };

    // floor and ceiling
    this.texBox(rec, this.shared.floor, mx, by - 0.07, mz, alongX ? L + 0.4 : W + 0.6, 0.14, alongX ? W + 0.6 : L + 0.4);
    rec.colliders.push({
      min: new THREE.Vector3(mx - (alongX ? L / 2 + 0.2 : W / 2 + 0.3), by - 0.5, mz - (alongX ? W / 2 + 0.3 : L / 2 + 0.2)),
      max: new THREE.Vector3(mx + (alongX ? L / 2 + 0.2 : W / 2 + 0.3), by + 0.02, mz + (alongX ? W / 2 + 0.3 : L / 2 + 0.2))
    });
    abox(this.shared.ceil, 0, by + H + 0.1, 0, L + 0.4, 0.2, W + 0.6, true, true);

    // side walls
    for (const s of [-1, 1]) abox(this.shared.brick, 0, by + H / 2, s * (W / 2 + 0.15), L + 0.4, H, 0.3, true, true);

    // pipes: ceiling run, and two thin runs along the wall on the pipe side
    const ps = edge.pipeSide;
    const pipeMat = edge.steam ? this.shared.hotPipe : this.shared.pipe, rustMat = edge.steam ? this.shared.hotPipe : this.shared.pipeRust;
    {
      const X = wx(0, 0), Z = wz(0, 0);
      this.pipeRun(rec, pipeMat, X, by + H - 0.26, Z, alongX, L, 0.1);
    }
    for (const [yy, rad, mat] of [[2.35, 0.07, rustMat], [2.05, 0.05, pipeMat]]) {
      const X = wx(0, ps * (W / 2 - rad - 0.02)), Z = wz(0, ps * (W / 2 - rad - 0.02));
      this.pipeRun(rec, mat, X, by + yy, Z, alongX, L, rad);
    }
    // clamps along the wall pipes
    for (let i = 0; i < 3; i++) {
      const a = -L / 2 + (i + 0.5) * L / 3;
      abox(this.shared.iron, a, by + 2.2, ps * (W / 2 - 0.05), 0.1, 0.5, 0.08, false);
    }

    // leaking pipe: a joint with a stain and a puddle of almond water
    if (edge.leak) {
      const a = (this.hash(edge.id, 5, 21) - 0.5) * (L - 3);
      abox(this.shared.pipeRust, a, by + 2.35, ps * (W / 2 - 0.1), 0.34, 0.2, 0.14, false);
      const pud = new THREE.Mesh(this.planeGeo, this.shared.puddle);
      pud.rotation.x = -Math.PI / 2;
      const pw = 1.1 + this.hash(edge.id, 6, 22) * 0.8, pl = 0.8 + this.hash(edge.id, 7, 23) * 0.7;
      pud.scale.set(alongX ? pw : pl, alongX ? pl : pw, 1);
      pud.position.set(wx(a, ps * (W / 2 - 0.7)), by + 0.015, wz(a, ps * (W / 2 - 0.7)));
      rec.group.add(pud);
    }

    // hot pipe with a venting joint: a plume of steam on a cycle that hurts when you stand in it
    if (edge.steam) {
      const a = (this.hash(edge.id, 12, 28) - 0.5) * (L - 4);
      abox(this.shared.hotPipe, a, by + 1.0, ps * (W / 2 - 0.12), 0.3, 0.3, 0.2, false);
      const plume = abox(this.shared.steam.clone(), a, by + 1.0, ps * (W / 2 - 0.12) - ps * 0.7, 0.9, 1.7, 0.9, false);
      plume.position.y = by + 1.0;
      rec.vents.push({ x: wx(a, ps * (W / 2 - 0.7)), z: wz(a, ps * (W / 2 - 0.7)), plume, off: this.hash(edge.id, 13, 29) * 6, snd: -1 });
    }

    // locked iron doors: they only show a black void behind them
    for (let k = 0; k < edge.locked; k++) {
      const a = (k === 0 ? -1 : 1) * (1.2 + this.hash(edge.id, 8 + k, 24) * (L / 2 - 2.4));
      const side = (this.hash(edge.id, 9 + k, 25) < 0.5 ? -1 : 1) * (edge.flip);
      // collision-free recess painted on the wall face
      abox(this.shared.ironLight, a, by + 1.1, side * (W / 2 - 0.03), 1.3, 2.25, 0.06, false);
      abox(this.shared.voidDark, a, by + 1.08, side * (W / 2 - 0.07), 1.06, 2.1, 0.04, false);
      abox(this.shared.iron, a + 0.4, by + 1.05, side * (W / 2 - 0.1), 0.06, 0.2, 0.06, false);
      rec.locked.push({ x: wx(a, side * (W / 2)), z: wz(a, side * (W / 2)) });
    }

    // iron gate across the corridor: can be opened
    if (edge.gate) {
      const leafW = W - 0.08;
      const hingeB = -(W / 2 - 0.04) * edge.flip;       // hinge sits against one wall
      const dirAcross = -Math.sign(hingeB);               // leaf extends toward the other wall
      const pivot = new THREE.Group();
      pivot.position.set(wx(0, hingeB), by, wz(0, hingeB));
      // offset of a point `f` along the leaf, in world space
      const ox = (f) => px * dirAcross * f, oz = (f) => pz * dirAcross * f;
      const mkPart = (mat, f, y, thick, len, h) => {
        const m = new THREE.Mesh(this.box, mat);
        m.scale.set(alongX ? thick : len, h, alongX ? len : thick);
        m.position.set(ox(f), y, oz(f));
        pivot.add(m);
        return m;
      };
      mkPart(this.shared.iron, leafW / 2, 1.12, 0.1, leafW, 2.25);
      for (let k = 0; k < 3; k++) mkPart(this.shared.ironLight, leafW / 2, 0.45 + k * 0.55, 0.14, leafW * 0.9, 0.08);
      mkPart(this.shared.warnOff, leafW * 0.85, 1.05, 0.2, 0.12, 0.12);
      rec.group.add(pivot);
      const gx = wx(0, 0), gz = wz(0, 0);
      const col = {
        min: new THREE.Vector3(gx - (alongX ? 0.1 : W / 2), by, gz - (alongX ? W / 2 : 0.1)),
        max: new THREE.Vector3(gx + (alongX ? 0.1 : W / 2), by + 2.3, gz + (alongX ? W / 2 : 0.1))
      };
      rec.colliders.push(col);
      rec.gates.push({ pivot, col, open: 0, opening: false, x: gx, z: gz, alongX, swing: 1 });
    }

    // faulty junction box that arcs when you pass it
    if (edge.arc) {
      const a = (this.hash(edge.id, 10, 26) - 0.5) * (L - 5);
      const side = edge.flip;
      const boxA = abox(this.shared.panel, a, by + 1.35, side * (W / 2 - 0.13), 0.7, 0.9, 0.22, false);
      const lamp = abox(this.shared.warnOff, a, by + 1.85, side * (W / 2 - 0.27), 0.14, 0.14, 0.1, false);
      const bolt = abox(this.shared.arc, a, by + 1.4, 0, 0.08, 0.1, W - 0.5, false);
      bolt.visible = false;
      rec.arcs.push({
        x: wx(a, 0), z: wz(a, 0), lamp, bolt, boxMesh: boxA,
        off: this.hash(edge.id, 11, 27) * 4.2, hitCycle: -1, warned: false
      });
    }

    // fluorescent tubes (a few are dead)
    const n = Math.max(1, Math.floor(L / 5));
    for (let i = 0; i < n; i++) {
      const a = -L / 2 + (i + 0.5) * L / n;
      const dead = this.hash(edge.id, i, 31) < 0.22;
      abox(dead ? this.shared.tubeDead : this.shared.tube, a, by + H - 0.06, 0, 1.5, 0.06, 0.14, false);
      if (!dead && i % 2 === 0) this.addLight(rec, wx(a, 0), by + H - 0.3, wz(a, 0), 1.4, 10);
    }

    this.group.add(rec.group);
    this.segments.set(key, rec);
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
    const BUILD = 48, DROP = 66;
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
    this.colliders.length = 0;
    this.gates = [];
    this.locked = [];
    this.arcs = [];
    this.buttonRec = null;
    this.backDoor = null;
    this.fixtures = [];
    this.vents = [];
    for (const rec of this.segments.values()) {
      for (const f of rec.fixtures) this.fixtures.push(f);
      for (const v of rec.vents) this.vents.push(v);
      if (rec.back) this.backDoor = rec.back;
      for (const c of rec.colliders) this.colliders.push(c);
      for (const g of rec.gates) this.gates.push(g);
      for (const l of rec.locked) this.locked.push(l);
      for (const a of rec.arcs) this.arcs.push(a);
      if (rec.button) this.buttonRec = rec.button;
    }
  },

  /* ------------------------------------------------------------------
     INTERACTION
     ------------------------------------------------------------------ */
  tryUse() {
    if (!this.active) return false;
    const p = Player.position;
    const R = 2.1;
    let best = null, bestD = R;
    const consider = (type, x, z, ref) => {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = { type, ref }; }
    };
    for (const g of this.gates) consider("gate", g.x, g.z, g);
    for (const l of this.locked) consider("locked", l.x, l.z, l);
    if (this.buttonRec) consider("button", this.buttonRec.x, this.buttonRec.z, this.buttonRec);
    if (this.elevator) consider("elevator", this.elevator.doorX, this.elevator.doorZ, this.elevator);
    if (this.backDoor) consider("back", this.backDoor.x, this.backDoor.z, this.backDoor);
    if (!best) return false;
    if (best.type === "back") {
      if (typeof HUD !== "undefined") HUD.toast("LEVEL 2");
      const sd = this.seed;
      setTimeout(() => { if (typeof Level2 !== "undefined") Level2.enter(sd, 3); }, 0);
      return true;
    }
    if (best.type === "gate") {
      if (!best.ref.opening) { best.ref.opening = true; best.ref.col.min.set(0, 1e6, 0); best.ref.col.max.set(0, 1e6 + 1, 0); }
      return true;
    }
    if (best.type === "locked") {
      if (typeof HUD !== "undefined") HUD.toast("LOCKED");
      return true;
    }
    if (best.type === "button") {
      if (this.powered) { if (typeof HUD !== "undefined") HUD.toast("ALREADY POWERED"); return true; }
      this.setPowered();
      return true;
    }
    if (best.type === "elevator") {
      if (!this.powered && typeof HUD !== "undefined") HUD.toast("THE ELEVATOR HAS NO POWER");
      return true;
    }
    return false;
  },

  setPowered() {
    this.powered = true;
    if (this.buttonRec && this.buttonRec.mesh) this.buttonRec.mesh.material = this.shared.green;
    if (this.elevator) this.elevator.rec.lamp.material = this.shared.green;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: reach the elevator";
    if (typeof HUD !== "undefined") HUD.toast("SOMETHING HEAVY MOVES FAR AWAY");
  },

  arrive() {
    if (this._arrived) return;
    this._arrived = true;
    if (typeof Level4 !== "undefined") {
      const sd = this.seed;
      setTimeout(() => Level4.enter(sd, 3), 0);
      return;
    }
    GameState.exitReached = true;
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 4 IS NOT BUILT YET");
    if (typeof Game !== "undefined" && Game.complete) Game.complete();
  },

  prompt() {
    const p = Player.position;
    let msg = "";
    const near = (x, z, r) => Math.hypot(p.x - x, p.z - z) < r;
    for (const g of this.gates) if (near(g.x, g.z, 2.0) && !g.opening) { msg = "E  OPEN IRON DOOR"; break; }
    if (!msg && this.buttonRec && !this.powered && near(this.buttonRec.x, this.buttonRec.z, 2.0)) msg = "E  PRESS BUTTON";
    if (!msg && this.backDoor && near(this.backDoor.x, this.backDoor.z, 2.0)) msg = "E  RETURN TO LEVEL 2";
    if (!msg) for (const l of this.locked) if (near(l.x, l.z, 1.6)) { msg = "E  TRY DOOR"; break; }
    if (msg && typeof HUD !== "undefined" && HUD.toast) HUD.toast(msg);
  },

  /* ------------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------------ */
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.stream(false);
    const p = Player.position;

    // light pool: re-aim at the nearest fixtures, flicker the faulty ones
    this._poolT -= dt;
    if (this._poolT <= 0) { this._poolT = 0.2; this.assignLights(); }
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) continue;
      const t = this.time + f.ph;
      const sN = Math.sin(t * 23.0) * Math.sin(t * 7.3);
      const flick = f.bad ? (sN > 0.3 ? 0.1 : 1) : (sN > 0.93 ? 0.25 : 1);
      this.pool[i].intensity = f.base * flick * (0.9 + 0.1 * Math.sin(t * 1.7));
    }

    // steam vents: 5 s cycle, 2 s of venting (with a hiss at the start)
    this._ventHurt -= dt;
    for (const v of this.vents) {
      const c = 5, t = (this.time + v.off) % c, idx = Math.floor((this.time + v.off) / c);
      const on = t > 3 ? Math.min(1, (t - 3) / 0.25) * (t > 4.7 ? Math.max(0, (5 - t) / 0.3) : 1) : 0;
      v.plume.material.opacity = on * 0.4;
      if (t > 3 && v.snd !== idx) {
        v.snd = idx;
        if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional && Math.hypot(p.x - v.x, p.z - v.z) < 30) {
          AudioSystem.playPositional("flicker", v.x, 1.0, v.z, { gain: 0.25, bus: "events", max: 40 });
        }
      }
      if (on > 0.5 && Math.hypot(p.x - v.x, p.z - v.z) < 1.1 && p.y < 2.2) {
        Player.damagePlayer(Math.max(1, 14 * dt));
        if (this._ventHurt <= 0) { this._ventHurt = 2.5; if (typeof HUD !== "undefined") HUD.toast("SCALDING STEAM"); }
      }
    }

    // gates swing open
    for (const g of this.gates) {
      if (!g.opening || g.open >= 1) continue;
      g.open = Math.min(1, g.open + dt / 0.8);
      g.pivot.rotation.y = g.open * 1.5 * g.swing;
    }

    // elevator doors
    if (this.elevator) {
      const e = this.elevator.rec;
      if (this.powered && e.open < 1) this.setElevatorOpen(Math.min(1, e.open + dt / 2.5));
      if (this.powered && e.open >= 1) {
        if (Math.hypot(p.x - this.elevator.innerX, p.z - this.elevator.innerZ) < 0.9) this.arrive();
      }
    }

    // faulty junction boxes: idle, warning, discharge
    for (const a of this.arcs) {
      const cycle = 4.2;
      const t = (this.time + a.off) % cycle;
      const idx = Math.floor((this.time + a.off) / cycle);
      let state = 0;
      if (t > 3.6) state = 2; else if (t > 2.6) state = 1;
      const warnOn = state === 1 ? (Math.floor(t * 10) % 2 === 0) : state === 2;
      a.lamp.material = warnOn ? this.shared.warn : this.shared.warnOff;
      a.bolt.visible = state === 2 && Math.floor(t * 40) % 3 !== 0;
      if (state === 2 && a.hitCycle !== idx) {
        a.hitCycle = idx;
        if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional && Math.hypot(p.x - a.x, p.z - a.z) < 40) {
          AudioSystem.playPositional("impact", a.x, 1.4, a.z, { gain: 0.16, bus: "events", max: 50 });
          AudioSystem.playPositional("pop", a.x, 1.4, a.z, { gain: 0.3, bus: "electrical", max: 50 });
        }
        if (Math.hypot(p.x - a.x, p.z - a.z) < 2.3) {
          Player.damagePlayer(22);
          if (typeof HUD !== "undefined") HUD.toast("THE MACHINE ARCS");
        }
      }
    }

    // the level is almost never quiet: distant machinery
    this._sfxT -= dt;
    if (this._sfxT <= 0) {
      this._sfxT = 2.5 + Math.random() * 5;
      if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional) {
        const ang = Math.random() * Math.PI * 2, rr = 8 + Math.random() * 16;
        const k = ["thump", "metal", "pipe", "creak", "pop"][Math.floor(Math.random() * 5)];
        AudioSystem.playPositional(k, p.x + Math.cos(ang) * rr, 1.5, p.z + Math.sin(ang) * rr, { gain: 0.06, bus: "events", max: 60 });
      }
    }

    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
  }
};
