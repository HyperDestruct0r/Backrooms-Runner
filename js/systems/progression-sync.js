"use strict";

/* ------------------------------------------------------------------
   PROGRESSION SYNC  (Pass 7 / Checkpoint 7C)

   Local-first synchronization of progression with Supabase.

   The local stores stay the source of what the game shows and records. This module NEVER sits on a gameplay path:
   it listens, writes a small local outbox, and talks to the network from a timer or an environment event, one request at a time,
   in the background. If it fails, the game does not notice.

   What is synchronized, and under what identity
   - Lifetime statistics and records   as CONTRIBUTIONS: one per finalized run (key = the run id) and one baseline per device install
     (key = a random baseline id) holding the totals the device had before synchronization existed. The server sums contributions, so
     the same run or baseline can only ever be counted once, however many times, from however many devices, it is sent.
   - Run history                        every finalized run record, by run id. The newest 50 are returned to every device.
   - Achievements and cosmetic rewards  by id. Union. The earlier unlock (and its metadata) wins. Nothing is ever removed.
   - Cosmetic selections and showcase   last intentional choice wins, per slot; only an owned reward can be equipped.
   The two local items (backroomsRunner.progression.v1 = statistics, ...achievements.v1) are each read and written only through their
   own system. Synchronization state (outbox, binding, acknowledgements) lives in a THIRD item, ...progression.sync.v1, so neither of
   the two existing items changes format and an old cached build can never damage the outbox.

   Pending data. A contribution or unlock stays in the outbox until the server says it has it (accepted, or already had it).
   A failure of any kind (offline, timeout, server error, page closed mid-request) leaves it exactly where it was. Re-sending is
   harmless because the server is idempotent by id.

   Applying remote data. After a successful exchange the device shows REMOTE TOTALS + ITS OWN UNACKNOWLEDGED CONTRIBUTIONS, never lowered
   below what it already had (a per-field floor). Remote data is applied only between runs. If two copies cannot be reconciled safely
   (a newer schema on either side, a lost sync state, a totals regression), nothing is discarded: the situation is recorded in
   getConflicts() and play continues on local data.

   Accounts. Local progression is bound to the first account that signs in (anonymous progress is claimed by it). If a DIFFERENT
   account signs in later, the previous account's local data is archived under that account's id (and restored if it returns), and the
   new account starts from its own server data. One account's data is never uploaded to another.
   ------------------------------------------------------------------ */
