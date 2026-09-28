"use strict";

/* ------------------------------------------------------------------
   PASS C — ENVIRONMENTAL PROPS / WALL DRAWINGS / MAZE CRATES
   Decorative props are seeded from the current Level 0 seed. Crates are
   restricted to locally maze-like areas so they reinforce the architecture.
   ------------------------------------------------------------------ */
const PassC = {
  group: null,
  crates: [],
  seed: 0,
  openCrate: null,
  stats: { drawings: 0, chairs: 0, props: 0, crates: 0 },

  reset() {
    if (this.group && scene) scene.remove(this.group);
    this.group = null;
    this.crates = [];
    this.seed = 0;
    this.openCrate = null;
    this.stats = { drawings: 0, chairs: 0, props: 0, crates: 0 };
    const el = document.getElementById("crate-overlay");
    if (el) el.style.display = "none";
    if (GameState) GameState.inventoryOpen = false;
  },

  tileOpen(x, z) {
    if (!Level.inBounds(x, z)) return false;
    const t = Level.getTile(x, z);
    return t !== TILE.WALL && t !== TILE.COLUMN;
  },

  wallRatio(tx, tz, r) {
    let solid = 0, total = 0;
    for (let z = tz - r; z <= tz + r; z++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (!Level.inBounds(x, z)) continue;
        total++;
        const t = Level.getTile(x, z);
        if (t === TILE.WALL || t === TILE.COLUMN) solid++;
      }
    }
    return total ? solid / total : 1;
  },

  mazeScore(tx, tz) {
    if (!this.tileOpen(tx, tz)) return 0;
    const ratio = this.wallRatio(tx, tz, 3);
    let adjacentWalls = 0;
    for (const d of DIR4) {
      const x = tx + d.x, z = tz + d.z;
      if (Level.inBounds(x, z)) {
        const t = Level.getTile(x, z);
        if (t === TILE.WALL || t === TILE.COLUMN) adjacentWalls++;
      }
    }
    const tight = adjacentWalls / 4;
    return Math.min(1, ratio * 1.25 + tight * 0.35);
  },

  addBox(g, mat, x, y, z, sx, sy, sz, rotY) {
    const m = new THREE.Mesh(Geometries.box, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (rotY != null) m.rotation.y = rotY;
    g.add(m);
    return m;
  },

  placeChair(g, x, z, rot) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = rot;
    this.addBox(root, Materials.chair, 0, 0.46, 0, 0.72, 0.10, 0.72);
    this.addBox(root, Materials.chair, 0, 0.88, 0.28, 0.72, 0.84, 0.10);
    for (const sx of [-0.27, 0.27]) for (const sz of [-0.27, 0.27]) {
      this.addBox(root, Materials.chair, sx, 0.22, sz, 0.08, 0.44, 0.08);
    }
    g.add(root);
  },

  placeTable(g, x, z, rot) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    root.rotation.y = rot;
    this.addBox(root, Materials.propDark, 0, 0.70, 0, 1.35, 0.12, 0.82);
    for (const sx of [-0.52, 0.52]) for (const sz of [-0.27, 0.27]) {
      this.addBox(root, Materials.propDark, sx, 0.34, sz, 0.09, 0.68, 0.09);
    }
    g.add(root);
  },

  placeWallDrawing(g, tx, tz, dir, kind) {
    const T = CONFIG.tile;
    const w = Level.tileToWorld(tx, tz);
    const root = new THREE.Group();
    root.position.set(w.x, 0, w.z);
    const y = 1.35 + ((tx * 17 + tz * 31) % 4) * 0.18;
    const depth = T * 0.51;
    const addStroke = (x1, y1, x2, y2, thick) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const m = this.addBox(root, Materials.passCBlack, 0, 0, 0, len, thick || 0.035, depth);
      m.position.set((x1 + x2) * 0.5, y + (y1 + y2) * 0.5, 0);
      m.rotation.z = Math.atan2(y2 - y1, x2 - x1);
    };
    if (kind === 0) {
      // Eye.
      addStroke(-0.34, 0, -0.12, 0.16, 0.045); addStroke(-0.12, 0.16, 0.12, 0.16, 0.045);
      addStroke(0.12, 0.16, 0.34, 0, 0.045); addStroke(0.34, 0, 0.12, -0.16, 0.045);
      addStroke(0.12, -0.16, -0.12, -0.16, 0.045); addStroke(-0.12, -0.16, -0.34, 0, 0.045);
      this.addBox(root, Materials.passCBlack, 0, y, depth, 0.10, 0.10, 0.03);
    } else if (kind === 1) {
      // Arrow. It is deliberately not tied to the exit direction.
      addStroke(-0.35, 0, 0.28, 0, 0.055); addStroke(0.28, 0, 0.08, 0.18, 0.055); addStroke(0.28, 0, 0.08, -0.18, 0.055);
    } else {
      // Abstract symbol.
      addStroke(-0.28, -0.24, 0.28, 0.24, 0.045); addStroke(-0.28, 0.24, 0.28, -0.24, 0.045);
      addStroke(-0.08, -0.30, -0.08, 0.30, 0.04); addStroke(0.08, -0.30, 0.08, 0.30, 0.04);
    }
    if (dir === 0) { root.rotation.y = 0; root.position.z -= depth; }
    if (dir === 2) { root.rotation.y = Math.PI; root.position.z += depth; }
    if (dir === 1) { root.rotation.y = Math.PI / 2; root.position.x += depth; }
    if (dir === 3) { root.rotation.y = -Math.PI / 2; root.position.x -= depth; }
    g.add(root);
  },

  placeCrate(g, tx, tz, id) {
    const w = Level.tileToWorld(tx, tz);
    const root = new THREE.Group();
    root.position.set(w.x, 0, w.z);
    this.addBox(root, Materials.crate, 0, 0.43, 0, 0.82, 0.86, 0.82);
    this.addBox(root, Materials.crateDark, 0, 0.45, -0.425, 0.68, 0.07, 0.05);
    this.addBox(root, Materials.crateDark, -0.425, 0.45, 0, 0.05, 0.07, 0.68);
    this.addBox(root, Materials.crateDark, 0.425, 0.45, 0, 0.05, 0.07, 0.68);
    root.userData.crateId = id;
    g.add(root);
    this.crates.push({ id, tx, tz, x: w.x, z: w.z, mesh: root, opened: false });
  },

  nearestCrate() {
    let best = null, bestD = CONFIG.passC.crateInteractDist;
    for (const c of this.crates) {
      if (c.opened) continue;
      const d = Math.hypot(c.x - Player.position.x, c.z - Player.position.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  },

  rollCrate(crate) {
    const rng = mulberry32((this.seed ^ ((crate.tx * 73856093) >>> 0) ^ ((crate.tz * 19349663) >>> 0)) >>> 0);
    const found = [];
    if (rng() < CONFIG.passC.almondSpawnChance) found.push({ id: "almondWater", name: "Almond Water", qty: 1 });
    let mushrooms = 0;
    for (let i = 0; i < CONFIG.passC.mushroomAttempts; i++) if (rng() < CONFIG.passC.mushroomChance) mushrooms++;
    if (mushrooms > 0) found.push({ id: "mushroom", name: "Mushrooms", qty: mushrooms });
    return found;
  },

  openNearestCrate() {
    const c = this.nearestCrate();
    if (!c) return false;
    c.opened = true;
    if (c.mesh) c.mesh.rotation.x = -0.18;
    const found = this.rollCrate(c);
    const applied = [];
    for (const item of found) {
      const added = Inventory.addItem(item.id, item.qty);
      if (added > 0) applied.push({ name: item.name, qty: added });
    }
    const overlay = document.getElementById("crate-overlay");
    const list = document.getElementById("crate-items");
    if (list) {
      list.innerHTML = "";
      if (!applied.length) {
        const row = document.createElement("div"); row.className = "crate-item";
        row.innerHTML = "<span>Nothing useful</span><span>—</span>";
        list.appendChild(row);
      } else {
        for (const item of applied) {
          const row = document.createElement("div"); row.className = "crate-item";
          row.innerHTML = `<span>${item.name}</span><strong>×${item.qty}</strong>`;
          list.appendChild(row);
        }
      }
    }
    if (overlay) overlay.style.display = "flex";
    GameState.inventoryOpen = true;
    this.openCrate = c;
    if (document.pointerLockElement) document.exitPointerLock();
    AudioSystem._tone && AudioSystem._tone(125, "triangle", 0.09, 0.025, "events");
    return true;
  },

  closeCrate() {
    const overlay = document.getElementById("crate-overlay");
    if (overlay) overlay.style.display = "none";
    GameState.inventoryOpen = false;
    this.openCrate = null;
    if (GameState.phase === "playing" && !DeviceMode.mobile && renderer && renderer.domElement) renderer.domElement.requestPointerLock();
  },

  generate(seed) {
    this.reset();
    if (!CONFIG.passC.enabled || !Level.tiles || !Level.tiles.length) return;
    this.seed = seed >>> 0;
    this.group = new THREE.Group();
    const rng = mulberry32((seed ^ 0xC0FFEE) >>> 0);
    let drawingCount = 0, chairCount = 0, propCount = 0, crateCount = 0;
    const drawingCandidates = [], chairCandidates = [], propCandidates = [], crateCandidates = [];

    for (let z = 2; z < Level.rows - 2; z++) {
      for (let x = 2; x < Level.cols - 2; x++) {
        if (!this.tileOpen(x, z)) continue;
        const score = this.mazeScore(x, z);
        for (let d = 0; d < 4; d++) {
          const wx = x + DIR4[d].x, wz = z + DIR4[d].z;
          if (!Level.inBounds(wx, wz)) continue;
          const wt = Level.getTile(wx, wz);
          if ((wt === TILE.WALL || wt === TILE.COLUMN) && rng() < CONFIG.passC.wallDrawingChance) {
            drawingCandidates.push([wx, wz, (d + 2) & 3]);
          }
        }
        if (score < 0.58 && rng() < CONFIG.passC.chairChance) chairCandidates.push([x, z]);
        if (score < 0.62 && rng() < CONFIG.passC.propChance) propCandidates.push([x, z]);
        if (score >= CONFIG.passC.mazeWallRatio && rng() < CONFIG.passC.crateChance) crateCandidates.push([x, z]);
      }
    }

    const placedDrawings = [];
    for (const c of drawingCandidates) {
      if (drawingCount >= CONFIG.passC.wallDrawingMax) break;
      if (rng() > 0.58) continue;
      const duplicate = placedDrawings.some(p => p[0] === c[0] && p[1] === c[1] && p[2] === c[2]);
      if (duplicate) continue;
      this.placeWallDrawing(this.group, c[0], c[1], c[2], drawingCount % 3);
      placedDrawings.push(c); drawingCount++;
    }

    const placedChairs = [];
    for (const c of chairCandidates) {
      if (chairCount >= CONFIG.passC.chairMax) break;
      if (placedChairs.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 7)) continue;
      const w = Level.tileToWorld(c[0], c[1]);
      const wallDirs = [];
      for (let d = 0; d < 4; d++) {
        const nx = c[0] + DIR4[d].x, nz = c[1] + DIR4[d].z;
        if (Level.inBounds(nx, nz)) {
          const t = Level.getTile(nx, nz);
          if (t === TILE.WALL || t === TILE.COLUMN) wallDirs.push(d);
        }
      }
      if (!wallDirs.length) continue;
      const d = wallDirs[(rng() * wallDirs.length) | 0];
      const rot = Math.atan2(DIR4[(d + 2) & 3].x, DIR4[(d + 2) & 3].z);
      this.placeChair(this.group, w.x, w.z, rot);
      placedChairs.push(c); chairCount++;
    }

    const placedProps = [];
    for (const c of propCandidates) {
      if (propCount >= CONFIG.passC.propMax) break;
      if (placedProps.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 8)) continue;
      const w = Level.tileToWorld(c[0], c[1]);
      this.placeTable(this.group, w.x, w.z, rng() * Math.PI * 2);
      placedProps.push(c); propCount++;
    }

    const placedCrates = [];
    for (const c of crateCandidates) {
      if (crateCount >= CONFIG.passC.crateMax) break;
      if (placedCrates.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < CONFIG.passC.crateStep * 2.5)) continue;
      if (this.mazeScore(c[0], c[1]) < CONFIG.passC.mazeWallRatio) continue;
      this.placeCrate(this.group, c[0], c[1], `crate-${crateCount}`);
      placedCrates.push(c); crateCount++;
    }

    if (scene) scene.add(this.group);
    this.stats = { drawings: drawingCount, chairs: chairCount, props: propCount, crates: crateCount };
  }
};

document.getElementById("crate-close")?.addEventListener("click", () => PassC.closeCrate());
document.getElementById("crate-overlay")?.addEventListener("click", (e) => {
  if (e.target.id === "crate-overlay") PassC.closeCrate();
});
