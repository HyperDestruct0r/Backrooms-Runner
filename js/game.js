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
  _newRunSeed() {
    return (typeof SeedSystem !== "undefined")
      ? SeedSystem.random()
      : ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0);
  },
  _restoreLevel0ForNewRun(seed, strictSeed) {
    // Level 1 replaces Level.group/colliders with its streaming world. A new
    // run must explicitly tear that world down and rebuild Level 0 before the
    // player is reset.
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level !== "undefined" && typeof Level.buildProcedural === "function") {
      const requestedSeed = (seed >>> 0);
      const built = !!Level.buildProcedural(scene, requestedSeed, { strictSeed: !!strictSeed });
      if (!built) {
        throw new Error(strictSeed
          ? "The selected seed could not generate a valid Level 0."
          : "Level 0 could not be generated from the selected random seed.");
      }
      GameState.seed = (LevelGenerator.last && LevelGenerator.last.seed != null)
        ? LevelGenerator.last.seed : requestedSeed;
    }
    GameState.level = 0;
    GameState.exitReached = false;
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
    renderer.toneMappingExposure = 1.28;
    document.body.appendChild(renderer.domElement);

    CameraRig.init();
    scene.add(CameraRig.camera);
    this._setBoot(40, "INITIALIZING CAMERA...");
    await this._nextFrame();
    Flashlight.init();
    // Do not choose or generate a run seed during boot. The main menu must
    // remain usable even if a particular seed later fails validation.
    GameState.level = 0;
    GameState.seed = 0;
    this._setBoot(72, "READYING MAIN MENU...");
    await this._nextFrame();
    this._setBoot(80, "PLACING EXIT AND NAVIGATION...");
    await this._nextFrame();
    HUD.init();
    AudioSystem.init();
    this._setBoot(94, "CALIBRATING ATMOSPHERE...");
    await this._nextFrame();

    renderer.domElement.addEventListener("click", () => {
      if (GameState.phase === "playing" && !DeviceMode.mobile) renderer.domElement.requestPointerLock();
    });
    if (typeof MobileControls !== "undefined") MobileControls.init();

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
        if (DeviceMode.mobile) Input.locked = true;
        else renderer.domElement.requestPointerLock();
      }
    });
    const pauseLeave = document.getElementById("pause-leave");
    if (pauseLeave) pauseLeave.addEventListener("click", () => this.leaveRun());
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

  async start(mode = "random", customSeed = null) {
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
    // Seed selection happens only after the player explicitly chooses
    // Random Seed or Custom Seed from the Play menu.
    const isCustom = mode === "custom";
    const selectedSeed = isCustom
      ? (customSeed >>> 0)
      : this._newRunSeed();

    try {
      this._restoreLevel0ForNewRun(selectedSeed, isCustom);
    } catch (err) {
      console.error("Could not generate Level 0 for new run:", err);
      GameState.phase = "start";
      if (loadOverlay) loadOverlay.style.display = "none";

      if (typeof MenuSystem !== "undefined") {
        if (isCustom) {
          MenuSystem.showPage("play-select");
          MenuSystem.showSeedError(
            "Seed " + selectedSeed + " failed to generate a valid Level 0. Try another seed."
          );
          const input = document.getElementById("custom-seed-input");
          if (input) {
            input.value = String(selectedSeed);
            input.focus();
            input.select();
          }
        } else {
          MenuSystem.showMain();
          HUD.toast("RANDOM SEED FAILED — CHOOSE RANDOM SEED TO TRY AGAIN");
        }
      }
      return;
    }
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
    this._setGameLoading(78, "STARTING ATMOSPHERE...");
    await this._nextFrame();
    AudioSystem.resume();
    AudioSystem.ambientHumStart();
    this._setGameLoading(100, "ENTERING LEVEL 0");
    // No artificial delay here: once the run is initialized, enter immediately.
    await this._nextFrame();
    if (loadOverlay) loadOverlay.style.display = "none";
    GameState.phase = "playing";
    if (DeviceMode.mobile) Input.locked = true;
    else renderer.domElement.requestPointerLock();
  },

  leaveRun() {
    if (GameState.phase !== "playing") return;

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

    // Fully tear down Level 1 when abandoning a run. This also invalidates
    // any deferred Level 1 load that may still be waiting on a setTimeout.
    if (typeof Stairwell !== "undefined" && Stairwell.cancelPendingTransition) {
      Stairwell.cancelPendingTransition();
    }
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level !== "undefined") {
      Level.colliders.length = 0;
      Level.triggers.length = 0;
      Level.group = null;
      Level.tiles = [];
      Level.cols = 0;
      Level.rows = 0;
      Level.worldMin.set(-Infinity, -2, -Infinity);
      Level.worldMax.set(Infinity, 8, Infinity);
      Level.startPos.set(0, 0, 0);
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
    if (DeviceMode.mobile) Input.locked = true;
    else if (renderer && renderer.domElement) renderer.domElement.requestPointerLock();
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
      else if (GameState.level === 1) GameState.levelTimes[1] += dt;
      Stairwell.update(dt);
      CameraRig.update(dt);
    } else if (GameState.phase === "playing" && (Input.locked || DeviceMode.mobile)) {
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
