"use strict";

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
      const jitter=(Math.random()*2-1)*this.intensity*4;
      this.el.style.opacity=(this.intensity*0.62).toFixed(3);
      this.el.style.transform=`translate(${jitter.toFixed(1)}px,${(-jitter*0.4).toFixed(1)}px)`;
      this.el.style.filter=`contrast(${1+this.intensity*0.8}) saturate(${1+this.intensity*1.6})`;
      this.el.style.setProperty("--glitch-shift",(this.intensity*6).toFixed(1)+"px");
    }
  }
};

const SmilerSystem = {
  list: [],
  group: null,
  spawnTimer: 0,
  outageSpawned: false,
  rng: null,
  maxActive: 10,
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
  
    // Almost-black face silhouette.
    const faceMat = new THREE.MeshBasicMaterial({
      color: 0x010002,
      transparent: true,
      opacity: 0.92,
      toneMapped: false
    });
  
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(0.68, 18, 12),
      faceMat
    );
  
    face.scale.set(1.0, 0.70, 0.22);
    face.position.y = 1.28;
  
    // Extremely bright white glowing eyes/smile.
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      toneMapped: false
    });
  
    const eyeL = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 12, 8),
      glowMat
    );
  
    const eyeR = new THREE.Mesh(
      new THREE.SphereGeometry(0.105, 12, 8),
      glowMat
    );
  
    eyeL.position.set(-0.23, 1.44, -0.25);
    eyeR.position.set(0.23, 1.44, -0.25);
  
    // The iconic glowing smile.
    const mouthCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.34, 1.16, -0.27),
      new THREE.Vector3(0, 0.88, -0.33),
      new THREE.Vector3(0.34, 1.16, -0.27)
    );
  
    const mouthGeo = new THREE.TubeGeometry(
      mouthCurve,
      18,
      0.055,
      8,
      false
    );
  
    const mouth = new THREE.Mesh(mouthGeo, glowMat);
  
    g.add(face, eyeL, eyeR, mouth);
  
    // Small light around the Smiler so the face reads as glowing
    // even when the environment is completely black.
    const glow = new THREE.PointLight(
      0xffffff,
      1.6,
      9.0,
      2.0
    );
  
    glow.position.set(0, 1.2, -0.25);
  
    g.add(glow);
  
    this.group.add(g);
  
    const s = {
      active: true,
      mesh: g,
      x: pos.x,
      z: pos.z,
  
      visibleToPlayer: false,
      repathT: 0,
      retreatT: 0,
  
      exposureT: 0,
      speed: 8.8,
      radius: 0.72
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
      
        // Give Smilers a brief moment to remain in the world after
        // the lights return instead of making them vanish instantly.
        if(this.list.length) {
          for(const s of this.list) {
            if(!s.active) continue;
      
            s.retreatT += dt;
      
            // Smilers disappear shortly after the lights return.
            if(s.retreatT >= 1.5) {
              this.deactivate(s);
            }
          }
      
          this.list=this.list.filter(s => s.active);
        }
      
        this.spawnTimer=0;
        this.outageSpawned=false;
      
        return;
    }

    // Ensure the blackout actually has a Smiler presence: one is attempted
    // shortly after the outage starts, then more arrive every 2–4 seconds.
    if(!this.outageSpawned){
      this.outageSpawned=true;
      this.spawnTimer=0.8;
    }
    this.spawnTimer-=dt;
    if(this.spawnTimer<=0) {
      // Smilers arrive frequently during the blackout.
      this.spawnTimer=1.0+Math.random()*1.25;
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

    // Screen corruption increases when a smiler is visible and nearby.
    let nearest=999;
    for(const s of this.list) if(s.active && s.visibleToPlayer)
      nearest=Math.min(nearest,Math.hypot(s.x-Player.position.x,s.z-Player.position.z));
    SmilerCorruption.set(nearest<999 ? Math.max(0,1-nearest/22) : 0);

    this.damageAcc += visibleCount * 2 * dt;
    while(this.damageAcc>=1){
      this.damageAcc-=1;
      if(visibleCount>0) Player.damagePlayer(1);
    }
    if(Player.getPlayerHP()<=0) Game.gameOver();
  }
};

