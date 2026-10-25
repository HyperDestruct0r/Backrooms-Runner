"use strict";

const SmilerDeath = {
  active: false,
  t: 0,
  start() {
    if (this.active || GameState.phase !== "playing") return;
    this.active = true;
    this.t = 0;
    GameState.cutscene = true;
    setPauseOverlay(false);
    if (document.pointerLockElement) document.exitPointerLock();
    const line = document.getElementById("smiler-death-line");
    if (line) { line.style.display = "flex"; line.style.opacity = "0"; }
  },
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const distort = Math.min(1, this.t / 2.6);
    SmilerCorruption.set(distort, 3 + distort * 4);
    const el = document.getElementById("smiler-corruption");
    if (el) {
      el.style.backgroundColor = `rgba(0,0,0,${Math.max(0, (this.t - 2.2) / 1.4).toFixed(3)})`;
    }
    const line = document.getElementById("smiler-death-line");
    if (line && this.t > 3.6) {
      line.style.opacity = Math.min(1, (this.t - 3.6) / 1.1).toFixed(3);
    }
    if (this.t >= 5.4) {
      this.active = false;
      GameState.cutscene = false;
      if (line) line.style.display = "none";
      SmilerCorruption.reset();
      Game.gameOver();
    }
  }
};

const SmilerCorruption = {
  intensity:0,
  el:null,
  reset(){
    this.intensity=0;
    if(!this.el) this.el=document.getElementById("smiler-corruption");
    if(this.el){ this.el.style.opacity="0"; this.el.style.filter="none"; }
  },
  set(v){
    if(!this.el) this.el=document.getElementById("smiler-corruption");
    this.intensity=Math.max(0,Math.min(1,v));
    if(this.el){
      const count = arguments[1] || 1;
      const jitter=(Math.random()*2-1)*this.intensity*(3+count*2);
      this.el.style.opacity=Math.min(0.85, this.intensity*(0.28+count*0.16)).toFixed(3);
      this.el.style.transform=`translate(${jitter.toFixed(1)}px,${(-jitter*0.35).toFixed(1)}px)`;
      this.el.style.filter=`contrast(${1+this.intensity*0.7}) saturate(${1+this.intensity*(1.1+count*0.35)}) hue-rotate(${(this.intensity*count*8).toFixed(1)}deg)`;
      this.el.style.setProperty("--glitch-shift",(this.intensity*(4+count*3)).toFixed(1)+"px");
    }
  }
};

/* SmilerSystem is level-agnostic. A level calls attach(opts) with its own live
   collider array and rules, and calls update(dt) while it is the active level.
   Nothing in here reads which level is running.

   attach(opts)
     colliders      live collider array. Read every frame, never copied.
     cap            max active Smilers.
     graceSeconds   nothing spawns for this long after attach.
     minDist/maxDist  spawn distance band from the player (default 15 / 32).
     seed           deterministic placement.
     allow()        owned by the level. False means: do not spawn, and non-forced
                    Smilers retreat and despawn after 1.5 s. Forced ones stay.
     isDark(x, z)   optional. A candidate is refused when it returns false.
   Optional, for levels that need them (defaults match the old Level 1 numbers):
     margin         clearance from walls, default 0.9. The face is 1.7 m wide.
     interval       [min, max] seconds between spawn tries, default [6, 9].
     firstDelay     seconds from allow() turning true to the first try. Default:
                    one interval. Level 1 passes 1.5 and [1.8, 2.2] to keep its pace.

   Colliders. A collider blocks a Smiler when max.y > 0.6 and min.y < 0.7, so a
   ceiling slab is not a wall. Floors are colliders whose top is at about y = 0; if
   the list has any, a spawn point must be over one, so nothing appears in the void
   outside a level. */
