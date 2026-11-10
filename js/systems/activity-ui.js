"use strict";

/* ------------------------------------------------------------------
   ACTIVITY UI
   Two small pieces of interface for the Activity System:
     - the floating interaction prompt  ("[E] ...")
     - the maintenance computer shell: casing, CRT screen, indicator
       lights, RESET / EXIT keys and the ENERGIZE breaker. An activity type
       draws itself inside the screen through its ui.mount(screen, host).
   Everything is created on first use and removed on close, so nothing
   lingers between visits: one overlay, one keydown listener while open.
   ------------------------------------------------------------------ */
const ActivityUI = {
  promptEl: null,
  overlay: null,
  _keyHandler: null,
  _ctrl: null,

  /* ---------------- prompt ---------------- */
  setPrompt(text, tone) {
    if (!this.promptEl) {
      if (!text) return;
      const el = document.createElement("div");
      el.id = "activity-prompt";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
      this.promptEl = el;
    }
    const el = this.promptEl;
    if (!text) { if (el.style.display !== "none") el.style.display = "none"; el._t = null; return; }
    if (el._t !== text) { el.textContent = text; el._t = text; }
    el.className = tone === "warn" ? "warn" : "";
    if (el.style.display !== "block") el.style.display = "block";
  },

  /* ---------------- maintenance computer ---------------- */
  // ctx: { system, instance, def, set, site }  ->  { close() }
  open(ctx) {
    this.close();
    const sys = ctx.system, inst = ctx.instance;
    const ov = document.createElement("div");
    ov.id = "activity-overlay";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-label", "Maintenance terminal");
    ov.style.display = "flex";
    const unit = (ctx.set && ctx.set.meta && ctx.set.meta.unit) || "000";
    const station = (ctx.site && ctx.site.label) || inst.id;
    ov.innerHTML =
      '<div class="mu">' +
        '<div class="mu-top">' +
          '<div class="mu-plate"><b>MAINT. TERMINAL MT-4</b><br>SERVICE LIFT ' + unit + ' · AUX POWER BUS</div>' +
          '<div class="mu-warn"><span>⚠ 480 V — AUTHORISED STAFF ONLY</span></div>' +
        '</div>' +
        '<div class="mu-bezel"><div class="mu-screen"><div class="mu-screen-inner"></div><div class="mu-scan"></div></div></div>' +
        '<div class="mu-panel">' +
          '<div class="mu-leds">' +
            '<div class="mu-led g on" data-led="pwr"><i></i>PWR</div>' +
            '<div class="mu-led a" data-led="load"><i></i>LOAD</div>' +
            '<div class="mu-led r" data-led="fault"><i></i>FAULT</div>' +
          '</div>' +
          '<div class="mu-spacer"></div>' +
          '<button type="button" class="mu-btn" data-act="reset">Reset</button>' +
          '<button type="button" class="mu-breaker" data-act="energize" aria-label="Energize (Enter)"><i></i></button>' +
          '<button type="button" class="mu-btn" data-act="exit">Exit (Esc)</button>' +
        '</div>' +
        '<div class="mu-tape">' + station + '</div>' +
      '</div>';
    document.body.appendChild(ov);
    this.overlay = ov;
    const screen = ov.querySelector(".mu-screen"), inner = ov.querySelector(".mu-screen-inner");
    const leds = {};
    ov.querySelectorAll("[data-led]").forEach(n => { leds[n.dataset.led] = n; });
    const breaker = ov.querySelector('[data-act="energize"]');

    const host = {
      instance: inst, params: inst.params, set: ctx.set, site: ctx.site, system: sys,
      setLed(name, on, blink) { const n = leds[name]; if (!n) return; n.classList.toggle("on", !!on); n.classList.toggle("blink", !!blink); },
      setFault(on) { screen.classList.toggle("fault", !!on); },
      setBreaker(state) { breaker.classList.toggle("armed", state === "armed"); breaker.classList.toggle("thrown", state === "thrown"); breaker.disabled = state === "disabled"; },
      shake() { ov.firstChild.classList.remove("mu-shake"); void ov.firstChild.offsetWidth; ov.firstChild.classList.add("mu-shake"); },
      submit(submission) { return sys.submit(inst.id, submission); },
      close() { sys.closeInterface(); }
    };
    const ctrl = ctx.def.ui.mount(inner, host) || {};
    this._ctrl = ctrl;

    ov.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-act]");
      if (!b) return;
      const a = b.dataset.act;
      if (a === "exit") host.close();
      else if (a === "reset" && ctrl.reset) ctrl.reset();
      else if (a === "energize" && ctrl.energize) ctrl.energize();
    });
    // Stop wheel/touch scrolling from leaking to the game canvas underneath.
    ov.addEventListener("contextmenu", (e) => e.preventDefault());

    this._keyHandler = (e) => {
      if (typeof isTextEntryTarget === "function" && isTextEntryTarget(e.target)) return;
      if (typeof DevCommands !== "undefined" && DevCommands.open) return;
      if (e.code === "Escape") { e.preventDefault(); e.stopPropagation(); host.close(); return; }
      if (e.repeat && e.code !== "ArrowUp" && e.code !== "ArrowDown" && e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;
      if (ctrl.onKey && ctrl.onKey(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("keydown", this._keyHandler, true);
    if (ctrl.focus) ctrl.focus();
    return { close: () => this.close() };
  },

  close() {
    if (this._keyHandler) { window.removeEventListener("keydown", this._keyHandler, true); this._keyHandler = null; }
    if (this._ctrl && this._ctrl.destroy) { try { this._ctrl.destroy(); } catch (e) { console.error(e); } }
    this._ctrl = null;
    if (this.overlay) { this.overlay.remove(); this.overlay = null; }
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ActivityUI };
