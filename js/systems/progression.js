"use strict";

/* ------------------------------------------------------------------
   PROGRESSION  (Pass 7 / Checkpoint 7A)

   The one object gameplay code talks to. Each call below is a one-line hook placed at the
   spot where the game has already decided that something really happened. This file turns
   that into a validated event on the progression bus. It never reads or writes statistics.

   Test / development isolation. A run is a TEST RUN, and none of its events reach StatsSystem, when any of these is true:
   - it is a Test Beta run or a tutorial run (decided when the run starts)
   - a developer console command that changes the game was used during it (the run is then voided:
     it stops counting at that moment and is removed from the statistics)
   - test mode was switched on for the session: Progression.setTestMode(true), or "?progression=test" in the URL
   Test events are still emitted (so dev tools and tests can watch them) but are flagged and delivered
   only to subscribers that pass { includeTest: true }. This is a client-side rule for local statistics.
   It is not a basis for trusting a client in competitive rankings; that needs server-side checks (a later pass).

   Cost. Nothing here runs per frame except addDistance(), which does a few multiplications,
   one comparison and no allocation, and emits one event per ~25 m.
   ------------------------------------------------------------------ */
const Progression = (() => {
  const BATCH_METERS = 25;          // distance is reported in batches of about this many metres
  const MAX_SPEED = 14;             // m/s. Fastest legitimate horizontal speed is slide 9.4 x 1.12 sprint-jump; this leaves slack
  const STEP_SLACK = 0.05;          // m

  let bus = null;
  const st = {
    run: null,                      // { id, test, mode, seed, distance, entSeq }
    forceTest: false, acc: 0, rejectedSteps: 0, rejectedMeters: 0, devCommands: 0, wired: false,
    ids: new WeakMap()              // entity token -> { run, id }
  };
  const getBus = () => bus || ProgressionEvents.main;
  const gs = () => (typeof GameState !== "undefined" ? GameState : null);
  const round = (n, d) => { const k = Math.pow(10, d); return Math.round(n * k) / k; };

  function emit(type, payload, key) {
    const r = st.run;
    if (!r) return null;
    return getBus().emit(type, payload, { runId: r.id, test: r.test, key });
  }

  /* ---------------- runs ---------------- */
  function startRun(o) {
    const opts = o || {};
    if (st.run) endRun("abandonment");                    // a run began while another was live: the old one ends once, as abandoned
    const g = gs();
    let mode = opts.mode || (g && g.mode) || "classic";
    if (ProgressionEvents.MODES.indexOf(mode) < 0) mode = "classic";
    st.run = { id: ProgressionEvents.newRunId(), test: !!(opts.test || st.forceTest), mode, seed: opts.seed != null ? opts.seed : (g ? g.seed : null), distance: 0, entSeq: 0 };
    st.acc = 0;
    const payload = { mode, startLevel: 0 };
    if (typeof st.run.seed === "number" || (typeof st.run.seed === "string" && st.run.seed.length <= 32)) payload.seed = st.run.seed;
    emit("run_started", payload);
    emit("level_entered", { level: 0, from: null });
    return st.run.id;
  }

  // outcome: "escape" | "death" | "abandonment". Safe to call twice; the second call does nothing.
  function endRun(outcome) {
    const r = st.run;
    if (!r) return null;
    flushDistance();
    const g = gs() || {};
    const level = Number.isInteger(g.level) && g.level >= 0 ? g.level : 0;
    if (outcome === "escape") emit("level_escaped", { level }, "level:" + level);     // finishing the last built level is leaving it
    const payload = { outcome, level, durationSec: round(Math.max(0, Number(g.elapsed) || 0), 1), distance: round(r.distance, 1) };
    if (typeof g.seed === "number") payload.seed = g.seed;
    const out = emit("run_ended", payload);
    getBus().forgetRun(r.id);
    st.run = null; st.acc = 0;
    return out;
  }

  /* ---------------- levels ---------------- */
  // Called from each Level N enter(), just before GameState.level is set, and only after that level was built successfully.
  // Moving to a deeper level is leaving the one before it (level_escaped); going back up is not.
  function levelEntered(n) {
    const r = st.run;
    if (!r || !Number.isInteger(n) || n < 0) return;
    const g = gs();
    const prev = g && Number.isInteger(g.level) ? g.level : null;
    if (prev === n) return;                               // re-entering the same level (a reset) is not a new visit
    flushDistance();
    if (prev != null && n > prev) emit("level_escaped", { level: prev, to: n }, "level:" + prev);
    emit("level_entered", { level: n, from: prev });
  }

  /* ---------------- distance ---------------- */
  // Called once per frame from Player.update with the real displacement of Physics.moveAndCollide.
  // Teleports, spawn placement and level loading set Player.position directly, so they are never in this delta.
  function addDistance(dx, dz, dt) {
    const r = st.run;
    if (r === null || r.test) return;
    const step = Math.sqrt(dx * dx + dz * dz);
    if (step === 0) return;
    const g = GameState;
    if (!(step <= MAX_SPEED * dt + STEP_SLACK) || g.phase !== "playing" || g.cutscene) {   // NaN, a jump, a frame spike, or not actually playing
      st.rejectedSteps++; if (step === step && step < 1e6) st.rejectedMeters += step;
      return;
    }
    st.acc += step; r.distance += step;
    if (st.acc >= BATCH_METERS) flushDistance();
  }
  function flushDistance() {
    const r = st.run;
    if (!r || st.acc < 0.5) return;                       // sub-half-metre remainders are carried, not reported
    const g = gs();
    const payload = { meters: round(st.acc, 2) };
    if (g && Number.isInteger(g.level) && g.level >= 0) payload.level = g.level;
    if (g && typeof g.elapsed === "number" && g.elapsed >= 0) payload.elapsed = round(g.elapsed, 1);
    st.acc = 0;
    emit("distance_traveled", payload);
  }

  /* ---------------- entities ---------------- */
  // A stable id for one entity instance within one run. `token` is the instance (or the object that identifies this spawn).
  function entityId(type, token) {
    const r = st.run;
    let rec = st.ids.get(token);
    if (!rec || rec.run !== r.id) { rec = { run: r.id, id: type + "#" + (++r.entSeq) }; st.ids.set(token, rec); }
    return rec.id;
  }
  // kind: "encountered" | "defeated" | "escaped". Each is reported once per instance (the bus and StatsSystem both enforce it).
  function entityEvent(kind, type, token, method) {
    const r = st.run;
    if (!r || !token) return;
    const id = entityId(type, token);
    const payload = { entityType: type, entityId: id };
    if (method) payload.method = method;
    emit("entity_" + kind, payload, kind + ":" + id);
  }
  // What each entity's own states mean. Only states the game really has are used.
  const ENTITY_RULES = {
    entity: { encounter: (p, n) => n === "PURSUING", escape: (p, n) => p === "PURSUING" && (n === "SEARCHING" || n === "WANDERING") },   // Level 0 entity: it lost you
    hound:  { encounter: (p, n) => n === "chase",   escape: (p, n) => p === "chase" && n === "wander" },                                  // it gave up
    mangled: { encounter: (p, n) => n === "stalk", escape: null },                                                                          // Level 9: it begins actively stalking you (spawning and lurking do not count)
    watch:   { encounter: (p, n) => n === "strike", escape: null },                                                                         // Level 9: it stops observing/withdrawing and comes for you
    beast:  { encounter: (p, n) => n === "chase" || n === "wait", escape: null }                                                          // once committed it never lets go: no escape state exists
  };
  function entityTransition(type, token, prev, next) {
    if (!st.run || st.run.test) return;
    const rule = ENTITY_RULES[type];
    if (!rule || prev === next) return;
    if (rule.encounter(prev, next)) entityEvent("encountered", type, token);
    else if (rule.escape && rule.escape(prev, next)) entityEvent("escaped", type, token);
  }

  /* ---------------- items, activities, documents, secrets ---------------- */
  function itemConsumed(itemId, quantity) {
    if (!st.run) return;
    emit("item_consumed", { itemId: String(itemId), quantity: quantity == null ? 1 : quantity });
  }
  function activityCompleted(inst) {
    if (!st.run || !inst) return;
    const id = String(inst.id != null ? inst.id : inst.instanceId);
    const payload = { activityId: id };
    if (inst.typeId) payload.typeId = String(inst.typeId);
    emit("activity_completed", payload, "activity:" + id);
  }
  // Reserved. The game has nothing to collect or find yet, so nothing calls these. They exist so a later pass has one place to hook.
  function documentCollected(documentId) { if (st.run) emit("document_collected", { documentId: String(documentId) }, "document:" + documentId); }
  function secretDiscovered(secretId) { if (st.run) emit("secret_discovered", { secretId: String(secretId) }, "secret:" + secretId); }

  /* ---------------- test / development mode ---------------- */
  // Called by the developer console for any command that changes the game. A live real run stops counting immediately.
  function markDevelopment(reason) {
    st.devCommands++;
    const r = st.run;
    if (!r || r.test) return false;
    getBus().emit("run_voided", { reason: String(reason || "development").slice(0, 60) }, { runId: r.id, test: false });
    r.test = true; st.acc = 0;
    return true;
  }
  function setTestMode(on) { st.forceTest = !!on; return st.forceTest; }
  function isTestRun() { return !!(st.run && st.run.test); }
  function getRunInfo() { return st.run ? { id: st.run.id, test: st.run.test, mode: st.run.mode, distance: st.run.distance } : null; }
  function getDiagnostics() { return { runActive: !!st.run, testRun: isTestRun(), forceTest: st.forceTest, rejectedSteps: st.rejectedSteps, rejectedMeters: round(st.rejectedMeters, 1), devCommands: st.devCommands, bus: getBus().stats() }; }

  /* ---------------- start-up ---------------- */
  function flush() {
    flushDistance();
    if (typeof StatsSystem !== "undefined") StatsSystem.flush();
    if (typeof AchievementSystem !== "undefined") AchievementSystem.flush();
  }
  function init() {
    try { if (typeof location !== "undefined" && /[?&]progression=test(?:&|$)/.test(location.search || "")) st.forceTest = true; } catch (_) { /* no location */ }
    if (typeof StatsSystem !== "undefined") {
      try { StatsSystem.initialize(); } catch (err) { console.warn("Progression: statistics unavailable", err); }
    }
    // Achievements subscribe AFTER StatsSystem so that, for every event, statistics are already updated when achievements evaluate.
    if (typeof AchievementSystem !== "undefined") {
      try { AchievementSystem.initialize(); } catch (err) { console.warn("Progression: achievements unavailable", err); }
      if (typeof AchievementNotifier !== "undefined") { try { AchievementNotifier.init(); } catch (err) { console.warn("Progression: achievement notifications unavailable", err); } }
    }
    if (!st.wired && typeof window !== "undefined" && window.addEventListener) {
      st.wired = true;
      window.addEventListener("pagehide", flush);
      document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    }
  }

  return {
    init, flush, startRun, endRun, levelEntered, addDistance, entityEvent, entityTransition, itemConsumed, activityCompleted,
    documentCollected, secretDiscovered, markDevelopment, setTestMode, isTestRun, getRunInfo, getDiagnostics,
    _setBus(b) { bus = b; }, _reset() { st.run = null; st.acc = 0; st.rejectedSteps = 0; st.rejectedMeters = 0; st.devCommands = 0; st.forceTest = false; }
  };
})();
