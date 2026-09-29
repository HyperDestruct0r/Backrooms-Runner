"use strict";

/* ------------------------------------------------------------------
   TUTORIAL / TRAINING SIMULATION
   Uses the real Level 0, player, inventory, flashlight, HUD, lighting,
   and entity rendering systems, but suppresses run-ending hazards.
   ------------------------------------------------------------------ */
const TutorialSystem = {
  active: false,
  stage: 0,
  startedAt: 0,
  stageStartedAt: 0,
  lookSeen: false,
  moveSeen: false,
  sprintSeen: false,
  crouchSeen: false,
  jumpSeen: false,
  flashSeen: false,
  inventorySeen: false,
  drinkSeen: false,
  sanityDemoT: 0,
  lightDemoT: 0,
  lightSnapshot: null,
  entityDemoSpawned: false,
  lastYaw: null,

  stages: [
    { title: "WELCOME TO THE TRAINING SIMULATION", text: "This is a safe copy of the Backrooms. Your normal run cannot be lost here. We will walk through the game's systems one at a time.", next: "BEGIN TRAINING" },
    { title: "MOVEMENT AND LOOKING", text: "Move with W A S D. Look with the mouse, right joystick, or swipe mode. Try moving and looking around this room.", next: "CONTINUE" },
    { title: "SPRINT, CROUCH, AND JUMP", text: "Sprint to move faster and spend stamina. Crouch changes your movement profile. Jump lets you clear small obstacles. Try each one.", next: "CONTINUE" },
    { title: "FLASHLIGHT", text: "The flashlight is your main tool for seeing in darkness. Toggle it, look into the darker areas, then toggle it again.", next: "CONTINUE" },
    { title: "THE HUD", text: "Health is your survivability. Stamina powers sprinting. Sanity represents your mental state. The timer tracks this run and the distance counter tracks how far you travel.", next: "CONTINUE" },
    { title: "INVENTORY", text: "Open the inventory to inspect carried items. Almond Water restores sanity. Your normal carry limit is shown in the inventory.", next: "CONTINUE" },
    { title: "ALMOND WATER", text: "For this lesson, the simulation has given you one bottle and lowered your sanity. Open the inventory and drink it.", next: "CONTINUE" },
    { title: "SANITY EFFECTS", text: "Sanity normally falls slowly, but dangerous situations can accelerate the drain. Low sanity can cause visual and atmospheric anomalies. The simulation will demonstrate the idea safely.", next: "CONTINUE" },
    { title: "THE ENTITY", text: "The entity can hear and see you, pursue you, and eventually catch you. In a real run, contact is dangerous. Here it is only a controlled demonstration.", next: "CONTINUE" },
    { title: "LIGHTS-OUT", text: "Some events can change the lighting and visibility of the Backrooms. During lights-out, darkness becomes much more important and the flashlight becomes especially valuable.", next: "CONTINUE" },
    { title: "EXITS AND PROCEDURAL GENERATION", text: "The Backrooms are generated from a seed. Layouts can contain different architectural regions, and exits are placed far from the starting area. Use the written manual for the deeper generation details.", next: "FINISH" },
    { title: "TRAINING COMPLETE", text: "You have completed the interactive tour. The manual remains available whenever you need a refresher. Good luck out there.", next: "EXIT TRAINING" }
  ],

  init() {
    const next = document.getElementById("tutorial-next");
    if (next) next.addEventListener("click", () => this.advance());
    const exit = document.getElementById("tutorial-exit");
    if (exit) exit.addEventListener("click", () => this.exit());
    window.addEventListener("keydown", e => {
      if (!this.active) return;
      if (e.code === "Enter" && !GameState.inventoryOpen) { e.preventDefault(); this.advance(); }
    }, true);
  },

  openHub() {
    if (typeof MenuSystem !== "undefined") MenuSystem.showPage("tutorial");
  },

  openManual() {
    if (typeof MenuSystem !== "undefined") MenuSystem.showPage("tutorial-manual");
  },

  start() {
    if (this.active) return;
    this.active = true;
    this.stage = 0;
    this.startedAt = performance.now();
    this.stageStartedAt = this.startedAt;
    this.lookSeen = this.moveSeen = false;
    this.sprintSeen = this.crouchSeen = this.jumpSeen = false;
    this.flashSeen = this.inventorySeen = this.drinkSeen = false;
    this.sanityDemoT = 0;
    this.lightDemoT = 0;
    this.entityDemoSpawned = false;
    this.lightSnapshot = null;
    this.lastYaw = null;
    const overlay = document.getElementById("tutorial-overlay");
    if (overlay) overlay.style.display = "flex";
    this.renderStage();
    if (typeof HUD !== "undefined") HUD.toast("TRAINING SIMULATION");
  },

  renderStage() {
    const s = this.stages[this.stage];
    const title = document.getElementById("tutorial-title");
    const text = document.getElementById("tutorial-text");
    const next = document.getElementById("tutorial-next");
    const count = document.getElementById("tutorial-count");
    const progress = document.getElementById("tutorial-progress-fill");
    const hint = document.getElementById("tutorial-hint");
    if (title) title.textContent = s.title;
    if (text) text.textContent = s.text;
    if (next) next.textContent = s.next;
    if (count) count.textContent = "LESSON " + (this.stage + 1) + " / " + this.stages.length;
    if (progress) progress.style.width = (((this.stage + 1) / this.stages.length) * 100).toFixed(1) + "%";
    if (hint) hint.textContent = this.stageHint();
    this.stageStartedAt = performance.now();
    this.prepareStage();
  },

  keyLabel(action) {
    const code = CONFIG.keys[action];
    if (!code) return "UNBOUND";
    const special = {
      Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT",
      ControlLeft: "CTRL", ControlRight: "CTRL",
      ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      Escape: "ESC", Backspace: "BACKSPACE", Delete: "DELETE", Enter: "ENTER"
    };
    if (special[code]) return special[code];
    if (code.startsWith("Key")) return code.slice(3).toUpperCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "NUM " + code.slice(6);
    return code.replace(/Left|Right/g, "").toUpperCase();
  },

  stageHint() {
    const k = a => this.keyLabel(a);
    switch (this.stage) {
      case 1: return `MOVE: ${k("forward")} ${k("backward")} ${k("left")} ${k("right")}  •  LOOK: mouse / touch`;
      case 2: return `SPRINT: ${k("sprint")}  •  CROUCH: ${k("crouch")}  •  JUMP: ${k("jump")}`;
      case 3: return `FLASHLIGHT: ${k("flashlight")}`;
      case 5: return `INVENTORY: ${k("inventory")}`;
      case 6: return `DRINK ALMOND WATER: ${k("drink")}`;
      case 8: return `The entity demonstration is ahead. LOOK toward it.`;
      case 9: return `FLASHLIGHT: ${k("flashlight")}  •  MOUSE UNLOCK: ${k("unlockMouse")}`;
      default: return "You can continue when ready.";
    }
  },
  prepareStage() {
    if (this.stage === 6) {
      Inventory.reset();
      Inventory.addItem("almondWater", 1);
      Player.sanity = 58;
    }
    if (this.stage === 7) {
      Player.sanity = 24;
      this.sanityDemoT = 0;
    }
    if (this.stage === 8 && !this.entityDemoSpawned) {
      const dir = new THREE.Vector3(-Math.sin(Player.yaw), 0, -Math.cos(Player.yaw));
      const p = Player.position.clone().addScaledVector(dir, 12);
      p.y = 0;
      EntitySystem.spawn(p, Player.yaw + Math.PI);
      EntitySystem.state = "DEMONSTRATION";
      this.entityDemoSpawned = true;
    }
    if (this.stage === 9) {
      this.startLightDemo();
    }
  },

  update(dt) {
    if (!this.active || GameState.phase !== "playing" || !Input.locked) return;
    const elapsed = (performance.now() - this.stageStartedAt) / 1000;
    if (this.stage === 1) {
      if (Math.hypot(Player.velocity.x, Player.velocity.z) > 0.15) this.moveSeen = true;
      if (this.lastYaw === null) this.lastYaw = Player.yaw;
      if (Math.abs(Player.yaw - this.lastYaw) > 0.008 || Math.abs(Player.pitch) > 0.008) this.lookSeen = true;
      this.lastYaw = Player.yaw;
      if (this.moveSeen && this.lookSeen && elapsed > 1.2) this.setHint("Movement and looking understood. Press CONTINUE.");
    } else if (this.stage === 2) {
      this.sprintSeen = this.sprintSeen || Player.wishSprint;
      this.crouchSeen = this.crouchSeen || Player.crouching;
      this.jumpSeen = this.jumpSeen || !Player.onGround;
    } else if (this.stage === 3) {
      this.flashSeen = this.flashSeen || Flashlight.enabled;
    } else if (this.stage === 5) {
      this.inventorySeen = this.inventorySeen || GameState.inventoryOpen;
    } else if (this.stage === 6) {
      if (Inventory.getItemCount("almondWater") === 0 && Player.sanity > 58) this.drinkSeen = true;
    } else if (this.stage === 7) {
      this.sanityDemoT += dt;
      const target = Math.max(8, 24 - this.sanityDemoT * 2.0);
      Player.sanity = Math.min(Player.sanity, target);
      if (this.sanityDemoT > 4.5) {
        Player.sanity = 38;
        this.setHint("In a real run, sanity changes continuously. Press CONTINUE.");
      }
    } else if (this.stage === 9) {
      this.lightDemoT += dt;
      if (this.lightDemoT > 6.5 && this.lightSnapshot) this.restoreLightDemo();
    }
    const hint = document.getElementById("tutorial-hint");
    if (hint && !GameState.inventoryOpen) hint.textContent = this.stageHint();
  },

  setHint(message) {
    const hint = document.getElementById("tutorial-hint");
    if (hint) hint.textContent = message;
  },

  canAdvance() {
    if (this.stage === 1) return this.moveSeen && this.lookSeen;
    if (this.stage === 2) return this.sprintSeen && this.crouchSeen && this.jumpSeen;
    if (this.stage === 3) return this.flashSeen;
    if (this.stage === 5) return this.inventorySeen;
    if (this.stage === 6) return this.drinkSeen;
    return true;
  },

  advance() {
    if (!this.active || GameState.phase !== "playing") return;
    if (!this.canAdvance()) {
      this.setHint("Try the controls in this lesson before continuing.");
      return;
    }
    if (GameState.inventoryOpen) Inventory.close();
    if (this.stage === 9) this.restoreLightDemo();
    this.stage++;
    if (this.stage >= this.stages.length) this.stage = this.stages.length - 1;
    this.renderStage();
    if (this.stage === this.stages.length - 1) {
      this.setHint("Press EXIT TRAINING when you are ready.");
    }
  },

  startLightDemo() {
    if (this.lightSnapshot) return;
    this.lightDemoT = 0;
    this.lightSnapshot = [];
    if (typeof LightingSystem === "undefined") return;
    for (const u of LightingSystem.units) {
      this.lightSnapshot.push(LightingSystem.snapshot(u));
      LightingSystem.setFixtureState(u, "DIM");
    }
    setTimeout(() => {
      if (!this.active || this.stage !== 9) return;
      for (const u of LightingSystem.units) LightingSystem.setFixtureState(u, "BROKEN");
    }, 1600);
    setTimeout(() => {
      if (!this.active || this.stage !== 9) return;
      for (const u of LightingSystem.units) LightingSystem.setFixtureState(u, "DIM");
    }, 4300);
  },

  restoreLightDemo() {
    if (!this.lightSnapshot || typeof LightingSystem === "undefined") return;
    for (let i = 0; i < LightingSystem.units.length; i++) {
      const u = LightingSystem.units[i];
      const snap = this.lightSnapshot[i];
      if (snap) LightingSystem.applySnapshot(u, snap);
    }
    this.lightSnapshot = null;
  },

  exit() {
    if (!this.active) {
      if (typeof MenuSystem !== "undefined") MenuSystem.showMain();
      return;
    }
    this.restoreLightDemo();
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof Inventory !== "undefined") Inventory.reset();
    if (typeof Flashlight !== "undefined") Flashlight.reset();
    this.active = false;
    GameState.tutorial = false;
    GameState.inventoryOpen = false;
    clearInput();
    Input.locked = false;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    const overlay = document.getElementById("tutorial-overlay");
    if (overlay) overlay.style.display = "none";
    if (typeof Game !== "undefined") Game.leaveRun();
  }
};

window.addEventListener("load", () => TutorialSystem.init());
