"use strict";

let scene, renderer;

const RunRecorder = {
  mediaRecorder: null,
  chunks: [],
  blob: null,
  stream: null,
  mimeType: "",
  recording: false,
  confirmMode: null,
  discarding: false,

  init(canvas) {
    this.canvas = canvas;
    this.supported = !!(window.MediaRecorder && canvas && canvas.captureStream);
  },

  confirmToggle() {
    if (!this.supported) {
      if (typeof HUD !== "undefined") HUD.toast("Run recording is not supported by this browser");
      return;
    }
    this.confirmMode = this.recording ? "stop" : "start";
    const title = document.getElementById("record-confirm-title");
    const text = document.getElementById("record-confirm-text");
    const yes = document.getElementById("record-confirm-yes");
    const no = document.getElementById("record-confirm-no");
    if (title) title.textContent = this.recording ? "Stop Recording?" : "Record Run?";
    if (text) text.textContent = this.recording ? "Stop recording this run?" : "Do you wish to record this run?";
    if (yes) yes.textContent = this.recording ? "Stop" : "Record";
    if (no) no.textContent = "Cancel";
    const overlay = document.getElementById("record-confirm-overlay");
    if (overlay) overlay.style.display = "flex";
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  },

  closeConfirm() {
    const overlay = document.getElementById("record-confirm-overlay");
    if (overlay) overlay.style.display = "none";
    this.confirmMode = null;
    if (GameState.phase === "playing" && renderer && renderer.domElement && !GameState.inventoryOpen && !Stairwell.sequenceActive) {
      setPauseOverlay(false);
      renderer.domElement.requestPointerLock();
    }
  },

  confirmYes() {
    const mode = this.confirmMode;
    this.closeConfirm();
    if (mode === "start") this.start();
    else if (mode === "stop") this.stop();
  },

  chooseMime() {
    const choices = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm"
    ];
    for (const type of choices) if (MediaRecorder.isTypeSupported(type)) return type;
    return "";
  },

  start() {
    if (this.recording || !this.supported) return false;
    this.chunks = []; this.blob = null; this.mimeType = this.chooseMime();
    try {
      this.stream = this.canvas.captureStream(30);
      this.mediaRecorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
      this.mediaRecorder.ondataavailable = e => { if (!this.discarding && e.data && e.data.size) this.chunks.push(e.data); };
      this.mediaRecorder.onstop = () => {
        const type = this.mimeType || "video/webm";
        if (!this.discarding) this.blob = new Blob(this.chunks, { type });
        else { this.blob = null; this.chunks = []; }
        this.discarding = false;
        this.recording = false;
        const indicator = document.getElementById("recording-indicator");
        if (indicator) indicator.classList.remove("is-recording");
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.mediaRecorder = null;
        this.updateButtons();
        if (this.exportAfterStop && this.blob) {
          this.exportAfterStop = false;
          this.export();
        }
      };
      this.mediaRecorder.start(1000);
      this.recording = true;
      const indicator = document.getElementById("recording-indicator");
      if (indicator) indicator.classList.add("is-recording");
      this.updateButtons();
      if (typeof HUD !== "undefined") HUD.toast("RECORDING STARTED");
      return true;
    } catch (err) {
      console.error("Could not start run recording:", err);
      this.mediaRecorder = null; this.stream = null; this.recording = false;
      if (typeof HUD !== "undefined") HUD.toast("Could not start run recording");
      return false;
    }
  },

  stop(discard=false) {
    if (!this.mediaRecorder) return;
    this.discarding = !!discard;
    if (discard) { this.chunks = []; this.blob = null; }
    try { this.mediaRecorder.stop(); } catch (_) {}
  },

  discard() {
    if (this.mediaRecorder) {
      const recorder = this.mediaRecorder;
      const stream = this.stream;
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { recorder.stop(); } catch (_) {}
      if (stream) stream.getTracks().forEach(t => t.stop());
      this.mediaRecorder = null;
      this.stream = null;
    }
    this.discarding = false;
    this.blob = null;
    this.chunks = [];
    this.recording = false;
    const indicator=document.getElementById("recording-indicator");
    if(indicator) indicator.classList.remove("is-recording");
    this.updateButtons();
  },

  export() {
    if (!this.blob) {
      if (this.recording) {
        this.exportAfterStop = true;
        this.stop();
      } else if (typeof HUD !== "undefined") HUD.toast("No recorded run available");
      return;
    }
    const url = URL.createObjectURL(this.blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url; a.download = "backrooms-run-" + stamp + ".webm";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  updateButtons() {
    const ids = ["pause-export", "complete-export", "gameover-export"];
    ids.forEach(id => { const el=document.getElementById(id); if(el) el.style.display=(this.blob || this.recording) ? "inline-block" : "none"; });
  },

  reset() { this.exportAfterStop = false; this.discard(); this.blob=null; this.chunks=[]; this.updateButtons(); }
};

const Game = {
  _nextFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); },
  _setBoot(progress, status) {
    const fill = document.getElementById("boot-fill");
    const pct = document.getElementById("boot-percent");
    const st = document.getElementById("boot-status");
    if (fill) fill.style.width = Math.max(0, Math.min(100, progress)) + "%";
    if (pct) pct.textContent = Math.round(progress) + "%";
    if (st) st.textContent = status;
  },
  _setGameLoading(progress, status) {
    const fill = document.getElementById("game-load-fill");
    const pct = document.getElementById("game-load-percent");
    const st = document.getElementById("game-load-status");
    if (fill) fill.style.width = Math.max(0, Math.min(100, progress)) + "%";
    if (pct) pct.textContent = Math.round(progress) + "%";
    if (st) st.textContent = status;
  },
  async init() {
    const boot = document.getElementById("boot-loading");
    this._setBoot(4, "INITIALIZING RENDERER...");
    await this._nextFrame();
    initAssets();
    this._setBoot(12, "LOADING MATERIALS...");
    await this._nextFrame();
    scene = new THREE.Scene();
    LightingSystem.init(scene);
    this._setBoot(25, "SETTING UP LIGHTING...");
    await this._nextFrame();

    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(CONFIG.fogColor);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.16;
    document.body.appendChild(renderer.domElement);
    RunRecorder.init(renderer.domElement);

    CameraRig.init();
    scene.add(CameraRig.camera);
    this._setBoot(40, "INITIALIZING CAMERA...");
    await this._nextFrame();
    Flashlight.init();
    GameState.level = 0;
    GameState.seed = ((Date.now() ^ (Math.floor(Math.random() * 0x7fffffff))) >>> 0) || 483921;
    this._setBoot(52, "GENERATING LEVEL 0... BUILDING WORLD...");
    // Give the browser a frame to actually paint the loading screen before
    // entering the synchronous procedural-generation step. Generation is
    // CPU-bound, so without this frame the UI can appear frozen at 52%.
    await this._nextFrame();
    let level0Built = false;
    try {
      level0Built = !!Level.buildProcedural(scene, GameState.seed);
    } catch (err) {
      console.error("Level 0 generation exception:", err);
      level0Built = false;
    }
    if (!level0Built) {
      // One deterministic fallback attempt. This keeps a transient bad
      // procedural seed from producing a blank yellow page.
      const fallbackSeed = 483921;
      try {
        level0Built = !!Level.buildProcedural(scene, fallbackSeed);
      } catch (err) {
        console.error("Level 0 fallback generation exception:", err);
        level0Built = false;
      }
    }
    if (!level0Built) {
      const st = document.getElementById("boot-status");
      if (st) st.textContent = "LEVEL 0 GENERATION FAILED — PRESS G TO RETRY";
      throw new Error("Level 0 could not be generated after fallback attempts.");
    }
    this._setBoot(72, "BUILDING LEVEL 0 GEOMETRY...");
    await this._nextFrame();
    Player.resetToStart();
    this._setBoot(80, "PLACING EXIT AND NAVIGATION...");
    await this._nextFrame();
    HUD.init();
    AudioSystem.init();
    this._setBoot(94, "CALIBRATING ATMOSPHERE...");
    await this._nextFrame();

    renderer.domElement.addEventListener("click", () => {
      if (GameState.phase === "playing") renderer.domElement.requestPointerLock();
    });

    window.addEventListener("resize", () => {
      CameraRig.resize();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    if (typeof MenuSystem !== "undefined") MenuSystem.init();
    document.getElementById("btn-restart").addEventListener("click", () => this.restart());
    const pauseResume = document.getElementById("pause-resume");
    if (pauseResume) pauseResume.addEventListener("click", () => {
      if (GameState.phase === "playing" && renderer && renderer.domElement) {
        setPauseOverlay(false);
        renderer.domElement.requestPointerLock();
      }
    });
    const pauseLeave = document.getElementById("pause-leave");
    if (pauseLeave) pauseLeave.addEventListener("click", () => this.leaveRun());
    const pauseExport = document.getElementById("pause-export");
    if (pauseExport) pauseExport.addEventListener("click", () => RunRecorder.export());
    const completeExport = document.getElementById("complete-export");
    if (completeExport) completeExport.addEventListener("click", () => RunRecorder.export());
    const gameoverExport = document.getElementById("gameover-export");
    if (gameoverExport) gameoverExport.addEventListener("click", () => RunRecorder.export());
    const recYes = document.getElementById("record-confirm-yes");
    const recNo = document.getElementById("record-confirm-no");
    if (recYes) recYes.addEventListener("click", () => RunRecorder.confirmYes());
    if (recNo) recNo.addEventListener("click", () => RunRecorder.closeConfirm());
    const goBtn = document.getElementById("btn-gameover");
    if (goBtn) goBtn.addEventListener("click", () => this.restart());

    GameState.ready = true;
    GameState.lastTime = performance.now();
    this._setBoot(100, "READY");
    await this._nextFrame();
    if (boot) boot.style.display = "none";
    setPauseOverlay(false);
    if (typeof MenuSystem !== "undefined") MenuSystem.showMain();
    this.loop();
  },

  async start() {
    if (!GameState.ready || GameState.phase === "loading") return;
    const startOverlay = document.getElementById("start-overlay");
    const loadOverlay = document.getElementById("game-loading");
    GameState.phase = "loading";
    if (startOverlay) startOverlay.style.display = "none";
    setPauseOverlay(false);
    if (loadOverlay) loadOverlay.style.display = "flex";
    this._setGameLoading(8, "LOADING PLAYER STATE...");
    await this._nextFrame();
    this._setGameLoading(65, "INITIALIZING RUN...");
    await this._nextFrame();
    document.getElementById("complete-overlay").style.display = "none";
    const go = document.getElementById("gameover-overlay");
    if (go) go.style.display = "none";
    GameState.phase = "playing";
    RunRecorder.reset();
    GameState.elapsed = 0;
    GameState.levelTimes = { 0: 0, 1: 0 };
    GameState.distance = 0;
    Player.resetToStart();
    Checkpoints.respawn();
    AtmosphereSystem.reset();
    DarknessSystem.reset();
    EnvEventSystem.reset();
    EncounterManager.reset();
    Inventory.reset();
    Inventory.close();
    Flashlight.reset();
    GameState.exitReached = false;
    GameState.level = 0;
    GameState.cinematicCamera = false;
    if (typeof Level1 !== 'undefined') Level1.resetVisuals();
    this._setGameLoading(78, "STARTING ATMOSPHERE...");
    await this._nextFrame();
    AudioSystem.resume();
    AudioSystem.ambientHumStart();
    this._setGameLoading(100, "ENTERING LEVEL 0");
    // No artificial delay here: once the run is initialized, enter immediately.
    await this._nextFrame();
    if (loadOverlay) loadOverlay.style.display = "none";
    GameState.phase = "playing";
    renderer.domElement.requestPointerLock();
  },

  leaveRun() {
    if (GameState.phase !== "playing") return;

    RunRecorder.discard();
    // Abandoning a run deliberately does not call AuthSystem.recordRun().
    // The run is discarded when the player returns to the main menu.
    GameState.phase = "start";
    GameState.inventoryOpen = false;
    GameState.cinematicCamera = false;
    setPauseOverlay(false);
    clearInput();
    Inventory.close();

    if (document.pointerLockElement && document.exitPointerLock) {
      document.exitPointerLock();
    }

    const loadOverlay = document.getElementById("game-loading");
    if (loadOverlay) loadOverlay.style.display = "none";
    const completeOverlay = document.getElementById("complete-overlay");
    if (completeOverlay) completeOverlay.style.display = "none";
    const gameoverOverlay = document.getElementById("gameover-overlay");
    if (gameoverOverlay) gameoverOverlay.style.display = "none";

    if (typeof MenuSystem !== "undefined") MenuSystem.showMain();
  },

  restart() {
    document.getElementById("complete-overlay").style.display = "none";
    setPauseOverlay(false);
    this.start();
  },

  regenerate() {
    if (GameState.regenerating) return;
    GameState.regenerating = true;
    const next = (Math.imul((GameState.seed || 1) ^ 0x9E3779B9, 1664525) + 1013904223 + (performance.now() | 0)) >>> 0;
    const newSeed = next || 483921;
    let built = false;
    try {
      built = !!Level.buildProcedural(scene, newSeed);
    } catch (err) {
      console.error("Level 0 regeneration exception:", err);
      built = false;
    }
    if (!built) {
      GameState.regenerating = false;
      HUD.toast("Generation failed — keeping current layout");
      return;
    }
    GameState.seed = (LevelGenerator.last && LevelGenerator.last.seed) ? LevelGenerator.last.seed : newSeed;
    document.getElementById("start-overlay").style.display = "none";
    document.getElementById("complete-overlay").style.display = "none";
    const go = document.getElementById("gameover-overlay");
    if (go) go.style.display = "none";
    GameState.phase = "playing";
    GameState.elapsed = 0;
    GameState.levelTimes = { 0: 0, 1: 0 };
    GameState.distance = 0;
    Player.resetToStart();
    AtmosphereSystem.reset();
    DarknessSystem.reset();
    EnvEventSystem.reset();
    EncounterManager.reset();
    Inventory.reset();
    Inventory.close();
    Flashlight.reset();
    GameState.exitReached = false;
    GameState.level = 0;
    GameState.cinematicCamera = false;
    if (typeof Level1 !== 'undefined') Level1.resetVisuals();
    AudioSystem.resume();
    AudioSystem.ambientHumStart();
    GameState.regenerating = false;
    if (renderer && renderer.domElement) renderer.domElement.requestPointerLock();
  },

  complete() {
    if (GameState.phase !== "playing") return;
  
    GameState.phase = "complete";
    setPauseOverlay(false);
    if (RunRecorder.recording) RunRecorder.stop();
    document.exitPointerLock();
  
    document.getElementById("stat-time").textContent =
      HUD.formatTime(GameState.elapsed);
    document.getElementById("stat-dist").textContent =
      GameState.distance.toFixed(1) + " m";
  
    document.getElementById("complete-overlay").style.display = "flex";
    RunRecorder.updateButtons();
  
    // Save the completed run for signed-in users.
    if (typeof AuthSystem !== "undefined") {
      AuthSystem.recordRun({
        level: GameState.level,
        outcome: "complete",
        time: GameState.elapsed,
        distance: GameState.distance,
        seed: GameState.seed
      });
    }
  },
  
  gameOver() {
    if (GameState.phase !== "playing") return;
  
    GameState.phase = "complete";
    setPauseOverlay(false);
    if (RunRecorder.recording) RunRecorder.stop();
    document.exitPointerLock();
  
    const t = document.getElementById("go-time");
    const d = document.getElementById("go-dist");
  
    if (t) t.textContent = HUD.formatTime(GameState.elapsed);
    if (d) d.textContent = GameState.distance.toFixed(1) + " m";
  
    const el = document.getElementById("gameover-overlay");
    if (el) el.style.display = "flex";
    RunRecorder.updateButtons();
  
    // Save the failed run for signed-in users.
    if (typeof AuthSystem !== "undefined") {
      AuthSystem.recordRun({
        level: GameState.level,
        outcome: "game_over",
        time: GameState.elapsed,
        distance: GameState.distance,
        seed: GameState.seed
      });
    }
  },

  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - GameState.lastTime) / 1000;
    GameState.lastTime = now;
    if (dt > 0.05) dt = 0.05;

    if (GameState.phase === "playing" && Stairwell.sequenceActive) {
      GameState.elapsed += dt;
      if (GameState.level === 0) GameState.levelTimes[0] += dt;
      else if (GameState.level === 1) GameState.levelTimes[1] += dt;
      Stairwell.update(dt);
      CameraRig.update(dt);
    } else if (GameState.phase === "playing" && Input.locked) {
      GameState.elapsed += dt;
      if (GameState.level === 1 && Level1.active) {
        Level1.update(dt);
        GameState.levelTimes[1] = Level1.levelTime;
      } else if (GameState.level === 0) {
        GameState.levelTimes[0] += dt;
      }
      Player.update(dt);
      if (GameState.level === 1) {
        ChaseFx.update(dt);
        AudioSystem.setListener(Player.position, Player.yaw);
        CameraRig.update(dt);
      } else {
        EncounterManager.update(dt);
        EntitySystem.update(dt, Player);
        ChaseFx.update(dt);
        AtmosphereSystem.update(dt);
        EnvEventSystem.update(dt);
        DebugPath.update(dt);
        LightingSystem.update(dt);
        DarknessSystem.update(dt);
        AudioSystem.setListener(Player.position, Player.yaw);
        CameraRig.update(dt);
      }
    } else {
      CameraRig.update(0);
    }
    HUD.update();
    if (GameState.debug) {
      GameState._fpsN = (GameState._fpsN || 0) + 1;
      GameState._fpsT = (GameState._fpsT || 0) + dt;
      if (GameState._fpsT >= 0.4) {
        GameState.fps = GameState._fpsN / GameState._fpsT;
        GameState._fpsN = 0;
        GameState._fpsT = 0;
      }
    }
    renderer.render(scene, CameraRig.camera);
  }
};

window.addEventListener("load", () => Game.init());
