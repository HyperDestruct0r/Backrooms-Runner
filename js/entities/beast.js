"use strict";

/* The Beast of Level 5 (Entity 18). Tall, in a dark suit, a cephalopod head, tentacles at the mouth.

   BeastSystem is level-agnostic, the same shape as HoundSystem. It never reads which level is active.
   A level calls attach(opts) with its own live collider array. Level 5 is the only caller.

   Two phases, switched by the system and not by the Beast:
     WATCHING  It spawns out of sight, at least 25 m away, and keeps its distance. It moves slowly and never
               attacks. While it is watching and within 20 m it drains a little sanity (Player.addSanity).
     COMMITTED The player has been here 90 s, or sanity is under half, whichever comes first. From then on it
               chases at 7.0 m/s. Player walk 4.6, sprint 8.15: it is faster than a walk, slower than a sprint.
               You have to run.

   Contact is damage over time (15 HP/s), with a small chance to stumble, let go, and be stunned.
   A killing blow starts a fade to black with one line of text, then the existing Game.gameOver().

   The Beast has no world of its own. It reads the level's collider array, rebuilt in place by streaming,
   through a small bucket index that is refreshed when the array changes. It adds no light.

   Optional attach() hooks, both from the level:
     avoid(x, z, margin)  true where the Beast may never stand (Level 5: the ballroom, grown by margin).
     canSpawn(x, z)       true where a natural spawn is allowed (Level 5: halls and rooms, not the lobby).

   Collider rules. A collider blocks the Beast when it overlaps its body band (max.y > 0.6 and min.y < 2.0).
   Door headers (2.5 m) and ceiling slabs (3.0 m and up) sit above that band. Floors are colliders whose top
   is at about y = 0; a point must have a floor under it, so the Beast is never placed in the void. */
