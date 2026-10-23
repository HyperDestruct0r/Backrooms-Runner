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
  lastKey: "",
  infoText: "",

  hash(x, z, salt) {
    let h = (this.seed >>> 0) ^ Math.imul((x | 0) + (salt || 0), 0x45d9f3b) ^ Math.imul((z | 0) - (salt || 0), 0x27d4eb2d);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  generate(seed) {
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
    const growBranch = (from, dx, dz, depth) => {
      const roll = r();
      const span = roll < 0.4 ? 12 + Math.floor(r() * 8) : roll < 0.75 ? 28 + Math.floor(r() * 16) : 48 + Math.floor(r() * 24);
      const nx = from.x + dx * span, nz = from.z + dz * span;
      if (occ.has(key(nx, nz))) return;
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
      while (occ.has(key(nx, nz)) && guard++ < 4) {
        const d = dirs[Math.floor(r() * 4)];
        dx = d[0]; dz = d[1];
        nx = cur.x + dx * span; nz = cur.z + dz * span;
      }
      const next = addNode(nx, nz);
      const sideDoor = i > 0 && r() < 0.22;
      const dest = r() < 0.6 ? 1 : 0;
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
    for (const n of nodes) {
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
  },

  markTex(level) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d");
    ctx.fillStyle = level === 0 ? "#6a6248" : "#5a5c5e";
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = "#2a2824";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 112, 112);
    ctx.strokeStyle = level === 0 ? "#c2b48a" : "#b0b4b6";
    ctx.lineWidth = 5;
    if (level === 0) {
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

  materialSet() {
    if (this.shared) return;
    const concrete = (size, base, courses) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(size, size);
      const d = img.data;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
          const h = n - Math.floor(n);
          const speck = h > 0.9 ? 22 : h < 0.08 ? -18 : (h - 0.5) * 12;
          const course = courses && (y % 42 < 2) ? -28 : 0;
          const v = base + speck + course;
          const i = (y * size + x) * 4;
          d[i] = v + 1; d[i + 1] = v; d[i + 2] = v - 1; d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    this.shared = {
      wall: new THREE.MeshStandardMaterial({ map: concrete(256, 150, true), color: 0xc8c8c4, roughness: 0.94, metalness: 0 }),
      stain: new THREE.MeshStandardMaterial({ map: concrete(256, 108, true), color: 0xa8a49c, roughness: 0.96, metalness: 0 }),
      floor: new THREE.MeshStandardMaterial({ map: concrete(256, 118, false), color: 0xb4b0a8, roughness: 0.97, metalness: 0 }),
      floorWear: new THREE.MeshStandardMaterial({ map: concrete(256, 96, false), color: 0x9a968e, roughness: 0.98, metalness: 0 }),
      ceil: new THREE.MeshStandardMaterial({ color: 0x2e2d2c, roughness: 0.96 }),
      seam: new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 1 }),
      pipe: new THREE.MeshStandardMaterial({ color: 0x8d9294, roughness: 0.42, metalness: 0.55 }),
      hot: new THREE.MeshStandardMaterial({ color: 0xc45a32, emissive: 0x6a220c, roughness: 0.4, metalness: 0.35 }),
      door: new THREE.MeshStandardMaterial({ color: 0x3e3832, roughness: 0.86 }),
      handle: new THREE.MeshStandardMaterial({ color: 0x8a8278, metalness: 0.6, roughness: 0.35 }),
      mark0: this.markTex(0),
      mark1: this.markTex(1),
      rust: new THREE.MeshStandardMaterial({ color: 0x7a5340, roughness: 0.62, metalness: 0.28 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff1d2, toneMapped: false }),
      dead: new THREE.MeshStandardMaterial({ color: 0x3a3834, roughness: 0.8 })
    };
    this.pipeGeo = new THREE.CylinderGeometry(0.32, 0.32, 1, 10);
    this.flangeGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.06, 10);
    this.box = Geometries.box;
  },

  reset() {
    if (this.group && scene) scene.remove(this.group);
    for (const rec of this.segments.values()) this.disposeSegment(rec);
    this.segments.clear();
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.colliders.length = 0;
    if (this.hot) this.hot.length = 0;
    this.doors = [];
    this.group = null;
    this.active = false;
    this.lastKey = "";
    this.edges = [];
    this.nodes = [];
    const tint = document.getElementById("heat-tint");
    if (tint) tint.style.opacity = "0";
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
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
    const hemi = new THREE.HemisphereLight(0xd0d4d8, 0x3a3a38, 0.34);
    const amb = new THREE.AmbientLight(0xc8ccc8, 0.22);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    scene.fog = new THREE.Fog(0x6a6a68, 18, 60);
    if (scene.background) scene.background.setHex(0x4a4a48);
    if (CameraRig.camera) { CameraRig.camera.far = 110; CameraRig.camera.updateProjectionMatrix(); }
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
    if (obj) obj.textContent = "Objective: find a way through";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 2";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this.stream(true);
    this.placeBottles();
    Player.position.copy(this.spawn);
    Player.yaw = Math.PI;
  },

  addBox(g, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(this.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  },

  addPipeRun(g, colliders, x, y, z, alongX, len, radius, mat) {
    const pipe = new THREE.Mesh(this.pipeGeo, mat);
    pipe.scale.set(radius / 0.32, len, radius / 0.32);
    if (alongX) pipe.rotation.z = Math.PI / 2;
    else pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, y, z);
    g.add(pipe);
    const hx = alongX ? len / 2 : radius;
    const hz = alongX ? radius : len / 2;
    colliders.push({
      min: new THREE.Vector3(x - hx, y - radius, z - hz),
      max: new THREE.Vector3(x + hx, y + radius, z + hz)
    });
  },

  buildEdge(edge) {
    const key = String(edge.id);
    if (this.segments.has(key)) return;
    const g = new THREE.Group();
    const dx = edge.bx - edge.ax, dz = edge.bz - edge.az;
    const len = Math.max(4, edge.len);
    const ux = dx / len, uz = dz / len;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const W = this.width, H = this.height;
    const inset = 1.4;
    const x0 = edge.ax + ux * inset, z0 = edge.az + uz * inset;
    const x1 = edge.bx - ux * inset, z1 = edge.bz - uz * inset;
    const mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
    const span = Math.max(2, len - inset * 2);
    const colliders = [];
    this.addBox(g, this.shared.floor, mx, this.baseY - 0.08, mz, alongX ? span + 3 : W + 0.8, 0.14, alongX ? W + 0.8 : span + 3);
    this.addBox(g, this.shared.floorWear, mx, this.baseY - 0.01, mz, alongX ? span * 0.92 : W * 0.42, 0.02, alongX ? W * 0.42 : span * 0.92);
    colliders.push({
      min: new THREE.Vector3(mx - (alongX ? span / 2 + 1.5 : W / 2 + 0.4), this.baseY - 0.5, mz - (alongX ? W / 2 + 0.4 : span / 2 + 1.5)),
      max: new THREE.Vector3(mx + (alongX ? span / 2 + 1.5 : W / 2 + 0.4), this.baseY + 0.02, mz + (alongX ? W / 2 + 0.4 : span / 2 + 1.5))
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? span : W, alongX ? W : span), this.shared.ceil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(mx, this.baseY + H, mz);
    g.add(ceil);
    colliders.push({
      min: new THREE.Vector3(mx - (alongX ? span / 2 : W / 2), this.baseY + H - 0.05, mz - (alongX ? W / 2 : span / 2)),
      max: new THREE.Vector3(mx + (alongX ? span / 2 : W / 2), this.baseY + H + 0.2, mz + (alongX ? W / 2 : span / 2))
    });
    const pipeSide = edge.main ? 1 : -1;
    for (const sign of [-1, 1]) {
      const wx = alongX ? mx : mx + sign * (W / 2 + 0.16);
      const wz = alongX ? mz + sign * (W / 2 + 0.16) : mz;
      const sx = alongX ? span + 0.6 : 0.32;
      const sz = alongX ? 0.32 : span + 0.6;
      const pipeWall = sign === pipeSide;
      this.addBox(g, pipeWall ? this.shared.stain : this.shared.wall, wx, this.baseY + 0.5, wz, sx, 1.0, sz);
      this.addBox(g, this.shared.wall, wx, this.baseY + 1.0 + (H - 1.0) / 2, wz, sx, H - 1.0, sz);
      this.addBox(g, this.shared.seam, wx, this.baseY + H - 0.04, wz, sx, 0.08, sz);
      colliders.push({
        min: new THREE.Vector3(wx - sx / 2, this.baseY, wz - sz / 2),
        max: new THREE.Vector3(wx + sx / 2, this.baseY + H, wz + sz / 2)
      });
    }
    const endNode = this.nodes[edge.b];
    if (endNode && endNode.edges.length === 1) {
      const capX = alongX ? 0.32 : W + 0.4;
      const capZ = alongX ? W + 0.4 : 0.32;
      this.addBox(g, this.shared.wall, edge.bx, this.baseY + H / 2, edge.bz, capX, H, capZ);
      colliders.push({
        min: new THREE.Vector3(edge.bx - capX / 2, this.baseY, edge.bz - capZ / 2),
        max: new THREE.Vector3(edge.bx + capX / 2, this.baseY + H, edge.bz + capZ / 2)
      });
    }
    const runs = [
      { y: 0.55, r: 0.18, off: 1.02, mat: edge.hot ? this.shared.hot : this.shared.rust },
      { y: 1.22, r: 0.28, off: 1.22, mat: edge.hot ? this.shared.hot : this.shared.pipe },
      { y: 1.95, r: 0.16, off: 0.96, mat: edge.hot ? this.shared.hot : this.shared.rust }
    ];
    const hotBoxes = [];
    for (const run of runs) {
      const px = mx + (alongX ? 0 : pipeSide * run.off);
      const pz = mz + (alongX ? pipeSide * run.off : 0);
      this.addPipeRun(g, edge.hot ? hotBoxes : colliders, px, this.baseY + run.y, pz, alongX, span * 0.92, run.r, run.mat);
      const steps = Math.min(5, Math.max(1, Math.floor(span / 6)));
      for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const fx = x0 + (x1 - x0) * t, fz = z0 + (z1 - z0) * t;
        const flange = new THREE.Mesh(this.flangeGeo, run.mat);
        flange.scale.set(run.r / 0.28, 1, run.r / 0.28);
        if (alongX) flange.rotation.z = Math.PI / 2;
        else flange.rotation.x = Math.PI / 2;
        flange.position.set(fx + (alongX ? 0 : pipeSide * run.off), this.baseY + run.y, fz + (alongX ? pipeSide * run.off : 0));
        g.add(flange);
        if (i % 2 === 0) {
          const bx = fx + (alongX ? 0 : pipeSide * (run.off * 0.45));
          const bz = fz + (alongX ? pipeSide * (run.off * 0.45) : 0);
          this.addBox(g, this.shared.rust, bx, this.baseY + run.y, bz, alongX ? 0.08 : 0.22, 0.06, alongX ? 0.22 : 0.08);
        }
      }
    }
    if (edge.kind === "door") {
      const doorSide = -pipeSide;
      const hx = alongX ? 0 : doorSide;
      const hz = alongX ? doorSide : 0;
      const leafW = 0.92;
      const hingeX = alongX ? mx - leafW / 2 : mx + doorSide * (W / 2 + 0.02);
      const hingeZ = alongX ? mz + doorSide * (W / 2 + 0.02) : mz - leafW / 2;
      const pivot = new THREE.Group();
      pivot.position.set(hingeX, this.baseY, hingeZ);
      const leaf = new THREE.Mesh(this.box, this.shared.door);
      leaf.scale.set(alongX ? leafW : 0.06, 2.05, alongX ? 0.06 : leafW);
      leaf.position.set(alongX ? leafW / 2 : 0, 1.15, alongX ? 0 : leafW / 2);
      pivot.add(leaf);
      const handle = new THREE.Mesh(this.box, this.shared.handle);
      handle.scale.set(0.08, 0.16, 0.05);
      handle.position.set(alongX ? leafW * 0.78 : doorSide * 0.05, 1.05, alongX ? doorSide * 0.05 : leafW * 0.78);
      pivot.add(handle);
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), edge.dest === 0 ? this.shared.mark0 : this.shared.mark1);
      mark.position.set(alongX ? leafW * 0.5 : doorSide * 0.04, 1.55, alongX ? doorSide * 0.04 : leafW * 0.5);
      if (!alongX) mark.rotation.y = doorSide > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (alongX) mark.rotation.y = doorSide > 0 ? 0 : Math.PI;
      pivot.add(mark);
      g.add(pivot);
      this.doors.push({
        pivot, dest: edge.dest || 1, open: 0, used: false,
        x: alongX ? mx : mx + doorSide * (W / 2),
        z: alongX ? mz + doorSide * (W / 2) : mz,
        swing: alongX ? (doorSide > 0 ? -1 : 1) : (doorSide > 0 ? 1 : -1)
      });
    }
    const lights = [];
    const n = Math.max(1, Math.floor(span / 8));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lx = x0 + (x1 - x0) * t, lz = z0 + (z1 - z0) * t;
      const dead = this.hash(edge.id, i, 6) < 0.16;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 3.4 : 0.14, 0.07, alongX ? 0.14 : 3.4), dead ? this.shared.dead : this.shared.light);
      tube.position.set(lx, this.baseY + H - 0.08, lz);
      g.add(tube);
      if (!dead && this.countLights() + lights.length < 18) {
        const L = new THREE.PointLight(0xffe7c2, 1.8, 16, 1.4);
        L.position.set(lx, this.baseY + H - 0.22, lz);
        g.add(L);
        lights.push(L);
      }
    }
    this.group.add(g);
    this.segments.set(key, { group: g, colliders, hotBoxes, lights, edge });
  },

  countLights() {
    let n = 0;
    for (const rec of this.segments.values()) n += rec.lights.length;
    return n;
  },

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
    for (const [k, rec] of Array.from(this.segments.entries())) {
      const e = rec.edge;
      const mx = (e.ax + e.bx) * 0.5, mz = (e.az + e.bz) * 0.5;
      if (Math.hypot(mx - px, mz - pz) > 90) {
        this.disposeSegment(rec);
        this.segments.delete(k);
      }
    }
    this.colliders.length = 0;
    this.hot.length = 0;
    for (const rec of this.segments.values()) {
      for (const c of rec.colliders) this.colliders.push(c);
      for (const c of rec.hotBoxes || []) this.hot.push(c);
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
    if (typeof HUD !== "undefined") HUD.toast(best.dest === 0 ? "LEVEL 0" : "LEVEL 1");
    return true;
  },

  update(dt) {
    if (!this.active) return;
    this.stream(false);
    if (this.doors) {
      for (const d of this.doors) {
        if (!d.used || d.open >= 1) continue;
        d.open = Math.min(1, d.open + dt / 0.7);
        const angle = d.open * 1.55 * d.swing;
        d.pivot.rotation.y = angle;
        if (d.open >= 1 && !d.gone) {
          d.gone = true;
          if (d.dest === 0 && typeof DevCommands !== "undefined") DevCommands.goLevel0();
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
  }
};
