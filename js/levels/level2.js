"use strict";

/* Level 2 — mirrored industrial tunnel network.
   Spawn sits in a corridor. Both directions are mirror images.
   Wrong paths are short or long, and every wrong path eventually ends. */
const Level2 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  hot: [],
  doors: [],
  segments: new Map(),
  edges: [],
  nodes: [],
  spawn: new THREE.Vector3(),
  exitPos: null,
  baseY: 0,
  width: 3.6,
  height: 3.45,
  shared: null,
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  lamps: [],
  lastKey: "",
  infoText: "",
  time: 0,
  _poolT: 0,
  // Tunable look. Lights are physically based (no legacy mode), so values here are
  // much higher than the old ones: the old ambient left the ceiling black.
  look: { ambient: 1.15, hemi: 0.7, lightI: 6.0, lightD: 26, poolSize: 8, fog: 0x2a2a28, fogNear: 8, fogFar: 70 },
  T: 3.0,        // metres per texture tile
  NODE: 2.12,    // half-size of a junction square (outer face of its walls)

  hash(x, z, salt) {
    let h = (this.seed >>> 0) ^ Math.imul((x | 0) + (salt || 0), 0x45d9f3b) ^ Math.imul((z | 0) - (salt || 0), 0x27d4eb2d);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  // A layout whose main route cannot be placed without cutting through itself is
  // rejected and regenerated from a derived seed (still fully deterministic).
  generate(seed) {
    for (let k = 0; k < 40; k++) {
      if (this._gen((seed + Math.imul(k, 7919)) >>> 0, false)) return;
    }
    this._gen(seed >>> 0, true);
  },

  _gen(seed, force) {
    const r = this.rng(seed >>> 0);
    const nodes = [];
    const edges = [];
    const occ = new Set();
    const key = (x, z) => Math.round(x) + "," + Math.round(z);
    const addNode = (x, z) => {
      const n = { id: nodes.length, x, z, edges: [] };
      nodes.push(n);
      occ.add(key(x, z));
      return n;
    };
    const link = (a, b, kind, main, hot, dest) => {
      const e = {
        id: edges.length, a: a.id, b: b.id, kind, main, hot: !!hot, dest: dest || 0,
        ax: a.x, az: a.z, bx: b.x, bz: b.z,
        len: Math.hypot(b.x - a.x, b.z - a.z)
      };
      edges.push(e);
      a.edges.push(e.id);
      b.edges.push(e.id);
      return e;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // A corridor is 4.24 m wide including walls. A new leg may not come within that
    // clearance of any existing corridor it does not start from, or it would cut
    // straight through a hallway (or run flush alongside one).
    const MIN_Z = 7;
    const crosses = (from, nx, nz) => {
      const c = 2.4;
      const lx = Math.min(from.x, nx) - c, hx = Math.max(from.x, nx) + c;
      const lz = Math.min(from.z, nz) - c, hz = Math.max(from.z, nz) + c;
      for (const e of edges) {
        if (e.a === from.id || e.b === from.id) continue;
        const elx = Math.min(e.ax, e.bx) - c, ehx = Math.max(e.ax, e.bx) + c;
        const elz = Math.min(e.az, e.bz) - c, ehz = Math.max(e.az, e.bz) + c;
        if (lx < ehx && hx > elx && lz < ehz && hz > elz) return true;
      }
      for (const n of nodes) {
        if (n === from) continue;
        if (n.x > lx && n.x < hx && n.z > lz && n.z < hz) return true;
      }
      return false;
    };
    const growBranch = (from, dx, dz, depth) => {
      const roll = r();
      const span = roll < 0.4 ? 12 + Math.floor(r() * 8) : roll < 0.75 ? 28 + Math.floor(r() * 16) : 48 + Math.floor(r() * 24);
      const nx = from.x + dx * span, nz = from.z + dz * span;
      if (occ.has(key(nx, nz)) || nz < MIN_Z || crosses(from, nx, nz)) return;
      const end = addNode(nx, nz);
      const hasDoor = r() < 0.04;
      const dest = r() < 0.65 ? 1 : 0;
      link(from, end, hasDoor ? "door" : "dead", false, r() < 0.35, hasDoor ? dest : 0);
      if (roll >= 0.4 && depth < 2 && r() < 0.7) {
        const side = r() < 0.5 ? -1 : 1;
        const sx = side * -dz, sz = side * dx;
        growBranch(end, sx, sz, depth + 1);
        if (roll >= 0.75 && r() < 0.5) growBranch(end, -sx, -sz, depth + 1);
      }
    };

    const origin = addNode(0, 0);
    let cur = origin;
    let dx = 0, dz = 1;
    const route = [origin];
    for (let i = 0; i < 6; i++) {
      const span = i === 0 ? 52 : 34 + Math.floor(r() * 18);
      if (i > 0 && r() < 0.7) {
        const left = r() < 0.5;
        const ndx = left ? -dz : dz;
        const ndz = left ? dx : -dx;
        dx = ndx; dz = ndz;
      }
      let nx = cur.x + dx * span, nz = cur.z + dz * span;
      let guard = 0;
      while ((occ.has(key(nx, nz)) || nz < MIN_Z || (i > 0 && crosses(cur, nx, nz))) && guard++ < 24) {
        const d = dirs[Math.floor(r() * 4)];
        dx = d[0]; dz = d[1];
        nx = cur.x + dx * span; nz = cur.z + dz * span;
      }
      if (occ.has(key(nx, nz)) || nz < MIN_Z || (i > 0 && crosses(cur, nx, nz))) {
        if (!force) return false;
        dx = 0; dz = 1; nx = cur.x; nz = cur.z + span;
      }
      const next = addNode(nx, nz);
      // Guaranteed exits on the main route: leg 2 -> Level 1, leg 4 -> Level 0,
      // final leg -> Level 3. Other main-route doors are random extras to 0 or 1.
      const forced = { 2: 1, 4: 0, 5: 3 }[i];
      const sideDoor = forced != null || (i > 0 && r() < 0.15);
      const dest = forced != null ? forced : (r() < 0.6 ? 1 : 0);
      link(cur, next, sideDoor ? "door" : "main", true, r() < 0.3, sideDoor ? dest : 0);
      route.push(next);
      cur = next;
    }
    const exit = route[route.length - 1];
    for (let i = 1; i < route.length - 1; i++) {
      const n = route[i];
      const count = 1 + (r() < 0.4 ? 1 : 0);
      for (let b = 0; b < count; b++) {
        const used = new Set(n.edges.map(id => {
          const e = edges[id];
          const ox = e.a === n.id ? e.bx : e.ax;
          const oz = e.a === n.id ? e.bz : e.az;
          return Math.sign(ox - n.x) + "," + Math.sign(oz - n.z);
        }));
        const open = dirs.filter(d => !used.has(d[0] + "," + d[1]));
        if (!open.length) continue;
        const d = open[Math.floor(r() * open.length)];
        growBranch(n, d[0], d[1], 0);
      }
    }

    const mirrored = [];
    const map = new Map();
    // Snapshot the array: addNode() pushes onto `nodes`, and iterating the live
    // array would mirror each new mirror forever (infinite loop on level entry).
    for (const n of nodes.slice()) {
      if (n.z === 0) { map.set(n.id, n); continue; }
      const m = addNode(n.x, -n.z);
      map.set(n.id, m);
      mirrored.push(m);
    }
    const baseEdges = edges.slice();
    for (const e of baseEdges) {
      const a = map.get(e.a), b = map.get(e.b);
      if (!a || !b || a.id === b.id) continue;
      if (a.z === 0 && b.z === 0) continue;
      link(a, b, e.kind, e.main, e.hot, e.dest);
    }

    this.nodes = nodes;
    this.edges = edges;
    this.exitPos = new THREE.Vector3(exit.x, this.baseY, exit.z);
    this.spawn.set(0, this.baseY, 0);
    this.infoText = "NODES " + nodes.length + " · EDGES " + edges.length + " · MIRRORED";
    return true;
  },

  markTex(level) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = level === 0 ? "#6a6248" : level === 3 ? "#6e4a2c" : "#5a5c5e";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#2a2824";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 112, 112);
    ctx.strokeStyle = level === 0 ? "#c2b48a" : "#b0b4b6";
    ctx.lineWidth = 5;
    if (level === 3) {
      ctx.fillStyle = "#e6c46a";
      ctx.font = "bold 84px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("3", 64, 68);
    } else if (level === 0) {
      ctx.beginPath(); ctx.moveTo(24, 52); ctx.lineTo(104, 52); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(24, 76); ctx.lineTo(104, 76); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(64, 28); ctx.lineTo(64, 100); ctx.stroke();
      ctx.strokeRect(40, 36, 48, 56);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  },

  /* ------------------------------------------------------------------
     MATERIALS
     Textures come from assets/level2-*.jpg. Everything is Lambert-ish
     (metalness <= 0.15) because the scene has no environment map: a highly
     metallic material renders almost black here.
     ------------------------------------------------------------------ */
  tex(path) {
    const t = new THREE.TextureLoader().load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  },

  materialSet() {
    if (this.shared) return;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const block = this.tex("assets/level2-block.jpg");
    const conc = this.tex("assets/level2-concrete.jpg");
    const floorT = this.tex("assets/level2-floor.jpg");
    const pipeT = this.tex("assets/level2-pipe.jpg");
    const rustT = this.tex("assets/level2-rust.jpg");
    this.shared = {
      wall: std({ map: block, color: 0xdcdcd8, roughness: 0.92, metalness: 0 }),
      stain: std({ map: block, color: 0xa8a8a2, roughness: 0.94, metalness: 0 }),
      floor: std({ map: floorT, color: 0xc8c6c0, roughness: 0.9, metalness: 0 }),
      floorWear: std({ map: conc, color: 0xa4a29c, roughness: 0.95, metalness: 0 }),
      ceil: std({ map: conc, color: 0xb8b6b0, roughness: 0.95, metalness: 0 }),
      trim: std({ color: 0xcfcfca, roughness: 0.85, metalness: 0 }),
      seam: std({ color: 0x2a2a28, roughness: 1 }),
      pipePanel: std({ map: pipeT, color: 0xc4c8cc, roughness: 0.55, metalness: 0.12 }),
      pipe: std({ color: 0xa4a9ad, roughness: 0.5, metalness: 0.15 }),
      rust: std({ map: rustT, color: 0xd0b4a2, roughness: 0.7, metalness: 0.1 }),
      hot: std({ color: 0xd8602f, emissive: 0x8a2c0c, emissiveIntensity: 0.9, roughness: 0.45, metalness: 0.1 }),
      door: std({ color: 0x4a443c, roughness: 0.86, metalness: 0 }),
      frame: std({ color: 0x2c2824, roughness: 0.9, metalness: 0 }),
      handle: std({ color: 0xb4aca0, metalness: 0.15, roughness: 0.4 }),
      voidDark: new THREE.MeshBasicMaterial({ color: 0x000000 }),
      mark0: this.markTex(0),
      mark1: this.markTex(1),
      mark3: this.markTex(3),
      shelf: std({ color: 0x7c868c, roughness: 0.6, metalness: 0.15 }),
      crate: std({ color: 0x7a6040, roughness: 0.85, metalness: 0 }),
      can: std({ color: 0x8a3a30, roughness: 0.6, metalness: 0.1 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff1d2, toneMapped: false }),
      dead: std({ color: 0x4a4844, roughness: 0.8 })
    };
    this.flangeGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.06, 10);
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const rec of this.segments.values()) this.disposeSegment(rec);
    this.segments.clear();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = [];
    this.poolFx = [];
    this.fixtures = [];
    this.lamps = [];
    this.colliders.length = 0;
    if (this.hot) this.hot.length = 0;
    this.doors = [];
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.time = 0;
    this.edges = [];
    this.nodes = [];
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    const tint = document.getElementById("heat-tint");
    if (tint) tint.style.opacity = "0";
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    for (const g of rec.geos || []) g.dispose();
  },

  placeBottles() {
    if (typeof PickupSystem === "undefined") return;
    if (!PickupSystem.group) {
      PickupSystem.group = new THREE.Group();
      if (scene) scene.add(PickupSystem.group);
    }
    for (const e of this.edges) {
      if (e.main || e.kind === "door") continue;
      const end = this.nodes[e.b];
      if (!end || end.edges.length !== 1) continue;
      if (this.hash(e.id, 1, 4) > 0.12) continue;
      const len = Math.max(1, e.len);
      const ux = (e.bx - e.ax) / len, uz = (e.bz - e.az) / len;
      PickupSystem._addMesh("almond", e.bx - ux * 1.6, e.bz - uz * 1.6);
    }
  },

  enter(seed, from) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level3 !== "undefined") Level3.reset();
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
    this.group.name = "Level2_Tunnels";
    scene.add(this.group);
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0xc4c8cc, 0x8a8a86, lk.hemi);
    const amb = new THREE.AmbientLight(0xb8bcc0, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    // A fixed pool of point lights that is re-aimed at the nearest fixtures.
    // The light count never changes, so streaming never forces a shader recompile.
    for (let i = 0; i < lk.poolSize; i++) {
      const L = new THREE.PointLight(0xffe7c2, 0, lk.lightD, 1.5);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 100; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 2;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = Math.PI;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find a door out (0, 1, or 3)";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 2";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    const arrival = (from === 3 && this.exitPos) ? this.exitPos : this.spawn;
    Player.position.copy(arrival);
    this.stream(true);
    this.assignLights();
    this.placeBottles();
    Player.position.copy(arrival);
    Player.yaw = Math.PI;
    if (typeof HoundSystem !== "undefined") {
      HoundSystem.attach({
        colliders: this.colliders,
        cap: 2,
        graceSeconds: 2,
        graceRadius: 30,
        minDist: 18,
        maxDist: 42,
        seed: this.seed
      });
    }
    if (typeof SmilerSystem !== "undefined") {
      SmilerSystem.attach({
        colliders: this.colliders,
        cap: 2,
        graceSeconds: 2,
        minDist: 15,
        maxDist: 32,
        seed: this.seed,
        margin: 0.55,
        allow: () => true,
        isDark: (x, z) => this.isDarkAt(x, z)
      });
    }
  },

  /* ------------------------------------------------------------------
     GEOMETRY HELPERS
     ------------------------------------------------------------------ */
  newRec() {
    return { group: new THREE.Group(), colliders: [], hotBoxes: [], fixtures: [], lamps: [], doors: [], geos: [], edge: null };
  },

  // Box with real-size geometry; UVs are scaled so a texture tile covers T metres.
  texBox(rec, mat, x, y, z, sx, sy, sz, T) {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const uv = geo.attributes.uv;
    const t = T || this.T;
    const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) {
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * dims[f][0] / t, uv.getY(i) * dims[f][1] / t);
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

  solid(rec, mat, x, y, z, sx, sy, sz, textured) {
    if (textured) this.texBox(rec, mat, x, y, z, sx, sy, sz);
    else this.deco(rec, mat, x, y, z, sx, sy, sz);
    const c = {
      min: new THREE.Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
      max: new THREE.Vector3(x + sx / 2, y + sy / 2, z + sz / 2)
    };
    rec.colliders.push(c);
    return c;
  },

  // Pipe with tiled UVs along its length. `list` receives the collider.
  pipeRun(rec, list, mat, x, y, z, alongX, len, radius, collide) {
    const geo = new THREE.CylinderGeometry(radius, radius, len, 10);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * len / this.T);
    uv.needsUpdate = true;
    const pipe = new THREE.Mesh(geo, mat);
    if (alongX) pipe.rotation.z = Math.PI / 2; else pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, z);
    rec.group.add(pipe);
    rec.geos.push(geo);
    if (collide) {
      const hx = alongX ? len / 2 : radius;
      const hz = alongX ? radius : len / 2;
      list.push({
        min: new THREE.Vector3(x - hx, y - radius, z - hz),
        max: new THREE.Vector3(x + hx, y + radius, z + hz)
      });
    }
  },

  addFixture(rec, x, y, z, dead, dark) {
    rec.lamps.push({ x, z, dead: !!(dead || dark) });
    if (dead || dark) return;
    rec.fixtures.push({
      x, y, z,
      base: this.look.lightI,
      ph: this.hash(Math.round(x * 3), Math.round(z * 3), 3) * 40,
      bad: this.hash(Math.round(x * 3), Math.round(z * 3), 9) < 0.28
    });
  },

  /* ------------------------------------------------------------------
     CORRIDORS
     ------------------------------------------------------------------ */
  buildEdge(edge) {
    const key = String(edge.id);
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    rec.edge = edge;
    const W = this.width, H = this.height, by = this.baseY, E = this.NODE;
    const full = W + 0.64;
    const len = Math.max(1, edge.len);
    const ux = (edge.bx - edge.ax) / len, uz = (edge.bz - edge.az) / len;
    const alongX = Math.abs(ux) >= Math.abs(uz);
    const span = Math.max(2, len - 2 * E);
    const mx = (edge.ax + edge.bx) / 2, mz = (edge.az + edge.bz) / 2;
    // a: distance along the corridor (signed with its direction), b: world offset across it
    const wx = (a, b) => alongX ? mx + ux * a : mx + b;
    const wz = (a, b) => alongX ? mz + b : mz + uz * a;
    const abox = (mat, a, y, b, sa, sy, sb, solid, textured) => {
      const X = wx(a, b), Z = wz(a, b);
      const sx = alongX ? sa : sb, sz = alongX ? sb : sa;
      if (solid) return this.solid(rec, mat, X, y, Z, sx, sy, sz, textured);
      if (textured) return this.texBox(rec, mat, X, y, Z, sx, sy, sz);
      return this.deco(rec, mat, X, y, Z, sx, sy, sz);
    };
    const S = this.shared;

    // floor (top face sits exactly at baseY) + a worn strip down the middle
    abox(S.floor, 0, by - 0.08, 0, span, 0.16, full, true, true);
    rec.colliders[rec.colliders.length - 1].max.y = by + 0.02;
    abox(S.floorWear, 0, by + 0.003, 0, span * 0.92, 0.006, W * 0.45, false, true);
    // ceiling slab (underside at baseY + H)
    abox(S.ceil, 0, by + H + 0.125, 0, span, 0.25, full, true, true);

    const pipeSide = edge.main ? 1 : -1;
    // side walls: the pipe side is the dirtier one. White trim top and bottom.
    for (const sign of [-1, 1]) {
      const b = sign * (W / 2 + 0.16);
      abox(sign === pipeSide ? S.stain : S.wall, 0, by + H / 2, b, span, H, 0.32, true, true);
      const tb = sign * (W / 2 - 0.015);
      abox(S.trim, 0, by + 0.09, tb, span, 0.18, 0.03, false);
      abox(S.trim, 0, by + H - 0.28, tb, span, 0.07, 0.03, false);
    }

    // pipes: three runs on the pipe wall (hot ones hurt), plus one overhead
    const runs = [
      { y: 0.55, r: 0.18, off: 1.02, mat: edge.hot ? S.hot : S.rust },
      { y: 1.22, r: 0.28, off: 1.22, mat: edge.hot ? S.hot : S.pipe },
      { y: 1.95, r: 0.16, off: 0.96, mat: edge.hot ? S.hot : S.rust }
    ];
    for (const run of runs) {
      const b = pipeSide * run.off;
      this.pipeRun(rec, edge.hot ? rec.hotBoxes : rec.colliders, run.mat,
        wx(0, b), by + run.y, wz(0, b), alongX, span * 0.96, run.r, true);
      const steps = Math.min(5, Math.max(1, Math.floor(span / 6)));
      for (let i = 0; i < steps; i++) {
        const a = -span / 2 + (i + 0.5) * span / steps;
        const flange = new THREE.Mesh(this.flangeGeo, run.mat);
        flange.scale.set(run.r / 0.28, 1, run.r / 0.28);
        if (alongX) flange.rotation.z = Math.PI / 2; else flange.rotation.x = Math.PI / 2;
        flange.position.set(wx(a, b), by + run.y, wz(a, b));
        rec.group.add(flange);
        if (i % 2 === 0) {
          // bracket to the wall
          const bb = pipeSide * (run.off + (W / 2 - run.off) * 0.55);
          abox(S.rust, a, by + run.y, bb, 0.1, 0.07, W / 2 - run.off, false);
        }
      }
    }
    // overhead run, out of reach
    this.pipeRun(rec, rec.colliders, edge.hot ? S.hot : S.pipe, wx(0, -pipeSide * 0.9), by + H - 0.42, wz(0, -pipeSide * 0.9),
      alongX, span * 0.98, 0.13, false);

    // wall-mounted pipe rack (uses the pipe texture) on the clean wall
    if (this.hash(edge.id, 40, 3) < 0.4 && span > 8) {
      const a = (this.hash(edge.id, 41, 3) - 0.5) * (span - 6);
      abox(S.pipePanel, a, by + 2.3, -pipeSide * (W / 2 - 0.07), 2.6, 1.1, 0.14, false, true);
    }
    // ceiling duct
    if (this.hash(edge.id, 42, 3) < 0.35 && span > 10) {
      const a = (this.hash(edge.id, 43, 3) - 0.5) * (span - 8);
      abox(S.pipe, a, by + H - 0.3, 0, 3.0, 0.34, 1.0, false);
    }
    // metal shelves along the clean wall, with a few supplies on them
    if (span > 12) {
      const count = this.hash(edge.id, 44, 3) < 0.5 ? 1 : 0 + (this.hash(edge.id, 45, 3) < 0.25 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const a = (this.hash(edge.id, 46 + k, 3) - 0.5) * (span - 8);
        const b = -pipeSide * (W / 2 - 0.26);
        const sw = 1.7, sd = 0.46;
        const sx = alongX ? sw : sd, sz = alongX ? sd : sw;
        const X = wx(a, b), Z = wz(a, b);
        for (const pa of [-sw / 2 + 0.03, sw / 2 - 0.03]) for (const pb of [-sd / 2 + 0.03, sd / 2 - 0.03]) {
          this.deco(rec, S.shelf, X + (alongX ? pa : pb), by + 1.0, Z + (alongX ? pb : pa), 0.05, 2.0, 0.05);
        }
        for (let lv = 0; lv < 4; lv++) this.deco(rec, S.shelf, X, by + 0.25 + lv * 0.55, Z, sx, 0.04, sz);
        for (let it = 0; it < 4; it++) {
          const h = this.hash(edge.id, 50 + k * 7 + it, 4);
          if (h < 0.3) continue;
          const o = (this.hash(edge.id, 60 + k * 7 + it, 4) - 0.5) * (sw - 0.5);
          const lv = Math.floor(this.hash(edge.id, 70 + k * 7 + it, 4) * 3);
          this.deco(rec, h > 0.65 ? S.crate : S.can, X + (alongX ? o : 0), by + 0.27 + lv * 0.55 + 0.14, Z + (alongX ? 0 : o), 0.3, 0.26, 0.3);
        }
        rec.colliders.push({
          min: new THREE.Vector3(X - sx / 2, by, Z - sz / 2),
          max: new THREE.Vector3(X + sx / 2, by + 2.0, Z + sz / 2)
        });
      }
    }

    // exit door
    if (edge.kind === "door") {
      const doorSide = -pipeSide;      // world sign of the wall the door is in
      const cdir = -doorSide;          // direction from the wall into the corridor
      const leafW = 0.92;
      const wallB = doorSide * (W / 2);
      // frame + black void behind the leaf, both flush with the wall
      const fa = this.deco(rec, S.frame, wx(0, wallB - doorSide * 0.015) , by + 1.1, wz(0, wallB - doorSide * 0.015),
        alongX ? leafW + 0.18 : 0.03, 2.2, alongX ? 0.03 : leafW + 0.18);
      const va = this.deco(rec, S.voidDark, wx(0, wallB - doorSide * 0.03), by + 1.03, wz(0, wallB - doorSide * 0.03),
        alongX ? leafW : 0.03, 2.06, alongX ? 0.03 : leafW);
      const depth = doorSide * (W / 2 - 0.09);   // leaf plane, 9 cm in front of the wall
      const hingeX = alongX ? mx - leafW / 2 : mx + depth;
      const hingeZ = alongX ? mz + depth : mz - leafW / 2;
      const pivot = new THREE.Group();
      pivot.position.set(hingeX, by, hingeZ);
      const leaf = new THREE.Mesh(this.box, S.door);
      leaf.scale.set(alongX ? leafW : 0.06, 2.05, alongX ? 0.06 : leafW);
      leaf.position.set(alongX ? leafW / 2 : 0, 1.03, alongX ? 0 : leafW / 2);
      pivot.add(leaf);
      const handle = new THREE.Mesh(this.box, S.handle);
      handle.scale.set(alongX ? 0.16 : 0.08, 0.1, alongX ? 0.08 : 0.16);
      handle.position.set(alongX ? leafW * 0.8 : cdir * 0.06, 1.05, alongX ? cdir * 0.06 : leafW * 0.8);
      pivot.add(handle);
      const markMat = edge.dest === 0 ? S.mark0 : edge.dest === 3 ? S.mark3 : S.mark1;
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), markMat);
      rec.geos.push(mark.geometry);
      mark.position.set(alongX ? leafW * 0.5 : cdir * 0.035, 1.6, alongX ? cdir * 0.035 : leafW * 0.5);
      if (alongX) mark.rotation.y = cdir > 0 ? 0 : Math.PI;
      else mark.rotation.y = cdir > 0 ? Math.PI / 2 : -Math.PI / 2;
      pivot.add(mark);
      rec.group.add(pivot);
      rec.doors.push({
        pivot, dest: edge.dest || 1, open: 0, used: false,
        x: wx(0, wallB), z: wz(0, wallB),
        // leaf swings into the corridor
        swing: alongX ? (doorSide > 0 ? 1 : -1) : (doorSide > 0 ? -1 : 1)
      });
      // a warm lamp over each door so it can be found in a dark section
      this.deco(rec, S.light, wx(0, doorSide * (W / 2 - 0.1)), by + 2.35, wz(0, doorSide * (W / 2 - 0.1)),
        alongX ? 0.6 : 0.08, 0.06, alongX ? 0.08 : 0.6);
      rec.fixtures.push({ x: wx(0, cdir * 0.4), y: by + 2.2, z: wz(0, cdir * 0.4), base: this.look.lightI * 0.7, ph: 1.7, bad: false });
      rec.lamps.push({ x: wx(0, cdir * 0.4), z: wz(0, cdir * 0.4), dead: false });
    }

    // fluorescent tubes. Some are dead, and some corridors have no working light at all.
    const dark = this.hash(edge.id, 77, 8) < 0.16 && edge.kind !== "door";
    const n = Math.max(1, Math.floor(span / 8));
    for (let i = 0; i < n; i++) {
      const a = -span / 2 + (i + 0.5) * span / n;
      const dead = dark || this.hash(edge.id, i, 6) < 0.16;
      abox(dead ? S.dead : S.light, a, by + H - 0.08, 0, 3.0, 0.07, 0.14, false);
      this.addFixture(rec, wx(a, 0), by + H - 0.35, wz(a, 0), dead, false);
    }

    this.group.add(rec.group);
    this.segments.set(key, rec);
  },

  /* ------------------------------------------------------------------
     JUNCTIONS (every node: floor, ceiling, and walls on the closed sides)
     ------------------------------------------------------------------ */
  buildNode(node) {
    const key = "n" + node.id;
    if (this.segments.has(key)) return;
    const rec = this.newRec();
    rec.edge = { ax: node.x, az: node.z, bx: node.x, bz: node.z };
    const W = this.width, H = this.height, by = this.baseY;
    const half = W / 2 + 0.16, full = W + 0.64;
    const S = this.shared;
    const has = {};
    for (const id of node.edges) {
      const e = this.edges[id];
      const ox = e.a === node.id ? e.bx : e.ax;
      const oz = e.a === node.id ? e.bz : e.az;
      has[Math.sign(ox - node.x) + "," + Math.sign(oz - node.z)] = true;
    }
    // This was the missing piece: junctions had no floor at all, and the spawn is a junction.
    this.texBox(rec, S.floor, node.x, by - 0.08, node.z, full, 0.16, full);
    rec.colliders.push({
      min: new THREE.Vector3(node.x - full / 2, by - 0.5, node.z - full / 2),
      max: new THREE.Vector3(node.x + full / 2, by + 0.02, node.z + full / 2)
    });
    this.solid(rec, S.ceil, node.x, by + H + 0.125, node.z, full, 0.25, full, true);
    for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (has[d[0] + "," + d[1]]) continue;
      const wx = node.x + d[0] * half, wz = node.z + d[1] * half;
      const sx = d[0] !== 0 ? 0.32 : full, sz = d[0] !== 0 ? full : 0.32;
      this.solid(rec, S.wall, wx, by + H / 2, wz, sx, H, sz, true);
      // trim on the inside face
      const tx = node.x + d[0] * (W / 2 - 0.015), tz = node.z + d[1] * (W / 2 - 0.015);
      const ts = d[0] !== 0 ? 0.03 : W, tz2 = d[0] !== 0 ? W : 0.03;
      this.deco(rec, S.trim, tx, by + 0.09, tz, ts, 0.18, tz2);
      this.deco(rec, S.trim, tx, by + H - 0.28, tz, ts, 0.07, tz2);
    }
    // corner posts where two neighbouring sides are both open (otherwise a notch is left)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (has[sx + ",0"] && has["0," + sz]) {
        this.solid(rec, S.wall, node.x + sx * half, by + H / 2, node.z + sz * half, 0.32, H, 0.32, true);
      }
    }
    // junction light
    const dead = this.hash(node.id, 1, 11) < 0.22;
    this.deco(rec, dead ? S.dead : S.light, node.x, by + H - 0.08, node.z, 1.6, 0.07, 0.14);
    this.addFixture(rec, node.x, by + H - 0.35, node.z, dead, false);
    // dead ends get a shelf and a crate so they read as storage nooks
    if (node.edges.length === 1) {
      for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (has[d[0] + "," + d[1]]) continue;
        const px = node.x + d[0] * (half - 0.35), pz = node.z + d[1] * (half - 0.35);
        const wide = d[0] === 0;
        this.solid(rec, S.crate, px + (wide ? 0.8 : 0), by + 0.3, pz + (wide ? 0 : 0.8), 0.6, 0.6, 0.6);
        this.solid(rec, S.shelf, px - (wide ? 0.8 : 0), by + 0.9, pz - (wide ? 0 : 0.8), wide ? 1.2 : 0.4, 1.8, wide ? 0.4 : 1.2);
        break;
      }
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
    const key = Math.floor(px / 16) + "," + Math.floor(pz / 16);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    for (const e of this.edges) {
      const mx = (e.ax + e.bx) * 0.5, mz = (e.az + e.bz) * 0.5;
      if (Math.hypot(mx - px, mz - pz) < 70) this.buildEdge(e);
    }
    for (const n of this.nodes) {
      if (Math.hypot(n.x - px, n.z - pz) < 70) this.buildNode(n);
    }
    for (const [k, rec] of Array.from(this.segments.entries())) {
      const e = rec.edge;
      const mx = (e.ax + e.bx) * 0.5, mz = (e.az + e.bz) * 0.5;
      if (Math.hypot(mx - px, mz - pz) > 95) {
        this.disposeSegment(rec);
        this.segments.delete(k);
      }
    }
    this.colliders.length = 0;
    this.hot.length = 0;
    this.doors = [];
    this.fixtures = [];
    this.lamps = [];
    for (const rec of this.segments.values()) {
      for (const l of rec.lamps || []) this.lamps.push(l);
      for (const c of rec.colliders) this.colliders.push(c);
      for (const c of rec.hotBoxes || []) this.hot.push(c);
      for (const d of rec.doors || []) this.doors.push(d);
      for (const f of rec.fixtures || []) this.fixtures.push(f);
    }
  },

  // A point is dark when no working fixture is within 7 m, or the nearest tube of
  // any kind is dead (a dead tube, or a corridor with no working light at all).
  isDarkAt(x, z) {
    let near = null, nd = Infinity, live = false;
    for (const l of this.lamps) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < nd) { nd = d; near = l; }
      if (!l.dead && d <= 7) live = true;
    }
    return !live || (near !== null && near.dead);
  },

  // Point the light pool at the nearest working fixtures.
  assignLights() {
    if (!this.pool.length) return;
    const p = Player.position;
    const cand = [];
    for (const f of this.fixtures) {
      const d = (f.x - p.x) * (f.x - p.x) + (f.z - p.z) * (f.z - p.z);
      if (d < 34 * 34) cand.push({ f, d });
    }
    cand.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const c = cand[i];
      this.poolFx[i] = c ? c.f : null;
      if (c) this.pool[i].position.set(c.f.x, c.f.y, c.f.z);
      else this.pool[i].intensity = 0;
    }
  },

  tryUse() {
    if (!this.active || !this.doors) return false;
    const p = Player.position;
    let best = null, bestD = 1.8;
    for (const d of this.doors) {
      if (!d.pivot.parent || d.used) continue;
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < bestD) { best = d; bestD = dist; }
    }
    if (!best) return false;
    best.used = true;
    if (typeof HUD !== "undefined") HUD.toast("LEVEL " + best.dest);
    return true;
  },

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    this.stream(false);
    this._poolT -= dt;
    if (this._poolT <= 0) { this._poolT = 0.2; this.assignLights(); }
    // flickering fluorescents: most hold steady, the bad ones stutter
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.poolFx[i];
      if (!f) continue;
      const t = this.time + f.ph;
      const s = Math.sin(t * 23.0) * Math.sin(t * 7.3);
      const flick = f.bad ? (s > 0.35 ? 0.12 : 1) : (s > 0.96 ? 0.5 : 1);
      this.pool[i].intensity = f.base * flick * (0.92 + 0.08 * Math.sin(t * 1.7));
    }
    if (this.doors) {
      for (const d of this.doors) {
        if (!d.used || d.open >= 1) continue;
        d.open = Math.min(1, d.open + dt / 0.7);
        d.pivot.rotation.y = d.open * 1.55 * d.swing;
        if (d.open >= 1 && !d.gone) {
          d.gone = true;
          if (d.dest === 0 && typeof DevCommands !== "undefined") DevCommands.goLevel0();
          else if (d.dest === 3 && typeof DevCommands !== "undefined") DevCommands.goLevel3();
          else if (typeof DevCommands !== "undefined") DevCommands.goLevel1();
        }
      }
    }
    const tint = document.getElementById("heat-tint");
    let near = 0;
    const p = Player.position;
    if (this.hot && this.hot.length) {
      for (const b of this.hot) {
        const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
        const d = Math.hypot(p.x - cx, p.z - cz);
        near = Math.max(near, 1 - d / 2.4);
        if (p.x + 0.34 < b.min.x || p.x - 0.34 > b.max.x) continue;
        if (p.z + 0.34 < b.min.z || p.z - 0.34 > b.max.z) continue;
        if (p.y + 1.6 < b.min.y || p.y > b.max.y) continue;
        Player.damagePlayer(Math.max(1, 18 * dt));
        if (!this._heatT || this._heatT <= 0) {
          this._heatT = 2.5;
          if (typeof HUD !== "undefined") HUD.toast("THE PIPES ARE HOT");
        }
      }
    }
    if (tint) tint.style.opacity = String(Math.max(0, Math.min(0.45, near)));
    if (this._heatT) this._heatT -= dt;
    // the wiki's constant machinery: distant pipe knocks and hisses
    this._sfxT = (this._sfxT == null ? 3 : this._sfxT) - dt;
    if (this._sfxT <= 0) {
      this._sfxT = 4 + Math.random() * 7;
      if (typeof AudioSystem !== "undefined" && AudioSystem.playPositional) {
        const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 18;
        const k = ["pipe", "metal", "thump", "flicker"][Math.floor(Math.random() * 4)];
        AudioSystem.playPositional(k, p.x + Math.cos(a) * r, 1.6, p.z + Math.sin(a) * r, { gain: 0.05, bus: "events", max: 60 });
      }
    }
  }
};
