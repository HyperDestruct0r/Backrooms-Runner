"use strict";

const DevMap = {
  visible: false,
  timer: 0,
  show() {
    this.visible = true;
    this.timer = 0;
    const el = document.getElementById("dev-map");
    if (el) el.style.display = "block";
    this.draw();
    if (typeof HUD !== "undefined") HUD.toast("MAP ON");
  },
  hide() {
    this.visible = false;
    const el = document.getElementById("dev-map");
    if (el) el.style.display = "none";
    if (typeof HUD !== "undefined") HUD.toast("MAP OFF");
  },
  update(dt) {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.5; this.draw(); }
  },
  draw() {
    const canvas = document.getElementById("dev-map");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const size = 250, span = 500, scale = size / span;
    const px = Player.position.x, pz = Player.position.z;
    ctx.fillStyle = "#12100c";
    ctx.fillRect(0, 0, size, size);
    const toX = (x) => (x - px + span * 0.5) * scale;
    const toY = (z) => (z - pz + span * 0.5) * scale;
    if (GameState.level === 0 && Level.tiles && Level.tiles.length) {
      const T = CONFIG.tile;
      const x0 = Math.max(0, Math.floor((px - span * 0.5) / T));
      const x1 = Math.min(Level.cols, Math.ceil((px + span * 0.5) / T));
      const z0 = Math.max(0, Math.floor((pz - span * 0.5) / T));
      const z1 = Math.min(Level.rows, Math.ceil((pz + span * 0.5) / T));
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          const t = Level.getTile(x, z);
          ctx.fillStyle = (t === TILE.WALL || t === TILE.COLUMN) ? "#3a3424" : "#8a7a4a";
          ctx.fillRect(toX(x * T), toY(z * T), Math.max(1, T * scale), Math.max(1, T * scale));
        }
      }
    } else if (GameState.level === 1 && typeof Level1 !== "undefined") {
      ctx.fillStyle = "#2a2c2e";
      for (const rec of Level1.chunks.values()) {
        const S = Level1.microSize || 60;
        ctx.fillRect(toX(rec.cx * S), toY(rec.cz * S), S * scale, S * scale);
      }
    }
    let exit = null;
    if (GameState.level === 1 && Level1.exitPosition) exit = Level1.exitPosition;
    else if (Stairwell.exits && Stairwell.exits.length) exit = Stairwell.exits[0].origin;
    if (exit) {
      ctx.fillStyle = "#7ec8ff";
      ctx.fillRect(toX(exit.x) - 2, toY(exit.z) - 2, 5, 5);
    }
    ctx.fillStyle = "#efe6b0";
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.5, 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

