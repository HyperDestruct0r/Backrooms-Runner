"use strict";

/* ------------------------------------------------------------------
   STATS SYSTEM  (Pass 7 / Checkpoint 7A)

   Subscribes to the progression event bus and keeps:
   - lifetime totals and personal records (overall, and per game mode)
   - the run in progress
   - the 50 most recent finalized runs

   Design rules:
   - Lifetime totals change only when a run is finalized. Everything a run does is held
     in the run until then, so a run that turns out to be a test/development run can be
     voided without having contaminated anything, and "finalized exactly once" is a single code path.
   - A finalized run is recorded once. A second run_ended for the same run, or a replayed event, changes nothing.
   - A run that was never finalized (the page was closed or reloaded mid-run) is finalized as an
     abandonment the next time the system starts, once; a reload never starts a second run.
   - Lifetime totals survive the history being trimmed to 50 runs.
   - It never talks to a server. The store it writes to is local (ProgressionStore). Cloud sync is a later checkpoint.
   - It never reads gameplay objects. Everything arrives as events.

   Not available in this game, so reported as null/0 rather than invented:
   - score: there is no ScoreSystem in the Pass 6 code, so highestScore stays null and runs record score: null.
   - documents and secrets: nothing in the game collects or hides them yet; the counters and events exist, nothing emits them.
   ------------------------------------------------------------------ */
