"use strict";

const DarknessSystem = {
  active: false,
  profile: "NORMAL",
  targetOpacity: 0,
  update(dt) {
    if (!scene || !Player || GameState.phase !== "playing" || GameState.level !== 0) return;
    if (!scene.fog) scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
    if (!scene.background) scene.background = new THREE.Color(CONFIG.fogColor);
    const T = CONFIG.tile;
    const C = LevelGenerator.CELL;
    const tx = Math.floor(Player.position.x / T);
    const tz = Math.floor(Player.position.z / T);
    const gx = Math.floor(tx / C);
    const gz = Math.floor(tz / C);
    const mod = MapGraph.nodeAt(gx, gz);
    let profile = mod && mod.lightProfile ? mod.lightProfile : "NORMAL";
    // Preview nearby modules so lighting transitions are visible before
    // the player actually crosses into the next hallway/room.
    let previewProfile = profile, previewWeight = 0;
    for (let r = 1; r <= 22; r++) {
      const samples = [[tx+r,tz],[tx-r,tz],[tx,tz+r],[tx,tz-r],
        [tx+r,tz+r],[tx-r,tz+r],[tx+r,tz-r],[tx-r,tz-r]];
      for (const q of samples) {
        const nm = MapGraph.nodeAt(Math.floor(q[0]/C),Math.floor(q[1]/C));
        if (!nm || !nm.lightProfile || nm === mod) continue;
        const w = Math.max(0, 1 - (r*CONFIG.tile)/66);
        if (w > previewWeight) { previewWeight=w; previewProfile=nm.lightProfile; }
      }
    }
    if (Stairwell.playerInside()) profile = "ELEVATOR";
    this.profile = profile;
    let darkBlend = profile === "DARK" ? 1 : 0;
    let brightBlend = profile === "BRIGHT" ? 1 : 0;
    if (previewProfile === "DARK" && profile !== "DARK") darkBlend = Math.max(darkBlend, previewWeight);
    if (previewProfile === "BRIGHT" && profile !== "BRIGHT") brightBlend = Math.max(brightBlend, previewWeight);
    if (profile === "DARK" && previewProfile !== "DARK") darkBlend = Math.max(0, 1-previewWeight);
    if (profile === "BRIGHT" && previewProfile === "NORMAL") brightBlend = Math.max(0, 1-previewWeight);
    const dark = darkBlend > 0.5;
    this.active = dark;
    const flashlightOn = !!Flashlight.enabled;
    const normalFar = 140 + brightBlend*25;
    const targetNear = darkBlend > 0 ? (flashlightOn ? 3.0 : 1.6 + 36*(1-darkBlend)) : 38;
    const targetFar = darkBlend > 0 ? (flashlightOn ? 18 + 120*(1-darkBlend) : 6.2 + 134*(1-darkBlend)) : normalFar;
    const targetColorObj = new THREE.Color(CONFIG.fogColor).lerp(new THREE.Color(0x11151a), Math.min(1, darkBlend));
    scene.fog.near += (targetNear - scene.fog.near) * Math.min(1, dt * 5);
    scene.fog.far += (targetFar - scene.fog.far) * Math.min(1, dt * 5);
    scene.fog.color.lerp(targetColorObj, Math.min(1, dt * 4));
    scene.background.lerp(targetColorObj, Math.min(1, dt * 4));
    if (LightingSystem.ambient && LightingSystem.hemi) {
      const normalAmb = 0.30 + brightBlend * 0.04;
      const normalHemi = 0.36 + brightBlend * 0.04;
      const darkAmb = flashlightOn ? 0.10 : 0.045;
      const darkHemi = flashlightOn ? 0.14 : 0.075;
      const amb = normalAmb*(1-darkBlend) + darkAmb*darkBlend;
      const hemi = normalHemi*(1-darkBlend) + darkHemi*darkBlend;
      LightingSystem.ambient.intensity += (amb - LightingSystem.ambient.intensity) * Math.min(1, dt * 4);
      LightingSystem.hemi.intensity += (hemi - LightingSystem.hemi.intensity) * Math.min(1, dt * 4);
    }
    // Suppress spill from neighboring fixtures while the player is inside
    // a dark module. Nearby lights still exist, but their illumination falls
    // off quickly so a dark module actually feels dark.
    for (let i = 0; i < LightingSystem.units.length; i++) {
      const u = LightingSystem.units[i];
      if (!u.light || u.state === "BROKEN") continue;
      const d = Math.hypot(u.x - Player.position.x, u.z - Player.position.z);
      const home = u.homeState === "NORMAL" || u.homeState === "DIM" || u.homeState === "FLICKERING";
      if (home && u.light) {
        const stateMult = u.state === "DIM" ? 0.42 : u.state === "BROKEN" ? 0 : 1;
        // Fade nearby illumination continuously as the player approaches a
        // dark module. This makes the hallway visibly transition from a
        // distance instead of changing only after the player crosses the seam.
        const fade = darkBlend > 0 ? (d < 5 ? 0.35 : d < 8 ? 0.10 : 0.015) : 1;
        const transitionMult = darkBlend > 0 ? (1-darkBlend) + darkBlend*fade : 1;
        u.light.intensity = u.baseIntensity * stateMult * transitionMult;
        if (u.panelMat) {
          const emBase = stateMult === 0 ? 0.04 : (u.state === "DIM" ? 0.45 : 1.35);
          u.panelMat.emissiveIntensity = emBase * (darkBlend > 0 ? (1-darkBlend*0.92) : 1);
        }
      }
    }
    const fogEl = document.getElementById("dark-fog");
    if (fogEl) {
      const op = dark ? (flashlightOn ? 0.18 : 0.62) : 0;
      this.targetOpacity += (op - this.targetOpacity) * Math.min(1, dt * 5);
      fogEl.style.opacity = this.targetOpacity.toFixed(3);
    }
  },
  reset() {
    this.active = false;
    this.profile = "NORMAL";
    this.targetOpacity = 0;
    const el = document.getElementById("dark-fog");
    if (el) el.style.opacity = "0";
    if (scene) {
      if (!scene.fog) scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
      scene.fog.near = CONFIG.fogNear;
      scene.fog.far = CONFIG.fogFar;
      scene.fog.color.setHex(CONFIG.fogColor);
    }
    if (scene && scene.background) scene.background.setHex(CONFIG.fogColor);
  }
};

