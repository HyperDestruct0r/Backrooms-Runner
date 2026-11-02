"use strict";

/* Level 9 entities. Four, with four different ways of behaving. Nothing here is a plain chaser.

   SMILERS    The existing SmilerSystem, attached with Level 9's rules: they only come while the player stands in
              the dark (allow), only spawn where it is dark (isDark) and never inside a house, and they are rare
              (cap 1 near the start, 2 farther out, a slow spawn clock). Their look and behaviour are untouched.
   HOUNDS     The existing HoundSystem, but each Hound is driven by a Level 9 "brain" (a hook added to hound.js).
              A Hound keeps away from the player and will use an open door to get indoors. It becomes agitated only
              by sustained pursuit: running at it, in its direction, for a long time. Every Hound has its own
              temper, so some put up with it much longer. Stop chasing and it calms down.
   MANGLED    New. Absent within 500 m of the start, then more and more common. It lurks and stalks in the dark,
              steers away from lit ground (lamps, lit windows, the flashlight beam) but is never barred by it,
              closes in by slow crawling and then a short lunge, and needs a pause to recover. You can retreat.
   THE WATCH  New. One at most. It appears at a distance, watches, withdraws when approached, and disappears.
              Chasing it for a long time makes it hostile and, rarely, it strikes. The flashlight means nothing to it.
   All four are placed from deterministic per-block spawn points (Level9Gen.blockCritters), kept only while near
   the player, and cost nothing when far away. */
