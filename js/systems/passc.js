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
    this.resetWorld();
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

  placeWorldCrate(g, x, z, id) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    this.addBox(root, Materials.crate, 0, 0.43, 0, 0.82, 0.86, 0.82);
    this.addBox(root, Materials.crateDark, 0, 0.45, -0.425, 0.68, 0.07, 0.05);
    this.addBox(root, Materials.crateDark, -0.425, 0.45, 0, 0.05, 0.07, 0.68);
    this.addBox(root, Materials.crateDark, 0.425, 0.45, 0, 0.05, 0.07, 0.68);
    g.add(root);
    this.crates.push({ id, tx: 0, tz: 0, x, z, mesh: root, opened: false });
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
    const almondChance = 0.10 + rng() * 0.20;
    const energyChance = 0.10 + rng() * 0.20;
    if (rng() < almondChance) found.push({ id: "almondWater", name: "Almond Water", qty: 1 + ((rng() < 0.35) ? 1 : 0) });
    if (rng() < energyChance) found.push({ id: "energyBar", name: "Energy Bar", qty: 1 + ((rng() < 0.35) ? 1 : 0) });
    for (const item of found) item.qty = Math.min(CONFIG.passC.crateItemCap || 2, item.qty);
    return found;
  },

  openNearestCrate() {
    const c = this.nearestCrate();
    if (!c) return false;
    c.opened = true;
    if (this.openedIds) this.openedIds.add(c.id);
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


  /* ---------------- unbounded Level 0 ----------------
     The same decorations, planned one world REGION at a time (a pure function of the seed and the region)
     and instanced one streamed chunk at a time. A region's plan never reads tiles near its border, so it
     does not depend on which neighbours happen to be loaded. Opened crates are remembered by id, so a chunk
     that streams back in shows them open. */
  openedIds: null,
  worldMode: false,
  beginWorld(seed) {
    this.reset();
    this.seed = seed >>> 0;
    this.worldMode = true;
    this.openedIds = new Set();
  },
  resetWorld() { this.worldMode = false; this.openedIds = null; },

  planRegion(region) {
    if (region.decor) return region.decor;
    const L = Level0World, RT = L.RT, C = CONFIG.passC;
    const rx = region.rx, rz = region.rz, bx = rx * RT, bz = rz * RT, t = region.tiles;
    const rng = mulberry32(L.hash(this.seed, rx, rz, 0xC0FFEE));
    const open = (lx, lz) => { const v = t[lz * RT + lx]; return v !== 1 && v !== 5; };
    const wall = (lx, lz) => { const v = t[lz * RT + lx]; return v === 1 || v === 5; };
    const score = (lx, lz) => {
      let solid = 0, total = 0;
      for (let z = lz - 3; z <= lz + 3; z++) for (let x = lx - 3; x <= lx + 3; x++) { total++; if (wall(x, z)) solid++; }
      let adj = 0;
      for (const d of DIR4) if (wall(lx + d.x, lz + d.z)) adj++;
      return Math.min(1, (solid / total) * 1.25 + (adj / 4) * 0.35);
    };
    const drawings = [], chairs = [], props = [], crates = [];
    let openCount = 0;
    const dc = [], cc = [], pc = [], kc = [];
    for (let lz = 4; lz < RT - 4; lz++) {
      for (let lx = 4; lx < RT - 4; lx++) {
        if (!open(lx, lz)) continue;
        openCount++;
        for (let d = 0; d < 4; d++) {
          const wx = lx + DIR4[d].x, wz = lz + DIR4[d].z;
          if (wall(wx, wz) && rng() < C.wallDrawingChance) dc.push([bx + wx, bz + wz, (d + 2) & 3]);
        }
        const rc = rng(), rp = rng(), rk = rng();
        if (rc < C.chairChance || rp < C.propChance || rk < C.crateChance) {
          const sc = score(lx, lz);
          if (sc < 0.58 && rc < C.chairChance) cc.push([bx + lx, bz + lz]);
          if (sc < 0.62 && rp < C.propChance) pc.push([bx + lx, bz + lz]);
          if (sc >= C.mazeWallRatio && rk < C.crateChance) kc.push([bx + lx, bz + lz, sc]);
        }
      }
    }
    // caps scale with how much of the region is open floor (the old caps were for one 3600-tile map)
    const k = Math.max(0.5, openCount / 3600);
    const capD = Math.round(C.wallDrawingMax * k), capC = Math.round(C.chairMax * k), capP = Math.round(C.propMax * k), capK = Math.round(C.crateMax * k);
    for (const c of dc) {
      if (drawings.length >= capD) break;
      if (rng() > 0.58) continue;
      if (drawings.some(p => p[0] === c[0] && p[1] === c[1] && p[2] === c[2])) continue;
      drawings.push([c[0], c[1], c[2], drawings.length % 3]);
    }
    for (const c of cc) {
      if (chairs.length >= capC) break;
      if (chairs.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 7)) continue;
      const wd = [];
      for (let d = 0; d < 4; d++) { const v = Level.getTile(c[0] + DIR4[d].x, c[1] + DIR4[d].z); if (v === TILE.WALL || v === TILE.COLUMN) wd.push(d); }
      if (!wd.length) continue;
      const d = wd[(rng() * wd.length) | 0];
      chairs.push([c[0], c[1], Math.atan2(DIR4[(d + 2) & 3].x, DIR4[(d + 2) & 3].z)]);
    }
    for (const c of pc) {
      if (props.length >= capP) break;
      if (props.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < 8)) continue;
      props.push([c[0], c[1], rng() * Math.PI * 2]);
    }
    for (const c of kc) {
      if (crates.length >= capK) break;
      if (crates.some(p => Math.hypot(p[0] - c[0], p[1] - c[1]) < C.crateStep * 2.5)) continue;
      crates.push([c[0], c[1], "crate-" + c[0] + "," + c[1]]);
    }
    region.decor = { drawings, chairs, props, crates };
    // wall marks keep clear of these faces
    if (typeof Level0Markings !== "undefined" && Level0Markings.addReservedFaces) Level0Markings.addReservedFaces(drawings);
    return region.decor;
  },
  // Every region that can influence this chunk's wall marks (their spacing rule looks a few tiles past the chunk).
  ensureAround(x0, z0, x1, z1) {
    if (!this.worldMode || !CONFIG.passC.enabled) return;
    const RT = Level0World.RT, w = Level.world, m = 6;
    const ra = Math.floor((x0 - m) / RT), rb = Math.floor((x1 + m) / RT), rc = Math.floor((z0 - m) / RT), rd = Math.floor((z1 + m) / RT);
    for (let rz = rc; rz <= rd; rz++) for (let rx = ra; rx <= rb; rx++) this.planRegion(w.region(rx, rz));
  },
  buildChunk(g, x0, z0, x1, z1) {
    if (!this.worldMode || !CONFIG.passC.enabled) return null;
    const RT = Level0World.RT, w = Level.world;
    const rx = Math.floor(x0 / RT), rz = Math.floor(z0 / RT);
    const plan = this.planRegion(w.region(rx, rz));
    const inside = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
    const made = [];
    const root = new THREE.Group(); root.name = "L0_decor";
    for (const d of plan.drawings) if (inside(d[0], d[1])) this.placeWallDrawing(root, d[0], d[1], d[2], d[3]);
    for (const c of plan.chairs) if (inside(c[0], c[1])) { const p = Level.tileToWorld(c[0], c[1]); this.placeChair(root, p.x, p.z, c[2]); }
    for (const c of plan.props) if (inside(c[0], c[1])) { const p = Level.tileToWorld(c[0], c[1]); this.placeTable(root, p.x, p.z, c[2]); }
    for (const c of plan.crates) {
      if (!inside(c[0], c[1])) continue;
      this.placeCrate(root, c[0], c[1], c[2]);
      const crate = this.crates[this.crates.length - 1];
      if (this.openedIds && this.openedIds.has(c[2])) { crate.opened = true; crate.mesh.rotation.x = -0.18; }
      made.push(crate);
    }
    if (root.children.length) g.add(root);
    return { crates: made, root };
  },
  disposeChunk(rec) {
    if (!rec) return;
    for (const c of rec.crates) { const i = this.crates.indexOf(c); if (i >= 0) this.crates.splice(i, 1); }
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

    // Tell the wall-marking system which faces these drawings occupy.
    if (typeof Level0Markings !== "undefined") Level0Markings.reserveFaces(placedDrawings);

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