const AtmosphereSystem = {
  update(dt) {
    if (GameState.phase !== "playing") return;
    const gx = Math.floor(Player.position.x / (CONFIG.tile * LevelGenerator.CELL));
    const gz = Math.floor(Player.position.z / (CONFIG.tile * LevelGenerator.CELL));
    const mod = MapGraph.nodeAt(gx, gz);
    let size = 0.35;
    if (mod) {
      if (mod.type === "room_large" || mod.type === "room_pillar") size = 1;
      else if (mod.type === "room_small" || mod.type === "start") size = 0.7;
      else if (mod.type === "hall_long") size = 0.55;
    }
    if (Stairwell.playerInside()) {
      size = 1.15;
      AudioSystem.setRoomAmbience(size);
      return;
    }
    AudioSystem.setRoomAmbience(size);
  },
  fireAmbientEvent() {},
  reset() {}
};

const EnvEventSystem = {
  active: false,
  startIn: 75,
  checkIn: 10,
  cooldown: 0,
  eventCount: 0,
  lastId: "none",
  current: null,
  remain: 0,
  restore: [],
  ghost: null,
  rng: null,
  events: null,

  reset() {
    this.endCurrent(true);
    const E = CONFIG.envEvents;
    this.rng = mulberry32(((GameState.seed || 1) ^ 0xE7E700) + ((performance.now() | 0) & 0xffff));
    this.startIn = E.startMin + this.rand() * (E.startMax - E.startMin);
    this.checkIn = E.checkInterval;
    this.cooldown = 0;
    this.active = false;
    this.eventCount = 0;
    this.lastId = "none";
    this.current = null;
    this.remain = 0;
  },
  rand() { return this.rng ? this.rng() : Math.random(); },

  onStart(id) { /* future sanity / AI hooks */ },
  onEnd(id) { /* future sanity / AI hooks */ },

  register() {
    if (this.events) return this.events;
    this.events = [
      { id: "light_flicker", weight: 26, execute: () => this.evFlicker() },
      { id: "distant_footsteps", weight: 16, execute: () => this.evFootsteps() },
      { id: "electrical_surge", weight: 14, execute: () => this.evSurge() },
      { id: "light_shuts_off", weight: 14, execute: () => this.evLightFail() },
      { id: "distant_thump", weight: 14, execute: () => this.evThump() },
      { id: "dark_corridor", weight: 8, execute: () => this.evDark() },
      { id: "light_behind_player", weight: 6, execute: () => this.evBehind() },
      { id: "visual_movement", weight: 3, execute: () => this.evVisual() },
      { id: "unknown_event", weight: 2, execute: () => this.evUnknown() }
    ];
    return this.events;
  },

  pickEvent() {
    const list = this.register();
    let sum = 0;
    for (let i = 0; i < list.length; i++) sum += list[i].weight;
    let r = this.rand() * sum;
    for (let i = 0; i < list.length; i++) {
      r -= list[i].weight;
      if (r <= 0) return list[i];
    }
    return list[0];
  },

  walkPoint(minD, maxD) {
    const T = CONFIG.tile;
    const px = Math.floor(Player.position.x / T);
    const pz = Math.floor(Player.position.z / T);
    for (let n = 0; n < 18; n++) {
      const ang = this.rand() * Math.PI * 2;
      const d = minD + this.rand() * (maxD - minD);
      const tx = Math.floor((Player.position.x + Math.cos(ang) * d) / T);
      const tz = Math.floor((Player.position.z + Math.sin(ang) * d) / T);
      if (Level.inBounds(tx, tz)) {
        const t = Level.getTile(tx, tz);
        if (t !== TILE.WALL && t !== TILE.COLUMN) {
          const w = Level.tileToWorld(tx, tz);
          return { x: w.x, z: w.z };
        }
      }
    }
    const ang = this.rand() * Math.PI * 2;
    const d = (minD + maxD) * 0.5;
    return { x: Player.position.x + Math.cos(ang) * d, z: Player.position.z + Math.sin(ang) * d };
  },

  begin(id, dur, restoreList) {
    this.current = id;
    this.lastId = id;
    this.remain = dur;
    this.restore = restoreList || [];
    this.eventCount++;
    const E = CONFIG.envEvents;
    this.cooldown = E.cooldownMin + this.rand() * (E.cooldownMax - E.cooldownMin);
    this.onStart(id);
  },

  endCurrent(silent) {
    for (let i = 0; i < this.restore.length; i++) {
      const r = this.restore[i];
      if (r.unit && r.snap) LightingSystem.applySnapshot(r.unit, r.snap);
    }
    this.restore = [];
    if (this.ghost && scene) {
      scene.remove(this.ghost);
      this.ghost = null;
    }
    const id = this.current;
    this.current = null;
    this.remain = 0;
    if (id && !silent) this.onEnd(id);
  },

  evFlicker() {
    const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 22, 4);
    if (!near.length) return false;
    const snaps = [];
    const n = 1 + Math.floor(this.rand() * Math.min(3, near.length));
    for (let i = 0; i < n; i++) {
      snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
      near[i].state = "FLICKERING";
      near[i].burstLeft = CONFIG.envEvents.flickerDur;
    }
    AudioSystem.playPositional("flicker", near[0].x, near[0].y, near[0].z, { gain: 0.035, bus: "electrical" });
    this.begin("light_flicker", CONFIG.envEvents.flickerDur, snaps);
    return true;
  },

  evLightFail() {
    const band = LightingSystem.unitsInBand(Player.position.x, Player.position.z, 10, 42);
    const pool = band.length ? band : LightingSystem.unitsNear(Player.position.x, Player.position.z, 40, 8);
    if (!pool.length) return false;
    const u = pool[Math.floor(this.rand() * pool.length)];
    const snaps = [{ unit: u, snap: LightingSystem.snapshot(u) }];
    LightingSystem.setFixtureState(u, "BROKEN");
    AudioSystem.playPositional("pop", u.x, u.y, u.z, { gain: 0.04, bus: "electrical" });
    this.begin("light_shuts_off", CONFIG.envEvents.failDur, snaps);
    return true;
  },

  evSurge() {
    const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 18, 5);
    const snaps = [];
    for (let i = 0; i < near.length; i++) {
      snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
      near[i].state = "FLICKERING";
      near[i].burstLeft = 0.35;
      if (near[i].light) near[i].light.intensity = near[i].baseIntensity * (0.7 + this.rand() * 0.55);
    }
    AudioSystem.playPositional("buzz", Player.position.x, 2.4, Player.position.z, { gain: 0.03, bus: "electrical" });
    this.begin("electrical_surge", CONFIG.envEvents.surgeDur, snaps);
    return true;
  },

  evFootsteps() {
    const p = this.walkPoint(16, 38);
    AudioSystem.playPositional("creak", p.x, 0.2, p.z, { gain: 0.04, bus: "events", max: 48 });
    setTimeout(() => {
      if (GameState.phase === "playing") AudioSystem.playPositional("creak", p.x + 1.2, 0.2, p.z + 0.4, { gain: 0.03, bus: "events", max: 48 });
    }, 280);
    this.begin("distant_footsteps", 0.9, []);
    return true;
  },

  evThump() {
    const p = this.walkPoint(20, 48);
    const kinds = ["thump", "metal", "pipe", "impact", "pop"];
    const k = kinds[Math.floor(this.rand() * kinds.length)];
    AudioSystem.playPositional(k, p.x, 1.2, p.z, { gain: 0.055, bus: "events", max: 60 });
    this.begin("distant_thump", 0.6, []);
    return true;
  },

  evDark() {
    const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 16, 7);
    if (!near.length) return false;
    const snaps = [];
    for (let i = 0; i < near.length; i++) {
      snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
      LightingSystem.setFixtureState(near[i], "DIM");
    }
    this.begin("dark_corridor", CONFIG.envEvents.darkDur, snaps);
    return true;
  },

  evBehind() {
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    const cand = [];
    for (let i = 0; i < LightingSystem.units.length; i++) {
      const u = LightingSystem.units[i];
      const dx = u.x - Player.position.x, dz = u.z - Player.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 6 || d > 28) continue;
      if (dx * fx + dz * fz < -0.15) cand.push(u);
    }
    const pool = cand.length ? cand : LightingSystem.unitsNear(Player.position.x, Player.position.z, 24, 6);
    if (!pool.length) return false;
    const u = pool[Math.floor(this.rand() * pool.length)];
    const snaps = [{ unit: u, snap: LightingSystem.snapshot(u) }];
    if (u.light) u.light.intensity = u.baseIntensity * 1.55;
    u.panelMat.emissiveIntensity = 1.8;
    AudioSystem.playPositional("buzz", u.x, u.y, u.z, { gain: 0.02, bus: "electrical", max: 22 });
    this.begin("light_behind_player", CONFIG.envEvents.behindDur, snaps);
    return true;
  },

  evVisual() {
    const p = this.walkPoint(8, 18);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 1, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Mesh(Geometries.box, mat);
    mesh.scale.set(0.35, 1.5, 0.18);
    mesh.position.set(p.x, 0.75, p.z);
    if (scene) scene.add(mesh);
    this.ghost = mesh;
    this.begin("visual_movement", CONFIG.envEvents.visualDur, []);
    return true;
  },

  evUnknown() {
    const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 30, 6);
    const snaps = [];
    for (let i = 0; i < near.length; i++) {
      snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
      near[i].state = "FLICKERING";
      near[i].burstLeft = 0.2 + i * 0.12;
    }
    const p = this.walkPoint(22, 40);
    AudioSystem.playPositional("pipe", p.x, 1.6, p.z, { gain: 0.04, bus: "events" });
    this.begin("unknown_event", 2.2, snaps);
    return true;
  },

  update(dt) {
    if (GameState.phase !== "playing") return;
    if (this.remain > 0) {
      this.remain -= dt;
      if (this.ghost && this.ghost.material) {
        this.ghost.material.opacity = Math.max(0, this.remain / Math.max(0.05, CONFIG.envEvents.visualDur));
      }
      if (this.remain <= 0) this.endCurrent(false);
    }
    if (this.startIn > 0) {
      this.startIn -= dt;
      this.active = false;
      return;
    }
    this.active = true;
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.current) return;
    this.checkIn -= dt;
    if (this.checkIn > 0) return;
    this.checkIn = CONFIG.envEvents.checkInterval;
    if (this.cooldown > 0) return;
    if (this.rand() > CONFIG.envEvents.chance) return;
    const ev = this.pickEvent();
    if (!ev.execute()) {
      const fallback = this.register()[0];
      fallback.execute();
    }
  }
};

