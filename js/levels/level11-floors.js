"use strict";

/* Level 11 — floor plans. Pure generation (no THREE, no DOM). A plan is plain data in the building's local frame
   (origin at the footprint centre, entrance on local +z, y measured up from the floor's walking surface):

     walls   solid boxes (visible and collidable): partitions, the lift/stair core, bay walls
     props   furniture and fittings; `col` says whether the player collides with it; stair treads are props
     panels  ceiling light panels (emissive, visual only); lights: the few that may also drive a real point light
     loot    { id, kind, x, z, y }: deterministic spots. Whether one was taken is NOT here (that is persistent state)
     reach   points that must be walkable from the lift door (used by the tests)
     windows / perimDoors   openings in the outer wall (the runtime builds the wall round them)
     slab    { holes } openings in this floor's slab (where a stair or ramp arrives from below)

   A plan is a pure function of (world seed, building, floor). It never reads persistent state: regenerating a floor
   returns the same layout and the same loot every time. Player changes live in Level11.persist, per floor key.

   THE CORE (same place on every floor, so the lift and the stairs line up from the basement to the roof)
     11 x 9 m at the centre. The lift cell is x -4.4..-1.6, z 1.9..4.5 with its door on the +z face. The stair shaft is
     x 0.4..3.8, z -0.6..4.5: a dog-leg of two flights of thin treads (0.2 m rise, 0.28 m tread) round a landing.
     Each floor's plan holds the flight that goes UP from it. The slab of the floor above has a hole over the flight. */
