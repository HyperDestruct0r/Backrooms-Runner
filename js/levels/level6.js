"use strict";

/* Level 6 — Lights Out. Class 2.
   A short, pitch-black crossing between the hotel (Level 5) and Level 7. Dark concrete, no natural light.
   Man-made light does nothing here, the flashlight included. The only glow is the exit door.

   Layout (from the seed, same seed = same maze):
     - a 12 x 12 grid of 4 m cells joined into a perfect maze (recursive backtracker), so every passage
       that is not the way through is a dead-end side passage.
     - the spawn is the centre of a corner cell. The exit is a dead-end cell 26 to 46 cells of walking from
       the spawn (about 100 to 185 m), with the glowing door on the wall opposite its one opening.
     - the arrival door is in the spawn cell and is sealed. The way back to the hotel is a different door,
       on a closed wall of a cell about 40 percent of the way along the route.
   The whole maze is built once (small), as one merged mesh with one dark concrete material and one shared
   canvas texture. One point light in the whole level, at the exit, in a fixed pool of one: the count
   never changes. No water, no entities, no audio of its own (the footsteps are the cue). */
const Level6 = {
  active: false,
  seed: 0,
  group: null,
  colliders: [],
  doors: [],
  cells: [],
  spawn: new THREE.Vector3(),
  spawnYaw: 0,
  exitPos: null,      // just inside the glowing door (console `level 6 exit`)
  backPos: null,      // just inside the way-back door
  baseY: 0,
  N: 12,              // cells per side
  CELL: 4,            // cell pitch (m)
  T: 0.4,             // wall thickness
  H: 3.0,             // ceiling height
  DIRS: [[1, 0], [0, 1], [-1, 0], [0, -1]],
  shared: null,
  geos: [],
  ambient: [],
  pool: [],
  poolFx: [],
  fixtures: [],
  // Ambient near zero, fog a few metres out. The exit glow ignores fog so it can be seen down a passage.
  look: { ambient: 0.09, hemi: 0.05, poolSize: 1, fog: 0x010101, fogNear: 1.5, fogFar: 12 },
  infoText: "",
  time: 0,
  _promptT: 0,
  _ended: false,

  rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a ^= a >>> 17; a ^= a << 5; return (a >>> 0) / 4294967296; };
  },

  /* ------------------------------------------------------------------
     GENERATION
     ------------------------------------------------------------------ */
  generate(seed) {
    for (let attempt = 0; attempt < 16; attempt++) {
      if (this._generate((seed + Math.imul(attempt, 7919)) >>> 0, false)) return;
    }
    this._generate(seed >>> 0, true);
  },

  _generate(seed, force) {
    const r = this.rng((seed ^ 0x6C16475) >>> 0);
    const N = this.N, DIRS = this.DIRS;
    const cells = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) cells.push({ i, j, open: [false, false, false, false], seen: false });
    const at = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? null : cells[j * N + i];

    // perfect maze from the spawn cell (a corner): iterative recursive backtracker
    const spawnCell = at(0, 0);
    spawnCell.seen = true;
    const stack = [spawnCell];
    while (stack.length) {
      const c = stack[stack.length - 1], opts = [];
      for (let d = 0; d < 4; d++) {
        const n = at(c.i + DIRS[d][0], c.j + DIRS[d][1]);
        if (n && !n.seen) opts.push(d);
      }
      if (!opts.length) { stack.pop(); continue; }
      const d = opts[Math.floor(r() * opts.length)];
      const n = at(c.i + DIRS[d][0], c.j + DIRS[d][1]);
      c.open[d] = true; n.open[(d + 2) % 4] = true; n.seen = true;
      stack.push(n);
    }

    // walking distance from the spawn (cells), and the way there
    const dist = new Array(cells.length).fill(-1), par = new Array(cells.length).fill(-1);
    const q = [spawnCell]; dist[0] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (let d = 0; d < 4; d++) {
        if (!c.open[d]) continue;
        const n = at(c.i + DIRS[d][0], c.j + DIRS[d][1]), k = n.j * N + n.i;
        if (dist[k] >= 0) continue;
        dist[k] = dist[c.j * N + c.i] + 1; par[k] = c.j * N + c.i; q.push(n);
      }
    }
    // exit: a dead end 26 to 46 cells along, nearest 36 (about 145 m)
    let exitK = -1, best = 1e9;
    for (let k = 1; k < cells.length; k++) {
      const c = cells[k];
      if (c.open.filter(Boolean).length !== 1) continue;
      if (dist[k] < 26 || dist[k] > 46) continue;
      const s = Math.abs(dist[k] - 36) + r() * 0.5;
      if (s < best) { best = s; exitK = k; }
    }
    if (exitK < 0) {
      if (!force) return false;
      for (let k = 1; k < cells.length; k++) {
        const s = Math.abs(dist[k] - 36) + (cells[k].open.filter(Boolean).length === 1 ? 0 : 50);
        if (s < best) { best = s; exitK = k; }
      }
    }
    const path = [];
    for (let k = exitK; k >= 0; k = par[k]) path.push(k);
    path.reverse();                                    // path[0] is the spawn cell

    // exit door: the wall opposite the cell's one opening
    const exitCell = cells[exitK];
    const exitOpen = exitCell.open.indexOf(true);
    const exitSide = (exitOpen + 2) % 4;

    // way back: a closed wall on a path cell about 40 percent along, never the spawn or exit cell
    let backCell = null, backSide = -1;
    const mid = Math.max(4, Math.min(path.length - 4, Math.round(path.length * 0.4)));
    for (let off = 0; off < path.length && !backCell; off++) {
      for (const k of [mid + off, mid - off]) {
        if (k < 3 || k > path.length - 3) continue;
        const c = cells[path[k]];
        const start = Math.floor(r() * 4);
        for (let m = 0; m < 4; m++) {
          const d = (start + m) % 4;
          if (!c.open[d]) { backCell = c; backSide = d; break; }
        }
        if (backCell) break;
      }
    }
    if (!backCell) { if (!force) return false; backCell = cells[path[Math.max(1, path.length >> 1)]]; backSide = backCell.open.indexOf(false); }

    // the sealed arrival door: a closed wall of the spawn cell, preferably the one behind the spawn
    const spawnOpen = spawnCell.open.indexOf(true);
    let sealSide = -1;
    for (let m = 0; m < 4 && sealSide < 0; m++) {
      const d = (spawnOpen + 2 + m) % 4;
      if (!spawnCell.open[d]) sealSide = d;
    }

    this.cells = cells;
    this._path = path;
    this._exit = { cell: exitCell, side: exitSide };
    this._back = { cell: backCell, side: backSide };
    this._seal = { cell: spawnCell, side: sealSide };
    const C = this.CELL;
    this.spawn.set(0, this.baseY, 0);
    this.spawnYaw = Math.atan2(-DIRS[spawnOpen][0], -DIRS[spawnOpen][1]);
    const inset = (cell, side, m) => new THREE.Vector3(
      cell.i * C + DIRS[side][0] * (C / 2 - this.T / 2 - m), this.baseY, cell.j * C + DIRS[side][1] * (C / 2 - this.T / 2 - m));
    this.exitPos = inset(exitCell, exitSide, 1.0);
    this.backPos = inset(backCell, backSide, 1.0);
    this.infoText = "CELLS " + N + "x" + N + " · ROUTE " + (path.length - 1) + " CELLS (~" + (path.length - 1) * C + "m)";
    return true;
  },

  /* ------------------------------------------------------------------
     MATERIALS (one dark concrete material, one shared canvas texture)
     ------------------------------------------------------------------ */
  concreteTex() {
    const N = 128, c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d"), img = g.createImageData(N, N), d = img.data;
    const rnd = this.rng(0x10C0C0DE);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 92 + (rnd() - 0.5) * 26 + Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2.0) * 7;
        if (y % 64 < 2) v -= 18;                       // formwork seams
        const i = (y * N + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v + 2; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  materialSet() {
    if (this.shared) return;
    this.shared = {
      concrete: new THREE.MeshStandardMaterial({ map: this.concreteTex(), roughness: 1, metalness: 0 }),
      door: new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.8, metalness: 0.2 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.9, metalness: 0.1 }),
      glow: new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false, fog: false })
    };
  },

  /* ------------------------------------------------------------------
     GEOMETRY
     ------------------------------------------------------------------ */
  // Boxes [x, y, z, sx, sy, sz] merged into one BufferGeometry, UVs from world position (3 m per tile).
  mergeBoxes(list) {
    const pos = [], nor = [], uv = [], idx = [];
    let base = 0;
    for (const b of list) {
      const g = new THREE.BoxGeometry(b[3], b[4], b[5]);
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const wx = p.getX(i) + b[0], wy = p.getY(i) + b[1], wz = p.getZ(i) + b[2];
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        pos.push(wx, wy, wz); nor.push(n.getX(i), n.getY(i), n.getZ(i));
        if (ay > 0.5) uv.push(wx / 3, wz / 3); else if (ax > 0.5) uv.push(wz / 3, wy / 3); else uv.push(wx / 3, wy / 3);
      }
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base);
      base += p.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  },

  collider(x0, y0, z0, x1, y1, z1) {
    this.colliders.push({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1) });
  },

  build() {
    const N = this.N, C = this.CELL, T = this.T, H = this.H;
    const boxes = [];
    const wall = (x, z, sx, sz) => {
      boxes.push([x, H / 2, z, sx, H, sz]);
      this.collider(x - sx / 2, 0, z - sz / 2, x + sx / 2, H, z + sz / 2);
    };
    for (const c of this.cells) {
      const cx = c.i * C, cz = c.j * C;
      if (!c.open[0]) wall(cx + C / 2, cz, T, C + T);          // east (always closed on the last column)
      if (!c.open[1]) wall(cx, cz + C / 2, C + T, T);          // south
      if (c.i === 0) wall(cx - C / 2, cz, T, C + T);           // west boundary
      if (c.j === 0) wall(cx, cz - C / 2, C + T, T);           // north boundary
    }
    // floor (top face at y 0) and ceiling slab (underside at y H)
    const mid = (N - 1) * C / 2, full = N * C + T;
    boxes.push([mid, -0.1, mid, full, 0.2, full]);
    boxes.push([mid, H + 0.1, mid, full, 0.2, full]);
    this.collider(mid - full / 2, -0.5, mid - full / 2, mid + full / 2, 0.02, mid + full / 2);
    this.collider(mid - full / 2, H, mid - full / 2, mid + full / 2, H + 0.2, mid + full / 2);
    const geo = this.mergeBoxes(boxes);
    this.geos.push(geo);
    this.group.add(new THREE.Mesh(geo, this.shared.concrete));

    this.addDoor(this._seal.cell, this._seal.side, "sealed");
    this.addDoor(this._back.cell, this._back.side, "back");
    this.addDoor(this._exit.cell, this._exit.side, "exit");

    // the one light: just in front of the glowing door
    const e = this._exit, D = this.DIRS[e.side];
    const lx = e.cell.i * C + D[0] * (C / 2 - T / 2 - 1.2), lz = e.cell.j * C + D[1] * (C / 2 - T / 2 - 1.2);
    this.fixtures.push({ x: lx, y: 1.7, z: lz, base: 5, dist: 26, color: 0xffd9a0 });
  },

  // A door flat against the inner face of a cell wall.
  addDoor(cell, side, kind) {
    const S = this.shared, C = this.CELL, T = this.T, D = this.DIRS[side];
    const alongX = D[0] === 0;                       // the wall runs along x
    const face = C / 2 - T / 2;
    const px = cell.i * C + D[0] * face, pz = cell.j * C + D[1] * face;
    const put = (mat, off, y, w, h, dep) => {
      const m = new THREE.Mesh(this.boxGeo, mat);
      const o = face - off - dep / 2;
      m.position.set(cell.i * C + D[0] * o, y, cell.j * C + D[1] * o);
      m.scale.set(alongX ? w : dep, h, alongX ? dep : w);
      this.group.add(m);
      return m;
    };
    if (kind === "exit") {
      put(S.frame, 0, 1.15, 1.45, 2.3, 0.05);
      put(S.glow, 0.05, 1.1, 1.15, 2.1, 0.02);
    } else {
      put(S.frame, 0, 1.15, 1.2, 2.3, 0.05);
      put(S.door, 0.05, 1.05, 0.95, 2.1, 0.04);
      if (kind === "sealed") {                       // a bar across it, and a second one: it will not open
        put(S.frame, 0.09, 0.9, 1.1, 0.12, 0.05);
        put(S.frame, 0.09, 1.5, 1.1, 0.12, 0.05);
      } else put(S.frame, 0.09, 1.0, 0.1, 0.08, 0.05);   // a handle
    }
    this.doors.push({ kind, x: px, z: pz, used: false, gone: false, t: 0 });
  },

  /* ------------------------------------------------------------------
     LIGHTS
     ------------------------------------------------------------------ */
  assignLights() {
    for (let i = 0; i < this.pool.length; i++) {
      const f = this.fixtures[i] || null;
      this.poolFx[i] = f;
      const L = this.pool[i];
      if (!f) { L.intensity = 0; continue; }
      L.position.set(f.x, f.y, f.z);
      L.distance = f.dist;
      if (L.color && L.color.setHex) L.color.setHex(f.color);
      L.intensity = f.base;
    }
  },

  /* ------------------------------------------------------------------
     LIFECYCLE
     ------------------------------------------------------------------ */
  reset() {
    const wasActive = this.active;
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    for (const L of this.ambient) if (L.parent) L.parent.remove(L);
    this.ambient.length = 0;
    this.pool = [];
    this.poolFx = [];
    this.fixtures = [];
    this.colliders.length = 0;
    this.doors = [];
    this.cells = [];
    this.group = null;
    this.active = false;
    this.time = 0;
    this._ended = false;
    if (wasActive && typeof CameraRig !== "undefined" && CameraRig.camera && typeof CONFIG !== "undefined") {
      CameraRig.camera.far = CONFIG.cameraFar;
      CameraRig.camera.updateProjectionMatrix();
    }
  },

  enter(seed, from) {
    // every other level goes first (Level 4's reset also clears Level 5, which clears this one)
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof Level5 !== "undefined") Level5.reset();
    if (typeof Level !== "undefined" && Level.clear) Level.clear(scene);
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") { SmilerSystem.reset(); SmilerSystem.detach(); }
    if (typeof HoundSystem !== "undefined") { HoundSystem.reset(); HoundSystem.detach(); }
    if (typeof BeastSystem !== "undefined") BeastSystem.detach();
    if (typeof LightingSystem !== "undefined") LightingSystem.clear(scene);
    if (typeof PickupSystem !== "undefined" && PickupSystem.reset) PickupSystem.reset();
    this.reset();
    this.seed = seed >>> 0;
    this.generate(this.seed);
    this.materialSet();
    this.boxGeo = this.boxGeo || new THREE.BoxGeometry(1, 1, 1);
    this.active = true;
    this.group = new THREE.Group();
    this.group.name = "Level6_LightsOut";
    scene.add(this.group);
    this.build();
    const lk = this.look;
    const hemi = new THREE.HemisphereLight(0x606068, 0x101012, lk.hemi);
    const amb = new THREE.AmbientLight(0x707078, lk.ambient);
    scene.add(hemi, amb);
    this.ambient.push(hemi, amb);
    for (let i = 0; i < lk.poolSize; i++) {            // the fixed pool: one light, never more, never fewer
      const L = new THREE.PointLight(0xffd9a0, 0, 26, 1.6);
      scene.add(L);
      this.ambient.push(L);
      this.pool.push(L);
      this.poolFx.push(null);
    }
    scene.fog = new THREE.Fog(lk.fog, lk.fogNear, lk.fogFar);
    if (scene.background) scene.background.setHex(lk.fog);
    if (CameraRig.camera) { CameraRig.camera.far = 40; CameraRig.camera.updateProjectionMatrix(); }
    GameState.level = 6;
    GameState.seed = this.seed;
    GameState.phase = "playing";
    GameState.cutscene = false;
    GameState.exitReached = false;
    if (typeof Flashlight !== "undefined") Flashlight.reset();      // the flashlight is dead here
    Level.startPos.copy(this.spawn);
    Player.position.copy(this.spawn);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    Player.yaw = this.spawnYaw;
    Player.pitch = 0;
    const obj = document.getElementById("hud-obj");
    if (obj) obj.textContent = "Objective: cross";
    const lvl = document.getElementById("hud-level-label");
    if (lvl) lvl.textContent = "LEVEL 6";
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(this.seed);
    this.stream(true);
    this.assignLights();
    if (typeof CameraRig !== "undefined" && CameraRig.apply && CameraRig.camera) CameraRig.apply(0);
    if (typeof HUD !== "undefined") HUD.toast("LEVEL 6 · LIGHTS OUT");
  },

  // The maze is small and built once in enter(); streaming only keeps the shape of the other levels.
  stream(force) {
    if (!this.active || !this.group) return;
  },

  /* ------------------------------------------------------------------
     INTERACTION
     ------------------------------------------------------------------ */
  tryUse() {
    if (!this.active) return false;
    const p = Player.position;
    let best = null, bestD = 2.1;
    for (const d of this.doors) {
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    if (!best) return false;
    if (best.kind === "sealed") {
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("THIS DOOR IS SEALED");
      return true;
    }
    if (best.used) return true;
    best.used = true;
    best.t = 0;
    if (best.kind === "exit" && typeof HUD !== "undefined" && HUD.toast) HUD.toast("LEVEL 7 IS NOT BUILT YET");
    return true;
  },

  prompt() {
    const p = Player.position;
    for (const d of this.doors) {
      if (d.kind === "sealed" || d.used || Math.hypot(p.x - d.x, p.z - d.z) > 2.0) continue;
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast(d.kind === "back" ? "E  GO BACK" : "E  OPEN DOOR");
      return;
    }
  },

  // The glowing door is the end for now: Level 7 is not built.
  finish() {
    if (this._ended) return;
    this._ended = true;
    GameState.exitReached = true;
    if (typeof Game !== "undefined" && Game.complete) Game.complete();
  },

  /* ------------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------------ */
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    // the darkness eats the light: if anything turned the flashlight on, it goes out
    if (typeof Flashlight !== "undefined" && (Flashlight.enabled || (Flashlight.light && Flashlight.light.intensity > 0))) Flashlight.reset();

    const f = this.poolFx[0];
    if (f) this.pool[0].intensity = f.base * (0.97 + 0.03 * Math.sin(this.time * 1.7));

    for (const d of this.doors) {
      if (!d.used || d.gone) continue;
      d.t += dt;
      if (d.t < (d.kind === "exit" ? 1.2 : 0.6)) continue;
      d.gone = true;
      if (d.kind === "back") {
        const sd = this.seed;
        setTimeout(() => { if (typeof VoidTransition !== "undefined") VoidTransition.then(() => { if (typeof Level5 !== "undefined") Level5.enter(sd, 6); }); else if (typeof Level5 !== "undefined") Level5.enter(sd, 6); }, 0);
      } else this.finish();
    }

    this._promptT -= dt;
    if (this._promptT <= 0) { this._promptT = 1.1; this.prompt(); }
  }
};