const WorldAPI = {
  playPositionalSound(kind, x, y, z, opts) { AudioSystem.playPositional(kind, x, y, z, opts); },
  triggerLightingEvent(x, z, r) { LightingSystem.triggerClusterEvent(x, z, r); },
  currentModule() {
    const C = LevelGenerator.CELL * CONFIG.tile;
    return MapGraph.nodeAt(Math.floor(Player.position.x / C), Math.floor(Player.position.z / C));
  },
  playerPosition() { return Player.position; },
  nearbyModules(rangeCells) {
    const C = LevelGenerator.CELL * CONFIG.tile;
    const gx = Math.floor(Player.position.x / C);
    const gz = Math.floor(Player.position.z / C);
    const out = [];
    const r = rangeCells || 2;
    for (let z = gz - r; z <= gz + r; z++) {
      for (let x = gx - r; x <= gx + r; x++) {
        const n = MapGraph.nodeAt(x, z);
        if (n && out.indexOf(n) < 0) out.push(n);
      }
    }
    return out;
  }
};

const EntitySystem = {
  entities: [],
  mesh: null,
  position: new THREE.Vector3(),
  spawned: false,
  pathDistanceAtSpawn: 0,
  spawnYaw: 0,
  yaw: 0,
  state: "WANDERING",
  path: [],
  pathI: 0,
  repathT: 0,
  senseT: 0,
  pauseT: 0,
  searchT: 0,
  lastKnown: new THREE.Vector3(),
  lastKnownModule: null,
  lastSeenTime: -999,
  playerVisible: false,
  playerHeard: false,
  inContact: false,
  dmgAcc: 0,
  targetModule: null,
  debugLine: null,
  vel: new THREE.Vector3(),

  spawn(position, yaw) {
    this.despawn();
    this.position.copy(position);
    this.spawnYaw = yaw || 0;
    this.yaw = this.spawnYaw;
    this.spawned = true;
    this.state = "WANDERING";
    this.path = [];
    this.pathI = 0;
    this.pauseT = 0.4;
    this.searchT = 0;
    this.playerVisible = false;
    this.playerHeard = false;
    this.lastKnown.copy(position);
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1814, roughness: 0.92, metalness: 0.02
    });
    const torso = new THREE.Mesh(Geometries.box, mat);
    torso.scale.set(0.42, 0.95, 0.28);
    torso.position.y = 1.15;
    const head = new THREE.Mesh(Geometries.box, mat);
    head.scale.set(0.28, 0.32, 0.26);
    head.position.y = 1.78;
    const legL = new THREE.Mesh(Geometries.box, mat);
    legL.scale.set(0.16, 0.7, 0.16);
    legL.position.set(-0.12, 0.35, 0);
    const legR = new THREE.Mesh(Geometries.box, mat);
    legR.scale.set(0.16, 0.7, 0.16);
    legR.position.set(0.12, 0.35, 0);
    group.add(torso, head, legL, legR);
    group.position.copy(position);
    group.rotation.y = this.yaw;
    if (scene) scene.add(group);
    this.mesh = group;
    this.entities = [this];
    this.pickWanderTarget();
    return this;
  },
  despawn() {
    if (this.mesh && scene) scene.remove(this.mesh);
    if (this.debugLine && scene) scene.remove(this.debugLine);
    this.debugLine = null;
    this.mesh = null;
    this.spawned = false;
    this.entities = [];
    this.pathDistanceAtSpawn = 0;
    this.state = "WANDERING";
    ChaseFx.reset();
  },
  getPosition() { return this.position; },
  isSpawned() { return this.spawned; },
  clear() { this.despawn(); },

  tileOf(pos) {
    return {
      x: Math.floor(pos.x / CONFIG.tile),
      z: Math.floor(pos.z / CONFIG.tile)
    };
  },
  walkable(t) { return t !== TILE.WALL && t !== TILE.COLUMN && t !== TILE.EXIT; },

  clearLineToPlayer() {
    const T = CONFIG.tile;
    const dx = Player.position.x - this.position.x;
    const dz = Player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.2) return true;
    const steps = Math.max(2, Math.ceil(dist / (T * 0.35)));
    for (let i = 1; i < steps; i++) {
      const x = this.position.x + dx * (i / steps);
      const z = this.position.z + dz * (i / steps);
      const tx = Math.floor(x / T), tz = Math.floor(z / T);
      if (!Level.inBounds(tx, tz) || !this.walkable(Level.getTile(tx, tz))) return false;
    }
    return true;
  },
  losToPlayer() {
    const T = CONFIG.tile;
    const E = CONFIG.entity;
    const dx = Player.position.x - this.position.x;
    const dz = Player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const range = E.visionRange * (Player.crouching ? E.crouchVisMult : 1);
    if (dist > range || dist < 0.2) return dist < 1.4;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const ang = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / dist)));
    if (ang > (E.fovDeg * Math.PI / 180) * 0.5) return false;
    const steps = Math.max(2, Math.ceil(dist / (T * 0.4)));
    for (let i = 1; i < steps; i++) {
      const x = this.position.x + dx * (i / steps);
      const z = this.position.z + dz * (i / steps);
      const tx = Math.floor(x / T), tz = Math.floor(z / T);
      if (!Level.inBounds(tx, tz) || !this.walkable(Level.getTile(tx, tz))) return false;
    }
    return true;
  },

  hearPlayer() {
    if (Player.lastNoise <= 0) return false;
    const d = Math.hypot(Player.lastNoisePos.x - this.position.x, Player.lastNoisePos.z - this.position.z);
    return d <= Player.lastNoiseRadius;
  },

  buildPath(tx, tz) {
    const start = this.tileOf(this.position);
    if (!Level.inBounds(start.x, start.z) || !Level.inBounds(tx, tz)) return [];
    const cols = Level.cols, rows = Level.rows;
    const dist = [];
    const prev = [];
    for (let z = 0; z < rows; z++) {
      dist.push(new Int16Array(cols).fill(-1));
      prev.push(new Int32Array(cols).fill(-1));
    }
    if (!this.walkable(Level.getTile(start.x, start.z))) return [];
    const q = [[start.x, start.z]];
    dist[start.z][start.x] = 0;
    let qi = 0, found = false;
    const cap = 140;
    while (qi < q.length) {
      const p = q[qi++];
      if (p[0] === tx && p[1] === tz) { found = true; break; }
      if (dist[p[1]][p[0]] > cap) continue;
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        if (dist[nz][nx] >= 0) continue;
        if (!this.walkable(Level.getTile(nx, nz))) continue;
        dist[nz][nx] = dist[p[1]][p[0]] + 1;
        prev[nz][nx] = p[0] | (p[1] << 16);
        q.push([nx, nz]);
      }
    }
    if (!found) return [];
    const tiles = [];
    let cx = tx, cz = tz;
    while (!(cx === start.x && cz === start.z)) {
      tiles.push([cx, cz]);
      const pr = prev[cz][cx];
      if (pr < 0) break;
      cx = pr & 65535;
      cz = pr >>> 16;
    }
    tiles.reverse();
    const pts = [];
    for (let i = 0; i < tiles.length; i += 2) {
      const w = Level.tileToWorld(tiles[i][0], tiles[i][1]);
      pts.push(new THREE.Vector3(w.x, 0, w.z));
    }
    if (tiles.length) {
      const last = tiles[tiles.length - 1];
      const w = Level.tileToWorld(last[0], last[1]);
      pts.push(new THREE.Vector3(w.x, 0, w.z));
    }
    return pts;
  },

  setPathToWorld(wx, wz) {
    const t = { x: Math.floor(wx / CONFIG.tile), z: Math.floor(wz / CONFIG.tile) };
    this.path = this.buildPath(t.x, t.z);
    this.pathI = 0;
    const gx = Math.floor(t.x / LevelGenerator.CELL);
    const gz = Math.floor(t.z / LevelGenerator.CELL);
    this.targetModule = MapGraph.nodeAt(gx, gz);
  },

  pickWanderTarget() {
    const here = this.tileOf(this.position);
    const gx = Math.floor(here.x / LevelGenerator.CELL);
    const gz = Math.floor(here.z / LevelGenerator.CELL);
    const cur = MapGraph.nodeAt(gx, gz);
    let destGx = gx, destGz = gz;
    if (cur && cur.connections && cur.connections.length) {
      const nid = cur.connections[Math.floor(Math.random() * cur.connections.length)];
      const n = MapGraph.nodes[nid];
      if (n) { destGx = n.gx; destGz = n.gz; }
    } else {
      destGx = gx + (Math.random() < 0.5 ? -1 : 1);
      destGz = gz + (Math.random() < 0.5 ? -1 : 1);
    }
    const tx = destGx * LevelGenerator.CELL + 2;
    const tz = destGz * LevelGenerator.CELL + 2;
    this.path = this.buildPath(tx, tz);
    this.pathI = 0;
    this.targetModule = MapGraph.nodeAt(destGx, destGz);
    if (!this.path.length) {
      for (let k = 0; k < 8 && !this.path.length; k++) {
        const ox = here.x + ((Math.random() * 11) | 0) - 5;
        const oz = here.z + ((Math.random() * 11) | 0) - 5;
        if (Level.inBounds(ox, oz) && this.walkable(Level.getTile(ox, oz))) {
          this.path = this.buildPath(ox, oz);
          this.pathI = 0;
        }
      }
    }
  },

  pickSearchTarget() {
    const here = this.tileOf(this.lastKnown);
    const opts = [];
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (Math.abs(dx) + Math.abs(dz) < 2) continue;
        const x = here.x + dx, z = here.z + dz;
        if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) opts.push([x, z]);
      }
    }
    if (!opts.length) { this.pickWanderTarget(); return; }
    const p = opts[(Math.random() * opts.length) | 0];
    this.path = this.buildPath(p[0], p[1]);
    this.pathI = 0;
  },

  setState(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (next === "PURSUING" && prev !== "PURSUING") ChaseFx.onPursuitStart();
    if (next === "SEARCHING") this.searchT = CONFIG.entity.searchTime;
    if (next === "WANDERING") this.pauseT = 0.4 + Math.random() * 0.6;
  },

  followPath(dt, speed) {
    if (!this.path.length || this.pathI >= this.path.length) return false;
    const goal = this.path[this.pathI];
    const dx = goal.x - this.position.x;
    const dz = goal.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.45) {
      this.pathI++;
      return this.pathI < this.path.length;
    }
    const vx = (dx / d) * speed;
    const vz = (dz / d) * speed;
    this.yaw = Math.atan2(-vx, -vz);
    const r = CONFIG.entity.radius, h = CONFIG.entity.height;
    this.position.x += vx * dt;
    resolveAxis(this.position, r, h, "x");
    this.position.z += vz * dt;
    resolveAxis(this.position, r, h, "z");
    resolveAxis(this.position, r, h, "y");
    if (this.position.y < -12) this.position.y = 0;
    return true;
  },

  update(dt) {
    if (!this.spawned) return;
    const E = CONFIG.entity;
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = E.senseInterval;
      this.playerVisible = this.losToPlayer();
      this.playerHeard = this.hearPlayer();
      if (this.playerVisible) {
        this.lastKnown.copy(Player.position);
        this.lastSeenTime = GameState.elapsed;
        const t = this.tileOf(Player.position);
        this.lastKnownModule = MapGraph.nodeAt(Math.floor(t.x / LevelGenerator.CELL), Math.floor(t.z / LevelGenerator.CELL));
        this.setState("PURSUING");
      } else if (this.playerHeard && this.state !== "PURSUING") {
        this.lastKnown.copy(Player.lastNoisePos);
        this.setState("ALERTED");
      }
    }

    const distP = Math.hypot(Player.position.x - this.position.x, Player.position.z - this.position.z);
    this.inContact = false;
    if (this.spawned && distP <= CONFIG.entity.contactDist && this.clearLineToPlayer()) {
      this.inContact = true;
      this.dmgAcc += CONFIG.entity.damagePerSec * dt;
      let hit = 0;
      while (this.dmgAcc >= 1) {
        this.dmgAcc -= 1;
        hit += 1;
      }
      if (hit > 0) {
        Player.damagePlayer(hit);
        ChaseFx.hitFlash();
        if (Player.getPlayerHP() <= 0) Game.gameOver();
      }
    } else {
      this.dmgAcc = 0;
    }

    if (this.state === "PURSUING") {
      const close = distP;
      if (close < 1.65) {
        this.vel.set(0, 0, 0);
      } else {
        this.repathT -= dt;
        const pt = this.tileOf(Player.position);
        const pmod = MapGraph.nodeAt(Math.floor(pt.x / LevelGenerator.CELL), Math.floor(pt.z / LevelGenerator.CELL));
        if (this.repathT <= 0 || (pmod && pmod !== this.targetModule)) {
          this.repathT = E.repath;
          if (this.playerVisible) this.lastKnown.copy(Player.position);
          this.setPathToWorld(this.lastKnown.x, this.lastKnown.z);
        }
        this.followPath(dt, E.chaseSpeed);
      }
      if (!this.playerVisible && GameState.elapsed - this.lastSeenTime > 0.35) {
        const dLast = Math.hypot(this.lastKnown.x - this.position.x, this.lastKnown.z - this.position.z);
        if (dLast < 1.8 || !this.path.length) this.setState("SEARCHING");
      }
    } else if (this.state === "ALERTED") {
      this.repathT -= dt;
      if (this.repathT <= 0) {
        this.repathT = 0.6;
        this.setPathToWorld(this.lastKnown.x, this.lastKnown.z);
      }
      const moving = this.followPath(dt, E.walkSpeed * 1.15);
      if (!moving) {
        this.yaw += dt * 1.8;
        this.pauseT -= dt;
        if (this.pauseT <= 0) this.setState("SEARCHING");
      }
    } else if (this.state === "SEARCHING") {
      this.searchT -= dt;
      if (!this.path.length || this.pathI >= this.path.length) {
        this.pickSearchTarget();
        this.yaw += dt * 2.2;
      } else {
        this.followPath(dt, E.walkSpeed);
      }
      if (this.searchT <= 0) this.setState("WANDERING");
    } else {
      if (this.pauseT > 0) {
        this.pauseT -= dt;
        this.yaw += dt * 0.4;
      } else if (!this.path.length || this.pathI >= this.path.length) {
        this.pauseT = E.pauseMin + Math.random() * (E.pauseMax - E.pauseMin);
        this.pickWanderTarget();
      } else {
        this.followPath(dt, E.walkSpeed);
      }
    }

    if (this.mesh) {
      this.mesh.position.copy(this.position);
      this.mesh.rotation.y = this.yaw;
    }
    if (this.state === "PURSUING" && Math.random() < dt * 0.7) {
      AudioSystem.playPositional("creak", this.position.x, 1.4, this.position.z, { gain: 0.028, bus: "entity", max: 36 });
    }
    this.updateDebugViz();
  },

  updateDebugViz() {
    if (this.debugLine && scene) {
      scene.remove(this.debugLine);
      if (this.debugLine.geometry) this.debugLine.geometry.dispose();
      this.debugLine = null;
    }
    if (!GameState.debugViz || !this.spawned || !this.path.length) return;
    const pts = [this.position.clone()];
    for (let i = this.pathI; i < this.path.length; i++) pts.push(this.path[i]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.debugLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6644 }));
    scene.add(this.debugLine);
  }
};

