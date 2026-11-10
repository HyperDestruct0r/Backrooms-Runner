"use strict";

/* ------------------------------------------------------------------
   QUALITY
   Three profiles and a small dynamic-resolution governor. Desktop keeps exactly what it always had (High):
   pixel ratio 1, full fog distance, no resolution scaling. The profiles only change things that cost time on
   weak GPUs and CPUs:

                       high        medium      low
     pooled lights     24 (x1.07)  12 (x1.18)  6 (x1.30)   (the gain restores the light the dropped fixtures added)
     Level 0 fog far   175 m       155 m       125 m     (nearer fog = fewer chunks to draw and keep)
     chunk build work  8 ms/frame  5 ms/frame  3 ms/frame
     render scale      1.0         0.9..1.0    0.6..0.85 (the governor lowers it when frames run long)

   "Auto" picks High on a desktop pointer, Medium on a phone or tablet, and Low on a phone that reports little
   memory or few cores. The choice can be overridden in Settings; it is remembered (localStorage).
   Pure state + a few DOM hooks: the logic below is exercised by tests/perf/quality.js without a GPU.
   ------------------------------------------------------------------ */
const Quality = {
  KEY: "backroomsRunner.quality.v1",
  PROFILES: {
    high:   { poolSize: 24, poolGain: 1.07, fogFar: 175, fogNear: 58, cameraFar: 180, meshBudgetMs: 8, scaleMax: 1.0, scaleMin: 1.0, dynamic: false },
    medium: { poolSize: 12, poolGain: 1.18, fogFar: 155, fogNear: 52, cameraFar: 160, meshBudgetMs: 5, scaleMax: 1.0, scaleMin: 0.75, dynamic: true },
    low:    { poolSize: 6,  poolGain: 1.30, fogFar: 125, fogNear: 42, cameraFar: 130, meshBudgetMs: 3, scaleMax: 0.85, scaleMin: 0.55, dynamic: true }
  },
  mode: "auto",          // auto | high | medium | low
  name: "high",          // the profile in force
  scale: 1,              // current render scale (governor)
  _acc: 0, _n: 0, _slow: 0, _fast: 0, _cool: 0,
  targetMs: { medium: 22, low: 36 },   // average frame time the governor tries to stay under

  get profile() { return this.PROFILES[this.name]; },

  detect(env) {
    env = env || {};
    const nav = env.navigator || (typeof navigator !== "undefined" ? navigator : {});
    const mobile = env.mobile != null ? env.mobile : !!(typeof DeviceMode !== "undefined" && DeviceMode.mobile);
    if (!mobile) return "high";
    const mem = nav.deviceMemory, cores = nav.hardwareConcurrency;
    if ((mem && mem <= 3) || (cores && cores <= 4)) return "low";
    return "medium";
  },

  load() {
    try { const v = localStorage.getItem(this.KEY); if (v === "auto" || this.PROFILES[v]) this.mode = v; } catch (_) {}
  },
  save() { try { localStorage.setItem(this.KEY, this.mode); } catch (_) {} },

  setMode(mode, env) {
    if (mode !== "auto" && !this.PROFILES[mode]) mode = "auto";
    this.mode = mode;
    this.save();
    this.apply(env);
  },

  // Applies the profile in force to everything that reads it.
  apply(env) {
    this.name = this.mode === "auto" ? this.detect(env) : this.mode;
    const p = this.profile;
    this.scale = p.scaleMax;
    this._acc = this._n = this._slow = this._fast = 0; this._cool = 2;
    if (typeof LightingSystem !== "undefined") { LightingSystem.poolGain = p.poolGain; LightingSystem.setPoolSize(p.poolSize); }
    if (typeof Level !== "undefined") Level.meshBudgetMs = p.meshBudgetMs;
    this.applyRenderer();
    this.applyLevel0Live();
    this.syncUI();
  },

  // A profile change in the middle of a Level 0 run must take effect now, not at the next build: update the live fog
  // and the camera far plane. Other levels keep their own fog and far plane.
  applyLevel0Live() {
    if (typeof GameState === "undefined" || GameState.level !== 0 || typeof Level === "undefined" || !Level.world) return;
    const p = this.profile;
    if (typeof scene !== "undefined" && scene && scene.fog) { scene.fog.near = p.fogNear; scene.fog.far = p.fogFar; }
    if (typeof CameraRig !== "undefined" && CameraRig.camera) { CameraRig.camera.far = p.cameraFar; if (CameraRig.camera.updateProjectionMatrix) CameraRig.camera.updateProjectionMatrix(); }
  },

  // Fog distances for Level 0 (the other levels keep their own).
  level0Fog() { const p = this.profile; return { near: p.fogNear, far: p.fogFar }; },

  applyRenderer() {
    if (typeof renderer === "undefined" || !renderer || !renderer.setPixelRatio) return;
    const want = Math.round(this.scale * 100) / 100;
    if (this._appliedScale !== want) {
      this._appliedScale = want;
      renderer.setPixelRatio(want);
      if (typeof window !== "undefined") renderer.setSize(window.innerWidth, window.innerHeight);
    }
  },

  // Called once per frame with the real frame time in milliseconds (before any clamping).
  frame(ms) {
    const p = this.profile;
    if (!p || !p.dynamic) return;
    if (typeof GameState !== "undefined" && GameState.phase !== "playing") return;
    if (ms > 250) return;                         // a tab switch or a load, not a measure of speed
    this._acc += ms; this._n++;
    if (this._acc < 1000) return;                 // one decision per second of play
    const avg = this._acc / this._n;
    this._acc = 0; this._n = 0;
    if (this._cool > 0) { this._cool--; return; }
    const target = this.targetMs[this.name] || 33;
    if (avg > target * 1.15) { this._slow++; this._fast = 0; }
    else if (avg < target * 0.7) { this._fast++; this._slow = 0; }
    else { this._slow = 0; this._fast = 0; }
    let next = this.scale;
    if (this._slow >= 2) { next = Math.max(p.scaleMin, this.scale - 0.1); this._slow = 0; }
    else if (this._fast >= 6) { next = Math.min(p.scaleMax, this.scale + 0.05); this._fast = 0; }
    if (Math.abs(next - this.scale) > 1e-6) { this.scale = next; this._cool = 2; this.applyRenderer(); }
  },

  /* ---- Settings UI: one small selector, added next to "Show FPS" in both settings panels ---- */
  initUI() {
    if (typeof document === "undefined") return;
    for (const id of ["setting-show-fps", "run-setting-show-fps"]) {
      const anchor = document.getElementById(id);
      if (!anchor) continue;
      const card = anchor.closest ? anchor.closest(".setting-card, .run-menu-row, .run-setting, div") : anchor.parentNode;
      if (!card || !card.parentNode) continue;
      const wrap = document.createElement("div");
      wrap.className = card.className;
      wrap.innerHTML = '<div class="switch"><span>GRAPHICS</span><select class="quality-select" aria-label="Graphics quality">' +
        '<option value="auto">Auto</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>' +
        '<div class="setting-note">Auto picks High on desktop and Medium or Low on phones. Lower settings draw less far, use fewer lights and may lower the render resolution when the game runs slowly.</div>';
      card.parentNode.insertBefore(wrap, card.nextSibling);
      const sel = wrap.querySelector("select");
      sel.value = this.mode;
      sel.addEventListener("change", () => this.setMode(sel.value));
    }
  },
  syncUI() {
    if (typeof document === "undefined" || !document.querySelectorAll) return;
    document.querySelectorAll(".quality-select").forEach((s) => { if (s.value !== this.mode) s.value = this.mode; });
  },

  init() {
    this.load();
    this.apply();
    this.initUI();
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { Quality };