const ProgressionSync = (() => {
  const SCHEMA = 1;
  const KEY = "backroomsRunner.progression.sync.v1";
  const ARCHIVE_PREFIX = "backroomsRunner.progression.archive.";
  const BATCH_SIZE = 100;
  const MAX_CYCLES = 3;                                        // exchanges per trigger: a loop guard
  const DEBOUNCE_MS = 2500;                                    // after a run ends / an unlock: let bursts collapse into one request
  const STALE_REFRESH_MS = 10 * 60 * 1000;                     // coming back to the tab pulls at most this often
  const BACKOFF_S = [5, 15, 45, 120, 300, 900, 1800];          // retry delays after consecutive failures
  const MAX_CONFLICTS = 20, MAX_DEAD = 50, MAX_ACKED_RUNS = 200, MAX_ARCHIVES = 8;
  const PRIORITY = { baseline: 0, run: 1, ach: 2, reward: 3, cosmetics: 4 };

  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const M = () => ProgressionMerge;

  /* ---------------- module state ---------------- */
  let deps = null;                                             // { stats, ach, remote, storage, now, setTimer, clearTimer, random, online }
  let state = null, store = null, loadStatus = "none";
  let attached = false, initialized = false, unsubs = [], early = [];
  let user = null, pendingUser = undefined;                    // user: { id } or null
  let running = null, rerun = false, timer = null, timerAt = 0, applyPending = false, envWired = false, deferred = null;
  const diag = { cycles: 0, requests: 0, successes: 0, failures: 0, lastError: null, lastErrorKind: null, lastOkAt: 0, applied: 0, duplicatesSeen: 0, rejected: 0, swaps: 0, enqueuedRuns: 0, saveFailures: 0, listenerErrors: 0, appliedErrors: 0 };

  const freshState = (deviceId, now) => ({
    schema: SCHEMA, deviceId: deviceId || newToken("d"), createdAt: now, updatedAt: now,
    binding: { userId: null, at: 0 },
    baseline: { id: null, status: "none" },                    // none | pending | acked | skipped_lost_state
    outbox: [], acked: { ach: {}, rewards: {}, runs: [], profile: {} }, remote: { version: null, lastOkAt: 0 },
    conflicts: [], dead: [], archives: [], backoff: { failures: 0, nextAt: 0 }
  });
  function newToken(prefix) {
    let r = "";
    try { if (typeof crypto !== "undefined" && crypto.getRandomValues) { const a = new Uint32Array(2); crypto.getRandomValues(a); r = a[0].toString(36) + a[1].toString(36); } } catch (_) { /* fall through */ }
    if (!r) r = Math.floor(Math.random() * 2176782336).toString(36) + Math.floor(Math.random() * 2176782336).toString(36);
    return prefix + Date.now().toString(36) + "-" + r;
  }

  /* ---------------- sanitizing the sync state (loaded data is never trusted) ---------------- */
  const strv = (v, n) => (typeof v === "string" ? v.slice(0, n || 96) : "");
  function hydrateState(raw, now) {
    const d = freshState(null, now), s = raw && typeof raw === "object" ? raw : {};
    d.deviceId = strv(s.deviceId, 64) || d.deviceId;
    d.createdAt = isNum(s.createdAt) ? s.createdAt : now; d.updatedAt = isNum(s.updatedAt) ? s.updatedAt : now;
    const b = s.binding && typeof s.binding === "object" ? s.binding : {};
    d.binding = { userId: typeof b.userId === "string" && b.userId ? strv(b.userId, 64) : null, at: isNum(b.at) ? b.at : 0 };
    const bl = s.baseline && typeof s.baseline === "object" ? s.baseline : {};
    d.baseline = { id: typeof bl.id === "string" ? strv(bl.id, 64) : null, status: ["none", "pending", "acked", "skipped_lost_state"].indexOf(bl.status) >= 0 ? bl.status : "none" };
    if (Array.isArray(s.outbox)) for (const it of s.outbox) {
      if (!it || typeof it !== "object" || !(it.k in PRIORITY) || typeof it.id !== "string" || !it.id || !it.payload || typeof it.payload !== "object") continue;
      d.outbox.push({ k: it.k, id: strv(it.id, 96), at: isNum(it.at) ? it.at : 0, payload: it.payload, tries: isNum(it.tries) ? it.tries : 0, lastError: it.lastError ? strv(String(it.lastError), 200) : null });
    }
    const a = s.acked && typeof s.acked === "object" ? s.acked : {};
    for (const grp of ["ach", "rewards", "profile"]) if (a[grp] && typeof a[grp] === "object") for (const k of Object.keys(a[grp])) if (isNum(a[grp][k])) d.acked[grp][strv(k)] = a[grp][k];
    if (Array.isArray(a.runs)) d.acked.runs = a.runs.filter(x => typeof x === "string").slice(-MAX_ACKED_RUNS);
    const r = s.remote && typeof s.remote === "object" ? s.remote : {};
    d.remote = { version: isNum(r.version) ? r.version : null, lastOkAt: isNum(r.lastOkAt) ? r.lastOkAt : 0 };
    if (Array.isArray(s.conflicts)) d.conflicts = s.conflicts.filter(c => c && typeof c === "object").slice(-MAX_CONFLICTS);
    if (Array.isArray(s.dead)) d.dead = s.dead.filter(c => c && typeof c === "object").slice(-MAX_DEAD);
    if (Array.isArray(s.archives)) d.archives = s.archives.filter(x => typeof x === "string").slice(0, MAX_ARCHIVES * 2);
    const bo = s.backoff && typeof s.backoff === "object" ? s.backoff : {};
    d.backoff = { failures: isNum(bo.failures) ? bo.failures : 0, nextAt: isNum(bo.nextAt) ? bo.nextAt : 0 };
    return d;
  }

  /* ---------------- persistence of the sync state ---------------- */
  function persist() {
    state.updatedAt = deps.now();
    if (!store) return { ok: false, reason: "no_store" };
    let out;
    try { out = store.save(state); } catch (err) { out = { ok: false, reason: "exception" }; }
    if (!out.ok) diag.saveFailures++;
    return out;
  }
  function addConflict(kind, detail) {
    const last = state.conflicts[state.conflicts.length - 1];
    if (last && last.kind === kind && JSON.stringify(last.detail) === JSON.stringify(detail || null)) { last.count = (last.count || 1) + 1; last.lastAt = deps.now(); return; }
    state.conflicts.push({ at: deps.now(), kind, detail: detail === undefined ? null : detail, count: 1 });
    if (state.conflicts.length > MAX_CONFLICTS) state.conflicts.shift();
  }

  /* ---------------- outbox ---------------- */
  const outboxHas = (k, id) => state.outbox.some(x => x.k === k && x.id === id);
  function enqueue(item) {
    if (outboxHas(item.k, item.id)) return false;
    state.outbox.push({ k: item.k, id: item.id, at: deps.now(), payload: item.payload, tries: 0, lastError: null });
    return true;
  }
  const outboxCounts = () => { const c = { baseline: 0, run: 0, ach: 0, reward: 0, cosmetics: 0 }; for (const x of state.outbox) c[x.k]++; return c; };

  // A run contribution from StatsSystem. `counted:true`: its delta is part of the totals the server must add.
  function enqueueRun(c) {
    if (!c || typeof c.runId !== "string" || !c.record || !c.delta) return;
    const added = enqueue({ k: "run", id: c.runId, payload: { mode: c.mode, outcome: c.record.outcome, startedAt: c.record.startedAt, endedAt: c.record.endedAt, record: c.record, counted: true, delta: c.delta } });
    if (added) { diag.enqueuedRuns++; persist(); trigger("run_finalized"); }
  }

  /* ---------------- baseline: what this device had before synchronization ---------------- */
  function createBaselineIfNeeded(statusOfStateLoad) {
    const snap = deps.stats.getSyncSnapshot();
    const hasLocal = snap.lifetime.runsFinalized > 0 || snap.lifetime.runsStarted > 0 || snap.recentRuns.length > 0;
    if (statusOfStateLoad === "corrupt" || statusOfStateLoad === "newer_schema") {
      // The record of what was already sent is gone (or unreadable). Guessing would double count or drop data. Keep local data as it is,
      // never upload a baseline, report it; later runs synchronize normally and totals are floored at what the device already shows.
      if (hasLocal) { state.baseline = { id: null, status: "skipped_lost_state" }; addConflict("sync_state_lost", { loadStatus: statusOfStateLoad, runsFinalized: snap.lifetime.runsFinalized }); }
      return;
    }
    if (!hasLocal) return;                                      // nothing to account for: every future run is its own contribution
    const id = newToken("b");
    state.baseline = { id, status: "pending" };
    enqueue({ k: "baseline", id, payload: { deviceId: state.deviceId, lifetime: snap.lifetime, byMode: snap.byMode, runCount: snap.recentRuns.length } });
    for (const r of snap.recentRuns) enqueue({ k: "run", id: r.id, payload: { mode: r.mode, outcome: r.outcome, startedAt: r.startedAt, endedAt: r.endedAt, record: r, counted: false } });   // history only: the baseline already holds their totals
  }

  /* ---------------- local changes that need no event: achievements, rewards, choices ---------------- */
  function reconcileLocal() {
    let changed = false;
    const a = deps.ach.getSyncSnapshot();
    for (const id of Object.keys(a.unlocked)) {
      if (state.acked.ach[id] || outboxHas("ach", id)) continue;
      const u = a.unlocked[id];
      enqueue({ k: "ach", id, payload: { at: u.at, runId: u.runId || null, via: u.via || "event" } }); changed = true;
    }
    for (const id of Object.keys(a.rewards)) {
      if (state.acked.rewards[id] || outboxHas("reward", id)) continue;
      const r = a.rewards[id];
      enqueue({ k: "reward", id, payload: { at: r.at, by: r.by || "" } }); changed = true;
    }
    const slots = {}; let newer = false;
    for (const slot of M().SLOTS) {
      const at = a.selectedAt[slot] || 0;
      if (at > 0) { slots[slot] = { id: a.selected[slot] == null ? null : a.selected[slot], at }; if (at > (state.acked.profile[slot] || 0)) newer = true; }
    }
    const show = { ids: a.showcase.slice(), at: a.showcaseAt || 0 };
    if (show.at > (state.acked.profile.showcase || 0)) newer = true;
    if (newer) {
      const ix = state.outbox.findIndex(x => x.k === "cosmetics");
      const item = { k: "cosmetics", id: "cosmetics", at: deps.now(), payload: { selected: slots, showcase: show }, tries: 0, lastError: null };
      if (ix >= 0) state.outbox[ix] = item; else state.outbox.push(item);   // always the latest choice, never a queue of old ones
      changed = true;
    }
    if (changed) persist();
    return changed;
  }

  /* ---------------- sending ---------------- */
  const wire = (it) => Object.assign({ k: it.k, id: it.id }, it.payload);
  function nextBatch() {
    const items = state.outbox.slice().sort((x, y) => (PRIORITY[x.k] - PRIORITY[y.k]) || (x.at - y.at));
    return items.slice(0, BATCH_SIZE);
  }

  function backoffDelayMs(kind) {
    const f = Math.max(1, state.backoff.failures);
    let s = BACKOFF_S[Math.min(f - 1, BACKOFF_S.length - 1)];
    if (kind === "not_installed") s = Math.max(s, 600);        // the database migration has not been applied: do not hammer it
    const jitter = 0.8 + deps.random() * 0.4;
    return Math.round(s * 1000 * jitter);
  }

  // Returns { ok, response, stop } for one exchange.
  async function exchange(batchItems) {
    diag.requests++;
    const res = await deps.remote.sync({ items: batchItems.map(wire) }, state.remote.version);
    if (!res.ok) return { ok: false, res };
    return { ok: true, res };
  }

  // Removes what the server confirmed, keeps everything else. Returns counts.
  function settle(batchItems, data) {
    const result = data.result || {};
    const done = new Set(), refused = new Map();
    for (const x of (result.accepted || [])) done.add(x.k + "|" + x.id);
    for (const x of (result.duplicates || [])) { done.add(x.k + "|" + x.id); diag.duplicatesSeen++; }
    for (const x of (result.rejected || [])) refused.set(x.k + "|" + String(x.id).split(":")[0], x);
    const at = deps.now();
    let removed = 0, dead = 0;
    for (const it of batchItems) {
      const key = it.k + "|" + it.id;
      if (done.has(key) || (it.k === "cosmetics" && refused.has(key) && (result.accepted || []).some(a => a.k === "cosmetics"))) {
        if (it.k === "ach") state.acked.ach[it.id] = it.payload.at || at;
        else if (it.k === "reward") state.acked.rewards[it.id] = it.payload.at || at;
        else if (it.k === "run") { state.acked.runs.push(it.id); if (state.acked.runs.length > MAX_ACKED_RUNS) state.acked.runs.shift(); }
        else if (it.k === "baseline" && state.baseline.id === it.id) state.baseline.status = "acked";
        else if (it.k === "cosmetics") {
          for (const slot of Object.keys(it.payload.selected || {})) state.acked.profile[slot] = Math.max(state.acked.profile[slot] || 0, it.payload.selected[slot].at);
          state.acked.profile.showcase = Math.max(state.acked.profile.showcase || 0, (it.payload.showcase || {}).at || 0);
        }
        state.outbox = state.outbox.filter(x => !(x.k === it.k && x.id === it.id)); removed++;
        continue;
      }
      const rej = refused.get(key);
      const live = state.outbox.find(x => x.k === it.k && x.id === it.id);
      if (rej && live) {
        diag.rejected++;
        if (rej.permanent !== false) {                          // the server will never accept it as it is: keep a copy, stop retrying, report
          state.dead.push({ k: it.k, id: it.id, reason: String(rej.reason || "rejected").slice(0, 120), at, payload: it.payload });
          if (state.dead.length > MAX_DEAD) state.dead.shift();
          addConflict("rejected_by_server", { k: it.k, id: it.id, reason: String(rej.reason || "rejected").slice(0, 120) });
          state.outbox = state.outbox.filter(x => !(x.k === it.k && x.id === it.id)); dead++;
        } else { live.tries++; live.lastError = String(rej.reason || "").slice(0, 200); }
      }
    }
    // selections the server refused: remember the refusal's time so the same choice is not offered forever
    for (const x of (result.rejected || [])) {
      if (x.k === "cosmetics" && typeof x.id === "string" && x.id.indexOf(":") > 0) {
        const slot = x.id.split(":")[1], it = batchItems.find(i => i.k === "cosmetics");
        const at2 = it && it.payload && it.payload.selected && it.payload.selected[slot] ? it.payload.selected[slot].at : (it && it.payload.showcase ? it.payload.showcase.at : 0);
        if (at2) state.acked.profile[slot] = Math.max(state.acked.profile[slot] || 0, at2);
        addConflict("selection_refused", { slot, reason: x.reason || "not_owned" });
      }
    }
    return { removed, dead };
  }

  /* ---------------- applying remote data locally (between runs only) ---------------- */
  function pendingContributions() {
    const out = [];
    for (const it of state.outbox) {
      if (it.k === "baseline") out.push({ lifetime: it.payload.lifetime, byMode: it.payload.byMode });
      else if (it.k === "run" && it.payload.counted && it.payload.delta) { const o = { lifetime: it.payload.delta, byMode: {} }; o.byMode[it.payload.mode] = it.payload.delta; out.push(o); }
    }
    return out;
  }

  function applyRemote(data) {
    if (data.schema > SCHEMA) { addConflict("remote_newer_schema", { remote: data.schema, local: SCHEMA }); return { applied: false, reason: "remote_newer_schema" }; }
    const stats = deps.stats, ach = deps.ach;
    const sd = stats.getDiagnostics && stats.getDiagnostics();
    if (sd && sd.persistence && sd.persistence.readOnly) { addConflict("local_newer_schema", { item: "statistics" }); return { applied: false, reason: "local_newer_schema" }; }
    const ad = ach.getDiagnostics && ach.getDiagnostics();
    if (ad && ad.persistence && ad.persistence.readOnly) { addConflict("local_newer_schema", { item: "achievements" }); return { applied: false, reason: "local_newer_schema" }; }

    let changedSomething = false;
    /* achievements + rewards + choices */
    try {
      const A = ach.getSyncSnapshot();
      const rU = {}, rR = {};
      for (const x of data.achievements || []) if (x && typeof x.id === "string") rU[x.id] = { at: isNum(x.at) ? x.at : 0, runId: typeof x.run_id === "string" ? x.run_id : null, via: ["event", "stat", "backfill"].indexOf(x.via) >= 0 ? x.via : "event" };
      for (const x of data.rewards || []) if (x && typeof x.id === "string") rR[x.id] = { at: isNum(x.at) ? x.at : 0, by: typeof x.by === "string" ? x.by : "" };
      const u = M().unionEarliest(A.unlocked, rU), r = M().unionEarliest(A.rewards, rR);
      const rc = data.cosmetics || {}, remoteSel = { selected: {}, at: {} };
      for (const slot of M().SLOTS) { const e = rc.selected && rc.selected[slot]; if (e && isNum(e.at)) { remoteSel.selected[slot] = e.id == null ? null : e.id; remoteSel.at[slot] = e.at; } }
      const sel = M().mergeSelections({ selected: A.selected, at: A.selectedAt }, remoteSel, r.merged, ach.rewardType);
      const show = M().mergeShowcase({ ids: A.showcase, at: A.showcaseAt }, rc.showcase, u.merged, 5);
      for (const f of sel.refused) addConflict("selection_refused", f);
      if (show.refused) addConflict("selection_refused", { slot: "showcase", reason: "not_unlocked" });
      const before = JSON.stringify([A.unlocked, A.rewards, A.selected, A.selectedAt, A.showcase, A.showcaseAt]);
      const atClean = {}; for (const slot of Object.keys(sel.at)) if (sel.at[slot] > 0) atClean[slot] = sel.at[slot];   // zero = never chosen = absent
      const cand = { unlocked: u.merged, rewards: r.merged, selected: sel.selected, selectedAt: atClean, showcase: show.ids, showcaseAt: show.at };
      const after = JSON.stringify([cand.unlocked, cand.rewards, cand.selected, cand.selectedAt, cand.showcase, cand.showcaseAt]);
      if (before !== after) {
        const out = ach.applyMerged(cand);
        if (!out.ok) addConflict("achievement_merge_refused", { reason: out.reason }); else changedSomething = true;
      }
    } catch (err) { diag.appliedErrors++; addConflict("apply_error", { part: "achievements", message: String(err && err.message || err).slice(0, 160) }); }

    /* statistics */
    try {
      const local = stats.getSyncSnapshot();
      const composed = M().composeLifetime({ lifetime: data.lifetime, byMode: data.by_mode }, pendingContributions());
      const regressions = [];
      const lifetime = M().floorCounters(composed.lifetime, local.lifetime, "lifetime", regressions);
      const byMode = M().floorCounters(composed.byMode, local.byMode, "byMode", regressions);
      const runs = M().mergeRuns(local.recentRuns, data.runs, M().MAX_RECENT);
      if (regressions.length && state.baseline.status !== "skipped_lost_state") addConflict("local_ahead_of_remote", { fields: regressions.slice(0, 10), count: regressions.length });
      const before = JSON.stringify([local.lifetime, local.byMode, local.recentRuns]);
      const after = JSON.stringify([lifetime, byMode, runs]);
      if (before !== after) {
        const out = stats.restoreSnapshot({ createdAt: local.createdAt, lifetime, byMode, recentRuns: runs });
        if (!out.ok) { addConflict("statistics_merge_refused", { reason: out.reason }); return { applied: changedSomething, reason: out.reason }; }
        changedSomething = true;
      }
    } catch (err) { diag.appliedErrors++; addConflict("apply_error", { part: "statistics", message: String(err && err.message || err).slice(0, 160) }); }

    // what the server now has, so nothing it already holds is queued again
    for (const x of data.achievements || []) if (x && typeof x.id === "string") state.acked.ach[x.id] = isNum(x.at) ? x.at : 1;
    for (const x of data.rewards || []) if (x && typeof x.id === "string") state.acked.rewards[x.id] = isNum(x.at) ? x.at : 1;
    const rc2 = data.cosmetics || {};
    for (const slot of M().SLOTS) { const e = rc2.selected && rc2.selected[slot]; if (e && isNum(e.at)) state.acked.profile[slot] = Math.max(state.acked.profile[slot] || 0, e.at); }
    if (rc2.showcase && isNum(rc2.showcase.at)) state.acked.profile.showcase = Math.max(state.acked.profile.showcase || 0, rc2.showcase.at);
    if (changedSomething) diag.applied++;
    return { applied: changedSomething };
  }

  /* ---------------- accounts ---------------- */
  const archiveKey = (id) => ARCHIVE_PREFIX + id + ".v1";
  function archiveStore(id) { return ProgressionStore.create({ key: archiveKey(id), storage: deps.storage, now: deps.now }); }

  // -> { ok } | { ok:false, deferred } | { ok:false, reason }
  function ensureBinding(userId) {
    if (state.binding.userId === userId) return { ok: true };
    if (state.binding.userId === null) { state.binding = { userId, at: deps.now() }; persist(); return { ok: true, claimed: true }; }   // anonymous progress belongs to the first account that signs in
    if (deps.stats.hasActiveRun()) return { ok: false, deferred: "run_active" };
    return swapAccount(state.binding.userId, userId);
  }

  function swapAccount(fromId, toId) {
    // 1. keep everything of the previous account, including its unsent outbox. If this cannot be done, do not switch.
    const bundle = { stats: deps.stats.getSyncSnapshot(), ach: deps.ach.getSyncSnapshot(), sync: clone(state) };
    const out = archiveStore(fromId).save(bundle);
    if (!out.ok) { addConflict("account_switch_blocked", { reason: "archive_failed:" + (out.reason || "?"), from: "previous", to: "new" }); persist(); return { ok: false, reason: "archive_failed" }; }
    if (state.archives.indexOf(fromId) < 0) state.archives.push(fromId);
    // 2. the new account starts from its own archive, or from nothing
    const prior = archiveStore(toId).load();
    let next;
    if (prior.status === "ok" && prior.data && prior.data.sync) {
      deps.stats.restoreSnapshot(prior.data.stats); deps.ach.restoreSnapshot(prior.data.ach);
      next = hydrateState(prior.data.sync, deps.now()); next.deviceId = state.deviceId;
      next.archives = Array.from(new Set(state.archives.filter(x => x !== toId)));
    } else {
      if (prior.status === "corrupt") addConflict("archive_corrupt", { for: "new account" });
      const cs = deps.stats.clearForAccountSwitch(), ca = deps.ach.restoreSnapshot({});
      if (!cs.ok) { return { ok: false, deferred: cs.reason }; }
      next = freshState(state.deviceId, deps.now()); next.archives = state.archives.filter(x => x !== toId); next.conflicts = state.conflicts.slice(-5);
    }
    next.binding = { userId: toId, at: deps.now() };
    state = next; applyPending = true; diag.swaps++;
    // keep the archive count bounded; only an archive with nothing left to send may be dropped
    while (state.archives.length > MAX_ARCHIVES) {
      let dropped = false;
      for (let i = 0; i < state.archives.length; i++) {
        const id = state.archives[i], a = archiveStore(id).load();
        if (a.status === "ok" && a.data && a.data.sync && (!a.data.sync.outbox || a.data.sync.outbox.length === 0)) { state.archives.splice(i, 1); try { deps.storage && deps.storage.removeItem(archiveKey(id)); } catch (_) { /* ignore */ } dropped = true; break; }
      }
      if (!dropped) break;
    }
    persist();
    return { ok: true, swapped: true };
  }

  /* ---------------- the cycle ---------------- */
  const online = () => (deps.online ? deps.online() : true);

  async function cycle() {
    if (!initialized || !user) return { ok: false, skipped: "not_ready" };
    if (!online()) return { ok: false, skipped: "offline" };
    const bind = ensureBinding(user.id);
    if (!bind.ok) { deferred = bind.deferred || bind.reason; applyPending = true; return { ok: false, skipped: deferred }; }   // waits for the run to end (its finalization triggers a new cycle)
    deferred = null;
    diag.cycles++;
    let last = null;
    for (let i = 0; i < MAX_CYCLES; i++) {
      reconcileLocal();
      const batch = nextBatch();
      const ex = await exchange(batch);
      if (user === null) return { ok: false, skipped: "signed_out" };            // signed out while the request was in flight: this response is not applied
      if (!ex.ok) return fail(ex.res);
      const data = ex.res.data;
      if (data.schema != null && data.schema > SCHEMA) { addConflict("remote_newer_schema", { remote: data.schema, local: SCHEMA }); persist(); return success(data, true); }
      settle(batch, data);
      state.remote.version = isNum(data.version) ? data.version : state.remote.version;
      persist();
      last = data;
      if (state.outbox.length && nextBatch().length && batch.length === BATCH_SIZE) continue;     // more to send
      // between runs the state is applied; during a run only the sending happens
      if (!data.unchanged && !deps.stats.hasActiveRun()) { applyRemote(data); applyPending = false; persist(); }
      else if (!data.unchanged) applyPending = true;
      if (!reconcileLocal()) break;                                              // nothing new to send: done
    }
    return success(last, false);
  }

  function success(data, schemaBlocked) {
    state.backoff = { failures: 0, nextAt: 0 };
    state.remote.lastOkAt = deps.now(); diag.successes++; diag.lastOkAt = state.remote.lastOkAt; diag.lastError = null; diag.lastErrorKind = null;
    persist();
    return { ok: true, version: state.remote.version, schemaBlocked: !!schemaBlocked, pending: state.outbox.length };
  }
  function fail(res) {
    diag.failures++; diag.lastError = res.message || "error"; diag.lastErrorKind = res.kind || "unknown";
    state.backoff.failures++; state.backoff.nextAt = deps.now() + backoffDelayMs(res.kind);
    // a failed request leaves every outbox item exactly as it was: nothing is dropped, nothing is counted against it
    if (res.kind === "schema") addConflict("client_schema_newer_than_server", { message: res.message });
    persist();
    return { ok: false, kind: res.kind, retryable: res.retryable !== false, nextAttemptAt: state.backoff.nextAt };
  }

  /* ---------------- scheduling ---------------- */
  // One timer, one request at a time. A trigger while a request runs asks for one more pass afterwards.
  function schedule(delayMs, force) {
    if (!initialized || !user) return;
    const due = Math.max(deps.now() + delayMs, force ? 0 : state.backoff.nextAt);
    if (timer != null && timerAt <= due) return;
    if (timer != null) deps.clearTimer(timer);
    timerAt = due;
    timer = deps.setTimer(() => { timer = null; timerAt = 0; run("timer"); }, Math.max(0, due - deps.now()));
  }
  function trigger(reason) {
    if (!initialized || !user) return;
    if (running) { rerun = true; return; }
    const immediate = reason === "sign_in" || reason === "online" || reason === "manual";
    schedule(immediate ? 0 : DEBOUNCE_MS, reason === "manual");
  }
  function run(reason) {
    if (running) { rerun = true; return running; }
    running = (async () => {
      let out;
      try { out = await cycle(); }
      catch (err) { diag.failures++; diag.lastError = String(err && err.message || err).slice(0, 200); diag.lastErrorKind = "exception"; out = { ok: false, kind: "exception" }; try { state.backoff.failures++; state.backoff.nextAt = deps.now() + backoffDelayMs("server"); persist(); } catch (_) { /* ignore */ } }
      running = null;
      if (rerun && out && out.ok) { rerun = false; schedule(DEBOUNCE_MS, false); }
      else { rerun = false; if (out && !out.ok && out.kind && out.retryable !== false) schedule(Math.max(0, state.backoff.nextAt - deps.now()), false); else if (out && out.ok && state.outbox.length) schedule(DEBOUNCE_MS, false); }
      return out;
    })();
    return running;
  }

  /* ---------------- lifecycle ---------------- */
  function makeDeps(o) {
    const opt = o || {};
    return {
      stats: opt.stats || (typeof StatsSystem !== "undefined" ? StatsSystem : null),
      ach: opt.ach || (typeof AchievementSystem !== "undefined" ? AchievementSystem : null),
      remote: opt.remote || (typeof ProgressionRemote !== "undefined" ? ProgressionRemote.create() : null),
      storage: opt.storage === undefined ? (() => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; } })() : opt.storage,
      now: opt.now || (() => Date.now()),
      setTimer: opt.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearTimer: opt.clearTimer || ((t) => clearTimeout(t)),
      random: opt.random || Math.random,
      online: opt.online || (() => (typeof navigator === "undefined" || navigator.onLine !== false))
    };
  }

  // Phase 1 (before StatsSystem.initialize): load the sync state and start listening, so a run that is recovered during
  // StatsSystem's own start-up is not missed.
  function attach(options) {
    if (attached) detach();
    deps = makeDeps(options);
    if (!deps.stats || !deps.ach || !deps.remote) return { ok: false, reason: "missing_dependency" };
    store = deps.storage ? ProgressionStore.create({ key: KEY, storage: deps.storage, now: deps.now }) : null;
    const loaded = store ? store.load() : { status: "unavailable", data: null };
    loadStatus = loaded.status;
    state = loaded.data ? hydrateState(loaded.data, deps.now()) : freshState(null, deps.now());
    early = [];
    unsubs.push(deps.stats.onRunFinalized((c) => { if (initialized) enqueueRun(c); else early.push(c); }));
    attached = true;
    return { ok: true, loadStatus };
  }

  // Phase 2 (after StatsSystem and AchievementSystem initialized).
  function init() {
    if (!attached || initialized) return getStatus();
    try {
      const fresh = loadStatus === "empty" || loadStatus === "unavailable" || loadStatus === "none";
      const lost = loadStatus === "corrupt" || loadStatus === "newer_schema";
      if (fresh || lost) {
        createBaselineIfNeeded(loadStatus);                       // runs already folded into the totals (including a recovered one) are in the baseline
        early = [];
      } else {
        for (const c of early) enqueueRun(c);                      // state existed: a recovered run is a new contribution
        early = [];
      }
      initialized = true;
      reconcileLocal();
      persist();
      unsubs.push(deps.ach.onUnlock(() => { try { reconcileLocal(); trigger("unlock"); } catch (_) { diag.listenerErrors++; } }));
      unsubs.push(deps.ach.onChange(() => { try { reconcileLocal(); trigger("choice"); } catch (_) { diag.listenerErrors++; } }));
      wireEnvironment();
      if (pendingUser !== undefined) { const u = pendingUser; pendingUser = undefined; setUser(u && u.id ? u.id : null); }
    } catch (err) { diag.listenerErrors++; initialized = attached; }
    return getStatus();
  }

  function wireEnvironment() {
    if (envWired || typeof window === "undefined" || !window.addEventListener) return;
    envWired = true;
    window.addEventListener("online", () => trigger("online"));
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", () => {
      if (document.hidden || !initialized || !user) return;
      const stale = deps.now() - (state.remote.lastOkAt || 0) > STALE_REFRESH_MS;
      if (state.outbox.length || applyPending || stale) schedule(1000, false);
    });
  }

  // Called by AuthSystem whenever the session changes (sign-in, sign-out, token refresh). Cheap and idempotent.
  function setUser(userId) {
    if (!initialized) { pendingUser = userId ? { id: String(userId) } : null; return; }
    const next = userId ? { id: String(userId) } : null;
    if ((user && next && user.id === next.id) || (!user && !next)) { if (user && (state.outbox.length || applyPending)) trigger("refresh"); return; }
    user = next;
    if (!user) { if (timer != null) { deps.clearTimer(timer); timer = null; timerAt = 0; } return; }   // signed out: local play continues; nothing is cleared
    state.backoff = { failures: 0, nextAt: 0 };
    trigger("sign_in");
  }

  function syncNow() { if (!initialized || !user) return Promise.resolve({ ok: false, skipped: "not_ready" }); return run("manual"); }
  function flush() { if (!initialized) return { ok: false }; return persist(); }
  function detach() {
    for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
    unsubs = []; if (timer != null && deps) deps.clearTimer(timer); timer = null; timerAt = 0;
    attached = false; initialized = false; user = null; pendingUser = undefined; running = null; rerun = false; applyPending = false; deferred = null;
  }

  function getConflicts() { return clone(state ? state.conflicts : []); }
  function getDeadLetters() { return clone(state ? state.dead : []); }
  function getStatus() {
    if (!state) return { attached, initialized, enabled: false };
    return {
      attached, initialized, enabled: !!user, signedIn: !!user, bound: state.binding.userId !== null, deferred,
      inFlight: !!running, pending: outboxCounts(), pendingTotal: state.outbox.length, deadLetters: state.dead.length,
      baseline: clone(state.baseline), lastOkAt: state.remote.lastOkAt, remoteVersion: state.remote.version,
      failures: state.backoff.failures, nextAttemptAt: state.backoff.nextAt, lastError: diag.lastError, lastErrorKind: diag.lastErrorKind,
      conflicts: state.conflicts.length, archives: state.archives.length, loadStatus, counters: Object.assign({}, diag),
      persistence: store ? store.diagnostics() : null
    };
  }

  return {
    SCHEMA, KEY, ARCHIVE_PREFIX, attach, init, setUser, trigger, syncNow, flush, detach, getStatus, getConflicts, getDeadLetters,
    _state: () => state
  };
})();
