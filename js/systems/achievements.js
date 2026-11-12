"use strict";

/* ------------------------------------------------------------------
   ACHIEVEMENT SYSTEM  (Pass 7 / Checkpoint 7B)

   Subscribes to the progression event bus (after StatsSystem, so statistics are already updated when an event reaches it)
   and unlocks achievements defined in AchievementCatalog.

   Rules
   - Event driven. Nothing here runs per frame. An event only evaluates the achievements that can change because of it
     (an index built once from the catalog), and only those still locked.
   - Test, tutorial and developer-session events never arrive: the bus withholds them from subscribers that do not ask for them.
   - Unlocks are permanent and idempotent. Unlocking is keyed by achievement id; cosmetic rewards by reward id.
   - Chains unlock in order: tier N is not evaluated until tier N-1 is unlocked (a satisfied higher tier unlocks right after
     the lower ones in the same pass).
   - Persistence: its own ProgressionStore item (checksum, corruption backup, schema guard), separate from the statistics
     item so existing Pass 7A data is never rewritten. An unlock is saved immediately. If saving fails the unlock stays in
     memory, is reported in diagnostics and is retried; it is never dropped.
   - A run that is voided (a developer command was used) keeps unlocks earned BEFORE the command; nothing after it counts.
   - Hidden achievements expose nothing through getViews() until unlocked.
   - No network. No Supabase. Sync is a later checkpoint.
   ------------------------------------------------------------------ */