const Level9Entities = {
  L: null,
  pop: new Map(),            // spawn-point id -> { ent, cool }
  mangled: [],
  watch: null,
  t: 0,
  _popT: 0,
  _rng: null,
  _smT: 0,
  _wT: 0,
  _pv: { x: 0, z: 0, s: 0 },

  rand() { return this._rng ? this._rng() : Math.random(); },

  attach(level) {
    this.reset();
    this.L = level;
    let a = ((level.seed ^ 0x51ED270B) >>> 0) || 1;
    this._rng = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    this._wT = 25 + this.rand() * 35;
    if (typeof HoundSystem !== "undefined") {
      HoundSystem.attach({
        colliders: level.entColliders, cap: 4, manual: true, seed: level.seed,
        isOpen: (x, z) => level.isOpen(x, z, 0.1, 0.6, 0.7)
      });
    }
    if (typeof SmilerSystem !== "undefined") {
      SmilerSystem.attach({
        colliders: level.entColliders, cap: 1, graceSeconds: 40, minDist: 14, maxDist: 30, seed: level.seed,
        margin: 0.9, interval: [16, 30], firstDelay: 30,
        allow: () => this.smilerAllowed(),
        isDark: (x, z) => this.isDarkSpot(x, z)
      });
    }
  },

  reset() {
    for (const m of this.mangled) this._freeMangled(m);
    this.mangled = [];
    this._freeWatch();
    this.watch = null;
    this.pop = new Map();
    if (typeof HoundSystem !== "undefined" && HoundSystem.attached) HoundSystem.reset();
    this.L = null;
  },

  // console: put a Mangled or the Watch near the player right now
  force(kind) {
    const L = this.L;
    if (!L || !L.active) return false;
    const P = Player.position;
    if (kind === "mangled") {
      for (let i = 0; i < 40; i++) {
        const a = this.rand() * 6.28, r = 12 + this.rand() * 8, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
        const e = this._makeMangled({ id: "dbg:" + this.t + ":" + i, x, z, temper: this.rand() });
        if (e) { e.state = "stalk"; return true; }
      }
      return false;
    }
    if (kind === "watch") {
      if (!this.watch) this._thinkWatch(0);
      if (this.watch && this.watch.state !== "absent") return true;
      this.watch.timer = 0;
      this._thinkWatch(0.016);
      return this.watch.state !== "absent";
    }
    return false;
  },

  /* ------------------------------------------------------------------
     SHARED QUERIES
     ------------------------------------------------------------------ */
  houseAt(x, z) {
    const G = Level9Gen;
    for (const rec of this.L.blocks.values()) {
      if (x < rec.B.x0 || x > rec.B.x1 || z < rec.B.z0 || z > rec.B.z1) continue;
      for (const h of rec.houses) {
        const sp = h.sp, l = G.worldToLocal(sp, x, z);
        const x0 = -sp.W / 2 - (sp.garage < 0 ? G.GW : 0), x1 = sp.W / 2 + (sp.garage > 0 ? G.GW : 0);
        if (l.x > x0 && l.x < x1 && l.z > -sp.D / 2 && l.z < sp.D / 2) return h;
      }
    }
    return null;
  },
  isDarkSpot(x, z) {
    if (this.houseAt(x, z)) return false;
    return this.L.lightAt(x, z) < 0.22;
  },
  smilerAllowed() {
    const P = Player.position;
    if (this.houseAt(P.x, P.z)) return false;
    return this.L.lightAt(P.x, P.z) < 0.5;
  },
  playerSpeed() {
    const v = Player.velocity;
    return Math.hypot(v.x, v.z);
  },
  inView(x, z, extra) {
    const P = Player.position, dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    return (dx * fx + dz * fz) / d > Math.cos(0.95 + (extra || 0));
  },
  // a rough line of sight at chest height
  sight(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(d / 1.0));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.L.isOpen(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.05, 0.9, 1.9)) return false;
    }
    return true;
  },
  // 0 near the start, 1 deep (beyond 2000 m)
  depth() { return Math.max(0, Math.min(1, Level9Gen.distFromSpawn(Player.position.x, Player.position.z) / 2200)); },

  /* ------------------------------------------------------------------
     UPDATE
     ------------------------------------------------------------------ */
  update(dt) {
    if (!this.L || !this.L.active) return;
    this.t += dt;
    // measure what the player is doing (used by the Hound and Watch tempers)
    const v = Player.velocity, s = Math.hypot(v.x, v.z);
    this._pv.x = s > 0.01 ? v.x / s : 0; this._pv.z = s > 0.01 ? v.z / s : 0; this._pv.s = s;
    this._popT -= dt;
    if (this._popT <= 0) { this._popT = 0.5; this._population(); this._smilerCap(); }
    for (let i = this.mangled.length - 1; i >= 0; i--) this._thinkMangled(this.mangled[i], dt, i);
    this._thinkWatch(dt);
  },

  _smilerCap() {
    if (typeof SmilerSystem === "undefined" || !SmilerSystem.opts) return;
    const d = Level9Gen.distFromSpawn(Player.position.x, Player.position.z);
    SmilerSystem.opts.cap = d < 500 ? 1 : 2;
    SmilerSystem.opts.interval = d < 500 ? [24, 44] : d < 1500 ? [16, 30] : [12, 22];
  },

  /* ------------------------------------------------------------------
     POPULATION: Hounds and Mangled from deterministic spawn points
     ------------------------------------------------------------------ */
  _population() {
    const L = this.L, P = Player.position;
    // release anything that is far away or whose block is gone
    for (const [id, rec] of this.pop) {
      const e = rec.ent;
      if (!e) { if (rec.cool > 0) rec.cool -= 0.5; continue; }
      const x = rec.kind === "hound" ? e.x : e.x, z = e.z;
      const gone = rec.kind === "hound" ? !HoundSystem.list.includes(e) : !this.mangled.includes(e);
      if (gone) { rec.ent = null; rec.cool = 20; continue; }
      if (Math.hypot(x - P.x, z - P.z) > 92 || !L.blocks.has(Level9Gen.indexAt(x, 0) + "," + Level9Gen.indexAt(z, 1))) {
        if (rec.kind === "hound") { const i = HoundSystem.list.indexOf(e); if (i >= 0) { HoundSystem._free(e); HoundSystem.list.splice(i, 1); } }
        else { const i = this.mangled.indexOf(e); if (i >= 0) { this._freeMangled(e); this.mangled.splice(i, 1); } }
        rec.ent = null; rec.cool = 30;
      }
    }
    const depth = this.depth();
    const houndCap = 3 + (depth > 0.5 ? 1 : 0), mangledCap = depth < 0.45 ? 1 : depth < 0.7 ? 2 : 3;
    let nm = this.mangled.length, nh = HoundSystem.list.length;
    for (const rec of L.blocks.values()) {
      if (!rec.done || !rec.critters || !rec.critters.length) continue;
      for (const c of rec.critters) {
        let r = this.pop.get(c.id);
        if (!r) { r = { ent: null, cool: 0, kind: c.kind }; this.pop.set(c.id, r); }
        if (r.ent || r.cool > 0) continue;
        const d = Math.hypot(c.x - P.x, c.z - P.z);
        if (d < 22 || d > 54) continue;
        if (this.inView(c.x, c.z, 0.25) && this.sight(P.x, P.z, c.x, c.z)) continue;      // never pop in front of the player
        if (c.type === "interior") {
          const h = rec.houses.find(q => q.id === c.house);
          if (!h || !h.interior || h.door.target !== 1) continue;
        }
        if (c.kind === "hound") {
          if (nh >= houndCap) continue;
          const e = HoundSystem.spawnAt(c.x, c.z, true);
          if (!e) { r.cool = 25; continue; }
          this._initHound(e, c);
          r.ent = e; nh++;
        } else {
          if (nm >= mangledCap) continue;
          if (L.lightAt(c.x, c.z) > 0.3) continue;
          const e = this._makeMangled(c);
          if (!e) { r.cool = 25; continue; }
          r.ent = e; nm++;
        }
      }
    }
  },

  /* ------------------------------------------------------------------
     HOUNDS
     ------------------------------------------------------------------ */
  _initHound(h, c) {
    h.passive = true;
    h.l9 = {
      id: c.id, temper: c.temper, pursuit: 0, mood: "calm", fleeT: 0, dir: null, heading: 0, growlT: 0,
      stuck: 0, farT: 0, tol: 12 + c.temper * 18,                // seconds of weighted pursuit it puts up with
      flee: 4.5 + (1 - c.temper) * 0.9
    };
    h.homeX = h.x; h.homeZ = h.z; h.tx = h.x; h.tz = h.z;
    h.brain = (hh, dt, d) => this._houndBrain(hh, dt, d);
  },

  _houndBrain(h, dt, d) {
    const L9 = h.l9, C = HoundSystem.C, P = Player.position, pv = this._pv;
    if (!L9) return false;
    if (h.stunT > 0) { h.stunT -= dt; return true; }
    const dx = P.x - h.x, dz = P.z - h.z;
    // sustained pursuit: running, toward it, close. One close pass is nothing.
    const aimed = -(pv.x * dx + pv.z * dz) / (d || 1);          // +1 when the player is running straight at the Hound (dx,dz point from Hound to player)
    const pursuing = d < 18 && pv.s > 5.2 && aimed > 0.72;
    if (pursuing) L9.pursuit += dt * (1 + (18 - d) / 18);
    else L9.pursuit = Math.max(0, L9.pursuit - dt * (d > 20 ? 1.4 : 0.55));
    const a = L9.pursuit / L9.tol;
    const was = L9.mood;
    if (L9.mood === "hostile") { if (a < 0.45 || d > 34) L9.mood = "wary"; }
    else {
      // a little hysteresis, so it does not flicker between moods at a threshold
      const up = a >= 1 ? 3 : a >= 0.7 ? 2 : a >= 0.3 ? 1 : 0;
      const cur = L9.mood === "defensive" ? 2 : L9.mood === "wary" ? 1 : 0;
      const hold = cur === 2 ? a >= 0.58 : cur === 1 ? a >= 0.2 : false;
      const lvl = Math.max(up, hold ? cur : 0);
      L9.mood = lvl >= 3 ? "hostile" : lvl === 2 ? "defensive" : lvl === 1 ? "wary" : "calm";
    }
    if (L9.mood === "hostile" && was !== "hostile") { HoundSystem._growl(h); L9.pursuit = L9.tol * 1.15; }
    h.passive = L9.mood !== "hostile";
    h.moved = 0;

    if (L9.mood === "hostile") {                                           // it has had enough
      h.state = "chase";
      h.moved = HoundSystem._move(h, P.x, P.z, C.chaseSpeed * 0.92, dt);
      if (d > 26) L9.farT += dt; else L9.farT = 0;
      if (L9.farT > 4) { L9.mood = "wary"; L9.pursuit = L9.tol * 0.4; L9.farT = 0; h.state = "wander"; }
      return true;
    }
    h.state = "wander";
    L9.growlT -= dt;
    const near = d < 13 || (L9.mood !== "calm" && d < 20);
    if (!near) { HoundSystem._wander(h, dt); return true; }

    if (L9.mood === "defensive") {                                         // stands its ground, backs off slowly, warns
      HoundSystem._turn(h, Math.atan2(dx, dz), dt);
      if (d < 2.6 && pv.s > 3) L9.pursuit += dt * 1.5;                        // it is being crowded: that is what tips it over
      if (L9.growlT <= 0) { HoundSystem._growl(h); L9.growlT = 2.2; }
      if (d < 7) {
        const ax = h.x - dx / d * 1.4, az = h.z - dz / d * 1.4;
        h.moved = HoundSystem._move(h, ax, az, 1.3, dt);
      }
      return true;
    }
    // calm or wary: get away. Re-pick a heading a few times a second so it does not jitter.
    L9.fleeT -= dt;
    if (L9.fleeT <= 0 || !L9.dir) { L9.fleeT = 0.35; L9.dir = this._fleeDir(h, dx, dz, d); }
    if (!L9.dir) {                                                          // cornered
      HoundSystem._turn(h, Math.atan2(dx, dz), dt);
      if (d < 2.4) L9.pursuit += dt * 3;
      return true;
    }
    const sp = L9.flee * (L9.mood === "wary" ? 1.12 : 1) * (d < 5 ? 1.15 : 1);
    h.moved = HoundSystem._move(h, h.x + L9.dir[0] * 3, h.z + L9.dir[1] * 3, sp, dt);
    if (h.moved < sp * dt * 0.25) { L9.stuck += dt; if (L9.stuck > 0.5) { L9.dir = null; L9.fleeT = 0; L9.stuck = 0; } } else L9.stuck = 0;
    if (L9.mood === "wary" && L9.growlT <= 0 && d < 9) { HoundSystem._growl(h); L9.growlT = 3; }
    return true;
  },

  // the best way to run: away from the player, with room to run, indoors through an open door if it can
  _fleeDir(h, dx, dz, d) {
    const L = this.L, away = Math.atan2(-dx, -dz), L9 = h.l9;
    let best = null, bs = -9;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, sx = Math.sin(a), sz = Math.cos(a);
      let fd = 0;
      for (let s = 0.7; s <= 7; s += 0.7) {
        if (!L.isOpen(h.x + sx * s, h.z + sz * s, 0.3, 0.6, 0.7)) break;
        fd = s;
      }
      if (fd < 1.4) continue;
      let ad = a - away;
      while (ad > Math.PI) ad -= Math.PI * 2;
      while (ad < -Math.PI) ad += Math.PI * 2;
      let sc = fd / 7 + Math.cos(ad) * 1.6;
      const ex = h.x + sx * Math.min(fd, 6), ez = h.z + sz * Math.min(fd, 6);
      const hs = this.houseAt(ex, ez);
      if (hs && hs.interior) sc += 1.1;                                     // through the door, into the house
      if (L9.heading != null) { let td = a - L9.heading; while (td > Math.PI) td -= Math.PI * 2; while (td < -Math.PI) td += Math.PI * 2; sc -= Math.abs(td) / Math.PI * 0.4; }
      if (sc > bs) { bs = sc; best = [sx, sz, a]; }
    }
    if (!best) return null;
    L9.heading = best[2];
    return [best[0], best[1]];
  },

  /* ------------------------------------------------------------------
     THE MANGLED
     ------------------------------------------------------------------ */
  _mangledMesh() {
    if (!this._mm) {
      this._mm = {
        skin: new THREE.MeshStandardMaterial({ color: 0x4a3c36, roughness: 1 }),
        dark: new THREE.MeshStandardMaterial({ color: 0x241d1a, roughness: 1 }),
        red: new THREE.MeshStandardMaterial({ color: 0x4d221d, roughness: 1 })
      };
      this._unit = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    }
    const M = this._mm, g = new THREE.Group();
    const part = (mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(this._unit, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };
    const torso = new THREE.Group();                       // pivots at the hips
    torso.add(part(M.skin, 0, 0.45, 0, 0.42, 0.9, 0.26));
    torso.add(part(M.red, 0.05, 0.5, 0.14, 0.2, 0.5, 0.04));
    const head = new THREE.Group(); head.position.set(0, 0.95, 0.04);
    head.add(part(M.dark, 0, 0.12, 0.05, 0.22, 0.28, 0.24));
    head.add(part(M.skin, 0.05, 0.02, 0.12, 0.14, 0.2, 0.1));            // a jaw hanging off to one side
    head.rotation.z = 0.35;
    torso.add(head);
    const arms = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(s * 0.27, 0.82, 0);
      a.add(part(M.skin, 0, -0.5, 0, 0.1, 1.05, 0.1));                    // arms far too long
      a.add(part(M.dark, 0, -1.08, 0.02, 0.14, 0.14, 0.2));
      torso.add(a); arms.push(a);
    }
    const legs = [];
    for (const s of [-1, 1]) {
      const l = new THREE.Group(); l.position.set(s * 0.14, 0.0, 0);
      l.add(part(M.dark, 0, -0.42, 0, 0.12, 0.85, 0.12));
      g.add(l); legs.push(l);
    }
    torso.position.set(0, 0.88, 0);
    g.add(torso);
    g.name = "Mangled";
    return { g, torso, head, arms, legs };
  },

  _makeMangled(c) {
    const L = this.L;
    if (!L.isOpen(c.x, c.z, 0.4, 0.3, 1.4)) return null;
    const m = this._mangledMesh();
    const e = {
      id: c.id, kind: "mangled", x: c.x, z: c.z, hx: c.x, hz: c.z, temper: c.temper,
      g: m.g, torso: m.torso, head: m.head, arms: m.arms, legs: m.legs,
      state: "lurk", t: 0, heading: this.rand() * 6.28, up: 0.6, phase: 0, moved: 0,
      tx: c.x, tz: c.z, wait: 1, impatient: 0, litT: 0, hitT: 0, lungeT: 0, recT: 0, cool: 3 + this.rand() * 4,
      circ: this.rand() < 0.5 ? 1 : -1, lostT: 0, lightT: 0, calls: 6 + this.rand() * 8
    };
    m.g.position.set(e.x, 0, e.z);
    scene.add(m.g);
    this.mangled.push(e);
    return e;
  },

  _freeMangled(e) {
    if (e && e.g && e.g.parent) e.g.parent.remove(e.g);
  },

  // a short step with sliding: try the heading, then bend away from it
  _step(e, tx, tz, speed, dt) {
    const L = this.L, dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return 0;
    const step = Math.min(speed * dt, d), base = Math.atan2(dx, dz);
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      const a = base + off * e.circ, nx = e.x + Math.sin(a) * step, nz = e.z + Math.cos(a) * step;
      if (!L.isOpen(nx, nz, 0.36, 0.3, 1.4)) continue;
      e.x = nx; e.z = nz;
      let t = a - e.heading;
      while (t > Math.PI) t -= Math.PI * 2;
      while (t < -Math.PI) t += Math.PI * 2;
      e.heading += Math.max(-9 * dt, Math.min(9 * dt, t));
      return step;
    }
    return 0;
  },

  // the darker way: among the headings toward the target, prefer unlit ground
  _darkStep(e, tx, tz, speed, dt) {
    const L = this.L, base = Math.atan2(tx - e.x, tz - e.z);
    let best = base, bs = -9;
    for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
      const a = base + off, px = e.x + Math.sin(a) * 2.6, pz = e.z + Math.cos(a) * 2.6;
      let sc = Math.cos(off) * 1.0 - L.lightAt(px, pz) * 2.2 - (L.flashAt(px, pz) ? 0.7 : 0);
      if (!L.isOpen(px, pz, 0.36, 0.3, 1.4)) sc -= 1.5;
      if (sc > bs) { bs = sc; best = a; }
    }
    return this._step(e, e.x + Math.sin(best) * 3, e.z + Math.cos(best) * 3, speed, dt);
  },

  _thinkMangled(e, dt, idx) {
    const L = this.L, P = Player.position, dx = P.x - e.x, dz = P.z - e.z, d = Math.hypot(dx, dz);
    if (d > 100) return;
    e.t += dt; e.cool -= dt;
    e.moved = 0;
    const pLight = L.lightAt(P.x, P.z), myLight = L.lightAt(e.x, e.z) + (L.flashAt(e.x, e.z) ? 0.55 : 0);
    const los = d < 45 && this.sight(e.x, e.z, P.x, P.z);
    const loud = this._pv.s > 5.5 && d < 38;
    // its own light exposure
    e.lightT = myLight > 0.55 ? e.lightT + dt : Math.max(0, e.lightT - dt * 0.6);
    if (e.lightT > 0.9 && e.state !== "recoil" && e.state !== "recover") { e.state = "recoil"; e.t = 0; }
    const lit = pLight > 0.45;
    switch (e.state) {
      case "lurk": {                                         // hunched, slow, in the dark
        e.up = 0.6;
        e.wait -= dt;
        if (e.wait <= 0) {
          e.wait = 2 + this.rand() * 4;
          for (let i = 0; i < 8; i++) {
            const a = this.rand() * 6.28, r = 2 + this.rand() * 6, nx = e.hx + Math.cos(a) * r, nz = e.hz + Math.sin(a) * r;
            if (L.isOpen(nx, nz, 0.4, 0.3, 1.4) && L.lightAt(nx, nz) < 0.3) { e.tx = nx; e.tz = nz; break; }
          }
        }
        if (Math.hypot(e.tx - e.x, e.tz - e.z) > 0.6) e.moved = this._step(e, e.tx, e.tz, 0.9, dt);
        if ((los && d < 30 && !lit) || (loud && d < 34) || d < 9) { e.state = "stalk"; e.t = 0; e.impatient = 0; }
        break;
      }
      case "stalk": {                                        // crawls closer through unlit ground
        e.up = 0.05;
        if (d > 52 || (e.t > 40 && !los)) { e.state = "lurk"; e.hx = e.x; e.hz = e.z; break; }
        if (lit && d < 22) {                                 // the player is in the light: it hangs back and circles
          e.impatient += dt;
          const hold = 8 + e.temper * 4;
          if (d < hold) e.moved = this._step(e, e.x - dx / d * 3, e.z - dz / d * 3, 1.6, dt);
          else if (d > hold + 3) e.moved = this._darkStep(e, P.x, P.z, 2.0, dt);
          else e.moved = this._step(e, e.x - dz / d * 3, e.z + dx / d * 3, 1.5, dt);       // circles
          // patience runs out: it is not a wall. It will cross a lit patch to reach you
          if (e.impatient > 11 + e.temper * 9 && d < 16 && e.cool <= 0) { e.state = "lunge"; e.lungeT = 0; e.impatient = 0; }
        } else {
          e.impatient = Math.max(0, e.impatient - dt);
          e.moved = this._darkStep(e, P.x, P.z, 2.6, dt);
          if (d < 9.5 && los && e.cool <= 0) { e.state = "lunge"; e.lungeT = 0; }
        }
        e.calls -= dt;
        if (e.calls <= 0 && typeof AudioSystem !== "undefined") { e.calls = 9 + this.rand() * 9; AudioSystem.playPositional("creak", e.x, 0.6, e.z, { gain: 0.5, bus: "entity", max: 50 }); }
        break;
      }
      case "lunge": {                                        // a short, fast burst, then it is spent
        e.up = 0;
        e.lungeT += dt;
        e.moved = this._step(e, P.x, P.z, 7.2, dt);
        if (e.lungeT > 1.15 || d > 22) { e.state = "recover"; e.t = 0; e.cool = 3.5 + this.rand() * 3; }
        break;
      }
      case "recover": {                                      // winded: it backs off, slowly. Easy to leave behind
        e.up = 0.3;
        e.moved = d < 6 ? this._step(e, e.x - dx / (d || 1) * 3, e.z - dz / (d || 1) * 3, 1.3, dt) : 0;
        if (e.t > 2.0) { e.state = "stalk"; e.t = 0; }
        break;
      }
      case "recoil": {                                       // lit: it backs into the nearest dark
        e.up = 0.2;
        let bx = e.x, bz = e.z, bs = 9;
        for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28, px = e.x + Math.sin(a) * 5, pz = e.z + Math.cos(a) * 5, s = L.lightAt(px, pz) + (Math.hypot(P.x - px, P.z - pz) < d ? 0.15 : 0); if (s < bs && L.isOpen(px, pz, 0.4, 0.3, 1.4)) { bs = s; bx = px; bz = pz; } }
        e.moved = this._step(e, bx, bz, 3.6, dt);
        if (e.t > 2.4 && myLight < 0.35) { e.state = "stalk"; e.t = 0; e.lightT = 0; }
        break;
      }
    }
    // contact
    e.hitT -= dt;
    if (d < 0.95 && Math.abs(P.y) < 1.2 && e.hitT <= 0 && (e.state === "stalk" || e.state === "lunge")) {
      e.hitT = 0.85;
      Player.damagePlayer(20);
      if (typeof AudioSystem !== "undefined") AudioSystem.playPositional("impact", e.x, 0.8, e.z, { gain: 0.5, bus: "entity", max: 30 });
      if (Player.hp <= 0 && typeof HoundSystem !== "undefined") HoundSystem._startDeath();
      e.state = "recover"; e.t = 0; e.cool = 3 + this.rand() * 2;      // one hit, then it is spent for a few seconds
    }
    this._poseMangled(e, dt);
  },

  _poseMangled(e, dt) {
    const speed = dt > 0 ? e.moved / dt : 0;
    e.phase += speed * dt * 3.0;
    const u = e.up, sw = Math.min(1, speed / 2.5);
    e.torso.rotation.x = 1.2 * (1 - u) + 0.15 * u + Math.sin(e.phase * 0.5) * 0.04 * sw;
    e.torso.position.y = 0.45 + 0.43 * u;
    e.torso.position.z = (1 - u) * 0.18;
    e.head.rotation.x = -0.9 * (1 - u);
    e.head.rotation.z = 0.35 + Math.sin(e.t * 1.3) * 0.08;
    const reach = e.state === "lunge" ? -1.9 : 0;
    e.arms[0].rotation.x = reach + (1 - u) * -1.2 + Math.sin(e.phase) * 0.7 * sw;
    e.arms[1].rotation.x = reach + (1 - u) * -1.2 - Math.sin(e.phase) * 0.7 * sw;
    e.legs[0].rotation.x = Math.sin(e.phase) * 0.6 * sw;
    e.legs[1].rotation.x = -Math.sin(e.phase) * 0.6 * sw;
    e.legs[0].position.y = e.legs[1].position.y = 0.88 * (0.5 + 0.5 * u);
    e.g.position.set(e.x, 0, e.z);
    e.g.rotation.y = e.heading;
  },

  /* ------------------------------------------------------------------
     THE WATCH
     ------------------------------------------------------------------ */
  _watchMats() {
    if (!this._wm) {
      this._wm = {
        body: new THREE.MeshStandardMaterial({ color: 0x6d747b, roughness: 1, transparent: true, opacity: 0 }),
        eye: new THREE.MeshBasicMaterial({ color: 0xd8ecff, fog: false, transparent: true, opacity: 0 }),
        sil: new THREE.MeshBasicMaterial({ color: 0x030303, transparent: true, opacity: 0 })
      };
    }
    return this._wm;
  },

  _watchMesh() {
    const M = this._watchMats(), unit = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    const g = new THREE.Group();
    const part = (mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(unit, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m; };
    part(M.body, 0, 1.25, 0, 0.3, 1.2, 0.18);                    // torso
    part(M.body, 0, 2.05, 0.02, 0.2, 0.3, 0.2);                  // head
    part(M.eye, -0.05, 2.08, 0.13, 0.035, 0.03, 0.02);
    part(M.eye, 0.05, 2.08, 0.13, 0.035, 0.03, 0.02);
    part(M.body, -0.22, 1.05, 0, 0.07, 1.45, 0.07);              // arms hanging past the knees
    part(M.body, 0.22, 1.05, 0, 0.07, 1.45, 0.07);
    part(M.body, -0.09, 0.4, 0, 0.09, 0.8, 0.09);
    part(M.body, 0.09, 0.4, 0, 0.09, 0.8, 0.09);
    g.name = "Watch";
    return g;
  },

  _silhouette() {
    const unit = (typeof Geometries !== "undefined" && Geometries.box) ? Geometries.box : new THREE.BoxGeometry(1, 1, 1);
    const g = new THREE.Group(), M = this._watchMats();
    const part = (x, y, sx, sy) => { const m = new THREE.Mesh(unit, M.sil); m.position.set(x, y, 0); m.scale.set(sx, sy, 0.03); g.add(m); };
    part(0, 0.2, 0.2, 0.26); part(0, -0.2, 0.42, 0.7);
    return g;
  },

  _freeWatch() {
    const w = this.watch;
    if (w && w.g && w.g.parent) w.g.parent.remove(w.g);
  },

  _watchOpacity(w, o) {
    w.o = o;
    const M = this._wm;
    M.body.opacity = o; M.eye.opacity = o; M.sil.opacity = o;
    w.g.visible = o > 0.01;
  },

  _watchTimer() {
    const dep = this.depth();
    return (70 - dep * 38) * (0.7 + this.rand() * 0.8);
  },

  // find somewhere to appear: open ground in front of the player, a lit upstairs window, or a room indoors
  _watchSpot() {
    const L = this.L, P = Player.position, G = Level9Gen;
    const roll = this.rand();
    if (roll < 0.3) {                                                   // a silhouette in a lit upstairs window
      let best = null, bd = 99;
      for (const rec of L.blocks.values()) for (const h of rec.houses) {
        const sp = h.sp;
        if (!sp.lit || sp.litRoom !== "upper") continue;
        const wd = sp.windows.find(q => q.wall === "front" && q.floor === 1);
        if (!wd) continue;
        const w = G.localToWorld(sp, wd.along, sp.D / 2 + 0.1), d = Math.hypot(w.x - P.x, w.z - P.z);
        if (d < 12 || d > 26 || !this.inView(w.x, w.z, -0.2)) continue;
        if (d < bd) { bd = d; best = { type: "window", x: w.x, z: w.z, y: 4.45, house: h, yaw: sp.theta }; }
      }
      if (best) return best;
    }
    if (roll < 0.5) {                                                   // indoors, in a house whose door is open
      for (const rec of L.blocks.values()) for (const h of rec.houses) {
        if (!h.interior) continue;
        const sp = h.sp, d = Math.hypot(sp.cx - P.x, sp.cz - P.z);
        if (d < 8 || d > 30) continue;
        const rc = G.roomCenter(sp, this.rand() < 0.5 ? "back" : "front"), w = G.localToWorld(sp, rc.x - 1.2, rc.z);
        if (L.isOpen(w.x, w.z, 0.4, 0.3, 1.9) && !sp.lit) return { type: "room", x: w.x, z: w.z, y: 0, yaw: 0 };
      }
    }
    for (let i = 0; i < 24; i++) {                                      // open ground, in the fog's edge
      const r = 15 + this.rand() * 10;
      // forward is (-sin yaw, -cos yaw)
      const fa = Math.atan2(-Math.sin(Player.yaw), -Math.cos(Player.yaw)) + (this.rand() - 0.5) * 1.8;
      const x = P.x + Math.sin(fa) * r, z = P.z + Math.cos(fa) * r;
      if (!L.isOpen(x, z, 0.45, 0.3, 1.9)) continue;
      if (!this.sight(P.x, P.z, x, z)) continue;
      return { type: "ground", x, z, y: 0, yaw: 0 };
    }
    return null;
  },

  _thinkWatch(dt) {
    const L = this.L, P = Player.position, pv = this._pv;
    let w = this.watch;
    if (!w) {
      w = this.watch = { state: "absent", timer: this._wT, g: null, sil: null, x: 0, z: 0, y: 0, o: 0, t: 0, pursuit: 0, tol: 9 + this.rand() * 6, seenT: 0, awayT: 0, dwell: 0, hold: 0, strikeT: 0, hit: 0, spot: null };
    }
    // the pursuit meter ticks whenever it is present
    if (w.state === "absent") {
      w.timer -= dt;
      w.pursuit = Math.max(0, w.pursuit - dt * 0.3);
      if (w.timer > 0) return;
      const sp = this._watchSpot();
      if (!sp) { w.timer = 6 + this.rand() * 8; return; }
      w.spot = sp; w.x = sp.x; w.z = sp.z; w.y = sp.y;
      if (!w.g) { w.g = this._watchMesh(); w.sil = this._silhouette(); }
      w.mode = sp.type === "window" ? "window" : "body";
      w.g.visible = false;
      if (w.mode === "window") { if (w.g.parent) w.g.parent.remove(w.g); if (!w.sil.parent) scene.add(w.sil); w.sil.position.set(sp.x, sp.y, sp.z); w.sil.rotation.y = sp.yaw; }
      else { if (w.sil && w.sil.parent) w.sil.parent.remove(w.sil); if (!w.g.parent) scene.add(w.g); w.g.position.set(w.x, w.y, w.z); }
      w.state = "observe"; w.t = 0; w.seenT = 0; w.awayT = 0; w.dwell = 22 + this.rand() * 40; w.hold = 0;
      w.heading = Math.atan2(P.x - w.x, P.z - w.z);
      this._watchOpacity(w, 0);
      return;
    }
    const dx = P.x - w.x, dz = P.z - w.z, d = Math.hypot(dx, dz) || 0.01;
    w.t += dt;
    const fade = (target, rate) => this._watchOpacity(w, Math.max(0, Math.min(0.92, w.o + Math.sign(target - w.o) * Math.min(Math.abs(target - w.o), rate * dt))));
    // pursuit: running at it, for long enough
    const aimed = -(pv.x * dx + pv.z * dz) / d;                  // +1 when the player is running straight at it
    const pursuing = d < 26 && pv.s > 5.0 && aimed > 0.7;
    w.pursuit = pursuing ? w.pursuit + dt * (pv.s > 7 ? 1.3 : 1) : Math.max(0, w.pursuit - dt * 0.35);
    const a = w.pursuit / w.tol;
    const seen = this.inView(w.x, w.z, -0.1);
    const vanish = (cool) => { w.state = "absent"; w.timer = cool != null ? cool : this._watchTimer(); this._watchOpacity(w, 0); if (w.g && w.g.parent) w.g.parent.remove(w.g); if (w.sil && w.sil.parent) w.sil.parent.remove(w.sil); };
    switch (w.state) {
      case "observe": {
        fade(0.9, 0.7);
        if (w.mode === "body") {
          w.heading = Math.atan2(dx, dz);
          w.g.rotation.y = w.heading;
          // it drifts: very slowly toward you if you are far, otherwise it stands
          if (d > 20 && a < 0.2) { const nx = w.x + dx / d * 0.35 * dt, nz = w.z + dz / d * 0.35 * dt; if (L.isOpen(nx, nz, 0.4, 0.3, 1.9)) { w.x = nx; w.z = nz; } }
          w.g.position.set(w.x, w.y, w.z);
        }
        // approached: it withdraws
        if (d < (w.mode === "window" ? 9 : 13) || a > 0.15) { w.state = "withdraw"; w.t = 0; w.stopT = 0; break; }
        if (seen && d > 10) w.seenT += dt; else w.seenT = Math.max(0, w.seenT - dt);
        if (!seen) w.awayT += dt; else w.awayT = 0;
        // it leaves when you look away for a while, or when it has been stared at too long, or when its time is up
        if (w.t > w.dwell && (!seen || w.seenT > 14)) { w.state = "fadeout"; }
        else if (w.awayT > 3.5 && this.rand() < dt * 0.25) { w.state = "fadeout"; }
        else if (w.seenT > 16) { w.state = "fadeout"; }
        break;
      }
      case "withdraw": {
        if (w.mode === "window") { w.state = "fadeout"; break; }
        const closing = aimed > 0.5;
        let speed = closing ? Math.max(1.9, Math.min(7.4, pv.s * 0.95)) : 1.9;       // it keeps pace with whoever is coming at it
        if (d < 3.5 && a < 0.4) { w.state = "fadeout"; break; }                       // reached without provocation: it is simply gone
        // as it is chased, it stops running and turns to look back; then it stops running at all
        if (a > 0.4 && a < 0.75) { w.stopT = (w.stopT || 0) + dt; if (w.stopT % 5 > 3.4) speed = 0; speed *= 1.1; }
        if (a >= 0.75) speed = 0;
        w.heading = Math.atan2(dx, dz);
        if (speed > 0) {
          const ax = -dx / d, az = -dz / d;
          let moved = false;
          for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
            const c = Math.cos(off), s = Math.sin(off), vx = ax * c - az * s, vz = ax * s + az * c;
            const nx = w.x + vx * speed * dt, nz = w.z + vz * speed * dt;
            if (L.isOpen(nx, nz, 0.4, 0.3, 1.9)) { w.x = nx; w.z = nz; moved = true; break; }
          }
          if (!moved) w.stuck = (w.stuck || 0) + dt; else w.stuck = 0;
        }
        w.g.position.set(w.x, w.y, w.z);
        w.g.rotation.y = w.heading;
        fade(0.9, 1);
        // pushed far enough it stops running, and if you reach it now (or keep it up) it comes for you
        if (a >= 1 || (a >= 0.75 && d < 2.4)) { w.state = "strike"; w.strikeT = 0; w.hit = 0; break; }
        if (d > 24 && a < 0.4) { w.state = "observe"; w.t = 0; w.dwell = 14 + this.rand() * 20; }
        else if (d > 30 || (w.t > 25 && a < 0.2 && !seen)) w.state = "fadeout";
        break;
      }
      case "strike": {                                       // rare: it stops backing away and comes
        w.strikeT += dt;
        w.heading = Math.atan2(dx, dz);
        const sp = d > 3 ? 5.6 : 3.5, nx = w.x + dx / d * sp * dt, nz = w.z + dz / d * sp * dt;
        if (L.isOpen(nx, nz, 0.4, 0.3, 1.9)) { w.x = nx; w.z = nz; } else if (L.isOpen(nx, w.z, 0.4, 0.3, 1.9)) w.x = nx; else if (L.isOpen(w.x, nz, 0.4, 0.3, 1.9)) w.z = nz;
        w.g.position.set(w.x, w.y, w.z);
        w.g.rotation.y = w.heading;
        fade(0.92, 3);
        w.hit -= dt;
        if (d < 1.1 && w.hit <= 0 && Math.abs(P.y) < 1.4) {
          w.hit = 99;
          Player.damagePlayer(38);
          if (Player.addSanity) Player.addSanity(-12);
          if (typeof AudioSystem !== "undefined") AudioSystem.playPositional("impact", w.x, 1, w.z, { gain: 0.6, bus: "entity", max: 40 });
          if (Player.hp <= 0 && typeof HoundSystem !== "undefined") HoundSystem._startDeath();
          w.pursuit = w.tol * 0.2;
          vanish(60 + this.rand() * 60);
          break;
        }
        if (w.strikeT > 9 || d > 34) { w.pursuit = w.tol * 0.25; w.state = "fadeout"; }
        break;
      }
      case "fadeout": {
        fade(0, 0.9);
        if (w.o <= 0.02) vanish();
        break;
      }
    }
  }
};
