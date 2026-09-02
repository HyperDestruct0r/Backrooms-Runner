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
  maxActive: 4,
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

    const faceMat = new THREE.MeshBasicMaterial({color:0x030006,transparent:true,opacity:1.0,toneMapped:false});
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.82, 20, 14), faceMat);
    face.scale.set(1.0,0.72,0.28);
    face.position.y=1.35;

    const eyeMat = new THREE.MeshBasicMaterial({
      color:0xffffff, transparent:true, opacity:1.0, toneMapped:false
    });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.125, 10, 8), eyeMat);
    eyeL.position.set(-0.27,1.52,-0.28);
    eyeR.position.set(0.27,1.52,-0.28);

    const mouthCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.40,1.20,-0.30),
      new THREE.Vector3(0,0.91,-0.36),
      new THREE.Vector3(0.40,1.20,-0.30)
    );
    const mouthGeo = new THREE.TubeGeometry(mouthCurve, 14, 0.045, 6, false);
    const mouth = new THREE.Mesh(mouthGeo, eyeMat);

    g.add(face,eyeL,eyeR,mouth);
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
    if (!Level1.active || Level1.blackoutState!=='outage') return;
    if (this.list.filter(s=>s.active).length >= this.maxActive) return;
    const ang=Math.random()*Math.PI*2;
    const d=12+Math.random()*18;
    const x=Player.position.x+Math.cos(ang)*d;
    const z=Player.position.z+Math.sin(ang)*d;
    // Search nearby points until we find open floor with line-of-sight.
    for(let k=0;k<18;k++){
      const a=Math.random()*Math.PI*2, dd=10+Math.random()*20;
      const px=Player.position.x+Math.cos(a)*dd, pz=Player.position.z+Math.sin(a)*dd;
      if(this.isOpen(px,pz)){
        this.makeSmiler({x:px,z:pz});
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
    if(Level1.blackoutState!=='outage') {
      if(this.list.length) {
        for(const s of this.list) this.deactivate(s);
        this.list=[];
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
      this.spawnTimer=2.0+Math.random()*2.0;
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

