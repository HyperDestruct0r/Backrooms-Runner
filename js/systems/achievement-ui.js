"use strict";

/* ------------------------------------------------------------------
   ACHIEVEMENT & PROFILE UI  (Pass 7D)

   Presentation only. It reads what Pass 7A-7C already provide and changes nothing:
     AchievementSystem.getViews()      what a player-facing screen may show (a locked hidden achievement is only { hidden, key })
     AchievementSystem.getCompletion() unlocked / total / percent
     StatsSystem.getLifetimeStats() / getRecords()   the one statistics system
     AuthSystem.user / username()      existing account state (absent or signed out => "Guest")
     AchievementArt                    artwork file lookup (assets/achievements/)
   It never unlocks anything, never writes progression data, never talks to the network.

   Hidden achievements: a locked one arrives from getViews() without id, name, text, rarity, category or progress, so there is nothing
   here to leak. On top of that this file renders it as an inert tile (no button, no popup, no tooltip) with a generic label,
   and it is dropped from every filtered or searched view; the "Secrets" category is only offered once one has been unlocked.
   ------------------------------------------------------------------ */
const AchievementUI = (() => {
  const RARITY = {
    common: { label: "Common", rank: 1 }, uncommon: { label: "Uncommon", rank: 2 }, rare: { label: "Rare", rank: 3 },
    epic: { label: "Epic", rank: 4 }, legendary: { label: "Legendary", rank: 5 }, mythic: { label: "Mythic", rank: 6 }
  };
  const CATEGORY_LABEL = { exploration: "Exploration", survival: "Survival", entities: "Entities", items: "Items", activities: "Activities", collection: "Collection", secrets: "Secrets" };
  const CATEGORY_ORDER = ["exploration", "survival", "entities", "items", "activities", "collection", "secrets"];
  const ENTITY_LABEL = { smiler: "Smiler", hound: "Hound", entity: "Level 0 entity", mangled: "Mangled", beast: "Beast", watch: "The Watch" };
  const LOCK_SVG = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1zm-2 3.5a2 2 0 1 1 4 0V6H6z"/></svg>';

  const state = { category: "all", status: "all", query: "", openId: null, opener: null, ready: false, page: null };
  let els = {};

  /* ---------------- small helpers ---------------- */
  function h(tag, cls, text, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) for (const k of Object.keys(attrs)) e.setAttribute(k, attrs[k]);
    return e;
  }
  const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString();
  function fmtDistance(m) { m = Number(m) || 0; return m >= 1000 ? (Math.round(m / 100) / 10).toLocaleString() + " km" : Math.round(m).toLocaleString() + " m"; }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    if (hh > 0) return hh + "h " + String(mm).padStart(2, "0") + "m";
    if (mm > 0) return mm + "m " + String(ss).padStart(2, "0") + "s";
    return ss + "s";
  }
  const fmtDate = (t) => { try { return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch (_) { return ""; } };
  const clearGameplayInput = () => { try { if (typeof clearInput === "function") clearInput(); } catch (_) { /* never let UI affect input state handling */ } };

  // Unit-aware progress text. The unit comes from the catalog's metric (read only); the view only has numbers.
  function metricOf(id) {
    try { const d = AchievementCatalog.all.find(x => x.id === id); return d && d.when && d.when.metric ? d.when.metric : null; } catch (_) { return null; }
  }
  function fmtProgressValue(metric, v) {
    if (metric === "run.elapsed") return fmtDuration(v);
    if (metric === "run.distance" || metric === "lifetime.distance") return fmtDistance(v);
    return fmtInt(v);
  }

  /* ---------------- data access (guarded: a missing system shows a message, never throws into the menu) ---------------- */
  function getViews() { try { return AchievementSystem.getViews(); } catch (_) { return null; } }
  function getCompletion() { try { return AchievementSystem.getCompletion(); } catch (_) { return null; } }

  /* ---------------- filtering (pure; exported for tests) ----------------
     A locked hidden achievement appears only in the unfiltered grid (and "Locked" with no category/search) as an inert question-mark tile;
     any category or search removes it, so filtering and searching can never be used to probe for it. */
  function matches(v, f) {
    if (v.hidden && !v.id) return f.category === "all" && !f.query && f.status !== "unlocked";
    if (f.category !== "all" && v.category !== f.category) return false;
    if (f.status === "unlocked" && !v.unlocked) return false;
    if (f.status === "locked" && v.unlocked) return false;
    if (f.query) {
      const q = f.query.toLowerCase();
      if (String(v.name).toLowerCase().indexOf(q) < 0 && String(v.description).toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }
  function filterViews(views, f) { return views.filter(v => matches(v, f)); }
  // Categories that may be offered: only those of achievements the player may already see.
  function visibleCategories(views) {
    const seen = new Set();
    for (const v of views) if (v.id && v.category) seen.add(v.category);
    return CATEGORY_ORDER.filter(c => seen.has(c));
  }

  /* ---------------- badges ---------------- */
  function img(src, alt) {
    const i = h("img", "ach-art", null, { alt: alt || "", width: "96", height: "96", decoding: "async", draggable: "false" });
    i.addEventListener("error", () => { if (i.getAttribute("src") !== AchievementArt.FALLBACK) i.setAttribute("src", AchievementArt.FALLBACK); });
    i.setAttribute("src", src);
    return i;
  }
  function pips(rank) { const p = h("span", "ach-pips", null, { "aria-hidden": "true" }); for (let i = 0; i < rank; i++) p.appendChild(h("i")); return p; }

  // badge: rarity-coloured tile + artwork (+ Roman numeral for chains). `big` is the popup version.
  function makeBadge(v, big) {
    const unlocked = !!v.unlocked;
    const b = h("span", "ach-badge" + (big ? " ach-badge-big" : ""), null, { "data-rarity": v.rarity, "data-state": unlocked ? "unlocked" : "locked" });
    b.appendChild(img(AchievementArt.urlFor(v), ""));
    const numeral = AchievementArt.numeralFor(v);
    if (numeral) b.appendChild(h("span", "ach-num", numeral, { "aria-hidden": "true" }));
    b.appendChild(pips(RARITY[v.rarity] ? RARITY[v.rarity].rank : 1));
    const mark = h("span", "ach-mark", null, { "aria-hidden": "true" });
    if (unlocked) mark.textContent = "\u2713"; else mark.innerHTML = LOCK_SVG;      // LOCK_SVG is a constant, not data
    b.appendChild(mark);
    return b;
  }
  function makeTile(v) {
    if (v.hidden && !v.id) {                       // locked hidden: inert, generic, no popup, no tooltip
      const t = h("div", "ach-tile ach-tile-hidden", null, { "data-state": "hidden", role: "img", "aria-label": "Hidden achievement, locked" });
      const b = h("span", "ach-badge ach-badge-hidden", null, { "data-state": "hidden", "aria-hidden": "true" });
      b.appendChild(h("span", "ach-q", "?"));
      t.appendChild(b); t.appendChild(h("span", "ach-name", "???", { "aria-hidden": "true" }));
      return t;
    }
    const r = RARITY[v.rarity] || RARITY.common;
    const t = h("button", "ach-tile", null, { type: "button", "data-id": v.id, "data-state": v.unlocked ? "unlocked" : "locked", "data-rarity": v.rarity, "aria-haspopup": "dialog",
      "aria-label": v.name + ", " + r.label + ", " + (v.unlocked ? "unlocked" : "locked") });
    t.appendChild(makeBadge(v, false));
    t.appendChild(h("span", "ach-name", v.name, { "aria-hidden": "true" }));
    return t;
  }

  /* ---------------- grid ---------------- */
  function renderGrid() {
    const views = getViews();
    els.grid.textContent = "";
    if (!views) { els.count.textContent = "Achievements are unavailable right now."; return; }
    // keep the category list in step with what may be shown
    const cats = visibleCategories(views);
    if (state.category !== "all" && cats.indexOf(state.category) < 0) state.category = "all";
    els.cat.textContent = "";
    els.cat.appendChild(h("option", null, "All categories", { value: "all" }));
    for (const c of cats) els.cat.appendChild(h("option", null, CATEGORY_LABEL[c] || c, { value: c }));
    els.cat.value = state.category;

    const list = filterViews(views, state);
    const frag = document.createDocumentFragment();
    for (const v of list) { const li = h("li", "ach-cell"); li.appendChild(makeTile(v)); frag.appendChild(li); }
    els.grid.appendChild(frag);
    const anyFilter = state.category !== "all" || state.status !== "all" || !!state.query;
    els.count.textContent = list.length === 0 ? "No achievements match." : (anyFilter ? list.length + " shown" : list.length + " achievements");
    els.empty.hidden = list.length !== 0;
    const c = getCompletion();
    if (c && els.summary) els.summary.textContent = c.unlocked + " of " + c.total + " unlocked \u00b7 " + Math.round(c.percent) + "%";
  }

  function buildBrowser() {
    const root = document.getElementById("ach-browser-root");
    if (!root) return false;
    root.textContent = "";
    const controls = h("div", "ach-controls");
    const mk = (labelText, control) => { const l = h("label", "ach-field"); l.appendChild(h("span", null, labelText)); l.appendChild(control); return l; };
    els.cat = h("select", null, null, { id: "ach-filter-category" });
    els.status = h("select", null, null, { id: "ach-filter-status" });
    [["all", "All"], ["unlocked", "Unlocked"], ["locked", "Locked"]].forEach(([v, t]) => els.status.appendChild(h("option", null, t, { value: v })));
    els.search = h("input", null, null, { id: "ach-search", type: "search", placeholder: "Search achievements", autocomplete: "off", maxlength: "40", spellcheck: "false", "aria-label": "Search achievements" });
    controls.appendChild(mk("Category", els.cat)); controls.appendChild(mk("Show", els.status)); controls.appendChild(mk("Search", els.search));
    els.count = h("p", "ach-count", "", { role: "status", "aria-live": "polite" });
    els.grid = h("ul", "ach-grid", null, { role: "list", "aria-label": "Achievements" });
    els.empty = h("p", "ach-empty", "No achievements match. Try clearing the search or filters.");
    els.empty.hidden = true;
    root.append(controls, els.count, els.grid, els.empty);

    els.cat.addEventListener("change", () => { state.category = els.cat.value; renderGrid(); });
    els.status.addEventListener("change", () => { state.status = els.status.value; renderGrid(); });
    els.search.addEventListener("input", () => { state.query = els.search.value.trim().slice(0, 40); renderGrid(); });
    els.grid.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("button.ach-tile");
      if (t && els.grid.contains(t)) openPopup(t.getAttribute("data-id"), t);
    });
    els.grid.addEventListener("keydown", onGridKey);
    bindSpaceActivation(els.grid);
    els.summary = document.getElementById("ach-summary");
    return true;
  }

  // The game's global key handler cancels Space while no run is active, which also cancels a focused button's native Space-to-click.
  // So Space is activated explicitly here (once per press), and its keyup is suppressed so a browser that still clicks on keyup cannot double-activate.
  function bindSpaceActivation(scope) {
    scope.addEventListener("keydown", (e) => {
      if (e.code !== "Space") return;
      const b = e.target && e.target.closest && e.target.closest("button");
      if (!b || !scope.contains(b)) return;
      e.preventDefault();
      if (!e.repeat) b.click();
    });
    scope.addEventListener("keyup", (e) => { if (e.code === "Space" && e.target && e.target.closest && e.target.closest("button")) e.preventDefault(); });
  }

  // Arrow/Home/End move between achievement tiles (inert hidden tiles are not focusable, so they are skipped).
  function onGridKey(e) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (keys.indexOf(e.key) < 0) return;
    const tiles = Array.prototype.slice.call(els.grid.querySelectorAll("button.ach-tile"));
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    const top0 = tiles[0].getBoundingClientRect().top;
    const perRow = Math.max(1, tiles.filter(t => Math.abs(t.getBoundingClientRect().top - top0) < 4).length);
    let n = i;
    if (e.key === "ArrowRight") n = i + 1; else if (e.key === "ArrowLeft") n = i - 1;
    else if (e.key === "ArrowDown") n = i + perRow; else if (e.key === "ArrowUp") n = i - perRow;
    else if (e.key === "Home") n = 0; else if (e.key === "End") n = tiles.length - 1;
    n = Math.max(0, Math.min(tiles.length - 1, n));
    e.preventDefault();
    if (tiles[n]) tiles[n].focus();
  }

  /* ---------------- detail popup ---------------- */
  function buildPopup() {
    const host = document.getElementById("start-overlay") || document.body;
    const pop = h("div", "ach-popup", null, { id: "ach-popup", hidden: "" });
    const dlg = h("div", "ach-dialog", null, { role: "dialog", "aria-modal": "true", "aria-labelledby": "ach-dialog-title", tabindex: "-1" });
    els.title = h("h3", "ach-dialog-title", "", { id: "ach-dialog-title" });
    els.art = h("div", "ach-dialog-art");
    els.desc = h("p", "ach-dialog-desc");
    els.meta = h("dl", "ach-dialog-meta");
    els.close = h("button", "ach-close", "CLOSE", { type: "button", id: "ach-dialog-close" });
    dlg.append(els.title, els.art, els.desc, els.meta, els.close);
    pop.appendChild(dlg);
    host.appendChild(pop);
    els.pop = pop; els.dlg = dlg;
    els.close.addEventListener("click", () => closePopup());
    bindSpaceActivation(dlg);
    // click outside the dialog (on the backdrop) closes it
    pop.addEventListener("click", (e) => { if (e.target === pop) closePopup(); });
    // taps and drags inside the popup must never reach the game's swipe-look / pointer handlers on window
    ["pointerdown", "pointermove", "touchstart", "touchmove", "mousedown", "wheel"].forEach(ev => pop.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
    document.addEventListener("keydown", onPopupKey, true);
  }
  function metaRow(dl, k, v, cls) { const row = h("div", "ach-meta-row" + (cls ? " " + cls : "")); row.appendChild(h("dt", null, k)); const dd = h("dd"); if (typeof v === "string") dd.textContent = v; else dd.appendChild(v); row.appendChild(dd); dl.appendChild(row); return row; }

  function fillPopup(v) {
    els.title.textContent = v.name;
    els.art.textContent = ""; els.art.appendChild(makeBadge(v, true));
    els.desc.textContent = ""; els.meta.textContent = "";
    const prog = v.unlocked ? null : v.progress;
    const metric = metricOf(v.id);
    if (!v.unlocked && !prog) els.desc.appendChild(h("span", "ach-req-label", "Requirement"));
    els.desc.appendChild(document.createTextNode(v.description));
    metaRow(els.meta, "Rarity", (RARITY[v.rarity] || RARITY.common).label);
    metaRow(els.meta, "Status", v.unlocked ? "Unlocked" + (v.unlockedAt ? " \u00b7 " + fmtDate(v.unlockedAt) : "") : "Locked");
    if (prog) {
      const wrap = h("div", "ach-progress");
      const runScoped = metric && metric.indexOf("run.") === 0;
      wrap.appendChild(h("span", "ach-progress-text", fmtProgressValue(metric, prog.value) + " / " + fmtProgressValue(metric, prog.target)));
      const bar = h("span", "ach-bar", null, { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(prog.target), "aria-valuenow": String(Math.round(prog.value)), "aria-label": "Progress" });
      const fill = h("i"); fill.style.width = Math.max(0, Math.min(100, Math.round(prog.fraction * 100))) + "%"; bar.appendChild(fill); wrap.appendChild(bar);
      if (runScoped) wrap.appendChild(h("span", "ach-progress-note", "Best single run so far"));
      metaRow(els.meta, "Progress", wrap);
    }
  }

  function openPopup(id, opener) {
    const views = getViews();
    const v = views && views.find(x => x.id === id);
    if (!v || (v.hidden && !v.id)) return;               // never opens for a locked hidden achievement
    if (!els.pop) buildPopup();
    clearGameplayInput();
    state.openId = id; state.opener = opener || null;
    fillPopup(v);
    els.pop.hidden = false;
    setInert(true);
    els.dlg.scrollTop = 0;
    els.close.focus({ preventScroll: true });
  }
  function closePopup() {
    if (!els.pop || els.pop.hidden) return;
    els.pop.hidden = true;
    setInert(false);
    clearGameplayInput();
    const o = state.opener; state.openId = null; state.opener = null;
    if (o && document.contains(o)) { try { o.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
  }
  const isPopupOpen = () => !!(els.pop && !els.pop.hidden);
  function setInert(on) {
    const page = document.getElementById("menu-page-achievements");
    if (!page) return;
    if (on) page.setAttribute("inert", ""); else page.removeAttribute("inert");
  }
  function onPopupKey(e) {
    if (!isPopupOpen()) return;
    if (e.key === "Escape" || e.code === "Escape") { e.preventDefault(); e.stopPropagation(); closePopup(); return; }
    if (e.key === "Tab") {                                  // the only focusable control is Close: keep focus inside the dialog
      e.preventDefault(); e.stopPropagation(); els.close.focus();
    }
  }

  /* ---------------- profile ---------------- */
  function statRow(dl, k, v) { const d = h("div", "pf-stat"); d.appendChild(h("dt", null, k)); d.appendChild(h("dd", null, v)); dl.appendChild(d); }
  function renderProfile() {
    const root = document.getElementById("profile-root");
    if (!root) return;
    root.textContent = "";
    let signedIn = false, name = "Guest";
    try { if (typeof AuthSystem !== "undefined" && AuthSystem.user) { signedIn = true; name = AuthSystem.username() || "Player"; } } catch (_) { /* treat as guest */ }
    const head = h("div", "pf-head");
    head.appendChild(h("div", "pf-name", name));
    head.appendChild(h("div", "pf-sub", signedIn ? "Signed in" : "Not signed in \u00b7 progress is saved on this device"));
    root.appendChild(head);

    const c = getCompletion();
    const ach = h("section", "pf-card");
    ach.appendChild(h("h3", null, "ACHIEVEMENTS"));
    if (c) {
      ach.appendChild(h("div", "pf-big", c.unlocked + " / " + c.total + " unlocked"));
      const bar = h("span", "ach-bar", null, { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(c.percent)), "aria-label": "Achievement completion" });
      const fill = h("i"); fill.style.width = Math.min(100, c.percent) + "%"; bar.appendChild(fill); ach.appendChild(bar);
      ach.appendChild(h("div", "pf-sub", (Math.round(c.percent * 10) / 10) + "% complete"));
    } else ach.appendChild(h("div", "pf-sub", "Achievements are unavailable right now."));
    root.appendChild(ach);

    let life = null, rec = null;
    try { life = StatsSystem.getLifetimeStats(); rec = StatsSystem.getRecords(); } catch (_) { /* unavailable */ }
    const stats = h("section", "pf-card");
    stats.appendChild(h("h3", null, "STATISTICS"));
    if (life) {
      const dl = h("dl", "pf-stats");
      statRow(dl, "Total runs", fmtInt(life.runsFinalized));
      statRow(dl, "Total distance", fmtDistance(life.distance));
      statRow(dl, "Time survived", fmtDuration(life.timePlayed));
      statRow(dl, "Levels escaped", fmtInt(life.levelsEscaped));
      statRow(dl, "Entities defeated", fmtInt(life.entitiesDefeated));
      stats.appendChild(dl);
    } else stats.appendChild(h("div", "pf-sub", "Statistics are unavailable right now."));
    root.appendChild(stats);

    if (rec) {
      const rc = h("section", "pf-card");
      rc.appendChild(h("h3", null, "PERSONAL RECORDS"));
      const dl = h("dl", "pf-stats");
      statRow(dl, "Longest run", rec.longestRunSeconds > 0 ? fmtDuration(rec.longestRunSeconds) : "\u2014");
      statRow(dl, "Farthest run", rec.longestRunDistance > 0 ? fmtDistance(rec.longestRunDistance) : "\u2014");
      statRow(dl, "Most levels escaped in one run", rec.mostLevelsEscapedInRun > 0 ? fmtInt(rec.mostLevelsEscapedInRun) : "\u2014");
      statRow(dl, "Most visited level", rec.mostVisitedLevel ? "Level " + rec.mostVisitedLevel.level + " (" + fmtInt(rec.mostVisitedLevel.visits) + " visits)" : "\u2014");
      statRow(dl, "Most encountered entity", rec.mostEncounteredEntity ? (ENTITY_LABEL[rec.mostEncounteredEntity.entityType] || String(rec.mostEncounteredEntity.entityType)) + " (" + fmtInt(rec.mostEncounteredEntity.count) + ")" : "\u2014");
      rc.appendChild(dl);
      root.appendChild(rc);
    }
  }

  /* ---------------- opening pages from the menu ---------------- */
  function ensureReady() {
    if (state.ready) return true;
    if (!buildBrowser()) return false;
    buildPopup();
    state.ready = true;
    return true;
  }
  function open(page) {
    clearGameplayInput();
    if (page === "profile") { renderProfile(); }
    else { if (!ensureReady()) return; closePopup(); renderGrid(); }
    state.page = page;
    if (typeof MenuSystem !== "undefined") MenuSystem.showPage(page);
  }
  const openBrowser = () => open("achievements");
  const openProfile = () => open("profile");
  function reset() { state.category = "all"; state.status = "all"; state.query = ""; if (els.search) els.search.value = ""; if (els.status) els.status.value = "all"; }

  return { RARITY, CATEGORY_LABEL, matches, filterViews, visibleCategories, fmtDistance, fmtDuration, openBrowser, openProfile, openPopup, closePopup, isPopupOpen, renderGrid, renderProfile, reset, getState: () => Object.assign({}, state, { opener: null }) };
})();
