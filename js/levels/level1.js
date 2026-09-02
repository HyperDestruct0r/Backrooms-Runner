"use strict";

const Level1 = {
  active:false, group:null, colliders:[], triggers:[],
  macroSize:600, microSize:60, activeRadius:2, seed:0,
  chunks:new Map(), center:new THREE.Vector3(), start:new THREE.Vector3(),
  baseY:0, lights:[], ambientLights:[], puddles:[], resourceRegions:Object.create(null),
  streamTimer:0, lastMCX:999999, lastMCZ:999999,
  levelTime:0, blackoutState:'idle', blackoutTimer:0, blackoutNext:60,
  blackoutCooldown:0, blackoutDuration:0, blackoutCycle:0,
  blackoutFlickerT:0, blackoutFlickerNext:0, blackoutWindowStart:0,
  shared:{}, macroCache:new Map(), exitMacro:null, exitPosition:null,
  resetVisuals(){
    if(this.group && scene) scene.remove(this.group);
    for(const L of this.lights){ if(L.parent) L.parent.remove(L); else if(scene) scene.remove(L); }
    for(const L of this.ambientLights){ if(L.parent) L.parent.remove(L); else if(scene) scene.remove(L); }
    this.chunks.clear(); this.colliders.length=0; this.triggers.length=0;
    this.lights.length=0; this.ambientLights.length=0; this.puddles.length=0;
    if(typeof PickupSystem!=='undefined' && PickupSystem.group){ PickupSystem.reset(); }
    this.group=null; this.active=false; this.lastMCX=999999; this.lastMCZ=999999; this.resourceRegions=Object.create(null);
    this.levelTime=0; this.blackoutState='idle'; this.blackoutTimer=0; this.blackoutNext=60;
    this.blackoutCooldown=0; this.blackoutDuration=0; this.blackoutCycle=0;
    this.blackoutFlickerT=0; this.blackoutFlickerNext=0; this.blackoutWindowStart=0; this.macroCache.clear(); this.exitMacro=null; this.exitPosition=null;
    if(typeof SmilerSystem!=="undefined") SmilerSystem.reset();
    if(typeof SmilerCorruption!=="undefined") SmilerCorruption.reset();
    if(typeof ExitLocator!=="undefined") ExitLocator.hide();
    if(scene){ scene.fog=null; scene.background && scene.background.setHex(0x202321); }
    if(typeof SmilerCorruption!=="undefined") SmilerCorruption.reset();
    if(CameraRig.camera){ CameraRig.camera.far=CONFIG.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
  },
  hash2(x,z,salt=0){
    let h=(this.seed>>>0)^Math.imul((x|0)+salt,0x45d9f3b)^Math.imul((z|0)-salt,0x27d4eb2d);
    h^=h>>>16; h=Math.imul(h,0x85ebca6b); h^=h>>>13; h=Math.imul(h,0xc2b2ae35); h^=h>>>16;
    return (h>>>0)/4294967296;
  },
  rngFor(cx,cz,salt=0){
    let h=(this.seed>>>0)^Math.imul((cx|0)+salt,0x45d9f3b)^Math.imul((cz|0)-salt,0x27d4eb2d);
    h^=h>>>16; h=Math.imul(h,0x85ebca6b); h^=h>>>13; h=Math.imul(h,0xc2b2ae35); h^=h>>>16;
    let a=(h>>>0)||1;
    return ()=>{ a^=a<<13; a^=a>>>17; a^=a<<5; return (a>>>0)/4294967296; };
  },
  macroKey(mx,mz){ return mx+','+mz; },
  macroRaw(mx,mz){ return this.hash2(mx,mz,17); },
  macroType(mx,mz){
    const key=this.macroKey(mx,mz); if(this.macroCache.has(key)) return this.macroCache.get(key);
    // Parking starts at 60%. Each neighboring macro-region whose own raw roll
    // lands in the parking band lowers this region by 10 percentage points.
    let p=0.60;
    const ns=[[mx-1,mz],[mx+1,mz],[mx,mz-1],[mx,mz+1]];
    let parkingNeighbors=0;
    for(const [nx,nz] of ns) if(this.macroRaw(nx,nz)<0.60) parkingNeighbors++;
    p=Math.max(0.20, p-0.10*parkingNeighbors);
    // The elevator's macro is always maintenance so the player never starts
    // in the middle of a 600m parking expanse.
    if(this.start && Math.floor(this.start.x/this.macroSize)===mx && Math.floor(this.start.z/this.macroSize)===mz) return 'maintenance';
    const type=this.macroRaw(mx,mz)<p?'parking':'maintenance';
    this.macroCache.set(key,type); return type;
  },
  macroBounds(mx,mz){ return {minx:mx*this.macroSize,minz:mz*this.macroSize,maxx:(mx+1)*this.macroSize,maxz:(mz+1)*this.macroSize}; },
  addBox(g,mat,x,y,z,sx,sy,sz){ const m=new THREE.Mesh(Geometries.box,mat); m.position.set(x,y,z); m.scale.set(sx,sy,sz); g.add(m); return m; },
  addWall(g,rec,x,z,sx,sz,h=3.15){
    this.addBox(g,this.shared.concrete,x,this.baseY+h/2,z,sx,h,sz);
    rec.colliders.push({min:new THREE.Vector3(x-sx/2,this.baseY,z-sz/2),max:new THREE.Vector3(x+sx/2,this.baseY+h,z+sz/2)});
  },
  pillar(g,rec,x,z){
    this.addBox(g,this.shared.concretePillar,x,this.baseY+3.6,z,1.12,7.2,1.12);
    rec.colliders.push({min:new THREE.Vector3(x-.56,this.baseY,z-.56),max:new THREE.Vector3(x+.56,this.baseY+7.2,z+.56)});
    this.addBox(g,this.shared.concreteDark,x,this.baseY+0.12,z,1.38,0.24,1.38);
  },
  fixture(g,x,z,bright,rng,rec){
    const panel=new THREE.Mesh(Geometries.lightPanel,this.shared.light);
    panel.scale.set(1.35,1,0.34); panel.position.set(x,this.baseY+6.85,z); g.add(panel);
    const housing=new THREE.Mesh(Geometries.lightHousing,Materials.lightHousing);
    housing.scale.set(1.42,1,0.4); housing.position.set(x,this.baseY+6.80,z); g.add(housing);
    const blackout=this.blackoutState==='flicker'||this.blackoutState==='outage';
    panel.material.emissiveIntensity=blackout?0:2.0*bright;
    rec.fixtures.push({panel,housing,base:bright});
    if(rng()<0.10 && this.lights.length<12){
      const L=new THREE.PointLight(0xf4f7ff,blackout?0:0.92*bright,22,1.65);
      L.position.set(x,this.baseY+6.25,z); scene.add(L); this.lights.push(L); rec.pointLights.push(L);
    }
  },
  pipeRun(g,x,z,lenX,lenZ,rng){
    if(lenX>0) this.addBox(g,this.shared.pipe,x,this.baseY+6.45,z,lenX,0.18,0.18);
    else this.addBox(g,this.shared.pipe,x,this.baseY+6.45,z,0.18,0.18,lenZ);
    if(rng()<0.35){
      const px=x+(lenX>0?lenX*.22:0), pz=z+(lenZ>0?lenZ*.22:0);
      this.addBox(g,this.shared.pipe,px,this.baseY+6.05,pz,0.14,0.70,0.14);
    }
  },
  concreteTexture(repeatX,repeatY){
    const t=TextureFactory.concrete(); t.repeat.set(repeatX,repeatY); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.needsUpdate=true; return t;
  },
  waterTexture(){
    const c=document.createElement('canvas'); c.width=256; c.height=256;
    const ctx=c.getContext('2d'); ctx.fillStyle='#273b3c'; ctx.fillRect(0,0,256,256);
    for(let i=0;i<900;i++){
      const x=Math.random()*256,y=Math.random()*256,r=Math.random()*1.8;
      ctx.fillStyle='rgba(180,205,205,'+(0.03+Math.random()*0.10)+')'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
    for(let r=22;r<128;r+=22){ ctx.strokeStyle='rgba(210,225,225,0.10)'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.arc(128,128,r,0,Math.PI*2); ctx.stroke(); }
    const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
  },
  materialSet(){
    if(this.shared.floor) return;
    const floorMap=this.concreteTexture(6,6);
    const pillarMap=this.concreteTexture(2.2,7.0);
    const ceilMap=this.concreteTexture(5,5);
    this.shared.floor=new THREE.MeshStandardMaterial({map:floorMap,color:0x9a9c9a,roughness:0.44,metalness:0.10});
    this.shared.concrete=new THREE.MeshStandardMaterial({map:floorMap.clone(),color:0x858886,roughness:0.78,metalness:0.02});
    this.shared.concretePillar=new THREE.MeshStandardMaterial({map:pillarMap,color:0x929593,roughness:0.82,metalness:0.02});
    this.shared.concreteDark=new THREE.MeshStandardMaterial({map:pillarMap.clone(),color:0x676a68,roughness:0.90,metalness:0.01});
    this.shared.concreteLight=new THREE.MeshStandardMaterial({map:ceilMap,color:0xa5a8a5,roughness:0.76,metalness:0.02});
    this.shared.beam=new THREE.MeshStandardMaterial({map:pillarMap.clone(),color:0x5e6260,roughness:0.84,metalness:0.04});
    this.shared.metal=new THREE.MeshStandardMaterial({color:0x6f7471,roughness:0.42,metalness:0.72});
    this.shared.light=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xf5f8ff,emissiveIntensity:2.35,roughness:0.34});
    this.shared.pipe=new THREE.MeshStandardMaterial({color:0x777b78,roughness:0.62,metalness:0.5});
    this.shared.water=new THREE.MeshPhysicalMaterial({map:this.waterTexture(),color:0x496668,transparent:true,opacity:0.78,roughness:0.08,metalness:0.12,clearcoat:0.75,clearcoatRoughness:0.08,side:THREE.DoubleSide});
    this.shared.water.needsUpdate=true;
  },
  addPuddle(g,wx,wz,rng){
    const r=0.46+rng()*0.08;
    const geo=new THREE.CircleGeometry(r,24);
    const mesh=new THREE.Mesh(geo,this.shared.water);
    mesh.rotation.x=-Math.PI/2; mesh.position.set(wx,this.baseY+0.012,wz); g.add(mesh);
    this.puddles.push({x:wx,z:wz,r:r*0.92});
  },
  generatePuddles(g,rec,bx,bz,S,rng,openMask){
    // Eight independent 15m x 15m tile attempts per streamed section.
    // Each attempt has a 3% chance, and a successful puddle must land on
    // genuinely open floor. This keeps puddles sparse even in huge lots.
    for(let attempt=0;attempt<8;attempt++){
      if(rng()>=0.03) continue;
      const cells=S/15;
      const tx=Math.floor(rng()*cells), tz=Math.floor(rng()*cells);
      const x=bx+tx*15+7.5, z=bz+tz*15+7.5;
      if(openMask && !openMask(x,z)) continue;
      if(this.puddles.some(p=>(p.x-x)*(p.x-x)+(p.z-z)*(p.z-z)<1.4)) continue;
      this.addPuddle(g,x+(rng()-.5)*5,z+(rng()-.5)*5,rng);
    }
  },
  getMaintenanceWalls(mx,mz){
    const key=this.macroKey(mx,mz)+':walls';
    if(this.macroCache.has(key)) return this.macroCache.get(key);
    const mb=this.macroBounds(mx,mz), sector=150, cell=5.5, n=27, walls=[];
    const rng=this.rngFor(mx,mz,707);
    const push=(x,z,sx,sz,h=4.70)=>walls.push({x,z,sx,sz,h});

    // Maintenance areas are deliberately tight: a dense Level-0-like cellular maze
    // with 5.5m cells, very heavy concrete walls, few loops, and almost no
    // deliberately widened/open sections. The result should feel like a
    // massive enclosed service maze rather than an open parking garage.
    for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++){
      const x0=mb.minx+sx*sector, z0=mb.minz+sy*sector;
      const visited=Array.from({length:n},()=>new Uint8Array(n));
      const openH=Array.from({length:n},()=>new Uint8Array(n-1));
      const openV=Array.from({length:n-1},()=>new Uint8Array(n));
      const stack=[[Math.floor(rng()*n),Math.floor(rng()*n)]];
      visited[stack[0][1]][stack[0][0]]=1;
      while(stack.length){
        const [cx,cz]=stack[stack.length-1], dirs=[];
        for(const d of [0,1,2,3]){
          const nx=cx+DIR4[d].x,nz=cz+DIR4[d].z;
          if(nx>=0&&nz>=0&&nx<n&&nz<n&&!visited[nz][nx]) dirs.push(d);
        }
        if(!dirs.length){stack.pop();continue;}
        const d=dirs[Math.floor(rng()*dirs.length)],nx=cx+DIR4[d].x,nz=cz+DIR4[d].z;
        if(d===1)openH[cz][cx]=1; if(d===3)openH[cz][nx]=1;
        if(d===2)openV[cz][cx]=1; if(d===0)openV[nz][cx]=1;
        visited[nz][nx]=1; stack.push([nx,nz]);
      }
      // Very few loops: keep the maintenance maze tight and directional.
      // The spanning-tree pass above guarantees connectivity without making
      // the area feel like an open grid.
      for(let z=0;z<n;z++) for(let x=0;x<n-1;x++) if(!openH[z][x] && rng()<0.025) openH[z][x]=1;
      for(let z=0;z<n-1;z++) for(let x=0;x<n;x++) if(!openV[z][x] && rng()<0.025) openV[z][x]=1;

      // Do not add the previous large open-room cuts. A handful of natural
      // three/four-way junctions from the maze are enough.
      const WT=2.40;
      for(let z=0;z<n;z++) for(let x=0;x<n-1;x++) if(!openH[z][x])
        push(x0+(x+1)*cell,z0+(z+.5)*cell,WT,cell+0.18);
      for(let z=0;z<n-1;z++) for(let x=0;x<n;x++) if(!openV[z][x])
        push(x0+(x+.5)*cell,z0+(z+1)*cell,cell+0.18,WT);
    }

    // The maze walls themselves provide the architecture. Avoid random thin
    // divider walls because they would create stray open pockets and visual
    // clutter unrelated to the main maintenance network.
    this.macroCache.set(key,walls); return walls;
  },
  addClippedWall(g,rec,wall,bx,bz,S){
    const minX=Math.max(wall.x-wall.sx/2,bx), maxX=Math.min(wall.x+wall.sx/2,bx+S);
    const minZ=Math.max(wall.z-wall.sz/2,bz), maxZ=Math.min(wall.z+wall.sz/2,bz+S);
    if(maxX-minX<0.02 || maxZ-minZ<0.02) return;
    // Keep the elevator landing comfortably clear of maintenance geometry.
    if(this.start && Math.abs((minX+maxX)*0.5-this.start.x)<10 && Math.abs((minZ+maxZ)*0.5-this.start.z)<10) return;
    const wallH=Math.max(6.98,wall.h||7.0);
    this.addBox(g,this.shared.concrete,(minX+maxX)/2,this.baseY+wallH/2,(minZ+maxZ)/2,maxX-minX,wallH,maxZ-minZ);
    rec.colliders.push({min:new THREE.Vector3(minX,this.baseY,minZ),max:new THREE.Vector3(maxX,this.baseY+wallH,maxZ)});
  },
  buildMaintenanceMacroParts(g,rec,mx,mz,bx,bz,S,rng){
    const walls=this.getMaintenanceWalls(mx,mz);
    for(const wall of walls) this.addClippedWall(g,rec,wall,bx,bz,S);
  },
  macroGeometry(mx,mz){
    const key=this.macroKey(mx,mz), type=this.macroType(mx,mz);
    if(this.macroCache.has(key+':geometry')) return this.macroCache.get(key+':geometry');
    const data={type,exitEdge:null};
    this.macroCache.set(key+':geometry',data); return data;
  },
  buildChunk(cx,cz){
    const key=cx+','+cz; if(this.chunks.has(key)) return;
    const rng=this.rngFor(cx,cz,101), g=new THREE.Group(); g.name='L1_chunk_'+key;
    const rec={cx,cz,group:g,colliders:[],fixtures:[],pointLights:[]};
    const ox=cx*this.microSize, oz=cz*this.microSize, S=this.microSize;
    const centerX=ox+S/2, centerZ=oz+S/2;
    const mx=Math.floor(centerX/this.macroSize), mz=Math.floor(centerZ/this.macroSize);
    const type=this.macroType(mx,mz); rec.type=type; rec.mx=mx; rec.mz=mz;
    // Continuous concrete floor and ceiling. Texture repetition makes the
    // huge world read as actual concrete rather than a flat gray plane.
    const floorMap=this.shared.floor.map.clone(); floorMap.repeat.set(S/12,S/12); floorMap.needsUpdate=true;
    const floorMat=this.shared.floor.clone(); floorMat.map=floorMap;
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(S,S),floorMat); floor.rotation.x=-Math.PI/2; floor.position.set(centerX,this.baseY,centerZ); g.add(floor);
    rec.colliders.push({min:new THREE.Vector3(ox,this.baseY-0.18,oz),max:new THREE.Vector3(ox+S,this.baseY,oz+S)});
    const ceilMap=this.shared.concreteLight.map.clone(); ceilMap.repeat.set(S/14,S/14); ceilMap.needsUpdate=true;
    const ceilMat=this.shared.concreteLight.clone(); ceilMat.map=ceilMap;
    this.addBox(g,ceilMat,centerX,this.baseY+7.12,centerZ,S,0.24,S);
    // Structural grid is present in both spaces, but parking lots are more open.
    for(let ix=8;ix<S;ix+=16) for(let iz=8;iz<S;iz+=16){
      if(rng()<0.10) continue;
      this.pillar(g,rec,ox+ix,oz+iz);
    }
    if(type==='maintenance'){
      this.buildMaintenanceMacroParts(g,rec,mx,mz,ox,oz,S,rng);
    } else {
      // Parking lots get a few sparse dividers, never enough to destroy the
      // enormous sightlines.
      if(rng()<0.35){
        const z=oz+S*(0.35+0.3*rng()); this.addWall(g,rec,ox+S*.5,z,S*.58,0.34,1.4);
      }
      if(rng()<0.25){
        const x=ox+S*(0.25+0.5*rng()); this.addWall(g,rec,x,oz+S*.55,0.34,S*.38,1.4);
      }
    }
    // Ceiling beams/pipes continue across both generation types.
    if(rng()<0.85) this.pipeRun(g,centerX,oz+S*.35,S*.72,0,rng);
    if(rng()<0.65) this.pipeRun(g,ox+S*.68,centerZ,0,S*.70,rng);
    const lightMode=rng(); rec.dark=lightMode<0.18; rec.bright=lightMode>0.78;
    const spacing=type==='parking' ? (rec.bright?12:18) : (rec.bright?8.5:11);
    if(!rec.dark){
      for(let x=spacing/2;x<S;x+=spacing) for(let z=spacing/2;z<S;z+=spacing){
        if(rng()<(rec.bright?0.08:0.32)) continue;
        this.fixture(g,ox+x,oz+z,rec.bright?1.55:1.08,rng,rec);
      }
    }
    // Puddles are preferentially placed in parking/open floor; a smaller number
    // can appear in unusually wide maintenance sections.
    if(type==='parking' || rng()<0.20){
      const openMask=(x,z)=>{
        // Only place puddles on actual open floor. The first collider in a
        // chunk is the floor slab; ignore it and test structural obstacles.
        for(const c of rec.colliders){
          if(c.max.y <= this.baseY + 0.5) continue;
          if(x>=c.min.x-0.9 && x<=c.max.x+0.9 && z>=c.min.z-0.9 && z<=c.max.z+0.9) return false;
        }
        return true;
      };
      this.generatePuddles(g,rec,ox,oz,S,rng,openMask);
    }
    // Resource density is defined on 150x150m regions, not streaming chunks.
    // Generate a region once as soon as one of its chunks becomes active.
    const rx=Math.floor(centerX/CONFIG.items.regionSize), rz=Math.floor(centerZ/CONFIG.items.regionSize);
    PickupSystem.generateLevel1Region(rx,rz,this.seed);
    this.group.add(g); this.chunks.set(key,rec);
  },
  rebuildColliders(){
    this.colliders.length=0;
    for(const rec of this.chunks.values()) for(const c of rec.colliders) this.colliders.push(c);
  },
  unloadFar(cx,cz){
    for(const [key,rec] of this.chunks){
      if(Math.max(Math.abs(rec.cx-cx),Math.abs(rec.cz-cz))>this.activeRadius){
        if(rec.group.parent) rec.group.parent.remove(rec.group);
        this.chunks.delete(key);
      }
    }
    // Remove puddles belonging to unloaded chunks from the proximity list.
    this.puddles=this.puddles.filter(p=>Math.max(Math.abs(Math.floor(p.x/this.microSize)-cx),Math.abs(Math.floor(p.z/this.microSize)-cz))<=this.activeRadius);
  },
  stream(force=false){
    if(!this.active) return;
    const source=(typeof Player!=='undefined'&&Player.position)?Player.position:this.center;
    const mcx=Math.floor(source.x/this.microSize), mcz=Math.floor(source.z/this.microSize);
    if(!force&&mcx===this.lastMCX&&mcz===this.lastMCZ) return;
    this.lastMCX=mcx; this.lastMCZ=mcz;
    const wanted=[];
    for(let dz=-this.activeRadius;dz<=this.activeRadius;dz++) for(let dx=-this.activeRadius;dx<=this.activeRadius;dx++) wanted.push([dx*dx+dz*dz,dx,dz]);
    wanted.sort((a,b)=>a[0]-b[0]);
    for(const [,dx,dz] of wanted) this.buildChunk(mcx+dx,mcz+dz);
    this.unloadFar(mcx,mcz); this.rebuildColliders();
    this.center.copy(source); this.center.y=this.baseY;
  },
  setFixtureState(on,dim=1){
    for(const rec of this.chunks.values()){
      for(const f of rec.fixtures){
        const e=on ? 2.85*f.base*dim : 0.0;
        f.panel.material.emissiveIntensity=e;
        f.panel.visible=true; f.housing.visible=true;
      }
      for(const L of rec.pointLights) L.intensity=on ? 1.22*dim : 0;
    }
    for(const L of this.ambientLights){
      if(L.isHemisphereLight) L.intensity = on ? 1.28*dim : 0.055;
      else L.intensity = on ? 0.52*dim : 0.018;
    }
  },
  startBlackout(){
    if(this.blackoutState!=='idle') return;
    this.blackoutState='flicker'; this.blackoutFlickerT=0; this.blackoutFlickerNext=0.10;
    this.blackoutDuration=30+this.rngFor(this.blackoutCycle,0,333)()*30;
    this.setFixtureState(false);
    if(scene){ scene.background && scene.background.setHex(0x050606); scene.fog=new THREE.Fog(0x000000,1.0,Flashlight.enabled?42:15); }
  },
  beginOutage(){
    this.blackoutState='outage'; this.blackoutTimer=0;
    this.setFixtureState(false);
    if(scene){ scene.background && scene.background.setHex(0x000000); if(!scene.fog) scene.fog=new THREE.Fog(0x000000,10,64); scene.fog.near=1.2; scene.fog.far=18; scene.fog.color.setHex(0x000000); }
  },
  endBlackout(){
    this.blackoutState='cooldown'; this.blackoutCooldown=60+this.rngFor(this.blackoutCycle,7,334)()*30;
    this.setFixtureState(true,1);
    if(scene){ scene.fog=null; scene.background && scene.background.setHex(0x202321); }
  },
  updateBlackout(dt){
    this.levelTime+=dt;
    if(this.blackoutState==='idle' && this.levelTime>=this.blackoutNext){
      const atGuarantee=this.levelTime >= this.blackoutWindowStart+90;
      if(atGuarantee || Math.random()<0.10){
        this.startBlackout();
      } else {
        // Missed the 60s roll: try again every 6s until the hard 90s guarantee.
        this.blackoutNext=Math.min(this.blackoutWindowStart+90,this.levelTime+6);
      }
    }
    if(this.blackoutState==='flicker'){
      this.blackoutFlickerT+=dt;
      if(this.blackoutFlickerT>=2.4){ this.beginOutage(); return; }
      if(this.blackoutFlickerT>=this.blackoutFlickerNext){
        this.blackoutFlickerNext=this.blackoutFlickerT+(0.07+Math.random()*0.22);
        const on=Math.random()>0.38; this.setFixtureState(on,on?1:0.08);
      }
    } else if(this.blackoutState==='outage'){
      this.blackoutTimer+=dt;
      this.setFixtureState(false);
      if(scene&&scene.fog){ scene.fog.near=1.0; scene.fog.far=Flashlight.enabled?42:15; scene.fog.color.setHex(0x000000); }
      if(this.blackoutTimer>=this.blackoutDuration) this.endBlackout();
    } else if(this.blackoutState==='cooldown'){
      this.blackoutCooldown-=dt;
      if(this.blackoutCooldown<=0){
        this.blackoutState='idle'; this.blackoutCycle++;
        // New blackout cycle begins 60s after the cooldown ends.
        this.blackoutWindowStart=this.levelTime+60;
        this.blackoutNext=this.blackoutWindowStart+60;
      }
    }
  },
  updatePuddleVisibility(){
    if(!CameraRig.camera) return;
    let inside=false;
    for(const p of this.puddles){ const dx=Player.position.x-p.x,dz=Player.position.z-p.z; if(dx*dx+dz*dz<=p.r*p.r){inside=true;break;} }
    const base=(this.blackoutState==='flicker'||this.blackoutState==='outage')?18:320;
    const target=inside ? base*0.85 : base;
    if(Math.abs(CameraRig.camera.far-target)>0.5){ CameraRig.camera.far+=(target-CameraRig.camera.far)*0.35; CameraRig.camera.updateProjectionMatrix(); }
  },
  placeExit(){
    // Long-range Level 1 exit placement. The exit is deliberately put in a
    // maintenance macro-region roughly 600–1000m from the starting point,
    // preferably with a parking macro-region between the player and the exit.
    const smx=Math.floor(this.start.x/this.macroSize), smz=Math.floor(this.start.z/this.macroSize);
    const sx=this.start.x, sz=this.start.z;
    let candidates=[];
    for(let dz=-2;dz<=2;dz++) for(let dx=-2;dx<=2;dx++){
      if(dx===0&&dz===0) continue;
      const mx=smx+dx,mz=smz+dz;
      if(this.macroType(mx,mz)!=='maintenance') continue;
      const b=this.macroBounds(mx,mz);
      // Put the staircase on a side/corner of the macro facing the start.
      const pts=[
        [b.minx+28,b.minz+28],[b.maxx-28,b.minz+28],
        [b.minx+28,b.maxz-28],[b.maxx-28,b.maxz-28],
        [(b.minx+b.maxx)/2,b.minz+28],[(b.minx+b.maxx)/2,b.maxz-28],
        [b.minx+28,(b.minz+b.maxz)/2],[b.maxx-28,(b.minz+b.maxz)/2]
      ];
      for(const pt of pts){
        const dist=Math.hypot(pt[0]-sx,pt[1]-sz);
        if(dist<600 || dist>1000) continue;
        // Prefer candidates with a parking region in the direction from the
        // player toward the exit. This makes the player more likely to cross
        // a large parking lot before discovering the staircase.
        const ux=dx/(Math.hypot(dx,dz)||1), uz=dz/(Math.hypot(dx,dz)||1);
        const nearMx=mx-Math.sign(Math.round(ux)), nearMz=mz-Math.sign(Math.round(uz));
        let parkingScore=0;
        for(const [nx,nz] of [[mx-1,mz],[mx+1,mz],[mx,mz-1],[mx,mz+1]]){
          if(this.macroType(nx,nz)==='parking'){
            const vx=nx-smx, vz=nz-smz;
            if(vx*dx+vz*dz>0) parkingScore+=2;
            else parkingScore+=0.5;
          }
        }
        candidates.push({mx,mz,x:pt[0],z:pt[1],dist,parkingScore});
      }
    }
    // If no exact 600–1000m point exists for this deterministic layout,
    // choose the closest valid maintenance point, still preferring parking.
    if(!candidates.length){
      for(let dz=-2;dz<=2;dz++) for(let dx=-2;dx<=2;dx++){
        if(dx===0&&dz===0) continue;
        const mx=smx+dx,mz=smz+dz;
        if(this.macroType(mx,mz)!=='maintenance') continue;
        const b=this.macroBounds(mx,mz);
        const pts=[[b.minx+30,b.minz+30],[b.maxx-30,b.maxz-30],[(b.minx+b.maxx)/2,(b.minz+b.maxz)/2]];
        for(const pt of pts) candidates.push({mx,mz,x:pt[0],z:pt[1],dist:Math.hypot(pt[0]-sx,pt[1]-sz),parkingScore:0});
      }
    }
    candidates.sort((a,b)=>b.parkingScore-a.parkingScore || Math.abs(a.dist-800)-Math.abs(b.dist-800));
    let best=candidates[0] || {mx:smx+1,mz:smz+1,x:sx+620,z:sz+620,dist:Math.hypot(620,620),parkingScore:0};
    this.exitMacro=best;

    const x=best.x,z=best.z;
    // Face the staircase toward the starting area, so it reads as an opening
    // embedded in a wall rather than a freestanding object.
    const fx=sx-x, fz=sz-z;
    let dx=0,dz=1;
    if(Math.abs(fx)>=Math.abs(fz)) dx=fx>=0?1:-1;
    else dz=fz>=0?1:-1;
    const rightX=-dz, rightZ=dx;

    // Trigger covers the top landing only. Walking onto the first tread starts
    // the descent/Level 2 handoff.
    const trigger={type:'level1exit',minx:x+rightX*-2.2+dx*-0.2-2.0,maxx:x+rightX*2.2+dx*-0.2+2.0,minz:z+rightZ*-2.2+dz*-0.2-2.0,maxz:z+rightZ*2.2+dz*-0.2+2.0};
    this.triggers.push(trigger);
    this.exitPosition=new THREE.Vector3(x,this.baseY,z);

    const g=new THREE.Group(); g.name='Level1_StairExit'; this.group.add(g);
    const W=7.0, wallH=8.4, wallT=2.4, openingW=4.2, openingH=7.0;
    const steps=24, stepD=0.82, drop=0.22;
    const rot=Math.atan2(dx,dz);
    const wallMat=this.shared.concrete;

    // A single heavy wall surrounds a real opening. The central opening is
    // left empty so the stairs visually disappear into the structure.
    const sideW=(W-openingW)/2;
    for(const sign of [-1,1]){
      const px=x+rightX*sign*(openingW/2+sideW/2), pz=z+rightZ*sign*(openingW/2+sideW/2);
      const col=this.addBox(g,wallMat,px,this.baseY+wallH/2,pz,sideW,wallH,wallT); col.rotation.y=rot;
    }
    const lintelH=wallH-openingH;
    const lintel=this.addBox(g,wallMat,x,this.baseY+openingH+lintelH/2,z,W,lintelH,wallT); lintel.rotation.y=rot;

    // Extend the wall sideways so the portal is unmistakably embedded.
    // The back remains dark, giving a clear visual transition to Level 2.
    const backX=x+dx*(steps*stepD+1.0), backZ=z+dz*(steps*stepD+1.0);
    const shaftMat=new THREE.MeshBasicMaterial({color:0x020303,toneMapped:false});
    const shaft=this.addBox(g,shaftMat,backX,this.baseY-steps*drop/2+0.1,backZ,openingW,steps*drop+1.2,steps*stepD+2.0); shaft.rotation.y=rot;

    // First tread starts exactly at floor level; every following tread drops.
    for(let i=0;i<steps;i++){
      const along=(i+0.5)*stepD;
      const px=x+dx*along, pz=z+dz*along;
      const yy=this.baseY - i*drop + 0.07;
      const st=this.addBox(g,wallMat,px,yy,pz,openingW,0.14,stepD+0.04); st.rotation.y=rot;
    }

    // Thick retaining walls run down both sides of the stairwell.
    const railLen=steps*stepD+1.4;
    for(const sign of [-1,1]){
      const px=x+dx*(railLen/2)+rightX*sign*(openingW/2+wallT/2);
      const pz=z+dz*(railLen/2)+rightZ*sign*(openingW/2+wallT/2);
      const wall=this.addBox(g,wallMat,px,this.baseY-steps*drop/2+0.75,pz,wallT,1.5+steps*drop,railLen); wall.rotation.y=rot;
    }

    // Subtle sign at the bottom: this is the Level 2 destination, not a
    // floating exit object in the middle of Level 1.
    const signMat=new THREE.MeshBasicMaterial({color:0x9fe8ff,toneMapped:false});
    const sign=this.addBox(g,signMat,backX,this.baseY-steps*drop+1.15,backZ+rightZ*0.02,2.7,0.34,0.06); sign.rotation.y=rot;
    // Small light just inside the Level 2 threshold.
    const bottomLight=new THREE.PointLight(0x8ed8ff,0.75,8,1.7);
    bottomLight.position.set(backX-dx*0.7,this.baseY-steps*drop+0.7,backZ-dz*0.7); g.add(bottomLight);
  },
  build(seed,origin){
    this.resetVisuals(); this.materialSet(); this.active=true; this.seed=seed>>>0;
    this.center.set(origin.x,this.baseY,origin.z); this.start.set(origin.x,this.baseY,origin.z);
    this.group=new THREE.Group(); this.group.name='Level1_InfiniteWorld'; scene.add(this.group);
    // Level 1 resources live in their own group so streaming/resetting the
    // level does not leave stale pickups behind.
    if(PickupSystem.group && scene) scene.remove(PickupSystem.group);
    PickupSystem.group=new THREE.Group(); PickupSystem.group.name='Level1_Pickups'; scene.add(PickupSystem.group);
    const hemi=new THREE.HemisphereLight(0xe9f1f5,0x2b2e2d,1.28);
    const amb=new THREE.AmbientLight(0xc2c9cc,0.52); scene.add(hemi,amb); this.ambientLights.push(hemi,amb);
    scene.fog=null; if(scene.background) scene.background.setHex(0x202321);
    if(CameraRig.camera){ CameraRig.camera.far=320; CameraRig.camera.updateProjectionMatrix(); }
    this.lastMCX=999999; this.lastMCZ=999999; this.stream(true); this.placeExit();
  },
  enter(seed,elevatorState){
    if(Level.group&&scene)scene.remove(Level.group); LightingSystem.clear(scene);
    if(Stairwell&&Stairwell.exits)Stairwell.reset();
    const origin=elevatorState?{x:elevatorState.origin.x,z:elevatorState.origin.z}:{x:0,z:0};
    PickupSystem.reset();
    this.build(seed,origin);
    Level.cols=Infinity; Level.rows=Infinity; Level.tiles=[]; Level.colliders=this.colliders; Level.triggers=this.triggers; Level.group=this.group;
    Level.worldMin.set(-Infinity,-2,-Infinity); Level.worldMax.set(Infinity,8,Infinity);
    Level.startPos.set(origin.x,0,origin.z); GameState.level=1;
    const obj=document.getElementById('hud-obj');if(obj)obj.textContent='Objective: explore Level 1';
    const lvl=document.getElementById('hud-level-label');if(lvl)lvl.textContent='LEVEL 1';
    const seedEl=document.getElementById('hud-seed-val');if(seedEl)seedEl.textContent=String(this.seed);
    const title=document.getElementById('start-seed');if(title)title.textContent='LEVEL 1 · SEED '+this.seed;
    Checkpoints.reset(); Checkpoints.register('level1-start',new THREE.Vector3(origin.x,0,origin.z),0); Checkpoints.activate('level1-start');
    Player.position.set(origin.x,0,origin.z); Player.velocity.set(0,0,0); Player.onGround=true;
    EntitySystem.despawn(); EncounterManager.reset(); DebugPath.hide(); DarknessSystem.reset(); AtmosphereSystem.reset(); EnvEventSystem.reset(); Flashlight.reset();
    if(typeof SmilerSystem!=="undefined") SmilerSystem.reset();
    if(typeof SmilerCorruption!=="undefined") SmilerCorruption.reset();
  },
  update(dt){
    if(!this.active) return;
    this.streamTimer+=dt; if(this.streamTimer>0.18){this.streamTimer=0;this.stream(false);}
    this.updateBlackout(dt); this.updatePuddleVisibility(); if(typeof SmilerSystem!=="undefined") SmilerSystem.update(dt); if(typeof ExitLocator!=="undefined") ExitLocator.update();
    Level.worldMin.set(-Infinity,-2,-Infinity); Level.worldMax.set(Infinity,8,Infinity);
  }
};