const Level11Floors = {
  T: 0.4,                                   // outer wall thickness
  WT: 0.2,                                  // partition thickness
  RX: 8.7, RZ: 7.7, RING_T: 0.3,            // the ring corridor round the core
  CORE: { x0: -5.5, x1: 5.5, z0: -4.5, z1: 4.5 },
  FRONT: 0.3,                               // thickness of the core's front wall (z 4.5..4.8)
  ELEV: { x0: -4.4, x1: -1.6, z0: 1.9, z1: 4.5, dx0: -3.6, dx1: -2.4 },
  STAIR: { x0: 0.4, x1: 3.8, z0: -0.6, z1: 4.5, dx0: 1.2, dx1: 2.8, aX1: 2.0, bX0: 2.2, zTop: 3.4, tread: 0.28, rise: 0.2 },
  DOOR_H: 2.3,
  LOOT: {
    residential: { n: 1.0, aw: 55 }, office: { n: 1.3, aw: 35 }, hotel: { n: 1.1, aw: 60 }, commercial: { n: 2.0, aw: 45 },
    cafeteria: { n: 3.5, aw: 50 }, medical: { n: 1.6, aw: 75 }, utility: { n: 0.6, aw: 30 }, unfinished: { n: 0.3, aw: 50 },
    parking: { n: 0.7, aw: 40 }, lobby: { n: 0.5, aw: 50 }, roof: { n: 0.8, aw: 50 }, garage: { n: 4.0, aw: 60 }
  },
  // the clear height of a floor: floor-to-floor minus the slab above
  clear(f) { return (f >= 1 ? Level11Gen.FLOOR_H : Level11Gen.BASE_H) - Level11Gen.SLAB; },

  /* ------------------------------------------------------------------ plan builder */
  newPlan(b, f, type, rect) {
    const G = Level11Gen, hw = b.w / 2, hd = b.d / 2, r = rect || { x0: -hw, z0: -hd, x1: hw, z1: hd };
    const P = {
      key: b.key + "#" + f, bkey: b.key, floor: f, type, seed: G.floorSeed(G.seed, b.idHash, f), w: r.x1 - r.x0, d: r.z1 - r.z0, rect: r,
      H: G.floorHeight(f), clear: this.clear(f), y: G.floorY(f),
      walls: [], props: [], panels: [], lights: [], loot: [], slots: [], reach: [], windows: [], perimDoors: [], slab: { holes: [], top: false },
      col: { wall: 0xc8c4b8, floor: 0x6a6a66, ceil: 0xd6d4cc, light: 0xfff0d0 },
      lightSpec: { c: 0xfff0d0, base: 5, dist: 13 }, elev: null, stair: null, keepOut: [], units: [], bays: null
    };
    return P;
  },
  rect(a, b, c, d) { return { x0: Math.min(a, c), z0: Math.min(b, d), x1: Math.max(a, c), z1: Math.max(b, d) }; },
  overlap(a, b, m) { m = m || 0; return a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m; },
  wall(P, x0, z0, x1, z1, c, y0, y1) {
    const r = this.rect(x0, z0, x1, z1);
    if (r.x1 - r.x0 < 1e-4 || r.z1 - r.z0 < 1e-4) return;
    P.walls.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y0: y0 == null ? 0 : y0, y1: y1 == null ? P.clear : y1, c: c == null ? P.col.wall : c });
  },
  // a wall along x at z..z+t with door gaps [[a0,a1],...]; a lintel closes each gap above DOOR_H
  wallX(P, xa, xb, z, t, gaps, c) {
    let x = xa; const g = (gaps || []).slice().sort((p, q) => p[0] - q[0]);
    for (const [a0, a1] of g) { this.wall(P, x, z, a0, z + t, c); this.wall(P, a0, z, a1, z + t, c, this.DOOR_H); x = a1; }
    this.wall(P, x, z, xb, z + t, c);
  },
  wallZ(P, za, zb, x, t, gaps, c) {
    let z = za; const g = (gaps || []).slice().sort((p, q) => p[0] - q[0]);
    for (const [a0, a1] of g) { this.wall(P, x, z, x + t, a0, c); this.wall(P, x, a0, x + t, a1, c, this.DOOR_H); z = a1; }
    this.wall(P, x, z, x + t, zb, c);
  },
  // a prop from a rectangle; col false = decoration the player walks through; emi = lit
  prop(P, x0, z0, x1, z1, y0, y1, c, col, emi) {
    const r = this.rect(x0, z0, x1, z1);
    if (this.blocked(P, r)) return null;
    const o = { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y0, y1, c, col: col !== false };
    if (emi) o.emi = true;
    P.props.push(o);
    return o;
  },
  blocked(P, r) { for (const k of P.keepOut) if (this.overlap(r, k)) return true; return false; },
  slot(P, x, z, y) { if (!this.blocked(P, this.rect(x - 0.05, z - 0.05, x + 0.05, z + 0.05))) P.slots.push({ x: +x.toFixed(2), z: +z.toFixed(2), y: +y.toFixed(2) }); },
  reach(P, x, z) { P.reach.push({ x: +x.toFixed(2), z: +z.toFixed(2) }); },
  panel(P, x, z, sx, sz, on) { P.panels.push({ x: +x.toFixed(2), z: +z.toFixed(2), sx, sz, on: on !== false }); },
  light(P, x, z) { P.lights.push({ x: +x.toFixed(2), z: +z.toFixed(2) }); },

  /* ------------------------------------------------------------------ the core */
  // opts: { elevator: bool, stairDoor: bool, up: bool (a flight up from here), hole: bool (a flight arrives from below),
  //         noElevatorDoor }
  core(P, opts) {
    const G = Level11Gen, C = this.CORE, E = this.ELEV, S = this.STAIR, wc = 0x9d988c, h = P.clear;
    // the five solid masses round the two voids
    this.wall(P, C.x0, C.z0, E.x0, C.z1, wc);                      // west mass
    this.wall(P, E.x0, C.z0, E.x1, E.z0, wc);                      // north of the lift cell
    this.wall(P, E.x1, C.z0, S.x0, C.z1, wc);                      // between the lift cell and the stair shaft
    this.wall(P, S.x0, C.z0, S.x1, S.z0, wc);                      // north of the stair shaft
    this.wall(P, S.x1, C.z0, C.x1, C.z1, wc);                      // east mass
    // the front wall (z 4.5..4.8) with the two doorways
    const gaps = [];
    if (opts.elevator) gaps.push([E.dx0, E.dx1]);
    if (opts.stairDoor) gaps.push([S.dx0, S.dx1]);
    this.wallX(P, C.x0, C.x1, C.z1, this.FRONT, gaps, wc);
    if (opts.elevator) {
      P.elev = { x0: E.x0, x1: E.x1, z0: E.z0, z1: E.z1, dx0: E.dx0, dx1: E.dx1, doorZ: C.z1 + this.FRONT / 2 };
      this.prop(P, E.dx1 + 0.15, C.z1 + this.FRONT, E.dx1 + 0.35, C.z1 + this.FRONT + 0.06, 1.0, 1.35, 0xd8a040, false, true);  // the call button
      this.prop(P, (E.dx0 + E.dx1) / 2 - 0.25, C.z1 + this.FRONT, (E.dx0 + E.dx1) / 2 + 0.25, C.z1 + this.FRONT + 0.05, 2.45, 2.6, 0xe05a3a, false, true);  // floor indicator
    }
    if (opts.stairDoor) this.prop(P, (S.dx0 + S.dx1) / 2 - 0.3, C.z1 + this.FRONT, (S.dx0 + S.dx1) / 2 + 0.3, C.z1 + this.FRONT + 0.05, 2.45, 2.6, 0x4fa06a, false, true);  // STAIRS sign
    if (opts.hole) P.slab.holes.push({ x0: S.x0, z0: S.z0, x1: S.x1, z1: S.zTop });
    if (opts.up) this.flight(P, opts.upH || G.floorHeight(P.floor), opts.upTo);
    P.core = true;
    return P;
  },
  // the flight from this floor up to the next: treads are thin (0.3) so the flight above clears the head of the one below
  flight(P, H, toRoof) {
    const S = this.STAIR, n = Math.round(H / (2 * S.rise)), zL = S.zTop - S.tread * n, col = 0xb4b0a6;
    P.stair = { n, rise: S.rise, H, zLanding: zL, toRoof: !!toRoof };
    for (let i = 0; i < n; i++) {
      const top = S.rise * (i + 1);
      P.props.push({ x0: S.x0, z0: S.zTop - S.tread * (i + 1), x1: S.aX1, z1: S.zTop - S.tread * i, y0: top - 0.3, y1: top, c: col, col: true, stair: true });
    }
    P.props.push({ x0: S.x0, z0: S.z0, x1: S.x1, z1: zL, y0: S.rise * n - 0.2, y1: S.rise * n, c: col, col: true, stair: true });        // landing
    for (let j = 0; j < n; j++) {
      const top = S.rise * (n + j + 1);
      P.props.push({ x0: S.bX0, z0: zL + S.tread * j, x1: S.x1, z1: zL + S.tread * (j + 1), y0: top - 0.3, y1: top, c: col, col: true, stair: true });
    }
    P.props.push({ x0: S.aX1, z0: zL, x1: S.bX0, z1: S.zTop, y0: 0, y1: 1.0, c: 0x8a867c, col: true, stair: true, rail: true });         // the newel wall between the flights (low)
  },

  /* ------------------------------------------------------------------ windows */
  // regular windows round the outside. avoid: per side, [a0,a1] spans to skip (partitions, doors)
  windowsRegular(P, pitch, width, y0, y1, avoid, sides) {
    const r = P.rect, S = sides || ["N", "S", "E", "W"];
    for (const s of S) {
      const ns = s === "N" || s === "S", lo = ns ? r.x0 : r.z0, hi = ns ? r.x1 : r.z1, len = hi - lo, n = Math.max(1, Math.floor((len - 3) / pitch));
      const first = lo + (len - (n - 1) * pitch) / 2;
      for (let i = 0; i < n; i++) {
        const c = first + i * pitch, a0 = c - width / 2, a1 = c + width / 2;
        if ((avoid && avoid[s] || []).some(v => a1 > v[0] && a0 < v[1])) continue;
        P.windows.push({ side: s, a0: +a0.toFixed(2), a1: +a1.toFixed(2), y0, y1 });
      }
    }
  },

  /* ------------------------------------------------------------------ corridor floors: a ring corridor and units round it */
  // Units: 3 along each of the north and south bands (between the east and west bands) and 3 down each of the west and
  // east bands. Each unit opens onto the ring corridor through one doorway, so the ring is the only circulation.
  // `unit.f` is the unit frame: u along the door wall, v from the door wall into the room.
  ring(P, R, o) {
    const r = P.rect, hw = r.x1, hd = r.z1, RX = this.RX, RZ = this.RZ, rt = this.RING_T, wc = o.wall || P.col.wall, units = [];
    const dw = o.doorW || 1.1, wt = this.WT, ox = RX + rt, oz = RZ + rt;       // outer faces of the ring wall: 9.0 / 8.0
    const gap = { N: [], S: [], E: [], W: [] }, avoid = { N: [], S: [], E: [], W: [] };
    const nNS = o.nNS || 3, nSplit = o.splitWE || [-2.6, 2.6];
    // north and south bands
    for (const side of ["N", "S"]) {
      const sg = side === "N" ? -1 : 1, zin = sg * oz, zout = sg * (hd - this.T), edges = [-ox];
      for (let i = 1; i < nNS; i++) edges.push(-ox + (2 * ox) * i / nNS + (R() - 0.5) * 0.8);
      edges.push(ox);
      for (let i = 0; i < nNS; i++) {
        const x0 = edges[i], x1 = edges[i + 1];
        if (i > 0) this.wallZ(P, Math.min(zin, zout), Math.max(zin, zout), x0 - wt / 2, wt, [], wc);
        const c = (x0 + x1) / 2 + (R() - 0.5) * Math.min(0.8, (x1 - x0) - dw - 1.2);
        gap[side].push([c - dw / 2, c + dw / 2]);
        units.push({ side, rect: this.rect(x0 + (i ? wt / 2 : 0), zin, x1 - (i < nNS - 1 ? wt / 2 : 0), zout), door: c });
        if (i > 0) avoid[side].push([x0 - 0.4, x0 + 0.4]);
      }
    }
    // west and east bands: full depth, three units, the middle one centred on the core
    for (const side of ["W", "E"]) {
      const sg = side === "W" ? -1 : 1, xin = sg * ox, xout = sg * (hw - this.T), zlo = -(hd - this.T), zhi = hd - this.T, edges = [zlo, nSplit[0], nSplit[1], zhi];
      for (let i = 0; i < 3; i++) {
        const z0 = edges[i], z1 = edges[i + 1];
        if (i > 0) this.wallX(P, Math.min(xin, xout), Math.max(xin, xout), z0 - wt / 2, wt, [], wc);
        const dc = i === 0 ? Math.max(z0 + 0.9, -5.6) : i === 2 ? Math.min(z1 - 0.9, 5.6) : (z0 + z1) / 2;
        const dcC = i === 0 ? Math.min(dc, -4.2) : i === 2 ? Math.max(dc, 4.2) : dc;
        gap[side].push([dcC - dw / 2, dcC + dw / 2]);
        units.push({ side, rect: this.rect(xin, z0 + (i ? wt / 2 : 0), xout, z1 - (i < 2 ? wt / 2 : 0)), door: dcC });
        if (i > 0) avoid[side].push([z0 - 0.4, z0 + 0.4]);
      }
    }
    // the ring wall itself, with a doorway to every unit
    this.wallX(P, -ox, ox, -oz, rt, gap.N, wc);                    // north line z -8.0..-7.7
    this.wallX(P, -ox, ox, RZ, rt, gap.S, wc);                     // south line z 7.7..8.0
    this.wallZ(P, -RZ, RZ, -ox, rt, gap.W, wc);                    // west line x -9.0..-8.7
    this.wallZ(P, -RZ, RZ, RX, rt, gap.E, wc);                     // east line
    // where the north/south bands meet the west/east bands (outside the corridor): a closing wall
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.wall(P, sx * ox - 0.05, sz * oz, sx * ox + 0.05, sz * (hd - this.T), wc);
    // unit frames: u runs along the door wall, v into the room; the door is at u = du
    for (const U of units) {
      const q = U.rect, N = U.side === "N", S = U.side === "S", W = U.side === "W";
      U.len = (N || S) ? q.x1 - q.x0 : q.z1 - q.z0; U.dep = (N || S) ? q.z1 - q.z0 : q.x1 - q.x0;
      const du = (N || S) ? U.door - q.x0 : U.door - q.z0;
      U.du = du;
      // u,v -> x,z. N band: door on its +z face, v goes -z; S band: door on its -z face, v goes +z; W: door on +x, v goes -x; E: door on -x, v goes +x
      U.pt = N ? (u, v) => [q.x0 + u, q.z1 - v] : S ? (u, v) => [q.x0 + u, q.z0 + v] : W ? (u, v) => [q.x1 - v, q.z0 + u] : (u, v) => [q.x0 + v, q.z0 + u];
      U.in = (x, z) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1;
    }
    P.units = units;
    // the ring corridor itself must stay free: reach points at its four corners and mid-sides
    for (const [x, z] of [[-7, -6.3], [7, -6.3], [7, 6.3], [-7, 6.3], [0, -6.3], [0, 6.3], [-7.6, 0], [7.6, 0]]) this.reach(P, x, z);
    P.avoid = avoid;
    return units;
  },
  // a box in a unit's frame
  ubox(P, U, u0, v0, u1, v1, y0, y1, c, col, emi) {
    const a = U.pt(u0, v0), b = U.pt(u1, v1);
    return this.prop(P, a[0], a[1], b[0], b[1], y0, y1, c, col, emi);
  },
  uwall(P, U, u0, v0, u1, v1, c, gap) {
    const a = U.pt(u0, v0), b = U.pt(u1, v1);
    this.wall(P, a[0], a[1], b[0], b[1], c);
  },
  upoint(U, u, v) { return U.pt(u, v); },
  // Items hug the back wall and the two side walls and leave the door lane (|u - du| < 0.9) and the middle free, so a unit
  // can never be blocked by what is in it. items: { w (along the wall), dp (into the room), h, c, slot (loot height) }
  hug(P, U, wall, items, R, o) {
    o = o || {};
    const out = [], lane = 0.95;
    if (wall === "back") {
      let u = 0.15;
      for (const it of items) {
        const w = it.w;
        if (u + w > U.len - 0.15) break;
        if (U.du + lane > u && U.du - lane < u + w) { u = U.du + lane; if (u + w > U.len - 0.15) break; }
        const q = this.ubox(P, U, u, U.dep - 0.12 - it.dp, u + w, U.dep - 0.12, it.y0 || 0, it.h, it.c, it.col !== false, it.emi);
        if (q && it.slot != null && u > 1.3 && u + w < U.len - 1.3) { const m = U.pt(u + w / 2, U.dep - 0.12 - it.dp + Math.min(0.25, it.dp / 2)); this.slot(P, m[0], m[1], it.slot); }   // on the face toward the room, so it can be reached
        out.push(q);
        u += w + 0.1 + (o.gap == null ? R() * 0.5 : o.gap);
      }
    } else {
      const left = wall === "left";
      let v = o.from == null ? 2.4 : o.from;
      for (const it of items) {
        const w = it.w;
        if (v + w > U.dep - (o.keep || 0.3)) break;
        const u0 = left ? 0.12 : U.len - 0.12 - it.dp, u1 = left ? 0.12 + it.dp : U.len - 0.12;
        const q = this.ubox(P, U, u0, v, u1, v + w, it.y0 || 0, it.h, it.c, it.col !== false, it.emi);
        if (q && it.slot != null && v + w < U.dep - 1.3) { const m = U.pt(left ? u1 - Math.min(0.25, it.dp / 2) : u0 + Math.min(0.25, it.dp / 2), v + w / 2); this.slot(P, m[0], m[1], it.slot); }
        out.push(q);
        v += w + 0.1 + (o.gap == null ? R() * 0.4 : o.gap);
      }
    }
    return out;
  },
  // a window on a unit's outer wall, centred on the room
  unitWindows(P, U, y0, y1, width, R) {
    const q = U.rect, h = P.rect;
    const outer = [];
    if (U.side === "N" || q.z0 <= h.z0 + this.T + 1e-6) outer.push("N");
    if (U.side === "S" || q.z1 >= h.z1 - this.T - 1e-6) outer.push("S");
    if (U.side === "W" || q.x0 <= h.x0 + this.T + 1e-6) outer.push("W");
    if (U.side === "E" || q.x1 >= h.x1 - this.T - 1e-6) outer.push("E");
    for (const s of outer) {
      const ns = s === "N" || s === "S", lo = ns ? q.x0 : q.z0, hi = ns ? q.x1 : q.z1, w = Math.min(width, hi - lo - 1.2);
      if (w < 0.8) continue;
      const c = (lo + hi) / 2;
      P.windows.push({ side: s, a0: +(c - w / 2).toFixed(2), a1: +(c + w / 2).toFixed(2), y0, y1 });
    }
  },

  /* ------------------------------------------------------------------ ceiling lights */
  // a grid of panels over the open floor, skipping the core and keep-outs; every other panel also drives a point light
  gridLights(P, R, pitch, o) {
    o = o || {};
    const r = P.rect, C = this.CORE, dead = o.dead == null ? 0.08 : o.dead, sx = o.sx || 1.2, sz = o.sz || 0.5;
    let k = 0;
    for (let z = r.z0 + pitch / 2 + this.T; z < r.z1 - this.T; z += pitch) for (let x = r.x0 + pitch / 2 + this.T; x < r.x1 - this.T; x += pitch) {
      if (x > C.x0 - 0.5 && x < C.x1 + 0.5 && z > C.z0 - 0.5 && z < C.z1 + this.FRONT + 0.5) continue;
      if (this.blocked(P, this.rect(x - 0.6, z - 0.3, x + 0.6, z + 0.3))) continue;
      const on = R() >= dead;
      this.panel(P, x, z, sx, sz, on);
      if (on && (k++ % 2 === 0)) this.light(P, x, z);
    }
  },
  // panels along the ring corridor and one in each unit
  ringLights(P, R, o) {
    o = o || {};
    const ox = this.RX - 1.6, oz = this.RZ - 1.6, dead = o.dead == null ? 0.06 : o.dead;
    const pts = [];
    for (let x = -ox; x <= ox + 0.01; x += 4.6) { pts.push([x, -(this.RZ - 1.5)]); pts.push([x, this.RZ - 1.5]); }
    for (let z = -oz + 3; z <= oz - 3 + 0.01; z += 4.6) { pts.push([-(this.RX - 1.5), z]); pts.push([this.RX - 1.5, z]); }
    let k = 0;
    for (const [x, z] of pts) { const on = R() >= dead; this.panel(P, x, z, 0.9, 0.4, on); if (on && (k++ % 2 === 0)) this.light(P, x, z); }
    for (const U of P.units) { const m = U.pt(U.len / 2, U.dep / 2), on = R() >= dead; this.panel(P, m[0], m[1], 1.0, 0.5, on); if (on && o.unitLights) this.light(P, m[0], m[1]); }
  },

  /* ------------------------------------------------------------------ loot */
  // Weighted by the floor type and chosen from the spots the layout offered, with a stream of its own so the layout
  // never shifts when a loot table is tuned. Ids are stable: floor-key + index.
  placeLoot(P, type) {
    const G = Level11Gen, spec = this.LOOT[type] || { n: 0.3, aw: 50 }, R = G.rng(P.seed ^ 0x10077);
    R(); R();
    const slots = P.slots.slice();
    let n = Math.floor(spec.n) + (R() < spec.n - Math.floor(spec.n) ? 1 : 0);
    for (let i = 0; i < n && slots.length; i++) {
      const s = slots.splice(Math.floor(R() * slots.length), 1)[0], kind = R() * 100 < spec.aw ? "almond" : "energy";
      P.loot.push({ id: P.key + ":" + P.loot.length, kind, x: s.x, z: s.z, y: s.y });
    }
  },
  finish(P, type) {
    this.placeLoot(P, type);
    for (const l of P.loot) this.reach(P, l.x, l.z);
    return P;
  }
};


