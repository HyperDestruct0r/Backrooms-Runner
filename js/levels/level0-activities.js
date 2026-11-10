"use strict";

/* ------------------------------------------------------------------
   LEVEL 0 <-> ACTIVITY SYSTEM
   Turns the planned elevator and station sites (level0-sites.js) into an
   objective set per elevator (five required electrical stations each),
   draws the physical pieces, and answers the elevator's call point.

   Station visuals are built per streamed chunk from visit state, so
   unloading and reloading a chunk can never change what a station shows.
   ------------------------------------------------------------------ */
const Level0Activities = {
  PANEL_DEPTH: 0.24,
  _mats: null,
  _gauges: [],
  _unsub: null,

  LOGS: [
    "LOG 04: PANEL 7B WAS RE-LABELLED. NOBODY WROTE DOWN WHY.",
    "LOG 11: LIFT RAN ALL NIGHT WITH NO ONE INSIDE. DOORS OPENED ON EVERY FLOOR.",
    "LOG 17: THE HUM STOPS WHEN THE BUS IS LIVE. DO NOT LISTEN FOR IT.",
    "LOG 23: KEEP TO THE LIT CORRIDORS. THE FITTER WHO DID NOT IS STILL ON ROTA.",
    "LOG 29: ALL FIVE FEEDS MUST HOLD OR THE CAR WILL NOT MOVE. THIS IS BY DESIGN.",
    "LOG 31: SOMEONE HAS BEEN DRAWING ON THE WALLS NEAR STATION 3. NOT OUR HAND.",
    "LOG 38: THE CARPET HERE WAS REPLACED TWICE. THE SAME STAIN CAME BACK.",
    "LOG 42: IF THE LIGHTS HOLD STEADY, YOU ARE NOT THE ONLY ONE ON THIS BUS.",
    "LOG 47: GRADE 5 BOARDS ARE NOT HARDER. THEY ARE JUST LONGER.",
    "LOG 52: LEFT THE KEY IN THE LOCK. IT WAS GONE IN THE MORNING.",
    "LOG 58: THE NUMBERS ON THE LIFT PLATES DO NOT MATCH THE FLOORS.",
    "LOG 63: WE KEPT COUNTING ELEVATORS. THE COUNT KEPT CHANGING."
  ],

  hash(a, b, c) {
    let h = (a ^ 0x9E3779B9) >>> 0;
    h = Math.imul(h ^ (b + 0x7F4A7C15), 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13) ^ (c + 0xC2B2AE35), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  },

  /* ---------------- plan ---------------- */
  buildPlan(result) {
    if (!result || !result.elevatorSites || !result.elevatorSites.length) return null;   // e.g. Test Beta: legacy elevators
    const T = CONFIG.tile, seed = result.seed >>> 0;
    const plan = { seed, sets: [], sites: [] };
    result.elevatorSites.forEach((e, i) => {
      const unit = 100 + this.hash(seed, i, 7) % 900;
      const setId = "L0-E" + i;
      const set = { id: setId, label: "lift " + unit, meta: { unit: String(unit), exitIndex: i, primary: i === 0 }, activities: [] };
      const ox = (e.x + 0.5) * T + e.fx * T / 2, oz = (e.z + 0.5) * T + e.fz * T / 2;     // wall plane centre
      plan.sites.push({
        id: setId + "-D", kind: "l0-elevator", setId, exitIndex: i,
        worldX: ox - e.fx * 0.9, worldZ: oz - e.fz * 0.9, nx: -e.fx, nz: -e.fz, reach: 3.3
      });
      const base = this.hash(seed, i, 99);
      e.stations.forEach((s, k) => {
        const sid = setId + "-S" + k, aid = setId + "-A" + k;
        const px = (s.x + 0.5) * T + s.fx * (T / 2), pz = (s.z + 0.5) * T + s.fz * (T / 2);
        plan.sites.push({
          id: sid, kind: "l0-station", setId, instanceId: aid, label: "STN " + String(unit) + "-" + (k + 1),
          planeX: px, planeZ: pz,                                  // where the panel meets the wall
          worldX: px - s.fx * this.PANEL_DEPTH * 0.5, worldZ: pz - s.fz * this.PANEL_DEPTH * 0.5,
          nx: -s.fx, nz: -s.fz, rx: s.rx, rz: s.rz, reach: 2.4
        });
        set.activities.push({
          id: aid, typeId: "electrical-restoration", siteId: sid, required: true, difficulty: k,
          seed: this.hash(seed, i * 16 + k, 31),
          rewards: [{ type: "progress" }, { type: "info", text: this.LOGS[(base + k) % this.LOGS.length] }]
        });
      });
      plan.sets.push(set);
    });
    if (!this._unsub && typeof ActivitySystem !== "undefined") this._unsub = ActivitySystem.addListener((id) => this._refreshGauges(id));
    return plan;
  },

  setIdForExit(exitIndex) {
    const st = (typeof Stairwell !== "undefined" && Stairwell.exits) ? Stairwell.exits[exitIndex] : null;
    return st && st.siteIndex >= 0 ? "L0-E" + st.siteIndex : null;
  },

  _addCollider(px, pz, s) {
    if (typeof Level === "undefined" || !Level.addBoxCollider) return;
    const d = this.PANEL_DEPTH, hw = 0.45;
    const ax = px - s.fx * d, az = pz - s.fz * d;                  // front face
    const xs = [px + s.rx * hw, px - s.rx * hw, ax + s.rx * hw, ax - s.rx * hw];
    const zs = [pz + s.rz * hw, pz - s.rz * hw, az + s.rz * hw, az - s.rz * hw];
    Level.addBoxCollider(Math.min(...xs), 0.2, Math.min(...zs), Math.max(...xs), 2.0, Math.max(...zs));
  },

  /* ---------------- materials ---------------- */
  mats() {
    if (this._mats) return this._mats;
    const M = (o) => new THREE.MeshStandardMaterial(o);
    this._mats = {
      casing: M({ color: 0x5d6057, roughness: 0.7, metalness: 0.35 }),
      dark: M({ color: 0x15170f, roughness: 0.85, metalness: 0.2 }),
      hazard: M({ color: 0xd8b420, roughness: 0.7, metalness: 0.05 }),
      screenOff: M({ color: 0x06110a, emissive: 0x0b3a16, emissiveIntensity: 0.5, roughness: 0.3 }),
      screenOn: M({ color: 0x0a2a10, emissive: 0x3dff5c, emissiveIntensity: 0.85, roughness: 0.3 }),
      lampOff: M({ color: 0x3a0e08, emissive: 0xc02010, emissiveIntensity: 0.9, roughness: 0.4 }),
      lampOn: M({ color: 0x0c3a14, emissive: 0x3dff5c, emissiveIntensity: 1.2, roughness: 0.4 })
    };
    return this._mats;
  },

  /* ---------------- station visual (one per streamed chunk) ---------------- */
  buildStation(group, site, inst) {
    const m = this.mats();
    const root = new THREE.Group();
    root.position.set(site.planeX, 0, site.planeZ);
    root.rotation.y = Math.atan2(site.nx, site.nz);                // local +Z faces the room
    const box = (mat, x, y, z, sx, sy, sz) => {
      const b = new THREE.Mesh(Geometries.box, mat);
      b.position.set(x, y, z); b.scale.set(sx, sy, sz); root.add(b); return b;
    };
    const D = this.PANEL_DEPTH;
    box(m.casing, 0, 1.35, D / 2, 0.86, 1.2, D);
    box(m.dark, 0, 1.55, D + 0.012, 0.62, 0.44, 0.03);
    const screen = box(m.screenOff, 0, 1.55, D + 0.03, 0.54, 0.36, 0.012);
    const lamp = box(m.lampOff, 0.3, 1.17, D + 0.015, 0.08, 0.08, 0.03);
    box(m.hazard, -0.1, 1.05, D + 0.006, 0.5, 0.09, 0.012);
    for (let i = 0; i < 3; i++) box(m.dark, -0.3 + i * 0.1, 1.2, D + 0.012, 0.06, 0.06, 0.02);
    box(m.dark, -0.3, 2.55, 0.07, 0.08, 1.2, 0.08);                // conduit up to the ceiling
    group.add(root);
    // the panel's collider belongs to the chunk it is built in
    this._addCollider(site.planeX, site.planeZ, { fx: -site.nx, fz: -site.nz, rx: site.rx, rz: site.rz });
    const rec = {
      root,
      setCompleted(done) { screen.material = done ? m.screenOn : m.screenOff; lamp.material = done ? m.lampOn : m.lampOff; }
    };
    rec.setCompleted(!!(inst && inst.completed));
    return rec;
  },

  /* ---------------- elevator power gauge ---------------- */
  decorateElevator(group, st, exitIndex) {
    const setId = this.setIdForExit(exitIndex);
    if (!setId) return;
    const set = ActivitySystem.getSet(setId);
    const lamps = [];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x241a06, emissive: 0x2a1a05, emissiveIntensity: 0.5, roughness: 0.4 });
      const p = st.local((i - 2) * 0.34, -0.2), sz = Stairwell.span(st, 0.04, 0.2);
      const b = new THREE.Mesh(Geometries.box, mat);
      b.position.set(p.x, 2.62, p.z); b.scale.set(sz.x, 0.1, sz.z); group.add(b);
      lamps.push(b);
    }
    let label = null;
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas"); c.width = 256; c.height = 54;
      const g = c.getContext("2d");
      g.fillStyle = "#12140b"; g.fillRect(0, 0, 256, 54);
      g.strokeStyle = "#6e5a1c"; g.lineWidth = 2; g.strokeRect(2, 2, 252, 50);
      g.fillStyle = "#ffbd3a"; g.font = "bold 22px 'Courier New',monospace"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("SERVICE LIFT " + (set ? set.meta.unit : ""), 128, 20);
      g.font = "12px 'Courier New',monospace"; g.fillText("AUX POWER · 5 FEEDS REQUIRED", 128, 41);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.32), mat);
      const p = st.local(0, -0.262);
      plane.position.set(p.x, 2.98, p.z);
      plane.rotation.y = Math.atan2(-st.fx, -st.fz);               // faces down the hall
      group.add(plane);
      label = { plane, tex, mat };
    }
    const gauge = { setId, lamps, label };
    this._gauges.push(gauge);
    this._refreshGauges(setId);
  },

  // The facade (and its gauge) is rebuilt each time its chunk streams in; free the old one's resources.
  releaseElevator(exitIndex) {
    const setId = this.setIdForExit(exitIndex);
    this._gauges = this._gauges.filter((g) => {
      if (g.setId !== setId) return true;
      for (const b of g.lamps) { if (b.material && b.material.dispose) b.material.dispose(); }
      if (g.label) { g.label.tex.dispose(); g.label.mat.dispose(); g.label.plane.geometry.dispose(); }
      return false;
    });
  },

  _refreshGauges(setId) {
    const p = ActivitySystem.progress(setId);
    for (const g of this._gauges) {
      if (g.setId !== setId) continue;
      g.lamps.forEach((b, i) => {
        const on = i < p.done;
        b.material.emissive.setHex(on ? 0x3dff5c : 0x2a1a05);
        b.material.color.setHex(on ? 0x0c3a14 : 0x241a06);
        b.material.emissiveIntensity = on ? 1.3 : 0.5;
      });
    }
  },

  reset() {
    for (const g of this._gauges) {
      for (const b of g.lamps) { if (b.material && b.material.dispose) b.material.dispose(); }
      if (g.label) { g.label.tex.dispose(); g.label.mat.dispose(); g.label.plane.geometry.dispose(); }
    }
    this._gauges = [];
    if (this._unsub) { this._unsub(); this._unsub = null; }
  }
};

