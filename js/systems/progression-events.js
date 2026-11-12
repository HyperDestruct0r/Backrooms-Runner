"use strict";

/* ------------------------------------------------------------------
   PROGRESSION EVENT BUS  (Pass 7 / Checkpoint 7A)

   Gameplay code reports what happened by emitting standardized events.
   Statistics (and, later, achievements) subscribe independently; gameplay
   never writes progression records itself.

   What the bus guarantees:
   - only known event types with well-formed payloads get through
   - every delivered event is an immutable envelope with a unique id, a timestamp
     and (for run events) the id of the run it belongs to
   - the same event id is never delivered twice, and an event that carries a
     natural key (for example "this activity, in this run") is delivered once
   - a subscriber that throws cannot break gameplay or other subscribers
   - events flagged as test/development are delivered only to subscribers that
     explicitly ask for them (includeTest), so debug activity never reaches
     real progression

   This file has no dependency on the rest of the game. createBus() builds an
   isolated bus (used by the tests); ProgressionEvents.main is the one the game uses.
   Events are rare (batched distance, run and level changes, entity transitions).
   Nothing here runs per frame.
   ------------------------------------------------------------------ */
const ProgressionEvents = (() => {
  const SCHEMA_VERSION = 1;
  const MODES = ["classic", "endless", "nightmare"];      // only "classic" is played in Pass 7; the ids are reserved
  const OUTCOMES = ["escape", "death", "abandonment"];
  const MAX_STR = 96;
  const MAX_DISTANCE_BATCH = 1000;                         // metres in one distance_traveled event
  const SEEN_ID_LIMIT = 4000, SEEN_KEY_LIMIT = 4000;

  const isInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= (max == null ? 1e9 : max);
  const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9;
  const KINDS = {
    str: (v) => typeof v === "string" && v.length > 0 && v.length <= MAX_STR,
    int: (v) => isInt(v),
    posint: (v) => isInt(v, 1e6) && v >= 1,
    num: isNum,
    nnum: (v) => v === null || isNum(v),
    bool: (v) => typeof v === "boolean",
    mode: (v) => MODES.indexOf(v) >= 0,
    outcome: (v) => OUTCOMES.indexOf(v) >= 0,
    level: (v) => isInt(v, 99),
    nlevel: (v) => v === null || isInt(v, 99),
    seed: (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 32)
  };

  // scope "run": the event belongs to a run and needs a runId. scope "global": it does not.
  const VOCABULARY = {
    run_started:        { scope: "run", req: { mode: "mode", startLevel: "level" }, opt: { seed: "seed" } },
    run_ended:          { scope: "run", req: { outcome: "outcome", level: "level", durationSec: "num", distance: "num" }, opt: { score: "nnum", seed: "seed" } },
    run_voided:         { scope: "run", req: { reason: "str" }, opt: {} },       // a run that turned out to be a test/development run
    level_entered:      { scope: "run", req: { level: "level" }, opt: { from: "nlevel" } },
    level_escaped:      { scope: "run", req: { level: "level" }, opt: { to: "nlevel" } },
    distance_traveled:  { scope: "run", req: { meters: "num" }, opt: { level: "level", elapsed: "num" }, check: (p) => (p.meters > 0 && p.meters <= MAX_DISTANCE_BATCH) ? null : "meters out of range" },
    entity_encountered: { scope: "run", req: { entityType: "str", entityId: "str" }, opt: { method: "str" } },
    entity_defeated:    { scope: "run", req: { entityType: "str", entityId: "str" }, opt: { method: "str" } },
    entity_escaped:     { scope: "run", req: { entityType: "str", entityId: "str" }, opt: { method: "str" } },
    item_consumed:      { scope: "run", req: { itemId: "str", quantity: "posint" }, opt: {} },
    activity_completed: { scope: "run", req: { activityId: "str" }, opt: { typeId: "str", repeatable: "bool" } },
    document_collected: { scope: "run", req: { documentId: "str" }, opt: { repeatable: "bool" } },
    secret_discovered:  { scope: "run", req: { secretId: "str" }, opt: {} },
    // reserved for seasonal rankings (not implemented in Pass 7); the bus accepts the shape so later passes need no bus change
    season_result:      { scope: "global", req: { seasonId: "str" }, opt: { rank: "posint", score: "num", mode: "mode" } }
  };
  const TYPES = Object.keys(VOCABULARY);

  function validatePayload(type, payload) {
    const def = VOCABULARY[type];
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "payload must be an object";
    for (const k in def.req) {
      if (!(k in payload)) return "missing " + k;
      if (!KINDS[def.req[k]](payload[k])) return "bad " + k;
    }
    for (const k in payload) {
      const kind = def.req[k] || def.opt[k];
      if (!kind) return "unknown field " + k;
      if (payload[k] !== undefined && !KINDS[kind](payload[k])) return "bad " + k;
    }
    return def.check ? def.check(payload) : null;
  }

  // ids: unique across sessions (time + counter + random), short, URL safe
  let counter = 0;
  function rand6() {
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) { const a = new Uint32Array(1); crypto.getRandomValues(a); return (a[0] >>> 0).toString(36).padStart(6, "0").slice(0, 6); }
    } catch (_) { /* fall through */ }
    return Math.floor(Math.random() * 2176782336).toString(36).padStart(6, "0");
  }
  function newId(prefix) { return prefix + Date.now().toString(36) + "-" + (counter++).toString(36) + "-" + rand6(); }

  function createBus(options) {
    const opts = options || {};
    const now = opts.now || (() => Date.now());
    const subs = new Map();                    // type | "*" -> [{ fn, includeTest }]
    const seenIds = new Set(), seenKeys = new Set();
    const diag = { emitted: 0, delivered: 0, rejected: 0, duplicates: 0, testEvents: 0, subscriberErrors: 0, lastError: null, lastRejection: null };
    let depth = 0;

    function remember(set, value, limit) {
      set.add(value);
      if (set.size > limit) { const first = set.values().next().value; set.delete(first); }
    }
    function reject(reason, detail) {
      diag.rejected++;
      diag.lastRejection = { reason, detail: detail || null };
      return { ok: false, reason, detail: detail || null };
    }

    function on(type, fn, o) {
      if (type !== "*" && !VOCABULARY[type]) throw new Error("ProgressionEvents.on: unknown event type " + type);
      if (typeof fn !== "function") throw new Error("ProgressionEvents.on: subscriber must be a function");
      const rec = { fn, includeTest: !!(o && o.includeTest) };
      if (!subs.has(type)) subs.set(type, []);
      subs.get(type).push(rec);
      return () => off(type, fn);
    }
    function off(type, fn) {
      const list = subs.get(type);
      if (!list) return false;
      const i = list.findIndex(r => r.fn === fn);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    }

    function dispatch(env) {
      const lists = [subs.get(env.type), subs.get("*")];
      for (const list of lists) {
        if (!list) continue;
        for (const rec of list.slice()) {                    // a copy, so a subscriber may unsubscribe while handling
          if (env.test && !rec.includeTest) continue;
          try { rec.fn(env); diag.delivered++; }
          catch (err) { diag.subscriberErrors++; diag.lastError = String(err && err.message || err); }
        }
      }
    }

    // ctx: { runId, test, key, id, ts }. Returns { ok:true, event } or { ok:false, reason }.
    function emit(type, payload, ctx) {
      const c = ctx || {};
      const def = VOCABULARY[type];
      if (!def) return reject("unknown_type", String(type));
      const problem = validatePayload(type, payload);
      if (problem) return reject("bad_payload", problem);
      if (def.scope === "run" && !(typeof c.runId === "string" && c.runId.length > 0 && c.runId.length <= MAX_STR)) return reject("no_run");
      if (depth >= 4) return reject("too_deep");
      const id = c.id != null ? String(c.id) : newId("e");
      if (seenIds.has(id)) { diag.duplicates++; return reject("duplicate_id", id); }
      if (c.key != null) {
        const nk = (c.runId || "") + "|" + type + "|" + c.key;
        if (seenKeys.has(nk)) { diag.duplicates++; return reject("duplicate_key", nk); }
        remember(seenKeys, nk, SEEN_KEY_LIMIT);
      }
      remember(seenIds, id, SEEN_ID_LIMIT);
      const body = Object.freeze(Object.assign({}, payload));
      const env = Object.freeze({
        v: SCHEMA_VERSION, id, type, ts: c.ts != null ? c.ts : now(),
        runId: def.scope === "run" ? c.runId : null, test: !!c.test, payload: body
      });
      diag.emitted++;
      if (env.test) diag.testEvents++;
      depth++;
      try { dispatch(env); } finally { depth--; }
      return { ok: true, event: env };
    }

    // Re-deliver an event that was recorded earlier (an outbox replay, or an import). Same rules, same envelope; the
    // original id and timestamp are kept, so delivering it twice is harmless.
    function deliver(envelope) {
      if (!envelope || typeof envelope !== "object") return reject("bad_envelope");
      if (envelope.v !== SCHEMA_VERSION) return reject("bad_version");
      return emit(envelope.type, envelope.payload, { runId: envelope.runId, test: !!envelope.test, id: envelope.id, ts: envelope.ts });
    }

    // Drop the natural-key memory of a finished run. Bounded anyway; this just keeps it small.
    function forgetRun(runId) {
      const prefix = runId + "|";
      for (const k of Array.from(seenKeys)) if (k.startsWith(prefix)) seenKeys.delete(k);
    }
    function subscriberCount(type) { const l = subs.get(type); return l ? l.length : 0; }
    function stats() { return Object.assign({}, diag); }
    return { on, off, emit, deliver, forgetRun, stats, subscriberCount };
  }

  return {
    SCHEMA_VERSION, MODES, OUTCOMES, TYPES, VOCABULARY, MAX_DISTANCE_BATCH,
    createBus, validatePayload, newId, newRunId: () => newId("r"),
    main: createBus()
  };
})();
