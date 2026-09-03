"use strict";

let scene, renderer;

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
    renderer.toneMappingExposure = 1.05;
    document.body.appendChild(renderer.domElement);

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

    document.getElementById("btn-restart").addEventListener("click", () => this.restart());
    const pauseResume = document.getElementById("pause-resume");
    if (pauseResume) pauseResume.addEventListener("click", () => {
      if (GameState.phase === "playing" && renderer && renderer.domElement) {
        setPauseOverlay(false);
        renderer.domElement.requestPointerLock();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Enter" || e.repeat) return;
    
      // Never let authentication/UI input start the game.
      const authModal = document.getElementById("auth-modal");
      if (authModal && getComputedStyle(authModal).display !== "none") {
        return;
      }
    
      // Don't let Enter from text fields/forms trigger game start.
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement ||
        target instanceof HTMLFormElement
      ) {
        return;
      }
    
      if (
        GameState.ready &&
        GameState.phase === "start" &&
        typeof MenuSystem !== "undefined" &&
        MenuSystem.isMainOpen()
      ) {
        e.preventDefault();
        MenuSystem.activateSelected();
      }
    });
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
    const loadOverlay = document.getElementById("game-loading");
    GameState.phase = "loading";
    if (typeof MenuSystem !== "undefined") MenuSystem.hide();
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
    if (typeof MenuSystem !== "undefined") MenuSystem.hide();
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
    document.exitPointerLock();
  
    document.getElementById("stat-time").textContent =
      HUD.formatTime(GameState.elapsed);
    document.getElementById("stat-dist").textContent =
      GameState.distance.toFixed(1) + " m";
  
    document.getElementById("complete-overlay").style.display = "flex";
  
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
    document.exitPointerLock();
  
    const t = document.getElementById("go-time");
    const d = document.getElementById("go-dist");
  
    if (t) t.textContent = HUD.formatTime(GameState.elapsed);
    if (d) d.textContent = GameState.distance.toFixed(1) + " m";
  
    const el = document.getElementById("gameover-overlay");
    if (el) el.style.display = "flex";
  
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
      else GameState.levelTimes[GameState.level] = (GameState.levelTimes[GameState.level] || 0) + dt;
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
