"use strict";

const DEFAULTS = {
  width: 250,
  height: 250,
  cellMeters: 2,
  majorCount: 42,
  majorMin: 16,
  majorMax: 44,
  secondaryPerMajor: 1.35,
  secondaryMin: 6,
  secondaryMax: 18,
  pillarCount: 12,
  majorThickness: 3,
  secondaryThickness: 2,
  broadFreq: 0.006,
  detailFreq: 0.018,
  fineFreq: 0.060,
  denseZoneThreshold: 0.46,
  maxPlacementAttempts: 90,
  smoothingPasses: 1,
  connectorWidth: 1,
  maxConnectors: 64,
  zoneRows: 3,
  zoneCols: 3,
  zoneJitter: 0.12,
  zoneRadius: 0.62,
  zoneMinMajor: 3,
  zoneMaxMajor: 7,
  zoneSecondaryMultiplier: 1.0
};

function hash32(x){
  x|=0;
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  x=Math.imul(x^(x>>>16),0x45d9f3b);
  return (x^(x>>>16))>>>0;
}
function rng(seed){
  let s=seed>>>0;
  return ()=>{s=hash32(s+0x9e3779b9);return s/4294967296;};
}
function makePerm(seed){
  const p=Array.from({length:256},(_,i)=>i); let s=seed>>>0;
  for(let i=255;i>0;i--){s=hash32(s+0x9e3779b9);const j=s%(i+1);[p[i],p[j]]=[p[j],p[i]];}
  return p.concat(p);
}
function simplex2(seed){
  const p=makePerm(seed);
  const g=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  const F=.5*(Math.sqrt(3)-1),G=(3-Math.sqrt(3))/6;
  return function(xin,yin){
    const s=(xin+yin)*F,i=Math.floor(xin+s),j=Math.floor(yin+s);
    const t=(i+j)*G,X0=i-t,Y0=j-t,x0=xin-X0,y0=yin-Y0;
    const i1=x0>y0?1:0,j1=x0>y0?0:1;
    const x1=x0-i1+G,y1=y0-j1+G,x2=x0-1+2*G,y2=y0-1+2*G;
    const ii=i&255,jj=j&255;
    function c(x,y,gi){let q=.5-x*x-y*y;if(q<0)return 0;q*=q;const [gx,gy]=g[gi&7];return q*q*(gx*x+gy*y);}
    return 70*(c(x0,y0,p[ii+p[jj]])+c(x1,y1,p[ii+i1+p[(jj+j1)&255]])+c(x2,y2,p[ii+1+p[(jj+1)&255]]));
  };
}
function fbm(seed,width,height,freq,octaves,persistence,lacunarity,salt){
  const n=simplex2(hash32((seed^salt)>>>0));
  const a=new Float32Array(width*height);let min=1e9,max=-1e9;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let amp=1,f=freq,v=0,norm=0;
    for(let o=0;o<octaves;o++){v+=amp*n(x*f,y*f);norm+=amp;amp*=persistence;f*=lacunarity;}
    v/=norm;a[y*width+x]=v;if(v<min)min=v;if(v>max)max=v;
  }
  const d=max-min||1;for(let i=0;i<a.length;i++)a[i]=(a[i]-min)/d;
  return a;
}
function smoothWalls(mask,w,h,passes){
  let cur=mask;
  for(let pass=0;pass<passes;pass++){
    const next=new Uint8Array(cur.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let walls=0,total=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(dx===0&&dy===0)continue;const nx=x+dx,ny=y+dy;
        if(nx<0||nx>=w||ny<0||ny>=h)continue;total++;if(cur[ny*w+nx])walls++;
      }
      next[y*w+x]=(cur[y*w+x] && walls>=2)||(walls>=6)?1:0;
    }
    cur=next;
  }
  return cur;
}
function floodRegions(mask,w,h){
  const seen=new Uint8Array(mask.length),regions=[];
  const q=new Int32Array(mask.length);
  for(let sy=1;sy<h-1;sy++)for(let sx=1;sx<w-1;sx++){
    const start=sy*w+sx;if(mask[start]||seen[start])continue;
    let head=0,tail=0;q[tail++]=start;seen[start]=1;const cells=[];
    while(head<tail){
      const idx=q[head++],x=idx%w,y=(idx/w)|0;cells.push(idx);
      const ns=[idx-1,idx+1,idx-w,idx+w];
      for(const n of ns){const nx=n%w,ny=(n/w)|0;if(n>=0&&n<mask.length&&nx>0&&nx<w-1&&ny>0&&ny<h-1&&!mask[n]&&!seen[n]){seen[n]=1;q[tail++]=n;}}
    }
    regions.push(cells);
  }
  regions.sort((a,b)=>b.length-a.length);return regions;
}
function wallCount(mask){let n=0;for(const v of mask)n+=v;return n;}
function bbox(shape){return shape.bbox;}
function intersects(a,b,pad){return !(a.maxX+pad<b.minX||b.maxX+pad<a.minX||a.maxY+pad<b.minY||b.maxY+pad<a.minY);}
function drawCell(mask,w,h,x,y,t=1){
  const r=Math.max(0,Math.floor(t/2));
  for(let yy=y-r;yy<=y+r;yy++)for(let xx=x-r;xx<=x+r;xx++)if(xx>0&&xx<w-1&&yy>0&&yy<h-1)mask[yy*w+xx]=1;
}
function line(mask,w,h,x0,y0,x1,y1,t=1){
  const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;
  while(true){drawCell(mask,w,h,x0,y0,t);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
}
function rectFrame(mask,w,h,cx,cy,ww,hh,t,gapSide,gap){
  const x0=Math.round(cx-ww/2),x1=Math.round(cx+ww/2),y0=Math.round(cy-hh/2),y1=Math.round(cy+hh/2);
  const seg=(a,b,g0,g1)=>{if(b<a)return;const gA=Math.min(g0,g1),gB=Math.max(g0,g1);line(mask,w,h,a,gA,b,gA,t);};
  // Four sides with one deliberately missing opening.
  if(gapSide!=='top')line(mask,w,h,x0,y0,x1,y0,t);else line(mask,w,h,x0,y0,x0+gap,t);
  if(gapSide!=='bottom')line(mask,w,h,x0,y1,x1,y1,t);else line(mask,w,h,x1-gap,y1,x1,y1,t);
  if(gapSide!=='left')line(mask,w,h,x0,y0,x0,y1,t);else line(mask,w,h,x0,y1-gap,x0,y1,t);
  if(gapSide!=='right')line(mask,w,h,x1,y0,x1,y1,t);else line(mask,w,h,x1,y0,x1,y0+gap,t);
  return {bbox:{minX:x0,maxX:x1,minY:y0,maxY:y1}};
}
function makeShape(mask,w,h,cx,cy,type,major,rr,t){
  const len=Math.round(major),len2=Math.round(major*(0.48+rr()*0.42)),th=t;
  const horizontal=rr()<0.5;
  if(type==='bar'){
    if(horizontal){line(mask,w,h,cx-Math.floor(len/2),cy,cx+Math.floor(len/2),cy,th);return {bbox:{minX:cx-Math.floor(len/2)-th,maxX:cx+Math.floor(len/2)+th,minY:cy-th,maxY:cy+th}};}
    line(mask,w,h,cx,cy-Math.floor(len/2),cx,cy+Math.floor(len/2),th);return {bbox:{minX:cx-th,maxX:cx+th,minY:cy-Math.floor(len/2)-th,maxY:cy+Math.floor(len/2)+th}};
  }
  if(type==='L'){
    const sx=rr()<0.5?-1:1,sy=rr()<0.5?-1:1;
    line(mask,w,h,cx,cy,cx+sx*len,cy,th);line(mask,w,h,cx,cy,cx,cy+sy*len2,th);
    return {bbox:{minX:Math.min(cx,cx+sx*len)-th,maxX:Math.max(cx,cx+sx*len)+th,minY:Math.min(cy,cy+sy*len2)-th,maxY:Math.max(cy,cy+sy*len2)+th}};
  }
  if(type==='T'){
    const sx=rr()<0.5?-1:1,sy=rr()<0.5?-1:1;
    line(mask,w,h,cx-Math.floor(len/2),cy,cx+Math.floor(len/2),cy,th);line(mask,w,h,cx,cy,cx,cy+sy*len2,th);
    return {bbox:{minX:cx-Math.floor(len/2)-th,maxX:cx+Math.floor(len/2)+th,minY:Math.min(cy,cy+sy*len2)-th,maxY:Math.max(cy,cy+sy*len2)+th}};
  }
  if(type==='U'){
    const sx=rr()<0.5?-1:1;
    line(mask,w,h,cx-Math.floor(len/2),cy,cx+Math.floor(len/2),cy,th);
    line(mask,w,h,cx-sx*Math.floor(len/2),cy,cx-sx*Math.floor(len/2),cy+len2,th);
    line(mask,w,h,cx+sx*Math.floor(len/2),cy,cx+sx*Math.floor(len/2),cy+len2,th);
    return {bbox:{minX:cx-Math.floor(len/2)-th,maxX:cx+Math.floor(len/2)+th,minY:cy-th,maxY:cy+len2+th}};
  }
  // frame/partial room
  const side=['top','bottom','left','right'][Math.floor(rr()*4)];
  return rectFrame(mask,w,h,cx,cy,len,len2,th,side,Math.max(2,Math.floor(len2*.25)));
}
function carveConnector(mask,w,h,a,b,width){
  // Prefer a simple orthogonal opening: this opens only the wall between two
  // floor regions rather than drawing a broad corridor through open carpet.
  let x0=a%w,y0=(a/w)|0,x1=b%w,y1=(b/w)|0;
  const midX=x1,midY=y0;
  line(mask,w,h,x0,y0,midX,midY,width);line(mask,w,h,midX,midY,x1,y1,width);
}
function carveCell(mask,w,h,x,y,width){
  const r=Math.max(0,Math.floor(width/2));
  for(let yy=y-r;yy<=y+r;yy++)for(let xx=x-r;xx<=x+r;xx++)if(xx>0&&xx<w-1&&yy>0&&yy<h-1)mask[yy*w+xx]=0;
}
function carveLine(mask,w,h,a,b,width){
  let x0=a%w,y0=(a/w)|0,x1=b%w,y1=(b/w)|0;
  const dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1;let err=dx+dy;
  while(true){carveCell(mask,w,h,x0,y0,width);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}
}
function regionBoundary(region,mask,w,h){
  const set=new Set(region),out=[];
  for(const idx of region){const x=idx%w,y=(idx/w)|0;
    const ns=[idx-1,idx+1,idx-w,idx+w];
    if(ns.some(n=>n>=0&&n<mask.length&&mask[n]))out.push(idx);
  }
  return out.length?out:region;
}
function nearestPair(a,b,w){
  let best=Infinity,ai=a[0],bi=b[0];
  const stepA=Math.max(1,Math.floor(a.length/1200)),stepB=Math.max(1,Math.floor(b.length/1200));
  for(let ia=0;ia<a.length;ia+=stepA){const av=a[ia],ax=av%w,ay=(av/w)|0;
    for(let ib=0;ib<b.length;ib+=stepB){const bv=b[ib],bx=bv%w,by=(bv/w)|0;const d=Math.abs(ax-bx)+Math.abs(ay-by);if(d<best){best=d;ai=av;bi=bv;}}
  }
  return [ai,bi,best];
}
function tryConnector(mask,w,h,a,b,width){
  const original=mask.slice();
  const ax=a%w,ay=(a/w)|0,bx=b%w,by=(b/w)|0;
  // Try both orthogonal orders and keep the one that actually reduces the
  // number of floor regions. This avoids accidentally carving an open-space
  // detour that never crosses the separating wall.
  const candidates=[
    [[ax,ay],[bx,ay],[bx,by]],
    [[ax,ay],[ax,by],[bx,by]]
  ];
  let bestMask=null,bestRegions=Infinity;
  for(const pts of candidates){
    mask.set(original);
    carveLine(mask,w,h,pts[0][0]+pts[0][1]*w,pts[1][0]+pts[1][1]*w,width);
    carveLine(mask,w,h,pts[1][0]+pts[1][1]*w,pts[2][0]+pts[2][1]*w,width);
    const n=floodRegions(mask,w,h).length;
    if(n<bestRegions){bestRegions=n;bestMask=mask.slice();}
  }
  if(bestMask){mask.set(bestMask);return bestRegions;}
  mask.set(original);return floodRegions(mask,w,h).length;
}
function generate(seed,opts={}){
  const p=Object.assign({},DEFAULTS,opts),w=p.width,h=p.height,s=seed>>>0,r=rng(s);
  const broad=fbm(s,w,h,p.broadFreq,4,.55,2,0xA1B2C3);
  const detail=fbm(s,w,h,p.detailFreq,4,.52,2,0xD4E5F6);
  const fine=fbm(s,w,h,p.fineFreq,2,.50,2,0x778899);
  const walls=new Uint8Array(w*h),structures=[],placed=[];
  // Architectural zones: higher-level neighborhoods that cluster related
  // structures. Noise biases the zones, but does not independently place walls.
  const zones=[];
  const zoneTypes=[
    {name:'roomCluster',weights:{L:2,T:2,U:3,bar:1,frame:4}},
    {name:'longWall',weights:{L:2,T:3,U:1,bar:5,frame:1}},
    {name:'alcoves',weights:{L:4,T:2,U:3,bar:1,frame:2}},
    {name:'mixed',weights:{L:3,T:3,U:2,bar:2,frame:2}}
  ];
  const cellW=w/p.zoneCols,cellH=h/p.zoneRows;
  for(let zy=0;zy<p.zoneRows;zy++)for(let zx=0;zx<p.zoneCols;zx++){
    const zi=zy*p.zoneCols+zx;
    const jx=(r()-.5)*cellW*p.zoneJitter,jy=(r()-.5)*cellH*p.zoneJitter;
    const cx=(zx+.5)*cellW+jx,cy=(zy+.5)*cellH+jy;
    const radius=Math.min(cellW,cellH)*p.zoneRadius*.5;
    const type=zoneTypes[zi%zoneTypes.length];
    const sx=Math.max(0,Math.min(w-1,Math.floor(cx))),sy=Math.max(0,Math.min(h-1,Math.floor(cy)));
    const field=broad[sy*w+sx],density=.82+field*.38;
    zones.push({id:zi,cx,cy,radius,type,field,density,majorTarget:0,majorPlaced:0});
  }
  let remaining=p.majorCount;
  for(const z of zones){
    z.majorTarget=Math.max(p.zoneMinMajor,Math.min(p.zoneMaxMajor,
      Math.round((p.majorCount/zones.length)*z.density+(r()-.5)*1.2)));
    remaining-=z.majorTarget;
  }
  while(remaining>0){const z=zones[Math.floor(r()*zones.length)];if(z.majorTarget<p.zoneMaxMajor){z.majorTarget++;remaining--;}}
  while(remaining<0){const a=zones.filter(z=>z.majorTarget>p.zoneMinMajor);if(!a.length)break;a[Math.floor(r()*a.length)].majorTarget--;remaining++;}

  function weightedType(z){
    const e=Object.entries(z.type.weights);let total=0;for(const [,v] of e)total+=v;
    let q=r()*total;for(const [k,v] of e){q-=v;if(q<=0)return k;}return e[e.length-1][0];
  }
  function placeMajor(z){
    for(let attempt=0;attempt<p.maxPlacementAttempts;attempt++){
      const a=r()*Math.PI*2,rad=Math.pow(r(),1.8)*z.radius;
      const cx=Math.round(z.cx+Math.cos(a)*rad),cy=Math.round(z.cy+Math.sin(a)*rad);
      if(cx<12||cx>w-13||cy<12||cy>h-13)continue;
      const field=broad[cy*w+cx];if(field<.30&&r()<.55)continue;
      const size=p.majorMin+Math.floor(r()*(p.majorMax-p.majorMin+1));
      const type=weightedType(z),before=walls.slice();
      const sh=makeShape(walls,w,h,cx,cy,type,size,r,p.majorThickness),bb=bbox(sh);
      if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4||placed.some(o=>intersects(bb,o.bb,1))){walls.set(before);continue;}
      placed.push({bb,kind:'major',isMajor:true,cx,cy,type,zoneId:z.id});
      structures.push({kind:'major',isMajor:true,cx,cy,type,size,zoneId:z.id});z.majorPlaced++;return true;
    }
    return false;
  }
  // Every zone receives several related structures, creating architectural
  // neighborhoods instead of 40 independent map-wide objects.
  for(const z of zones){
    for(let i=0;i<z.majorTarget;i++)placeMajor(z);
    let guard=0;while(z.majorPlaced<z.majorTarget&&guard++<p.maxPlacementAttempts)placeMajor(z);
  }

  // Secondary structures are attached to a major structure in the same zone.
  const secondaryTotal=Math.round(p.majorCount*p.secondaryPerMajor*p.zoneSecondaryMultiplier);
  const majors=()=>placed.filter(o=>o.isMajor);
  for(let i=0;i<secondaryTotal;i++){
    const ms=majors();if(!ms.length)break;
    const m=ms[Math.floor(r()*ms.length)],z=zones[m.zoneId];let ok=false;
    for(let attempt=0;attempt<20&&!ok;attempt++){
      const side=Math.floor(r()*4),dist=3+Math.floor(r()*10);let cx=m.cx,cy=m.cy;
      if(side===0)cy=m.bb.minY-dist;if(side===1)cy=m.bb.maxY+dist;if(side===2)cx=m.bb.minX-dist;if(side===3)cx=m.bb.maxX+dist;
      const dx=cx-z.cx,dy=cy-z.cy,d=Math.hypot(dx,dy);if(d>z.radius*1.08){const k=z.radius*1.08/d;cx=z.cx+dx*k;cy=z.cy+dy*k;}
      cx=Math.max(5,Math.min(w-6,Math.round(cx)));cy=Math.max(5,Math.min(h-6,Math.round(cy)));
      const size=p.secondaryMin+Math.floor(r()*(p.secondaryMax-p.secondaryMin+1)),type=['L','bar','T','U'][Math.floor(r()*4)],before=walls.slice();
      const sh=makeShape(walls,w,h,cx,cy,type,size,r,p.secondaryThickness),bb=bbox(sh);
      if(bb.minX>=3&&bb.maxX<=w-4&&bb.minY>=3&&bb.maxY<=h-4&&!placed.some(o=>intersects(bb,o.bb,1))){
        placed.push({bb,kind:'secondary',isMajor:false,cx,cy,type,zoneId:m.zoneId});structures.push({kind:'secondary',isMajor:false,cx,cy,type,size,zoneId:m.zoneId});ok=true;
      }else walls.set(before);
    }
  }

  // Sparse pillars are assigned to zones so even the detail layer has local
  // clustering rather than uniform random sprinkling.
  for(let i=0;i<p.pillarCount;i++){
    const z=zones[Math.floor(r()*zones.length)];
    for(let attempt=0;attempt<30;attempt++){
      const a=r()*Math.PI*2,rad=Math.sqrt(r())*z.radius*.9;
      const x=Math.max(4,Math.min(w-5,Math.round(z.cx+Math.cos(a)*rad)));
      const y=Math.max(4,Math.min(h-5,Math.round(z.cy+Math.sin(a)*rad)));
      const idx=y*w+x;
      if(walls[idx])continue;
      if(broad[idx]<0.42)continue;
      let nearby=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const xx=x+dx,yy=y+dy;if(xx>0&&xx<w&&yy>0&&yy<h)nearby+=walls[yy*w+xx];}
      if(nearby>3)continue;
      drawCell(walls,w,h,x,y,2);structures.push({kind:'pillar',isMajor:false,cx:x,cy:y,type:'pillar',size:2,zoneId:z.id});break;
    }
  }
  // Fine noise is used only to roughen a small fraction of architectural
  // edges, never to turn the whole map into cellular noise.
  for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
    const idx=y*w+x;if(!walls[idx])continue;
    const q=fine[idx];
    if(q<0.055 && r()<0.10){walls[idx]=0;continue;}
    if(q>0.955 && r()<0.045){drawCell(walls,w,h,x,y,1);}
  }
  // Boundary wall gives the prototype a finite 500m test region.
  for(let x=0;x<w;x++){walls[x]=1;walls[(h-1)*w+x]=1;}
  for(let y=0;y<h;y++){walls[y*w]=1;walls[y*w+w-1]=1;}
  const before=walls.slice();
  const beforeRegions=floodRegions(before,w,h);let regions=beforeRegions.slice();let connectors=0;
  while(regions.length>1 && connectors<p.maxConnectors){
    const main=regions[0];let best={d:Infinity,a:0,b:0,ri:1};
    const mainBoundary=regionBoundary(main,walls,w,h);
    for(let i=1;i<regions.length;i++){
      const otherBoundary=regionBoundary(regions[i],walls,w,h);
      const [a,b,d]=nearestPair(mainBoundary,otherBoundary,w);
      if(d<best.d)best={a,b,d,ri:i};
    }
    const beforeCount=regions.length;
    const afterCount=tryConnector(walls,w,h,best.a,best.b,p.connectorWidth);
    connectors++;
    regions=floodRegions(walls,w,h);
    if(regions.length>=beforeCount){
      // If neither L-shaped route helped, punch a short direct opening between
      // the two nearest boundary cells as a deterministic last resort.
      const original=walls.slice();
      carveLine(walls,w,h,best.a,best.b,p.connectorWidth);
      regions=floodRegions(walls,w,h);
      if(regions.length>=beforeCount)walls.set(original);
      else regions=floodRegions(walls,w,h);
    }
  }
  const afterRegions=floodRegions(walls,w,h);let carved=0;for(let i=0;i<walls.length;i++)if(before[i]&&!walls[i])carved++;
  const wallCells=wallCount(walls),floorCells=walls.length-wallCells,reachable=afterRegions[0]?.length||0;
  return {seed:s,width:w,height:h,cellMeters:p.cellMeters,walls,before,broad,detail,fine,zones,structures,stats:{wallPct:wallCells/walls.length,floorPct:floorCells/walls.length,regionsBefore:beforeRegions.length,regionsAfter:afterRegions.length,connectors,carvedCells:carved,carvePct:carved/Math.max(1,wallCount(before)),reachable,floorCells,majorStructures:structures.filter(x=>x.isMajor).length,secondaryStructures:structures.filter(x=>!x.isMajor).length}};
}
if(typeof module!=="undefined")module.exports={generate,DEFAULTS,fbm};
if(typeof window!=="undefined")window.NoiseArchitectural={generate,DEFAULTS,fbm};