Object.assign(Level11Floors, {
  GARAGE_Y: -90, GARAGE_RECT: { x0: -12, z0: -28, x1: 64, z1: 28 },
  hasUp(b, f) { const G = Level11Gen; return G.floorAbove(b, f) != null && !(f === -1 && !b.basement.pedestrian); },
  // the entrance's and the garage door's span along the south wall (local x)
  rampBay(b) {
    if (!b.basement.has || !b.basement.ramp) return null;
    const hw = b.w / 2, hd = b.d / 2, rs = b.basement.rampSide;
    const x0 = rs < 0 ? -hw + 0.4 : hw - 5.8, x1 = rs < 0 ? -hw + 5.8 : hw - 0.4;
    return { x0, x1, z0: hd - 12.8, z1: hd - 0.4, inner: rs < 0 ? x1 : x0, rs };
  },
  // the openings in the slab ABOVE floor f (a stair flight; the ramp), so the ceiling of f is drawn round them
  ceilHoles(b, f) {
    const S = this.STAIR, h = [];
    if (this.hasUp(b, f)) h.push({ x0: S.x0, z0: S.z0, x1: S.x1, z1: S.zTop });
    if (f === -1) { const bay = this.rampBay(b); if (bay) h.push({ x0: bay.x0, z0: b.d / 2 - 12.4, x1: bay.x1, z1: b.d / 2 - 1.6 }); }
    return h;
  },
  ringKeep() { return this.rect(-9.0, -8.2, 9.0, 8.2); },
  pick(R, list, n) { const a = list.slice(), o = []; for (let i = 0; i < n && a.length; i++) o.push(a.splice(Math.floor(R() * a.length), 1)[0]); return o; },

  /* ------------------------------------------------------------------ the dispatcher */
  plan(b, f) {
    const G = Level11Gen, type = G.floorType(b, f);
    if (!type) return null;
    const hasElev = f >= 1 && f <= b.floors, below = G.floorBelow(b, f);
    const P = this.newPlan(b, f, type, this.sizeFor(b, f, type));
    const R = G.rng(P.seed); R(); R();
    const opts = { elevator: hasElev, stairDoor: true, up: this.hasUp(b, f), upTo: f === b.floors, hole: below != null && this.hasUp(b, below) };
    if (type === "roof") return this.roof(P, b, R);
    this.core(P, opts);
    ({ lobby: this.lobby, residential: this.residential, hotel: this.hotel, medical: this.medical, office: this.office, commercial: this.commercial,
       cafeteria: this.cafeteria, utility: this.utility, unfinished: this.unfinished, parking: this.parking })[type].call(this, P, b, R);
    return this.finish(P, type);
  },
  // one unusually large floor / basement are rare variations of a category: the same plan on a bigger footprint
  sizeFor(b, f, type) {
    const v = b.variations, hw = b.w / 2, hd = b.d / 2;
    if (type === "parking" && v.bigBasement) return this.rect(-hw - 18, -hd - 18, hw + 18, hd + 18);
    return this.rect(-hw, -hd, hw, hd);
  },

  /* ------------------------------------------------------------------ corridor floors */
  residential(P, b, R) {
    P.col = { wall: 0xcbc2ae, floor: 0x6b5a48, ceil: 0xd8d4c8, light: 0xffe2b0 }; P.lightSpec = { c: 0xffe2b0, base: 4.6, dist: 12 };
    const units = this.ring(P, R, { wall: 0xb8ad98, doorW: 1.1 });
    this.ringLights(P, R, { dead: 0.1 });
    const tone = [0x8a6a5a, 0x5a6a7a, 0x6a7a5a, 0x7a5a6a];
    for (const U of units) {
      const c = tone[Math.floor(R() * tone.length)];
      this.hug(P, U, "back", this.pick(R, [{ w: 1.7, dp: 2.1, h: 0.55, c, slot: 0.6 }, { w: 1.2, dp: 0.6, h: 2.0, c: 0x6b5440 }, { w: 0.5, dp: 0.45, h: 0.55, c: 0x7a6650, slot: 0.6 }, { w: 2.0, dp: 0.9, h: 0.8, c: 0x6a6a7a }, { w: 1.0, dp: 0.7, h: 0.75, c: 0x8a7458, slot: 0.8 }], 4), R);
      this.hug(P, U, "left", this.pick(R, [{ w: 1.0, dp: 0.6, h: 0.9, c: 0xa8a8a0, slot: 0.95 }, { w: 0.8, dp: 0.7, h: 1.8, c: 0xd0d0cc }, { w: 1.4, dp: 0.5, h: 0.5, c: 0x7a6a58, slot: 0.55 }], 3), R);
      if (R() < 0.5) this.hug(P, U, "right", this.pick(R, [{ w: 1.2, dp: 0.5, h: 1.0, c: 0x7a6650, slot: 1.05 }, { w: 0.9, dp: 0.9, h: 0.5, c: 0x5a6a5a }], 2), R);
      this.ubox(P, U, U.du - 0.8, 0.2, U.du + 0.8, 1.6, 0.005, 0.02, 0x7a3a3a, false);        // a rug just inside the door
      const m = U.pt(U.du, U.dep * 0.5); this.reach(P, m[0], m[1]);
      this.unitWindows(P, U, 0.9, 2.3, 1.6, R);
    }
  },
  hotel(P, b, R) {
    P.col = { wall: 0xb89a82, floor: 0x6a2b2b, ceil: 0xcfc4b4, light: 0xffd8a0 }; P.lightSpec = { c: 0xffd8a0, base: 4.4, dist: 12 };
    const units = this.ring(P, R, { wall: 0x9a7e68, doorW: 1.0, nNS: 4 });
    this.ringLights(P, R, { dead: 0.05 });
    let num = 1;
    for (const U of units) {
      const pl = U.pt(U.du, -0.34), pr = U.pt(U.du + 0.3, -0.3);
      this.prop(P, pl[0] - 0.15, pl[1] - 0.15, pr[0] + 0.15, pr[1] + 0.15, 2.05, 2.2, 0xe0c070, false, true);          // a room-number plaque
      this.hug(P, U, "back", [{ w: 1.9, dp: 2.1, h: 0.6, c: 0xe6e0d4, slot: 0.65 }, { w: 0.5, dp: 0.5, h: 0.55, c: 0x6a4a3a, slot: 0.6 }, { w: 1.4, dp: 0.6, h: 0.78, c: 0x7a5a42, slot: 0.82 }], R, { gap: 0.2 });
      this.hug(P, U, "left", [{ w: 1.0, dp: 0.5, h: 0.5, c: 0x4a4a52 }, { w: 0.9, dp: 0.6, h: 1.9, c: 0x5a4636 }], R);
      const m = U.pt(U.du, U.dep * 0.5); this.reach(P, m[0], m[1]);
      this.unitWindows(P, U, 0.9, 2.3, 1.4, R);
      num++;
    }
    // an ice machine and a vending alcove just off the lift: against the core's front wall, clear of both doorways
    this.prop(P, 3.9, 4.9, 5.4, 5.5, 0, 1.8, 0x7a8a9a); this.slot(P, 4.65, 5.2, 1.85);
  },
  medical(P, b, R) {
    P.col = { wall: 0xd6e0dc, floor: 0x9fb4b0, ceil: 0xe6eeea, light: 0xe8f4ff }; P.lightSpec = { c: 0xe8f4ff, base: 5.6, dist: 13 };
    const units = this.ring(P, R, { wall: 0xc4d0cc, doorW: 1.4 });
    this.ringLights(P, R, { dead: 0.04, unitLights: true });
    units.forEach((U, i) => {
      const kind = i % 4 === 0 ? "waiting" : i % 4 === 2 && R() < 0.6 ? "lab" : "ward";
      if (kind === "waiting") {
        for (let v = 1.8; v < U.dep - 1.2; v += 1.6) { this.ubox(P, U, 0.5, v, U.du - 1.0, v + 0.5, 0, 0.5, 0x4a6a8a); this.ubox(P, U, U.du + 1.0, v, U.len - 0.5, v + 0.5, 0, 0.5, 0x4a6a8a); }
        this.hug(P, U, "back", [{ w: 1.2, dp: 0.5, h: 0.7, c: 0x7a8a8a, slot: 0.75 }], R);
      } else if (kind === "lab") {
        this.hug(P, U, "back", [{ w: 2.2, dp: 0.7, h: 0.95, c: 0xd0d4d4, slot: 1.0 }, { w: 1.4, dp: 0.8, h: 1.5, c: 0x7a8a90 }, { w: 1.2, dp: 0.7, h: 0.95, c: 0xd0d4d4, slot: 1.0 }], R, { gap: 0.3 });
        this.hug(P, U, "left", [{ w: 1.6, dp: 0.7, h: 0.95, c: 0xd0d4d4, slot: 1.0 }], R);
      } else {
        this.hug(P, U, "back", [{ w: 1.0, dp: 2.0, h: 0.6, c: 0xe8ecec, slot: 0.65 }, { w: 1.0, dp: 2.0, h: 0.6, c: 0xe8ecec, slot: 0.65 }, { w: 0.6, dp: 0.5, h: 0.6, c: 0x9aa8a8, slot: 0.65 }], R, { gap: 0.5 });
        this.hug(P, U, "left", [{ w: 0.9, dp: 0.5, h: 0.9, c: 0xc0c8c8 }], R);
        this.ubox(P, U, 0.3, U.dep * 0.35, U.len - 0.3, U.dep * 0.35 + 0.04, 1.6, 2.4, 0x88b0a8, false);     // a curtain on a rail
      }
      const m = U.pt(U.du, U.dep * 0.45); this.reach(P, m[0], m[1]);
      this.unitWindows(P, U, 1.1, 2.2, 1.2, R);
    });
    this.prop(P, 3.9, 4.9, 5.7, 5.4, 0, 1.0, 0xc8d4d0); this.slot(P, 4.8, 5.15, 1.05);       // a nurse's desk beside the stairs
  },

  /* ------------------------------------------------------------------ open-plan floors */
  openRoom(P, rect, doorSide, doorC, R, fn) {
    const t = this.WT, c = P.col.wall, x0 = rect.x0, z0 = rect.z0, x1 = rect.x1, z1 = rect.z1, g = [[doorC - 0.6, doorC + 0.6]];
    this.wallX(P, x0, x1, z0, t, doorSide === "N" ? g : [], c); this.wallX(P, x0, x1, z1 - t, t, doorSide === "S" ? g : [], c);
    this.wallZ(P, z0, z1, x0, t, doorSide === "W" ? g : [], c); this.wallZ(P, z0, z1, x1 - t, t, doorSide === "E" ? g : [], c);
    P.keepOut.push(rect);
    if (fn) fn(rect);
  },
  office(P, b, R) {
    P.col = { wall: 0xc6c8c6, floor: 0x55606a, ceil: 0xe0e0dc, light: 0xf0f6ff }; P.lightSpec = { c: 0xf0f6ff, base: 5.4, dist: 14 };
    const r = P.rect, T = this.T;
    // two glass-walled meeting rooms on the west and east sides, doors toward the core
    for (const s of [-1, 1]) if (R() < 0.8) {
      const x0 = s < 0 ? r.x0 + T + 0.3 : r.x1 - T - 5.3, rc = this.rect(x0, -3.2, x0 + 5, 3.2);
      this.openRoom(P, rc, s < 0 ? "E" : "W", 0, R, (q) => {
        const tb = this.rect((q.x0 + q.x1) / 2 - 1.2, -1.0, (q.x0 + q.x1) / 2 + 1.2, 1.0);
        P.props.push({ x0: tb.x0, z0: tb.z0, x1: tb.x1, z1: tb.z1, y0: 0, y1: 0.75, c: 0x6a5a4a, col: true }); this.slot(P, (tb.x0 + tb.x1) / 2, 0, 0.8);
        this.reach(P, s < 0 ? q.x1 - 0.9 : q.x0 + 0.9, 2.2);
      });
    }
    P.keepOut.push(this.ringKeep());
    // desk pods in the four bands, in rows with wide aisles
    const rows = [], zN = [], zS = [];
    for (let z = r.z0 + T + 1.6; z < -8.4; z += 3.7) zN.push(z);
    for (let z = r.z1 - T - 1.6; z > 8.4; z -= 3.7) zS.push(z);
    for (const zz of zN.concat(zS)) for (let x = r.x0 + T + 3.4; x < r.x1 - T - 2; x += 5.0) rows.push([x, zz]);
    for (const [x, z] of rows) {
      if (R() < 0.14) continue;
      const dk = this.prop(P, x - 0.8, z - 0.4, x + 0.8, z + 0.4, 0, 0.75, 0x8a7a64);
      if (!dk) continue;
      this.slot(P, x, z, 0.8);
      this.prop(P, x - 0.25, z - 0.1, x + 0.25, z + 0.1, 0.75, 1.1, 0x2a2e32, false);                    // monitor
      this.prop(P, x - 0.25, z + 0.55, x + 0.25, z + 1.0, 0, 0.5, 0x3a4048, false);                      // chair (walk-through: it rolls)
      this.prop(P, x - 0.9, z - 0.46, x + 0.9, z - 0.42, 0, 1.3, 0x7a8088);                              // partition
    }
    this.gridLights(P, R, 5.2, { dead: 0.1, sx: 1.4, sz: 0.5 });
    this.windowsRegular(P, 6, 5, 0.6, 2.6);
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0);
  },
  commercial(P, b, R) {
    P.col = { wall: 0xd8d8d2, floor: 0xa8a8a4, ceil: 0xe8e8e4, light: 0xffffff }; P.lightSpec = { c: 0xffffff, base: 5.8, dist: 14 };
    const r = P.rect, T = this.T;
    P.keepOut.push(this.ringKeep());
    for (const [zz, band] of [[r.z0 + T + 1.0, "N"], [r.z1 - T - 1.0, "S"]]) {                              // long counters on the north and south walls
      const x0 = -9, x1 = 9;
      this.prop(P, x0, band === "N" ? zz - 0.5 : zz - 0.5, x1, band === "N" ? zz + 0.5 : zz + 0.5, 0, 1.0, 0x8a8a86); this.slot(P, 0, zz, 1.05);
    }
    for (let z = r.z0 + T + 3.6; z < -8.6; z += 3.6) for (let x = r.x0 + T + 2.2; x < r.x1 - T - 5; x += 5.6) {
      if (R() < 0.12) continue;
      for (const k of [0, 1]) { const q = this.prop(P, x + k * 2.6 - 1.2, z - 0.25, x + k * 2.6 + 1.2, z + 0.25, 0, 1.8, k ? 0xa0a4a8 : 0x9a8c7a); if (q) this.slot(P, x + k * 2.6, z, 1.85); }
    }
    for (let z = 9.4; z < r.z1 - T - 2.2; z += 3.6) for (let x = r.x0 + T + 2.2; x < r.x1 - T - 5; x += 5.6) {
      if (R() < 0.12) continue;
      for (const k of [0, 1]) { const q = this.prop(P, x + k * 2.6 - 1.2, z - 0.25, x + k * 2.6 + 1.2, z + 0.25, 0, 1.8, k ? 0xa0a4a8 : 0x9a8c7a); if (q) this.slot(P, x + k * 2.6, z, 1.85); }
    }
    // side wings: the west and east bands hold racks in columns
    for (const s of [-1, 1]) for (let x = s * 12; Math.abs(x) < r.x1 - T - 2.4; x += s * 3.6) for (let z = -6; z <= 6; z += 6) {
      if (R() < 0.25) continue;
      const q = this.prop(P, x - 0.25, z - 1.2, x + 0.25, z + 1.2, 0, 1.6, 0x7a8a9a); if (q) this.slot(P, x, z, 1.65);
    }
    this.gridLights(P, R, 4.8, { dead: 0.05, sx: 1.6, sz: 0.5 });
    this.windowsRegular(P, 7, 5.5, 0.3, 2.6);
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0);
  },
  cafeteria(P, b, R) {
    P.col = { wall: 0xd2c8b2, floor: 0x8a7a64, ceil: 0xe2dccc, light: 0xffe8c0 }; P.lightSpec = { c: 0xffe8c0, base: 5.2, dist: 14 };
    const r = P.rect, T = this.T;
    P.keepOut.push(this.ringKeep());
    const cz = r.z0 + T + 1.4;
    this.prop(P, -10, cz - 0.5, 10, cz + 0.5, 0, 1.0, 0x9a9a96); this.slot(P, -5, cz, 1.05); this.slot(P, 5, cz, 1.05);   // the serving line
    this.prop(P, -10, cz - 1.9, 10, cz - 1.6, 0, 2.0, 0x6a6a68);                                              // the kitchen pass behind it
    for (let z = r.z0 + T + 4.2; z < r.z1 - T - 1.5; z += 3.2) for (let x = r.x0 + T + 2.6; x < r.x1 - T - 1.5; x += 3.4) {
      if (this.blocked(P, this.rect(x - 1, z - 0.8, x + 1, z + 0.8)) || R() < 0.1) continue;
      this.prop(P, x - 0.7, z - 0.4, x + 0.7, z + 0.4, 0, 0.75, 0xa8967a); this.slot(P, x, z, 0.8);
      this.prop(P, x - 0.9, z - 0.2, x - 0.7, z + 0.2, 0, 0.45, 0x5a4a3a, false); this.prop(P, x + 0.7, z - 0.2, x + 0.9, z + 0.2, 0, 0.45, 0x5a4a3a, false);
    }
    this.gridLights(P, R, 5.0, { dead: 0.04, sx: 1.3, sz: 0.6 });
    this.windowsRegular(P, 5, 4, 0.5, 2.6);
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0); this.reach(P, 0, cz + 1.6);
  },
  utility(P, b, R) {
    P.col = { wall: 0x8a8a84, floor: 0x5a5a56, ceil: 0x6a6a66, light: 0xffb060 }; P.lightSpec = { c: 0xffb060, base: 4.4, dist: 12 };
    const r = P.rect, T = this.T;
    P.keepOut.push(this.ringKeep());
    const cols = [0x6a7a8a, 0x8a6a4a, 0x5a6a5a, 0x7a7a7e];
    for (let z = r.z0 + T + 3.4; z < r.z1 - T - 2.5; z += 5.8) for (let x = r.x0 + T + 3.8; x < r.x1 - T - 3; x += 6.6) {
      if (R() < 0.18) continue;
      const sx = 2.2 + R() * 1.0, sz = 1.6 + R() * 0.8, h = 2.0 + R() * 0.7;
      const q = this.prop(P, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 0, h, cols[Math.floor(R() * 4)]);
      if (!q) continue;
      if (R() < 0.4) this.slot(P, x, z + sz / 2 - 0.25, h + 0.02);
      this.prop(P, x - sx / 2 - 0.3, z - 0.06, x + sx / 2 + 3.2, z + 0.06, 2.3, 2.45, 0x9a9a92, false);       // a pipe run overhead
    }
    for (let z = r.z0 + T + 0.7; z < r.z1 - T; z += 12) this.prop(P, r.x0 + T, z, r.x1 - T, z + 0.1, 0.0, 0.03, 0xd0b020, false);   // a yellow line
    this.gridLights(P, R, 6.4, { dead: 0.3, sx: 0.7, sz: 0.3 });
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0);
  },
  unfinished(P, b, R) {
    P.col = { wall: 0x8d8d89, floor: 0x777772, ceil: 0x8a8a86, light: 0xffe8a0 }; P.lightSpec = { c: 0xffe8a0, base: 4.0, dist: 12 };
    const r = P.rect, T = this.T;
    P.keepOut.push(this.ringKeep());
    for (let x = r.x0 + T + 3.7; x < r.x1 - T; x += 7.5) for (let z = r.z0 + T + 3.7; z < r.z1 - T; z += 7.5) {
      if (this.blocked(P, this.rect(x - 0.3, z - 0.3, x + 0.3, z + 0.3))) continue;
      this.prop(P, x - 0.25, z - 0.25, x + 0.25, z + 0.25, 0, P.clear, 0x6e6e6a);                           // columns
    }
    for (let i = 0; i < 9; i++) {
      const x = r.x0 + T + 2 + R() * (P.w - 6), z = r.z0 + T + 2 + R() * (P.d - 6), w = 1 + R() * 1.4, d = 0.8 + R() * 0.8, h = 0.4 + R() * 1.1;
      if (this.blocked(P, this.rect(x - w, z - d, x + w, z + d))) continue;
      const kind = R();
      const q = this.prop(P, x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h, kind < 0.5 ? 0x9a9a94 : kind < 0.8 ? 0x8a6a4a : 0x5a6a7a);   // blocks, pallets, bags
      if (q && R() < 0.5) this.slot(P, x, z, h + 0.02);
    }
    for (let i = 0; i < 4; i++) {                                                                          // a work lamp on a stand
      const x = r.x0 + T + 3 + R() * (P.w - 8), z = r.z0 + T + 3 + R() * (P.d - 8);
      if (this.blocked(P, this.rect(x - 0.5, z - 0.5, x + 0.5, z + 0.5))) continue;
      this.prop(P, x - 0.05, z - 0.05, x + 0.05, z + 0.05, 0, 1.6, 0x4a4a48); this.prop(P, x - 0.2, z - 0.05, x + 0.2, z + 0.1, 1.6, 1.75, 0xfff0b0, false, true);
      this.panel(P, x, z, 0.4, 0.15, true); this.light(P, x, z);
    }
    this.windowsRegular(P, 5, 4, 0.2, 2.7);
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0);
  },

  /* ------------------------------------------------------------------ lobby (floor 1) */
  lobby(P, b, R) {
    const G = Level11Gen, r = P.rect, hd = b.d / 2, hw = b.w / 2, bay = this.rampBay(b), T = this.T;
    const pal = { APT: [0xd0c8b8, 0x8a8478], OFF: [0xc8ccd0, 0x70787e], HTL: [0xcdb48a, 0x6a2b2b], COM: [0xdcdcd6, 0xb4b4ae], MED: [0xdce6e2, 0xa8bcb8], MIX: [0xd0c8c0, 0x908a82] }[b.cat];
    P.col = { wall: pal[0], floor: pal[1], ceil: 0xdedad0, light: 0xfff2d8 }; P.lightSpec = { c: 0xfff2d8, base: 5.8, dist: 15 };
    P.perimDoors.push({ side: "S", a0: -1.6, a1: 1.6, h: 2.7, kind: "entrance" });
    if (bay) {
      P.perimDoors.push({ side: "S", a0: bay.x0 + 0.4, a1: bay.x1 - 0.4, h: 3.0, kind: "garage" });
      P.keepOut.push(this.rect(bay.x0, bay.z0, bay.x1 + 0.2, bay.z1));
      P.slab.holes.push({ x0: bay.x0, z0: hd - 12.4, x1: bay.x1, z1: hd - 1.6 });
      P.bays = { ramp: bay };
      const xi = bay.rs < 0 ? bay.x1 : bay.x0 - 0.2;
      this.wall(P, xi, bay.z0, xi + 0.2, bay.z1, 0x8a867c, 0, P.clear);                    // the ramp bay's inner wall
      this.wall(P, bay.x0, bay.z0, bay.x1, bay.z0 + 0.2, 0x8a867c, 0, P.clear);            // and its far end
    }
    P.keepOut.push(this.rect(-9, 4.8, 9, hd));                                              // the way from the door to the core
    const big = b.variations.bigLobby ? 1 : 0;
    const left = bay && bay.rs < 0 ? -hw + 6.4 : -hw + 0.8, right = bay && bay.rs > 0 ? hw - 6.4 : hw - 0.8;
    // category furniture, against the walls so the middle stays open
    const z = hd - 0.8 - 6;
    const add = (x0, z0, x1, z1, h, c, slot) => { const q = this.prop(P, x0, z0, x1, z1, 0, h, c); if (q && slot) this.slot(P, (x0 + x1) / 2, (z0 + z1) / 2, slot); return q; };
    if (b.cat === "COM") {
      for (let k = 0; k < 4; k++) { add(left + 0.4, -6 + k * 3.2, left + 1.0, -4.6 + k * 3.2, 1.7, 0xa09a8a, 1.75); }
      for (let k = 0; k < 4; k++) { add(right - 1.0, -6 + k * 3.2, right - 0.4, -4.6 + k * 3.2, 1.7, 0xa09a8a, 1.75); }
    } else if (b.cat === "APT") {
      for (let k = 0; k < 6; k++) add(left + 0.2 + k * 1.0, -hd + T, left + 1.1 + k * 1.0, -hd + T + 0.3, 1.6, 0x8a8a8e);       // mailboxes
      add(right - 3.2, -hd + T + 0.2, right - 0.6, -hd + T + 1.0, 0.9, 0x6a5a4a, 0.95);
    } else {
      add(left + 1.0, -hd + T + 1.2, left + 7.2, -hd + T + 2.4, 1.1, b.cat === "HTL" ? 0x6a4a32 : 0x8a8a8e, 1.15);              // the reception desk
      if (b.cat === "OFF") { add(-3.6, 6.4, -3.0, 8.4, 1.0, 0x4a5058); add(3.0, 6.4, 3.6, 8.4, 1.0, 0x4a5058); }                // turnstile posts either side of the way in
    }
    for (let k = 0; k < 2 + big * 3; k++) {                                                                                      // seating
      const x = (R() < 0.5 ? -1 : 1) * (10.5 + R() * 3), zz = -8 + k * 3.2 + R();
      if (Math.abs(x) < hw - 1.6) add(x - 0.9, zz - 0.4, x + 0.9, zz + 0.4, 0.8, 0x5a6a7a, 0.85);
    }
    if (big) for (let k = 0; k < 5; k++) add(-12 + k * 6, z - 6, -11 + k * 6, z - 5, 1.4, 0x4a6a4a);                         // planters
    for (let x = -12; x <= 12; x += 6) for (let zz = -10; zz <= 10; zz += 7) { const on = R() >= 0.04; this.panel(P, x, zz, 1.6, 0.8, on); if (on && ((x / 6 + zz / 7) % 2 === 0 || true) && P.lights.length < 12) this.light(P, x, zz); }
    const avoid = { S: [[-2.4, 2.4]] }; if (bay) avoid.S.push([bay.x0 - 0.2, bay.x1 + 0.2]);
    this.windowsRegular(P, 5, 3.6, 0.2, 2.7, avoid);
    this.reach(P, 0, hd - 1.5); this.reach(P, -3, 6.2); this.reach(P, 2, 6.2);
  },

  /* ------------------------------------------------------------------ underground parking (basement only) */
  parking(P, b, R) {
    const G = Level11Gen, r = P.rect, hd = b.d / 2, hw = b.w / 2, bay = this.rampBay(b), cfg = b.basement.config, f = P.floor;
    P.col = { wall: 0x7d7d79, floor: 0x4a4a48, ceil: 0x6a6a68, light: 0xe8ecd8 }; P.lightSpec = { c: 0xe8ecd8, base: 4.2, dist: 12 };
    P.keepOut.push(this.ringKeep());
    if (bay && f === -1) {
      P.keepOut.push(this.rect(bay.x0, bay.z0 - 1.2, bay.x1 + 0.2, bay.z1));
      const xi = bay.rs < 0 ? bay.x1 : bay.x0 - 0.2;
      this.wall(P, xi, hd - 12.4, xi + 0.2, bay.z1, 0x8a867c, 0, P.clear);
      this.wall(P, bay.x0, hd - 1.6, bay.x1, bay.z1, 0x8a867c, 0, P.clear);                // the solid under the ramp's top platform
      for (let i = 0; i < 18; i++) {                                                         // the ramp up to the street: solid blocks
        const top = 3.6 - 0.2 * (i + 1);
        if (top <= 0.01) continue;
        P.props.push({ x0: bay.x0, z0: hd - 1.6 - 0.6 * (i + 1), x1: bay.x1, z1: hd - 1.6 - 0.6 * i, y0: 0, y1: top, c: 0x6a6a66, col: true, ramp: true });
      }
      P.bays = { ramp: bay };
    }
    const pit = 8.1;
    for (let x = r.x0 + this.T + pit / 2; x < r.x1 - this.T; x += pit) for (let z = r.z0 + this.T + pit / 2; z < r.z1 - this.T; z += pit) {
      const q = this.rect(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
      if (this.blocked(P, q)) continue;
      this.prop(P, q.x0, q.z0, q.x1, q.z1, 0, P.clear, 0x8a8a86); P.keepOut.push(this.rect(x - 0.45, z - 0.45, x + 0.45, z + 0.45));
    }
    const carc = [0x6a2a2a, 0x2a3a5a, 0x5a5a5a, 0x1a1a1a, 0x7a7a6a, 0x3a4a3a];
    const rowZ = [];
    for (let z = r.z0 + this.T + 2.6; z < r.z1 - this.T - 2.2; z += 11.5) rowZ.push(z);
    for (const zc of rowZ) {
      if (cfg === "perimeter" && Math.abs(zc) < r.z1 / 2) continue;
      for (let x = r.x0 + this.T + 1.8; x < r.x1 - this.T - 1.5; x += 2.7) {
        if (R() < (cfg === "rows" ? 0.25 : 0.5)) continue;
        const h = 1.3 + R() * 0.3, q = this.prop(P, x - 0.9, zc - 2.2, x + 0.9, zc + 2.2, 0.1, h, carc[Math.floor(R() * carc.length)]);
        if (q) { P.props.push({ x0: x - 0.8, z0: zc - 1.0, x1: x + 0.8, z1: zc + 0.4, y0: h, y1: h + 0.45, c: 0x2a2e32, col: false }); if (R() < 0.3) this.slot(P, x, zc, h + 0.02); }
        this.prop(P, x - 1.3, zc - 2.2, x - 1.27, zc + 2.2, 0.0, 0.02, 0xd8d8c8, false);          // a bay line
      }
    }
    this.gridLights(P, R, 7.2, { dead: 0.25, sx: 1.5, sz: 0.3 });
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0);
    if (b.basement.pedestrian || f < -1) this.reach(P, 2, 6.2);
  },

  /* ------------------------------------------------------------------ the roof (floor H+1) */
  roof(P, b, R) {
    const r = P.rect, S = this.STAIR, T = this.T;
    P.clear = 3.0; P.parapet = 1.8; P.open = true;      // the jump apex is ~1.14 m: the parapet cannot be hopped
    P.col = { wall: 0x8a8a86, floor: 0x5e5e5a, ceil: 0x777773, light: 0xffffff };
    P.slab.holes.push({ x0: S.x0, z0: S.z0, x1: S.x1, z1: S.zTop });
    const c = 0x77776f;                                                                       // the bulkhead over the stairs
    this.wall(P, 0.2, -0.8, 0.4, 4.8, c, 0, 2.6); this.wall(P, 3.8, -0.8, 4.0, 4.8, c, 0, 2.6); this.wall(P, 0.2, -0.8, 4.0, -0.6, c, 0, 2.6);
    this.wallX(P, 0.2, 4.0, 4.6, 0.2, [[S.dx0, S.dx1]], c);
    P.props.push({ x0: 0.2, z0: -0.8, x1: 4.0, z1: 4.8, y0: 2.6, y1: 2.9, c, col: true });
    P.keepOut.push(this.rect(-0.5, -1, 4.6, 7.2));
    const items = Math.floor(5 + R() * 5);
    for (let i = 0; i < items; i++) {
      const x = r.x0 + T + 3 + R() * (P.w - 8), z = r.z0 + T + 3 + R() * (P.d - 8), sx = 1.2 + R() * 2, sz = 1.0 + R() * 1.6, h = 0.9 + R() * 1.4;
      if (this.blocked(P, this.rect(x - sx, z - sz, x + sx, z + sz))) continue;
      const q = this.prop(P, x - sx / 2, z - sz / 2, x + sx / 2, z + sz / 2, 0, h, R() < 0.5 ? 0x9a9a94 : 0x7a8a8a);
      if (q) { if (R() < 0.35) this.slot(P, x, z + sz / 2 - 0.25, h + 0.02); P.keepOut.push(this.rect(x - sx / 2 - 0.5, z - sz / 2 - 0.5, x + sx / 2 + 0.5, z + sz / 2 + 0.5)); }
    }
    this.prop(P, r.x1 - 9, r.z0 + 5, r.x1 - 5, r.z0 + 9, 0, 3.4, 0x6a6a66);                  // a water tank
    this.reach(P, 2, 6.2); this.reach(P, 0, 7.5);
    return this.finish(P, "roof");
  },

  /* ------------------------------------------------------------------ the anomalous garage (not a basement) */
  // A large parking garage deep below the city. Its lift bay is the same core as every building's; the way out is a
  // stair at the far end whose doorway is the designated transition area (P.exit).
  garage(b) {
    const G = Level11Gen, rect = this.GARAGE_RECT, P = this.newPlan(b, "G", "garage", rect);
    P.seed = G.floorSeed(G.seed, b.idHash, 0x6A6); P.y = this.GARAGE_Y; P.H = 3.4; P.clear = 3.0; P.anomaly = true;
    const R = G.rng(P.seed); R(); R();
    P.col = { wall: 0x6e6e6a, floor: 0x3e3e3c, ceil: 0x5a5a58, light: 0xd8e0c8 }; P.lightSpec = { c: 0xd8e0c8, base: 3.6, dist: 11 };
    this.core(P, { elevator: true, stairDoor: false, up: false, hole: false });
    P.keepOut.push(this.rect(-9, -8.2, 9, 8.2));
    // the exit: a room at the east end, open to the west, with a green doorway at its back
    const ex = this.rect(55.5, -4.5, 63.6, 4.5);
    this.wall(P, ex.x0, ex.z0, ex.x1, ex.z0 + 0.3, P.col.wall); this.wall(P, ex.x0, ex.z1 - 0.3, ex.x1, ex.z1, P.col.wall);
    P.keepOut.push(this.rect(ex.x0 - 0.2, ex.z0, ex.x1, ex.z1));
    this.prop(P, 63.0, -1.4, 63.5, 1.4, 0.0, 2.3, 0x1f8a4a, false, true);                    // the lit doorway
    this.prop(P, 62.9, -1.6, 63.0, 1.6, 2.3, 2.9, 0x4fe08a, false, true);                    // its sign
    P.exit = { x0: 60.6, z0: -1.6, x1: 63.4, z1: 1.6 };
    this.panel(P, 59, 0, 1.2, 0.5, true); this.light(P, 59, 0);
    const pit = 7.2;
    for (let x = rect.x0 + pit / 2 + 1; x < rect.x1 - 0.5; x += pit) for (let z = rect.z0 + pit / 2; z < rect.z1 - 0.5; z += pit) {
      const q = this.rect(x - 0.3, z - 0.3, x + 0.3, z + 0.3);
      if (this.blocked(P, q)) continue;
      this.prop(P, q.x0, q.z0, q.x1, q.z1, 0, P.clear, 0x84847e); P.keepOut.push(this.rect(x - 0.45, z - 0.45, x + 0.45, z + 0.45));
    }
    const carc = [0x5a2a2a, 0x2a3a4a, 0x4a4a4a, 0x1a1a1a, 0x6a6a5a];
    for (let z = rect.z0 + 2.6; z < rect.z1 - 2; z += 11.5) for (let x = rect.x0 + 2; x < rect.x1 - 1.5; x += 2.7) {
      if (R() < 0.62) continue;
      const h = 1.3 + R() * 0.3, q = this.prop(P, x - 0.9, z - 2.2, x + 0.9, z + 2.2, 0.1, h, carc[Math.floor(R() * carc.length)]);
      if (q && R() < 0.4) this.slot(P, x, z, h + 0.02);
    }
    this.gridLights(P, R, 7.2, { dead: 0.35, sx: 1.5, sz: 0.3 });
    this.reach(P, -7.5, 0); this.reach(P, 7.5, 0); this.reach(P, 58, 0); this.reach(P, 30, 12); this.reach(P, 2, 6.2);
    return this.finish(P, "garage");
  }
});

if (typeof module !== "undefined" && module.exports) module.exports = { Level11Floors };
