const { run } = require("./harness.js");
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
run("Level10Gen.init(77)");
const plan = (s) => run(`(function(){ Level10Gen.init(${s}); const o=[]; for (let j=-3;j<=3;j++) for (let i=-3;i<=3;i++) { const P=Level10Gen.chunk(i,j); o.push([P.hedges.length,P.fences.length,P.paths.length,P.structs.map(s=>s.id),P.lakes.length,P.excl.length]); } return JSON.stringify(o); })()`);
const a = plan(77), b = plan(77), c = plan(78);
ok(a === b, "same seed, same field");
ok(a !== c, "another seed, another field");
// wheat height: above the eyes (1.6) so it blocks the view, below the eyes at the top of a jump (1.6 + 1.14)
const H = run(`(function(){ Level10Gen.init(5); let lo=9,hi=0; for (let i=0;i<5000;i++){ const c=Level10Gen.clump(i,-i*3); lo=Math.min(lo,c.h); hi=Math.max(hi,c.h);} return {lo,hi,apex:1.6+7.4*7.4/(2*24)}; })()`);
console.log("   wheat", H.lo.toFixed(2), "-", H.hi.toFixed(2), "m; eyes at the top of a jump", H.apex.toFixed(2));
ok(H.lo > 1.72 && H.hi < H.apex, "wheat is taller than the standing eyes and just under the top of a jump");
// the same clump twice is identical
ok(run(`JSON.stringify(Level10Gen.clump(12,-9)) === JSON.stringify(Level10Gen.clump(12,-9))`), "clumps are pure");
// structures: a few per kilometre at most, along any straight kilometre
const dens = run(`(function(){ Level10Gen.init(5); const out={barn:0,shed:0,lake:0,water:0,plots:0,maxRun:0,hedge:0,fence:0,path:0,none:0};
  for (let j=-20;j<=20;j++) for (let i=-20;i<=20;i++) { const p=Level10Gen.plot(i,j); out.plots++; if(p.kind!=="wheat") out[p.kind]++; if(p.st&&p.st.water) out.water++; }
  for (let j=-20;j<=20;j++) for (let i=-20;i<=20;i++) { out[Level10Gen.seg("H",i,j).type]++; out[Level10Gen.seg("V",i,j).type]++; }
  // structures within 30 m of a straight 1 km line, many lines
  let worst=0, tot=0, n=0; for (let k=0;k<40;k++) { const z=-1000+k*50, x0=-500+k*7; let c=0; for (let j=-30;j<=30;j++) for (let i=-30;i<=30;i++) { const p=Level10Gen.plot(i,j); if(!p.st) continue; if (Math.abs(p.st.z-z)<30 && p.st.x>=x0 && p.st.x<x0+1000) c++; } worst=Math.max(worst,c); tot+=c; n++; }
  out.worst=worst; out.mean=tot/n; return out; })()`);
console.log("   plots", dens.plots, "barns", dens.barn, "sheds", dens.shed, "lakes", dens.lake, "water barns", dens.water, "| per km line: mean", dens.mean.toFixed(2), "worst", dens.worst);
ok(dens.worst <= 4, "structures within 30 m of any straight kilometre: at most 4 (worst " + dens.worst + ")");
ok(dens.lake / dens.plots < 0.04 && (dens.barn + dens.shed) / dens.plots < 0.08, "structures and lakes are rare");
ok(dens.water > 0 && dens.water < dens.barn * 0.3, "almond water exists but is very rare (" + dens.water + " of " + dens.barn + " barns)");
ok(dens.path / (dens.hedge + dens.fence + dens.path + dens.none) < 0.07 && dens.hedge > dens.fence, "paths are rare, hedges are the common split (" + [dens.hedge, dens.fence, dens.path, dens.none].join("/") + ")");
// water only in a barn
const w = run(`(function(){ Level10Gen.init(5); let bad=0, n=0; for (let j=-30;j<=30;j++) for (let i=-30;i<=30;i++) { const p=Level10Gen.plot(i,j); if (p.st && p.st.water) { n++; if (p.st.kind!=="barn") bad++; } if (p.st && p.st.kind==="shed" && p.st.water) bad++; if (p.lake && p.lake.water) bad++; } return bad; })()`);
ok(w === 0, "almond water only in barns");
// no structure overlaps a line or the ring zone; hay never blocks the aisle
const q = run(`(function(){ Level10Gen.init(5); let bad=0, aisle=0; for (let j=-30;j<=30;j++) for (let i=-30;i<=30;i++) { const p=Level10Gen.plot(i,j); const s=p.st; if(!s) continue; const r=Math.max(s.w,s.d)/2+2.5; if (s.x-r<p.x0+1.5||s.x+r>p.x1-1.5||s.z-r<p.z0+1.5||s.z+r>p.z1-1.5) bad++; if (Math.hypot(s.x,s.z)<26) bad++; if (s.kind==="barn") for (const k of s.stacks) if (Math.abs(k.lx)-k.fx/2<1.8) aisle++; } return {bad,aisle}; })()`);
ok(q.bad === 0, "structures sit inside their plot, clear of lines and of the ring");
ok(q.aisle === 0, "hay never blocks the centre aisle");
// exit
const E = run(`(function(){ Level10Gen.init(5); const e=Level10Gen.exitInfo(); return {x:e.x,z:e.z,d:e.dist,kind:e.st.kind,exit:e.st.exit}; })()`);
ok(E.d >= 700 && E.d <= 1010 && E.kind === "barn" && E.exit, "way on is a barn " + Math.round(E.d) + " m from the ring");
// spawn
const S = run(`(function(){ let bad=0; for (let s=1;s<200;s++){ Level10Gen.init(s); const p=Level10Gen.spawnInfo(); const P=Level10Gen.chunk(Math.floor(p.x/36),Math.floor(p.z/36)); if (Level10Gen.excluded(P,p.x,p.z)) bad++; if (P.hedges.length+P.fences.length+P.paths.length+P.structs.length+P.lakes.length) bad++; const d=Math.hypot(p.x,p.z); if (d<13||d>20) bad++; } return bad; })()`);
ok(S === 0, "spawn is in plain wheat just outside the ring for 200 seeds");
// look curve
ok(run("Level10Gen.lerpT(0)") === 0 && run("Level10Gen.lerpT(12)") === 0 && run("Level10Gen.lerpT(120)") === 1 && run("Level10Gen.lerpT(150)") === 1 && run("Level10Gen.lerpT(66)") > 0.4, "look lerp is 0 at the ring, 1 well before the lock, smooth between");
console.log(fails ? "FAILS " + fails : "PASS");