/* ------------------------------------------------------------------
   PLAYABLE TEST-BETA ADAPTER
   Converts the architectural mask into the Level 0 tile/result format.
   Floor remains one continuous carpet plane; the mask controls walls only.
   ------------------------------------------------------------------ */
const NoiseArchitecturalAPI = (typeof window!=="undefined" ? window.NoiseArchitectural : (typeof module!=="undefined" ? module.exports : null));
if (NoiseArchitecturalAPI) {
  NoiseArchitecturalAPI.generatePlayable = function(seed, opts={}) {
    const p = Object.assign({}, DEFAULTS, opts, { width: 250, height: 250, cellMeters: 2 });
    const base = generate(seed >>> 0, p);
    const w = base.width, h = base.height, mask = base.walls;
    const tiles = new Array(h);
    for (let y=0;y<h;y++) {
      tiles[y] = new Array(w);
      for (let x=0;x<w;x++) tiles[y][x] = mask[y*w+x] ? 1 : 0;
    }
    const floor = (x,z) => x>0 && z>0 && x<w-1 && z<h-1 && !mask[z*w+x];
    const centerX=Math.floor(w/2), centerZ=Math.floor(h/2);
    let start=null;
    for(let r=0;r<Math.max(w,h)&&!start;r++){
      for(let z=Math.max(1,centerZ-r);z<=Math.min(h-2,centerZ+r)&&!start;z++){
        for(let x=Math.max(1,centerX-r);x<=Math.min(w-2,centerX+r);x++){
          if(floor(x,z)){start={x,z};break;}
        }
      }
    }
    if(!start) return null;

    // BFS from spawn gives a real navigable distance field. The elevator is
    // placed at the farthest reachable floor cell that also has a believable
    // three-cell approach and two-cell hallway width.
    const total=w*h, dist=new Int32Array(total); dist.fill(-1);
    const q=new Int32Array(total); let head=0,tail=0;
    const si=start.z*w+start.x; dist[si]=0; q[tail++]=si;
    while(head<tail){
      const idx=q[head++],x=idx%w,z=(idx/w)|0;
      const ns=[idx-1,idx+1,idx-w,idx+w];
      for(const n of ns){
        if(n<0||n>=total||dist[n]>=0) continue;
        const nx=n%w,nz=(n/w)|0;
        if(!floor(nx,nz)) continue;
        dist[n]=dist[idx]+1; q[tail++]=n;
      }
    }
    function elevatorDir(x,z){
      const ds=[
        {fx:0,fz:-1,rx:1,rz:0},{fx:1,fz:0,rx:0,rz:1},
        {fx:0,fz:1,rx:-1,rz:0},{fx:-1,fz:0,rx:0,rz:-1}
      ];
      for(const d of ds){
        let ok=true;
        for(let n=1;n<=4;n++){
          const ax=x-d.fx*n, az=z-d.fz*n;
          if(!floor(ax,az)){ok=false;break;}
          if(!floor(ax+d.rx,az+d.rz)||!floor(ax-d.rx,az-d.rz)){ok=false;break;}
        }
        if(ok) return d;
      }
      return null;
    }
    let exit=null,best=-1;
    const preferredMin=Math.floor(500/p.cellMeters);
    let fallback=null,fallbackBest=-1;
    for(let idx=0;idx<total;idx++){
      if(dist[idx]<0) continue;
      const x=idx%w,z=(idx/w)|0;
      const d=elevatorDir(x,z);
      if(!d) continue;
      if(dist[idx]>fallbackBest){fallbackBest=dist[idx];fallback={x,z,dir:d};}
      if(dist[idx]>=preferredMin && dist[idx]>best){best=dist[idx];exit={x,z,dir:d};}
    }
    if(!exit){ exit=fallback; best=fallbackBest; }
    if(!exit) return null;

    tiles[start.z][start.x]=2;
    tiles[exit.z][exit.x]=4;
    const zones=base.zones||[];
    if(typeof MapGraph!=='undefined'){
      MapGraph.reset();
      for(const z of zones){
        const gx=Math.max(0,Math.round(z.cx-5)), gz=Math.max(0,Math.round(z.cy-5));
        MapGraph.nodes.push({id:MapGraph.nodes.length,type:'beta_zone',gx,gz,w:10,h:10,connections:[],deadEnd:false,hasExit:false,hasStart:false,lightProfile:(z.type&&z.type.name==='alcoves')?'BRIGHT':'NORMAL',dark:false,skipLights:false,anomaly:null,extra:{zoneId:z.id}});
      }
    }
    const exitStamp={x:exit.x,z:exit.z};
    const exitNode=null;
    return {
      seed:base.seed,width:w,height:h,rows:h,cols:w,tiles,
      startStamp:{x:start.x,z:start.z},
      exitStamp,exitStamps:[exitStamp],exitNodes:[exitNode],exitNode,
      pathMeters:best*2,targetPath:best*2,
      beta:true,stats:base.stats,architectural:base
    };
  };
}
