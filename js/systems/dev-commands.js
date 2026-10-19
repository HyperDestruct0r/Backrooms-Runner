"use strict";

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
      this.toast("UNKNOWN COMMAND · TYPE HELP");
    } catch (err) {
      console.error(err);
      this.toast("COMMAND FAILED");
    }
  },

  help() {
    this.toast("LEVEL SPAWN DESPAWN GIVE HP STAMINA SANITY GOD KILL TP SEED POS TIMESCALE BLACKOUT CLEAR UNDO");
  },

  level(args) {
    const n = parseInt(args[0], 10);
    if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 0 OR LEVEL 1");
    if (n === 0) return this.goLevel0();
    if (n === 1) return this.goLevel1();
    this.toast("LEVEL " + n + " IS NOT AVAILABLE");
  },
  goLevel0() {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof EntitySystem !== "undefined") EntitySystem.despawn();
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
      const ahead = this.ahead(4);
      EntitySystem.spawn(new THREE.Vector3(ahead.x, 0, ahead.z), Player.yaw);
      this.undo = { type: "spawn-entity" };
      return this.toast("SPAWNED ENTITY");
    }
    if (kind === "smiler") {
      if (!Level1.active) return this.toast("SMILERS ARE LEVEL 1 ONLY");
      const ahead = this.ahead(8);
      SmilerSystem.makeSmiler({ x: ahead.x, z: ahead.z });
      this.undo = { type: "spawn-smiler" };
      return this.toast("SPAWNED SMILER");
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
      this.undo = null;
      return this.toast("DESPAWNED ALL");
    }
    if (kind === "entity") {
      if (!EntitySystem.spawned) return this.toast("NO ENTITY PRESENT");
      EntitySystem.despawn();
      this.undo = null;
      return this.toast(count > 1 ? "REMOVED 1 · ONLY 1 WAS PRESENT" : "DESPAWNED ENTITY");
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
      const before = Player.stamina;
      Player.stamina = Math.min(CONFIG.stamina.max, Player.stamina + 25 * count);
      this.undo = { type: "stamina", value: before };
      return this.toast("ENERGY +" + (25 * count) + " STAMINA");
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
    else this.goLevel0();
    this.toast("SEEDED " + (GameState.seed >>> 0));
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
    const before = Object.assign({}, Inventory.items);
    Inventory.reset();
    this.undo = { type: "clear", items: before };
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
    if (u.type === "spawn-smiler") {
      const active = SmilerSystem.list.filter(s => s.active);
      if (active.length) SmilerSystem.deactivate(active[active.length - 1]);
      return this.toast("UNDID SPAWN");
    }
    if (u.type === "clear") {
      Inventory.items = u.items || {};
      Inventory.refresh();
      return this.toast("UNDID CLEAR");
    }
    this.toast("CANNOT UNDO");
  }
};

window.addEventListener("load", () => DevCommands.init());