const DevCommands = {
  open: false,
  last: null,
  undo: null,
  history: [],
  histI: -1,

  init() {
    const input = document.getElementById("dev-console-input");
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.code === "Enter") {
        e.preventDefault();
        const text = input.value;
        input.value = "";
        this.run(text);
        this.close();
      } else if (e.code === "Escape" || e.code === "Backquote") {
        e.preventDefault();
        this.close();
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (!this.history.length) return;
        this.histI = Math.max(0, this.histI - 1);
        input.value = this.history[this.histI] || "";
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        this.histI = Math.min(this.history.length, this.histI + 1);
        input.value = this.history[this.histI] || "";
      }
      e.stopPropagation();
    });
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Backquote" || e.repeat) return;
      if (!GameState.debug || GameState.phase !== "playing") return;
      if (this.open) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    }, true);
  },

  toggle() { this.open ? this.close() : this.show(); },
  show() {
    if (!GameState.debug || GameState.phase !== "playing") return;
    this.open = true;
    const box = document.getElementById("dev-console");
    const input = document.getElementById("dev-console-input");
    if (box) box.style.display = "block";
    setPauseOverlay(false);
    Input.locked = false;
    clearInput();
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    this.histI = this.history.length;
    if (input) { input.value = ""; setTimeout(() => input.focus(), 0); }
  },
  close() {
    this.open = false;
    const box = document.getElementById("dev-console");
    if (box) box.style.display = "none";
    if (GameState.phase === "playing" && !GameState.cutscene) {
      if (DeviceMode.mobile) Input.locked = true;
      else if (renderer && renderer.domElement) renderer.domElement.requestPointerLock();
    }
  },

  toast(msg) { if (typeof HUD !== "undefined") HUD.toast(msg); else console.log(msg); },
  remember(text) {
    if (!text) return;
    this.last = text;
    this.history.push(text);
    if (this.history.length > 20) this.history.shift();
    this.histI = this.history.length;
  },

  run(raw) {
    const text = String(raw || "").trim().replace(/^\//, "");
    if (!text) return;
    this.remember(text);
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    try {
      if (cmd === "help") return this.help();
      if (cmd === "level") return this.level(args);
      if (cmd === "level2") return this.level(["2"].concat(args));
      if (cmd === "level3") return this.level(["3"].concat(args));
      if (cmd === "level4") return this.level(["4"].concat(args));
      if (cmd === "level5") return this.level(["5"].concat(args));
      if (cmd === "level6") return this.level(["6"].concat(args));
      if (cmd === "spawn") return this.spawn(args);
      if (cmd === "despawn") return this.despawn(args);
      if (cmd === "give") return this.give(args);
      if (cmd === "hp" || cmd === "stamina" || cmd === "sanity") return this.resource(cmd, args);
      if (cmd === "god") return this.god();
      if (cmd === "kill") return this.kill();
      if (cmd === "tp") return this.tp(args);
      if (cmd === "seed") return this.seed(args);
      if (cmd === "pos") return this.pos();
      if (cmd === "timescale") return this.timescale(args);
      if (cmd === "blackout") return this.blackout();
      if (cmd === "clear") return this.clearInv();
      if (cmd === "undo") return this.undoLast();
      if (cmd === "showmap") return DevMap.show();
      if (cmd === "hidemap") return DevMap.hide();
      if (cmd === "exit") return this.exitInfo();
      this.toast("UNKNOWN COMMAND · TYPE HELP");
    } catch (err) {
      console.error(err);
      this.toast("COMMAND FAILED" + (err && err.message ? " · " + String(err.message).slice(0, 60).toUpperCase() : ""));
    }
  },

  help() {
    this.toast("LEVEL SPAWN DESPAWN GIVE HP STAMINA SANITY GOD KILL TP SEED POS TIMESCALE BLACKOUT CLEAR UNDO SHOWMAP HIDEMAP EXIT");
    this.toast("LEVEL 2 · LEVEL 2 TPS · LEVEL2 · LEVEL 2 RESET · LEVEL 2 SEED N · LEVEL 2 INFO · LEVEL 2 EXIT");
    this.toast("LEVEL 3 · LEVEL3 · LEVEL 3 RESET · LEVEL 3 SEED N · LEVEL 3 INFO · LEVEL 3 EXIT · LEVEL 3 POWER");
    this.toast("LEVEL 4 · LEVEL4 · LEVEL 4 RESET · LEVEL 4 SEED N · LEVEL 4 INFO · LEVEL 4 EXIT");
    this.toast("LEVEL 5 · LEVEL5 · LEVEL 5 RESET · LEVEL 5 SEED N · LEVEL 5 INFO · LEVEL 5 EXIT · LEVEL 5 BACK");
    this.toast("LEVEL 6 · LEVEL6 · LEVEL 6 RESET · LEVEL 6 SEED N · LEVEL 6 INFO · LEVEL 6 EXIT · LEVEL 6 BACK");
  },

  level(args) {
    const n = parseInt(args[0], 10);
    if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 0, 1, 2, 3, 4, 5, OR 6");
    if (n === 0) return this.goLevel0();
    if (n === 1) return this.goLevel1();
    if (n === 2) return this.level2(args.slice(1));
    if (n === 3) return this.level3(args.slice(1));
    if (n === 4) return this.level4(args.slice(1));
    if (n === 5) return this.level5(args.slice(1));
    if (n === 6) return this.level6(args.slice(1));
    this.toast("LEVEL " + n + " IS NOT AVAILABLE");
  },
  level2(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "info") {
      if (!Level2.active) return this.toast("NOT IN LEVEL 2");
      return this.toast("SEED " + Level2.seed + " · " + Level2.infoText);
    }
    if (sub === "exit") {
      if (!Level2.active || !Level2.exitPos) return this.toast("NO LEVEL 2 EXIT");
      Player.position.copy(Level2.exitPos);
      Player.velocity.set(0, 0, 0);
      Level2.stream(true);
      return this.toast("TELEPORTED TO LEVEL 2 EXIT");
    }
    if (sub === "reset") {
      const next = ((GameState.seed || 1) + 1) >>> 0;
      GameState.seed = next;
      Level2.enter(next);
      return this.toast("LEVEL 2 RESET · SEED " + next);
    }
    if (sub === "seed") {
      const n = Number(args[1]);
      if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 2 SEED 12345");
      GameState.seed = n >>> 0;
      Level2.enter(GameState.seed);
      return this.toast("LEVEL 2 · SEED " + (GameState.seed >>> 0));
    }
    if (sub && sub !== "tps") return this.toast("USAGE: LEVEL 2, LEVEL 2 TPS, RESET, SEED, INFO, EXIT");
    Level2.enter((GameState.seed || 1) >>> 0);
    return this.toast(sub === "tps" ? "LEVEL 2 · TEST SPAWN" : "ENTERED LEVEL 2");
  },
  level3(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "info") {
      if (!Level3.active) return this.toast("NOT IN LEVEL 3");
      return this.toast("SEED " + Level3.seed + " · " + Level3.infoText);
    }
    if (sub === "exit") {
      if (!Level3.active || !Level3.exitPos) return this.toast("NO LEVEL 3 EXIT");
      Player.position.copy(Level3.exitPos);
      Player.velocity.set(0, 0, 0);
      Level3.stream(true);
      return this.toast("TELEPORTED TO LEVEL 3 ELEVATOR");
    }
    if (sub === "button") {
      if (!Level3.active || !Level3.buttonPos) return this.toast("NO LEVEL 3 BUTTON");
      Player.position.copy(Level3.buttonPos);
      Player.velocity.set(0, 0, 0);
      Level3.stream(true);
      return this.toast("TELEPORTED TO LEVEL 3 BUTTON ROOM");
    }
    if (sub === "power") {
      if (!Level3.active) return this.toast("NOT IN LEVEL 3");
      if (!Level3.powered) Level3.setPowered();
      return;
    }
    if (sub === "reset") {
      const next = ((GameState.seed || 1) + 1) >>> 0;
      GameState.seed = next;
      Level3.enter(next);
      return this.toast("LEVEL 3 RESET · SEED " + next);
    }
    if (sub === "seed") {
      const n = Number(args[1]);
      if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 3 SEED 12345");
      GameState.seed = n >>> 0;
      Level3.enter(GameState.seed);
      return this.toast("LEVEL 3 · SEED " + (GameState.seed >>> 0));
    }
    if (sub) return this.toast("USAGE: LEVEL 3, RESET, SEED, INFO, EXIT, BUTTON, POWER");
    Level3.enter((GameState.seed || 1) >>> 0);
    return this.toast("ENTERED LEVEL 3");
  },
  level4(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "info") {
      if (!Level4.active) return this.toast("NOT IN LEVEL 4");
      return this.toast("SEED " + Level4.seed + " · " + Level4.infoText);
    }
    if (sub === "exit") {
      if (!Level4.active || !Level4.exitPos) return this.toast("NO LEVEL 4 EXIT");
      Player.position.copy(Level4.exitPos);
      Player.velocity.set(0, 0, 0);
      Level4.stream(true);
      Level4.assignLights();
      return this.toast("TELEPORTED TO LEVEL 4 FORWARD DOOR");
    }
    if (sub === "reset") {
      const next = ((GameState.seed || 1) + 1) >>> 0;
      GameState.seed = next;
      Level4.enter(next);
      return this.toast("LEVEL 4 RESET · SEED " + next);
    }
    if (sub === "seed") {
      const n = Number(args[1]);
      if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 4 SEED 12345");
      GameState.seed = n >>> 0;
      Level4.enter(GameState.seed);
      return this.toast("LEVEL 4 · SEED " + (GameState.seed >>> 0));
    }
    if (sub) return this.toast("USAGE: LEVEL 4, RESET, SEED, INFO, EXIT");
    Level4.enter((GameState.seed || 1) >>> 0);
    return this.toast("ENTERED LEVEL 4");
  },
  level5(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "info") {
      if (!Level5.active) return this.toast("NOT IN LEVEL 5");
      return this.toast("SEED " + Level5.seed + " · " + Level5.infoText);
    }
    if (sub === "exit") {
      if (!Level5.active || !Level5.exitPos) return this.toast("NO LEVEL 5 EXIT");
      Player.position.copy(Level5.exitPos);
      Player.velocity.set(0, 0, 0);
      Level5.stream(true);
      Level5.assignLights();
      return this.toast("TELEPORTED TO LEVEL 5 FORWARD DOOR");
    }
    if (sub === "back") {
      if (!Level5.active || !Level5.backPos) return this.toast("NO LEVEL 5 BACK DOOR");
      Player.position.copy(Level5.backPos);
      Player.velocity.set(0, 0, 0);
      Level5.stream(true);
      Level5.assignLights();
      return this.toast("TELEPORTED TO LEVEL 5 BACK DOOR");
    }
    if (sub === "ballroom" || sub === "dining") {
      const pos = sub === "ballroom" ? Level5.ballPos : Level5.dinePos;
      if (!Level5.active || !pos) return this.toast("NO " + sub.toUpperCase() + " ON THIS SEED");
      Player.position.copy(pos);
      Player.velocity.set(0, 0, 0);
      Level5.stream(true);
      Level5.assignLights();
      return this.toast("TELEPORTED TO THE " + sub.toUpperCase());
    }
    if (sub === "reset") {
      const next = ((GameState.seed || 1) + 1) >>> 0;
      GameState.seed = next;
      Level5.enter(next);
      return this.toast("LEVEL 5 RESET · SEED " + next);
    }
    if (sub === "seed") {
      const n = Number(args[1]);
      if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 5 SEED 12345");
      GameState.seed = n >>> 0;
      Level5.enter(GameState.seed);
      return this.toast("LEVEL 5 · SEED " + (GameState.seed >>> 0));
    }
    if (sub) return this.toast("USAGE: LEVEL 5, RESET, SEED, INFO, EXIT, BACK, BALLROOM, DINING");
    Level5.enter((GameState.seed || 1) >>> 0);
    return this.toast("ENTERED LEVEL 5");
  },
  level6(args) {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "info") {
      if (!Level6.active) return this.toast("NOT IN LEVEL 6");
      return this.toast("SEED " + Level6.seed + " · " + Level6.infoText);
    }
    if (sub === "exit" || sub === "back") {
      const pos = sub === "exit" ? Level6.exitPos : Level6.backPos;
      if (!Level6.active || !pos) return this.toast("NO LEVEL 6 " + sub.toUpperCase() + " DOOR");
      Player.position.copy(pos);
      Player.velocity.set(0, 0, 0);
      return this.toast("TELEPORTED TO LEVEL 6 " + sub.toUpperCase() + " DOOR");
    }
    if (sub === "reset") {
      const next = ((GameState.seed || 1) + 1) >>> 0;
      GameState.seed = next;
      Level6.enter(next);
      return this.toast("LEVEL 6 RESET · SEED " + next);
    }
    if (sub === "seed") {
      const n = Number(args[1]);
      if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 6 SEED 12345");
      GameState.seed = n >>> 0;
      Level6.enter(GameState.seed);
      return this.toast("LEVEL 6 · SEED " + (GameState.seed >>> 0));
    }
    if (sub) return this.toast("USAGE: LEVEL 6, RESET, SEED, INFO, EXIT, BACK");
    Level6.enter((GameState.seed || 1) >>> 0);
    return this.toast("ENTERED LEVEL 6");
  },
  goLevel3() {
    Level3.enter((GameState.seed || 1) >>> 0);
  },
  goLevel0() {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    const seed = (GameState.seed || 1) >>> 0;
    const built = Level.buildProcedural(scene, seed);
    if (!built) return this.toast("LEVEL 0 FAILED");
    GameState.level = 0;
    GameState.phase = "playing";
    GameState.cutscene = false;
    Player.resetToStart();
    this.toast("ENTERED LEVEL 0");
  },
  goLevel1() {
    if (typeof Level2 !== "undefined") Level2.reset();
    if (typeof Level3 !== "undefined") Level3.reset();
    if (typeof Level4 !== "undefined") Level4.reset();
    if (typeof HoundSystem !== "undefined") HoundSystem.reset();
    if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
    const origin = { x: Player.position.x, z: Player.position.z };
    const fake = { origin: { x: origin.x, z: origin.z }, fx: 0, fz: 1 };
    Level1.enter((GameState.seed || 1) >>> 0, fake);
    if (typeof Level1 !== "undefined" && Level1.active) Level1.stream(true);
    this.toast("ENTERED LEVEL 1");
  },

  spawn(args) {
    const kind = (args[0] || "").toLowerCase();
    if (!kind) return this.toast("MISSING TARGET");
    if (kind === "entity") {
      if (GameState.level === 1) return this.toast("ENTITY IS LEVEL 0 ONLY");
      const ahead = this.ahead(4);
      EntitySystem.spawn(new THREE.Vector3(ahead.x, 0, ahead.z), Player.yaw);
      this.undo = { type: "spawn-entity" };
      return this.toast("SPAWNED ENTITY");
    }
    if (kind === "smiler") {
      if (GameState.level === 4 && typeof Level4 !== "undefined" && Level4.active && typeof SmilerSystem !== "undefined" && !SmilerSystem.attached) {
        Level4.attachSpare("smiler");  // this level picked a Hound; attach a Smiler for the forced spawn only
      }
      const inSmilerLevel = GameState.level >= 1 && GameState.level <= 4 &&
        typeof SmilerSystem !== "undefined" && SmilerSystem.attached;
      if (!inSmilerLevel) return this.toast("SMILERS ARE LEVEL 1, 2, 3 AND 4 ONLY");
      // nearest open spot in front of the player, same search as the Hound
      let s = null;
      for (const dist of [8, 6, 10, 4, 12, 3]) {
        const a = this.ahead(dist);
        s = SmilerSystem.spawnAt(a.x, a.z, true);
        if (s) break;
      }
      if (!s) return this.toast("NO OPEN SPACE AHEAD");
      this.undo = { type: "spawn-smiler" };
      return this.toast("SPAWNED SMILER");
    }
    if (kind === "hound") {
      if (GameState.level === 4 && typeof Level4 !== "undefined" && Level4.active && typeof HoundSystem !== "undefined" && !HoundSystem.attached) {
        Level4.attachSpare("hound");   // this level picked a Smiler; attach a Hound for the forced spawn only
      }
      if (GameState.level === 5 && typeof Level5 !== "undefined" && Level5.active && typeof HoundSystem !== "undefined" && !HoundSystem.attached) {
        Level5.attachSpare("hound");   // odd seed: no Hound of its own; attach one for the forced spawn only
      }
      const inHoundLevel = (GameState.level >= 2 && GameState.level <= 5) &&
        typeof HoundSystem !== "undefined" && HoundSystem.attached;
      if (!inHoundLevel) return this.toast("HOUNDS ARE LEVEL 2, 3 AND 4 ONLY");
      // nearest open spot in front of the player
      let h = null;
      for (const dist of [8, 6, 10, 4, 12, 3]) {
        const a = this.ahead(dist);
        h = HoundSystem.spawnAt(a.x, a.z, true);
        if (h) break;
      }
      if (!h) return this.toast("NO OPEN SPACE AHEAD");
      this.undo = { type: "spawn-hound" };
      return this.toast("SPAWNED HOUND");
    }
    if (kind === "beast") {
      // Level 5 only. Anywhere else: nothing happens, and it says so.
      const inL5 = GameState.level === 5 && typeof Level5 !== "undefined" && Level5.active &&
        typeof BeastSystem !== "undefined" && BeastSystem.attached;
      if (!inL5) return this.toast("THE BEAST IS LEVEL 5 ONLY · NOTHING SPAWNED");
      if (BeastSystem.count() >= 1) return this.toast("THE BEAST IS ALREADY HERE");
      let b = null;
      for (const dist of [10, 8, 12, 6, 14, 4]) {
        const a = this.ahead(dist);
        b = BeastSystem.spawnAt(a.x, a.z, true);
        if (b) break;
      }
      if (!b) return this.toast("NO OPEN SPACE AHEAD");
      this.undo = { type: "spawn-beast" };
      return this.toast("SPAWNED BEAST");
    }
    this.toast("UNKNOWN ENTITY");
  },
  despawn(args) {
    const kind = (args[0] || "").toLowerCase();
    if (!kind) return this.toast("MISSING TARGET");
    const count = args[1] == null ? 1 : Math.max(1, parseInt(args[1], 10) || 1);
    if (kind === "all") {
      EntitySystem.despawn();
      if (typeof SmilerSystem !== "undefined") SmilerSystem.reset();
      if (typeof HoundSystem !== "undefined") HoundSystem.reset();
      if (typeof BeastSystem !== "undefined" && BeastSystem.attached) BeastSystem.despawn();
      this.undo = null;
      return this.toast("DESPAWNED ALL");
    }
    if (kind === "entity") {
      if (!EntitySystem.spawned) return this.toast("NO ENTITY PRESENT");
      EntitySystem.despawn();
      this.undo = null;
      return this.toast(count > 1 ? "REMOVED 1 · ONLY 1 WAS PRESENT" : "DESPAWNED ENTITY");
    }
    if (kind === "hound") {
      const present = typeof HoundSystem !== "undefined" ? HoundSystem.count() : 0;
      this.undo = null;
      if (!present) return this.toast("NO HOUNDS PRESENT");
      const n = HoundSystem.despawn(count);
      if (count > present) return this.toast("REMOVED " + n + " · ONLY " + present + " WERE PRESENT");
      return this.toast("REMOVED " + n + " HOUND" + (n === 1 ? "" : "S"));
    }
    if (kind === "smiler") {
      const active = SmilerSystem.list.filter(s => s.active);
      const n = Math.min(count, active.length);
      for (let i = 0; i < n; i++) SmilerSystem.deactivate(active[i]);
      this.undo = null;
      if (!active.length) return this.toast("NO SMILERS PRESENT");
      if (count > active.length) return this.toast("REMOVED " + n + " · ONLY " + active.length + " WERE PRESENT");
      return this.toast("REMOVED " + n + " SMILER" + (n === 1 ? "" : "S"));
    }
    if (kind === "beast") {
      const inL5 = GameState.level === 5 && typeof Level5 !== "undefined" && Level5.active &&
        typeof BeastSystem !== "undefined" && BeastSystem.attached;
      this.undo = null;
      if (!inL5) return this.toast("THE BEAST IS LEVEL 5 ONLY · NOTHING TO REMOVE");
      if (!BeastSystem.count()) return this.toast("NO BEAST PRESENT");
      BeastSystem.despawn();
      return this.toast("DESPAWNED BEAST");
    }
    this.toast("UNKNOWN ENTITY");
  },

  give(args) {
    const item = (args[0] || "").toLowerCase();
    if (!item) return this.toast("MISSING TARGET");
    const count = args[1] == null ? 1 : Math.max(1, parseInt(args[1], 10) || 1);
    if (item === "almond" || item === "almondwater") {
      const added = Inventory.addItem("almondWater", count);
      this.undo = { type: "give", id: "almondWater", count: added };
      return this.toast(added ? "GAVE ALMOND WATER ×" + added : "INVENTORY FULL");
    }
    if (item === "energy") {
      const added = Inventory.addItem("energyBar", count);
      this.undo = { type: "give", id: "energyBar", count: added };
      return this.toast(added ? "GAVE ENERGY BAR ×" + added : "INVENTORY FULL");
    }
    this.toast("UNKNOWN ITEM");
  },
  resource(kind, args) {
    const value = args[0] == null ? null : Number(args[0]);
    if (!Number.isFinite(value)) return this.toast("USAGE: " + kind.toUpperCase() + " 100");
    if (kind === "hp") {
      this.undo = { type: "hp", value: Player.hp };
      Player.hp = Math.max(0, Math.min(Player.maxHp, value));
    } else if (kind === "stamina") {
      this.undo = { type: "stamina", value: Player.stamina };
      Player.stamina = Math.max(0, Math.min(CONFIG.stamina.max, value));
    } else {
      this.undo = { type: "sanity", value: Player.sanity };
      Player.sanity = Math.max(0, Math.min(CONFIG.sanity.max, value));
    }
    this.toast(kind.toUpperCase() + " SET TO " + (value | 0));
  },
  god() {
    GameState.god = !GameState.god;
    this.undo = null;
    this.toast(GameState.god ? "GOD ON" : "GOD OFF");
  },
  kill() {
    this.undo = null;
    Player.hp = 0;
    Game.gameOver();
    this.toast("PLAYER KILLED");
  },
  tp(args) {
    const x = Number(args[0]), z = Number(args[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return this.toast("USAGE: TP X Z");
    const destX = Level.startPos.x + x;
    const destZ = Level.startPos.z + z;
    if (this.blocked(destX, destZ)) return this.toast("BLOCKED");
    this.undo = { type: "tp", x: Player.position.x, z: Player.position.z };
    Player.position.set(destX, GameState.level === 1 ? Level1.baseY : 0, destZ);
    Player.velocity.set(0, 0, 0);
    Player.onGround = true;
    if (GameState.level === 1 && Level1.active) Level1.stream(true);
    this.toast("TELEPORTED");
  },
  blocked(x, z) {
    if (GameState.level === 1 && Level1.active) {
      for (const c of Level1.colliders) {
        if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z && c.max.y > 0.6) return true;
      }
      return false;
    }
    const tx = Math.floor(x / CONFIG.tile), tz = Math.floor(z / CONFIG.tile);
    if (!Level.inBounds(tx, tz)) return true;
    const t = Level.getTile(tx, tz);
    return t === TILE.WALL || t === TILE.COLUMN;
  },
  ahead(dist) {
    return {
      x: Player.position.x - Math.sin(Player.yaw) * dist,
      z: Player.position.z - Math.cos(Player.yaw) * dist
    };
  },
  seed(args) {
    if (!args.length) return this.toast("SEED " + (GameState.seed >>> 0));
    const n = Number(args[0]);
    if (!Number.isFinite(n)) return this.toast("USAGE: SEED OR SEED 12345");
    GameState.seed = n >>> 0;
    if (GameState.level === 1) this.goLevel1();
    else if (GameState.level === 2) Level2.enter(GameState.seed);
    else if (GameState.level === 3) Level3.enter(GameState.seed);
    else if (GameState.level === 4) Level4.enter(GameState.seed);
    else if (GameState.level === 5) Level5.enter(GameState.seed);
    else if (GameState.level === 6) Level6.enter(GameState.seed);
    else this.goLevel0();
    this.toast("SEEDED " + (GameState.seed >>> 0));
  },
  exitInfo() {
    let target = null;
    if (GameState.level === 6 && typeof Level6 !== "undefined" && Level6.exitPos) target = Level6.exitPos;
    else if (GameState.level === 5 && typeof Level5 !== "undefined" && Level5.exitPos) target = Level5.exitPos;
    else if (GameState.level === 4 && typeof Level4 !== "undefined" && Level4.exitPos) target = Level4.exitPos;
    else if (GameState.level === 3 && typeof Level3 !== "undefined" && Level3.exitPos) target = Level3.exitPos;
    else if (GameState.level === 2 && typeof Level2 !== "undefined" && Level2.exitPos) target = Level2.exitPos;
    else if (GameState.level === 1 && typeof Level1 !== "undefined" && Level1.exitPosition) target = Level1.exitPosition;
    else if (typeof Stairwell !== "undefined" && Stairwell.exits && Stairwell.exits.length) {
      let best = Stairwell.exits[0].origin, bestD = Infinity;
      for (const st of Stairwell.exits) {
        const d = Math.hypot(st.origin.x - Player.position.x, st.origin.z - Player.position.z);
        if (d < bestD) { best = st.origin; bestD = d; }
      }
      target = best;
    }
    if (!target) return this.toast("NO EXIT");
    const dx = target.x - Player.position.x, dz = target.z - Player.position.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz) * 180 / Math.PI;
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    const dir = dirs[Math.round(((ang % 360) + 360) % 360 / 45) % 8];
    this.toast("EXIT " + dist.toFixed(0) + " M " + dir);
  },
  pos() {
    this.toast("X " + Player.position.x.toFixed(1) + "  Z " + Player.position.z.toFixed(1));
  },
  timescale(args) {
    const n = args[0] == null ? 1 : Number(args[0]);
    if (!Number.isFinite(n) || n <= 0) return this.toast("USAGE: TIMESCALE 1");
    GameState.timeScale = n;
    this.undo = null;
    this.toast("TIMESCALE " + n);
  },
  blackout() {
    if (!Level1.active) return this.toast("BLACKOUT IS LEVEL 1 ONLY");
    Level1.startBlackout();
    this.undo = null;
    this.toast("BLACKOUT STARTED");
  },
  clearInv() {
    const before = this.stacks.slice();
    Inventory.reset();
    this.undo = { type: "clear", stacks: before };
    this.toast("INVENTORY CLEARED");
  },
  undoLast() {
    const u = this.undo;
    if (!u) return this.toast("NOTHING TO UNDO");
    this.undo = null;
    if (u.type === "tp") {
      Player.position.x = u.x; Player.position.z = u.z;
      if (GameState.level === 1 && Level1.active) Level1.stream(true);
      return this.toast("UNDID TELEPORT");
    }
    if (u.type === "give") {
      Inventory.removeItem(u.id, u.count);
      return this.toast("UNDID GIVE");
    }
    if (u.type === "hp") { Player.hp = u.value; return this.toast("UNDID HP"); }
    if (u.type === "stamina") { Player.stamina = u.value; return this.toast("UNDID STAMINA"); }
    if (u.type === "sanity") { Player.sanity = u.value; return this.toast("UNDID SANITY"); }
    if (u.type === "spawn-entity") { EntitySystem.despawn(); return this.toast("UNDID SPAWN"); }
    if (u.type === "spawn-hound") {
      if (typeof HoundSystem !== "undefined") HoundSystem.despawn(1);
      return this.toast("UNDID SPAWN");
    }
    if (u.type === "spawn-beast") {
      if (typeof BeastSystem !== "undefined" && BeastSystem.attached) BeastSystem.despawn();
      return this.toast("UNDID SPAWN");
    }
    if (u.type === "spawn-smiler") {
      const active = SmilerSystem.list.filter(s => s.active);
      if (active.length) SmilerSystem.deactivate(active[active.length - 1]);
      return this.toast("UNDID SPAWN");
    }
    if (u.type === "clear") {
      Inventory.stacks = u.stacks || new Array(Inventory.slots).fill(null);
      Inventory.refresh();
      return this.toast("UNDID CLEAR");
    }
    this.toast("CANNOT UNDO");
  }
};

window.addEventListener("load", () => DevCommands.init());
