"use strict";

/* ------------------------------------------------------------------
   SEEDED RNG + PROCEDURAL LEVEL 0
   Modules occupy a cell grid, then stamp tiles for the existing
   collider / mesh / lighting pipeline.
   VERSION 4 entities can query MapGraph / Module records.
   ------------------------------------------------------------------ */
const TILE = { WALL: 1, FLOOR: 0, START: 2, EXIT: 4, COLUMN: 5, DEAD: 6 };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIR4 = [
  { x: 0, z: -1, name: "N" },
  { x: 1, z: 0, name: "E" },
  { x: 0, z: 1, name: "S" },
  { x: -1, z: 0, name: "W" }
];
function oppDir(d) { return (d + 2) & 3; }

const MapGraph = {
  nodes: [],
  edges: [],
  cellOwner: [],
  provider: null,    // Level 0: the unbounded Level0World, which owns its modules region by region
  reset() {
    this.nodes = [];
    this.edges = [];
    this.cellOwner = [];
    this.provider = null;
  },
  nodeAt(gx, gz) {
    if (this.provider) return this.provider.nodeAt(Math.floor(gx), Math.floor(gz));
    if (!this.cellOwner[gz]) return null;
    const id = this.cellOwner[gz][gx];
    if (id == null) return null;
    return this.nodes[id] || null;
  },
  nodeById(id) {
    if (this.provider) return this.provider.nodeById(id);
    return this.nodes[id] || null;
  },
  // Cells (gx, gz) of the modules a module opens onto, including across a region border.
  connectedCells(node) {
    const out = [];
    if (!node) return out;
    for (const id of node.connections) { const n = this.nodeById(id); if (n) out.push({ gx: n.gx, gz: n.gz }); }
    if (node.portLinks) for (const p of node.portLinks) out.push({ gx: p.gx, gz: p.gz });
    return out;
  }
};

/* Level 0 is no longer one stored map. A "generated level" is now a deterministic WORLD (js/levels/level0-world.js)
   plus the elevator plan for it (js/levels/level0-sites.js). Nothing here pre-generates the level: only the regions
   the plan needs are built, the rest stream in as the player walks. */
const LevelGenerator = {
  CELL: 6,
  last: null,

  generate(seed) {
    const T = CONFIG.tile;
    const world = Level0World.create(seed >>> 0);
    const home = world.region(0, 0);
    const startStamp = home.startTile;
    if (!startStamp) return null;
    let sitePlan;
    try {
      sitePlan = Level0Sites.planWorld({ world: world, start: startStamp, tileSize: T, seed: seed >>> 0 });
    } catch (err) {
      if (typeof console !== "undefined") console.warn("Level 0 plan rejected seed " + (seed >>> 0) + ": " + err.message);
      return null;
    }
    const exitStamps = [], exitNodes = [], exitDistances = [];
    for (let i = 0; i < sitePlan.elevators.length; i++) {
      const e = sitePlan.elevators[i];
      world.stamp(e.x, e.z, TILE.EXIT);          // survives the region being dropped and rebuilt
      const owner = world.nodeAt(Math.floor(e.x / this.CELL), Math.floor(e.z / this.CELL)) || null;
      if (owner) owner.hasExit = true;
      exitStamps.push({ x: e.x, z: e.z });
      exitNodes.push(owner);
      exitDistances.push(e.walkStart == null ? null : e.walkStart);
    }
    world.pin(0, 0);
    const result = {
      seed: seed >>> 0,
      world: world,
      tiles: null, rows: Infinity, cols: Infinity,
      modules: [],
      startNode: world.nodeAt(Math.floor(startStamp.x / this.CELL), Math.floor(startStamp.z / this.CELL)),
      exitNode: exitNodes[0],
      exitNodes: exitNodes,
      startStamp: startStamp,
      exitStamp: exitStamps[0],
      exitStamps: exitStamps,
      exitDistances: exitDistances,
      elevatorSites: sitePlan.elevators,   // one per exit, in the same order, each with its five station sites
      siteReport: sitePlan.report,
      pathMeters: exitDistances[0] || 0,
      targetPath: 0
    };
    this.last = result;
    return result;
  },

  generateValid(seed, maxTries) {
    const s = seed >>> 0, tries = maxTries || 24;
    // The planner is built to succeed on every seed; this loop is only a safety net, and it stays deterministic.
    for (let i = 0; i < tries; i++) {
      const res = this.generate((s + i * 7919) >>> 0);
      if (res) return res;
    }
    return null;
  }
};

const SpawnManager = {
  apply(result) {
    if (!result || !result.startStamp) return;
    const w = Level.tileToWorld(result.startStamp.x, result.startStamp.z);
    Level.startPos.set(w.x, 0, w.z);
  }
};

const DebugPath = {
  visible: false,
  line: null,
  refreshT: 0,
  toggle() {
    if (this.visible) this.hide();
    else this.show();
  },
  show() {
    this.visible = true;
    this.refreshT = 0;
    this.rebuild();
  },
  hide() {
    this.visible = false;
    if (this.line && scene) {
      scene.remove(this.line);
      if (this.line.geometry) this.line.geometry.dispose();
    }
    this.line = null;
  },
  walkable(t) {
    return t !== TILE.WALL && t !== TILE.COLUMN;
  },
  rebuild() {
    if (this.line && scene) {
      scene.remove(this.line);
      if (this.line.geometry) this.line.geometry.dispose();
      this.line = null;
    }
    if (!this.visible) return;
    if (GameState.level === 1 && typeof Level1 !== "undefined" && Level1.exitPosition) {
      const pts = [
        new THREE.Vector3(Player.position.x, 0.35, Player.position.z),
        Level1.exitPosition.clone().setY(0.28)
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc46a }));
      if (scene) scene.add(this.line);
      return;
    }
    if (!Level.world && !Level.tiles) return;
    const T = CONFIG.tile;
    const sx = Math.floor(Player.position.x / T);
    const sz = Math.floor(Player.position.z / T);
    let ex = -1, ez = -1, exitIndex = 0;
    const result = LevelGenerator.last;
    const stamps = result && (result.exitStamps || (result.exitStamp ? [result.exitStamp] : []));
    if (!stamps || !stamps.length || !Level.inBounds(sx, sz)) return;
    // The actual nearest exit is chosen by walking distance after BFS,
    // rather than by straight-line distance.
    ex = stamps[0].x; ez = stamps[0].z;
    // Sparse breadth-first search: Level 0 is unbounded, so there is no grid to size an array by.
    const key = (x, z) => (x + 32768) * 65536 + (z + 32768);
    let startX = sx, startZ = sz;
    if (!this.walkable(Level.getTile(startX, startZ))) {
      let found = false;
      for (let r = 1; r <= 4 && !found; r++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          for (let dx = -r; dx <= r && !found; dx++) {
            const x = sx + dx, z = sz + dz;
            if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) { startX = x; startZ = z; found = true; }
          }
        }
      }
      if (!found) return;
    }
    const dist = new Map(), prev = new Map();
    const q = [[startX, startZ]];
    dist.set(key(startX, startZ), 0);
    let qi = 0, remaining = stamps.length, bestExitTiles = Infinity;
    const want = new Map(stamps.map((st, i) => [key(st.x, st.z), i]));
    while (qi < q.length && qi < 400000 && remaining > 0) {
      const p = q[qi++], pd = dist.get(key(p[0], p[1]));
      for (let i = 0; i < 4; i++) {
        const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z, nk = key(nx, nz);
        if (dist.has(nk)) continue;
        if (!Level.inBounds(nx, nz)) continue;
        const t = Level.getTile(nx, nz);
        if (!this.walkable(t) && !want.has(nk)) continue;
        dist.set(nk, pd + 1);
        prev.set(nk, [p[0], p[1]]);
        if (want.has(nk)) { remaining--; if (pd + 1 < bestExitTiles) { bestExitTiles = pd + 1; exitIndex = want.get(nk); ex = nx; ez = nz; } continue; }
        q.push([nx, nz]);
      }
    }
    if (bestExitTiles === Infinity) return;

    const pts = [new THREE.Vector3(Player.position.x, 0.35, Player.position.z)];
    const tiles = [];
    let cx = ex, cz = ez;
    while (!(cx === startX && cz === startZ)) {
      tiles.push([cx, cz]);
      const pr = prev.get(key(cx, cz));
      if (!pr) break;
      cx = pr[0]; cz = pr[1];
    }
    tiles.reverse();
    for (let i = 0; i < tiles.length; i += 2) {
      const w = Level.tileToWorld(tiles[i][0], tiles[i][1]);
      pts.push(new THREE.Vector3(w.x, 0.28, w.z));
    }
    const last = Level.tileToWorld(ex, ez);
    pts.push(new THREE.Vector3(last.x, 0.25, last.z));
    const routeStair = Stairwell.exits && Stairwell.exits[exitIndex]
      ? Stairwell.exits[exitIndex]
      : (Stairwell.exits && Stairwell.exits[0] ? Stairwell.exits[0] : null);
    if (routeStair) {
      const botAlong = routeStair.depth * 0.10;
      const bot = routeStair.local(0, botAlong);
      pts.push(new THREE.Vector3(bot.x, 0.35, bot.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7ec8ff }));
    if (scene) scene.add(this.line);
  },
  update(dt) {
    if (!this.visible) return;
    if (!GameState.debug) { this.hide(); return; }
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.45;
      this.rebuild();
    }
  }
};

