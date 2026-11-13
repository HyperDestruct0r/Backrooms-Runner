"use strict";

/* ------------------------------------------------------------------
   ACTIVITY SYSTEM
   A level-agnostic core for things the player does at places in a level.
   Five concepts, kept apart:

     definition  a registered TYPE of activity (rules, puzzle generator,
                 verifier, interface). registerType().
     instance    one generated activity: id, level, objective set,
                 difficulty, lazily generated random parameters, completion.
     site        a physical place in the level where an activity (or an
                 elevator call point) can be found. Has a registered KIND
                 that knows how to draw it and what E does there.
     objective   a group of activities tied to one elevator. Its power is
       set       the share of REQUIRED activities completed.
     reward      what finishing grants: progress, items, information,
                 discoveries. registerRewardType().

   A level plugs in through registerLevelAdapter(levelId, adapter), whose
   buildPlan(source) returns { seed, sets, sites }. Level 0's adapter is
   js/levels/level0-activities.js.

   State lives in a "visit". beginVisit() always starts a fresh one, so
   leaving a level and coming back resets everything, while chunk
   unloading and interface closing never touch it. Nothing is saved.
   ------------------------------------------------------------------ */
const ActivitySystem = {
  types: new Map(),
  siteKinds: new Map(),
  rewardTypes: new Map(),
  adapters: new Map(),
  visit: null,
  visitCounter: 0,
  interfaceOpen: false,
  openInstance: null,
  _ui: null,
  _visuals: new Map(),     // siteId -> visual record, only while its chunk is loaded
  _chunkSites: new Map(),  // chunk key -> [siteId]
  _listeners: new Set(),
  _current: null,          // interactable under the crosshair
  _objText: null,

  /* ---------------- registration ---------------- */

  registerType(def) {
    for (const k of ["id", "createParams", "verify", "ui"]) {
      if (!def || def[k] == null) throw new Error("ActivitySystem.registerType: missing '" + k + "'");
    }
    if (typeof def.ui.mount !== "function") throw new Error("ActivitySystem.registerType: ui.mount must be a function");
    this.types.set(def.id, def);
  },
  registerSiteKind(id, def) { this.siteKinds.set(id, def); },
  registerRewardType(id, handler) { this.rewardTypes.set(id, handler); },
  registerLevelAdapter(levelId, adapter) { this.adapters.set(levelId, adapter); },
  addListener(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
  _emit(setId) { for (const fn of Array.from(this._listeners)) { try { fn(setId, this.progress(setId)); } catch (e) { console.error(e); } } },

  /* ---------------- visits ---------------- */

  // Returns true when the level is now managed by the Activity System.
  beginVisit(levelId, source) {
    this.endVisit(null);
    const adapter = this.adapters.get(levelId);
    const plan = adapter && adapter.buildPlan ? adapter.buildPlan(source) : null;
    if (!plan) return false;
    const visit = {
      id: ++this.visitCounter, levelId, seed: plan.seed >>> 0,
      sets: new Map(), sites: new Map(), instances: new Map(),
      log: [], discovered: new Set(), touchedSet: null
    };
    for (const s of plan.sites || []) visit.sites.set(s.id, s);
    for (const set of plan.sets || []) {
      const rec = {
        id: set.id, levelId, label: set.label, meta: set.meta || {},
        required: [], optional: []
      };
      for (const a of set.activities || []) {
        const inst = {
          id: a.id, typeId: a.typeId, levelId, setId: set.id, siteId: a.siteId || null,
          required: a.required !== false, difficulty: a.difficulty | 0,
          seed: (a.seed >>> 0), params: null, completed: false, completedAt: null,
          rewards: (a.rewards || []).slice(), rewardsGranted: false, rewardResults: []
        };
        visit.instances.set(inst.id, inst);
        (inst.required ? rec.required : rec.optional).push(inst.id);
      }
      visit.sets.set(rec.id, rec);
    }
    this.visit = visit;
    this._visuals.clear(); this._chunkSites.clear(); this._current = null; this._objText = null;
    return true;
  },

  endVisit(levelId) {
    if (!this.visit) return;
    if (levelId != null && this.visit.levelId !== levelId) return;
    if (this.interfaceOpen) this.closeInterface({ relock: false });
    const adapter = this.adapters.get(this.visit.levelId);
    if (adapter && adapter.reset) adapter.reset();
    this._visuals.clear(); this._chunkSites.clear(); this._current = null;
    this.visit = null;
    if (typeof ActivityUI !== "undefined") ActivityUI.setPrompt(null);
  },

  isManaged(levelId) { return !!this.visit && (levelId == null || this.visit.levelId === levelId); },

  /* ---------------- instances, progress ---------------- */

  getInstance(id) { return this.visit ? this.visit.instances.get(id) || null : null; },
  getSet(id) { return this.visit ? this.visit.sets.get(id) || null : null; },

  // Random parameters are generated on first need, from the instance's own
  // deterministic seed, so an unvisited station costs nothing.
  ensureParams(inst) {
    if (!inst.params) {
      const def = this.types.get(inst.typeId);
      if (!def) throw new Error("Unknown activity type " + inst.typeId);
      inst.params = def.createParams(inst);
    }
    return inst.params;
  },

  progress(setId) {
    const set = this.getSet(setId);
    if (!set) return { done: 0, total: 0, percent: 0, powered: false };
    let done = 0;
    for (const id of set.required) if (this.visit.instances.get(id).completed) done++;
    const total = set.required.length;
    const percent = total ? Math.round(done * 100 / total) : 0;
    return { done, total, percent, powered: total > 0 && done === total };
  },

  // Maps a Level 0 Stairwell exit index to its objective set (adapter owns the mapping).
  setForExit(exitIndex) {
    if (!this.visit) return null;
    const a = this.adapters.get(this.visit.levelId);
    return a && a.setIdForExit ? a.setIdForExit(exitIndex) : null;
  },
  canUseElevator(exitIndex) {
    if (!this.visit) return true;                  // unmanaged level: legacy behaviour
    const id = this.setForExit(exitIndex);
    if (id == null) return true;                   // an exit the system does not manage
    return this.progress(id).powered;
  },

  /* ---------------- completion ---------------- */

  // The single door to completion. The type's own verifier decides.
  submit(instId, submission) {
    const inst = this.getInstance(instId);
    if (!inst) return { ok: false, reason: "unknown" };
    if (inst.completed) return { ok: true, already: true };
    const def = this.types.get(inst.typeId);
    this.ensureParams(inst);
    if (!def.verify(inst.params, submission)) return { ok: false, reason: "invalid" };
    this.complete(inst);
    return { ok: true };
  },

  complete(inst) {
    if (inst.completed) return false;
    inst.completed = true;
    inst.completedAt = (typeof GameState !== "undefined" && GameState.elapsed) || 0;
    if (typeof Progression !== "undefined") Progression.activityCompleted(inst);
    this.grantRewards(inst);
    const v = this._visuals.get(inst.siteId);
    if (v && v.setCompleted) v.setCompleted(true);
    this._emit(inst.setId);
    return true;
  },

  grantRewards(inst) {
    if (inst.rewardsGranted) return;
    inst.rewardsGranted = true;
    for (const r of inst.rewards) {
      const h = this.rewardTypes.get(r.type);
      if (!h) continue;
      const out = h(r, inst, this.visit);
      if (out) inst.rewardResults.push(out);
    }
  },

  /* ---------------- chunk hooks (visuals follow chunk streaming) ---------------- */

  onChunkBuilt(levelId, key, group, minx, minz, maxx, maxz) {
    if (!this.visit || this.visit.levelId !== levelId) return;
    const ids = [];
    for (const site of this.visit.sites.values()) {
      if (site.worldX < minx || site.worldX >= maxx || site.worldZ < minz || site.worldZ >= maxz) continue;
      const kind = this.siteKinds.get(site.kind);
      if (!kind || !kind.build) continue;
      const inst = site.instanceId ? this.visit.instances.get(site.instanceId) : null;
      const rec = kind.build(group, site, inst, this.visit);
      if (rec) { this._visuals.set(site.id, rec); ids.push(site.id); }
    }
    if (ids.length) this._chunkSites.set(key, ids);
  },
  onChunkUnloaded(levelId, key) {
    const ids = this._chunkSites.get(key);
    if (!ids) return;
    for (const id of ids) { const r = this._visuals.get(id); if (r && r.dispose) r.dispose(); this._visuals.delete(id); }
    this._chunkSites.delete(key);
  },
  decorateElevator(group, st, exitIndex) {
    if (!this.visit) return;
    const a = this.adapters.get(this.visit.levelId);
    if (a && a.decorateElevator) a.decorateElevator(group, st, exitIndex);
  },

  /* ---------------- per-frame ---------------- */

  keyLabel() {
    const c = (typeof CONFIG !== "undefined" && CONFIG.keys && CONFIG.keys.use) || "KeyE";
    return String(c).replace(/^Key/, "").replace(/^Digit/, "");
  },

  update(dt) {
    const v = this.visit;
    if (!v || GameState.level !== v.levelId) { this._current = null; if (typeof ActivityUI !== "undefined") ActivityUI.setPrompt(null); return; }
    if (this.interfaceOpen) { this._current = null; return; }
    const px = Player.position.x, pz = Player.position.z;
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    let best = null, bestD = Infinity;
    for (const site of v.sites.values()) {
      const dx = px - site.worldX, dz = pz - site.worldZ, d = Math.hypot(dx, dz);
      // remember sets the player has come across (never points anywhere)
      if (d < 9) { v.discovered.add(site.setId); v.touchedSet = site.setId; }
      if (d > (site.reach || 2.3)) continue;
      if (dx * site.nx + dz * site.nz < 0.05) continue;                    // behind the surface
      const facing = (-dx * fx + -dz * fz) / (d || 1);
      if (facing < 0.35) continue;                                          // not looking at it
      if (d < bestD) { bestD = d; best = site; }
    }
    this._current = best;
    const kind = best ? this.siteKinds.get(best.kind) : null;
    const desc = kind && kind.describe ? kind.describe(best, v, this) : null;
    this._currentDesc = desc;
    if (typeof ActivityUI !== "undefined") ActivityUI.setPrompt(desc ? desc.prompt : null, desc && desc.tone);
    this._updateObjective();
  },

  _updateObjective() {
    const v = this.visit;
    if (!v || !v.touchedSet || GameState.level !== v.levelId) return;
    const set = this.getSet(v.touchedSet), p = this.progress(v.touchedSet);
    const text = "Objective: " + (p.powered ? set.label + " powered — call the elevator" : "restore " + set.label + " power (" + p.done + "/" + p.total + ")");
    if (text === this._objText) return;
    this._objText = text;
    const el = document.getElementById("hud-obj");
    if (el) el.textContent = text;
  },

  // E pressed. Returns true when the press was used.
  tryUse() {
    if (this.interfaceOpen) return true;                     // swallow: the panel owns input
    if (!this.visit || GameState.level !== this.visit.levelId || !this._current) return false;
    const kind = this.siteKinds.get(this._current.kind);
    if (!kind || !kind.use) return false;
    return !!kind.use(this._current, this.visit, this);
  },

  /* ---------------- interface lifecycle ---------------- */

  openInterface(inst) {
    if (this.interfaceOpen || !this.visit || typeof ActivityUI === "undefined") return false;
    const def = this.types.get(inst.typeId);
    this.ensureParams(inst);
    this.interfaceOpen = true;
    this.openInstance = inst;
    this.visit.touchedSet = inst.setId;
    // Reuse the game's existing "a panel is open" flag: the pause overlay, the
    // use/unlock/record keys and the pickup hint all already respect it.
    GameState.inventoryOpen = true;
    if (typeof clearInput === "function") clearInput();
    if (typeof MobileControls !== "undefined" && MobileControls.resetToggles) MobileControls.resetToggles();
    Input.locked = false;
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    if (typeof ActivityUI !== "undefined") ActivityUI.setPrompt(null);
    this._ui = ActivityUI.open({
      system: this, instance: inst, def,
      set: this.getSet(inst.setId),
      site: this.visit.sites.get(inst.siteId) || null
    });
    return true;
  },

  closeInterface(opts) {
    if (!this.interfaceOpen) return;
    const relock = !opts || opts.relock !== false;
    this.interfaceOpen = false;
    this.openInstance = null;
    if (this._ui) { try { this._ui.close(); } catch (e) { console.error(e); } this._ui = null; }
    GameState.inventoryOpen = false;
    if (typeof clearInput === "function") clearInput();
    if (relock && GameState.phase === "playing" && !GameState.cutscene) this._relock();
  },

  _relock() {
    if (DeviceMode.mobile) { Input.locked = true; return; }
    if (!(renderer && renderer.domElement)) return;
    // Pointer lock was released by script, so a script request normally works.
    // If the browser refuses, fall back to the game's own click-to-resume overlay.
    const onErr = () => { document.removeEventListener("pointerlockerror", onErr); if (GameState.phase === "playing" && !Input.locked && !this.interfaceOpen && typeof setPauseOverlay === "function") setPauseOverlay(true); };
    document.addEventListener("pointerlockerror", onErr, { once: true });
    setTimeout(() => document.removeEventListener("pointerlockerror", onErr), 1500);
    try { renderer.domElement.requestPointerLock(); } catch (e) { onErr(); }
  },

  // Called every frame by the game loop while a panel is open: shut it if the
  // run moved on underneath it (death, cutscene, other level).
  guard() {
    if (!this.interfaceOpen) return;
    if (GameState.phase !== "playing" || GameState.cutscene || !this.visit || GameState.level !== this.visit.levelId) this.closeInterface({ relock: false });
  }
};

/* Reward types shipped with the core. Levels and activities may add more. */
ActivitySystem.registerRewardType("progress", (r, inst) => "+" + Math.round(100 / Math.max(1, (ActivitySystem.getSet(inst.setId) || { required: [1] }).required.length)) + "% POWER");
ActivitySystem.registerRewardType("info", (r) => r.text || null);
ActivitySystem.registerRewardType("discovery", (r, inst, visit) => { if (visit && r.id) visit.discovered.add("discovery:" + r.id); return r.text || null; });
ActivitySystem.registerRewardType("item", (r) => {
  if (typeof Inventory === "undefined" || !Inventory.addItem) return null;
  const added = Inventory.addItem(r.itemId, r.qty || 1);
  return added > 0 ? "+" + added + " " + (r.name || r.itemId) : null;
});

if (typeof module !== "undefined" && module.exports) module.exports = { ActivitySystem };
