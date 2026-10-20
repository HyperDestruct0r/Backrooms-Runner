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
      this.toast("COMMAND FAILED");
    }
  },

  help() {
    this.toast("LEVEL SPAWN DESPAWN GIVE HP STAMINA SANITY GOD KILL TP SEED POS TIMESCALE BLACKOUT CLEAR UNDO SHOWMAP HIDEMAP EXIT");
    this.toast("LEVEL 2 · LEVEL 2 TPS · LEVEL2 · LEVEL 2 RESET · LEVEL 2 SEED N · LEVEL 2 INFO · LEVEL 2 EXIT");
  },

  level(args) {
    const n = parseInt(args[0], 10);
    if (!Number.isFinite(n)) return this.toast("USAGE: LEVEL 0, LEVEL 1, OR LEVEL 2");
    if (n === 0) return this.goLevel0();
    if (n === 1) return this.goLevel1();
    if (n === 2) return this.level2(args.slice(1));
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
  goLevel0() {
    if (typeof Level1 !== "undefined") Level1.resetVisuals();
    if (typeof Level2 !== "undefined") Level2.reset();
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
    if (typeof Level2 !== "undefined") Level2.reset();
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
      if (!Level1.active) return this.toast("SMILERS ARE LEVEL 1 ONLY");
      const ahead = this.ahead(8);
      const s = SmilerSystem.makeSmiler({ x: ahead.x, z: ahead.z });
      if (s) s.forced = true;
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
    else this.goLevel0();
    this.toast("SEEDED " + (GameState.seed >>> 0));
  },
  exitInfo() {
    let target = null;
    if (GameState.level === 2 && typeof Level2 !== "undefined" && Level2.exitPos) target = Level2.exitPos;
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
