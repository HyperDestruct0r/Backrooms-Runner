"use strict";

/* ------------------------------------------------------------------
   PROGRESSION MERGE  (Pass 7 / Checkpoint 7C)

   Pure functions. No storage, no network, no clock, no game state. Everything the synchronization layer
   decides about combining two copies of progression lives here so it can be tested on its own.

   The rules (the SQL function public.progression_jsonb_add in supabase/progression-sync/002_functions.sql mirrors addCounters):
   - Lifetime statistics are SUMS of contributions, never "max of two totals". A contribution has an identity
     (a finalized run id, or one baseline id), so the same contribution can be added only once.
   - Personal records are the BEST value of each record (max). highestScore may be null (no score exists yet).
   - Unlocked achievements are a UNION. When both sides have one, the EARLIER unlock (and its metadata) is kept. Nothing is ever removed.
   - Owned rewards are a UNION, earliest grant kept.
   - Run history is a UNION by run id, newest first, at most 50.
   - A cosmetic selection is last-write-wins PER SLOT on the time of the intentional selection, and only an owned reward can win.
   ------------------------------------------------------------------ */
const ProgressionMerge = (() => {
  const MAX_RECENT = 50;
  const SLOTS = ["title", "emblem", "nameplate", "decoration"];
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  /* ---------------- counters ---------------- */
  // a + b. Numeric leaves are summed, except below a key called "records", where the larger one wins. null/absent = nothing.
  // A type mismatch keeps `a`: a malformed value never throws and never destroys a good one.
  function addCounters(a, b, inRecords) {
    if (b === undefined || b === null) return clone(a === undefined ? null : a);
    if (a === undefined || a === null) return clone(b);
    if (isNum(a) && isNum(b)) return inRecords ? Math.max(a, b) : a + b;
    if (isObj(a) && isObj(b)) {
      const out = clone(a);
      for (const k of Object.keys(b)) out[k] = addCounters(out[k], b[k], inRecords || k === "records");
      return out;
    }
    return clone(a);
  }

  // Per-field maximum, recursively. Used as a FLOOR so a merge can never lower a local total.
  // `regressions` (optional array) receives the paths where `floor` was higher than `candidate`.
  function floorCounters(candidate, floor, path, regressions) {
    if (floor === undefined || floor === null) return clone(candidate === undefined ? null : candidate);
    if (candidate === undefined || candidate === null) { if (isNum(floor) && floor > 0 && regressions) regressions.push(path || "(root)"); return clone(floor); }
    if (isNum(candidate) && isNum(floor)) {
      // the tolerance absorbs binary-float versus exact-decimal differences between this device's sums and the server's (about 1e-12)
      if (floor - candidate > 1e-6 * Math.max(1, Math.abs(floor))) { if (regressions) regressions.push(path || "(root)"); return floor; }
      return candidate;
    }
    if (isObj(candidate) && isObj(floor)) {
      const out = clone(candidate);
      for (const k of Object.keys(floor)) out[k] = floorCounters(out[k], floor[k], (path ? path + "." : "") + k, regressions);
      return out;
    }
    if (isNum(floor)) { if (regressions && floor > 0) regressions.push(path || "(root)"); return floor; }   // a malformed remote value (wrong type) never replaces a good local number
    return clone(candidate);
  }

  // The state a device should show: remote totals (every acknowledged contribution from every device) plus
  // the contributions this device has not yet had acknowledged. `pending` = [{ mode, lifetime, byMode }].
  function composeLifetime(remote, pending) {
    let lifetime = clone(remote && remote.lifetime) || {};
    let byMode = clone(remote && remote.byMode) || {};
    for (const p of pending || []) {
      if (p.lifetime) lifetime = addCounters(lifetime, p.lifetime, false);
      if (p.byMode) byMode = addCounters(byMode, p.byMode, false);
    }
    return { lifetime, byMode };
  }

  /* ---------------- runs ---------------- */
  const runOrder = (x, y) => (y.endedAt - x.endedAt) || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);   // newest first; id breaks ties the same way everywhere
  function mergeRuns(a, b, limit) {
    const byId = new Map();
    for (const list of [a || [], b || []]) for (const r of list) {
      if (!r || typeof r.id !== "string" || !r.id) continue;
      if (!byId.has(r.id)) byId.set(r.id, r);          // a finalized run never changes: either copy is the same run
    }
    const out = Array.from(byId.values()).sort(runOrder);
    return out.slice(0, limit == null ? MAX_RECENT : limit);
  }

  /* ---------------- achievements and rewards ---------------- */
  // maps id -> { at, ... }. The earlier unlock wins (its runId / via are kept). Returns { merged, added: ids new to `local` }.
  function unionEarliest(local, remote) {
    const merged = clone(local) || {}, added = [];
    for (const id of Object.keys(remote || {})) {
      const r = remote[id];
      if (!r || typeof r !== "object") continue;
      const l = merged[id];
      if (!l) { merged[id] = clone(r); added.push(id); }
      else if (isNum(r.at) && r.at > 0 && (!isNum(l.at) || l.at <= 0 || r.at < l.at)) merged[id] = clone(r);
    }
    return { merged, added };
  }

  /* ---------------- cosmetic selections ---------------- */
  // local / remote: { selected: { slot: id|null }, at: { slot: ms } }. owned: { rewardId: ... } after rewards were merged.
  // A slot's winner is the side with the later `at`. Ties keep local (the device the player is holding). A winning id that
  // is not an owned reward is refused (reported in `refused`) and the other side's value is kept.
  function mergeSelections(local, remote, owned, rewardType) {
    const selected = {}, at = {}, refused = [], changed = [];
    for (const slot of SLOTS) {
      const li = local && local.selected ? local.selected[slot] : null, la = local && local.at && isNum(local.at[slot]) ? local.at[slot] : 0;
      const ri = remote && remote.selected ? remote.selected[slot] : null, ra = remote && remote.at && isNum(remote.at[slot]) ? remote.at[slot] : 0;
      const okId = (id) => id === null || id === undefined || (!!owned[id] && (!rewardType || rewardType(id) === slot));
      let win = { id: li == null ? null : li, at: la };
      if (ra > la) {
        if (okId(ri)) { win = { id: ri == null ? null : ri, at: ra }; if ((ri == null ? null : ri) !== (li == null ? null : li)) changed.push(slot); }
        else refused.push({ slot, id: ri, reason: "not_owned" });
      }
      if (!okId(win.id)) { win = { id: null, at: win.at }; refused.push({ slot, id: win.id, reason: "not_owned_local" }); }
      selected[slot] = win.id; at[slot] = win.at;
    }
    return { selected, at, refused, changed };
  }

  // Showcase: an ordered list of up to 5 UNLOCKED achievement ids, last-write-wins as a whole.
  function mergeShowcase(local, remote, unlocked, max) {
    const lim = max || 5;
    const ok = (ids) => Array.isArray(ids) && ids.every(i => typeof i === "string" && unlocked[i]);
    const la = local && isNum(local.at) ? local.at : 0, ra = remote && isNum(remote.at) ? remote.at : 0;
    if (ra > la && remote && ok(remote.ids)) return { ids: remote.ids.slice(0, lim), at: ra, changed: true, refused: false };
    return { ids: ((local && local.ids) || []).filter(i => unlocked[i]).slice(0, lim), at: la, changed: false, refused: ra > la && !(remote && ok(remote.ids)) };
  }

  return { MAX_RECENT, SLOTS, addCounters, floorCounters, composeLifetime, mergeRuns, runOrder, unionEarliest, mergeSelections, mergeShowcase, clone };
})();
