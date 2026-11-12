"use strict";

/* ------------------------------------------------------------------
   ACHIEVEMENT NOTIFICATIONS  (Pass 7 / Checkpoint 7B)

   A small, temporary "achievement unlocked" banner. Placeholder presentation only: the final badge art, animation and sound
   belong to Pass 7D.

   - Shown only for a real unlock (AchievementSystem.onUnlock fires once per unlock; duplicates never reach here).
   - pointer-events: none and no focus handling, so it can never block controls or input.
   - One banner at a time; further unlocks wait in a small queue. Beyond MAX_QUEUE the extras are summarised as "+N more"
     instead of growing without bound.
   - No per-frame work: two timers per banner.
   - The renderer is an adapter, so the queue logic is testable without a DOM.
   ------------------------------------------------------------------ */
const AchievementNotifier = (() => {
  const SHOW_MS = 4500, GAP_MS = 350, MAX_QUEUE = 6;
  const RARITY_LABEL = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", mythic: "Mythic" };

  function domAdapter() {
    let root = null, el = null;
    const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    function ensure() {
      if (root || typeof document === "undefined" || !document.body) return !!root;
      root = make("div", "ach-toast-root"); root.id = "achievement-toasts";
      root.setAttribute("role", "status"); root.setAttribute("aria-live", "polite");
      document.body.appendChild(root);
      return true;
    }
    return {
      show(n) {
        if (!ensure()) return;
        el = make("div", "ach-toast");
        el.setAttribute("data-rarity", n.rarity);
        el.appendChild(make("div", "ach-toast-icon", "\u2605"));                 // placeholder icon (final badge art is Pass 7D)
        const body = make("div", "ach-toast-body");
        body.appendChild(make("div", "ach-toast-head", n.summary ? "ACHIEVEMENTS UNLOCKED" : "ACHIEVEMENT UNLOCKED"));
        body.appendChild(make("div", "ach-toast-name", n.name));
        if (n.description) body.appendChild(make("div", "ach-toast-desc", n.description));
        if (n.rarityLabel) body.appendChild(make("div", "ach-toast-rarity", n.rarityLabel));
        el.appendChild(body); root.appendChild(el);
        requestAnimationFrameSafe(() => { if (el) el.classList.add("show"); });
      },
      hide() { const e = el; el = null; if (!e) return; e.classList.remove("show"); setTimeout(() => { if (e.parentNode) e.parentNode.removeChild(e); }, 300); }
    };
  }
  function requestAnimationFrameSafe(fn) { if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn); else fn(); }

  function create(options) {
    const o = options || {};
    const adapter = o.adapter || domAdapter();
    const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearTimer = o.clearTimer || ((t) => clearTimeout(t));
    const showMs = o.showMs || SHOW_MS, maxQueue = o.maxQueue || MAX_QUEUE;
    const queue = []; let overflow = 0, current = null, timer = null;
    const diag = { shown: 0, queued: 0, summarized: 0 };

    function toView(u) {
      return { id: u.id, name: u.name, description: u.description, rarity: u.rarity, rarityLabel: RARITY_LABEL[u.rarity] || "", rewards: (u.rewards || []).map(r => r.name) };
    }
    function next() {
      timer = null; current = null;
      let n = null;
      if (queue.length) n = queue.shift();
      else if (overflow > 0) { n = { id: null, summary: true, name: "+" + overflow + " more", description: "", rarity: "common", rarityLabel: "", rewards: [] }; diag.summarized += overflow; overflow = 0; }
      if (!n) return;
      current = n; diag.shown++;
      try { adapter.show(n); } catch (_) { /* a rendering problem must never reach gameplay */ }
      timer = setTimer(() => {
        try { adapter.hide(); } catch (_) { /* ignore */ }
        timer = setTimer(next, GAP_MS);
      }, showMs);
    }
    // u: the payload AchievementSystem passes to onUnlock listeners
    function push(u) {
      const v = toView(u);
      if (current === null && timer === null) { queue.push(v); next(); return; }
      if (queue.length >= maxQueue) { overflow++; return; }
      queue.push(v); diag.queued++;
    }
    function clear() { if (timer != null) clearTimer(timer); timer = null; queue.length = 0; overflow = 0; if (current) { try { adapter.hide(); } catch (_) {} } current = null; }
    return { push, clear, getState: () => ({ showing: current ? current.id || "summary" : null, queued: queue.length, overflow }), getDiagnostics: () => Object.assign({}, diag) };
  }

  let main = null, off = null;
  function init() {
    if (main) return main;
    main = create();
    if (typeof AchievementSystem !== "undefined") off = AchievementSystem.onUnlock((u) => main.push(u));
    return main;
  }
  function shutdown() { if (off) off(); off = null; if (main) main.clear(); main = null; }

  return { SHOW_MS, MAX_QUEUE, create, init, shutdown };
})();