const ChaseFx = {
  intensity: 0,
  flash: 0,
  vig: null,
  runEl: null,
  init() {
    this.vig = document.getElementById("chase-vignette");
    this.runEl = document.getElementById("run-flash");
  },
  reset() {
    this.intensity = 0;
    this.flash = 0;
    if (this.vig) this.vig.style.opacity = "0";
    if (this.runEl) this.runEl.style.opacity = "0";
  },
  hitFlash() {
    const el = document.getElementById("dmg-flash");
    if (el) {
      el.style.opacity = "0.55";
      setTimeout(() => { if (el) el.style.opacity = "0"; }, 90);
    }
    this.intensity = Math.min(CONFIG.chase.redMaxOpacity, this.intensity + 0.18);
    CameraRig.chaseAmp = Math.max(CameraRig.chaseAmp || 0, 0.35);
    AudioSystem._tone && AudioSystem._tone(70, "sawtooth", 0.07, 0.03, "events");
  },
  onPursuitStart() {
    this.flash = CONFIG.chase.runFlash;
    AudioSystem.playPositional("thump", EntitySystem.position.x, 1.2, EntitySystem.position.z, { gain: 0.06, bus: "entity" });
  },
  update(dt) {
    if (!this.vig) this.init();
    let target = 0;
    if (EntitySystem.spawned && EntitySystem.state === "PURSUING") {
      const d = Math.hypot(EntitySystem.position.x - Player.position.x, EntitySystem.position.z - Player.position.z);
      const t = 1 - Math.max(0, Math.min(1, (d - CONFIG.chase.redMin) / (CONFIG.chase.redMax - CONFIG.chase.redMin)));
      target = CONFIG.chase.redMaxOpacity * t;
    } else if (EntitySystem.spawned && EntitySystem.state === "SEARCHING") {
      target = CONFIG.chase.redMaxOpacity * 0.22;
    } else if (EntitySystem.spawned && EntitySystem.state === "ALERTED") {
      target = CONFIG.chase.redMaxOpacity * 0.08;
    }
    const san = Player.getSanity ? Player.getSanity() / CONFIG.sanity.max : 1;
    if (san < 0.45) target = Math.max(target, (0.45 - san) * 0.35);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 2.4);
    if (this.vig) this.vig.style.opacity = String(Math.max(0, this.intensity));
    if (this.flash > 0) {
      this.flash -= dt;
      const p = Math.max(0, this.flash / CONFIG.chase.runFlash);
      const blink = (Math.sin(this.flash * 28) * 0.5 + 0.5);
      if (this.runEl) this.runEl.style.opacity = String(p * (0.45 + blink * 0.55));
    } else if (this.runEl) this.runEl.style.opacity = "0";
    CameraRig.chaseAmp = this.intensity;
  }
};

