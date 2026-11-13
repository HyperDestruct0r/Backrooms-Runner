"use strict";

/* ------------------------------------------------------------------
   PROGRESSION REMOTE  (Pass 7 / Checkpoint 7C)

   The only code that talks to Supabase for progression. It uses the EXISTING authenticated client (AuthSystem.client, created with the
   anon/publishable key; the user's session is attached by supabase-js). It never sees a service-role key and it never sends a user id:
   the database function reads the caller from the session (auth.uid()), and row level security does the rest.

   One call, one round trip: public.progression_sync(p_schema, p_batch, p_known_version) stores what is in the batch (idempotently) and
   returns the account's current progression, so a device never needs a second request to see the result of the first.

   Every failure is turned into { ok:false, kind, retryable, message }. This file never throws and never blocks the game: it is only
   ever called from ProgressionSync's asynchronous cycle.
   ------------------------------------------------------------------ */
const ProgressionRemote = (() => {
  const RPC = "progression_sync";
  const SCHEMA = 1;                          // the payload schema this build speaks
  const TIMEOUT_MS = 20000;

  // kind: network | timeout | auth | not_installed | schema | server | bad_response
  function classify(error) {
    const msg = String((error && (error.message || error.details || error.hint)) || error || "unknown error").slice(0, 300);
    const code = String((error && error.code) || ""), status = Number(error && error.status) || 0;
    if (status === 401 || status === 403 || /^PGRST30\d$/.test(code) || /JWT|not_authenticated|invalid claim/i.test(msg)) return { kind: "auth", retryable: false, message: msg };
    if (code === "PGRST202" || code === "42883" || /could not find the function|function .* does not exist/i.test(msg)) return { kind: "not_installed", retryable: true, message: msg };   // migrations not applied (yet)
    if (status === 0 || /fetch|network|offline|timeout|ECONN|ENOTFOUND|load failed/i.test(msg)) return { kind: "network", retryable: true, message: msg };
    if (status >= 500 || /^5/.test(code)) return { kind: "server", retryable: true, message: msg };
    if (status === 429) return { kind: "server", retryable: true, message: msg };
    return { kind: "server", retryable: status >= 500 || status === 0, message: msg };
  }

  // getClient: () => supabase client | null. Injected so tests can pass a mock and the game passes AuthSystem.client.
  function create(options) {
    const o = options || {};
    const getClient = o.getClient || (() => (typeof AuthSystem !== "undefined" ? AuthSystem.client : null));
    const timeoutMs = o.timeoutMs || TIMEOUT_MS;
    const setT = o.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearT = o.clearTimer || ((t) => clearTimeout(t));

    // batch: { items: [...] }  ->  { ok:true, data } | { ok:false, kind, retryable, message }
    async function sync(batch, knownVersion) {
      const client = getClient();
      if (!client || typeof client.rpc !== "function") return { ok: false, kind: "unavailable", retryable: true, message: "Supabase client is not available" };
      let timer = null;
      try {
        const call = Promise.resolve(client.rpc(RPC, { p_schema: SCHEMA, p_batch: batch || { items: [] }, p_known_version: knownVersion == null ? null : knownVersion }));
        const timeout = new Promise((_, rej) => { timer = setT(() => rej(new Error("timeout")), timeoutMs); });
        const res = await Promise.race([call, timeout]);
        if (timer != null) clearT(timer);
        if (res && res.error) { const c = classify(res.error); return Object.assign({ ok: false }, c); }
        const d = res && res.data;
        if (!d || typeof d !== "object") return { ok: false, kind: "bad_response", retryable: true, message: "empty response" };
        if (d.error) return { ok: false, kind: d.error === "client_schema_newer" || d.error === "server_schema_newer" ? "schema" : "server", retryable: false, message: String(d.error), data: d };
        return { ok: true, data: d };
      } catch (err) {
        if (timer != null) clearT(timer);
        const c = classify(err);
        return Object.assign({ ok: false }, c);
      }
    }
    return { sync };
  }

  return { RPC, SCHEMA, classify, create };
})();