const ExitManager = {
  worldPos() {
    if (GameState.level === 1 && typeof Level1 !== "undefined" && Level1.exitPosition) {
      return Level1.exitPosition.clone();
    }
    const list = Stairwell.exits && Stairwell.exits.length
      ? Stairwell.exits
      : [];
    if (list.length) {
      let best = list[0].origin;
      let bestD = Math.hypot(best.x - Player.position.x, best.z - Player.position.z);
      for (let i = 1; i < list.length; i++) {
        const o = list[i].origin;
        const d = Math.hypot(o.x - Player.position.x, o.z - Player.position.z);
        if (d < bestD) { best = o; bestD = d; }
      }
      return best.clone();
    }
    const res = LevelGenerator.last;
    if (!res) return null;
    const stamp = res.exitStamp || (res.exitStamps && res.exitStamps[0]);
    if (!stamp) return null;
    const w = Level.tileToWorld(stamp.x, stamp.z);
    return new THREE.Vector3(w.x, 0, w.z);
  }
};

const ExitLocator = {
  active:false, el:null, lastToast:0,
  init(){
    if(this.el) return;
    this.el=document.getElementById("exit-waypoint");
    if(!this.el) return;
  },
  toggle(){
    this.init();
    if(GameState.level!==1){ this.active=false; this.el.style.display="none"; return; }
    this.active=!this.active;
    this.el.style.display=this.active?"block":"none";
    HUD.toast(this.active?"NEAREST LEVEL 1 EXIT SHOWN":"EXIT LOCATOR OFF");
  },
  hide(){ if(this.el) this.el.style.display="none"; this.active=false; },
  update(){
    if(!this.active || GameState.level!==1 || !Level1.exitPosition || !CameraRig.camera || !this.el) return;
    const dx=Level1.exitPosition.x-Player.position.x, dz=Level1.exitPosition.z-Player.position.z;
    const dist=Math.hypot(dx,dz);
    const fx=-Math.sin(Player.yaw), fz=-Math.cos(Player.yaw);
    const rightX=Math.cos(Player.yaw), rightZ=-Math.sin(Player.yaw);
    const side=dx*rightX+dz*rightZ;
    const forward=dx*fx+dz*fz;
    const angle=Math.atan2(side,forward);
    const clamped=Math.max(-1.0,Math.min(1.0,angle/1.45));
    this.el.style.left=(50+clamped*42).toFixed(1)+"%";
    this.el.style.top=(forward>0?"17%":"83%");
    this.el.querySelector(".exit-arrow").style.transform=`rotate(${(angle*180/Math.PI).toFixed(1)}deg)`;
    this.el.querySelector(".exit-distance").textContent="EXIT "+dist.toFixed(0)+"m";
  }
};

