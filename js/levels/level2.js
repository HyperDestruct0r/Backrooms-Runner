"use strict";

/* Level 2 — industrial maintenance tunnels.
   Finite seeded graph. Main route is built first, then branches.
   Segments stream around the player so the whole network is not drawn at once. */
const Level2 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  segments: new Map(),
  nodes: [],
  edges: [],
  spawn: new THREE.Vector3(),
  exitPos: null,
  baseY: 0,
  width: 3.2,
  height: 2.62,
  shared: null,
  ambient: [],
  lastKey: "",
  infoText: "",

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  generate(seed) {
    const r = this.rng(seed >>> 0);
    const nodes = [];
    const edges = [];
    const occ = new Set();
    const key = (x, z) => x + "," + z;
    const addNode = (x, z) => {
      const n = { id: nodes.length, x, z, edges: [] };
      nodes.push(n);
      occ.add(key(x, z));
      return n;
    };
    const link = (a, b, kind, main) => {
      const e = {
        id: edges.length, a: a.id, b: b.id, kind, main,
        ax: a.x, az: a.z, bx: b.x, bz: b.z,
        len: Math.hypot(b.x - a.x, b.z - a.z)
      };
      edges.push(e);
      a.edges.push(e.id);
      b.edges.push(e.id);
      return e;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let cur = addNode(0, 0);
    let dx = 0, dz = 1;
    const route = [cur];
    for (let i = 0; i < 8; i++) {
      const span = i === 0 ? 70 : 42 + Math.floor(r() * 22);
      if (i === 1 || (i > 1 && r() < 0.62)) {
        const left = r() < 0.5;
        const ndx = left ? -dz : dz;
        const ndz = left ? dx : -dx;
        dx = ndx; dz = ndz;
      }
      let nx = cur.x + dx * span, nz = cur.z + dz * span;
      let guard = 0;
      while ((occ.has(key(nx, nz)) || Math.hypot(nx, nz) < 8) && guard++ < 6) {
        const d = dirs[Math.floor(r() * 4)];
        dx = d[0]; dz = d[1];
        nx = cur.x + dx * span; nz = cur.z + dz * span;
      }
      const next = addNode(nx, nz);
      link(cur, next, "main", true);
      route.push(next);
      cur = next;
    }
    const exit = route[route.length - 1];
    for (let i = 1; i < route.length - 1; i++) {
      const n = route[i];
      const branches = 1 + (r() < 0.45 ? 1 : 0);
      for (let b = 0; b < branches; b++) {
        const used = new Set(n.edges.map(id => {
          const e = edges[id];
          const ox = e.a === n.id ? e.bx : e.ax;
          const oz = e.a === n.id ? e.bz : e.az;
          return Math.sign(ox - n.x) + "," + Math.sign(oz - n.z);
        }));
        const open = dirs.filter(d => !used.has(d[0] + "," + d[1]));
        if (!open.length) continue;
        const d = open[Math.floor(r() * open.length)];
        const span = 24 + Math.floor(r() * 22);
        const nx = n.x + d[0] * span, nz = n.z + d[1] * span;
        if (occ.has(key(nx, nz))) continue;
        const roll = r();
        const kind = roll < 0.96 ? "dead" : roll < 0.99 ? "alt" : "anomaly";
        const end = addNode(nx, nz);
        link(n, end, kind, false);
      }
    }
    this.nodes = nodes;
    this.edges = edges;
    this.exitPos = new THREE.Vector3(exit.x, this.baseY, exit.z);
    const first = edges[0];
    const t = 16 / first.len;
    this.spawn.set(first.ax + (first.bx - first.ax) * t, this.baseY, first.az + (first.bz - first.az) * t);
    this.spawnYaw = Math.atan2(first.ax - first.bx, first.az - first.bz);
    this.infoText = "NODES " + nodes.length + " · EDGES " + edges.length + " · MAIN " + route.length;
  },

  materialSet() {
    if (this.shared) return;
    const load = (file, repeat) => {
      const tex = new THREE.TextureLoader().load(file);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeat[0], repeat[1]);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    const blockTex = load("assets/level2-block.jpg", [1.4, 1.1]);
    const floorTex = load("assets/level2-block.jpg", [2, 2]);
    const rustTex = load("assets/level2-rust.jpg", [1, 3]);
    this.shared = {
      brick: new THREE.MeshStandardMaterial({ map: blockTex, roughness: 0.9, metalness: 0.02 }),
      floor: new THREE.MeshStandardMaterial({ map: floorTex, color: 0xb0aaa4, roughness: 0.92, metalness: 0.02 }),
      ceil: new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.95 }),
      pipe: new THREE.MeshStandardMaterial({ map: rustTex, color: 0xc4b8ae, roughness: 0.46, metalness: 0.55 }),
      rust: new THREE.MeshStandardMaterial({ map: rustTex, color: 0xb86a3a, roughness: 0.62, metalness: 0.32 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff4dd, toneMapped: false }),
      damp: new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 1 })
    };
    this.pipeGeo = new THREE.CylinderGeometry(0.34, 0.34, 1, 14);
    this.flangeGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.07, 14);
    this.box = Geometries.box;
  },

  reset() {
    if (this.group && scene) scene.remove(this.group);
    for (const rec of this.segments.values()) this.disposeSegment(rec);
    this.segments.clear();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.colliders.length = 0;
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.nodes = [];
    this.edges = [];
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    if (rec.lights) {
      for (const L of rec.lights) if (L.parent) L.parent.remove(L);
    }
  },

  enter(seed) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
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
    const hemi = new THREE.HemisphereLight(0x6a5a48, 0x1a1612, 0.16);
    const amb = new THREE.AmbientLight(0x8a7058, 0.06);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    scene.fog = new THREE.Fog(0x14110e, 10, 42);
    if (scene.background) scene.background.setHex(0x14110e);
    if (CameraRig.camera) { CameraRig.camera.far = 90; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 2;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = this.spawnYaw || 0;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: find a way through";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 2";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this.stream(true);
  },

  addBox(g, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  },

  buildSegment(edge) {
    const key = String(edge.id);
    if (this.segments.has(key)) return;
    const g = new THREE.Group();
    g.name = "L2_" + key;
    const dx = edge.bx - edge.ax, dz = edge.bz - edge.az;
    const len = Math.max(1, edge.len);
    const ux = dx / len, uz = dz / len;
    const rx = -uz, rz = ux;
    const W = this.width, H = this.height;
    const inset = 1.6;
    const x0 = edge.ax + ux * inset, z0 = edge.az + uz * inset;
    const x1 = edge.bx - ux * inset, z1 = edge.bz - uz * inset;
    const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
    const span = Math.max(2, len - inset * 2);
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? span : W, alongX ? W : span), this.shared.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(mx, this.baseY, mz);
    g.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? span : W, alongX ? W : span), this.shared.ceil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(mx, this.baseY + H, mz);
    g.add(ceil);
    const colliders = [];
    const floorPad = this.addBox(g, this.shared.floor, mx, this.baseY - 0.08, mz, alongX ? span + 4 : W + 1.2, 0.16, alongX ? W + 1.2 : span + 4);
    colliders.push({
      min: new THREE.Vector3(mx - (alongX ? span / 2 + 2 : W / 2 + 0.6), this.baseY - 0.4, mz - (alongX ? W / 2 + 0.6 : span / 2 + 2)),
      max: new THREE.Vector3(mx + (alongX ? span / 2 + 2 : W / 2 + 0.6), this.baseY + 0.02, mz + (alongX ? W / 2 + 0.6 : span / 2 + 2))
    });
    for (const sign of [-1, 1]) {
      const wx = alongX ? mx : mx + sign * (W / 2 + 0.18);
      const wz = alongX ? mz + sign * (W / 2 + 0.18) : mz;
      const sx = alongX ? span + 0.4 : 0.36;
      const sz = alongX ? 0.36 : span + 0.4;
      this.addBox(g, this.shared.brick, wx, this.baseY + H / 2, wz, sx, H, sz);
      colliders.push({
        min: new THREE.Vector3(wx - sx / 2, this.baseY, wz - sz / 2),
        max: new THREE.Vector3(wx + sx / 2, this.baseY + H, wz + sz / 2)
      });
    }
    const pipeSide = edge.main ? 1 : -1;
    const pipeRuns = [
      { side: pipeSide, y: 0.55, r: 0.28, mat: "rust" },
      { side: pipeSide, y: 1.25, r: 0.38, mat: "pipe" },
      { side: pipeSide, y: 2.05, r: 0.24, mat: "rust" }
    ];
    for (const run of pipeRuns) {
      const offset = 1.15;
      const px = mx + rx * run.side * offset;
      const pz = mz + rz * run.side * offset;
      const pipe = new THREE.Mesh(this.pipeGeo, this.shared[run.mat]);
      pipe.scale.set(run.r / 0.34, span, run.r / 0.34);
      if (alongX) pipe.rotation.z = Math.PI / 2;
      else pipe.rotation.x = Math.PI / 2;
      pipe.position.set(px, this.baseY + run.y, pz);
      g.add(pipe);
      const flanges = Math.max(2, Math.floor(span / 10));
      for (let i = 0; i < flanges; i++) {
        const t = (i + 0.5) / flanges;
        const fx = x0 + (x1 - x0) * t + rx * run.side * offset;
        const fz = z0 + (z1 - z0) * t + rz * run.side * offset;
        const flange = new THREE.Mesh(this.flangeGeo, this.shared.pipe);
        flange.scale.set(run.r / 0.34, 1, run.r / 0.34);
        if (alongX) flange.rotation.z = Math.PI / 2;
        else flange.rotation.x = Math.PI / 2;
        flange.position.set(fx, this.baseY + run.y, fz);
        g.add(flange);
      }
    }
    if (!edge.main) {
      const capX = alongX ? 0.4 : W + 0.4;
      const capZ = alongX ? W + 0.4 : 0.4;
      this.addBox(g, this.shared.brick, edge.bx, this.baseY + H / 2, edge.bz, capX, H, capZ);
      colliders.push({
        min: new THREE.Vector3(edge.bx - capX / 2, this.baseY, edge.bz - capZ / 2),
        max: new THREE.Vector3(edge.bx + capX / 2, this.baseY + H, edge.bz + capZ / 2)
      });
      this.addBox(g, this.shared.damp, edge.bx - ux * 2, this.baseY + 0.02, edge.bz - uz * 2, 1.2, 0.04, 1.2);
      const valve = this.addBox(g, this.shared.rust, edge.bx - ux * 1.2, this.baseY + 1.3, edge.bz - uz * 1.2, 0.28, 0.28, 0.12);
      if (edge.kind === "alt") this.addBox(g, this.shared.light, edge.bx - ux * 0.8, this.baseY + 1.5, edge.bz - uz * 0.8, 0.7, 0.16, 0.06);
      if (edge.kind === "anomaly") this.addBox(g, this.shared.rust, edge.bx - ux * 0.8, this.baseY + 1.5, edge.bz - uz * 0.8, 0.7, 0.16, 0.06);
    }
    const lights = [];
    const lightCount = Math.max(1, Math.floor(span / 14));
    for (let i = 0; i < lightCount; i++) {
      const t = (i + 0.5) / lightCount;
      const lx = x0 + (x1 - x0) * t, lz = z0 + (z1 - z0) * t;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 2.4 : 0.16, 0.08, alongX ? 0.16 : 2.4), this.shared.light);
      tube.position.set(lx, this.baseY + H - 0.12, lz);
      g.add(tube);
      if (lights.length < 1 && this.countLights() < 14) {
        const color = edge.main ? 0xffc48a : 0xc8b8a0;
        const L = new THREE.PointLight(color, edge.main ? 0.7 : 0.4, 10, 1.6);
        L.position.set(lx, this.baseY + H - 0.3, lz);
        g.add(L);
        lights.push(L);
      }
    }
    this.group.add(g);
    this.segments.set(key, { group: g, colliders, lights, edge });
  },

  countLights() {
    let n = 0;
    for (const rec of this.segments.values()) n += rec.lights.length;
    return n;
  },

  stream(force) {
    if (!this.active || !this.group) return;
    const px = Player.position.x, pz = Player.position.z;
    const key = Math.floor(px / 20) + "," + Math.floor(pz / 20);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    for (const e of this.edges) {
      const mx = (e.ax + e.bx) * 0.5, mz = (e.az + e.bz) * 0.5;
      const d = Math.hypot(mx - px, mz - pz);
      if (d < 78) this.buildSegment(e);
    }
    for (const [k, rec] of Array.from(this.segments.entries())) {
      const e = rec.edge;
      const mx = (e.ax + e.bx) * 0.5, mz = (e.az + e.bz) * 0.5;
      if (Math.hypot(mx - px, mz - pz) > 96) {
        this.disposeSegment(rec);
        this.segments.delete(k);
      }
    }
    this.colliders.length = 0;
    for (const rec of this.segments.values()) {
      for (const c of rec.colliders) this.colliders.push(c);
    }
  },

  update(dt) {
    if (!this.active) return;
    this.stream(false);
    if (!this._toastT) this._toastT = 0;
    this._toastT -= dt;
    if (this._toastT > 0) return;
    for (const e of this.edges) {
      if (e.kind !== "alt" && e.kind !== "anomaly") continue;
      if (Math.hypot(e.bx - Player.position.x, e.bz - Player.position.z) > 2.4) continue;
      this._toastT = 4;
      if (typeof HUD !== "undefined") HUD.toast(e.kind === "alt" ? "ALTERNATE EXIT · NOT IMPLEMENTED" : "ANOMALOUS SPACE");
      return;
    }
  }
};