const AchievementSystem = (() => {
  const SCHEMA = 1;
  const KEY = "backroomsRunner.progression.achievements.v1";
  const SAVE_DEBOUNCE_MS = 10000, RETRY_MS = 5000, MAX_SHOWCASE = 5;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const TS_MAX = 1e14;
  const num = (x, max) => (isNum(x) && x >= 0) ? Math.min(x, max == null ? 1e12 : max) : 0;
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n || 96) : "");

  /* ---------------- metrics ----------------
     Each metric: deps = bus events after which its value can change; get(snap, arg) -> number | null (null = not available).
     snap = { life: lifetime stats (finished runs), run: normalized run in progress (or the run that just ended), partial }          */
  const sum = (obj, key) => { let n = 0; if (obj) for (const k of Object.keys(obj)) n += obj[k][key] || 0; return n; };
  const runEnt = (run, key, type) => !run ? null : type ? ((run.entityByType[type] || {})[key] || 0) : sum(run.entityByType, key);
  const ov = (s) => (s.run && !s.final) ? s.run : null;           // the in-progress run, for lifetime overlays (a just-finalized run is already in the lifetime totals)
  const METRICS = {
    "lifetime.distance":            { deps: ["distance_traveled", "run_ended"], get: (s) => s.life.distance + (ov(s) ? ov(s).distance : 0) },
    "lifetime.runsFinalized":       { deps: ["run_ended"], get: (s) => s.life.runsFinalized },
    "lifetime.deaths":              { deps: ["run_ended"], get: (s) => s.life.deaths },
    "lifetime.escapes":             { deps: ["run_ended"], get: (s) => s.life.escapes },
    "lifetime.activities":          { deps: ["activity_completed", "run_ended"], get: (s) => s.life.activitiesCompleted + (ov(s) ? ov(s).activities : 0) },
    "lifetime.itemsConsumed":       { deps: ["item_consumed", "run_ended"], get: (s) => s.life.itemsConsumed + (ov(s) ? ov(s).itemCount : 0) },
    "lifetime.entitiesDefeated":    { deps: ["entity_defeated", "run_ended"], get: (s) => s.life.entitiesDefeated + (ov(s) ? runEnt(ov(s), "defeated") : 0) },
    "lifetime.entitiesEncountered": { deps: ["entity_encountered", "entity_defeated", "entity_escaped", "run_ended"], get: (s) => s.life.entitiesEncountered + (ov(s) ? runEnt(ov(s), "encountered") : 0) },
    "lifetime.entityTypes": { deps: ["entity_encountered", "entity_defeated", "entity_escaped", "run_ended"], get: (s) => {
      const seen = new Set();
      for (const t of Object.keys(s.life.entityByType)) if (s.life.entityByType[t].encountered > 0) seen.add(t);
      if (ov(s)) for (const t of Object.keys(ov(s).entityByType)) if (ov(s).entityByType[t].encountered > 0) seen.add(t);
      return seen.size;
    } },
    "lifetime.levelsVisited": { deps: ["level_entered", "run_ended"], get: (s) => {
      const seen = new Set(Object.keys(s.life.levelVisits));
      if (ov(s) && ov(s).visits) for (const k of Object.keys(ov(s).visits)) seen.add(k);
      return seen.size;
    } },
    "run.elapsed":          { deps: ["distance_traveled", "run_ended"], get: (s) => s.run ? s.run.elapsed : null },
    "run.distance":         { deps: ["distance_traveled", "run_ended"], get: (s) => s.run ? s.run.distance : null },
    "run.levelsEscaped":    { deps: ["level_escaped", "run_ended"], get: (s) => s.run ? s.run.levelsEscaped : null },
    "run.activities":       { deps: ["activity_completed"], get: (s) => s.run ? s.run.activities : null },
    "run.itemsConsumed":    { deps: ["item_consumed", "level_escaped"], get: (s) => s.run ? s.run.itemCount : null },
    "run.item":             { deps: ["item_consumed"], get: (s, arg) => (s.run && !s.partial) ? (s.run.items[arg] || 0) : null },
    "run.entitiesDefeated": { deps: ["entity_defeated", "level_escaped"], get: (s, arg) => (s.run && !(s.partial && arg)) ? runEnt(s.run, "defeated", arg) : null }
  };

  /* ---------------- conditions ---------------- */
  function matchField(actual, want) {
    if (want !== null && typeof want === "object") {
      if (!isNum(actual)) return false;
      if ("lt" in want && !(actual < want.lt)) return false;
      if ("lte" in want && !(actual <= want.lte)) return false;
      if ("gt" in want && !(actual > want.gt)) return false;
      if ("gte" in want && !(actual >= want.gte)) return false;
      return true;
    }
    return actual === want;
  }
  function depsOf(c, out) {
    if (c.t === "event") out.add(c.on);
    else if (c.t === "threshold") { const m = METRICS[c.metric]; if (m) for (const d of m.deps) out.add(d); }
    else if (c.t === "all") for (const x of c.of) depsOf(x, out);
    return out;
  }
  const thresholdValue = (c, snap) => { const m = METRICS[c.metric]; return m ? m.get(snap, c.arg) : null; };
  function met(c, env, snap) {
    if (c.t === "event") return !!env && env.type === c.on && Object.keys(c.match || {}).every(k => matchField(env.payload[k], c.match[k]));
    if (c.t === "threshold") {
      const v = thresholdValue(c, snap);
      if (v === null || v === undefined || !isNum(v)) return false;
      if ("gte" in c) return v >= c.gte;
      if ("lte" in c) return v <= c.lte;
      return v === c.eq;
    }
    if (c.t === "all") return c.of.every(x => met(x, env, snap));
    return false;
  }
  // The single threshold a progress bar can show (null for events, and for conditions made of several parts).
  const progressCond = (c) => c.t === "threshold" && "gte" in c ? c : null;

  /* ---------------- persistence model ---------------- */
  const blank = (now) => ({ schema: SCHEMA, createdAt: now, updatedAt: now, unlocked: {}, progress: {}, rewards: {}, showcase: [], selected: { title: null, emblem: null } });

  /* ---------------- module state ---------------- */
  let catalog = null, rewardDefs = null, byId = new Map(), index = new Map(), bus = null, stats = null, store = null, unsubscribeBus = null;
  let now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t);
  let data = blank(Date.now()), initialized = false, dirty = false, saveTimer = null, retryTimer = null, listeners = [], hiddenOrdinals = new Map();
  const freshDiag = () => ({ loadStatus: "none", unlocks: 0, backfilled: 0, saves: 0, saveFailures: 0, retries: 0, pendingSave: false, lastSave: null, listenerErrors: 0, evalErrors: 0, voidedRuns: 0, rewardsGranted: 0, dropped: 0 });
  let diag = freshDiag();

  function sanitize(raw, defsMap, rewards, t0) {
    const d = blank(t0), s = raw && typeof raw === "object" ? raw : {};
    d.createdAt = num(s.createdAt, TS_MAX) || t0; d.updatedAt = num(s.updatedAt, TS_MAX) || t0;
    if (s.unlocked && typeof s.unlocked === "object") for (const id of Object.keys(s.unlocked)) {
      const u = s.unlocked[id];
      if (!u || typeof u !== "object") continue;
      // an id this build does not know (an achievement a newer build added) is KEPT, not dropped: unlocks are permanent
      d.unlocked[str(id)] = { at: num(u.at, TS_MAX), runId: typeof u.runId === "string" ? str(u.runId) : null, via: ["event", "stat", "backfill"].indexOf(u.via) >= 0 ? u.via : "event" };
    }
    if (s.progress && typeof s.progress === "object") for (const id of Object.keys(s.progress)) { const p = s.progress[id]; if (p && isNum(p.best)) d.progress[str(id)] = { best: num(p.best) }; }
    if (s.rewards && typeof s.rewards === "object") for (const id of Object.keys(s.rewards)) { const r = s.rewards[id]; if (r && typeof r === "object") d.rewards[str(id)] = { at: num(r.at, TS_MAX), by: str(r.by) }; }
    if (Array.isArray(s.showcase)) d.showcase = s.showcase.filter(x => typeof x === "string" && d.unlocked[x]).slice(0, MAX_SHOWCASE);
    const sel = s.selected && typeof s.selected === "object" ? s.selected : {};
    d.selected = { title: typeof sel.title === "string" && d.rewards[sel.title] ? sel.title : null, emblem: typeof sel.emblem === "string" && d.rewards[sel.emblem] ? sel.emblem : null };
    return d;
  }

  /* ---------------- saving ---------------- */
  function persistNow() {
    if (saveTimer != null) { clearTimer(saveTimer); saveTimer = null; }
    if (!store) { diag.pendingSave = true; return { ok: false, reason: "no_store" }; }
    data.updatedAt = now();
    const out = store.save(data);
    diag.lastSave = out;
    if (out.ok) {
      dirty = false; diag.pendingSave = false; diag.saves++;
      if (retryTimer != null) { clearTimer(retryTimer); retryTimer = null; }
    } else {
      diag.saveFailures++; diag.pendingSave = true; dirty = true;
      if (out.reason !== "read_only" && retryTimer == null) retryTimer = setTimer(() => { retryTimer = null; diag.retries++; persistNow(); }, RETRY_MS);
    }
    return out;
  }
  function markDirty() {
    dirty = true;
    if (saveTimer == null) saveTimer = setTimer(() => { saveTimer = null; if (dirty) persistNow(); }, SAVE_DEBOUNCE_MS);
  }

  /* ---------------- evaluation ---------------- */
  function normalizeRun(r, partial) {
    return { elapsed: r.elapsed, distance: r.distance, levelsEscaped: r.levelsEscaped, activities: r.activities, itemCount: r.itemCount, items: r.items || {}, entityByType: r.entityByType || {}, visits: r.visits || null, partial: !!partial };
  }
  // snap = { life, run, partial, final }. final: the run has just ended and StatsSystem already folded it into `life`;
  // `run` is then rebuilt from its record (totals only, so per-type and per-item run metrics are unavailable: partial).
  function takeSnapshot(env) {
    const life = stats.getLifetimeStats();
    const active = stats.getRunStats();
    const fromActive = (a) => normalizeRun({ elapsed: a.elapsed, distance: a.distance, levelsEscaped: a.escapedLevels.length, activities: a.activities, itemCount: a.itemCount, items: a.items, entityByType: a.entityByType, visits: a.visits });
    if (env && env.type === "run_ended") {
      const rec = stats.getRecentRuns(1)[0];
      if (active && active.id === env.runId) return { life, run: fromActive(active), partial: false, final: false };   // not finalized yet (unexpected order): treat as in progress
      if (rec && rec.id === env.runId) {
        const run = normalizeRun({ elapsed: rec.durationSec, distance: rec.distance, levelsEscaped: rec.levelsEscaped, activities: rec.activitiesCompleted, itemCount: rec.itemsConsumed, entityByType: { "*": { encountered: rec.entities.encountered, defeated: rec.entities.defeated, escaped: rec.entities.escaped } } }, true);
        return { life, run, partial: true, final: true };
      }
      return { life, run: null, partial: false, final: true };
    }
    return { life, run: active ? fromActive(active) : null, partial: false, final: false };
  }

  function chainReady(def) {
    if (!def.chain || def.chain.tier <= 1) return true;
    const prev = catalog.find(x => x.chain && x.chain.id === def.chain.id && x.chain.tier === def.chain.tier - 1);
    return !prev || !!data.unlocked[prev.id];
  }

  function evaluate(env, via) {
    if (!initialized) return [];
    const list = via === "backfill" ? catalog : index.get(env.type);
    if (!list) return [];
    let snap = null;
    const unlockedNow = [];
    for (const def of list) {
      if (data.unlocked[def.id]) continue;
      if (!chainReady(def)) continue;
      try {
        const c = def.when;
        if (via === "backfill" && !lifetimeOnly(c)) continue;
        if (!snap) snap = env ? takeSnapshot(env) : { life: stats.getLifetimeStats(), run: null, partial: false, final: false };
        // keep a best-so-far for run-scoped progress
        const pc = progressCond(c);
        if (pc && pc.metric.indexOf("run.") === 0) {
          const v = thresholdValue(pc, snap);
          if (isNum(v) && v > ((data.progress[def.id] || {}).best || 0)) { data.progress[def.id] = { best: Math.min(v, pc.gte) }; markDirty(); }
        }
        if (met(c, env, snap)) { unlock(def, env, via || "event"); unlockedNow.push(def.id); }
      } catch (err) { diag.evalErrors++; diag.lastEvalError = String(err && err.message || err); }
    }
    return unlockedNow;
  }
  function lifetimeOnly(c) {
    if (c.t === "event") return false;
    if (c.t === "threshold") return c.metric.indexOf("lifetime.") === 0;
    return c.of.every(lifetimeOnly);
  }

  function unlock(def, env, via) {
    if (data.unlocked[def.id]) return false;                  // permanent and idempotent
    const t = now();
    data.unlocked[def.id] = { at: t, runId: env && env.runId ? env.runId : null, via: via === "backfill" ? "backfill" : (def.when.t === "event" ? "event" : "stat") };
    delete data.progress[def.id];
    diag.unlocks++; if (via === "backfill") diag.backfilled++;
    const granted = [];
    for (const rid of def.rewards || []) {
      if (!rewardDefs[rid] || data.rewards[rid]) continue;     // unknown reward id, or already owned: never granted twice
      data.rewards[rid] = { at: t, by: def.id }; granted.push(rid); diag.rewardsGranted++;
    }
    try { persistNow(); } catch (err) { diag.saveFailures++; diag.pendingSave = true; dirty = true; }   // before anyone is told; a failure (even an exception) keeps the unlock in memory and it is retried
    notify({ id: def.id, at: t, via: data.unlocked[def.id].via, rewards: granted });
    return true;
  }
  function notify(info) {
    const def = byId.get(info.id);
    const payload = { id: def.id, name: def.name, description: def.description, category: def.category, rarity: def.rarity, hidden: !!def.hidden, chain: def.chain || null,
      rewards: info.rewards.map(r => Object.assign({ id: r }, rewardDefs[r])), at: info.at, via: info.via };
    for (const fn of listeners.slice()) { try { fn(payload); } catch (err) { diag.listenerErrors++; } }
  }

  function onEvent(env) {
    if (env.type === "run_voided") { diag.voidedRuns++; return; }
    evaluate(env, null);
  }

  /* ---------------- public API ---------------- */
  function buildIndex() {
    index = new Map(); byId = new Map(); hiddenOrdinals = new Map(); let h = 0;
    for (const def of catalog) {
      byId.set(def.id, def);
      if (def.hidden) hiddenOrdinals.set(def.id, ++h);
      for (const ev of depsOf(def.when, new Set())) { if (!index.has(ev)) index.set(ev, []); index.get(ev).push(def); }
    }
  }

  function initialize(options) {
    const o = options || {};
    if (initialized) shutdown();
    catalog = o.catalog || AchievementCatalog.all;
    rewardDefs = o.rewards || AchievementCatalog.REWARDS;
    bus = o.bus || ProgressionEvents.main;
    stats = o.stats || StatsSystem;
    store = o.store === undefined ? ProgressionStore.create({ key: KEY }) : o.store;
    now = o.now || (() => Date.now());
    setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms)); clearTimer = o.clearTimer || ((t) => clearTimeout(t));
    diag = freshDiag();
    buildIndex();
    let loaded = { status: "unavailable", data: null };
    if (store) loaded = store.load();
    diag.loadStatus = loaded.status;
    data = loaded.data ? sanitize(loaded.data, byId, rewardDefs, now()) : blank(now());
    dirty = false; diag.pendingSave = false;
    initialized = true;
    unsubscribeBus = bus.on("*", onEvent);                     // registered after StatsSystem's own subscription: it sees updated statistics
    // Back-fill: lifetime achievements already satisfied by existing statistics (for example Pass 7A data) unlock now.
    const before = diag.unlocks;
    evaluate(null, "backfill");
    if (diag.unlocks === before && loaded.status === "corrupt") persistNow();   // write a clean item over the damaged one (already backed up)
    return getDiagnostics();
  }
  function shutdown() {
    if (!initialized) return;
    if (dirty) persistNow();
    for (const t of [saveTimer, retryTimer]) if (t != null) clearTimer(t);
    saveTimer = retryTimer = null;
    if (unsubscribeBus) { unsubscribeBus(); unsubscribeBus = null; }
    initialized = false;
  }
  function flush() { return dirty ? persistNow() : { ok: true, skipped: true }; }
  function onUnlock(fn) { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; }

  const isUnlocked = (id) => !!data.unlocked[id];
  const getUnlocked = () => clone(data.unlocked);
  const getOwnedRewards = () => clone(data.rewards);
  const hasReward = (id) => !!data.rewards[id];

  function progressFor(def) {
    const pc = progressCond(def.when);
    if (!pc) return null;
    if (data.unlocked[def.id]) return { value: pc.gte, target: pc.gte, fraction: 1 };
    let v = 0;
    if (initialized) { try { const snap = takeSnapshot(null); const x = thresholdValue(pc, snap); if (isNum(x)) v = x; } catch (_) { /* leave 0 */ } }
    if (pc.metric.indexOf("run.") === 0) v = Math.max(v, (data.progress[def.id] || {}).best || 0);
    v = Math.min(v, pc.gte);
    return { value: v, target: pc.gte, fraction: pc.gte > 0 ? v / pc.gte : 0 };
  }
  function getProgress(id) {
    const def = byId.get(id);
    if (!def) return null;
    if (def.hidden && !data.unlocked[id]) return null;        // hidden progress is never exposed
    return progressFor(def);
  }

  // What a player-facing screen may show. A locked hidden achievement is only { hidden: true, key } (no id, name, text, rarity, category, progress).
  function getViews() {
    return catalog.map(def => {
      const u = data.unlocked[def.id];
      if (def.hidden && !u) return { key: "hidden-" + hiddenOrdinals.get(def.id), hidden: true, unlocked: false };
      return { id: def.id, name: def.name, description: def.description, category: def.category, rarity: def.rarity, hidden: !!def.hidden, chain: def.chain ? clone(def.chain) : null,
        unlocked: !!u, unlockedAt: u ? u.at : null, progress: u ? null : progressFor(def),
        rewards: (def.rewards || []).map(r => Object.assign({ id: r, owned: !!data.rewards[r] }, rewardDefs[r])) };
    });
  }
  function getCompletion() {
    const cats = {}; let total = 0, done = 0, hTotal = 0, hDone = 0;
    for (const def of catalog) {
      const c = cats[def.category] || (cats[def.category] = { total: 0, unlocked: 0 });
      const u = !!data.unlocked[def.id];
      c.total++; total++; if (u) { c.unlocked++; done++; }
      if (def.hidden) { hTotal++; if (u) hDone++; }
    }
    return { total, unlocked: done, percent: total ? Math.round(done / total * 1000) / 10 : 0, byCategory: cats, hidden: { total: hTotal, unlocked: hDone } };
  }
  function getDiagnostics() {
    return Object.assign({ initialized, schema: SCHEMA, catalogSize: catalog ? catalog.length : 0, unlocked: Object.keys(data.unlocked).length, rewardsOwned: Object.keys(data.rewards).length, persistence: store ? store.diagnostics() : null }, diag);
  }

  return { SCHEMA, KEY, METRICS, initialize, shutdown, flush, onUnlock, isUnlocked, getUnlocked, getOwnedRewards, hasReward, getProgress, getViews, getCompletion, getDiagnostics };
})();