const BeastSystem = {
  attached: false,
  opts: null,
  list: [],
  t: 0,
  spawnT: 0,
  committed: false,
  drainAcc: 0,
  _rng: null,
  shared: null,
  box: null,
  sph: null,
  overlayEl: null,
  textEl: null,
  dying: false,
  deathT: 0,
  _ix: null,
  _ixLen: -1,
  _ixAt: 0,
  _cells: null,

  C: {
    chaseSpeed: 7.0,
    watchSpeed: 1.4,
    radius: 0.4,
    height: 2.45,
    blockTop: 2.0,
    commitAfter: 90,
    commitSanity: 0.5,
    drainRange: 20,
    drainRate: 0.15,
    watchNear: 12,
    watchFar: 24,
    reach: 0.35,
    dps: 15,
    chunk: 2,
    stumbleChance: 0.15,
    stumbleMin: 0.4,
    stumbleMax: 0.9,
    stunTime: 0.7,
    retry: 2.5,
    cone: 0.6,
    cell: 0.6,
    bucket: 4,
    repath: 0.4,
    maxExpand: 5000,
    deathFade: 1.2,
    deathHold: 1.3,
    deathLine: "The hotel keeps its guests."
  },

  /* ------------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------------ */
  attach(opts) {
    this.reset();
    const o = opts || {};
    this.opts = {
      colliders: o.colliders || [],
      avoid: typeof o.avoid === "function" ? o.avoid : null,
      canSpawn: typeof o.canSpawn === "function" ? o.canSpawn : null,
      cap: o.cap == null ? 1 : Math.max(0, Math.min(1, o.cap | 0)),   // there is only one Beast
      graceSeconds: o.graceSeconds == null ? 20 : o.graceSeconds,
      minDist: o.minDist == null ? 25 : o.minDist,
      maxDist: o.maxDist == null ? 40 : o.maxDist
    };
    let a = ((o.seed == null ? 1 : o.seed) ^ 0x1B5C0DE5) >>> 0 || 1;
    this._rng = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    this.t = 0;
    this.spawnT = 0;
    this.committed = false;
    this.drainAcc = 0;
    this._ix = null;
    this._ixLen = -1;
    this.attached = true;
  },

  detach() {
    this.reset();
    this.attached = false;
    this.opts = null;
    this.t = 0;
    this.committed = false;
    this._ix = null;
    this._cells = null;
    this._ixLen = -1;
  },

  // Removes the Beast and cancels a death in progress. Stays attached; the clock and the commit are kept.
  reset() {
    for (const h of this.list) this._free(h);
    this.list.length = 0;
    if (this.dying) {
      this.dying = false;
      GameState.cutscene = false;
    }
    this.deathT = 0;
    this.drainAcc = 0;
    if (this.overlayEl) { this.overlayEl.style.display = "none"; this.overlayEl.style.opacity = "0"; }
    if (this.textEl) this.textEl.style.opacity = "0";
    if (this.attached) this.spawnT = 0;
  },

  count() { return this.list.length; },

  // Test hook: skip the wait and commit now.
  commit() { if (this.attached) this._commit(); },

  // Place the Beast at a point. Returns it, or null if refused. `forced` ignores the view cone, the grace,
  // the distances and the spawn rules of the level (a command can put it in the lobby). It still needs
  // open floor, is never inside an avoided area, and never exceeds the cap.
  spawnAt(x, z, forced) {
    if (!this.attached || !this.opts) return null;
    this._ensureIndex(true);
    if (!this._valid(x, z, !!forced)) return null;
    if (!forced && !this._reachable(x, z)) return null;
    return this._make(x, z, !!forced);
  },

  // Remove the Beast. Returns how many went. Natural spawning resumes after a pause.
  despawn() {
    const n = this.list.length;
    for (const h of this.list) this._free(h);
    this.list.length = 0;
    if (this.attached) this.spawnT = 20;
    return n;
  },

  update(dt) {
    if (this.dying) { this._death(dt); return; }
    if (!this.attached || !this.opts) return;
    if (GameState.cutscene || GameState.phase !== "playing") return;
    this.t += dt;
    const o = this.opts, C = this.C, P = Player.position;
    this._ensureIndex(false);

    // commit: 90 s in the level, or sanity under half, whichever comes first
    if (!this.committed) {
      const sanityLow = typeof CONFIG !== "undefined" && Player.sanity < CONFIG.sanity.max * C.commitSanity;
      if (this.t >= C.commitAfter || sanityLow) this._commit();
    }

    // spawn schedule: nothing during the grace, then a try every so often until there is one
    if (this.t >= o.graceSeconds) {
      if (this.list.length >= o.cap) this.spawnT = 0;
      else {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          this.spawnT = this._trySpawn() ? 0 : C.retry;
        }
      }
    }

    let watchingNear = false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      this._think(h, dt);
      const d = Math.hypot(h.x - P.x, h.z - P.z);
      if (!this.committed && d < C.drainRange) watchingNear = true;
      // streaming dropped the floor under it, it was left far behind, or it is cut off from the player: recycle, the schedule respawns it
      const lost = !this._hasFloor(h.x, h.z);
      if (lost || (!h.forced && (d > o.maxDist * 1.6 || h.cutT > 5))) {
        this._free(h);
        this.list.splice(i, 1);
        this.spawnT = C.retry;
      }
    }

    // a faint sanity drain, only while it is watching and within 20 m. Uses the existing sanity.
    if (watchingNear && !this.dying) {
      this.drainAcc += C.drainRate * dt;
      while (this.drainAcc >= 1) {
        this.drainAcc -= 1;
        if (typeof Player.addSanity === "function") Player.addSanity(-1);
      }
    } else this.drainAcc = 0;
  },

  /* ------------------------------------------------------------------
     COLLIDER INDEX. Buckets of 4 m, so every test touches a handful of boxes.
     ------------------------------------------------------------------ */
  _isFloor(c) { return c.max.y <= 0.1 && c.max.y >= -0.05 && c.min.y < 0; },

  _blocks(c) { return c.max.y > 0.6 && c.min.y < this.C.blockTop; },

  _bk(bx, bz) { return (bx + 8192) * 16384 + (bz + 8192); },

  _ensureIndex(force) {
    const cs = this.opts.colliders, now = performance.now();
    if (!force && this._ix && cs.length === this._ixLen && now - this._ixAt < 1500) return;
    const B = this.C.bucket, blockers = new Map(), floors = new Map();
    const put = (map, c) => {
      const x0 = Math.floor(c.min.x / B), x1 = Math.floor(c.max.x / B);
      const z0 = Math.floor(c.min.z / B), z1 = Math.floor(c.max.z / B);
      for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
        const k = this._bk(bx, bz);
        let a = map.get(k);
        if (!a) { a = []; map.set(k, a); }
        a.push(c);
      }
    };
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (this._isFloor(c)) put(floors, c);
      else if (this._blocks(c)) put(blockers, c);
    }
    this._ix = { blockers, floors };
    this._ixLen = cs.length;
    this._ixAt = now;
    this._cells = new Map();
  },

  _hasFloor(x, z) {
    if (!this._ix) return false;
    const a = this._ix.floors.get(this._bk(Math.floor(x / this.C.bucket), Math.floor(z / this.C.bucket)));
    if (!a) return false;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) return true;
    }
    return false;
  },

  _floorY(x, z) {
    let y = 0;
    if (!this._ix) return y;
    const a = this._ix.floors.get(this._bk(Math.floor(x / this.C.bucket), Math.floor(z / this.C.bucket)));
    if (!a) return y;
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) y = Math.max(y, c.max.y);
    }
    return y;
  },

  _avoid(x, z, m) { return this.opts.avoid ? !!this.opts.avoid(x, z, m || 0) : false; },

  _blocked(x, z, r) {
    if (this._avoid(x, z, r + 0.1)) return true;
    if (!this._ix) return false;
    const B = this.C.bucket, bm = this._ix.blockers;
    const x0 = Math.floor((x - r) / B), x1 = Math.floor((x + r) / B);
    const z0 = Math.floor((z - r) / B), z1 = Math.floor((z + r) / B);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
      const a = bm.get(this._bk(bx, bz));
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
      }
    }
    return false;
  },

  // Is a Beast-sized circle at (x, z) on open floor?
  _open(x, z, r) {
    return this._hasFloor(x, z) && !this._blocked(x, z, r);
  },

  // A straight walk from one point to another, clear of everything the Beast cannot pass.
  _segClear(x0, z0, x1, z1, r) {
    const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(d / 0.3));
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      if (this._blocked(x0 + dx * k, z0 + dz * k, r)) return false;
    }
    return true;
  },

  // Does the segment between two points cross anything the player could see past?
  _los(x0, z0, x1, z1) {
    const cs = this.opts.colliders;
    const dx = x1 - x0, dz = z1 - z0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.max.y <= 0.3 || c.min.y >= 1.8) continue;
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

  /* ------------------------------------------------------------------
     SPAWNING
     ------------------------------------------------------------------ */
  _viewHalf() {
    const cam = (typeof CameraRig !== "undefined") ? CameraRig.camera : null;
    if (!cam || !cam.fov || !cam.aspect) return this.C.cone;
    const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) + 0.12;
    return Math.max(this.C.cone, Math.min(1.45, half));
  },

  _valid(x, z, forced) {
    const C = this.C, o = this.opts, P = Player.position;
    if (this.list.length >= o.cap) return false;
    if (!this._open(x, z, C.radius + 0.05)) return false;
    if (forced) return true;
    if (this.t < o.graceSeconds) return false;
    if (o.canSpawn && !o.canSpawn(x, z)) return false;
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d < o.minDist || d > o.maxDist) return false;
    // never inside the view cone, and never inside the real field of view with a clear line to the player
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    const dot = (dx * fx + dz * fz) / d;
    if (dot > Math.cos(C.cone)) return false;
    if (dot > Math.cos(this._viewHalf()) && this._los(P.x, P.z, x, z)) return false;
    return true;
  },

  _trySpawn() {
    const o = this.opts, r = this._rng, P = Player.position;
    if (this._avoid(P.x, P.z, 0)) return false;     // the player is in the ballroom: wait
    let routes = 0;
    const floors = [];
    for (const c of o.colliders) if (this._isFloor(c)) floors.push(c);
    if (!floors.length) return false;
    for (let i = 0; i < 400; i++) {
      const c = floors[Math.floor(r() * floors.length)];
      const x = c.min.x + r() * (c.max.x - c.min.x), z = c.min.z + r() * (c.max.z - c.min.z);
      const d = Math.hypot(x - P.x, z - P.z);
      if (d < o.minDist || d > o.maxDist) continue;
      if (!this._valid(x, z, false)) continue;
      if (++routes > 8) break;
      if (this._reachable(x, z)) { this._make(x, z, false); return true; }
    }
    return false;
  },

  /* ------------------------------------------------------------------
     MESH. Boxes and one sphere. No model, no texture, no light.
     ------------------------------------------------------------------ */
  _assets() {
    if (this.shared) return;
    this.box = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    this.sph = new THREE.SphereGeometry(1, 16, 12);
    this.shared = {
      suit: new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.92, metalness: 0 }),
      black: new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.9, metalness: 0 }),
      shirt: new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.9, metalness: 0 }),
      tie: new THREE.MeshStandardMaterial({ color: 0x2a0e12, roughness: 0.9, metalness: 0 }),
      pale: new THREE.MeshStandardMaterial({ color: 0xc9c3b5, roughness: 0.65, metalness: 0 }),
      tent: new THREE.MeshStandardMaterial({ color: 0x9c8e96, roughness: 0.6, metalness: 0 }),
      eye: new THREE.MeshBasicMaterial({ color: 0xfff0a8, toneMapped: false, fog: false })
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
    // forward is +z. About 2.4 m from shoe to crown.
    const legs = [];
    for (const lx of [-0.13, 0.13]) {
      const pv = new THREE.Group();
      pv.position.set(lx, 1.0, 0);
      add(pv, S.suit, 0, -0.5, 0, 0.17, 1.0, 0.19);
      add(pv, S.black, 0, -0.97, 0.06, 0.19, 0.07, 0.32);
      g.add(pv);
      legs.push(pv);
    }
    const body = new THREE.Group();
    add(body, S.suit, 0, 1.42, 0, 0.52, 0.85, 0.30);          // jacket
    add(body, S.suit, 0, 1.83, 0, 0.68, 0.12, 0.32);          // shoulders
    add(body, S.shirt, 0, 1.52, 0.155, 0.12, 0.56, 0.012);    // shirt front
    add(body, S.tie, 0, 1.47, 0.164, 0.05, 0.50, 0.012);      // tie
    add(body, S.suit, 0, 1.97, 0, 0.14, 0.12, 0.14);          // neck
    const arms = [];
    for (const ax of [-0.39, 0.39]) {
      const pv = new THREE.Group();
      pv.position.set(ax, 1.82, 0);
      add(pv, S.suit, 0, -0.46, 0, 0.11, 0.92, 0.12);
      add(pv, S.pale, 0, -0.98, 0, 0.09, 0.14, 0.09);
      body.add(pv);
      arms.push(pv);
    }
    // the head: a tall pale mantle, tipped back a little
    const head = new THREE.Mesh(this.sph, S.pale);
    head.position.set(0, 2.14, -0.01);
    head.scale.set(0.19, 0.3, 0.2);
    head.rotation.x = -0.22;
    body.add(head);
    add(body, S.eye, -0.085, 2.06, 0.185, 0.045, 0.03, 0.02);
    add(body, S.eye, 0.085, 2.06, 0.185, 0.045, 0.03, 0.02);
    // tentacles at the mouth
    const tents = [];
    for (let i = 0; i < 6; i++) {
      const pv = new THREE.Group();
      const k = i / 5 - 0.5;
      pv.position.set(k * 0.16, 1.94, 0.17);
      add(pv, S.tent, 0, -0.26, 0, 0.032, 0.52, 0.032);
      pv.rotation.x = 0.15;
      body.add(pv);
      tents.push({ pv, ph: i * 1.1 });
    }
    g.add(body);
    g.name = "Beast";
    return { group: g, body, legs, arms, tents };
  },

  _make(x, z, forced) {
    const built = this._build();
    const y = this._floorY(x, z);
    const P = Player.position;
    const h = {
      x, z, y, forced: !!forced,
      mesh: built.group, body: built.body, legs: built.legs, arms: built.arms, tents: built.tents,
      state: "watch", heading: Math.atan2(P.x - x, P.z - z),
      stunT: 0, inContact: false, contactT: 0, willStumble: false, stumbleAt: 0.5, dmgAcc: 0,
      path: null, pi: 0, repathT: 0, direct: false, stuckT: 0, cutT: 0,
      approaching: false, retreatT: 0, rx: x, rz: z, hasRetreat: false,
      phase: Math.random() * 6, moved: 0, clock: Math.random() * 10
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
     MOVEMENT
     ------------------------------------------------------------------ */
  // Step toward (tx, tz). If the straight step is blocked, bend away from it and slide along the wall.
  _move(h, tx, tz, speed, dt, turn) {
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const step = Math.min(speed * dt, d);
    const base = Math.atan2(dx, dz), s = h.side || 1;
    const offs = [0, 0.5 * s, -0.5 * s, 1.0 * s, -1.0 * s];
    for (let i = 0; i < offs.length; i++) {
      const a = base + offs[i];
      const nx = h.x + Math.sin(a) * step, nz = h.z + Math.cos(a) * step;
      if (this._blocked(nx, nz, this.C.radius)) continue;
      h.x = nx; h.z = nz;
      if (i > 0) h.side = offs[i] > 0 ? 1 : -1;
      if (turn !== false) this._turn(h, a, dt, 6);
      return step;
    }
    if (turn !== false) this._turn(h, base, dt, 6);
    return 0;
  },

  _turn(h, a, dt, rate) {
    let d = a - h.heading;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const m = rate * dt;
    h.heading += Math.max(-m, Math.min(m, d));
  },

  _face(h, dt, rate) {
    const P = Player.position;
    this._turn(h, Math.atan2(P.x - h.x, P.z - h.z), dt, rate);
  },

  // A* over a 0.6 m grid laid on the loaded floor. Goal inside an avoided area (the ballroom) or
  // out of reach: the path leads to the reachable cell nearest the goal, so the Beast ends up waiting
  // at the door instead of pushing at a wall.
  _astar(sx, sz, gx, gz) {
    const cs = this.C.cell, r = this.C.radius + 0.02, cache = this._cells;
    const OFF = 32768, K = 65536;
    const key = (i, j) => (i + OFF) * K + (j + OFF);
    const open = (i, j) => {
      const k = key(i, j);
      let v = cache.get(k);
      if (v === undefined) { v = this._open(i * cs, j * cs, r); cache.set(k, v); }
      return v;
    };
    const si = Math.round(sx / cs), sj = Math.round(sz / cs);
    const gi = Math.round(gx / cs), gj = Math.round(gz / cs);
    const hf = (i, j) => { const a = Math.abs(i - gi), b = Math.abs(j - gj); return Math.max(a, b) + 0.4142 * Math.min(a, b); };
    // binary min-heap of [f, i, j]
    const heap = [];
    const push = (n) => {
      heap.push(n);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p][0] <= heap[c][0]) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t; c = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, rr = l + 1;
          let m = c;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr;
          if (m === c) break;
          const t = heap[m]; heap[m] = heap[c]; heap[c] = t; c = m;
        }
      }
      return top;
    };
    const g = new Map(), par = new Map(), closed = new Set();
    const sk = key(si, sj);
    g.set(sk, 0);
    push([hf(si, sj), si, sj]);
    let bi = si, bj = sj, bh = hf(si, sj), bg = 0, exp = 0, reached = false;
    const N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (heap.length && exp < this.C.maxExpand) {
      const n = pop(), i = n[1], j = n[2], k = key(i, j);
      if (closed.has(k)) continue;
      closed.add(k);
      exp++;
      const cg = g.get(k), hh = hf(i, j);
      if (hh < bh - 1e-9 || (Math.abs(hh - bh) < 1e-9 && cg < bg)) { bh = hh; bi = i; bj = j; bg = cg; }
      if (i === gi && j === gj) { reached = true; break; }
      for (let q = 0; q < 8; q++) {
        const di = N[q][0], dj = N[q][1], ni = i + di, nj = j + dj;
        if (!open(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && (!open(i + di, j) || !open(i, j + dj))) continue;
        const nk = key(ni, nj), ng = cg + (di !== 0 && dj !== 0 ? 1.4142 : 1);
        const old = g.get(nk);
        if (old !== undefined && old <= ng) continue;
        g.set(nk, ng);
        par.set(nk, k);
        push([ng + hf(ni, nj), ni, nj]);
      }
    }
    this._ast = { reached, capped: !reached && exp >= this.C.maxExpand, gap: bh * cs, cost: bg * cs };
    const out = [];
    let k = key(bi, bj);
    while (k !== sk && par.has(k)) {
      const i = Math.floor(k / K) - OFF, j = (k % K) - OFF;
      out.push({ x: i * cs, z: j * cs });
      k = par.get(k);
    }
    out.reverse();
    if (reached && out.length && !this._blocked(gx, gz, this.C.radius)) out[out.length - 1] = { x: gx, z: gz };
    return out;
  },

  // Is there a real walk from (x, z) to the player over the loaded floor? The ring around the player
  // can hold pockets of hotel whose link to the player is not streamed in; a Beast there is useless.
  _reachable(x, z) {
    const P = Player.position;
    this._astar(x, z, P.x, P.z);
    return this._ast.gap < 1.5 && !this._ast.capped;
  },

  // String-pull a grid path: skip ahead to the farthest point with a clear straight walk.
  _smooth(path, x, z) {
    const out = [];
    const r = this.C.radius * 0.95;
    let cx = x, cz = z, i = 0;
    while (i < path.length) {
      let far = i;
      for (let k = Math.min(path.length - 1, i + 14); k > i; k--) {
        if (this._segClear(cx, cz, path[k].x, path[k].z, r)) { far = k; break; }
      }
      out.push(path[far]);
      cx = path[far].x; cz = path[far].z;
      i = far + 1;
    }
    return out;
  },

  // Walk toward the player along a path. Returns the distance moved.
  _goTo(h, dt, speed) {
    const C = this.C, P = Player.position;
    const inBall = this._avoid(P.x, P.z, 0);
    h.repathT -= dt;
    if (h.repathT <= 0 || h.stuckT > 0.8) {
      h.repathT = C.repath;
      h.stuckT = 0;
      h.direct = !inBall && this._segClear(h.x, h.z, P.x, P.z, C.radius * 0.95);
      if (!h.direct) {
        h.path = this._smooth(this._astar(h.x, h.z, P.x, P.z), h.x, h.z);
        h.pi = 0;
        // search space used up and still 6 m or more short of the player: cut off from them
        const a = this._ast;
        if (!inBall && !a.reached && !a.capped && a.gap > 6) h.cutT += C.repath; else h.cutT = 0;
      } else h.cutT = 0;
    }
    let tx = P.x, tz = P.z;
    if (!h.direct) {
      if (!h.path || !h.path.length) { this._face(h, dt, 3); return 0; }
      while (h.pi < h.path.length - 1 && Math.hypot(h.path[h.pi].x - h.x, h.path[h.pi].z - h.z) < 0.45) h.pi++;
      const w = h.path[h.pi];
      if (h.pi >= h.path.length - 1 && Math.hypot(w.x - h.x, w.z - h.z) < 0.25) { this._face(h, dt, 3); return 0; }
      tx = w.x; tz = w.z;
    } else if (Math.hypot(P.x - h.x, P.z - h.z) < 0.75) {
      this._face(h, dt, 6);
      return 0;
    }
    const moved = this._move(h, tx, tz, speed, dt, true);
    h.stuckT = moved < speed * dt * 0.25 ? h.stuckT + dt : 0;
    return moved;
  },

  /* ------------------------------------------------------------------
     BEHAVIOR
     ------------------------------------------------------------------ */
  _commit() {
    if (this.committed) return;
    this.committed = true;
    for (const h of this.list) { h.repathT = 0; h.approaching = false; }
    if (this.list.length && typeof AudioSystem !== "undefined" && AudioSystem.playPositional) {
      const h = this.list[0];
      AudioSystem.playPositional("creak", h.x, 1.2, h.z, { gain: 0.5, bus: "entity", max: 80 });
    }
  },

  _think(h, dt) {
    const C = this.C, P = Player.position;
    const dx = P.x - h.x, dz = P.z - h.z, d = Math.hypot(dx, dz);
    const inBall = this._avoid(P.x, P.z, 0);
    h.moved = 0;
    h.clock += dt;
    if (h.stunT > 0) {
      h.stunT -= dt;
    } else if (this.committed) {
      h.state = inBall ? "wait" : "chase";
      h.moved = this._goTo(h, dt, C.chaseSpeed);
    } else {
      h.state = "watch";
      this._watch(h, dt, d);
    }
    this._contact(h, dt, d, inBall);
    this._pose(h, dt);
  },

  // Keep a distance. Slow. Never attack.
  _watch(h, dt, d) {
    const C = this.C, P = Player.position;
    if (d > C.watchFar) h.approaching = true;
    else if (d < C.watchFar - 6) h.approaching = false;
    if (h.approaching) {
      h.moved = this._goTo(h, dt, C.watchSpeed);
      return;
    }
    if (d < C.watchNear) {
      h.retreatT -= dt;
      if (h.retreatT <= 0) {
        h.retreatT = 0.8;
        h.hasRetreat = false;
        let best = -1;
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * Math.PI * 2;
          const px = h.x + Math.cos(a) * 5, pz = h.z + Math.sin(a) * 5;
          if (!this._open(px, pz, C.radius + 0.05) || !this._segClear(h.x, h.z, px, pz, C.radius)) continue;
          const pd = Math.hypot(px - P.x, pz - P.z);
          if (pd > best) { best = pd; h.rx = px; h.rz = pz; h.hasRetreat = best > d + 0.5; }
        }
      }
      if (h.hasRetreat) {
        h.moved = this._move(h, h.rx, h.rz, C.watchSpeed, dt, false);
        this._face(h, dt, 2.5);      // it backs away and keeps its eyes on you
        return;
      }
    }
    this._face(h, dt, 2.5);
  },

  // Damage over time while it holds you: 15 HP/s in 2 HP steps. Now and then (15%) it stumbles
  // 0.4 to 0.9 s in, lets go, and is stunned. It cannot reach into the ballroom.
  _contact(h, dt, d, inBall) {
    const C = this.C, P = Player.position;
    const reach = C.radius + (typeof CONFIG !== "undefined" ? CONFIG.player.radius : 0.34) + C.reach;
    const touching = this.committed && !inBall && d < reach && P.y < C.height - 0.3 && h.stunT <= 0;
    if (!touching) { h.inContact = false; h.contactT = 0; h.dmgAcc = 0; return; }
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
      const bx = h.x - (P.x - h.x) / Math.max(d, 0.01) * 0.6, bz = h.z - (P.z - h.z) / Math.max(d, 0.01) * 0.6;
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

  _pose(h, dt) {
    const speed = dt > 0 ? h.moved / dt : 0;
    h.phase += speed * dt * 2.3;
    const k = Math.min(1, speed / 2.5);
    const swing = k * 0.6;
    h.legs[0].rotation.x = Math.sin(h.phase) * swing;
    h.legs[1].rotation.x = Math.sin(h.phase + Math.PI) * swing;
    h.arms[0].rotation.x = Math.sin(h.phase + Math.PI) * swing * 0.7;
    h.arms[1].rotation.x = Math.sin(h.phase) * swing * 0.7;
    const lean = (h.state === "chase") ? 0.18 : 0;
    h.body.rotation.x += (lean - h.body.rotation.x) * Math.min(1, dt * 6);
    h.body.position.y = Math.abs(Math.sin(h.phase)) * 0.04 * k;
    for (let i = 0; i < h.tents.length; i++) {
      const t = h.tents[i];
      t.pv.rotation.x = 0.15 + Math.sin(h.clock * 2.2 + t.ph) * 0.22;
      t.pv.rotation.z = Math.sin(h.clock * 1.7 + t.ph * 1.3) * 0.2;
    }
    h.mesh.position.set(h.x, h.y, h.z);
    h.mesh.rotation.y = h.heading;
  },

  /* ------------------------------------------------------------------
     DEATH: fade to black over 1.2 s, one line of text, then the game over screen.
     The Beast is removed before that screen shows.
     ------------------------------------------------------------------ */
  _overlay() {
    if (!this.overlayEl) {
      const el = document.createElement("div");
      el.id = "beast-death";
      el.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;background:#000;opacity:0;pointer-events:none;z-index:60;display:none;align-items:center;justify-content:center;";
      const tx = document.createElement("div");
      tx.style.cssText = "color:#8a8478;font:italic 20px Georgia,serif;letter-spacing:0.08em;opacity:0;text-align:center;padding:0 24px;";
      tx.textContent = this.C.deathLine;
      el.appendChild(tx);
      document.body.appendChild(el);
      this.overlayEl = el;
      this.textEl = tx;
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
    this.textEl.style.opacity = "0";
    el.style.display = "flex";
  },

  _death(dt) {
    const C = this.C;
    this.deathT += dt;
    const el = this._overlay();
    el.style.opacity = String(Math.min(1, this.deathT / C.deathFade));
    this.textEl.style.opacity = String(Math.max(0, Math.min(1, (this.deathT - C.deathFade) / 0.5)));
    if (this.deathT >= C.deathFade + C.deathHold) {
      this.dying = false;
      GameState.cutscene = false;
      for (const h of this.list) this._free(h);
      this.list.length = 0;
      el.style.display = "none";
      el.style.opacity = "0";
      this.textEl.style.opacity = "0";
      Game.gameOver();
    }
  }
};
