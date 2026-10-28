"use strict";

/* The Void — the cut between levels.
   An overlay, not a world. Shown before a level generates, held at least
   minHold seconds so a fast generate does not flash, then a resolve and hide. */
const VoidTransition = {
  minHold: 0.9,
  shownAt: 0,
  active: false,

  show(from, to) {
    const el = document.getElementById("void-overlay");
    if (!el) return;
    el.classList.remove("is-out");
    el.classList.add("is-on");
    el.setAttribute("aria-hidden", "false");
    const line = el.querySelector(".void-line");
    if (line) line.textContent = "THE VOID";
    this.shownAt = performance.now();
    this.active = true;
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement) document.exitPointerLock();
  },

  // Paint, then run the generate, then hold out the minimum.
  then(fn) {
    this.show();
    setTimeout(() => {
      try { fn(); }
      catch (err) { console.error("VOID TRANSITION FAILED", err); }
      this.finish();
    }, 40);
  },

  finish() {
    const wait = Math.max(0, this.minHold * 1000 - (performance.now() - this.shownAt));
    setTimeout(() => this.hide(), wait);
  },

  hide() {
    const el = document.getElementById("void-overlay");
    if (!el) { this.active = false; return; }
    el.classList.add("is-out");
    setTimeout(() => {
      el.classList.remove("is-on", "is-out");
      el.setAttribute("aria-hidden", "true");
      this.active = false;
      if (typeof renderer !== "undefined" && renderer && renderer.domElement && !DeviceMode.mobile) {
        renderer.domElement.requestPointerLock();
      }
    }, 460);
  }
};
