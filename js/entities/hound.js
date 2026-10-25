"use strict";

/* Hound — a low, fast, dark quadruped.

   HoundSystem is level-agnostic. It never reads which level is active. A level
   calls attach(opts) with its own live collider array and the Hound does the rest:
   spawn out of sight, wander, commit when it sees you, chase, bite, give up.

   Speeds: Hound chase 6.2 m/s. Player walk 4.6, sprint 8.15. You cannot stroll
   away. You can run.

   Collider rules. A collider blocks a Hound when it overlaps the Hound's own
   height band (max.y > 0.6 and min.y < 0.7). The band's upper limit matters:
   ceiling slabs are colliders too, and without it every point under a ceiling
   would count as "inside a collider". Floors are colliders whose top is at about
   y = 0. By default a point is also required to have a floor under it, so a
   Hound can never be placed in the void outside a level. */
const HoundSystem = {
  attached: false,
  opts: null,
  list: [],
  t: 0,
  spawnT: 0,
  _rng: null,
  shared: null,
  box: null,
  overlayEl: null,
  dying: false,
  deathT: 0,

  C: {
    chaseSpeed: 6.2,
    wanderSpeed: 1.7,
    radius: 0.38,
    height: 0.7,
    commitDist: 28,
    giveUp: 4,
    senseEvery: 0.15,
    dps: 22,
    chunk: 2,
    stumbleChance: 0.15,
    stumbleMin: 0.3,
    stumbleMax: 0.6,
    stunTime: 0.4,
    spawnMin: 6,
    spawnMax: 9,
    spacing: 8,
    cone: 0.6,
    deathFade: 1.2
  },

  /* ------------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------------ */
  attach(opts) {
    this.reset();
    const o = opts || {};
    this.opts = {
      colliders: o.colliders || [],
      isOpen: typeof o.isOpen === "function" ? o.isOpen : null,
      cap: o.cap == null ? 2 : o.cap,
      graceSeconds: o.graceSeconds == null ? 0 : o.graceSeconds,
      graceRadius: o.graceRadius == null ? 0 : o.graceRadius,
      minDist: o.minDist == null ? 18 : o.minDist,
      maxDist: o.maxDist == null ? 42 : o.maxDist
    };
    let a = ((o.seed == null ? 1 : o.seed) ^ 0x9E3779B9) >>> 0 || 1;
    this._rng = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    this.t = 0;
    this.spawnT = 0;
    this.attached = true;
  },

  detach() {
    this.reset();
    this.attached = false;
    this.opts = null;
  },

  // Removes every Hound and cancels a death in progress. Stays attached, and the
  // grace clock is not restarted, so spawning resumes on the normal schedule.
  reset() {
    for (const h of this.list) this._free(h);
    this.list.length = 0;
    if (this.dying) {
      this.dying = false;
      GameState.cutscene = false;
    }
    this.deathT = 0;
    if (this.overlayEl) { this.overlayEl.style.display = "none"; this.overlayEl.style.opacity = "0"; }
    if (this.attached) this.spawnT = -1;   // resumes on the normal 6 to 9 s schedule
  },

  count() { return this.list.length; },

  // Spawn at a point. Returns the Hound, or null if the point is refused.
  // `forced` ignores the view cone, grace, distances, cap and spacing to other
  // Hounds. It still needs open space.
  spawnAt(x, z, forced) {
    if (!this.attached) return null;
    if (!this._valid(x, z, !!forced)) return null;
    return this._make(x, z, !!forced);
  },

  // Remove up to `count` Hounds (most recent first). Returns how many went.
  despawn(count) {
    const n = Math.min(this.list.length, Math.max(1, (count == null ? 1 : count) | 0));
    for (let i = 0; i < n; i++) this._free(this.list.pop());
    return n;
  },

  update(dt) {
    if (this.dying) { this._death(dt); return; }
    if (!this.attached || !this.opts) return;
    if (GameState.cutscene || GameState.phase !== "playing") return;
    this.t += dt;
    const o = this.opts, C = this.C;

    // spawn schedule: nothing during grace, then one try every 6 to 9 s,
    // and no tries at all while at the cap
    if (this.t >= o.graceSeconds) {
      if (this.list.length >= o.cap) this.spawnT = -1;
      else if (this.spawnT < 0) this.spawnT = this._between(C.spawnMin, C.spawnMax);
      else {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          this._trySpawn();
          this.spawnT = this._between(C.spawnMin, C.spawnMax);
        }
      }
    }

    const P = Player.position;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      this._think(h, dt);
      // a Hound left far behind is recycled so it does not hold a cap slot forever
      if (!h.forced && h.state !== "chase" && Math.hypot(h.x - P.x, h.z - P.z) > o.maxDist * 2) {
        this._free(h);
        this.list.splice(i, 1);
      }
    }
  },

  /* ------------------------------------------------------------------
     SPAWNING
     ------------------------------------------------------------------ */
  _between(a, b) { return a + (this._rng ? this._rng() : Math.random()) * (b - a); },

  _isFloor(c) { return c.max.y <= 0.1 && c.max.y >= -0.05 && c.min.y < 0; },

  _blocks(c) { return c.max.y > 0.6 && c.min.y < this.C.height; },

  _hasFloor(x, z) {
    const cs = this.opts.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (this._isFloor(c) && x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) return true;
    }
    return false;
  },

  _floorY(x, z) {
    const cs = this.opts.colliders;
    let y = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (this._isFloor(c) && x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) y = Math.max(y, c.max.y);
    }
    return y;
  },

  // Is a Hound-sized circle at (x, z) in open space?
  _open(x, z, r) {
    const o = this.opts;
    if (o.isOpen) {
      return o.isOpen(x, z) && o.isOpen(x + r, z) && o.isOpen(x - r, z) && o.isOpen(x, z + r) && o.isOpen(x, z - r);
    }
    if (!this._hasFloor(x, z)) return false;
    return !this._blocked(x, z, r);
  },

  _blocked(x, z, r) {
    const o = this.opts;
    if (o.isOpen) return !o.isOpen(x, z);
    const cs = o.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!this._blocks(c)) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
    }
    return false;
  },

  // Does the segment between two points cross anything a Hound can see past?
  // Uses a band around Hound-eye to player-chest height.
  _los(x0, z0, x1, z1) {
    const cs = this.opts.colliders;
    const dx = x1 - x0, dz = z1 - z0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.max.y <= 0.3 || c.min.y >= 1.2) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 < c.min.x || x0 > c.max.x) continue; }
      else {
        let a = (c.min.x - x0) / dx, b = (c.max.x - x0) / dx;
        if (a > b) { const s = a; a = b; b = s; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (z0 < c.min.z || z0 > c.max.z) continue; }
      else {
        let a = (c.min.z - z0) / dz, b = (c.max.z - z0) / dz;
        if (a > b) { const s = a; a = b; b = s; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      return false;
    }
    return true;
  },

  _valid(x, z, forced) {
    const C = this.C, o = this.opts, P = Player.position;
    if (!this._open(x, z, C.radius + 0.05)) return false;
    if (forced) {
      for (const h of this.list) if (Math.hypot(h.x - x, h.z - z) < 1) return false;
      return true;
    }
    if (this.list.length >= o.cap) return false;
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d < 0.01) return false;
    // Nothing spawns during the grace window, so graceRadius is covered by the time
    // check. It is not applied after the grace: Level 3 passes 50 with a maxDist of 42,
    // and a radius that large would make spawning impossible.
    if (this.t < o.graceSeconds) return false;
    if (d < o.minDist || d > o.maxDist) return false;
    // never inside the view cone
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    const dot = (dx * fx + dz * fz) / d;
    if (dot > Math.cos(C.cone)) return false;
    // the cone above is narrower than a widescreen view, so also refuse anything
    // inside the real horizontal field of view that the player has a clear line to
    if (dot > Math.cos(this._viewHalf()) && this._los(P.x, P.z, x, z)) return false;
    for (const h of this.list) if (Math.hypot(h.x - x, h.z - z) < C.spacing) return false;
    return true;
  },

  _viewHalf() {
    const cam = (typeof CameraRig !== "undefined") ? CameraRig.camera : null;
    if (!cam || !cam.fov || !cam.aspect) return this.C.cone;
    const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) + 0.12;
    return Math.max(this.C.cone, Math.min(1.45, half));
  },

  _candidate(floors, minD) {
    const r = this._rng, o = this.opts, P = Player.position;
    if (o.isOpen || !floors.length) {
      const a = r() * Math.PI * 2, d = minD + r() * Math.max(0, o.maxDist - minD);
      return { x: P.x + Math.cos(a) * d, z: P.z + Math.sin(a) * d };
    }
    const c = floors[Math.floor(r() * floors.length)];
    return { x: c.min.x + r() * (c.max.x - c.min.x), z: c.min.z + r() * (c.max.z - c.min.z) };
  },

  _trySpawn() {
    const o = this.opts;
    const floors = o.colliders.filter(c => this._isFloor(c));
    for (let i = 0; i < 120; i++) {
      const c = this._candidate(floors, o.minDist);
      if (this._valid(c.x, c.z, false)) { this._make(c.x, c.z, false); return true; }
    }
    return false;
  },

  /* ------------------------------------------------------------------
     MESH
     ------------------------------------------------------------------ */
  _assets() {
    if (this.shared) return;
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    this.shared = {
      body: new THREE.MeshStandardMaterial({ color: 0x25211d, roughness: 0.95, metalness: 0 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 0.95, metalness: 0 }),
      eye: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })
    };
  },

  _build() {
    this._assets();
    const S = this.shared, g = new THREE.Group();
    const add = (parent, mat, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(this.box, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      parent.add(m);
      return m;
    };
    // forward is +z. About 1.1 m nose to rump, 0.7 m at the shoulder.
    const body = new THREE.Group();
    add(body, S.body, 0, 0.40, -0.05, 0.46, 0.34, 0.78);   // torso
    add(body, S.body, 0, 0.50, 0.18, 0.44, 0.40, 0.34);    // shoulder mass, top at 0.70
    add(body, S.dark, 0, 0.47, 0.46, 0.30, 0.26, 0.32);    // head, low and forward
    add(body, S.dark, 0, 0.42, -0.55, 0.08, 0.08, 0.30);   // tail
    add(body, S.eye, -0.09, 0.53, 0.63, 0.05, 0.035, 0.02);
    add(body, S.eye, 0.09, 0.53, 0.63, 0.05, 0.035, 0.02);
    g.add(body);
    const legs = [];
    for (const [lx, lz] of [[-0.17, 0.22], [0.17, 0.22], [-0.17, -0.28], [0.17, -0.28]]) {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.26, lz);
      add(pivot, S.dark, 0, -0.13, 0, 0.1, 0.26, 0.1);
      g.add(pivot);
      legs.push(pivot);
    }
    g.name = "Hound";
    return { group: g, body, legs };
  },

  _make(x, z, forced) {
    const built = this._build();
    const y = this._floorY(x, z);
    const h = {
      x, z, y, forced: !!forced,
      mesh: built.group, body: built.body, legs: built.legs,
      state: "wander", heading: this._rng() * Math.PI * 2, side: 1,
      homeX: x, homeZ: z, tx: x, tz: z, waitT: 0.5 + Math.random() * 1.5, stuckT: 0,
      senseT: Math.random() * 0.15, los: false, lostT: 0,
      stunT: 0, inContact: false, contactT: 0, willStumble: false, stumbleAt: 0.4, dmgAcc: 0,
      phase: Math.random() * 6, moved: 0
    };
    built.group.position.set(x, y, z);
    built.group.rotation.y = h.heading;
    if (typeof scene !== "undefined" && scene) scene.add(built.group);
    this.list.push(h);
    return h;
  },

  _free(h) {
    if (h && h.mesh && h.mesh.parent) h.mesh.parent.remove(h.mesh);
  },

  /* ------------------------------------------------------------------
     BEHAVIOR
     ------------------------------------------------------------------ */
  // Step toward (tx, tz). If the straight line is blocked, bend away from it, so
  // the Hound slides along walls instead of stopping. No graph, no path.
  _move(h, tx, tz, speed, dt) {
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const step = Math.min(speed * dt, d);
    const base = Math.atan2(dx, dz), s = h.side;
    const offs = [0, 0.5 * s, -0.5 * s, 1.0 * s, -1.0 * s, 1.6 * s, -1.6 * s];
    for (let i = 0; i < offs.length; i++) {
      const a = base + offs[i];
      const nx = h.x + Math.sin(a) * step, nz = h.z + Math.cos(a) * step;
      if (this._blocked(nx, nz, this.C.radius)) continue;
      h.x = nx; h.z = nz;
      if (i > 0) h.side = offs[i] > 0 ? 1 : -1;
      this._turn(h, a, dt);
      return step;
    }
    this._turn(h, base, dt);
    return 0;
  },

  _turn(h, a, dt) {
    let d = a - h.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const m = 12 * dt;
    h.heading += Math.max(-m, Math.min(m, d));
  },

  _growl(h) {
    if (typeof AudioSystem === "undefined" || !AudioSystem.playPositional) return;
    AudioSystem.playPositional("creak", h.x, 0.5, h.z, { gain: 0.5, bus: "entity", max: 70 });
  },

  _think(h, dt) {
    const C = this.C, P = Player.position;
    const dx = P.x - h.x, dz = P.z - h.z, d = Math.hypot(dx, dz);

    h.senseT -= dt;
    if (h.senseT <= 0) {
      h.senseT = C.senseEvery;
      h.los = d < 60 && this._los(h.x, h.z, P.x, P.z);
    }

    h.moved = 0;
    if (h.stunT > 0) {
      h.stunT -= dt;
    } else {
      if (h.state === "wander") {
        if (h.los && d <= C.commitDist) {
          h.state = "chase";
          h.lostT = 0;
          this._growl(h);
        } else this._wander(h, dt);
      }
      if (h.state === "chase") {
        if (h.los) h.lostT = 0; else h.lostT += dt;
        if (h.lostT >= C.giveUp) {
          h.state = "wander";
          h.homeX = h.x; h.homeZ = h.z; h.tx = h.x; h.tz = h.z; h.waitT = 1;
        } else {
          h.moved = this._move(h, P.x, P.z, C.chaseSpeed, dt);
        }
      }
    }
    this._contact(h, dt, d);
    this._separate(h);
    this._pose(h, dt);
  },

  _wander(h, dt) {
    const C = this.C;
    const dd = Math.hypot(h.tx - h.x, h.tz - h.z);
    if (h.waitT > 0) { h.waitT -= dt; return; }
    if (dd < 0.5 || h.stuckT > 1.5) {
      h.stuckT = 0;
      h.waitT = 1 + Math.random() * 2.5;
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
        const nx = h.homeX + Math.cos(a) * r, nz = h.homeZ + Math.sin(a) * r;
        if (this._open(nx, nz, C.radius + 0.05)) { h.tx = nx; h.tz = nz; break; }
      }
      return;
    }
    const moved = this._move(h, h.tx, h.tz, C.wanderSpeed, dt);
    h.moved = moved;
    h.stuckT = moved < C.wanderSpeed * dt * 0.3 ? h.stuckT + dt : 0;
  },

  // Continuous contact: 22 hp/s while overlapping, in 2 hp steps. Once in a
  // while (15%) the Hound stumbles 0.3 to 0.6 s in, lets go, and is stunned.
  _contact(h, dt, d) {
    const C = this.C, P = Player.position;
    const touching = d < C.radius + CONFIG.player.radius + 0.12 && P.y < C.height + 0.05 && h.stunT <= 0;
    if (!touching) { h.inContact = false; h.contactT = 0; h.dmgAcc = 0; return; }
    if (h.state === "wander") { h.state = "chase"; h.lostT = 0; h.los = true; this._growl(h); }
    if (!h.inContact) {
      h.inContact = true;
      h.contactT = 0;
      h.dmgAcc = 0;
      h.willStumble = Math.random() < C.stumbleChance;
      h.stumbleAt = C.stumbleMin + Math.random() * (C.stumbleMax - C.stumbleMin);
    }
    h.contactT += dt;
    if (h.willStumble && h.contactT >= h.stumbleAt) {
      h.stunT = C.stunTime;
      h.inContact = false;
      h.contactT = 0;
      h.willStumble = false;
      // fall back a little so the release is visible
      const bx = h.x - (P.x - h.x) / Math.max(d, 0.01) * 0.5, bz = h.z - (P.z - h.z) / Math.max(d, 0.01) * 0.5;
      if (!this._blocked(bx, bz, C.radius)) { h.x = bx; h.z = bz; }
      return;
    }
    h.dmgAcc += C.dps * dt;
    if (h.dmgAcc >= C.chunk) {
      const n = Math.floor(h.dmgAcc);
      h.dmgAcc -= n;
      Player.damagePlayer(n);
      if (Player.hp <= 0) this._startDeath();
    }
  },

  _separate(h) {
    for (const o of this.list) {
      if (o === h) continue;
      const dx = h.x - o.x, dz = h.z - o.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.8) {
        const nx = h.x + dx / d * (0.8 - d) * 0.5, nz = h.z + dz / d * (0.8 - d) * 0.5;
        if (!this._blocked(nx, nz, this.C.radius)) { h.x = nx; h.z = nz; }
      }
    }
  },

  _pose(h, dt) {
    const speed = dt > 0 ? h.moved / dt : 0;
    h.phase += speed * dt * 3.2;
    const swing = Math.min(1, speed / 3) * 0.8;
    const l = h.legs;
    l[0].rotation.x = Math.sin(h.phase) * swing;
    l[3].rotation.x = Math.sin(h.phase) * swing;
    l[1].rotation.x = Math.sin(h.phase + Math.PI) * swing;
    l[2].rotation.x = Math.sin(h.phase + Math.PI) * swing;
    h.body.position.y = Math.abs(Math.sin(h.phase * 1.0)) * 0.04 * Math.min(1, speed / 3);
    h.mesh.position.set(h.x, h.y, h.z);
    h.mesh.rotation.y = h.heading;
  },

  /* ------------------------------------------------------------------
     DEATH: fade to black over 1.2 s, then the game over screen.
     No distortion, that belongs to the Smiler.
     ------------------------------------------------------------------ */
  _overlay() {
    if (!this.overlayEl) {
      const el = document.createElement("div");
      el.id = "hound-death";
      el.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:#000;opacity:0;pointer-events:none;z-index:60;display:none;";
      document.body.appendChild(el);
      this.overlayEl = el;
    }
    return this.overlayEl;
  },

  _startDeath() {
    if (this.dying || GameState.phase !== "playing") return;
    this.dying = true;
    this.deathT = 0;
    GameState.cutscene = true;
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const el = this._overlay();
    el.style.opacity = "0";
    el.style.display = "block";
  },

  _death(dt) {
    this.deathT += dt;
    const el = this._overlay();
    el.style.opacity = String(Math.min(1, this.deathT / this.C.deathFade));
    if (this.deathT >= this.C.deathFade) {
      this.dying = false;
      GameState.cutscene = false;
      el.style.display = "none";
      el.style.opacity = "0";
      Game.gameOver();
    }
  }
};