const Stairwell = {
  // Kept under the old internal name so the existing generator/debug code
  // remains compatible. Visually and mechanically this is now a concrete
  // elevator exit, not a stairwell.
  exits: [],
  origin: null,
  hole: null,
  minY: -10,
  reached: false,
  width: 4.6,
  depth: 5.2,
  height: 3.2,
  fx: 0, fz: 1, rx: 1, rz: 0,
  sequenceActive: false,
  sequenceT: 0,
  sequenceDuration: 6.5,
  sequenceExitIndex: -1,
  transitionToken: 0,
  pendingTransitionTimer: null,
  cabGroups: [],
  avatarGroups: [],
  doorPairs: [],

  reset() {
    this.exits = [];
    this.origin = null;
    this.hole = null;
    this.minY = -10;
    this.reached = false;
    this.sequenceActive = false;
    this.sequenceT = 0;
    this.sequenceExitIndex = -1;
    for (const g of this.cabGroups) { if (g && g.parent) g.parent.remove(g); }
    this.cabGroups = [];
    this.lightUnits = [];
    this.avatarGroups = [];
    this.doorPairs = [];
    GameState.exitReached = false;
    GameState.elevatorShake = 0;
    const ov = document.getElementById('elevator-sequence');
    if (ov) ov.style.display = 'none';
  },

  cancelPendingTransition() {
    this.transitionToken++;
    if (this.pendingTransitionTimer !== null) {
      clearTimeout(this.pendingTransitionTimer);
      this.pendingTransitionTimer = null;
    }
    this.sequenceActive = false;
    this.sequenceT = 0;
    this.sequenceExitIndex = -1;
    this.reached = false;
    GameState.exitReached = false;
    GameState.cinematicCamera = false;
    GameState.elevatorShake = 0;
  },

  planOne(result, stamp, exitNode, site) {
    const ex = stamp.x, ez = stamp.z;
    const w = Level.tileToWorld(ex, ez);
    // The elevator is deliberately a wall-mounted facade, not a room/cab.
    // A valid site must have a real two-tile-wide hallway directly in front
    // of the doors. The door normal is derived from that hallway direction,
    // so the elevator can never be rotated independently of its approach.
    const candidates = [
      { fx: 0, fz: -1, rx: 1, rz: 0 },
      { fx: 1, fz: 0, rx: 0, rz: 1 },
      { fx: 0, fz: 1, rx: -1, rz: 0 },
      { fx: -1, fz: 0, rx: 0, rz: -1 }
    ];
    const floor = (tx,tz) => Level.getTile(tx,tz) !== TILE.WALL && Level.getTile(tx,tz) !== TILE.COLUMN;
    const scored = [];
    // A planned site (Level0Sites) already knows which way its wall faces, so
    // it skips the hallway search below. The legacy search stays for the
    // Test Beta generator, which has no planned sites.
    for (const d of (site ? [] : candidates)) {
      const frontX = -d.fx, frontZ = -d.fz;
      let straight = 0;
      let widthOK = true;
      // Require a continuous approach lane and a full 2-tile hallway width.
      for (let n=1;n<=4;n++) {
        const tx=ex+frontX*n, tz=ez+frontZ*n;
        if (!floor(tx,tz)) { widthOK=false; break; }
        straight++;
        for (const side of [-1,1]) {
          const sx=tx+d.rx*side, sz=tz+d.rz*side;
          if (!floor(sx,sz)) widthOK=false;
        }
      }
      if (!widthOK || straight<3) continue;
      let score=straight*25;
      if (exitNode && exitNode.connections) {
        for (const id of exitNode.connections) {
          const nb=MapGraph.nodes[id]; if(!nb) continue;
          const ndx=(exitNode.gx+exitNode.w*.5)-(nb.gx+nb.w*.5);
          const ndz=(exitNode.gz+exitNode.h*.5)-(nb.gz+nb.h*.5);
          const cx=Math.abs(ndx)>=Math.abs(ndz)?(ndx>=0?1:-1):0;
          const cz=Math.abs(ndx)>=Math.abs(ndz)?0:(ndz>=0?1:-1);
          if(cx===frontX && cz===frontZ) score+=40;
        }
      }
      scored.push({score,d});
    }
    let best;
    if (site) {
      best = { fx: site.fx, fz: site.fz, rx: site.rx, rz: site.rz };
    } else {
      if (!scored.length) return null;
      scored.sort((a,b)=>b.score-a.score);
      best=scored[0].d;
    }

    const elevator = {
      fx: best.fx, fz: best.fz, rx: best.rx, rz: best.rz,
      // Origin is the wall plane. The facade projects only a few inches into
      // the hallway; there is no walkable shaft or floor hole behind it.
      // A planned site puts the wall plane half a tile behind its floor tile.
      origin: new THREE.Vector3(w.x + (site ? best.fx * CONFIG.tile * 0.5 : 0), 0, w.z + (site ? best.fz * CONFIG.tile * 0.5 : 0)),
      hole: null,
      minY: 0,
      width: 4.6,
      depth: 5.2,
      height: 3.2,
      steps: 0,
      rise: 0,
      run: 0,
      landingAfter: 0,
      landingLen: 0,
      exitStamp: stamp,
      exitNode: exitNode,
      siteIndex: site ? site.index : -1,   // index into LevelGenerator.last.elevatorSites; -1 = unplanned (Test Beta)
      local(side, along) {
        return { x: this.origin.x + this.rx * side + this.fx * along,
                 z: this.origin.z + this.rz * side + this.fz * along };
      }
    };
    return elevator;
  },

  planFrom(result) {
    this.reset();
    if (!result || !result.exitStamps || !result.exitStamps.length) return;
    const nodes = result.exitNodes || [];
    // Only promote exits that actually have a hallway-facing facade site.
    for (let i=0;i<result.exitStamps.length;i++) {
      const st=this.planOne(result,result.exitStamps[i],nodes[i]||result.exitNode,result.elevatorSites?result.elevatorSites[i]:null);
      if(st) this.exits.push(st);
    }
    if(this.exits.length){
      const first=this.exits[0];
      this.origin=first.origin; this.hole=first.hole; this.minY=first.minY;
      this.fx=first.fx; this.fz=first.fz; this.rx=first.rx; this.rz=first.rz;
      this.width=first.width; this.depth=first.depth; this.height=first.height;
    }
  },

  local(side, along) {
    if(this.exits.length) return this.exits[0].local(side,along);
    return {x:this.origin.x+this.rx*side+this.fx*along,z:this.origin.z+this.rz*side+this.fz*along};
  },

  containsWorld(x,z){
    // Kept for compatibility with the rest of Level 0. The new facade has no
    // shaft footprint, so there is deliberately no special floor hole.
    return false;
  },
  nearConcrete(x,z){
    for(const st of this.exits){
      if(!st||!st.origin)continue;
      const frontX=-st.fx, frontZ=-st.fz;
      const dx=x-(st.origin.x+frontX*0.35), dz=z-(st.origin.z+frontZ*0.35);
      const along=dx*frontX+dz*frontZ;
      const side=dx*st.rx+dz*st.rz;
      if(along>=-0.35&&along<=2.5&&Math.abs(side)<=st.width*0.7)return true;
    }
    return false;
  },
  playerInside(){ return false; },
  addBox(group,mat,cx,cy,cz,sx,sy,sz){const m=new THREE.Mesh(Geometries.box,mat);m.scale.set(sx,sy,sz);m.position.set(cx,cy,cz);group.add(m);return m;},
  addCol(minx,miny,minz,maxx,maxy,maxz){Level.addBoxCollider(minx,miny,minz,maxx,maxy,maxz);},
  span(st,along,across){return{x:Math.abs(st.rx)*across+Math.abs(st.fx)*along,z:Math.abs(st.rz)*across+Math.abs(st.fz)*along};},
  slab(group,st,mat,side,along,y,alongLen,across,thick){const p=st.local(side,along),sz=this.span(st,alongLen,across);this.addBox(group,mat,p.x,y,p.z,sz.x,thick,sz.z);return p;},

  _facadeMats(){
    // One set of materials for every facade, kept for the whole session: a facade is rebuilt each time its
    // chunk streams back in, and these used to be created (and never disposed) on every rebuild.
    if(this._fm) return this._fm;
    const map=Materials.concrete.map||null;
    this._fm={
      concrete:Materials.concrete, concreteDark:Materials.concreteDark,
      concreteLight:new THREE.MeshStandardMaterial({map:map,color:0xb7b8b3,emissive:0x111212,emissiveIntensity:0.16,roughness:0.92,metalness:0.02}),
      steel:new THREE.MeshStandardMaterial({color:0x686b69,roughness:0.56,metalness:0.68}),
      steelDark:new THREE.MeshStandardMaterial({color:0x292c2b,roughness:0.78,metalness:0.42}),
      indicator:new THREE.MeshStandardMaterial({color:0xd2d7d2,emissive:0x8a958c,emissiveIntensity:0.55,roughness:0.3,metalness:0.15})
    };
    return this._fm;
  },
  lightUnits:[],

  // parent: where the facade is attached (a streamed chunk group in the unbounded world; Level.group otherwise)
  buildOne(parent,st,index){
    const g=new THREE.Group(); g.name='ConcreteElevatorFacade_'+index;
    const fm=this._facadeMats();
    const concrete=fm.concrete, concreteDark=fm.concreteDark, concreteLight=fm.concreteLight, steel=fm.steel, steelDark=fm.steelDark;
    const W=st.width,H=st.height,half=W/2;
    const p=st.origin;
    const L=(side,along)=>st.local(side,along);
    const front=-0.10;
    const doorH=2.42;
    const doorW=(W-0.18)/2;

    // Full-depth elevator cabin. Earlier revisions were effectively a thin
    // wall sandwich: the facade only projected a few inches into the hall.
    // Keep the elevator non-enterable for now, but make it read as a real
    // box with visible depth: floor, ceiling, rear wall, side walls, and a
    // recessed doorway.
    const cabinFront=front;
    const cabinBack=front+W*0+st.depth;
    const rear=L(0,cabinBack);
    const rearSz=this.span(st,0.28,W+0.12);
    this.addBox(g,concreteDark,rear.x,H/2,rear.z,rearSz.x,H,rearSz.z);
    const floor=L(0,(cabinFront+cabinBack)*0.5);
    const floorSz=this.span(st,st.depth,W);
    this.addBox(g,steelDark,floor.x,0.035,floor.z,floorSz.x,0.07,floorSz.z);
    const ceil=L(0,(cabinFront+cabinBack)*0.5);
    this.addBox(g,concreteDark,ceil.x,H-0.05,ceil.z,floorSz.x,0.10,floorSz.z);
    for(const side of [-1,1]){
      const q=L(side*(half-0.06),(cabinFront+cabinBack)*0.5);
      const sz=this.span(st,st.depth,0.14);
      this.addBox(g,concreteLight,q.x,H/2,q.z,sz.x,H,sz.z);
    }

    // Concrete exterior surround around the full-height doorway.
    for(const side of [-1,1]){
      const q=L(side*(half+0.16),front+0.02); const sz=this.span(st,0.34,0.32);
      this.addBox(g,concreteLight,q.x,H/2,q.z,sz.x,H,sz.z);
    }
    const lint=L(0,front+0.02); const lintSz=this.span(st,0.34,W+0.32);
    this.addBox(g,concreteLight,lint.x,H-0.22,lint.z,lintSz.x,0.44,lintSz.z);

    // Recessed dark door pocket at the front of the cabin.
    const pocket=L(0,front+0.08); const pocketSz=this.span(st,0.16,W-0.18);
    this.addBox(g,steelDark,pocket.x,doorH*0.5,pocket.z,pocketSz.x,doorH,pocketSz.z);

    // Sliding doors. Start closed; the approach trigger opens them visually,
    // but the solid backing remains directly behind them.
    const leftClosed=L(-doorW*0.5,front); const rightClosed=L(doorW*0.5,front);
    const doorSize=this.span(st,0.10,doorW);
    const dl=this.addBox(g,steel,leftClosed.x,doorH*0.5,leftClosed.z,doorSize.x,doorH,doorSize.z);
    const dr=this.addBox(g,steel,rightClosed.x,doorH*0.5,rightClosed.z,doorSize.x,doorH,doorSize.z);
    const openOffset=0.34;
    const leftOpen=L(-doorW*0.5-openOffset,front), rightOpen=L(doorW*0.5+openOffset,front);
    const pair={left:dl,right:dr,closedL:leftClosed,closedR:rightClosed,openL:leftOpen,openR:rightOpen,st:st,doorW:doorW,doorH:doorH,openT:0,opening:false};
    this.doorPairs[index]=pair;

    const seam=L(0,front-0.01); const seamSz=this.span(st,0.12,0.028);
    this.addBox(g,steelDark,seam.x,doorH/2,seam.z,seamSz.x,doorH,seamSz.z);
    const top=L(0,front+0.02); const topSz=this.span(st,0.20,W-0.28);
    this.addBox(g,steelDark,top.x,doorH+0.03,top.z,topSz.x,0.06,topSz.z);

    // Small indicator and call button to sell the elevator as part of the wall.
    const indicator=fm.indicator;
    const sign=L(-half-0.24,front-0.02); const signSz=this.span(st,0.08,0.16);
    this.addBox(g,indicator,sign.x,2.02,sign.z,signSz.x,0.06,signSz.z);
    const button=L(half+0.22,front-0.02); const buttonSz=this.span(st,0.08,0.11);
    this.addBox(g,indicator,button.x,1.28,button.z,buttonSz.x,0.10,buttonSz.z);

    // Power gauge: five lamps over the doors, one per restored station.
    // Built here so it lives and dies with the facade; the Activity System
    // owns what it shows.
    if (typeof ActivitySystem !== 'undefined' && st.siteIndex >= 0) ActivitySystem.decorateElevator(g, st, index);

    // A very small pool of light makes the recess readable without creating a
    // bright room around the exit.
    {
      const lp=L(0,front-0.35);
      this.lightUnits[index]=LightingSystem.addLocalLight(lp.x,1.75,lp.z,{intensity:0.72,distance:4.5,decay:1.8,color:0xe9eee8});
    }

    parent.add(g); this.cabGroups[index]=g;

    // Solid rear collider; the cabin remains a visual box rather than a
    // walkable room until we add a real elevator ride.
    const wallCenter=L(0,cabinBack); const wallSz=this.span(st,0.40,W+0.40);
    this.addCol(wallCenter.x- wallSz.x/2,0.0,wallCenter.z-wallSz.z/2,wallCenter.x+wallSz.x/2,H,wallCenter.z+wallSz.z/2);

    // Trigger sits in the hallway before the player can reach the wall.
    const frontX=-st.fx, frontZ=-st.fz;
    const center=L(0,-0.95);
    const trW=W*0.78, trD=1.0;
    const a=L(-trW/2,-1.55), b=L(trW/2,-0.55);
    Level.addTrigger({type:'exit',exitIndex:index,minx:Math.min(a.x,b.x),maxx:Math.max(a.x,b.x),minz:Math.min(a.z,b.z),maxz:Math.max(a.z,b.z)});
  },

  // Chunks call these as they stream. `ci` lists the exit indices whose facade tile lies in the chunk.
  buildForChunk(parent,exitIndices){
    for(const i of exitIndices) if(this.exits[i]&&!this.cabGroups[i]) this.buildOne(parent,this.exits[i],i);
  },
  releaseOne(index){
    const u=this.lightUnits[index]; if(u){ LightingSystem.removeUnit(u); this.lightUnits[index]=null; }
    this.cabGroups[index]=null; this.doorPairs[index]=null;
    if(typeof Level0Activities!=='undefined'&&Level0Activities.releaseElevator) Level0Activities.releaseElevator(index);
  },
  // Bounded legacy maps (Test Beta) build every facade up front.
  build(sceneRef){
    if(!this.exits.length||!Level.group)return;
    for(let i=0;i<this.exits.length;i++)this.buildOne(Level.group,this.exits[i],i);
  },

  startSequence(index){
    // Level 1 may only begin from an actual Level 0 exit trigger.
    if(this.sequenceActive || GameState.phase!=='playing' || GameState.level!==0 || !this.reached) return;
    // An elevator whose stations are not all restored must never start the ride,
    // whatever path asked for it.
    if(typeof ActivitySystem!=='undefined' && !ActivitySystem.canUseElevator(index|0)) { this.reached=false; GameState.exitReached=false; return; }
    const pair=this.doorPairs[index|0];
    if(!pair)return;
    this.transitionToken++;
    if (this.pendingTransitionTimer !== null) {
      clearTimeout(this.pendingTransitionTimer);
      this.pendingTransitionTimer = null;
    }
    const transitionToken = this.transitionToken;
    this.sequenceActive=true; this.sequenceT=0; this.sequenceExitIndex=index|0; this.reached=true; GameState.exitReached=true;
    GameState.cinematicCamera=true;
    clearInput();
    pair.opening=true; pair.openT=0;
    const ov=document.getElementById('elevator-sequence');
    if(ov){ ov.style.display='flex'; ov.style.background='rgba(3,4,5,.05)'; }
    const title=document.getElementById('elevator-status'); if(title)title.textContent='ELEVATOR DOORS OPENING';
    const bar=document.getElementById('elevator-fill'); if(bar)bar.style.width='0%';
    const floor=document.getElementById('elevator-floor'); if(floor)floor.textContent='LOADING LEVEL 1';
    setPauseOverlay(false);
    if(document.pointerLockElement)document.exitPointerLock();
    AudioSystem._tone&&AudioSystem._tone(72,'sine',0.18,0.05,'events');
  },

  update(dt){
    if(!this.sequenceActive)return;
    this.sequenceT+=dt;
    const t=this.sequenceT;
    const pair=this.doorPairs[this.sequenceExitIndex];
    if(pair){
      const openT=Math.min(1,Math.max(0,(t-0.05)/0.75));
      const eased=1-Math.pow(1-openT,3);
      pair.left.position.lerpVectors(pair.closedL,pair.openL,eased);
      pair.right.position.lerpVectors(pair.closedR,pair.openR,eased);
    }
    // Let the doors open briefly, then replace the cinematic with the normal
    // loading screen. There is no elevator ride and no player teleport inside
    // an elevator cabin anymore.
    if(t>=0.85){
      const status=document.getElementById('elevator-status'); if(status)status.textContent='GENERATING LEVEL 1';
      const bar=document.getElementById('elevator-fill'); if(bar)bar.style.width='22%';
      const ov=document.getElementById('elevator-sequence'); if(ov)ov.style.background='rgba(3,4,5,.78)';
    }
    if(t<1.0)return;
    const elapsed=GameState.elapsed;
    const runId = GameState.runId;
    this.sequenceActive=false;
    GameState.cinematicCamera=false; GameState.elevatorShake=0;
    const exitState=this.exits[this.sequenceExitIndex];
    const exitSeed=((GameState.seed^0x51f15e5d)>>>0)||1;
    // Yield one frame so the loading overlay is actually painted before the
    // synchronous Level 1 build/stream work begins.
    this.pendingTransitionTimer=setTimeout(()=>{
      this.pendingTransitionTimer=null;
      if (transitionToken !== this.transitionToken || GameState.phase !== 'playing' || runId !== GameState.runId) return;
      const go = async () => {
        if(typeof Level1!=='undefined') await Level1.enter(exitSeed,exitState);
        if(typeof Level1==='undefined' || !Level1.active) throw new Error('Level1.enter() completed without activating Level 1');
        // Place the player at the destination while the shared transition
        // curtain is still closed. The persistent cabin can then follow the
        // destination spawn before its doors open.
        const level1Floor = (typeof Level1 !== 'undefined') ? Level1.baseY : 0;
        Player.position.set(exitState.origin.x-0.95*exitState.fx,level1Floor,exitState.origin.z-0.95*exitState.fz);
        Player.velocity.set(0,0,0); Player.onGround=true;
        Player.yaw=Math.atan2(-exitState.fx,-exitState.fz); Player.pitch=0;
        GameState.elapsed=elapsed; GameState.distance=0; GameState.exitReached=false;
      };
      const elev=document.getElementById('elevator-sequence'); if(elev) elev.style.display='none';
      const transition = (typeof VoidTransition !== 'undefined')
        ? VoidTransition.then(go, { from: 0, to: 1, physical: true })
        : Promise.resolve().then(go).then(() => true);
      transition.then((succeeded)=>{
        if (!succeeded) throw new Error('The Level 0 → Level 1 transition did not complete');
        if (GameState.phase !== 'playing' || transitionToken !== this.transitionToken || runId !== GameState.runId) return;
        const bar=document.getElementById('elevator-fill'); if(bar)bar.style.width='100%';
        const status=document.getElementById('elevator-status'); if(status)status.textContent='LEVEL 1 READY';
        const floor=document.getElementById('elevator-floor'); if(floor)floor.textContent='ENTERING LEVEL 1';
        setTimeout(()=>{
          if (runId !== GameState.runId || GameState.phase !== 'playing') return;
          const ov=document.getElementById('elevator-sequence'); if(ov)ov.style.display='none';
          const obj=document.getElementById('hud-obj'); if(obj)obj.textContent='Objective: explore Level 1';
          const lvl=document.getElementById('hud-level-label'); if(lvl)lvl.textContent='LEVEL 1';
          if(window.MobileControls&&window.MobileControls.isMobile) Input.locked=true;
          else if (renderer && renderer.domElement) renderer.domElement.requestPointerLock();
        },80);
      }).catch((err)=>{
        console.error('LEVEL 1 TRANSITION FAILED',err);
        const status=document.getElementById('elevator-status'); if(status)status.textContent='LEVEL 1 LOAD FAILED';
        setTimeout(()=>{
          if (runId !== GameState.runId) return;
          const ov=document.getElementById('elevator-sequence');if(ov)ov.style.display='none';
        },900);
      });
    },40);
  }
};


