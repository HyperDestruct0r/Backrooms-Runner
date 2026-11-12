"use strict";

/* ------------------------------------------------------------------
   PROGRESSION STORE  (Pass 7 / Checkpoint 7A)

   Local persistence for progression data. It is deliberately its own key,
   separate from settings, key bindings and the graphics profile, and it never
   touches them. Nothing here talks to a server.

   Format on disk (one localStorage item):
     { format, schema, savedAt, sum, payload }
   `payload` is the data serialized once as a string; `sum` is a checksum of that
   exact string, so damage is detected without re-serializing.

   Safety rules:
   - a damaged item is never deleted or silently reset: its raw text is copied to
     a ".corrupt" backup key first, the diagnostics say so, and play continues
   - an item written by a NEWER schema is left alone (the store turns read-only), so an
     old cached build can never overwrite data a newer build understands
   - storage that is missing, blocked or full degrades to in-memory only; gameplay is unaffected
   ------------------------------------------------------------------ */
const ProgressionStore = (() => {
  const FORMAT = "backrooms-progression";
  const SCHEMA = 1;                                   // independent of the game version and of any save format
  const DEFAULT_KEY = "backroomsRunner.progression.v1";

  // FNV-1a, 32-bit: cheap, dependency free, enough to detect truncation and hand edits (not a security feature)
  function checksum(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, "0");
  }

  function defaultStorage() {
    try { return (typeof localStorage !== "undefined") ? localStorage : null; } catch (_) { return null; }
  }

  function create(options) {
    const o = options || {};
    const key = o.key || DEFAULT_KEY;
    const storage = o.storage === undefined ? defaultStorage() : o.storage;
    const now = o.now || (() => Date.now());
    const state = { readOnly: false, status: "new", lastError: null, lastSaveAt: 0, lastBytes: 0, corruptBackedUp: false, migratedFrom: null };

    function wrap(data) {
      const payload = JSON.stringify(data);
      const text = JSON.stringify({ format: FORMAT, schema: SCHEMA, savedAt: now(), sum: checksum(payload), payload });
      return { text, payload };
    }

    function backupCorrupt(raw, why) {
      state.lastError = why;
      try { storage.setItem(key + ".corrupt", raw); state.corruptBackedUp = true; }
      catch (e) { state.corruptBackedUp = false; state.lastError = why + " (backup failed: " + (e && e.message || e) + ")"; }
    }

    // -> { status, data, diagnostics }. status: empty | ok | migrated | corrupt | newer_schema | unavailable
    function load() {
      if (!storage) { state.status = "unavailable"; return { status: "unavailable", data: null, diagnostics: diagnostics() }; }
      let raw;
      try { raw = storage.getItem(key); }
      catch (e) { state.status = "unavailable"; state.lastError = String(e && e.message || e); return { status: "unavailable", data: null, diagnostics: diagnostics() }; }
      if (raw == null) { state.status = "empty"; return { status: "empty", data: null, diagnostics: diagnostics() }; }
      let env;
      try { env = JSON.parse(raw); } catch (_) { env = null; }
      if (!env || env.format !== FORMAT || typeof env.payload !== "string" || !Number.isInteger(env.schema)) {
        backupCorrupt(raw, "unreadable progression item"); state.status = "corrupt";
        return { status: "corrupt", data: null, diagnostics: diagnostics() };
      }
      if (env.schema > SCHEMA) {
        state.readOnly = true; state.status = "newer_schema"; state.lastError = "saved by schema " + env.schema + ", this build understands " + SCHEMA;
        return { status: "newer_schema", data: null, diagnostics: diagnostics() };
      }
      if (checksum(env.payload) !== env.sum) {
        backupCorrupt(raw, "checksum mismatch"); state.status = "corrupt";
        return { status: "corrupt", data: null, diagnostics: diagnostics() };
      }
      let data;
      try { data = JSON.parse(env.payload); } catch (_) { backupCorrupt(raw, "payload is not JSON"); state.status = "corrupt"; return { status: "corrupt", data: null, diagnostics: diagnostics() }; }
      if (env.schema < SCHEMA) { state.migratedFrom = env.schema; state.status = "migrated"; }   // no older schema exists yet; the hook is here for 7C
      else state.status = "ok";
      return { status: state.status, data, diagnostics: diagnostics() };
    }

    // -> { ok, bytes } or { ok:false, reason }
    function save(data) {
      if (state.readOnly) return { ok: false, reason: "read_only" };
      if (!storage) return { ok: false, reason: "unavailable" };
      let packed;
      try { packed = wrap(data); } catch (e) { state.lastError = String(e && e.message || e); return { ok: false, reason: "serialize" }; }
      try { storage.setItem(key, packed.text); }
      catch (e) { state.lastError = String(e && e.message || e); return { ok: false, reason: "write_failed" }; }
      state.lastSaveAt = now(); state.lastBytes = packed.text.length;
      return { ok: true, bytes: packed.text.length };
    }

    // Keep a copy of whatever is stored now under another key (used before an import replaces data).
    function backupCurrent(suffix) {
      if (!storage) return false;
      try { const raw = storage.getItem(key); if (raw == null) return false; storage.setItem(key + "." + suffix, raw); return true; } catch (_) { return false; }
    }
    function diagnostics() { return Object.assign({ key, schema: SCHEMA, hasStorage: !!storage }, state); }

    return { load, save, backupCurrent, diagnostics, key, get readOnly() { return state.readOnly; } };
  }

  return { FORMAT, SCHEMA, DEFAULT_KEY, checksum, create };
})();