const EncounterManager = {
  entitySpawned: false,
  encounterSystemActive: false,
  checkTimer: 0,
  distanceSinceCheck: 0,
  lastDistance: 0,
  lastProbability: 0,
  lastPathDist: 0,
  rng: null,

  reset() {
    this.entitySpawned = false;
    this.encounterSystemActive = false;
    this.checkTimer = 0;
    this.distanceSinceCheck = 0;
    this.lastDistance = 0;
    this.lastProbability = 0;
    this.lastPathDist = 0;
    const salt = 0xE4C011;
    this.rng = mulberry32(((GameState.seed || 1) ^ salt) >>> 0);
    EntitySystem.despawn();
  },
  rand() { return this.rng ? this.rng() : Math.random(); },

  currentProbability() {
    const E = CONFIG.encounter;
    const elapsed = GameState.elapsed;
    if (elapsed < E.startTime) return 0;
    if (elapsed >= E.guaranteeTime) return 1;
    const t = Math.max(0, Math.min(1, (elapsed - E.startTime) / (E.guaranteeTime - E.startTime)));
    const timeP = E.baseCheck + (E.maxCheck - E.baseCheck) * Math.pow(t, E.curveExp);
    const distP = Math.min(E.distWeightMax, (GameState.distance / E.distStep) * E.distWeight);
    return Math.max(0, Math.min(0.96, timeP + distP));
  },

  timeUntilGuarantee() {
    return Math.max(0, CONFIG.encounter.guaranteeTime - GameState.elapsed);
  },

  walkable(t) {
    return t !== TILE.WALL && t !== TILE.COLUMN;
  },

  playerTile() {
    const T = CONFIG.tile;
    return {
      x: Math.floor(Player.position.x / T),
      z: Math.floor(Player.position.z / T)
    };
  },

  visibleFromPlayer(tx, tz) {
    const T = CONFIG.tile;
    const px = Player.position.x;
    const pz = Player.position.z;
    const py = Player.position.y + Player.eyeHeight();
    const wx = (tx + 0.5) * T;
    const wz = (tz + 0.5) * T;
    const dx = wx - px;
    const dz = wz - pz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1.2) return true;
    const fx = -Math.sin(Player.yaw);
    const fz = -Math.cos(Player.yaw);
    const ndx = dx / dist, ndz = dz / dist;
    const facing = fx * ndx + fz * ndz;
    const steps = Math.max(2, Math.ceil(dist / (T * 0.45)));
    let blocked = false;
    for (let i = 1; i < steps; i++) {
      const x = px + dx * (i / steps);
      const z = pz + dz * (i / steps);
      const tileX = Math.floor(x / T);
      const tileZ = Math.floor(z / T);
      if (!Level.inBounds(tileX, tileZ) || !this.walkable(Level.getTile(tileX, tileZ))) {
        blocked = true;
        break;
      }
    }
    if (blocked) return false;
    if (facing > 0.18 && dist < 95) return true;
    if (facing > 0.55) return true;
    return false;
  },

  findSpawnTile(minM, maxM) {
    const start = this.playerTile();
    if (!Level.inBounds(start.x, start.z)) return null;
    const cols = Level.cols, rows = Level.rows;
    const dist = [];
    for (let z = 0; z < rows; z++) dist.push(new Int16Array(cols).fill(-1));
    if (!this.walkable(Level.getTile(start.x, start.z))) {
      let found = false;
      for (let r = 1; r <= 3 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const x = start.x + dx, z = start.z + dz;
            if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) {
              start.x = x; start.z = z; found = true;
            }
          }
        }
      }
      if (!found) return null;
    }
    const q = [[start.x, start.z]];
    dist[start.z][start.x] = 0;
    let qi = 0;
    const tileMin = Math.floor(minM / CONFIG.tile);
    const tileMax = Math.ceil(maxM / CONFIG.tile);
    const raw = [];
    const pgx = Math.floor(start.x / LevelGenerator.CELL);
    const pgz = Math.floor(start.z / LevelGenerator.CELL);
    while (qi < q.length) {
      const p = q[qi++];
      const d = dist[p[1]][p[0]];
      if (d > tileMax) continue;
      if (d >= tileMin && d <= tileMax) raw.push(p);
      if (d === tileMax) continue;
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        if (dist[nz][nx] >= 0) continue;
        const tt = Level.getTile(nx, nz);
        if (!this.walkable(tt) || tt === TILE.START || tt === TILE.EXIT) continue;
        dist[nz][nx] = d + 1;
        q.push([nx, nz]);
      }
    }
    if (!raw.length) return null;

    function score(p) {
      const gx = Math.floor(p[0] / LevelGenerator.CELL);
      const gz = Math.floor(p[1] / LevelGenerator.CELL);
      const mod = MapGraph.nodeAt(gx, gz);
      let s = 0;
      if (mod && (gx !== pgx || gz !== pgz)) s += 4;
      if (mod && (mod.type === "corridor" || mod.type === "junction" || mod.type === "hall_long" || mod.type === "room_large" || mod.type === "room_small")) s += 3;
      if (mod && mod.deadEnd) s -= 6;
      if (!EncounterManager.visibleFromPlayer(p[0], p[1])) s += 8;
      return s;
    }

    let hidden = raw.filter((p) => !this.visibleFromPlayer(p[0], p[1]));
    let pool = hidden.length ? hidden : raw;
    pool.sort((a, b) => score(b) - score(a));
    const top = pool.slice(0, Math.min(12, pool.length));
    const pick = top[Math.floor(this.rand() * top.length)];
    return {
      x: pick[0],
      z: pick[1],
      pathM: dist[pick[1]][pick[0]] * CONFIG.tile
    };
  },

  trySpawn(force) {
    if (this.entitySpawned) return false;
    const want = CONFIG.encounter.pathMin + this.rand() * (CONFIG.encounter.pathMax - CONFIG.encounter.pathMin);
    let found = this.findSpawnTile(Math.max(50, want - 12), Math.min(100, want + 12));
    if (!found) found = this.findSpawnTile(50, 100);
    if (!found) found = this.findSpawnTile(40, 120);
    if (!found) return false;
    const w = Level.tileToWorld(found.x, found.z);
    const yaw = this.rand() * Math.PI * 2;
    EntitySystem.spawn(new THREE.Vector3(w.x, 0, w.z), yaw);
    EntitySystem.pathDistanceAtSpawn = found.pathM;
    this.entitySpawned = true;
    this.lastPathDist = found.pathM;
    this.onSpawned(w);
    return true;
  },

  onSpawned(worldPos) {
    if (this.rand() < 0.7) {
      AudioSystem.playPositional("creak", worldPos.x, 1.2, worldPos.z, { gain: 0.035, max: 55 });
    }
    if (this.rand() < 0.55) {
      LightingSystem.triggerClusterEvent(worldPos.x, worldPos.z, 10);
    }
  },

  update(dt) {
    if (GameState.phase !== "playing") return;
    const E = CONFIG.encounter;
    if (this.entitySpawned) return;

    if (GameState.elapsed >= E.startTime) this.encounterSystemActive = true;
    else {
      this.lastProbability = 0;
      return;
    }

    const moved = GameState.distance - this.lastDistance;
    if (moved > 0) {
      this.distanceSinceCheck += moved;
      this.lastDistance = GameState.distance;
    }
    this.checkTimer += dt;

    const timeDue = this.checkTimer >= E.checkInterval;
    const distDue = this.distanceSinceCheck >= E.distStep;
    if (!timeDue && !distDue) return;
    if (timeDue) this.checkTimer = 0;
    if (distDue) this.distanceSinceCheck = 0;

    const p = this.currentProbability();
    this.lastProbability = p;
    const force = GameState.elapsed >= E.guaranteeTime;
    if (force || this.rand() < p) this.trySpawn(force);
  }
};

function spawnEntity(position) {
  const e = EntitySystem.spawn(position);
  EncounterManager.entitySpawned = true;
  return e;
}
function despawnEntity() {
  EncounterManager.entitySpawned = false;
  EntitySystem.despawn();
}
function getEntityPosition() { return EntitySystem.getPosition(); }
function isEntitySpawned() { return EntitySystem.isSpawned(); }

/* ------------------------------------------------------------------
   GAME LOOP / INIT
   ------------------------------------------------------------------ */