/* ------------------------------------------------------------------
   LEVEL / MAP — consumes generated tiles
   ------------------------------------------------------------------ */

const MAP_STRINGS_UNUSED = [
  "################################################",
  "#..............####..............####..........#",
  "#..............####..............####..........#",
  "#..##########..####..##########.........####...#",
  "#..#........#..####..#........#.........#  #...#",
  "#..#........#........#........#.........#  #...#",
  "#..#...C....#........#...C....##########.......#",
  "#..#........##########.........................#",
  "#..#........#........+........+....#####..######",
  "#...........#.........................###......#",
  "#...........#..#####.....##.....##....###......#",
  "#####..######..#...#.....##.....##.............#",
  "#..............#...#..............##...........#",
  "#..S...........#...#..............##.....K.....#",
  "#..............#####..######..###########..#####",
  "#.....................#....#...................#",
  "##########.....C......#....#.....C....##########",
  "#........#............#....#............#......#",
  "#........#..#######...######...#######..#......#",
  "#........#..#.....#............#.....#..#......#",
  "#...........#.....+............+.....#.........#",
  "#...........#.....#....####....#.....#.........#",
  "#####..######.....#....#  #....#.....######..###",
  "#.................#....#  #....#...............#",
  "#..###########..........  ...........########..#",
  "#..#.........#...C............C......#......#..#",
  "#..#.........#.......................#......#..#",
  "#..#....C....##########...###########.......#..#",
  "#..#........................................#..#",
  "#..######################.###################..#",
  "#......................#...#...................#",
  "#......................#...#..............E....#",
  "#..#####..######..######...######..#####.......#",
  "#..#...........#...............#...............#",
  "#..#...........#...............#..###########..#",
  "#..............#####.....C.....#...............#",
  "#..............................#...............#",
  "################################################"
];

/* ------------------------------------------------------------------
   MERGED BOX GEOMETRY
   Level 0 used to create one BoxGeometry (and one draw call) per wall run: hundreds per chunk. A chunk
   now builds ONE geometry for all of its wall runs. Vertex order, normals and UVs are exactly those of
   THREE.BoxGeometry + applyBoxUVs, so lighting and the wallpaper's tiling are unchanged; only side faces
   that are completely buried against neighbouring wall (or that can never be seen: the top and bottom of
   a wall that meets the ceiling and floor) are left out.
   items: [cx, cy, cz, w, h, d, skipMask]   skipMask bits: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z
   wallUV: tilesPerMeter for wall-style UVs, or 0 for BoxGeometry's default 0..1 per face.
   ------------------------------------------------------------------ */