const SmilerSystem = {
  list: [],
  group: null,
  attached: false,
  opts: null,
  t: 0,
  spawnT: 0,
  armed: false,
  _rand: null,
  damageAcc: 0,
  sanityPulseAcc: 0,

  attach(opts) {
    this.reset();
    const o = opts || {};
    this.opts = {
      colliders: o.colliders || [],
      cap: o.cap == null ? 2 : o.cap,
      graceSeconds: o.graceSeconds || 0,
      minDist: o.minDist == null ? 15 : o.minDist,
      maxDist: o.maxDist == null ? 32 : o.maxDist,
      allow: typeof o.allow === "function" ? o.allow : null,
      isDark: typeof o.isDark === "function" ? o.isDark : null,
      margin: o.margin == null ? 0.9 : o.margin,
      interval: o.interval || [6, 9],
      firstDelay: o.firstDelay == null ? null : o.firstDelay
    };
    let a = ((o.seed == null ? 1 : o.seed) ^ 0x7F4A7C15) >>> 0 || 1;
    this._rand = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
    this.t = 0;
    this.armed = false;
    this.spawnT = 0;
    this.attached = true;
  },

  detach() {
    this.reset();
    this.attached = false;
    this.opts = null;
  },

  // Removes every Smiler. Stays attached and does not restart the grace.
  reset() {
    for (const s of this.list) this._dispose(s);
    if (this.group && typeof scene !== "undefined" && scene) scene.remove(this.group);
    this.group = null;
    this.list = [];
    this.armed = false;
    this.spawnT = 0;
    this.damageAcc = 0;
    this.sanityPulseAcc = 0;
    if (typeof SmilerCorruption !== "undefined") SmilerCorruption.reset();
  },

  count() {
    let n = 0;
    for (const s of this.list) if (s.active) n++;
    return n;
  },

  // Remove up to `count` active Smilers, most recent first. Returns how many went.
  despawn(count) {
    const active = this.list.filter(s => s.active);
    const n = Math.min(active.length, Math.max(1, (count == null ? 1 : count) | 0));
    for (let i = 0; i < n; i++) this.deactivate(active[active.length - 1 - i]);
    return n;
  },

  // Spawn at a point. Returns the Smiler or null. `forced` ignores the view cone,
  // grace, distances, isDark, cap, and spacing. It still needs open space.
  spawnAt(x, z, forced) {
    if (!this.attached || !this.opts) return null;
    if (!this._valid(x, z, !!forced)) return null;
    const s = this.makeSmiler({ x, z });
    s.forced = !!forced;
    return s;
  },

  applyCorruption() {
    let nearest = 999, count = 0;
    for (const s of this.list) {
      if (!s.active || !s.visibleToPlayer) continue;
      count++;
      nearest = Math.min(nearest, Math.hypot(s.x - Player.position.x, s.z - Player.position.z));
    }
    const near = nearest < 999 ? Math.max(0, 1 - nearest / 22) : 0;
    SmilerCorruption.set(count ? Math.min(1, near * (0.55 + count * 0.22)) : 0, count);
  },
  activeCount() {
    let n = 0;
    for (const s of this.list) if (s.active && s.visibleToPlayer) n++;
    return n;
  },

  _between(a, b) { return a + (this._rand ? this._rand() : Math.random()) * (b - a); },

  ensureGroup() {
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = "Smilers";
      if (scene) scene.add(this.group);
    }
  },

  makeSmiler(pos) {
    this.ensureGroup();
    const g = new THREE.Group();
    g.position.set(pos.x, 0.15, pos.z);

    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = "#050208";
    ctx.beginPath(); ctx.ellipse(128, 128, 108, 92, 0, 0, Math.PI * 2); ctx.fill();
    const eye = (x, color, glow) => {
      const grd = ctx.createRadialGradient(x, 78, 2, x, 78, 28);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.35, color);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(x, 78, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, 78, 10, 0, Math.PI * 2); ctx.fill();
    };
    eye(92, "#7ec8ff", "#d8f4ff");
    eye(164, "#ffb15a", "#ffe7c2");
    const teeth = ["#ff4d6a","#ff8a3d","#ffd24a","#b6e34a","#4ad4ff","#8a7cff","#ff6ad5"];
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const x = 58 + t * 140;
      const y = 148 + Math.sin(t * Math.PI) * 28;
      ctx.fillStyle = teeth[i % teeth.length];
      ctx.fillRect(x - 4, y, 8, 18 + (i % 3) * 3);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), faceMat);
    face.position.set(0, 1.4, 0.2);

    const glow = new THREE.PointLight(0xffc48a, 1.4, 9, 1.6);
    glow.position.set(0, 1.45, 0.4);

    g.add(face, glow);
    this.group.add(g);
    const s={
      active:true, mesh:g, x:pos.x, z:pos.z,
      visibleToPlayer:false, repathT:0, retreatT:0,
      exposureT:0, speed:8.8, radius:0.72
    };
    this.list.push(s);
    return s;
  },

  /* ------------------------------------------------------------------
     SIGHT AND SPACE
     ------------------------------------------------------------------ */
  // Does a straight line between two points clear everything at face height?
  _sight(x0, z0, x1, z1) {
    const cs = this.opts.colliders;
    const dx = x1 - x0, dz = z1 - z0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!(c.max.y > 0.6 && c.min.y < 1.5)) continue;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 < c.min.x || x0 > c.max.x) continue; }
      else {
        let a = (c.min.x - x0) / dx, b = (c.max.x - x0) / dx;
        if (a > b) { const q = a; a = b; b = q; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (z0 < c.min.z || z0 > c.max.z) continue; }
      else {
        let a = (c.min.z - z0) / dz, b = (c.max.z - z0) / dz;
        if (a > b) { const q = a; a = b; b = q; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      return false;
    }
    return true;
  },

  lineOfSight(s) {
    if (!s.active || !this.opts) return false;
    const d = Math.hypot(Player.position.x - s.x, Player.position.z - s.z);
    if (d > 42) return false;
    return this._sight(s.x, s.z, Player.position.x, Player.position.z);
  },

  flashlightHits(s) {
    if (!Flashlight.enabled) return false;
    const dx=s.x-Player.position.x, dz=s.z-Player.position.z;
    const d=Math.hypot(dx,dz);
    if(d>CONFIG.flashlight.distance+1 || d<0.2) return false;
    const fx=-Math.sin(Player.yaw), fz=-Math.cos(Player.yaw);
    const dot=(fx*dx+fz*dz)/d;
    if(dot < Math.cos(CONFIG.flashlight.angle*0.72)) return false;
    return this.lineOfSight(s);
  },

  _dispose(s) {
    if (!s || !s.mesh || s.disposed) return;
    s.disposed = true;
    s.mesh.traverse(o => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material) {
        if (o.material.map && o.material.map.dispose) o.material.map.dispose();
        if (o.material.dispose) o.material.dispose();
      }
    });
  },

  deactivate(s) {
    s.active=false;
    if(s.mesh && this.group) this.group.remove(s.mesh);
    this._dispose(s);
  },

  _isFloor(c) { return c.max.y <= 0.1 && c.max.y >= -0.05 && c.min.y < 0; },

  // Not inside a wall-height collider, with clearance for a 1.7 m wide face.
  isOpen(x, z) {
    if (!this.opts) return false;
    const m = this.opts.margin, cs = this.opts.colliders;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!(c.max.y > 0.6 && c.min.y < 0.7)) continue;
      if (x >= c.min.x - m && x <= c.max.x + m && z >= c.min.z - m && z <= c.max.z + m) return false;
    }
    return true;
  },

  // If the level has floor colliders, the point must be over one.
  _onFloor(x, z) {
    const cs = this.opts.colliders;
    let any = false;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!this._isFloor(c)) continue;
      any = true;
      if (x > c.min.x && x < c.max.x && z > c.min.z && z < c.max.z) return true;
    }
    return !any;
  },

  _allowed() { return !this.opts.allow || !!this.opts.allow(); },

  _viewHalf() {
    const cam = (typeof CameraRig !== "undefined") ? CameraRig.camera : null;
    if (!cam || !cam.fov || !cam.aspect) return 0.6;
    const half = Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) + 0.12;
    return Math.max(0.6, Math.min(1.45, half));
  },

  _valid(x, z, forced) {
    const o = this.opts, P = Player.position;
    if (!this.isOpen(x, z) || !this._onFloor(x, z)) return false;
    if (forced) {
      for (const s of this.list) if (s.active && Math.hypot(s.x - x, s.z - z) < 1) return false;
      return true;
    }
    if (!this._allowed()) return false;
    if (this.count() >= o.cap) return false;
    if (this.t < o.graceSeconds) return false;
    const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
    if (d < 0.01 || d < o.minDist || d > o.maxDist) return false;
    // never inside the view cone (same test as the Hound), nor anywhere in the
    // real horizontal field of view that the player has a clear line to
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    const dot = (dx * fx + dz * fz) / d;
    if (dot > Math.cos(0.6)) return false;
    if (dot > Math.cos(this._viewHalf()) && this._sight(P.x, P.z, x, z)) return false;
    for (const s of this.list) if (s.active && Math.hypot(s.x - x, s.z - z) < 7) return false;
    if (o.isDark && !o.isDark(x, z)) return false;
    return true;
  },

  spawnOne() {
    if (!this.opts || !this._allowed()) return false;
    const o = this.opts, P = Player.position, r = () => this._rand();
    if (this.count() >= o.cap || this.t < o.graceSeconds) return false;
    const place = (px, pz) => { const s = this.makeSmiler({ x: px, z: pz }); s.forced = false; return true; };

    // Random candidates around the player, biased toward minDist..maxDist so a
    // Smiler appears close enough to threaten but not on top of the player.
    for (let k = 0; k < 80; k++) {
      const a = r() * Math.PI * 2;
      const dd = o.minDist + r() * (o.maxDist - o.minDist);
      const px = P.x + Math.cos(a) * dd, pz = P.z + Math.sin(a) * dd;
      if (this._valid(px, pz, false)) return place(px, pz);
    }
    // Deterministic rings, for dense sections.
    for (let radius = o.minDist; radius <= o.maxDist; radius += 4) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const px = P.x + Math.cos(a) * radius, pz = P.z + Math.sin(a) * radius;
        if (this._valid(px, pz, false)) return place(px, pz);
      }
    }
    // Narrow levels: random annuli rarely land on a corridor, so sample the floors.
    const floors = o.colliders.filter(c => this._isFloor(c));
    if (floors.length) {
      for (let k = 0; k < 120; k++) {
        const c = floors[Math.floor(r() * floors.length)];
        const px = c.min.x + r() * (c.max.x - c.min.x), pz = c.min.z + r() * (c.max.z - c.min.z);
        if (this._valid(px, pz, false)) return place(px, pz);
      }
    }
    return false;
  },

  update(dt) {
    if (!this.attached || !this.opts) return;
    const o = this.opts;
    this.t += dt;

    if (!this._allowed()) {
      // Not allowed (Level 1: the lights are back). Non-forced Smilers retreat and go.
      if(this.list.length) {
        for(const s of this.list) {
          if(!s.active || s.forced) continue;
          s.retreatT += dt;
          if(s.retreatT >= 1.5) this.deactivate(s);
        }
        this.list=this.list.filter(s => s.active);
      }
      this.spawnT=0;
      this.armed=false;
      for (const s of this.list) {
        if (!s.active) continue;
        s.visibleToPlayer = this.lineOfSight(s);
        s.mesh.visible = true;
        s.mesh.lookAt(Player.position.x, Player.position.y + 1.25, Player.position.z);
        if (!s.forced) continue;
        const dx = Player.position.x - s.x, dz = Player.position.z - s.z;
        const d = Math.hypot(dx, dz);
        if (this.flashlightHits(s)) {
          s.exposureT += dt;
          const fade = Math.max(0, 1 - s.exposureT / CONFIG.flashlight.smilerExposureTime);
          s.mesh.traverse(o => { if (o.material && o.material.transparent) o.material.opacity = fade; });
          s.x += (-dx / (d || 1)) * 12.5 * dt;
          s.z += (-dz / (d || 1)) * 12.5 * dt;
          s.mesh.position.set(s.x, 0.15, s.z);
          if (s.exposureT >= CONFIG.flashlight.smilerExposureTime) this.deactivate(s);
        } else {
          s.exposureT = 0;
          s.mesh.traverse(o => { if (o.material && o.material.transparent) o.material.opacity = 1; });
        }
      }
      this.applyCorruption();
      return;
    }

    // Allowed. Arm the spawn schedule once per allowed stretch.
    if(!this.armed){
      this.armed=true;
      this.spawnT = o.firstDelay != null ? o.firstDelay : this._between(o.interval[0], o.interval[1]);
    }
    if (this.t >= o.graceSeconds) {
      this.spawnT-=dt;
      if(this.spawnT<=0) {
        this.spawnT = this._between(o.interval[0], o.interval[1]);
        this.spawnOne();
      }
    }

    let visibleCount=0;
    for(const s of this.list){
      if(!s.active) continue;
      const dx=Player.position.x-s.x, dz=Player.position.z-s.z;
      const d=Math.hypot(dx,dz);
      s.visibleToPlayer=this.lineOfSight(s);

      const flashlight=this.flashlightHits(s);
      if(flashlight){
        // Continuous exposure is required. The flashlight immediately
        // suppresses all Smiler effects, drives it backward, and after
        // ~1.8s of uninterrupted exposure the Smiler fades away.
        s.exposureT += dt;
        const fade=Math.max(0,1-s.exposureT/CONFIG.flashlight.smilerExposureTime);
        s.mesh.visible=true;
        s.mesh.traverse(o=>{ if(o.material && o.material.transparent) o.material.opacity=fade; });
        const awayX=-dx/(d||1), awayZ=-dz/(d||1);
        s.x += awayX*12.5*dt;
        s.z += awayZ*12.5*dt;
        s.mesh.position.set(s.x,0.15,s.z);
        s.mesh.lookAt(Player.position.x,Player.position.y+1.25,Player.position.z);
        if(s.exposureT>=CONFIG.flashlight.smilerExposureTime) this.deactivate(s);
        continue;
      }
      s.exposureT=0;
      s.mesh.traverse(o=>{ if(o.material && o.material.transparent) o.material.opacity=1; });

      if(s.visibleToPlayer){
        visibleCount++;
        // Quickly close distance, then orbit/hover around the 5m mark.
        const desired=Math.max(4.2,Math.min(5.0,d));
        if(d>desired){
          s.x += dx/(d||1)*s.speed*dt;
          s.z += dz/(d||1)*s.speed*dt;
        } else if(d<4.0){
          s.x -= dx/(d||1)*2.5*dt;
          s.z -= dz/(d||1)*2.5*dt;
        }
        // Keep the smiler on open floor.
        if(!this.isOpen(s.x,s.z)){
          s.x-=dx/(d||1)*2.0*dt; s.z-=dz/(d||1)*2.0*dt;
        }
        s.mesh.position.set(s.x,0.15,s.z);
        s.mesh.lookAt(Player.position.x,Player.position.y+1.25,Player.position.z);
        s.mesh.visible=true;
      } else {
        // Keep the entity rendered in the world, but face it toward the player
        // so its emissive face is unmistakable when it enters view.
        s.mesh.visible=true;
        s.mesh.lookAt(Player.position.x,Player.position.y+1.25,Player.position.z);
      }
    }
    this.list=this.list.filter(s => s.active);

    // Screen corruption scales with how many smilers can see you,
    // and how close the nearest one is.
    this.applyCorruption();

    this.damageAcc += visibleCount * 2 * dt;
    while(this.damageAcc>=1){
      this.damageAcc-=1;
      if(visibleCount>0) Player.damagePlayer(1);
    }
    // another death sequence already running (a Hound's, say) owns the screen
    if(Player.getPlayerHP()<=0 && !GameState.cutscene) SmilerDeath.start();
  }
};
