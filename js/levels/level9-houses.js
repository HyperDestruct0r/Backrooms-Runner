"use strict";

/* Level 9 — houses, yards, doors and interiors (a mixin on Level9).

   A house shell (walls with a door gap, roof, windows, porch, garage, driveway) is part of its block's merged
   mesh and is always built with the block. The shell is hollow and closed: the front door is a real swinging leaf
   (a small dynamic mesh that exists only while the player is within about 24 m), with a collider that is parked
   out of the way while it is open.
   The inside of a house is NOT built with the block. It is built when its door is opened (or when the player comes
   back near a house whose door is open) from Level9Gen.interiorPlan(spec), and disposed again when the player is
   more than 44 m away or the block goes. Door, fridge and bottle state live in Level9.persist, so a rebuilt house
   looks exactly as it was left. */
Object.assign(Level9, {
  H_WALL: 5.6,

  /* ------------------------------------------------------------------
     HOUSE SHELL
     ------------------------------------------------------------------ */
  *_house(rec, lot) {
    const G = Level9Gen, sp = G.houseSpec(lot), b = rec.lit, e = rec.emi;
    const W = sp.W, D = sp.D, t = 0.2, H = this.H_WALL, dX = sp.doorX, dw = 0.55;
    const sid = this.col(sp.siding, sp.shade), trim = this.col(sp.trim, 0.62), roofc = this.col(sp.roof);
    const h = { id: sp.id, sp, rec, door: null, interior: null };
    const wc = (x0, y0, z0, x1, y1, z1, tag) => {
      const q = G.boxToWorld(sp, x0, y0, z0, x1, y1, z1);
      return this.collider(rec, q.min.x, q.min.y, q.min.z, q.max.x, q.max.y, q.max.z, tag || "wall");
    };
    b.push(sp.theta, sp.cx, sp.cz);
    // walls: the front has the door gap
    b.box((-W / 2 + dX - dw) / 2, H / 2, D / 2 - t / 2, dX - dw + W / 2, H, t, sid);
    b.box((dX + dw + W / 2) / 2, H / 2, D / 2 - t / 2, W / 2 - dX - dw, H, t, sid);
    b.box(dX, (2.1 + H) / 2, D / 2 - t / 2, dw * 2, H - 2.1, t, sid);
    b.box(0, H / 2, -D / 2 + t / 2, W, H, t, sid);
    b.box(-W / 2 + t / 2, H / 2, 0, t, H, D - 2 * t, sid);
    b.box(W / 2 - t / 2, H / 2, 0, t, H, D - 2 * t, sid);
    wc(-W / 2, 0, D / 2 - t, dX - dw, H, D / 2);
    wc(dX + dw, 0, D / 2 - t, W / 2, H, D / 2);
    wc(dX - dw, 2.1, D / 2 - t, dX + dw, H, D / 2);
    wc(-W / 2, 0, -D / 2, W / 2, H, -D / 2 + t);
    wc(-W / 2, 0, -D / 2 + t, -W / 2 + t, H, D / 2 - t);
    wc(W / 2 - t, 0, -D / 2 + t, W / 2, H, D / 2 - t);
    // a trim band at the floor line, door frame, corner boards
    const band = 2.85;
    b.box(0, band, D / 2 + 0.02, W + 0.1, 0.22, 0.05, trim);
    b.box(0, band, -D / 2 - 0.02, W + 0.1, 0.22, 0.05, trim);
    b.box(-W / 2 - 0.02, band, 0, 0.05, 0.22, D + 0.1, trim);
    b.box(W / 2 + 0.02, band, 0, 0.05, 0.22, D + 0.1, trim);
    b.box(dX - dw - 0.05, 1.05, D / 2 + 0.03, 0.1, 2.1, 0.06, trim);
    b.box(dX + dw + 0.05, 1.05, D / 2 + 0.03, 0.1, 2.1, 0.06, trim);
    b.box(dX, 2.15, D / 2 + 0.03, dw * 2 + 0.2, 0.1, 0.06, trim);
    // ceiling slab under the roof
    b.box(0, H + 0.1, 0, W, 0.2, D, this.col(0x3a3834));
    wc(-W / 2, H, -D / 2, W / 2, H + 0.2, D / 2, "ceil");
    this._roof(b, sp, roofc, sid);
    yield;
    // windows
    for (const wd of sp.windows) this._window(b, e, sp, wd, trim);
    // arch 2: a bay on the front
    if (sp.arch === 2) {
      const bx = -W / 2 + 3.3;
      if (Math.abs(bx - dX) > 2.4) {
        b.box(bx, 1.0, D / 2 + 0.3, 2.2, 2.0, 0.6, sid);
        b.box(bx, 2.05, D / 2 + 0.3, 2.4, 0.12, 0.8, roofc);
        b.box(bx, 1.35, D / 2 + 0.62, 1.4, 1.0, 0.04, this.col(0x090c0e));
        wc(bx - 1.1, 0, D / 2, bx + 1.1, 2.0, D / 2 + 0.6);
      }
    }
    // chimney
    if (sp.chimney) {
      const cx = sp.chimney * (W / 2 + 0.05);
      b.box(cx, 4.6, -D / 4, 0.8, 9.2, 0.9, this.col(0x3d2a24), 0);
      b.box(cx, 9.25, -D / 4, 1.0, 0.18, 1.1, this.col(0x2a2624), 0);
      wc(cx - 0.4, 0, -D / 4 - 0.45, cx + 0.4, 6.0, -D / 4 + 0.45);
    }
    yield;
    // porch
    const porch = sp.arch === 2 ? Math.max(1, sp.porch) : sp.porch, concrete = this.col(0x4a4a44);
    if (porch === 0) b.box(dX, 0.07, D / 2 + 0.6, 1.8, 0.14, 1.2, concrete);
    else {
      const pw = porch === 1 ? 2.8 : Math.min(W - 1, W * 0.72), pd = porch === 1 ? 1.8 : 2.2;
      const pc = porch === 1 ? dX : Math.max(-W / 2 + pw / 2, Math.min(W / 2 - pw / 2, dX));
      b.box(pc, 0.07, D / 2 + pd / 2, pw, 0.14, pd, concrete);
      b.box(pc, 2.78, D / 2 + pd / 2, pw + 0.2, 0.1, pd + 0.2, roofc);
      const posts = porch === 1 ? [-1, 1] : [-1, -0.33, 0.33, 1];
      for (const k of posts) {
        const px = pc + k * (pw / 2 - 0.15), pz = D / 2 + pd - 0.15;
        b.box(px, 1.4, pz, 0.14, 2.7, 0.14, trim);
        wc(px - 0.07, 0, pz - 0.07, px + 0.07, 2.7, pz + 0.07, "post");
      }
    }
    // garage and driveway
    if (sp.garage) this._garage(rec, b, sp, wc, sid, roofc);
    if (sp.garage) {
      const len = sp.setback + G.SW + 0.3, gx = sp.garage * (W / 2 + G.GW / 2);
      b.box(gx, 0.025, D / 2 + len / 2, 3.3, 0.05, len, concrete);
    } else if (sp.driveway === 2) {
      const len = sp.setback + G.SW + 0.3;
      b.box(dX, 0.02, D / 2 + len / 2 + 0.6, 1.2, 0.04, len, this.col(0x44443e));
    }
    b.pop();
    // the front yard is kept clear of trees
    {
      const x0 = -W / 2 - (sp.garage < 0 ? G.GW : 0) - 1, x1 = W / 2 + (sp.garage > 0 ? G.GW : 0) + 1;
      const q = G.boxToWorld(sp, x0, 0, -D / 2 - 1, x1, 1, D / 2 + sp.setback + G.SW);
      rec.rects.push([q.min.x, q.min.z, q.max.x, q.max.z]);
    }
    // the lit room: a warm light inside, matching its lit windows
    if (sp.lit) {
      const rc = G.roomCenter(sp, sp.litRoom), w = G.localToWorld(sp, rc.x, rc.z);
      rec.fixtures.push({ x: w.x, y: rc.y, z: w.z, base: 7, dist: 11, color: 0xffc36b, ph: sp.cx, kind: "room", on: true, house: sp.id });
    }
    // the door
    const ctr = G.localToWorld(sp, dX, D / 2 - 0.1), hinge = G.localToWorld(sp, dX - dw, D / 2 - 0.1);
    const open = this.persist.open.has(sp.id) && !sp.locked;
    const dq = G.boxToWorld(sp, dX - dw, 0, D / 2 - 0.2, dX + dw, 2.1, D / 2);
    const cl = this.collider(rec, dq.min.x, 0, dq.min.z, dq.max.x, 2.1, dq.max.z, "door");
    h.door = { x: ctr.x, z: ctr.z, hx: hinge.x, hz: hinge.z, a: open ? 1 : 0, target: open ? 1 : 0, mesh: null, collider: cl, locked: sp.locked };
    if (open) { cl.min.y = 500; cl.max.y = 502; }
    // a mailbox at the kerb
    {
      const lat = (sp.lot.w / 2 - 2.2) * (Level9Gen.hash(sp.lot.bi, sp.lot.bj, sp.lot.k + 77) < 0.5 ? 1 : -1);
      const m = G.lotPoint(sp.lot, 0.7, lat);
      b.box(m.x, 0.5, m.z, 0.07, 1.0, 0.07, this.col(0x3a3a38), 0);
      b.box(m.x, 1.08, m.z, 0.22, 0.2, 0.4, this.col(0x2d3a4a), 0);
      this.collider(rec, m.x - 0.15, 0, m.z - 0.15, m.x + 0.15, 1.2, m.z + 0.15, "mailbox");
    }
    rec.houses.push(h);
    return h;
  },

  _roof(b, sp, roofc, sid) {
    const W = sp.W, D = sp.D, o = 0.5, y0 = this.H_WALL + 0.2, alongX = sp.arch !== 1;
    const V = (x, y, z) => b._v(x, y, z);
    if (alongX) {
      const hr = sp.pitch * (D / 2 + o), hg = hr * (D / 2) / (D / 2 + o), ref = V(0, y0 - 0.5, 0);
      b.quad(V(-W / 2 - o, y0, D / 2 + o), V(W / 2 + o, y0, D / 2 + o), V(W / 2 + o, y0 + hr, 0), V(-W / 2 - o, y0 + hr, 0), roofc, ref);
      b.quad(V(-W / 2 - o, y0, -D / 2 - o), V(W / 2 + o, y0, -D / 2 - o), V(W / 2 + o, y0 + hr, 0), V(-W / 2 - o, y0 + hr, 0), roofc, ref);
      b.tri(V(-W / 2, y0, -D / 2), V(-W / 2, y0, D / 2), V(-W / 2, y0 + hg, 0), sid, ref);
      b.tri(V(W / 2, y0, -D / 2), V(W / 2, y0, D / 2), V(W / 2, y0 + hg, 0), sid, ref);
      b.box(0, y0 + hr + 0.03, 0, W + 2 * o + 0.1, 0.1, 0.18, this.col(0x1d1b1a));
    } else {
      const hr = sp.pitch * (W / 2 + o), hg = hr * (W / 2) / (W / 2 + o), ref = V(0, y0 - 0.5, 0);
      b.quad(V(W / 2 + o, y0, -D / 2 - o), V(W / 2 + o, y0, D / 2 + o), V(0, y0 + hr, D / 2 + o), V(0, y0 + hr, -D / 2 - o), roofc, ref);
      b.quad(V(-W / 2 - o, y0, -D / 2 - o), V(-W / 2 - o, y0, D / 2 + o), V(0, y0 + hr, D / 2 + o), V(0, y0 + hr, -D / 2 - o), roofc, ref);
      b.tri(V(-W / 2, y0, D / 2), V(W / 2, y0, D / 2), V(0, y0 + hg, D / 2), sid, ref);
      b.tri(V(-W / 2, y0, -D / 2), V(W / 2, y0, -D / 2), V(0, y0 + hg, -D / 2), sid, ref);
      b.box(0, y0 + hr + 0.03, 0, 0.18, 0.1, D + 2 * o + 0.1, this.col(0x1d1b1a));
    }
  },

  _window(b, e, sp, wd, trim) {
    const W = sp.W, D = sp.D, y = wd.floor ? 4.55 : 1.55, lit = sp.lit && wd.room === sp.litRoom;
    const dark = this.col(0x080b0d), warm = this.col(0xffc46a, 0.95);
    let fx, fz, gx, gz, fsx, fsz, gsx, gsz;
    if (wd.wall === "front" || wd.wall === "back") {
      const s = wd.wall === "front" ? 1 : -1;
      fx = wd.along; fz = s * (D / 2 + 0.02); fsx = 1.24; fsz = 0.04;
      gx = wd.along; gz = s * (D / 2 + 0.045); gsx = 1.0; gsz = 0.03;
    } else {
      const s = wd.wall === "right" ? 1 : -1;
      fx = s * (W / 2 + 0.02); fz = wd.along; fsx = 0.04; fsz = 1.24;
      gx = s * (W / 2 + 0.045); gz = wd.along; gsx = 0.03; gsz = 1.0;
    }
    b.box(fx, y, fz, fsx, 1.44, fsz, trim);
    (lit ? e : b).box(gx, y, gz, gsx, 1.2, gsz, lit ? warm : dark);
  },

  _garage(rec, b, sp, wc, sid, roofc) {
    const G = Level9Gen, GW = G.GW, GD = 6.2, W = sp.W, D = sp.D, g = sp.garage;
    const gx = g * (W / 2 + GW / 2), zc = D / 2 - GD / 2;
    b.box(gx, 1.4, D / 2 - GD + 0.1, GW, 2.8, 0.2, sid);
    b.box(gx + g * (GW / 2 - 0.1), 1.4, zc, 0.2, 2.8, GD, sid);
    b.box(gx, 2.95, zc, GW + 0.5, 0.22, GD + 0.5, roofc);
    b.box(gx, 0.02, zc, GW - 0.1, 0.04, GD - 0.1, this.col(0x2e2e2b));
    b.box(gx, 2.55, D / 2 - 0.1, GW, 0.4, 0.2, sid);
    wc(gx - GW / 2, 0, D / 2 - GD, gx + GW / 2, 2.8, D / 2 - GD + 0.2);
    wc(gx + g * (GW / 2 - 0.2) - 0.1, 0, D / 2 - GD, gx + g * (GW / 2 - 0.2) + 0.1, 2.8, D / 2);
    wc(gx - GW / 2, 2.4, D / 2 - GD, gx + GW / 2, 3.06, D / 2);
    if (G.lh(sp.lot, 51) < 0.3) {                           // an old car, dark and furred with dust
      b.box(gx - g * 0.1, 0.6, zc - 0.3, 1.7, 0.7, 4.0, this.col(0x2a3038));
      b.box(gx - g * 0.1, 1.2, zc - 0.5, 1.5, 0.5, 2.0, this.col(0x1f242a));
      wc(gx - 0.95 - g * 0.1, 0, zc - 2.3, gx + 0.95 - g * 0.1, 1.45, zc + 1.7);
    }
  },

  /* ------------------------------------------------------------------
     YARDS: trees, fences, bushes
     ------------------------------------------------------------------ */
  _yard(rec, lot) {
    const G = Level9Gen, B = rec.B, b = rec.lit, r = G.lr(lot, 90);
    if (lot.special) { return; }
    const inside = (x, z, m) => x > B.ix0 + m && x < B.ix1 - m && z > B.iz0 + m && z < B.iz1 - m;
    const sp = G.spawnInfo();
    const free = (x, z, m) => {
      if (!inside(x, z, 0.6)) return false;
      for (const q of rec.rects) if (x > q[0] - m && x < q[2] + m && z > q[1] - m && z < q[3] + m) return false;
      if (rec.bi === 0 && rec.bj === 0 && Math.hypot(x - sp.x, z - sp.z) < 6) return false;
      for (const l of B.lots) if (l.special) { const p = G.exitPoint(l); if (Math.hypot(x - p.x, z - p.z) < 9) return false; }
      for (const t of rec.trees || []) if (Math.hypot(x - t[0], z - t[1]) < 2.2) return false;
      return true;
    };
    rec.trees = rec.trees || [];
    const tree = (x, z, kind) => {
      if (!free(x, z, 0.8)) return false;
      rec.trees.push([x, z]);
      const hsh = r(), tk = kind != null ? kind : hsh < 0.45 ? 0 : hsh < 0.88 ? 1 : 2;
      const trunk = this.col(0x2e2218, 0.8 + r() * 0.4), gr = [0x16281a, 0x1b2e1d, 0x20301c, 0x182b22][Math.floor(r() * 4)];
      if (tk === 0) {                                       // spruce
        const H = 5 + r() * 3.5;
        b.box(x, 0.9, z, 0.3, 1.8, 0.3, trunk, 0);
        for (let i = 0; i < 3; i++) b.cone(x, 1.5 + i * H * 0.24, z, 2.0 - i * 0.45, H * 0.42, 7, this.col(gr, 0.9 + r() * 0.2));
      } else if (tk === 1) {                                // broadleaf
        const H = 3.2 + r() * 1.6;
        b.box(x, H / 2, z, 0.38, H, 0.38, trunk, 0);
        b.lump(x, H + 1.0, z, 2.3 + r(), 1.7, 2.3 + r(), this.col(gr, 0.85 + r() * 0.3));
        b.lump(x + 1.0, H + 0.3, z - 0.6, 1.7, 1.2, 1.7, this.col(gr, 0.8 + r() * 0.3));
      } else {                                              // bare, dead
        const H = 4 + r() * 2;
        b.box(x, H / 2, z, 0.3, H, 0.3, this.col(0x2a2520), 0);
        for (let i = 0; i < 4; i++) b.box(x + (r() - 0.5) * 1.2, H * (0.55 + r() * 0.4), z + (r() - 0.5) * 1.2, 0.12, 1.4, 0.12, this.col(0x2a2520), r() * 3);
      }
      this.collider(rec, x - 0.22, 0, z - 0.22, x + 0.22, 3, z + 0.22, "tree");
      return true;
    };
    const rnd = (a, c) => a + r() * (c - a);
    if (lot.kind === "house") {
      const hs = rec.houses.find(h => h.id === lot.id), sp2 = hs ? hs.sp : null;
      if (!sp2) return;
      if (r() < 0.55) tree(...Object.values(G.lotPoint(lot, 1.5, (r() * 2 - 1) * (lot.w / 2 - 2.5))));
      const nb = 1 + Math.floor(r() * 3);
      for (let i = 0; i < nb; i++) tree(...Object.values(G.lotPoint(lot, rnd(sp2.setback + sp2.D + 2, G.LD - 1.5), (r() * 2 - 1) * (lot.w / 2 - 1.5))));
      // bushes under the front corners
      for (const s of [-1, 1]) {
        if (r() < 0.45) continue;
        const q = G.localToWorld(sp2, s * (sp2.W / 2 - 0.2), sp2.D / 2 + 0.55);
        if (Math.abs(s * (sp2.W / 2 - 0.2) - sp2.doorX) < 2.4) continue;
        b.lump(q.x, 0.45, q.z, 0.75, 0.55, 0.65, this.col(0x1a2b1b, 0.8 + r() * 0.3));
      }
      // fences
      if (r() < 0.4) {
        const c = G.lotPoint(lot, G.LD - 0.4, 0), L = lot.w - 1.2, ew = lot.nx !== 0;
        this._fence(rec, c.x, c.z, ew ? 0.07 : L, ew ? L : 0.07);
      }
      if (r() < 0.45) {
        const lat = (lot.w / 2 - 0.15) * (r() < 0.5 ? 1 : -1), from = sp2.setback - 0.5, len = G.LD - 0.4 - from;
        const c = G.lotPoint(lot, from + len / 2, lat), ew = lot.nx !== 0;
        this._fence(rec, c.x, c.z, ew ? len : 0.07, ew ? 0.07 : len);
      }
    } else {
      const n = lot.kind === "weeds" ? 2 : 3 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) tree(...Object.values(G.lotPoint(lot, rnd(2, G.LD - 2), (r() * 2 - 1) * (lot.w / 2 - 1.5))));
      if (lot.kind === "weeds") for (let i = 0; i < 40; i++) {
        const p = G.lotPoint(lot, rnd(2, G.LD - 1), (r() * 2 - 1) * (lot.w / 2 - 1)), hh = 0.5 + r() * 0.7;
        if (free(p.x, p.z, 0.2)) b.box(p.x, hh / 2, p.z, 0.08, hh, 0.08, this.col(0x2b3a22, 0.8 + r() * 0.4), r() * 3);
      }
    }
  },

  _fence(rec, x, z, sx, sz) {
    rec.lit.box(x, 0.62, z, sx, 1.25, sz, this.col(0x4a4439, 0.85), 0);
    this.collider(rec, x - sx / 2, 0, z - sz / 2, x + sx / 2, 1.25, z + sz / 2, "fence");
  },

  /* ------------------------------------------------------------------
     DOORS
     ------------------------------------------------------------------ */
  _doorMesh(h) {
    const sp = h.sp, d = h.door, g = new THREE.Group(), M = this.mats();
    const leaf = new THREE.Mesh(this.unit, this.doorMat(sp.doorColor));
    leaf.scale.set(1.06, 2.05, 0.06);
    leaf.position.set(0.53, 1.025, 0);
    const knob = new THREE.Mesh(this.unit, M.handle);
    knob.scale.set(0.12, 0.06, 0.16);
    knob.position.set(0.95, 1.0, 0);
    g.add(leaf, knob);
    g.position.set(d.hx, 0, d.hz);
    g.rotation.y = sp.theta + d.a * 1.65;
    this.group.add(g);
    d.mesh = g;
  },
  _doorFree(h) {
    const d = h.door;
    if (d && d.mesh) { if (d.mesh.parent) d.mesh.parent.remove(d.mesh); d.mesh = null; }
  },

  _doors(dt) {
    this._dT = (this._dT || 0) - dt;
    const scan = this._dT <= 0;
    if (scan) this._dT = 0.25;
    const p = Player.position, A = 1 / 0.7;
    for (const rec of this.blocks.values()) {
      for (const h of rec.houses) {
        const d = h.door;
        if (scan) {
          const dist = Math.hypot(p.x - d.x, p.z - d.z);
          if (dist < 24 && !d.mesh) this._doorMesh(h);
          else if (dist > 32 && d.mesh) this._doorFree(h);
        }
        if (d.a !== d.target) {
          if (d.mesh) d.a = d.target > d.a ? Math.min(1, d.a + dt * A) : Math.max(0, d.a - dt * A); else d.a = d.target;
          if (d.mesh) d.mesh.rotation.y = h.sp.theta + d.a * 1.65;
          const open = d.a > 0.5;
          d.collider.min.y = open ? 500 : 0; d.collider.max.y = open ? 502 : 2.1;
        }
        const I = h.interior;
        if (I && I.fridgeDoor) {
          const tgt = this.persist.fridge.has(h.id) ? 1 : 0;
          if (I.fridgeA !== tgt) { I.fridgeA = tgt > I.fridgeA ? Math.min(1, I.fridgeA + dt * 2.5) : Math.max(0, I.fridgeA - dt * 2.5); I.fridgeDoor.rotation.y = I.fridgeYaw - I.fridgeA * 1.9; }
        }
      }
    }
  },

  /* ------------------------------------------------------------------
     INTERACTION
     ------------------------------------------------------------------ */
  _nearHouses(maxD) {
    const p = Player.position, out = [];
    for (const rec of this.blocks.values()) {
      if (rec.dist > 60) continue;
      for (const h of rec.houses) if (Math.hypot(p.x - h.sp.cx, p.z - h.sp.cz) < maxD) out.push(h);
    }
    return out;
  },

  _fridgeWorld(h) {
    const f = h.interior && h.interior.plan.fridge;
    return f ? Level9Gen.localToWorld(h.sp, f.x, f.z) : null;
  },

  _target() {
    const p = Player.position;
    let best = null, bd = 99;
    for (const h of this._nearHouses(16)) {
      const d = h.door, dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist < 2.2 && p.y < 2.2 && dist < bd) { bd = dist; best = { kind: "door", h }; }
      const fw = this._fridgeWorld(h);
      if (fw && p.y < 2.2) {
        const fd = Math.hypot(p.x - fw.x, p.z - fw.z);
        if (fd < 2.0 && fd < bd) { bd = fd; best = { kind: "fridge", h }; }
      }
    }
    return best;
  },

  useNearest() {
    const T = this._target();
    if (!T) return false;
    const h = T.h, d = h.door, id = h.id, S = this.persist;
    if (T.kind === "fridge") {
      if (S.fridge.has(id)) return false;                    // already open: let the normal pickup take the bottle
      S.fridge.add(id);
      this._fridgeBottle(h);
      if (typeof AudioSystem !== "undefined") AudioSystem.playPositional("creak", h.sp.cx, 1, h.sp.cz, { gain: 0.25, bus: "events", max: 30 });
      return true;
    }
    if (d.locked) {
      if (typeof HUD !== "undefined" && HUD.toast) HUD.toast("THE DOOR IS LOCKED");
      if (typeof AudioSystem !== "undefined") AudioSystem.playPositional("metal", d.x, 1.1, d.z, { gain: 0.18, bus: "events", max: 25 });
      return true;
    }
    if (d.target === 1) {
      if (Math.hypot(Player.position.x - d.x, Player.position.z - d.z) < 1.0) return true;   // never shut it on yourself
      d.target = 0; S.open.delete(id);
    } else {
      d.target = 1; S.open.add(id);
      if (!h.interior) { this._buildInterior(h); this._dirty = true; this._collect(); }
    }
    if (typeof AudioSystem !== "undefined") AudioSystem.playPositional("creak", d.x, 1, d.z, { gain: 0.3, bus: "events", max: 30 });
    return true;
  },

  prompt() {
    const T = this._target();
    if (!T || typeof HUD === "undefined" || !HUD.toast) return;
    if (T.kind === "fridge") {
      if (!this.persist.fridge.has(T.h.id)) HUD.toast("E  OPEN FRIDGE");
      else if (T.h.interior.pickups.some(q => !q.taken)) HUD.toast("E  TAKE ALMOND WATER");
      return;
    }
    HUD.toast(T.h.door.target === 1 ? "E  CLOSE DOOR" : "E  OPEN DOOR");
  },

  /* ------------------------------------------------------------------
     INTERIORS
     ------------------------------------------------------------------ */
  _interiors() {
    const p = Player.position;
    let built = 0, changed = false;
    for (const rec of this.blocks.values()) {
      if (rec.dist > 70) continue;
      for (const h of rec.houses) {
        const dist = Math.hypot(p.x - h.sp.cx, p.z - h.sp.cz), I = h.interior;
        if (!I && dist < 30 && this.persist.open.has(h.id) && !h.sp.locked && built < 1) { this._buildInterior(h); built++; changed = true; }
        else if (I) {
          if (dist > 44) { this._disposeInterior(h); changed = true; }
          else for (const q of I.pickups) if (q.taken && !this.persist.taken.has(h.id)) this.persist.taken.add(h.id);
        }
      }
    }
    if (changed) { this._dirty = true; this._collect(); }
  },

  _buildInterior(h) {
    const G = Level9Gen, sp = h.sp, plan = G.interiorPlan(sp), b = new L9Builder(), e = new L9Builder();
    const W = sp.W, D = sp.D, t = 0.2, H = this.H_WALL, dX = sp.doorX, dw = 0.55;
    const I = { plan, group: new THREE.Group(), geos: [], colliders: [], fixtures: [], pickups: [], fridgeDoor: null, fridgeA: 0, fridgeYaw: 0 };
    const cl = (x0, y0, z0, x1, y1, z1, tag) => {
      const q = G.boxToWorld(sp, x0, y0, z0, x1, y1, z1);
      I.colliders.push({ min: { x: q.min.x, y: q.min.y, z: q.min.z }, max: { x: q.max.x, y: q.max.y, z: q.max.z }, tag: tag || "int" });
    };
    const PL = this.col(0x4f4b43), FL = [this.col(0x3b3026), this.col(0x2d322e), this.col(0x352c28)];
    b.push(sp.theta, sp.cx, sp.cz);
    // floors (visual): the ground floor sits 5 cm proud so it never z-fights the lawn
    b.box(0, 0.025, (sp.zp + D / 2 - t) / 2, W - 2 * t, 0.05, D / 2 - t - sp.zp, FL[sp.rooms.front === "dining" ? 2 : 0]);
    b.box(0, 0.026, (-D / 2 + t + sp.zp) / 2, W - 2 * t, 0.05, sp.zp + D / 2 - t, FL[sp.rooms.back === "kitchen" ? 1 : 2]);
    // liners on the inside of the outer walls, both floors
    const liner = (x, y, z, sx, sy, sz) => b.box(x, y, z, sx, sy, sz, PL);
    for (const [ya, yb] of [[0.05, 2.7], [3.0, 5.6]]) {
      const yc = (ya + yb) / 2, hh = yb - ya;
      liner(0, yc, -D / 2 + t + 0.01, W - 2 * t, hh, 0.02);
      liner(-W / 2 + t + 0.01, yc, 0, 0.02, hh, D - 2 * t);
      liner(W / 2 - t - 0.01, yc, 0, 0.02, hh, D - 2 * t);
      liner((-W / 2 + t + dX - dw) / 2, yc, D / 2 - t - 0.01, dX - dw + W / 2 - t, hh, 0.02);
      liner((dX + dw + W / 2 - t) / 2, yc, D / 2 - t - 0.01, W / 2 - t - dX - dw, hh, 0.02);
    }
    liner(dX, 2.9 + 0.1, D / 2 - t - 0.01, dw * 2, 0.5, 0.02);
    b.box(0, H - 0.015, 0, W - 2 * t, 0.03, D - 2 * t, this.col(0x44423c));
    // solids: partitions, slabs, railing
    for (const s of plan.solids) {
      b.box((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2, s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0, this.col(s.color));
      cl(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, s.tag);
    }
    for (const s of plan.steps) {
      b.box((s.x0 + s.x1) / 2, s.y1 / 2, (s.z0 + s.z1) / 2, s.x1 - s.x0, s.y1, s.z1 - s.z0, this.col(0x4a3a2c, 0.85 + (s.y1 * 7 % 3) * 0.05));
      cl(s.x0, 0, s.z0, s.x1, s.y1, s.z1, "step");
    }
    // furniture
    for (const f of plan.furn) this._furn(b, e, f, cl, I, sp);
    // inside faces of the windows
    for (const wd of sp.windows) {
      const y = wd.floor ? 4.55 : 1.55, lit = sp.lit && wd.room === sp.litRoom, k = lit ? this.col(0xffc46a, 0.85) : this.col(0x070a0c);
      const bld = lit ? e : b;
      if (wd.wall === "front") bld.box(wd.along, y, D / 2 - t - 0.025, 1.0, 1.2, 0.02, k);
      else if (wd.wall === "back") bld.box(wd.along, y, -D / 2 + t + 0.025, 1.0, 1.2, 0.02, k);
      else if (wd.wall === "right") bld.box(W / 2 - t - 0.025, y, wd.along, 0.02, 1.2, 1.0, k);
      else bld.box(-W / 2 + t + 0.025, y, wd.along, 0.02, 1.2, 1.0, k);
    }
    if (sp.lit) { const rc = G.roomCenter(sp, sp.litRoom); e.box(rc.x, rc.y + 0.45, rc.z, 0.4, 0.05, 0.4, this.col(0xffd890)); }
    b.pop();
    for (const [bb, mat] of [[b, this.M.lit], [e, this.M.emi]]) {
      if (!bb.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(bb.p, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(bb.n, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(bb.c, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.matrixAutoUpdate = false;
      I.group.add(m);
      I.geos.push(g);
    }
    this.group.add(I.group);
    // the fridge door is a real leaf that swings
    if (plan.fridge) this._fridgeLeaf(h, I, plan.fridge);
    h.interior = I;
    if (this.persist.fridge.has(h.id)) { I.fridgeA = 1; if (I.fridgeDoor) I.fridgeDoor.rotation.y = I.fridgeYaw - 1.9; this._fridgeBottle(h); }
  },

  _fridgeLeaf(h, I, f) {
    const G = Level9Gen, sp = h.sp, M = this.M;
    const fr = [[0, 1], [0, -1], [1, 0], [-1, 0]][f.face], ex = fr[1], ez = -fr[0];
    const w = f.face < 2 ? f.sx : f.sz, dep = f.face < 2 ? f.sz : f.sx;
    const hl = G.localToWorld(sp, f.x + fr[0] * (dep / 2) - ex * (w / 2), f.z + fr[1] * (dep / 2) - ez * (w / 2));
    const g = new THREE.Group(), leaf = new THREE.Mesh(this.unit, M.fridge), hd = new THREE.Mesh(this.unit, M.handle);
    leaf.scale.set(w - 0.02, f.sy - 0.1, 0.05);
    leaf.position.set(w / 2, f.sy / 2, 0.025);
    hd.scale.set(0.03, 0.5, 0.04);
    hd.position.set(w - 0.1, f.sy * 0.62, 0.07);
    g.add(leaf, hd);
    g.position.set(hl.x, 0.05, hl.z);
    I.fridgeYaw = sp.theta + Math.atan2(fr[0], fr[1]);
    g.rotation.y = I.fridgeYaw;
    I.group.add(g);
    I.fridgeDoor = g;
  },

  // the bottle appears when the fridge is opened, unless it has been taken
  _fridgeBottle(h) {
    const I = h.interior, id = h.id;
    if (!I || !h.sp.bottle || this.persist.taken.has(id) || I.pickups.length || typeof PickupSystem === "undefined" || !PickupSystem.group) return;
    const fw = this._fridgeWorld(h);
    if (!fw) return;
    PickupSystem._addMesh("almond", fw.x, fw.z);
    const q = PickupSystem.list[PickupSystem.list.length - 1];
    q.l9 = id;
    q.mesh.position.y = 1.0;
    I.pickups.push(q);
  },

  _furn(b, e, f, cl, I, sp) {
    const c = this.col(f.color), x = f.x, y = f.y, z = f.z, sx = f.sx, sy = f.sy, sz = f.sz;
    const hx = sx / 2, hz = sz / 2;
    const bv = [[0, -1], [0, 1], [-1, 0], [1, 0]][f.face || 0];
    const depth = (f.face || 0) < 2 ? sz : sx;
    const box = (cx, cy, cz, a, bb, d, col) => b.box(cx, cy, cz, a, bb, d, col || c);
    switch (f.kind) {
      case "sofa": {
        box(x, y - sy / 2 + 0.22, z, sx, 0.44, sz);
        box(x + bv[0] * (depth / 2 - 0.12), y + 0.1, z + bv[1] * (depth / 2 - 0.12), bv[0] ? 0.24 : sx, sy - 0.2, bv[1] ? 0.24 : sz);
        break;
      }
      case "bed": {
        box(x, y - sy / 2 + 0.2, z, sx, 0.4, sz, this.col(0x2f2a26));
        box(x, y - sy / 2 + 0.38, z, sx - 0.06, 0.16, sz - 0.06, c);
        box(x + bv[0] * (depth / 2 - 0.08), y + 0.1, z + bv[1] * (depth / 2 - 0.08), bv[0] ? 0.1 : sx, 0.7, bv[1] ? 0.1 : sz, this.col(0x3b2d22));
        box(x + bv[0] * (depth / 2 - 0.35), y - sy / 2 + 0.52, z + bv[1] * (depth / 2 - 0.35), bv[0] ? 0.4 : sx * 0.7, 0.12, bv[1] ? 0.4 : sz * 0.7, this.col(0x6a6860));
        break;
      }
      case "table": case "stand": {
        box(x, y + sy / 2 - 0.03, z, sx, 0.06, sz);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + lx * (hx - 0.06), y - 0.03, z + lz * (hz - 0.06), 0.06, sy - 0.06, 0.06);
        break;
      }
      case "chair": {
        box(x, y - sy / 2 + 0.22, z, sx, 0.06, sz);
        box(x + bv[0] * (depth / 2 - 0.03), y + 0.12, z + bv[1] * (depth / 2 - 0.03), bv[0] ? 0.06 : sx, 0.5, bv[1] ? 0.06 : sz);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + lx * (hx - 0.04), y - sy / 2 + 0.11, z + lz * (hz - 0.04), 0.05, 0.22, 0.05);
        break;
      }
      case "lamp": {
        box(x, y - 0.05, z, 0.04, sy - 0.1, 0.04, this.col(0x222222));
        box(x, y + sy / 2 - 0.15, z, 0.34, 0.26, 0.34, this.col(0x3a3630));
        break;
      }
      case "fridge": {
        // the body stops 4 cm short of the front so the swinging leaf sits flush
        const fr = [[0, 1], [0, -1], [1, 0], [-1, 0]][f.face];
        box(x - fr[0] * 0.025, y, z - fr[1] * 0.025, fr[0] ? sx - 0.05 : sx, sy, fr[1] ? sz - 0.05 : sz, this.col(0x6a6e70));
        break;
      }
      case "counter": {
        box(x, y - 0.03, z, sx, sy - 0.06, sz, this.col(0x3a3733));
        box(x, y + sy / 2 - 0.03, z, sx + 0.02, 0.06, sz + 0.02, this.col(0x2a2a28));
        break;
      }
      default: box(x, y, z, sx, sy, sz);
    }
    if (f.collide) cl(x - hx, y - sy / 2, z - hz, x + hx, y + sy / 2, z + hz, f.kind);
  },

  _disposeInterior(h) {
    const I = h.interior;
    if (!I) return;
    if (I.group.parent) I.group.parent.remove(I.group);
    for (const g of I.geos) g.dispose();
    for (const q of I.pickups) {
      if (q.taken) this.persist.taken.add(h.id);
      if (q.mesh) { if (q.mesh.parent) q.mesh.parent.remove(q.mesh); if (q.mesh.material && q.mesh.material.dispose) q.mesh.material.dispose(); }
      const i = PickupSystem.list.indexOf(q);
      if (i >= 0) PickupSystem.list.splice(i, 1);
    }
    h.interior = null;
  },

  _disposeHouse(h) {
    this._doorFree(h);
    this._disposeInterior(h);
  }
});
