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
  regionFreq: 0.0032,
  regionOctaves: 2,
  regionPersistence: 0.55,
  regionLacunarity: 2,
  regionThresholds: [0.06, 0.20, 0.54, 0.82],
  regionMaxClearCells: [12, 10, 8, 6, 4],
  // Region profiles deliberately change both quantity and architectural vocabulary.
  // The last two bands are not merely "more walls": Dense favors attached/intersecting
  // structures while Maze switches to short, turn-heavy chains and pocket-like frames.
  regionMajorMultiplier: [0.62, 0.78, 1.00, 1.38, 1.65],
  regionSecondaryMultiplier: [0.50, 0.72, 1.00, 1.55, 2.10],
  regionMajorSizeMultiplier: [1.12, 1.04, 1.00, 0.82, 0.56],
  regionMinStructureSpacingByBand: [16, 13, 10, 5, 3],
  regionInfillAttempts: 72,
  regionMinStructureSpacing: 12,
  denseZoneThreshold: 0.46,
  maxPlacementAttempts: 90,
  smoothingPasses: 1,
  connectorWidth: 1,
  maxConnectors: 128,
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

function regionBand(v,p){
  const t=p.regionThresholds||[0.16,0.36,0.66,0.86];
  if(v<t[0])return 0;
  if(v<t[1])return 1;
  if(v<t[2])return 2;
  if(v<t[3])return 3;
  return 4;
}

function regionName(b){
  return ['expanse','open','normal','dense','maze'][b]||'normal';
}

