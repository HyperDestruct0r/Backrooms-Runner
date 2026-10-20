"use strict";

/* Level 2 — infinite industrial tunnels.
   A main corridor runs both ways from spawn. Side branches are sealed.
   Chunks stream around the player. */
const Level2 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  segments: new Map(),
  spawn: new THREE.Vector3(),
  exitPos: null,
  baseY: 0,
  width: 3.6,
  height: 2.7,
  cell: 36,
  shared: null,
  ambient: [],
  lastKey: "",
  infoText: "",

  hash(x, z, salt) {
    let h = (this.seed >>> 0) ^ Math.imul((x | 0) + (salt || 0), 0x45d9f3b) ^ Math.imul((z | 0) - (salt || 0), 0x27d4eb2d);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  },

  cellOf(cz) {
    const branch = cz % 2 === 0;
    const side = this.hash(0, cz, 3) < 0.5 ? -1 : 1;
    return { main: true, branch, side };
  },

  materialSet() {
    if (this.shared) return;
    const load = (file, rx, ry) => {
      const tex = new THREE.TextureLoader().load(file);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(rx, ry);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    this.shared = {
      wall: new THREE.MeshStandardMaterial({ map: load("assets/level2-concrete.jpg", 2, 1), color: 0xc8c8c4, roughness: 0.9 }),
      floor: new THREE.MeshStandardMaterial({ map: load("assets/level2-floor.jpg", 3, 3), color: 0xbdbdb8, roughness: 0.92 }),
      ceil: new THREE.MeshStandardMaterial({ color: 0x2a2928, roughness: 0.95 }),
      pipe: new THREE.MeshStandardMaterial({ map: load("assets/level2-rust.jpg", 1, 2), color: 0xc4b8ae, roughness: 0.45, metalness: 0.5 }),
      rust: new THREE.MeshStandardMaterial({ map: load("assets/level2-rust.jpg", 1, 2), color: 0xb86a3a, roughness: 0.6, metalness: 0.3 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff6e0, toneMapped: false })
    };
    this.pipeGeo = new THREE.CylinderGeometry(0.32, 0.32, 1, 12);
    this.flangeGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.07, 12);
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
  },

  disposeSegment(rec) {
    if (!rec || !rec.group) return;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
  },

  enter(seed) {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    this.reset();
    this.seed = seed >>> 0;
    this.materialSet();
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level2_Tunnels";
    scene.add(this.group);
    const hemi = new THREE.HemisphereLight(0xc8c0b0, 0x2a2620, 0.28);
    const amb = new THREE.AmbientLight(0xffe8c8, 0.16);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    scene.fog = new THREE.Fog(0x1a1816, 16, 55);
    if (scene.background) scene.background.setHex(0x1a1816);
    if (CameraRig.camera) { CameraRig.camera.far = 100; CameraRig.camera.updateProjectionMatrix(); }
    this.spawn.set(0, this.baseY, 8);
    this.exitPos = new THREE.Vector3(0, this.baseY, this.cell * 8);
    this.spawnYaw = Math.PI;
    this.infoText = "INFINITE SPINE · CELL " + this.cell + " M";
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

  buildCell(cx, cz) {
    const key = cx + "," + cz;
    if (this.segments.has(key)) return;
    const info = this.cellOf(cz);
    const isMain = cx === 0;
    const isBranch = info.branch && cx === info.side;
    if (!isMain && !isBranch) return;
    const g = new THREE.Group();
    g.name = "L2_" + key;
    const W = this.width, H = this.height, C = this.cell;
    const ox = cx * C, oz = cz * C;
    const colliders = [];
    const alongZ = isMain;
    const mx = ox + (alongZ ? 0 : info.side * C * 0.5);
    const mz = oz + C * 0.5;
    const span = C;
    this.addBox(g, this.shared.floor, mx, this.baseY - 0.08, mz, alongZ ? W + 0.4 : span, 0.16, alongZ ? span : W + 0.4);
    colliders.push({
      min: new THREE.Vector3(mx - (alongZ ? W / 2 : span / 2) - 0.2, this.baseY - 0.5, mz - (alongZ ? span / 2 : W / 2) - 0.2),
      max: new THREE.Vector3(mx + (alongZ ? W / 2 : span / 2) + 0.2, this.baseY + 0.02, mz + (alongZ ? span / 2 : W / 2) + 0.2)
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(alongZ ? W : span, alongZ ? span : W), this.shared.ceil);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(mx, this.baseY + H, mz);
    g.add(ceil);
    const openSide = isMain && info.branch ? info.side : 0;
    for (const sign of [-1, 1]) {
      if (openSide === sign) continue;
      const wx = alongZ ? ox + sign * (W / 2 + 0.16) : mx;
      const wz = alongZ ? mz : oz + C * 0.5 + sign * (W / 2 + 0.16);
      const sx = alongZ ? 0.32 : span;
      const sz = alongZ ? span : 0.32;
      this.addBox(g, this.shared.wall, wx, this.baseY + H / 2, wz, sx, H, sz);
      colliders.push({
        min: new THREE.Vector3(wx - sx / 2, this.baseY, wz - sz / 2),
        max: new THREE.Vector3(wx + sx / 2, this.baseY + H, wz + sz / 2)
      });
    }
    if (isBranch) {
      const capX = info.side * (C - 0.2);
      this.addBox(g, this.shared.wall, ox + capX, this.baseY + H / 2, mz, 0.32, H, W + 0.4);
      colliders.push({
        min: new THREE.Vector3(ox + capX - 0.2, this.baseY, mz - W / 2),
        max: new THREE.Vector3(ox + capX + 0.2, this.baseY + H, mz + W / 2)
      });
    }
    const pipeSide = this.hash(cx, cz, 9) < 0.5 ? -1 : 1;
    if (pipeSide !== openSide) {
      const px = alongZ ? ox + pipeSide * 1.2 : mx;
      const pz = alongZ ? mz : oz + C * 0.5 + pipeSide * 1.2;
      this.addPipeRun(g, colliders, px, this.baseY + 0.55, pz, !alongZ, span * 0.92, 0.26, this.shared.rust);
      this.addPipeRun(g, colliders, px, this.baseY + 1.25, pz, !alongZ, span * 0.92, 0.36, this.shared.pipe);
      this.addPipeRun(g, colliders, px, this.baseY + 2.0, pz, !alongZ, span * 0.92, 0.22, this.shared.rust);
    }
    const lights = [];
    for (let i = 0; i < 2; i++) {
      const t = (i + 0.5) / 2;
      const lx = alongZ ? ox : ox + info.side * C * t;
      const lz = alongZ ? oz + C * t : oz + C * 0.5;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.16 : 2.2, 0.08, alongZ ? 2.2 : 0.16), this.shared.light);
      tube.position.set(lx, this.baseY + H - 0.1, lz);
      g.add(tube);
      if (this.countLights() + lights.length < 18) {
        const L = new THREE.PointLight(0xffe2b0, 2.4, 16, 1.4);
        L.position.set(lx, this.baseY + H - 0.25, lz);
        g.add(L);
        lights.push(L);
      }
    }
    this.group.add(g);
    this.segments.set(key, { group: g, colliders, lights, cx, cz });
  },

  countLights() {
    let n = 0;
    for (const rec of this.segments.values()) n += rec.lights.length;
    return n;
  },

  stream(force) {
    if (!this.active || !this.group) return;
    const px = Player.position.x, pz = Player.position.z;
    const key = Math.floor(px / 12) + "," + Math.floor(pz / 12);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    const ccx = Math.round(px / this.cell), ccz = Math.round(pz / this.cell);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) this.buildCell(ccx + dx, ccz + dz);
    }
    for (const [k, rec] of Array.from(this.segments.entries())) {
      if (Math.abs(rec.cx - ccx) > 3 || Math.abs(rec.cz - ccz) > 3) {
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
  }
};