const MergedBoxes = {
  build(items, wallUV) {
    let faces = 0;
    for (let i = 0; i < items.length; i++) { const m = items[i][6] | 0; for (let b = 0; b < 6; b++) if (!(m & (1 << b))) faces++; }
    const pos = new Float32Array(faces * 12), nor = new Float32Array(faces * 12), uv = new Float32Array(faces * 8);
    const IndexArray = faces * 4 > 65535 ? Uint32Array : Uint16Array;
    const idx = new IndexArray(faces * 6);
    let f = 0;
    for (let n = 0; n < items.length; n++) {
      const it = items[n], cx = it[0], cy = it[1], cz = it[2], w = it[3], h = it[4], d = it[5], mask = it[6] | 0;
      const hw = w / 2, hh = h / 2, hd = d / 2, t = wallUV || 0;
      // vertex tables: v0 (ix0,iy0), v1 (ix1,iy0), v2 (ix0,iy1), v3 (ix1,iy1) as THREE.BoxGeometry builds them
      const F = [
        [1, 0, 0, [[hw, hh, hd], [hw, hh, -hd], [hw, -hh, hd], [hw, -hh, -hd]], d * t, h * t],     // +x
        [-1, 0, 0, [[-hw, hh, -hd], [-hw, hh, hd], [-hw, -hh, -hd], [-hw, -hh, hd]], d * t, h * t], // -x
        [0, 1, 0, [[-hw, hh, -hd], [hw, hh, -hd], [-hw, hh, hd], [hw, hh, hd]], w * t, d * t],      // +y
        [0, -1, 0, [[-hw, -hh, hd], [hw, -hh, hd], [-hw, -hh, -hd], [hw, -hh, -hd]], w * t, d * t], // -y
        [0, 0, 1, [[-hw, hh, hd], [hw, hh, hd], [-hw, -hh, hd], [hw, -hh, hd]], w * t, h * t],      // +z
        [0, 0, -1, [[hw, hh, -hd], [-hw, hh, -hd], [hw, -hh, -hd], [-hw, -hh, -hd]], w * t, h * t]  // -z
      ];
      for (let b = 0; b < 6; b++) {
        if (mask & (1 << b)) continue;
        const fc = F[b], v = fc[3], us = t ? fc[4] : 1, vs = t ? fc[5] : 1;
        const p = f * 12, q = f * 8, base = f * 4;
        for (let k = 0; k < 4; k++) {
          pos[p + k * 3] = cx + v[k][0]; pos[p + k * 3 + 1] = cy + v[k][1]; pos[p + k * 3 + 2] = cz + v[k][2];
          nor[p + k * 3] = fc[0]; nor[p + k * 3 + 1] = fc[1]; nor[p + k * 3 + 2] = fc[2];
        }
        uv[q] = 0; uv[q + 1] = vs; uv[q + 2] = us; uv[q + 3] = vs; uv[q + 4] = 0; uv[q + 5] = 0; uv[q + 6] = us; uv[q + 7] = 0;
        const i = f * 6;
        idx[i] = base; idx[i + 1] = base + 2; idx[i + 2] = base + 1; idx[i + 3] = base + 2; idx[i + 4] = base + 3; idx[i + 5] = base + 1;
        f++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (geo.computeBoundingSphere) geo.computeBoundingSphere();
    return geo;
  }
};

/* ------------------------------------------------------------------
   LEVEL / MAP
   Two kinds of map feed this object:
     world   the unbounded Level0World (the normal game). Tiles are looked up region by region; nothing
             is stored per level. Colliders, meshes, lights, elevator facades, stations, wall marks and
             decorations all live in streamed 24 x 24 tile chunks.
     tiles   a bounded array (the Test Beta generator). Built whole, as before.
   ------------------------------------------------------------------ */
const Level = {
  cols: 0,
  rows: 0,
  tiles: [],
  world: null,
  colliders: [], // axis-aligned boxes {min,max} THREE.Vector3: in world mode, the chunks around the player
  triggers: [],
  startPos: new THREE.Vector3(2, 0, 2),
  group: null,
  darkFogGroup: null,
  chunks: new Map(),
  chunkTiles: 24,
  streamRadius: 3,
  lastChunk: "",
  worldMin: new THREE.Vector3(),
  worldMax: new THREE.Vector3(),
  physRadius: 2,          // chunks (each way) whose terrain colliders exist; the 3 x 3 around the player is always meshed too
  keepSeconds: 5,         // a chunk that leaves the view stays loaded this long (turning on the spot used to rebuild chunks)
  meshBudgetMs: 6,        // chunk-mesh work per frame outside the near ring (set from Quality)
  _ctx: null,
  _collChunks: new Map(),
  _queue: [],
  _wantedAt: new Map(),
  _centerKey: "",
  _exitChunks: new Map(),
  _shared: null,
  _prefetchT: 0,
  stats: { chunksBuilt: 0, chunkMs: 0, maxChunkMs: 0, chunksUnloaded: 0, queueMax: 0 },

  // Fog for Level 0 at the distance the graphics profile allows (High is the original 58..175 m).
  fogFar() { return (typeof Quality !== "undefined") ? Quality.profile.fogFar : (CONFIG.fogFar || 175); },
  makeFog() {
    const q = (typeof Quality !== "undefined") ? Quality.level0Fog() : { near: CONFIG.fogNear, far: CONFIG.fogFar };
    return new THREE.Fog(CONFIG.fogColor, q.near, q.far);
  },
  inBounds(tx, tz) {
    if (this.world) return true;
    tx = tx | 0; tz = tz | 0;
    return tz >= 0 && tz < this.rows && tx >= 0 && tx < this.cols;
  },
  getTile(tx, tz) {
    if (this.world) return this.world.tile(tx, tz);
    tx = tx | 0; tz = tz | 0;
    if (!this.inBounds(tx, tz)) return TILE.WALL;
    return this.tiles[tz][tx];
  },
  isSolidTile(t) {
    return t === TILE.WALL;
  },
  tileToWorld(tx, tz) {
    return {
      x: (tx + 0.5) * CONFIG.tile,
      z: (tz + 0.5) * CONFIG.tile
    };
  },

  loadGenerated(result) {
    this.triggers.length = 0;
    this.pathMeters = result.pathMeters || 0;
    this.targetPath = result.targetPath || 0;
    if (result.world) {
      this.world = result.world;
      this.tiles = [];
      this.rows = Infinity; this.cols = Infinity;
      this.worldMin.set(-Infinity, -2, -Infinity);
      this.worldMax.set(Infinity, CONFIG.wallH + 2, Infinity);
      MapGraph.reset();
      MapGraph.provider = result.world;
    } else {
      this.world = null;
      MapGraph.provider = null;
      this.tiles = result.tiles;
      this.rows = result.rows;
      this.cols = result.cols;
      this.worldMin.set(0, -1, 0);
      this.worldMax.set(this.cols * CONFIG.tile, CONFIG.wallH + 2, this.rows * CONFIG.tile);
    }
  },

  clear(sceneRef) {
    const s = sceneRef || scene;
    LightingSystem.clear(s);
    const disposeMaterial = (mat) => {
      if (!mat || !mat.dispose) return;
      const texKeys = ["map","alphaMap","aoMap","bumpMap","normalMap","roughnessMap","metalnessMap","emissiveMap"];
      for (const key of texKeys) {
        const tex = mat[key];
        if (tex && tex.dispose) tex.dispose();
      }
      mat.dispose();
    };
    const protectedMaterials = new Set(Object.values(Materials).filter(v => v && v.isMaterial));
    if (this._shared) { for (const m of this._shared.materials) protectedMaterials.add(m); }
    const sharedGeos = new Set([Geometries.box, Geometries.lightPanel, Geometries.lightHousing, Geometries.floorTile, Geometries.column, Geometries.beam]);
    if (this._shared) { sharedGeos.add(this._shared.floorGeo); sharedGeos.add(this._shared.ceilGeo); }
    const disposeObjectResources = (root) => {
      if (!root) return;
      root.traverse((obj) => {
        if (obj.geometry && obj.geometry.dispose && !sharedGeos.has(obj.geometry)) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat && mat.isMaterial && !protectedMaterials.has(mat)) disposeMaterial(mat);
        }
      });
    };
    if (this.group && s) {
      disposeObjectResources(this.group);
      s.remove(this.group);
    }
    if (this.darkFogGroup && s) {
      disposeObjectResources(this.darkFogGroup);
      s.remove(this.darkFogGroup);
    }
    this.group = null;
    this.darkFogGroup = null;
    this.chunks = new Map();
    this.lastChunk = "";
    this.colliders.length = 0;
    this.triggers.length = 0;
    this._collChunks = new Map();
    this._queue.length = 0;
    this._wantedAt = new Map();
    this._centerKey = "";
    this._exitChunks = new Map();
    this._ctx = null; this._job = null; this._planNext = null;
    if (this._shared) { this._shared.floorMat.map && this._shared.floorMat.map.dispose && this._shared.floorMat.map.dispose(); this._shared.ceilMat.map && this._shared.ceilMat.map.dispose && this._shared.ceilMat.map.dispose(); this._shared.floorMat.dispose(); this._shared.ceilMat.dispose(); this._shared.floorGeo.dispose(); this._shared.ceilGeo.dispose(); this._shared = null; }
    this.world = null;
    if (MapGraph) MapGraph.provider = null;
    Stairwell.reset();
    // Leaving Level 0 ends the visit: activity progress is per visit, never saved.
    if (typeof ActivitySystem !== "undefined") ActivitySystem.endVisit(0);
    if (typeof Level0Markings !== "undefined") Level0Markings.resetShared();
    if (typeof PassC !== "undefined" && PassC.resetWorld) PassC.resetWorld();
    if (typeof DebugPath !== "undefined") DebugPath.hide();
  },

  addBoxCollider(minx, miny, minz, maxx, maxy, maxz) {
    const c = { min: new THREE.Vector3(minx, miny, minz), max: new THREE.Vector3(maxx, maxy, maxz) };
    if (this._ctx) this._ctx.colliders.push(c); else this.colliders.push(c);
  },
  addTrigger(t) {
    if (this._ctx) this._ctx.triggers.push(t);
    this.triggers.push(t);
  },

  /* ---- wall runs: greedy rectangles of solid tiles inside one chunk (used for meshes AND colliders) ---- */
  wallRuns(x0, z0, x1, z1) {
    const out = [], w = x1 - x0, used = new Uint8Array(w * (z1 - z0));
    const solid = (x, z) => this.getTile(x, z) === TILE.WALL;
    // read the chunk's tiles once
    const sol = new Uint8Array(w * (z1 - z0));
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) sol[(z - z0) * w + (x - x0)] = solid(x, z) ? 1 : 0;
    for (let z = z0; z < z1; z++) {
      for (let x = x0; x < x1; x++) {
        const i = (z - z0) * w + (x - x0);
        if (used[i] || !sol[i]) continue;
        let x2 = x;
        while (x2 + 1 < x1 && sol[(z - z0) * w + (x2 + 1 - x0)] && !used[(z - z0) * w + (x2 + 1 - x0)]) x2++;
        let z2 = z, canGrow = true;
        while (canGrow && z2 + 1 < z1) {
          for (let xx = x; xx <= x2; xx++) { const j = (z2 + 1 - z0) * w + (xx - x0); if (!sol[j] || used[j]) { canGrow = false; break; } }
          if (canGrow) z2++;
        }
        for (let zz = z; zz <= z2; zz++) for (let xx = x; xx <= x2; xx++) used[(zz - z0) * w + (xx - x0)] = 1;
        out.push([x, z, x2, z2]);
      }
    }
    return out;
  },

  /* Legacy bounded map: one set of colliders for the whole thing. */
  buildColliders() {
    this.colliders.length = 0;
    const T = CONFIG.tile, H = CONFIG.wallH;
    for (const r of this.wallRuns(0, 0, this.cols, this.rows)) this.addBoxCollider(r[0] * T, 0, r[1] * T, (r[2] + 1) * T, H, (r[3] + 1) * T);
    const W = this.cols * T, D = this.rows * T, thick = 2;
    this.addBoxCollider(0, -2, 0, W, 0.0, D);                      // floor slab
    this.addBoxCollider(-thick, -2, -thick, 0, H + 2, D + thick);
    this.addBoxCollider(W, -2, -thick, W + thick, H + 2, D + thick);
    this.addBoxCollider(-thick, -2, -thick, W + thick, H + 2, 0);
    this.addBoxCollider(-thick, -2, D, W + thick, H + 2, D + thick);
    this.addBoxCollider(-thick, H, -thick, W + thick, H + 2, D + thick); // ceiling slab
    for (let z = 0; z < this.rows; z++) for (let x = 0; x < this.cols; x++) {
      if (this.getTile(x, z) !== TILE.COLUMN) continue;
      const w = this.tileToWorld(x, z), r = 0.32;
      this.addBoxCollider(w.x - r, 0, w.z - r, w.x + r, H, w.z + r);
    }
  },

  /* ---- chunk terrain colliders (world mode) ---- */
  _collFor(cx, cz) {
    const key = cx + "," + cz;
    let rec = this._collChunks.get(key);
    if (rec) return rec;
    const S = this.chunkTiles, T = CONFIG.tile, H = CONFIG.wallH;
    const x0 = cx * S, z0 = cz * S, x1 = x0 + S, z1 = z0 + S;
    const boxes = [];
    const mk = (a, b, c, d, e, f) => boxes.push({ min: new THREE.Vector3(a, b, c), max: new THREE.Vector3(d, e, f) });
    for (const r of this.wallRuns(x0, z0, x1, z1)) mk(r[0] * T, 0, r[1] * T, (r[2] + 1) * T, H, (r[3] + 1) * T);
    mk(x0 * T, -2, z0 * T, x1 * T, 0, z1 * T);          // floor slab
    mk(x0 * T, H, z0 * T, x1 * T, H + 2, z1 * T);       // ceiling slab: nothing climbs over the walls
    rec = { cx, cz, boxes };
    this._collChunks.set(key, rec);
    return rec;
  },
  _syncColliders(pcx, pcz) {
    const R = this.physRadius;
    for (const [k, rec] of this._collChunks) if (Math.abs(rec.cx - pcx) > R + 1 || Math.abs(rec.cz - pcz) > R + 1) this._collChunks.delete(k);
    const out = this.colliders;
    out.length = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const rec = this._collFor(pcx + dx, pcz + dz);
      for (let i = 0; i < rec.boxes.length; i++) out.push(rec.boxes[i]);
    }
    for (const [, c] of this.chunks) {
      if (!c.colliders || !c.colliders.length) continue;
      if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R) continue;
      for (let i = 0; i < c.colliders.length; i++) out.push(c.colliders[i]);
    }
  },

  /* ---- meshes ---- */
  buildMeshes(scene) {
    this.group = new THREE.Group();
    this.group.name = "LevelMeshes";
    this.chunks = new Map();
    this.lastChunk = "";
    this._queue.length = 0;
    if (this.world) {
      const st = LevelGenerator.last && LevelGenerator.last.startStamp;
      if (st) { const w = this.tileToWorld(st.x, st.z); this.startPos.set(w.x, 0, w.z); }
      this._indexExits();
    } else {
      for (let z = 0; z < this.rows; z++) for (let x = 0; x < this.cols; x++) {
        if (this.getTile(x, z) === TILE.START) { const w = this.tileToWorld(x, z); this.startPos.set(w.x, 0, w.z); }
      }
    }
    LightingSystem.ensurePool(scene);
    if (typeof CameraRig !== "undefined" && CameraRig.camera && typeof Quality !== "undefined") { CameraRig.camera.far = Quality.profile.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
    scene.add(this.group);
    this.stream(true);
  },
  _indexExits() {
    this._exitChunks = new Map();
    const S = this.chunkTiles;
    Stairwell.exits.forEach((st, i) => {
      const es = st.exitStamp; if (!es) return;
      const key = Math.floor(es.x / S) + "," + Math.floor(es.z / S);
      if (!this._exitChunks.has(key)) this._exitChunks.set(key, []);
      this._exitChunks.get(key).push(i);
    });
  },
  _sharedRes() {
    if (this._shared) return this._shared;
    const T = CONFIG.tile, S = this.chunkTiles, fw = S * T;
    const floorMap = Materials.carpet.map.clone();
    floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
    floorMap.repeat.set(fw / 2.2, fw / 2.2); floorMap.needsUpdate = true;
    const floorMat = Materials.carpet.clone(); floorMat.map = floorMap;
    const ceilMap = Materials.ceiling.map.clone();
    ceilMap.wrapS = ceilMap.wrapT = THREE.RepeatWrapping;
    ceilMap.repeat.set(fw / 2.4, fw / 2.4); ceilMap.needsUpdate = true;
    const ceilMat = Materials.ceiling.clone(); ceilMat.map = ceilMap;
    // one floor plane and one ceiling plane, shared by every chunk
    this._shared = { floorGeo: new THREE.PlaneGeometry(fw, fw), ceilGeo: new THREE.PlaneGeometry(fw, fw), floorMat, ceilMat, materials: [floorMat, ceilMat] };
    return this._shared;
  },
  buildChunk(cx, cz) {
    const key = cx + "," + cz;
    if (this.chunks.has(key) || !this.group) return;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const T = CONFIG.tile, H = CONFIG.wallH, S = this.chunkTiles;
    const x0 = cx * S, z0 = cz * S;
    const x1 = this.world ? x0 + S : Math.min(this.cols, x0 + S), z1 = this.world ? z0 + S : Math.min(this.rows, z0 + S);
    if (!this.world && (x0 >= this.cols || z0 >= this.rows)) return;
    const g = new THREE.Group();
    g.name = "L0_" + key;
    const rec = { group: g, cx, cz, lights: [], markings: null, colliders: [], triggers: [], exits: [], crates: null, own: [], housing: null };
    this._ctx = rec;
    const minx = x0 * T, minz = z0 * T, maxx = x1 * T, maxz = z1 * T;
    const fw = maxx - minx, fd = maxz - minz;
    if (this.world) { try { if (typeof PassC !== "undefined" && PassC.ensureAround) PassC.ensureAround(x0, z0, x1, z1); } catch (e) { console.error(e); } }
    if (fw > 0.05 && fd > 0.05) {
      if (fw === S * T && fd === S * T) {
        const sh = this._sharedRes();
        const floor = new THREE.Mesh(sh.floorGeo, sh.floorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.set((minx + maxx) * 0.5, 0, (minz + maxz) * 0.5);
        g.add(floor);
        const ceil = new THREE.Mesh(sh.ceilGeo, sh.ceilMat);
        ceil.rotation.x = Math.PI / 2; ceil.position.set((minx + maxx) * 0.5, H, (minz + maxz) * 0.5);
        g.add(ceil);
      } else {
        // a partial chunk at the edge of a bounded map
        const floorMap = Materials.carpet.map.clone();
        floorMap.wrapS = floorMap.wrapT = THREE.RepeatWrapping;
        floorMap.repeat.set(Math.max(1, fw / 2.2), Math.max(1, fd / 2.2)); floorMap.needsUpdate = true;
        const floorMat = Materials.carpet.clone(); floorMat.map = floorMap;
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.set((minx + maxx) * 0.5, 0, (minz + maxz) * 0.5);
        g.add(floor);
        const ceilMap = Materials.ceiling.map.clone();
        ceilMap.wrapS = ceilMap.wrapT = THREE.RepeatWrapping;
        ceilMap.repeat.set(Math.max(1, fw / 2.4), Math.max(1, fd / 2.4)); ceilMap.needsUpdate = true;
        const ceilMat = Materials.ceiling.clone(); ceilMat.map = ceilMap;
        const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), ceilMat);
        ceil.rotation.x = Math.PI / 2; ceil.position.set((minx + maxx) * 0.5, H, (minz + maxz) * 0.5);
        g.add(ceil);
      }
    }
    // walls: every run of this chunk in ONE mesh (one draw call)
    const runs = this.wallRuns(x0, z0, x1, z1);
    if (runs.length) {
      const allSolid = (xa, xb, zz) => { for (let x = xa; x <= xb; x++) if (this.getTile(x, zz) !== TILE.WALL) return false; return true; };
      const allSolidZ = (za, zb, xx) => { for (let z = za; z <= zb; z++) if (this.getTile(xx, z) !== TILE.WALL) return false; return true; };
      const items = [];
      for (const r of runs) {
        const sx = (r[2] - r[0] + 1) * T, sz = (r[3] - r[1] + 1) * T;
        let mask = 4 | 8;                                   // top meets the ceiling, bottom the floor
        if (allSolidZ(r[1], r[3], r[2] + 1)) mask |= 1;     // +x face buried
        if (allSolidZ(r[1], r[3], r[0] - 1)) mask |= 2;     // -x
        if (allSolid(r[0], r[2], r[3] + 1)) mask |= 16;     // +z
        if (allSolid(r[0], r[2], r[1] - 1)) mask |= 32;     // -z
        items.push([(r[0] + r[2] + 1) * T * 0.5, H * 0.5, (r[1] + r[3] + 1) * T * 0.5, sx, H, sz, mask]);
      }
      const geo = MergedBoxes.build(items, 0.5);
      const mesh = new THREE.Mesh(geo, Materials.wall);
      mesh.name = "L0_walls";
      g.add(mesh);
    }
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      if (this.getTile(x, z) === TILE.COLUMN) {
        const w = this.tileToWorld(x, z);
        const col = new THREE.Mesh(Geometries.column, Materials.column);
        col.position.set(w.x, H * 0.5, w.z);
        g.add(col);
        if (this.world) { const r = 0.32; this.addBoxCollider(w.x - r, 0, w.z - r, w.x + r, H, w.z + r); }
      }
    }
    // fixtures. Their state is a function of the fixture's position, so a chunk always comes back as it was.
    const housing = [];
    const fixture = (tx, tz, withPoint, scale) => {
      const w = this.tileToWorld(tx, tz);
      const roll = (typeof Level0World !== "undefined" ? Level0World.hash((GameState.seed | 0), tx, tz, 0xF1C7) : 0) / 4294967296;
      const state = roll < 0.012 ? "BROKEN" : roll < 0.05 ? "FLICKERING" : roll < 0.14 ? "DIM" : "NORMAL";
      const unit = LightingSystem.addFluorescent(g, w.x, H - 0.06, w.z, withPoint, scale, state, housing);
      if (unit) rec.lights.push(unit);
    };
    if (LevelGenerator.last && LevelGenerator.last.beta) {
      for (let z = z0 + 3; z < z1 - 1; z += 6) for (let x = x0 + 3; x < x1 - 1; x += 6) {
        if (this.getTile(x, z) === TILE.WALL || this.getTile(x, z) === TILE.COLUMN) continue;
        // a bounded beta field has few lights; a handful of them carry real lights (the pool hands them out)
        fixture(x, z, ((x - x0 - 3) / 6 + (z - z0 - 3) / 6) % 3 === 0, 1.16);
      }
    } else if (this.world) {
      const RT = Level0World.RT, rx = Math.floor(x0 / RT), rz = Math.floor(z0 / RT);
      const reg = this.world.region(rx, rz);
      const per = RT / S, lk = Math.floor((x0 - rx * RT) / S) + per * Math.floor((z0 - rz * RT) / S);
      const list = reg.lightsByChunk[lk];
      if (list) for (const l of list) fixture(l.tx, l.tz, true, l.profile === "BRIGHT" ? 1.42 : 1.16);
    } else if (typeof MapGraph !== "undefined") {
      for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
        const mod = MapGraph.nodes[ni];
        if (!mod || mod.lightProfile === "DARK") continue;
        const tx = Math.floor(mod.gx + mod.w * 0.5) * LevelGenerator.CELL + 2;
        const tz = Math.floor(mod.gz + mod.h * 0.5) * LevelGenerator.CELL + 2;
        if (tx < x0 || tx >= x1 || tz < z0 || tz >= z1) continue;
        if (!this.inBounds(tx, tz) || this.getTile(tx, tz) === TILE.WALL) continue;
        fixture(tx, tz, true, mod.lightProfile === "BRIGHT" ? 1.42 : 1.16);
      }
    }
    if (housing.length) {
      const items = housing.map((p) => [p[0], p[1], p[2], 1.72, 0.08, 0.58, 0]);
      const hm = new THREE.Mesh(MergedBoxes.build(items, 0), Materials.lightHousing);
      hm.name = "L0_housings";
      g.add(hm);
    }
    // elevator facades whose wall tile lies in this chunk
    const ex = this._exitChunks.get(key);
    if (ex && this.world) { rec.exits = ex.slice(); Stairwell.buildForChunk(g, ex); }
    if (this.world) {
      // terrain colliders for this chunk's surroundings exist already (see stream()); the extras (facades,
      // station panels) are added to rec.colliders by the pieces above and below
    }
    if (typeof ActivitySystem !== "undefined") ActivitySystem.onChunkBuilt(0, key, g, minx, minz, maxx, maxz);
    if (typeof PassC !== "undefined" && PassC.buildChunk && this.world) rec.crates = PassC.buildChunk(g, x0, z0, x1, z1);
    const markings = (typeof Level0Markings !== "undefined") ? Level0Markings.buildChunk(g, x0, z0, x1, z1) : null;
    rec.markings = markings;
    if (this.world && typeof PickupSystem !== "undefined" && PickupSystem.ensureLevel0Around) PickupSystem.ensureLevel0Around((x0 + x1) * 0.5 * T, (z0 + z1) * 0.5 * T);
    this._ctx = null;
    this.group.add(g);
    this.chunks.set(key, rec);
    const dt = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    this.stats.chunksBuilt++; this.stats.chunkMs += dt; if (dt > this.stats.maxChunkMs) this.stats.maxChunkMs = dt;
  },
  unloadChunk(key) {
    const rec = this.chunks.get(key);
    if (!rec) return;
    if (rec.group && rec.group.parent) rec.group.parent.remove(rec.group);
    if (typeof ActivitySystem !== "undefined") ActivitySystem.onChunkUnloaded(0, key);
    if (rec.markings && typeof Level0Markings !== "undefined") Level0Markings.disposeChunk(rec);
    if (rec.crates && typeof PassC !== "undefined") PassC.disposeChunk(rec.crates);
    for (const i of rec.exits || []) Stairwell.releaseOne(i);
    for (const u of rec.lights) LightingSystem.removeUnit(u);
    if (rec.triggers && rec.triggers.length) {
      const dead = new Set(rec.triggers);
      this.triggers = this.triggers.filter((t) => !dead.has(t));
    }
    // geometry owned by this chunk (the merged walls and housings); materials and the shared planes stay
    const sh = this._shared;
    rec.group.traverse((o) => {
      if (o.geometry && o.geometry.dispose && !(sh && (o.geometry === sh.floorGeo || o.geometry === sh.ceilGeo)) &&
          o.geometry !== Geometries.box && o.geometry !== Geometries.column && o.geometry !== Geometries.lightPanel &&
          o.geometry !== Geometries.lightHousing && !o.userData.keepGeometry) o.geometry.dispose();
      if (o.userData && o.userData.ownMaterial && o.material && o.material.dispose) o.material.dispose();
    });
    this.chunks.delete(key);
    this._wantedAt.delete(key);
    this.stats.chunksUnloaded++;
  },
  // Standing chunk, its neighbours, and whatever the view hits out to the fog.
  // A circle shows its edge in an open room. A cone does not.
  wantedChunks(cx, cz, px, pz) {
    const S = this.chunkTiles, T = CONFIG.tile, CS = S * T;
    const reach = this.fogFar() + CS;
    const half = ((CONFIG.fovDeg || 84) * 0.5 + 12) * Math.PI / 180;
    const cosH = Math.cos(half);
    const yaw = (Player && Player.yaw != null) ? Player.yaw : 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const span = Math.ceil(reach / CS);
    const out = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const near = Math.max(Math.abs(dx), Math.abs(dz)) <= 1;
        if (near) { out.push([dx, dz]); continue; }
        const ccx = (cx + dx + 0.5) * CS, ccz = (cz + dz + 0.5) * CS;
        const vx = ccx - px, vz = ccz - pz;
        const dist = Math.hypot(vx, vz);
        if (dist > reach || dist < 0.001) continue;
        if ((vx / dist) * fx + (vz / dist) * fz >= cosH) out.push([dx, dz]);
      }
    }
    return out;
  },
  stream(force) {
    if (!this.group || (!this.world && (!this.tiles || !this.tiles.length))) return;
    if (!force && GameState.level !== 0) return;
    const S = this.chunkTiles, T = CONFIG.tile;
    const px = (Player && Player.position) ? Player.position.x : this.startPos.x;
    const pz = (Player && Player.position) ? Player.position.z : this.startPos.z;
    const cx = Math.floor(px / (S * T));
    const cz = Math.floor(pz / (S * T));
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    if (this.world) {
      // terrain colliders around the player, built before anything can walk into them
      const ck = cx + "," + cz;
      if (force || ck !== this._centerKey) { this._centerKey = ck; this._syncColliders(cx, cz); this._collDirty = false; }
    }
    const yawKey = Math.round(((Player && Player.yaw) || 0) * 4);
    const key = cx + "," + cz + "," + yawKey;
    if (force || key !== this.lastChunk) {
      this.lastChunk = key;
      const wanted = this.wantedChunks(cx, cz, px, pz);
      const queue = [];
      for (const [dx, dz] of wanted) {
        const k = (cx + dx) + "," + (cz + dz);
        this._wantedAt.set(k, now);
        if (this.chunks.has(k)) continue;
        if (Math.max(Math.abs(dx), Math.abs(dz)) <= 1 || force) this.buildChunk(cx + dx, cz + dz);   // the ring around the player is never late
        else queue.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz, k });
      }
      queue.sort((a, b) => a.d - b.d);
      this._queue = queue;
      if (queue.length > this.stats.queueMax) this.stats.queueMax = queue.length;
      if (this.world) this._syncColliders(cx, cz);
    }
    // chunks that have been out of view for a while, and are not next to the player, are dropped
    if (force || (this._queue.length === 0 && now - (this._sweptAt || 0) >= 0.5)) { this._sweptAt = now; this._sweep(cx, cz, now); }
    if (this.world && !force) this._work(this.meshBudgetMs, cx, cz);
  },
  _sweep(cx, cz, now) {
    for (const k of Array.from(this.chunks.keys())) {
      const rec = this.chunks.get(k);
      if (Math.max(Math.abs(rec.cx - cx), Math.abs(rec.cz - cz)) <= 2) continue;
      const at = this._wantedAt.get(k);
      if (at !== undefined && now - at < this.keepSeconds) continue;
      this.unloadChunk(k);
    }
  },
  // Spend at most `ms` building queued chunks (always at least one), then look ahead for regions.
  _work(ms, cx, cz) {
    if (this._queue.length) {
      const t0 = performance.now();
      let built = 0;
      while (this._queue.length) {
        const j = this._queue.shift();
        if (!this.chunks.has(j.k)) { this.buildChunk(j.cx, j.cz); built++; }
        if (performance.now() - t0 >= ms) break;
      }
      if (built) this._syncColliders(cx, cz);
      return;
    }
    // idle: build the region the player is walking toward, a slice per frame. First the tiles (about 10-50 ms of work in
    // all), then the region's decoration plan, each on its own frames, so nothing here is ever one big block.
    const RT = Level0World.RT, T = CONFIG.tile, w = this.world;
    const budget = Math.max(1, ms * 0.4);
    if (this._job) {
      if (w.stepRegion(this._job, budget)) { const j = this._job; this._job = null; this._planNext = [j.rx, j.rz]; }
      return;
    }
    if (this._planNext) {
      const p = this._planNext; this._planNext = null;
      if (typeof PassC !== "undefined" && PassC.planRegion && PassC.worldMode && w.has(p[0], p[1])) PassC.planRegion(w.region(p[0], p[1]));
      return;
    }
    this._prefetchT -= (GameState.dtLast || 0.016);
    if (this._prefetchT > 0) return;
    this._prefetchT = 0.1;
    const tx = Math.floor(Player.position.x / T), tz = Math.floor(Player.position.z / T);
    const rx = Math.floor(tx / RT), rz = Math.floor(tz / RT);
    const look = Math.ceil((this.fogFar() + 140) / T);          // tiles
    const lx = tx - rx * RT, lz = tz - rz * RT;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nearX = dx > 0 ? RT - lx <= look : dx < 0 ? lx < look : true;
      const nearZ = dz > 0 ? RT - lz <= look : dz < 0 ? lz < look : true;
      if (!nearX || !nearZ) continue;
      if (w.has(rx + dx, rz + dz)) continue;
      this._job = w.beginRegion(rx + dx, rz + dz);
      return;
    }
    w.trim(rx, rz, 2);
  },
  buildHandcrafted(sceneRef) {
    this.buildProcedural(sceneRef, GameState.seed || 483921);
  },

  buildProcedural(sceneRef, seed, options) {
    const strictSeed = !!(options && options.strictSeed);
    const testBeta = !!(options && options.testBeta);
    if (testBeta) {
      const beta = (typeof NoiseArchitectural !== "undefined")
        ? NoiseArchitectural.generatePlayable(seed >>> 0)
        : null;
      if (!beta) {
        const startSeed = document.getElementById("start-seed");
        if (startSeed) startSeed.textContent = "TEST BETA GENERATION FAILED — TRY ANOTHER SEED";
        return false;
      }
      GameState.seed = beta.seed;
      this.clear(sceneRef);
      if (sceneRef) {
        sceneRef.fog = Level.makeFog();
        sceneRef.background = new THREE.Color(CONFIG.fogColor);
      }
      this.loadGenerated(beta);
      LevelGenerator.last = beta;
      Stairwell.planFrom(beta);
      this.buildColliders();
      if (!this.colliders.length) throw new Error("Test Beta built without collision geometry.");
      // Test Beta has no planned elevator sites, so it keeps the legacy walk-in elevators.
      if (typeof ActivitySystem !== "undefined") ActivitySystem.beginVisit(0, beta);
      this.buildMeshes(sceneRef);
      Stairwell.build(sceneRef);
      SpawnManager.apply(beta);
      PickupSystem.generate(beta.seed);
      const seedEl = document.getElementById("hud-seed-val");
      if (seedEl) seedEl.textContent = String(beta.seed);
      const startSeed = document.getElementById("start-seed");
      if (startSeed) startSeed.textContent = "LEVEL 0 · TEST BETA · SEED " + beta.seed;
      return true;
    }
    // Both modes use the same deterministic validity checks. For Custom Seed,
    // the entered number is the starting point of the deterministic search;
    // the game never silently switches to an unrelated random seed.
    const result = LevelGenerator.generateValid(seed >>> 0, 24);

    if (!result) {
      if (strictSeed) {
        const startSeed = document.getElementById("start-seed");
        if (startSeed) startSeed.textContent = "LEVEL 0 GENERATION FAILED — TRY ANOTHER SEED";
        return false;
      }
      console.warn("Procedural generation failed; retrying with a fresh random seed");
      const retrySeed = ((seed ^ 0x9e3779b9) >>> 0);
      const retry = LevelGenerator.generateValid(retrySeed, 24);
      if (!retry) {
        const startSeed = document.getElementById("start-seed");
        if (startSeed) startSeed.textContent = "LEVEL 0 GENERATION FAILED — CHOOSE ANOTHER RANDOM SEED";
        return false;
      }
      return this.buildProcedural(sceneRef, retry.seed, options);
    }
    GameState.seed = result.seed;
    this.clear(sceneRef);
    // Level 1 deliberately removes scene.fog. Recreate the Level 0 fog
    // before loading meshes so DARK/NORMAL/BRIGHT modules work again after
    // returning from Level 1 or pressing G to regenerate.
    if (sceneRef) {
      sceneRef.fog = Level.makeFog();
      sceneRef.background = new THREE.Color(CONFIG.fogColor);
    }
    this.loadGenerated(result);
    LevelGenerator.last = result;
    Stairwell.planFrom(result);
    // A fresh visit: every station and elevator starts unpowered. Must precede
    // buildMeshes so the first streamed chunks already know their stations.
    if (typeof ActivitySystem !== "undefined") ActivitySystem.beginVisit(0, result);
    if (typeof PassC !== "undefined" && PassC.beginWorld) PassC.beginWorld(result.seed);
    if (typeof PickupSystem !== "undefined" && PickupSystem.beginLevel0) PickupSystem.beginLevel0(result.seed);
    this.buildMeshes(sceneRef);
    SpawnManager.apply(result);
    const seedEl = document.getElementById("hud-seed-val");
    if (seedEl) seedEl.textContent = String(result.seed);
    const startSeed = document.getElementById("start-seed");
    if (startSeed) startSeed.textContent = "LEVEL 0 · SEED " + result.seed;
    return true;
  },

  queryTriggers(px, pz, fn) {
    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      if (px >= t.minx && px <= t.maxx && pz >= t.minz && pz <= t.maxz) fn(t);
    }
  }
};