function distanceField(mask,w,h){
  const total=w*h,dist=new Int32Array(total);dist.fill(-1);
  const q=new Int32Array(total);let head=0,tail=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if(mask[i]){dist[i]=0;q[tail++]=i;}
  }
  while(head<tail){
    const i=q[head++],x=i%w,y=(i/w)|0,d=dist[i]+1;
    const ns=[i-1,i+1,i-w,i+w];
    for(const n of ns){
      if(n<0||n>=total||dist[n]>=0)continue;
      const nx=n%w,ny=(n/w)|0;
      if(nx<0||nx>=w||ny<0||ny>=h)continue;
      dist[n]=d;q[tail++]=n;
    }
  }
  return dist;
}
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
  const regionNoise=fbm(s,w,h,p.regionFreq,p.regionOctaves,p.regionPersistence,p.regionLacunarity,0x13579BDF);
  const regionField=new Float32Array(w*h);
  for(let i=0;i<regionField.length;i++) regionField[i]=regionNoise[i]*0.78+broad[i]*0.14+detail[i]*0.08;
  // Convert the raw region field into a percentile field. This keeps the
  // spatial character of the low-frequency noise while making the five
  // architectural regions occur at controlled proportions instead of letting
  // a particular seed accidentally become almost entirely 'Normal'.
  const hist=new Uint32Array(256);
  for(const v of regionField)hist[Math.max(0,Math.min(255,Math.floor(v*255)))]++;
  let cumulative=0;const cdf=new Float32Array(256);
  for(let i=0;i<256;i++){cdf[i]=(cumulative+hist[i]*0.5)/Math.max(1,w*h);cumulative+=hist[i];}
  for(let i=0;i<regionField.length;i++){const b=Math.max(0,Math.min(255,Math.floor(regionField[i]*255)));regionField[i]=cdf[b];}
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
  const regionProfile=(band)=>({
    name:regionName(band),
    majorMultiplier:p.regionMajorMultiplier[band]||1,
    secondaryMultiplier:p.regionSecondaryMultiplier[band]||1,
    sizeMultiplier:p.regionMajorSizeMultiplier[band]||1,
    minSpacing:(p.regionMinStructureSpacingByBand&&p.regionMinStructureSpacingByBand[band])||p.regionMinStructureSpacing||12,
    // Architectural vocabulary. These weights are intentionally different from
    // the global zone vocabulary so Dense and Maze actually read differently.
    majorWeights:[
      {L:2,T:2,U:3,bar:1,frame:4},
      {L:2,T:2,U:3,bar:2,frame:3},
      {L:3,T:3,U:2,bar:2,frame:2},
      {L:2,T:4,U:4,bar:1,frame:3},
      {L:4,T:5,U:2,bar:1,frame:1}
    ][band] || {L:3,T:3,U:2,bar:2,frame:2},
    secondaryTypes:[
      ['L','bar','T','U'],
      ['L','T','U','bar'],
      ['L','bar','T','U'],
      ['T','U','L','bar','frame'],
      ['L','T','T','L','frame']
    ][band] || ['L','bar','T','U'],
    maxClearCells:p.regionMaxClearCells[band]||9
  });
  const cellW=w/p.zoneCols,cellH=h/p.zoneRows;
  for(let zy=0;zy<p.zoneRows;zy++)for(let zx=0;zx<p.zoneCols;zx++){
    const zi=zy*p.zoneCols+zx;
    const jx=(r()-.5)*cellW*p.zoneJitter,jy=(r()-.5)*cellH*p.zoneJitter;
    const cx=(zx+.5)*cellW+jx,cy=(zy+.5)*cellH+jy;
    const radius=Math.min(cellW,cellH)*p.zoneRadius*.5;
    const type=zoneTypes[zi%zoneTypes.length];
    const sx=Math.max(0,Math.min(w-1,Math.floor(cx))),sy=Math.max(0,Math.min(h-1,Math.floor(cy)));
    const field=broad[sy*w+sx],regionValue=regionField[sy*w+sx],band=regionBand(regionValue,p),profile=regionProfile(band);
    const density=(.78+field*.34)*profile.majorMultiplier;
    zones.push({id:zi,cx,cy,radius,type,field,regionValue,band,region:profile.name,profile,density,majorTarget:0,majorPlaced:0});
  }
  for(const z of zones){
    z.majorTarget=Math.max(p.zoneMinMajor,Math.min(p.zoneMaxMajor,
      Math.round((p.majorCount/zones.length)*z.density+(r()-.5)*1.4)));
  }
  // Preserve the intended global scale without erasing regional differences.
  // We only nudge the least/most dense zones when the total drifts too far.
  let targetTotal=Math.round(p.majorCount*1.12),currentTotal=zones.reduce((a,z)=>a+z.majorTarget,0);
  let guard=0;
  while(currentTotal<targetTotal&&guard++<500){
    const candidates=zones.filter(z=>z.majorTarget<p.zoneMaxMajor);if(!candidates.length)break;
    candidates.sort((a,b)=>a.profile.majorMultiplier-b.profile.majorMultiplier);
    const z=candidates[Math.floor(r()*Math.min(3,candidates.length))];z.majorTarget++;currentTotal++;
  }
  while(currentTotal>targetTotal&&guard++<1000){
    const candidates=zones.filter(z=>z.majorTarget>p.zoneMinMajor);if(!candidates.length)break;
    candidates.sort((a,b)=>b.profile.majorMultiplier-a.profile.majorMultiplier);
    const z=candidates[Math.floor(r()*Math.min(3,candidates.length))];z.majorTarget--;currentTotal--;
  }

  function weightedType(z){
    const e=Object.entries(z.type.weights);let total=0;for(const [,v] of e)total+=v;
    let q=r()*total;for(const [k,v] of e){q-=v;if(q<=0)return k;}return e[e.length-1][0];
  }
  function weightedRegionType(profile){
    const e=Object.entries(profile.majorWeights);let total=0;for(const [,v] of e)total+=v;
    let q=r()*total;for(const [k,v] of e){q-=v;if(q<=0)return k;}return e[e.length-1][0];
  }
  function regionSecondaryType(profile){
    const list=profile.secondaryTypes||['L','bar','T','U'];
    return list[Math.floor(r()*list.length)];
  }
  function placeMajor(z){
    for(let attempt=0;attempt<p.maxPlacementAttempts;attempt++){
      const a=r()*Math.PI*2,rad=Math.pow(r(),1.8)*z.radius;
      const cx=Math.round(z.cx+Math.cos(a)*rad),cy=Math.round(z.cy+Math.sin(a)*rad);
      if(cx<12||cx>w-13||cy<12||cy>h-13)continue;
      const field=broad[cy*w+cx],localBand=regionBand(regionField[cy*w+cx],p),localProfile=regionProfile(localBand);
      if(field<.26&&localBand<2&&r()<.42)continue;
      // Dense and Maze are allowed to place closer to neighboring architecture;
      // Expanse/Open deliberately keep larger breathing room.
      const rawSize=p.majorMin+Math.floor(r()*(p.majorMax-p.majorMin+1));
      const size=Math.max(p.majorMin,Math.min(p.majorMax,Math.round(rawSize*localProfile.sizeMultiplier)));
      const type=localBand>=3 ? weightedRegionType(localProfile) : weightedType(z),before=walls.slice();
      const sh=makeShape(walls,w,h,cx,cy,type,size,r,p.majorThickness),bb=bbox(sh);
      if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4||placed.some(o=>intersects(bb,o.bb,localProfile.minSpacing/2))){walls.set(before);continue;}
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

  // Secondary structures are attached to major structures in the same zone.
  // Dense gets many more attachments and tighter offsets; Maze gets even more,
  // but they are deliberately short and turn-heavy instead of simply being larger.
  const secondaryTotal=Math.round(p.majorCount*p.secondaryPerMajor*p.zoneSecondaryMultiplier*1.02);
  const majors=()=>placed.filter(o=>o.isMajor);
  for(let i=0;i<secondaryTotal;i++){
    const ms=majors();if(!ms.length)break;
    const m=ms[Math.floor(r()*ms.length)],z=zones[m.zoneId];
    const localBand=regionBand(regionField[Math.max(1,Math.min(h-2,m.cy))*w+Math.max(1,Math.min(w-2,m.cx))],p);
    const profile=regionProfile(localBand);let ok=false;
    const attempts=localBand>=3?34:20;
    for(let attempt=0;attempt<attempts&&!ok;attempt++){
      const side=Math.floor(r()*4);
      const maxDist=localBand===4?6:(localBand===3?8:10);
      const dist=2+Math.floor(r()*maxDist);let cx=m.cx,cy=m.cy;
      if(side===0)cy=m.bb.minY-dist;if(side===1)cy=m.bb.maxY+dist;if(side===2)cx=m.bb.minX-dist;if(side===3)cx=m.bb.maxX+dist;
      const dx=cx-z.cx,dy=cy-z.cy,d=Math.hypot(dx,dy);if(d>z.radius*1.10){const k=z.radius*1.10/d;cx=z.cx+dx*k;cy=z.cy+dy*k;}
      cx=Math.max(5,Math.min(w-6,Math.round(cx)));cy=Math.max(5,Math.min(h-6,Math.round(cy)));
      const sizeBase=p.secondaryMin+Math.floor(r()*(p.secondaryMax-p.secondaryMin+1));
      const size=Math.max(6,Math.round(sizeBase*(localBand===4?.52:localBand===3?.72:1)));
      const type=localBand>=3?regionSecondaryType(profile):['L','bar','T','U'][Math.floor(r()*4)];
      const before=walls.slice();
      const sh=makeShape(walls,w,h,cx,cy,type,size,r,localBand===4?1:p.secondaryThickness),bb=bbox(sh);
      if(bb.minX>=3&&bb.maxX<=w-4&&bb.minY>=3&&bb.maxY<=h-4&&!placed.some(o=>intersects(bb,o.bb,profile.minSpacing/2))){
        placed.push({bb,kind:'secondary',isMajor:false,cx,cy,type,zoneId:m.zoneId,region:profile.name});
        structures.push({kind:'secondary',isMajor:false,cx,cy,type,size,zoneId:m.zoneId,region:profile.name});ok=true;
      }else walls.set(before);
    }
  }

  // Dense-only attachment pass: add short crossbars/frames between nearby
  // structures. This produces visual occlusion and intersections that Normal
  // does not receive, without turning the entire map into a maze.
  for(const z of zones){
    if(z.band!==3)continue;
    const localMajors=placed.filter(o=>o.isMajor&&o.zoneId===z.id);
    for(let i=0;i<Math.min(4,Math.floor(localMajors.length*.7));i++){
      const m=localMajors[Math.floor(r()*localMajors.length)];
      const angle=r()<.5?0:Math.PI/2;
      const len=7+Math.floor(r()*10);
      const cx=Math.round(m.cx+(r()-.5)*8),cy=Math.round(m.cy+(r()-.5)*8);
      const type=r()<.55?'T':'frame',before=walls.slice();
      const sh=makeShape(walls,w,h,cx,cy,type,len,r,1),bb=bbox(sh);
      if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4||placed.some(o=>intersects(bb,o.bb,2.5))){walls.set(before);continue;}
      placed.push({bb,kind:'denseAttachment',isMajor:false,cx,cy,type,zoneId:z.id,region:'dense'});
      structures.push({kind:'denseAttachment',isMajor:false,cx,cy,type,size:len,zoneId:z.id,region:'dense'});
    }
  }

  // Maze-only pass: build short, chained turns. Each chain is intentionally
  // local, producing pockets and repeated T/L turns rather than long straight
  // walls. Connectivity repair later guarantees that the whole floor remains
  // reachable even when several chains overlap.
  for(const z of zones){
    if(z.band!==4)continue;
    const chains=2+Math.floor(r()*3);
    for(let c=0;c<chains;c++){
      let cx=Math.round(z.cx+(r()-.5)*z.radius*.8),cy=Math.round(z.cy+(r()-.5)*z.radius*.8);
      let dir=Math.floor(r()*4);
      const links=3+Math.floor(r()*3);
      for(let k=0;k<links;k++){
        const len=5+Math.floor(r()*6);
        const type=(k%3===1)?'T':'L';
        const before=walls.slice();
        const sh=makeShape(walls,w,h,cx,cy,type,len,r,1),bb=bbox(sh);
        if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4){walls.set(before);break;}
        // In the Maze band we permit very close/attached pieces; reject only
        // if this would make a giant solid clump.
        let localWall=0,localFloor=0;
        for(let yy=Math.max(1,cy-6);yy<=Math.min(h-2,cy+6);yy++)for(let xx=Math.max(1,cx-6);xx<=Math.min(w-2,cx+6);xx++){
          if(walls[yy*w+xx])localWall++;else localFloor++;
        }
        if(localWall>localFloor*2.8){walls.set(before);break;}
        placed.push({bb,kind:'mazeChain',isMajor:false,cx,cy,type,zoneId:z.id,region:'maze'});
        structures.push({kind:'mazeChain',isMajor:false,cx,cy,type,size:len,zoneId:z.id,region:'maze'});
        const step=Math.max(3,Math.floor(len*.65));
        const turn=r()<.8?(r()<.5?1:3):0;
        dir=(dir+turn)%4;
        const dx=[1,0,-1,0][dir],dy=[0,1,0,-1][dir];
        cx=Math.max(5,Math.min(w-6,cx+dx*step));cy=Math.max(5,Math.min(h-6,cy+dy*step));
      }
    }
  }

  // -------------------------------------------------------------------------
  // REGION-SPECIFIC ARCHITECTURAL PASS
  // -------------------------------------------------------------------------
  // The earlier zone pass is deliberately broad: a structure can be biased by
  // a region without being entirely contained by it. That is useful for
  // transitions, but it also means the 5% Maze band can end up under-built.
  // This pass samples cells that are actually inside Dense/Maze regions and
  // gives those bands their own architectural vocabulary.
  function regionalCandidates(band){
    const out=[];
    for(let y=6;y<h-6;y++)for(let x=6;x<w-6;x++){
      const idx=y*w+x;
      if(regionBand(regionField[idx],p)!==band || walls[idx])continue;
      if(broad[idx]<.18 && band===3)continue;
      out.push({x,y,idx});
    }
    return out;
  }
  function placeRegionalShape(c,band){
    const profile=regionProfile(band);
    const before=walls.slice();
    let type,size;
    if(band===3){
      // Dense: medium-short T/U/L pieces and partial frames create
      // intersections and occlusion without becoming corridor spam.
      type=r()<.42?'T':(r()<.55?'U':(r()<.72?'L':'frame'));
      size=8+Math.floor(r()*10);
    }else{
      // Maze: short pieces with lots of turns. Frames are rare because the
      // dominant read should be a connected sequence of bends and pockets.
      type=r()<.50?'L':(r()<.88?'T':'frame');
      size=5+Math.floor(r()*6);
    }
    const sh=makeShape(walls,w,h,c.x,c.y,type,size,r,band===4?1:2),bb=bbox(sh);
    if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4){walls.set(before);return false;}
    // Keep the new architecture mostly in its intended region. A small spill
    // is allowed so region transitions don't look like hard borders.
    let inside=0,total=0;
    for(let yy=Math.max(1,bb.minY);yy<=Math.min(h-2,bb.maxY);yy++)for(let xx=Math.max(1,bb.minX);xx<=Math.min(w-2,bb.maxX);xx++){
      total++;
      if(regionBand(regionField[yy*w+xx],p)===band)inside++;
    }
    if(total && inside/total < (band===4?.68:.58)){walls.set(before);return false;}
    // Don't turn a pocket into a solid block. Maze gets a little more
    // tolerance because its defining feature is compression of walkable space.
    let localWall=0,localFloor=0;
    const rr=band===4?7:8;
    for(let yy=Math.max(1,c.y-rr);yy<=Math.min(h-2,c.y+rr);yy++)for(let xx=Math.max(1,c.x-rr);xx<=Math.min(w-2,c.x+rr);xx++){
      if(walls[yy*w+xx])localWall++;else localFloor++;
    }
    if(localWall>localFloor*(band===4?3.6:2.5)){walls.set(before);return false;}
    structures.push({kind:band===4?'mazeRegional':'denseRegional',isMajor:false,cx:c.x,cy:c.y,type,size,zoneId:-1,region:profile.name});
    return true;
  }

  {
    const dense=regionalCandidates(3),maze=regionalCandidates(4);
    // Deterministic shuffle through the generator RNG.
    for(let i=dense.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[dense[i],dense[j]]=[dense[j],dense[i]];}
    for(let i=maze.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[maze[i],maze[j]]=[maze[j],maze[i]];}

    // Dense gets a moderate number of true regional structures. Maze gets a
    // much stronger intervention, but remains only ~5% of the world.
    const denseTarget=Math.max(8,Math.round(dense.length/230));
    const mazeTarget=Math.max(10,Math.round(maze.length/78));
    let placedDense=0,placedMaze=0;
    for(const c of dense){
      if(placedDense>=denseTarget)break;
      if(placeRegionalShape(c,3))placedDense++;
    }
    for(const c of maze){
      if(placedMaze>=mazeTarget)break;
      if(placeRegionalShape(c,4))placedMaze++;
    }
  }

  // Sparse pillars are assigned to zones so even the detail layer has local
  // clustering rather than uniform random sprinkling.
  for(let i=0;i<p.pillarCount;i++){
    const z=zones[Math.floor(r()*zones.length)],profile=z.profile;
    // Maze gets very few free-standing pillars; its claustrophobia should come
    // from connected architecture. Dense gets more, while Expanse/Open remain sparse.
    const pillarChance=profile.name==='maze'?.22:profile.name==='dense'?1.65:profile.name==='normal'?1:profile.name==='open'?.70:.42;
    if(r()>Math.min(1,pillarChance))continue;
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
  // Wall thickening pass: expand existing architectural walls into nearby
  // floor cells. This makes the structures substantially more substantial
  // without introducing independent noisy wall pixels.
  // It is deliberately applied before the connectivity repair below.
  for(let pass=0;pass<2;pass++){
    const src=walls.slice();
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const idx=y*w+x;if(src[idx])continue;
      let n=0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(dx===0&&dy===0)continue;
        n+=src[(y+dy)*w+(x+dx)];
      }
      if(n>=3 || (pass===1 && n>=2 && broad[idx]>.55)) walls[idx]=1;
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
  // Regional clear-span pass. The five architectural regions are not just
  // labels: they control how close the player should generally be to structure.
  // Expanse is still genuinely open, but a hard 30m ceiling prevents the
  // enormous empty carpet fields seen in earlier Beta builds. Dense/Maze
  // regions get progressively tighter spatial envelopes.
  {
    const dist=distanceField(walls,w,h);
    const candidates=[];
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const idx=y*w+x;if(walls[idx])continue;
      const band=regionBand(regionField[idx],p),limit=(p.regionMaxClearCells[band]||9);
      // Expanse is the only hard clear-span guarantee. The other region types
      // already get their density from the architecture rules above; this pass
      // mainly guarantees that an Expanse can never become an enormous empty
      // carpet field.
      if(band===0 && dist[idx]>limit)candidates.push({idx,x,y,d:dist[idx],band});
    }
    candidates.sort((a,b)=>b.d-a.d);
    const infill=[];
    for(const c of candidates){
      if(infill.length>=p.regionInfillAttempts)break;
      let tooClose=false;
      for(const q of infill){if(Math.abs(c.x-q.x)+Math.abs(c.y-q.y)<p.regionMinStructureSpacing){tooClose=true;break;}}
      if(tooClose)continue;
      const profile=regionProfile(c.band);
      const sizeBase=c.band===0?Math.round((p.majorMin+p.majorMax)*.54):c.band===1?Math.round((p.majorMin+p.majorMax)*.47):c.band===2?Math.round((p.majorMin+p.majorMax)*.40):c.band===3?Math.round((p.majorMin+p.majorMax)*.34):Math.round((p.majorMin+p.majorMax)*.28);
      const size=Math.max(8,Math.min(p.majorMax,Math.round(sizeBase*profile.sizeMultiplier)));
      const type=c.band===0?(r()<.68?'bar':(r()<.58?'L':'T'))
        :c.band===1?(r()<.45?'L':(r()<.55?'T':'U'))
        :c.band===2?weightedType({type:zoneTypes[(c.x+c.y)%zoneTypes.length]})
        :c.band===3?(r()<.45?'T':(r()<.7?'U':'L'))
        :(r()<.50?'L':(r()<.8?'T':'U'));
      const beforeInfill=walls.slice();
      const sh=makeShape(walls,w,h,c.x,c.y,type,size,r,Math.max(2,Math.min(3,p.majorThickness)));
      const bb=bbox(sh);
      if(bb.minX<3||bb.maxX>w-4||bb.minY<3||bb.maxY>h-4){walls.set(beforeInfill);continue;}
      // Reject a structure that would swallow a large amount of nearby carpet.
      // We want architecture to subdivide empty space, not fill it solid.
      let localFloor=0,localWall=0;
      const rr=8;
      for(let yy=Math.max(1,c.y-rr);yy<=Math.min(h-2,c.y+rr);yy++)for(let xx=Math.max(1,c.x-rr);xx<=Math.min(w-2,c.x+rr);xx++){
        if(walls[yy*w+xx])localWall++;else localFloor++;
      }
      if(localWall>localFloor*1.8){walls.set(beforeInfill);continue;}
      infill.push(c);
      structures.push({kind:'regional',isMajor:true,cx:c.x,cy:c.y,type,size,zoneId:-1,region:profile.name});
    }
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
  const regionCounts={expanse:0,open:0,normal:0,dense:0,maze:0};for(const v of regionField)regionCounts[regionName(regionBand(v,p))]++;
  return {seed:s,width:w,height:h,cellMeters:p.cellMeters,walls,before,broad,detail,fine,regionField,zones,structures,stats:{wallPct:wallCells/walls.length,floorPct:floorCells/walls.length,regionsBefore:beforeRegions.length,regionsAfter:afterRegions.length,connectors,carvedCells:carved,carvePct:carved/Math.max(1,wallCount(before)),reachable,floorCells,majorStructures:structures.filter(x=>x.isMajor).length,secondaryStructures:structures.filter(x=>!x.isMajor).length,regionCounts,regionThresholds:p.regionThresholds,maxClearCells:p.regionMaxClearCells,regionProfiles:{major:p.regionMajorMultiplier,secondary:p.regionSecondaryMultiplier,size:p.regionMajorSizeMultiplier,minSpacing:p.regionMinStructureSpacingByBand}}};
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
    const preferredMax=Math.floor(1000/p.cellMeters);
    let fallback=null,fallbackBest=-1,overMax=null,overMaxBest=-1;
    for(let idx=0;idx<total;idx++){
      if(dist[idx]<0) continue;
      const x=idx%w,z=(idx/w)|0;
      const d=elevatorDir(x,z);
      if(!d) continue;
      if(dist[idx]>fallbackBest){fallbackBest=dist[idx];fallback={x,z,dir:d};}
      if(dist[idx]>=preferredMin && dist[idx]<=preferredMax && dist[idx]>best){best=dist[idx];exit={x,z,dir:d};}
      if(dist[idx]>preferredMax && dist[idx]>overMaxBest){overMaxBest=dist[idx];overMax={x,z,dir:d};}
    }
    if(!exit){
      // Preserve the old 500m+ behavior if a particular architecture has no
      // valid elevator site inside the preferred 500-1000m band.
      if(overMax){exit=overMax;best=overMaxBest;}
      else {exit=fallback;best=fallbackBest;}
    }
    if(!exit) return null;

    tiles[start.z][start.x]=2;
    tiles[exit.z][exit.x]=4;
    const zones=base.zones||[];
    if(typeof MapGraph!=='undefined'){
      MapGraph.reset();
      for(const z of zones){
        const gx=Math.max(0,Math.round(z.cx-5)), gz=Math.max(0,Math.round(z.cy-5));
        MapGraph.nodes.push({id:MapGraph.nodes.length,type:'beta_zone',gx,gz,w:10,h:10,connections:[],deadEnd:false,hasExit:false,hasStart:false,lightProfile:(z.type&&z.type.name==='alcoves')?'BRIGHT':'NORMAL',dark:false,skipLights:false,anomaly:null,extra:{zoneId:z.id,region:z.region,regionBand:z.band,regionValue:z.regionValue}});
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
