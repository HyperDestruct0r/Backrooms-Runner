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

const SmilerSystem = {
  list: [],
  group: null,
  spawnTimer: 0,
  outageSpawned: false,
  rng: null,
  // Keep blackout encounters threatening without flooding the player.
  maxActive: 7,
  damageAcc: 0,
  sanityPulseAcc: 0,

  reset() {
    if (this.group && scene) scene.remove(this.group);
    this.group = null;
    this.list = [];
    this.spawnTimer = 0;
    this.outageSpawned = false;
    this.damageAcc = 0;
    this.sanityPulseAcc = 0;
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

  _rng() {
    if (!this.rng) this.rng = Level1.rngFor(Math.floor(Level1.levelTime), 0, 911);
    return this.rng();
  },

  ensureGroup() {
    if (!this.group) {
      this.group = new THREE.Group();
      this.group.name = "Level1_Smilers";
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

  lineOfSight(s) {
    if (!s.active) return false;
    const dx=Player.position.x-s.x, dz=Player.position.z-s.z;
    const d=Math.hypot(dx,dz);
    if (d>42) return false;
    // Horizontal sight check against Level 1 wall/pillar AABBs.
    for(const c of Level1.colliders){
      if(c.max.y <= 0.6) continue;
      const minX=Math.min(s.x,Player.position.x), maxX=Math.max(s.x,Player.position.x);
      const minZ=Math.min(s.z,Player.position.z), maxZ=Math.max(s.z,Player.position.z);
      if(c.max.x < minX || c.min.x > maxX || c.max.z < minZ || c.min.z > maxZ) continue;
      const steps=Math.max(4,Math.ceil(d/1.0));
      for(let i=1;i<steps;i++){
        const t=i/steps, x=s.x+dx*t, z=s.z+dz*t;
        if(x>=c.min.x && x<=c.max.x && z>=c.min.z && z<=c.max.z) return false;
      }
    }
    return true;
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

  deactivate(s) {
    s.active=false;
    if(s.mesh && this.group) this.group.remove(s.mesh);
  },

  spawnOne() {
  if (!Level1.active || Level1.blackoutState !== 'outage') return;

  if (this.list.filter(s => s.active).length >= this.maxActive) return;

  // Search a large number of candidate positions around the player.
  // The new Level 1 maze has much denser wall coverage, so 18 random
  // attempts can occasionally miss every open corridor.
  //
  // Candidates are biased toward 15–32m away so Smilers appear nearby
  // enough to be threatening, but not directly on top of the player.
  for (let k = 0; k < 80; k++) {
    const a = Math.random() * Math.PI * 2;
    const dd = 15 + Math.random() * 17;

    const px = Player.position.x + Math.cos(a) * dd;
    const pz = Player.position.z + Math.sin(a) * dd;

    if (!this.isOpen(px, pz)) continue;

    // Avoid spawning practically on top of another Smiler.
    let tooClose = false;

    for (const s of this.list) {
      if (!s.active) continue;

      const dx = s.x - px;
      const dz = s.z - pz;

      if (Math.hypot(dx, dz) < 7) {
        tooClose = true;
        break;
      }
    }

    if (tooClose) continue;

    this.makeSmiler({ x: px, z: pz });
    return;
  }

  // If random sampling failed, search outward in a deterministic grid.
  // This makes spawning much more reliable in extremely dense sections.
  for (let radius = 12; radius <= 36; radius += 4) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;

      const px = Player.position.x + Math.cos(a) * radius;
      const pz = Player.position.z + Math.sin(a) * radius;

      if (!this.isOpen(px, pz)) continue;

      let tooClose = false;

      for (const s of this.list) {
        if (!s.active) continue;

        const dx = s.x - px;
        const dz = s.z - pz;

        if (Math.hypot(dx, dz) < 7) {
          tooClose = true;
          break;
        }
      }

      if (tooClose) continue;

      this.makeSmiler({ x: px, z: pz });
      return;
    }
  }
},

  isOpen(x,z) {
    for(const c of Level1.colliders){
      if(c.max.y<=0.6) continue;
      if(x>=c.min.x-0.9 && x<=c.max.x+0.9 && z>=c.min.z-0.9 && z<=c.max.z+0.9) return false;
    }
    return true;
  },

  update(dt) {
    if(!Level1.active) { this.reset(); return; }
    if(Level1.blackoutState !== 'outage') {
      if(this.list.length) {
        for(const s of this.list) {
          if(!s.active || s.forced) continue;
          s.retreatT += dt;
          if(s.retreatT >= 1.5) this.deactivate(s);
        }
        this.list=this.list.filter(s => s.active);
      }
      this.spawnTimer=0;
      this.outageSpawned=false;
      for (const s of this.list) {
        if (!s.active) continue;
        s.visibleToPlayer = this.lineOfSight(s);
        s.mesh.visible = true;
        s.mesh.lookAt(Player.position.x, Player.position.y + 1.25, Player.position.z);
      }
      this.applyCorruption();
      return;
    }

    // Ensure the blackout has a Smiler presence without flooding the player.
    if(!this.outageSpawned){
      this.outageSpawned=true;
      this.spawnTimer=1.5;
    }
    this.spawnTimer-=dt;
    if(this.spawnTimer<=0) {
      // Roughly 5–7 spawn attempts per 10 seconds, with a hard cap of 7 active.
      this.spawnTimer=1.8+Math.random()*0.4;
      this.spawnOne();
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

    // Screen corruption scales with how many smilers can see you,
    // and how close the nearest one is.
    this.applyCorruption();

    this.damageAcc += visibleCount * 2 * dt;
    while(this.damageAcc>=1){
      this.damageAcc-=1;
      if(visibleCount>0) Player.damagePlayer(1);
    }
    if(Player.getPlayerHP()<=0) SmilerDeath.start();
  }
};

