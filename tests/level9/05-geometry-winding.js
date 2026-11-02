const { ctx, run } = require("./harness.js");
const r = run(`(function(){
  const out = { bad: 0, inward: 0, tris: 0, pos: 0 };
  const check = (b, cx, cy, cz) => {
    for (let t = 0; t < b.p.length / 9; t++) {
      const P = b.p.slice(t*9, t*9+9), N = b.n.slice(t*9, t*9+3);
      const u=[P[3]-P[0],P[4]-P[1],P[5]-P[2]], v=[P[6]-P[0],P[7]-P[1],P[8]-P[2]];
      const c=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
      const dot = c[0]*N[0]+c[1]*N[1]+c[2]*N[2];
      out.tris++;
      if (dot <= 0) out.bad++;                                    // winding must agree with the stored normal
      const fx=(P[0]+P[3]+P[6])/3-cx, fy=(P[1]+P[4]+P[7])/3-cy, fz=(P[2]+P[5]+P[8])/3-cz;
      if (fx*N[0]+fy*N[1]+fz*N[2] <= 0) out.inward++;             // and the normal must point away from the centre
    }
  };
  for (const [th, ox, oz, ry] of [[0,0,0,0],[Math.PI/2,10,-4,0],[Math.PI,3,3,0.7],[-Math.PI/2,-5,8,-1.1],[0,0,0,2.2]]) {
    const b = new L9Builder(); b.push(th, ox, oz);
    b.box(1.5, 2, -0.5, 3, 2, 1, [1,1,1], ry);
    const cx = ox + 1.5*Math.round(Math.cos(th)) + (-0.5)*Math.round(Math.sin(th)), cz = oz - 1.5*Math.round(Math.sin(th)) + (-0.5)*Math.round(Math.cos(th));
    check(b, cx, 2, cz);
    out.pos += b.p.length/9;
  }
  const b2 = new L9Builder(); b2.cone(0,0,0,1,2,6,[1,1,1]); b2.lump(0,1,0,1,1,1,[1,1,1]); check(b2, 0, 0.6, 0);
  return out; })()`);
console.log(r, r.bad === 0 && r.inward === 0 ? "PASS: all triangles wound and facing outward" : "FAIL");