if (typeof ActivitySystem !== "undefined") {
  ActivitySystem.registerLevelAdapter(0, Level0Activities);

  ActivitySystem.registerSiteKind("l0-station", {
    build(group, site, inst) { return Level0Activities.buildStation(group, site, inst); },
    describe(site, visit, sys) {
      const inst = visit.instances.get(site.instanceId), p = sys.progress(site.setId), k = sys.keyLabel();
      if (inst.completed) return { prompt: "[" + k + "] VIEW STATION LOG · " + site.label + " RESTORED" };
      return { prompt: "[" + k + "] USE MAINTENANCE STATION · " + site.label + "\nLIFT " + visit.sets.get(site.setId).meta.unit + " POWER " + p.percent + "%" };
    },
    use(site, visit, sys) { return sys.openInterface(visit.instances.get(site.instanceId)); }
  });

  ActivitySystem.registerSiteKind("l0-elevator", {
    describe(site, visit, sys) {
      const p = sys.progress(site.setId), set = visit.sets.get(site.setId), k = sys.keyLabel();
      if (p.powered) return { prompt: "[" + k + "] CALL ELEVATOR · LIFT " + set.meta.unit + " POWER 100%" };
      return { prompt: "LIFT " + set.meta.unit + " — NO POWER\nAUX POWER " + p.percent + "% (" + p.done + "/" + p.total + " STATIONS RESTORED)", tone: "warn" };
    },
    use(site, visit, sys) {
      const p = sys.progress(site.setId);
      if (!p.powered) { if (typeof HUD !== "undefined") HUD.toast("LIFT POWER " + p.percent + "%"); return true; }
      if (GameState.exitReached || Stairwell.sequenceActive) return true;
      GameState.exitReached = true; Stairwell.reached = true;
      Stairwell.startSequence(site.exitIndex);
      return true;
    }
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = { Level0Activities };