const StatsSystem = (() => {
  const SCHEMA = 1;
  const MAX_RECENT = 50;
  const APPLIED_LIMIT = 128;          // recent event ids kept (and saved) so a replayed event is ignored after a reload too
  const SAVE_DEBOUNCE_MS = 10000;     // in-run snapshots are written at most this often; run start/end write immediately
  const FLAG_LIMIT = 3000;            // distinct entities remembered per run
  const EXPORT_FORMAT = "backrooms-progression-export";

  const TS_MAX = 1e14;                // millisecond timestamps are ~1.8e12; the general clamp (1e12) must not apply to them
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const num = (x, max) => (typeof x === "number" && Number.isFinite(x) && x >= 0) ? Math.min(x, max == null ? 1e12 : max) : 0;
  const bump = (map, k, n) => { map[k] = (map[k] || 0) + (n == null ? 1 : n); };

  const blankRecords = () => ({ highestScore: null, longestRunSeconds: 0, longestRunDistance: 0, mostLevelsEscapedInRun: 0 });
  const blankCounters = () => ({
    runsStarted: 0, runsFinalized: 0, escapes: 0, deaths: 0, abandonments: 0,
    distance: 0, timePlayed: 0,
    entitiesEncountered: 0, entitiesDefeated: 0, entitiesEscaped: 0, entityByType: {},     // type -> { encountered, defeated, escaped }
    activitiesCompleted: 0, documentsCollected: 0, secretsDiscovered: 0,
    itemsConsumed: 0, itemsByType: {},
    levelsEntered: 0, levelsEscaped: 0, levelVisits: {}, levelEscapes: {},
    records: blankRecords()
  });
  const blankData = (now) => ({ schema: SCHEMA, createdAt: now, updatedAt: now, lifetime: blankCounters(), byMode: {}, recentRuns: [], activeRun: null, runsVoided: 0, appliedIds: [] });

  /* ---------------- sanitizing (used for loaded and imported data) ---------------- */
  function cleanMap(m, valueFn) {
    const out = {};
    if (!m || typeof m !== "object") return out;
    let n = 0;
    for (const k of Object.keys(m)) { if (k.length > 96 || ++n > 300) continue; out[k] = valueFn(m[k]); }
    return out;
  }
  const cleanTriple = (t) => ({ encountered: num(t && t.encountered), defeated: num(t && t.defeated), escaped: num(t && t.escaped) });
  function cleanCounters(c) {
    const b = blankCounters(), s = c && typeof c === "object" ? c : {};
    for (const k of ["runsStarted", "runsFinalized", "escapes", "deaths", "abandonments", "distance", "timePlayed", "entitiesEncountered", "entitiesDefeated", "entitiesEscaped", "activitiesCompleted", "documentsCollected", "secretsDiscovered", "itemsConsumed", "levelsEntered", "levelsEscaped"]) b[k] = num(s[k]);
    b.entityByType = cleanMap(s.entityByType, cleanTriple);
    b.itemsByType = cleanMap(s.itemsByType, (v) => num(v));
    b.levelVisits = cleanMap(s.levelVisits, (v) => num(v));
    b.levelEscapes = cleanMap(s.levelEscapes, (v) => num(v));
    const r = s.records && typeof s.records === "object" ? s.records : {};
    b.records = { highestScore: (typeof r.highestScore === "number" && Number.isFinite(r.highestScore)) ? r.highestScore : null,
      longestRunSeconds: num(r.longestRunSeconds), longestRunDistance: num(r.longestRunDistance), mostLevelsEscapedInRun: num(r.mostLevelsEscapedInRun) };
    return b;
  }
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n || 96) : "");
  function cleanRunRecord(r) {
    if (!r || typeof r !== "object" || !r.id) return null;
    const e = r.entities || {};
    return {
      id: str(r.id), mode: ProgressionEvents.MODES.indexOf(r.mode) >= 0 ? r.mode : "classic",
      startedAt: num(r.startedAt, TS_MAX), endedAt: num(r.endedAt, TS_MAX), startLevel: num(r.startLevel, 99), endLevel: num(r.endLevel, 99),
      durationSec: num(r.durationSec), distance: num(r.distance), score: (typeof r.score === "number" && Number.isFinite(r.score)) ? r.score : null,
      activitiesCompleted: num(r.activitiesCompleted), itemsConsumed: num(r.itemsConsumed),
      entities: { encountered: num(e.encountered), defeated: num(e.defeated), escaped: num(e.escaped) },
      levelsVisited: Array.isArray(r.levelsVisited) ? r.levelsVisited.slice(0, 40).map(x => num(x, 99)) : [],
      levelsEscaped: num(r.levelsEscaped),
      outcome: ProgressionEvents.OUTCOMES.indexOf(r.outcome) >= 0 ? r.outcome : "abandonment",
      recovered: !!r.recovered, seed: (typeof r.seed === "number" || typeof r.seed === "string") ? r.seed : null
    };
  }
  const strArr = (a, n) => Array.isArray(a) ? a.slice(0, n).filter(x => typeof x === "string").map(x => x.slice(0, 96)) : [];
  function cleanActive(a) {
    if (!a || typeof a !== "object" || !a.id) return null;
    return {
      id: str(a.id), mode: ProgressionEvents.MODES.indexOf(a.mode) >= 0 ? a.mode : "classic", seed: (typeof a.seed === "number" || typeof a.seed === "string") ? a.seed : null,
      startedAt: num(a.startedAt, TS_MAX), startLevel: num(a.startLevel, 99), level: num(a.level, 99), elapsed: num(a.elapsed), distance: num(a.distance), savedAt: num(a.savedAt, TS_MAX),
      visits: cleanMap(a.visits, (v) => num(v)), escapedLevels: Array.isArray(a.escapedLevels) ? a.escapedLevels.slice(0, 40).map(x => num(x, 99)) : [],
      entityByType: cleanMap(a.entityByType, cleanTriple), entFlags: cleanMap(a.entFlags, (v) => num(v, 7)),
      items: cleanMap(a.items, (v) => num(v)), itemCount: num(a.itemCount),
      activityIds: strArr(a.activityIds, 500), activities: num(a.activities), documentIds: strArr(a.documentIds, 500), documents: num(a.documents), secretIds: strArr(a.secretIds, 500), secrets: num(a.secrets)
    };
  }
  function hydrate(raw, now) {
    const d = blankData(now), s = raw && typeof raw === "object" ? raw : {};
    d.createdAt = num(s.createdAt, TS_MAX) || now; d.updatedAt = num(s.updatedAt, TS_MAX) || now;
    d.lifetime = cleanCounters(s.lifetime);
    if (s.byMode && typeof s.byMode === "object") for (const m of ProgressionEvents.MODES) if (s.byMode[m]) d.byMode[m] = cleanCounters(s.byMode[m]);
    if (Array.isArray(s.recentRuns)) d.recentRuns = s.recentRuns.map(cleanRunRecord).filter(Boolean).slice(0, MAX_RECENT);
    d.runsVoided = num(s.runsVoided);
    d.appliedIds = strArr(s.appliedIds, APPLIED_LIMIT);
    d.activeRun = cleanActive(s.activeRun);
    return d;
  }

  /* ---------------- module state ---------------- */
  let bus = null, store = null, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t);
  let data = blankData(Date.now()), unsubscribe = null, initialized = false, dirty = false, timer = null, applied = new Set();
  let finalizeListeners = [];       // Pass 7C: told once per finalized run (see onRunFinalized). Survives re-initialization, like AchievementSystem's unlock listeners.
  const diag = { loadStatus: "none", recoveredRun: null, duplicates: 0, staleEvents: 0, handlerErrors: 0, saves: 0, saveFailures: 0, lastSave: null, flagOverflow: 0, ignored: 0 };

  function persistNow() {
    if (timer != null) { clearTimer(timer); timer = null; }
    if (!store) return { ok: false, reason: "no_store" };
    data.updatedAt = now();
    if (data.activeRun) data.activeRun.savedAt = data.updatedAt;
    const out = store.save(data);
    diag.lastSave = out;
    if (out.ok) { dirty = false; diag.saves++; } else diag.saveFailures++;
    return out;
  }
  function markDirty() {
    dirty = true;
    if (timer == null) timer = setTimer(() => { timer = null; if (dirty) persistNow(); }, SAVE_DEBOUNCE_MS);
  }

  const countersFor = (mode) => data.byMode[mode] || (data.byMode[mode] = blankCounters());

  /* ---------------- run lifecycle ---------------- */
  function newActive(env) {
    return { id: env.runId, mode: env.payload.mode, seed: env.payload.seed === undefined ? null : env.payload.seed, startedAt: env.ts, startLevel: env.payload.startLevel, level: env.payload.startLevel,
      elapsed: 0, distance: 0, savedAt: env.ts, visits: {}, escapedLevels: [], entityByType: {}, entFlags: {}, items: {}, itemCount: 0,
      activityIds: [], activities: 0, documentIds: [], documents: 0, secretIds: [], secrets: 0 };
  }

  function applyRunToCounters(c, run, outcome, durationSec, score) {
    c.runsFinalized++;
    if (outcome === "escape") c.escapes++; else if (outcome === "death") c.deaths++; else c.abandonments++;
    c.distance += run.distance; c.timePlayed += durationSec;
    for (const t of Object.keys(run.entityByType)) {
      const r = run.entityByType[t], d = c.entityByType[t] || (c.entityByType[t] = { encountered: 0, defeated: 0, escaped: 0 });
      d.encountered += r.encountered; d.defeated += r.defeated; d.escaped += r.escaped;
      c.entitiesEncountered += r.encountered; c.entitiesDefeated += r.defeated; c.entitiesEscaped += r.escaped;
    }
    c.activitiesCompleted += run.activities; c.documentsCollected += run.documents; c.secretsDiscovered += run.secrets;
    c.itemsConsumed += run.itemCount;
    for (const k of Object.keys(run.items)) bump(c.itemsByType, k, run.items[k]);
    for (const k of Object.keys(run.visits)) { bump(c.levelVisits, k, run.visits[k]); c.levelsEntered += run.visits[k]; }
    for (const lv of run.escapedLevels) { bump(c.levelEscapes, lv); c.levelsEscaped++; }
    const r = c.records;
    if (durationSec > r.longestRunSeconds) r.longestRunSeconds = durationSec;
    if (run.distance > r.longestRunDistance) r.longestRunDistance = run.distance;
    if (run.escapedLevels.length > r.mostLevelsEscapedInRun) r.mostLevelsEscapedInRun = run.escapedLevels.length;
    if (score != null && (r.highestScore == null || score > r.highestScore)) r.highestScore = score;
  }

  // Finalizes the active run exactly once. Returns the run record, or null when there is no run to finalize.
  function finalizeActive(outcome, info) {
    const run = data.activeRun;
    if (!run) return null;
    if (ProgressionEvents.OUTCOMES.indexOf(outcome) < 0) outcome = "abandonment";
    const i = info || {};
    let durationSec = (typeof i.durationSec === "number" && Number.isFinite(i.durationSec) && i.durationSec >= 0) ? i.durationSec : run.elapsed;
    if (!durationSec && i.recovered) durationSec = Math.max(0, (run.savedAt - run.startedAt) / 1000);
    const score = (typeof i.score === "number" && Number.isFinite(i.score)) ? i.score : null;
    const rec = {
      id: run.id, mode: run.mode, startedAt: run.startedAt, endedAt: i.endedAt != null ? i.endedAt : now(), startLevel: run.startLevel, endLevel: i.level != null ? i.level : run.level,
      durationSec, distance: run.distance, score, activitiesCompleted: run.activities, itemsConsumed: run.itemCount,
      entities: { encountered: 0, defeated: 0, escaped: 0 },
      levelsVisited: Object.keys(run.visits).map(Number).sort((a, b) => a - b), levelsEscaped: run.escapedLevels.length, outcome, recovered: !!i.recovered, seed: run.seed
    };
    for (const t of Object.keys(run.entityByType)) { const r = run.entityByType[t]; rec.entities.encountered += r.encountered; rec.entities.defeated += r.defeated; rec.entities.escaped += r.escaped; }
    applyRunToCounters(data.lifetime, run, outcome, durationSec, score);
    applyRunToCounters(countersFor(run.mode), run, outcome, durationSec, score);
    data.recentRuns.unshift(rec);
    if (data.recentRuns.length > MAX_RECENT) data.recentRuns.length = MAX_RECENT;
    data.activeRun = null;
    if (bus) bus.forgetRun(run.id);
    announceFinalized(run, rec, outcome, durationSec, score);
    return rec;
  }

  // Pass 7C. What one finalized run added to the totals, as its own object: the same numbers applyRunToCounters just added to
  // lifetime and to the run's mode. Synchronization sends this, keyed by the run id, so a run can be counted exactly once anywhere.
  function announceFinalized(run, rec, outcome, durationSec, score) {
    if (!finalizeListeners.length) return;
    let delta;
    try { delta = blankCounters(); applyRunToCounters(delta, run, outcome, durationSec, score); delta.runsStarted = 1; }
    catch (err) { diag.handlerErrors++; return; }
    const contribution = { runId: rec.id, mode: rec.mode, record: clone(rec), delta };
    for (const fn of finalizeListeners.slice()) { try { fn(contribution); } catch (err) { diag.handlerErrors++; diag.lastHandlerError = String(err && err.message || err); } }
  }

  /* ---------------- event handling ---------------- */
  function activeFor(env) {
    const run = data.activeRun;
    if (!run || run.id !== env.runId) { diag.staleEvents++; return null; }
    return run;
  }
  function entityEntry(run, type) { return run.entityByType[type] || (run.entityByType[type] = { encountered: 0, defeated: 0, escaped: 0 }); }
  function entityFlag(run, env, bit) {
    const k = env.payload.entityType + "|" + env.payload.entityId;
    const had = run.entFlags[k] || 0;
    if (had & bit) return false;
    if (!had && Object.keys(run.entFlags).length >= FLAG_LIMIT) { diag.flagOverflow++; return false; }
    run.entFlags[k] = had | bit;
    return true;
  }

  const handlers = {
    run_started(env) {
      if (data.activeRun) finalizeActive("abandonment", { durationSec: data.activeRun.elapsed, endedAt: env.ts });   // a new run began without the old one ending: close the old one once
      data.activeRun = newActive(env);
      data.lifetime.runsStarted++; countersFor(env.payload.mode).runsStarted++;
      persistNow();
    },
    run_ended(env) {
      const run = activeFor(env); if (!run) return;
      if (typeof env.payload.distance === "number" && env.payload.distance > run.distance + 1) diag.distanceMismatch = (diag.distanceMismatch || 0) + 1;   // informational: the run's own batches stay authoritative
      finalizeActive(env.payload.outcome, { durationSec: env.payload.durationSec, level: env.payload.level, score: env.payload.score, endedAt: env.ts });
      persistNow();
    },
    run_voided(env) {
      const run = activeFor(env); if (!run) return;
      data.activeRun = null;
      data.lifetime.runsStarted = Math.max(0, data.lifetime.runsStarted - 1);
      const mc = countersFor(run.mode); mc.runsStarted = Math.max(0, mc.runsStarted - 1);
      data.runsVoided++;
      if (bus) bus.forgetRun(run.id);
      persistNow();
    },
    level_entered(env) {
      const run = activeFor(env); if (!run) return;
      bump(run.visits, env.payload.level); run.level = env.payload.level; markDirty();
    },
    level_escaped(env) {
      const run = activeFor(env); if (!run) return;
      if (run.escapedLevels.indexOf(env.payload.level) >= 0) return;          // distinct levels per run
      run.escapedLevels.push(env.payload.level); markDirty();
    },
    distance_traveled(env) {
      const run = activeFor(env); if (!run) return;
      run.distance += env.payload.meters;
      if (typeof env.payload.elapsed === "number" && env.payload.elapsed > run.elapsed) run.elapsed = env.payload.elapsed;
      markDirty();
    },
    entity_encountered(env) {
      const run = activeFor(env); if (!run) return;
      if (entityFlag(run, env, 1)) { entityEntry(run, env.payload.entityType).encountered++; markDirty(); }
    },
    entity_defeated(env) {
      const run = activeFor(env); if (!run) return;
      const e = entityEntry(run, env.payload.entityType);
      if (entityFlag(run, env, 1)) e.encountered++;                            // you cannot defeat what you never met
      if (entityFlag(run, env, 2)) { e.defeated++; markDirty(); }
    },
    entity_escaped(env) {
      const run = activeFor(env); if (!run) return;
      const e = entityEntry(run, env.payload.entityType);
      if (entityFlag(run, env, 1)) e.encountered++;
      if (entityFlag(run, env, 4)) { e.escaped++; markDirty(); }
    },
    item_consumed(env) {
      const run = activeFor(env); if (!run) return;
      bump(run.items, env.payload.itemId, env.payload.quantity); run.itemCount += env.payload.quantity; markDirty();
    },
    activity_completed(env) {
      const run = activeFor(env); if (!run) return;
      const id = env.payload.activityId;
      if (!env.payload.repeatable) { if (run.activityIds.indexOf(id) >= 0) return; if (run.activityIds.length < 500) run.activityIds.push(id); }
      run.activities++; markDirty();
    },
    document_collected(env) {
      const run = activeFor(env); if (!run) return;
      const id = env.payload.documentId;
      if (!env.payload.repeatable) { if (run.documentIds.indexOf(id) >= 0) return; if (run.documentIds.length < 500) run.documentIds.push(id); }
      run.documents++; markDirty();
    },
    secret_discovered(env) {
      const run = activeFor(env); if (!run) return;
      if (run.secretIds.indexOf(env.payload.secretId) >= 0) return;
      if (run.secretIds.length < 500) run.secretIds.push(env.payload.secretId);
      run.secrets++; markDirty();
    }
    // season_result is intentionally not handled here (seasonal rankings are a later pass)
  };

  function onEvent(env) {
    if (applied.has(env.id)) { diag.duplicates++; return; }
    const h = handlers[env.type];
    if (!h) { diag.ignored++; return; }
    applied.add(env.id);
    data.appliedIds.push(env.id);
    if (data.appliedIds.length > APPLIED_LIMIT) { const old = data.appliedIds.shift(); applied.delete(old); }
    try { h(env); } catch (err) { diag.handlerErrors++; diag.lastHandlerError = String(err && err.message || err); }
  }

  /* ---------------- public API ---------------- */
  function initialize(options) {
    const o = options || {};
    if (initialized) shutdown();
    bus = o.bus || ProgressionEvents.main;
    store = o.store === undefined ? ProgressionStore.create() : o.store;
    if (o.now) now = o.now; else now = () => Date.now();
    setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms)); clearTimer = o.clearTimer || ((t) => clearTimeout(t));
    diag.recoveredRun = null;
    let loaded = { status: "unavailable", data: null };
    if (store) loaded = store.load();
    diag.loadStatus = loaded.status;
    data = loaded.data ? hydrate(loaded.data, now()) : blankData(now());
    applied = new Set(data.appliedIds);
    initialized = true;
    unsubscribe = bus.on("*", onEvent);                  // test/development events are not delivered to this subscriber
    if (data.activeRun) {                                // a run that was never finalized: the page went away mid-run
      const stale = data.activeRun;
      diag.recoveredRun = stale.id;
      finalizeActive("abandonment", { recovered: true, endedAt: stale.savedAt || now() });
      persistNow();
    } else if (loaded.status === "corrupt") {
      persistNow();                                      // the damaged item is already backed up by the store; write a clean one
    }
    return getDiagnostics();
  }

  function shutdown() {
    if (!initialized) return;
    if (dirty) persistNow();
    if (timer != null) { clearTimer(timer); timer = null; }
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    initialized = false;
  }

  function flush() { return dirty ? persistNow() : { ok: true, skipped: true }; }

  function derived(c) {
    let topLevel = null, topN = 0;
    for (const k of Object.keys(c.levelVisits)) { const n = c.levelVisits[k]; if (n > topN || (n === topN && topLevel != null && Number(k) < topLevel)) { topN = n; topLevel = Number(k); } }
    let topEntity = null, topE = 0;
    for (const t of Object.keys(c.entityByType).sort()) { const n = c.entityByType[t].encountered; if (n > topE) { topE = n; topEntity = t; } }
    return { mostVisitedLevel: topLevel == null ? null : { level: topLevel, visits: topN }, mostEncounteredEntity: topEntity == null ? null : { entityType: topEntity, count: topE } };
  }
  function scope(mode) {
    if (mode == null || mode === "all") return data.lifetime;
    return data.byMode[mode] || blankCounters();
  }
  // Finished runs only. The run in progress is in getRunStats() and joins these at finalization.
  function getLifetimeStats(mode) { const c = clone(scope(mode)); delete c.records; return c; }
  function getRecords(mode) { const c = scope(mode); return Object.assign(clone(c.records), derived(c)); }
  function getRecentRuns(limit, mode) {
    let list = data.recentRuns;
    if (mode != null && mode !== "all") list = list.filter(r => r.mode === mode);
    return clone(typeof limit === "number" ? list.slice(0, Math.max(0, limit)) : list);
  }
  function getRunStats() { return data.activeRun ? clone(data.activeRun) : null; }

  // Manual finalization (the game normally finalizes through run_ended). Returns the record or null.
  function finalizeRun(outcome, info) { const rec = finalizeActive(outcome, info); if (rec) persistNow(); return rec ? clone(rec) : null; }

  function exportData() {
    const body = { schema: SCHEMA, createdAt: data.createdAt, lifetime: data.lifetime, byMode: data.byMode, recentRuns: data.recentRuns, runsVoided: data.runsVoided };
    const payload = JSON.stringify(body);
    return { format: EXPORT_FORMAT, schema: SCHEMA, exportedAt: now(), sum: ProgressionStore.checksum(payload), payload };
  }

  // Replaces the saved progression with an export. Validates first, keeps a backup of what it replaces, never merges.
  function importData(input, options) {
    if (options && options.merge) return { ok: false, reason: "merge_unsupported" };
    let env = input;
    if (typeof input === "string") { try { env = JSON.parse(input); } catch (_) { return { ok: false, reason: "not_json" }; } }
    if (!env || env.format !== EXPORT_FORMAT || typeof env.payload !== "string") return { ok: false, reason: "wrong_format" };
    if (!Number.isInteger(env.schema) || env.schema > SCHEMA) return { ok: false, reason: "newer_schema" };
    if (ProgressionStore.checksum(env.payload) !== env.sum) return { ok: false, reason: "checksum" };
    let body; try { body = JSON.parse(env.payload); } catch (_) { return { ok: false, reason: "payload" }; }
    const next = hydrate(body, now());
    next.activeRun = data.activeRun;                      // an import never touches the run in progress
    next.appliedIds = data.appliedIds;
    if (store && store.backupCurrent) store.backupCurrent("preimport");
    data = next; applied = new Set(data.appliedIds);
    const out = persistNow();
    return { ok: true, persisted: !!out.ok, runs: data.lifetime.runsFinalized };
  }

  // Explicit only; never called automatically. Keeps a copy first.
  function resetAll(confirm) {
    if (confirm !== "RESET") return { ok: false, reason: "confirmation_required" };
    if (store && store.backupCurrent) store.backupCurrent("prereset");
    const active = data.activeRun;
    data = blankData(now()); data.activeRun = active; applied = new Set();
    persistNow();
    return { ok: true };
  }

  /* ---------------- Pass 7C: synchronization support ----------------
     None of this is used by gameplay. ProgressionSync reads a snapshot, and applies remote totals only between runs. */
  function onRunFinalized(fn) { finalizeListeners.push(fn); return () => { finalizeListeners = finalizeListeners.filter(f => f !== fn); }; }
  const hasActiveRun = () => !!data.activeRun;
  // Totals and history only; never the run in progress, never the event-id memory.
  function getSyncSnapshot() { return { lifetime: clone(data.lifetime), byMode: clone(data.byMode), recentRuns: clone(data.recentRuns), createdAt: data.createdAt }; }
  // Replaces totals/history from a snapshot (account switch) or from a merge result. Refused while a run is live.
  function restoreSnapshot(snap) {
    if (data.activeRun) return { ok: false, reason: "run_active" };
    if (!snap || typeof snap !== "object") return { ok: false, reason: "bad_snapshot" };
    const next = hydrate({ createdAt: snap.createdAt, lifetime: snap.lifetime, byMode: snap.byMode, recentRuns: snap.recentRuns, runsVoided: data.runsVoided, appliedIds: data.appliedIds }, now());
    data = next; applied = new Set(data.appliedIds); markDirty();
    const out = persistNow();
    return { ok: true, persisted: !!out.ok, runs: data.lifetime.runsFinalized };
  }
  // A blank slate for another account. The caller has already archived the previous data.
  function clearForAccountSwitch() {
    if (data.activeRun) return { ok: false, reason: "run_active" };
    const keep = data.appliedIds;
    data = blankData(now()); data.appliedIds = keep; applied = new Set(keep);
    const out = persistNow();
    return { ok: true, persisted: !!out.ok };
  }

  function getDiagnostics() {
    return Object.assign({ initialized, schema: SCHEMA, runActive: !!data.activeRun, runsVoided: data.runsVoided, recentRuns: data.recentRuns.length, persistence: store ? store.diagnostics() : null }, diag);
  }

  return { SCHEMA, MAX_RECENT, initialize, shutdown, flush, onRunFinalized, hasActiveRun, getSyncSnapshot, restoreSnapshot, clearForAccountSwitch, getLifetimeStats, getRunStats, getRecords, getRecentRuns, finalizeRun, exportData, importData, resetAll, getDiagnostics };
})();
