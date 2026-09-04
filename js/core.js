/* Backrooms Runner — partitioned source.
 * Extracted from the working Rev. 9 game.js.
 * This file is intentionally a classic script so the existing shared game state
 * remains available to the other partitioned files.
 */

"use strict";

"use strict";

/* ------------------------------------------------------------------
   CONFIG
   ------------------------------------------------------------------ */
const CONFIG = {
  tile: 2.0,
  wallH: 3.15,
  wallT: 2.0,
  player: {
    radius: 0.34,
    heightStand: 1.72,
    heightCrouch: 1.02,
    eyeOffset: 0.12,
    walkSpeed: 4.6,
    sprintSpeed: 8.15,
    crouchSpeed: 2.15,
    slideSpeed: 9.4,
    accel: 28,
    airAccel: 8,
    friction: 18,
    airFriction: 1.2,
    gravity: 24,
    jumpVel: 7.4,
    maxFall: 28,
    slideDuration: 0.72,
    stepEpsilon: 0.012,
    sprintJumpMult: 1.12,
    maxHp: 100
  },
  stamina: {
    max: 100,
    drain: 8,
    crouchDrain: 0.25,
    walkDrain: 0.50,
    sprintDrain: 1.0,
    sprintJumpDrain: 1.0,
    drain: 1.0,
    regen: 0.33,
    delay: 2.5,
    moveThreshold: 0.38
  },
  entity: {
    walkSpeed: 3.35,
    chaseSpeed: 6.15,
    radius: 0.38,
    height: 1.85,
    visionRange: 22,
    fovDeg: 78,
    crouchVisMult: 0.58,
    hearCrouch: 6,
    hearWalk: 14,
    hearSprint: 28,
    hearLand: 22,
    hearJump: 16,
    repath: 0.45,
    senseInterval: 0.18,
    searchTime: 11,
    pauseMin: 0.7,
    pauseMax: 2.4,
    contactDist: 1.85,
    damagePerSec: 10
  },
  chase: {
    redMin: 6,
    redMax: 28,
    redMaxOpacity: 0.72,
    runFlash: 0.85
  },
  lookSens: 0.00215,
  fogColor: 0xd7c57a,
  fogNear: 48,
  fogFar: 140,
  cameraFar: 180,
  cameraFov: 72,
  sprintFov: 78,
  /* VERSION 3: point these at local files to replace generated textures
     e.g. wall: "textures/wallpaper.jpg" */
  textures: {
    wall: null,
    wallAlt: null,
    carpet: null,
    carpetDark: null,
    ceiling: null
  },
  gen: {
    minPath: 500,
    maxPath: 1000,
    exitSpacing: 500,
    exitChainMax: 1000,
    maxExits: 4
  },
  encounter: {
    startTime: 240,
    guaranteeTime: 480,
    checkInterval: 5,
    distStep: 10,
    distWeight: 0.0007,
    distWeightMax: 0.08,
    pathMin: 50,
    pathMax: 100,
    baseCheck: 0.004,
    maxCheck: 0.38,
    curveExp: 2.15
  },
  audio: {
    master: 0.55,
    ambient: 0.028,
    footsteps: 0.22,
    events: 0.18
  },
  sanity: {
    max: 100,
    drain: 0.12,
    chaseDrain: 0.2,
    restoreDrink: 10,
    hpRegenSanityNeed: 20,
    hpRegenStaminaNeed: 10,
    hpRegenRate: 2,
    hpRegenDelay: 5
  },
  items: {
    regionSize: 150,
    almondChance: 0.01,
    // Level 1 parking lots are more resource-friendly than maintenance areas.
    parkingAlmondChance: 0.015,
    almondAttempts: 15,
    almondMaxPerRegion: 5,
    energyChance: 0.003,
    energyAttempts: 20,
    energyMaxPerRegion: 5,
    maxCarry: 5,
    interactDist: 1.85
  },
  hudColors: {
    green: [61, 186, 92],
    yellow: [212, 192, 74],
    orange: [212, 122, 44],
    red: [176, 48, 36],
    dark: [90, 22, 16]
  },
  keys: {
    forward: "KeyW",
    backward: "KeyS",
    left: "KeyA",
    right: "KeyD",
    crouch: "KeyC",
    sprint: "ShiftLeft",
    jump: "Space",
    inventory: "KeyI",
    drink: "KeyQ",
    use: "KeyE",
    flashlight: "KeyF",
    nearestExit: "KeyN",
    regenerate: "KeyG",
    respawn: "KeyR"
  },
  flashlight: {
    // Deliberately powerful: Level 1 blackouts are nearly pitch black.
    intensity: 42.0,
    distance: 68,
    angle: 0.50,
    penumbra: 0.30,
    decay: 1.0,
    smilerExposureTime: 1.8
  },
  envEvents: {
    startMin: 60,
    startMax: 90,
    checkInterval: 10,
    chance: 0.05,
    cooldownMin: 60,
    cooldownMax: 90,
    flickerDur: 1.6,
    failDur: 8,
    darkDur: 7,
    behindDur: 6,
    surgeDur: 0.9,
    visualDur: 0.28
  }
};

/* Restore user key bindings before gameplay starts. */
try {
  const savedBindings = JSON.parse(localStorage.getItem("backroomsRunner.bindings.v1") || "null");
  if (savedBindings && typeof savedBindings === "object") {
    Object.keys(CONFIG.keys).forEach(action => {
      if (typeof savedBindings[action] === "string" && savedBindings[action]) CONFIG.keys[action] = savedBindings[action];
    });
  }
} catch (_) {}

/* ------------------------------------------------------------------
   GAME STATE
   ------------------------------------------------------------------ */
const GameState = {
  phase: "start", // start | playing | complete
  elapsed: 0,
  distance: 0,
  lastTime: 0,
  ready: false,
  debug: false,
  debugViz: false,
  seed: 0,
  level0Seed: 0,
  inventoryOpen: false,
  fps: 0,
  exitReached: false,
  elevatorShake: 0,
  level: 0,
  cinematicCamera: false,
  regenerating: false,
  levelTimes: { 0: 0, 1: 0 }
};

/* ------------------------------------------------------------------
   INPUT
   ------------------------------------------------------------------ */
const Input = {
  keys: Object.create(null),
  mouseDX: 0,
  mouseDY: 0,
  locked: false,
  ctrlDown: false,
  resetMouse() { this.mouseDX = 0; this.mouseDY = 0; }
};

function bindingCode(action) {
  return CONFIG.keys[action];
}

function isActionDown(action) {
  const code = bindingCode(action);
  if (!code) return false;
  if (Input.keys[code]) return true;
  // Preserve both physical Shift/Ctrl keys when their primary binding is the
  // default modifier, while custom bindings remain single-key bindings.
  if (code === "ShiftLeft") return !!(Input.keys.ShiftLeft || Input.keys.ShiftRight);
  if (code === "ControlLeft") return !!(Input.keys.ControlLeft || Input.keys.ControlRight);
  return false;
}

function isGameplayKey(code) {
  const configured = Object.values(CONFIG.keys);
  return configured.includes(code) || [
    "KeyW", "KeyA", "KeyS", "KeyD", "KeyC", "KeyR", "KeyG",
    "KeyI", "KeyQ", "KeyE", "KeyF", "KeyN", "Space",
    "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "F3"
  ].includes(code);
}

window.addEventListener("keydown", (e) => {
  if (e.code === "ControlLeft" || e.code === "ControlRight") Input.ctrlDown = true;
  Input.keys[e.code] = true;

  const playing = GameState.phase === "playing" || GameState.phase === "complete";
  if (e.code === "Escape" && GameState.phase === "playing" && !GameState.inventoryOpen && !Stairwell.sequenceActive) {
    if (Input.locked) {
      // First Escape releases pointer lock and opens the pause menu.
      setPauseOverlay(true);
    } else {
      // A second Escape while paused resumes the current run.
      const resume = document.getElementById("pause-resume");
      if (resume) resume.click();
    }
  }
  if (playing || Input.locked) {
    if (e.ctrlKey || e.metaKey || e.altKey || isGameplayKey(e.code)) {
      e.preventDefault();
    }
  } else if (["Space", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
    e.preventDefault();
  }

  if (e.code === CONFIG.keys.respawn && GameState.phase === "playing") {
    Checkpoints.respawn();
  }
  if (e.code === CONFIG.keys.regenerate && GameState.ready && (GameState.phase === "playing" || GameState.phase === "complete" || GameState.phase === "start")) {
    if (e.repeat || GameState.regenerating) return;
    e.preventDefault();
    Game.regenerate();
  }
  if (e.ctrlKey && e.shiftKey && e.altKey && (e.code === "KeyD" || e.key === "d" || e.key === "D")) {
    e.preventDefault();
    GameState.debug = !GameState.debug;
    const panel = document.getElementById("debug-panel");
    if (panel) panel.style.display = GameState.debug ? "block" : "none";
    if (!GameState.debug) DebugPath.hide();
    return;
  }
  if (e.code === "F3") {
    e.preventDefault();
    GameState.debugViz = !GameState.debugViz;
  }
  if (e.code === CONFIG.keys.flashlight && GameState.ready && GameState.phase === "playing" && !e.repeat) {
    e.preventDefault();
    Flashlight.toggle();
  }
  if (e.code === CONFIG.keys.nearestExit && GameState.ready && GameState.phase === "playing" && !e.repeat) {
    e.preventDefault();
    if (GameState.level === 1 && typeof ExitLocator !== "undefined") ExitLocator.toggle();
    else HUD.toast("NEAREST EXIT: LEVEL 1 ONLY");
  }
  if (e.code === CONFIG.keys.inventory && GameState.ready && GameState.phase === "playing") {
    e.preventDefault();
    Inventory.toggle();
  }
  if (e.code === CONFIG.keys.drink && GameState.ready && GameState.phase === "playing") {
    e.preventDefault();
    Inventory.use("almondWater");
  }
  if (e.ctrlKey && e.shiftKey && e.altKey && (e.code === "KeyE" || e.key === "e" || e.key === "E")) {
    if (GameState.debug) {
      e.preventDefault();
      DebugPath.toggle();
    }
    return;
  }
  if (e.code === CONFIG.keys.use && GameState.ready && GameState.phase === "playing" && !GameState.inventoryOpen && !e.repeat) {
    e.preventDefault();
    PickupSystem.tryPickup();
  }
}, true);
window.addEventListener("keyup", (e) => {
  Input.keys[e.code] = false;
  if (e.code === "ControlLeft" || e.code === "ControlRight") {
    Input.ctrlDown = !!(Input.keys.ControlLeft || Input.keys.ControlRight);
  }
  if (Input.locked || GameState.phase === "playing") e.preventDefault();
}, true);
function clearInput() {
  Input.keys = Object.create(null);
  Input.ctrlDown = false;
}
function setPauseOverlay(show) {
  const el = document.getElementById("pause-overlay");
  if (el) el.style.display = show ? "flex" : "none";
}
window.addEventListener("blur", clearInput);
window.addEventListener("focus", clearInput);
document.addEventListener("visibilitychange", () => { if (document.hidden) clearInput(); });

document.addEventListener("mousemove", (e) => {
  if (!Input.locked) return;
  Input.mouseDX += e.movementX || 0;
  Input.mouseDY += e.movementY || 0;
});

document.addEventListener("pointerlockchange", () => {
  Input.locked = !!(renderer && document.pointerLockElement === renderer.domElement);
  if (!Input.locked) clearInput();
  const paused = GameState.phase === "playing" && !Input.locked && !GameState.inventoryOpen && !Stairwell.sequenceActive;
  setPauseOverlay(paused);
  const note = document.getElementById("pause-note");
  if (note) note.style.display = "none";
});

/* ------------------------------------------------------------------
   AUDIO MANAGER
   Categories: ambient / footsteps / electrical / events / entity
   Generated WebAudio now; swap buffers via AudioSystem.loadBank() later.
   ------------------------------------------------------------------ */
const AudioSystem = {
  ctx: null,
  master: null,
  buses: {},
  listener: null,
  humNodes: [],
  lastStep: 0,
  roomSize: 1,
  enabled: true,

  init() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    } catch (err) { this.ctx = null; }
    if (!this.ctx) return;
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.audio.master;
    this.master.connect(this.ctx.destination);
    const names = ["ambient", "footsteps", "electrical", "events", "entity"];
    for (let i = 0; i < names.length; i++) {
      const g = this.ctx.createGain();
      g.gain.value = names[i] === "ambient" ? CONFIG.audio.ambient
        : names[i] === "footsteps" ? CONFIG.audio.footsteps
        : names[i] === "events" ? CONFIG.audio.events
        : 0.16;
      g.connect(this.master);
      this.buses[names[i]] = g;
    }
  },
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  loadBank(_map) { /* later: decode file buffers per category/key */ },

  setListener(pos, yaw) {
    if (!this.ctx || !this.ctx.listener) return;
    const l = this.ctx.listener;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, this.ctx.currentTime);
      l.positionY.setValueAtTime(pos.y + 1.5, this.ctx.currentTime);
      l.positionZ.setValueAtTime(pos.z, this.ctx.currentTime);
      l.forwardX.setValueAtTime(fx, this.ctx.currentTime);
      l.forwardY.setValueAtTime(0, this.ctx.currentTime);
      l.forwardZ.setValueAtTime(fz, this.ctx.currentTime);
      l.upX.setValueAtTime(0, this.ctx.currentTime);
      l.upY.setValueAtTime(1, this.ctx.currentTime);
      l.upZ.setValueAtTime(0, this.ctx.currentTime);
    } else if (l.setPosition) {
      l.setPosition(pos.x, pos.y + 1.5, pos.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  },

  _tone(freq, type, dur, gain, bus, dest) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.buses[bus || "events"] || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  _noise(dur, gain, bus, dest, hp, lp) {
    if (!this.ctx) return;
    const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    let node = src;
    if (hp) {
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      node.connect(f);
      node = f;
    }
    if (lp) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(Math.max(0.0001, gain), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(dest || this.buses[bus || "events"] || this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  playPositional(kind, x, y, z, opts) {
    if (!this.ctx) return;
    opts = opts || {};
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = opts.ref || 6;
    panner.maxDistance = opts.max || 90;
    panner.rolloffFactor = 1.15;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else if (panner.setPosition) panner.setPosition(x, y, z);
    const bus = this.buses[opts.bus || "events"] || this.master;
    panner.connect(bus);
    const gain = (opts.gain == null ? 0.08 : opts.gain) * (0.85 + this.roomSize * 0.15);
    if (kind === "thump") this._tone(48 + Math.random() * 18, "sine", 0.45, gain, "events", panner);
    else if (kind === "metal") { this._tone(420 + Math.random() * 80, "triangle", 0.18, gain * 0.5, "events", panner); this._noise(0.22, gain * 0.35, "events", panner, 800, 2400); }
    else if (kind === "pipe") this._tone(180 + Math.random() * 40, "square", 0.12, gain * 0.25, "events", panner);
    else if (kind === "pop") this._noise(0.07, gain * 0.4, "electrical", panner, 900, 4000);
    else if (kind === "creak") this._tone(90 + Math.random() * 30, "sawtooth", 0.55, gain * 0.18, "events", panner);
    else if (kind === "impact") { this._tone(62, "sine", 0.35, gain * 0.8, "events", panner); this._noise(0.2, gain * 0.3, "events", panner, 80, 600); }
    else if (kind === "flicker") this._noise(0.05, gain * 0.22, "electrical", panner, 1200, 5000);
    else this._tone(70, "sine", 0.2, gain, "events", panner);
  },

  playEntitySound(kind, x, y, z, opts) {
    const o = opts || {};
    o.bus = "entity";
    this.playPositional(kind, x, y, z, o);
  },

  footstepOn(material, mode) {
    if (!this.ctx) return;
    const sprint = mode === "sprint";
    const crouch = mode === "crouch";
    if (crouch && Math.random() < 0.45) return;
    const hard = material === "concrete";
    const pitch = ((crouch ? 70 : sprint ? 105 : 88) * (hard ? 1.35 : 1)) * (0.92 + Math.random() * 0.16);
    const gain = (crouch ? 0.012 : sprint ? 0.055 : 0.028) * (hard ? 1.25 : 1) * (0.8 + Math.random() * 0.4);
    const dur = crouch ? 0.05 : sprint ? 0.04 : 0.055;
    this._noise(dur, gain, "footsteps", null, hard ? 200 : 80, pitch * (hard ? 6 : 4));
    this._tone(pitch, hard ? "triangle" : "sine", dur * (hard ? 1.4 : 1.1), gain * (hard ? 0.22 : 0.35), "footsteps");
  },
  footstep() { this.footstepOn("carpet", "walk"); },
  sprintFootstep() { this.footstepOn("carpet", "sprint"); },
  crouchFootstep() { this.footstepOn("carpet", "crouch"); },
  jump() { this._tone(150 + Math.random() * 20, "sine", 0.06, 0.03, "footsteps"); },
  land() { this._noise(0.09, 0.05, "footsteps", null, 40, 280); this._tone(64, "sine", 0.08, 0.03, "footsteps"); },

  ambientHumStart() {
    if (!this.ctx || this.humNodes.length) return;
    const makeHum = (freq, type, gain, lfoRate) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = lfoRate;
      lg.gain.value = gain * 0.18;
      lfo.connect(lg);
      lg.connect(g.gain);
      o.connect(g);
      g.connect(this.buses.ambient);
      o.start();
      lfo.start();
      this.humNodes.push(o, lfo, g);
    };
    makeHum(112, "sine", 0.55, 0.07);
    makeHum(58, "sine", 0.35, 0.04);
    // ventilation rumble
    makeHum(41, "triangle", 0.12, 0.03);
  },
  setRoomAmbience(size01) {
    this.roomSize = size01;
    if (this.buses.ambient) {
      this.buses.ambient.gain.value = CONFIG.audio.ambient * (0.85 + size01 * 0.35);
    }
  },
  entitySound() { /* VERSION 4 — use playEntitySound */ },
  stopAll() {
    for (let i = 0; i < this.humNodes.length; i++) {
      try { if (this.humNodes[i].stop) this.humNodes[i].stop(); } catch (e) {}
    }
    this.humNodes = [];
  }
};

/* ------------------------------------------------------------------
   LIGHTING — basic now. VERSION 3 should replace internals.
   ------------------------------------------------------------------ */
const LightingSystem = {
  lights: [],
  fixtures: [],
  units: [],
  hemi: null,
  ambient: null,
  eventTimer: 0,
  clusterUntil: 0,
  init(scene) {
    // Soft fill only — fixtures do the real illumination (VERSION 3 can retune)
    this.hemi = new THREE.HemisphereLight(0xffefc2, 0x6a5a28, 0.38);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xc8b56a, 0.34);
    scene.add(this.ambient);
    scene.fog = new THREE.Fog(CONFIG.fogColor, CONFIG.fogNear, CONFIG.fogFar);
    scene.background = new THREE.Color(CONFIG.fogColor);
  },
  addFluorescent(scene, x, y, z, withPoint, intensityScale, forcedState) {
    const housing = new THREE.Mesh(Geometries.lightHousing, Materials.lightHousing);
    housing.position.set(x, y + 0.02, z);
    scene.add(housing);
    this.fixtures.push(housing);

    const panelMat = Materials.light.clone();
    const panel = new THREE.Mesh(Geometries.lightPanel, panelMat);
    panel.position.set(x, y - 0.04, z);
    panel.rotation.x = Math.PI / 2;
    scene.add(panel);
    this.fixtures.push(panel);

    const roll = Math.random();
    let state = forcedState || "NORMAL";
    if (!forcedState) {
      if (roll < 0.012) state = "BROKEN";
      else if (roll < 0.05) state = "FLICKERING";
      else if (roll < 0.14) state = "DIM";
    }

    let light = null;
    const base = (intensityScale == null ? 1 : intensityScale) * 1.6;
    if (withPoint && state !== "BROKEN") {
      light = new THREE.PointLight(0xfff1c4, state === "DIM" ? base * 0.45 : base, 20, 1.55);
      light.position.set(x, y - 0.28, z);
      scene.add(light);
      this.lights.push(light);
    }
    if (state === "BROKEN") {
      panelMat.emissiveIntensity = 0.05;
      panelMat.color.setHex(0x9a9070);
    } else if (state === "DIM") {
      panelMat.emissiveIntensity = 0.45;
    }

    const unit = {
      state: state,
      homeState: state,
      x: x, y: y, z: z,
      light: light,
      panel: panel,
      panelMat: panelMat,
      baseIntensity: base,
      flickerT: Math.random() * 10,
      flickerPhase: Math.random() * Math.PI * 2,
      burstLeft: 0
    };
    this.units.push(unit);
    return unit;
  },
  setFixtureState(unit, state) {
    if (!unit) return;
    unit.state = state;
    if (state === "BROKEN") {
      if (unit.light) unit.light.intensity = 0;
      unit.panelMat.emissiveIntensity = 0.04;
    } else if (state === "DIM") {
      if (unit.light) unit.light.intensity = unit.baseIntensity * 0.42;
      unit.panelMat.emissiveIntensity = 0.4;
    } else if (state === "NORMAL") {
      if (unit.light) unit.light.intensity = unit.baseIntensity;
      unit.panelMat.emissiveIntensity = 1.35;
    }
  },
  triggerClusterEvent(cx, cz, radius) {
    const r2 = (radius || 18) * (radius || 18);
    const picked = [];
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const dx = u.x - cx, dz = u.z - cz;
      if (dx * dx + dz * dz <= r2) picked.push(u);
    }
    if (picked.length < 2) return;
    for (let i = 0; i < picked.length; i++) {
      const u = picked[i];
      if (i < picked.length * 0.35) this.setFixtureState(u, "BROKEN");
      else this.setFixtureState(u, "FLICKERING");
    }
    this.clusterUntil = 2.8 + Math.random() * 2.2;
    AudioSystem.playPositional("pop", cx, 2.6, cz, { gain: 0.07, bus: "electrical" });
  },
  update(dt) {
    if (this.clusterUntil > 0) {
      this.clusterUntil -= dt;
      if (this.clusterUntil <= 0) {
        for (let i = 0; i < this.units.length; i++) {
          if (this.units[i].homeState) this.setFixtureState(this.units[i], this.units[i].homeState);
        }
      }
    }
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.state !== "FLICKERING") continue;
      u.flickerT -= dt;
      if (u.flickerT <= 0) {
        u.burstLeft = 0.12 + Math.random() * 0.55;
        u.flickerT = 0.4 + Math.random() * 2.8;
        if (Math.random() < 0.35) {
          AudioSystem.playPositional("flicker", u.x, u.y, u.z, { gain: 0.03, bus: "electrical", max: 24 });
        }
      }
      let amp = 0.72;
      if (u.burstLeft > 0) {
        u.burstLeft -= dt;
        amp = Math.random() < 0.55 ? (0.15 + Math.random() * 0.5) : (0.7 + Math.random() * 0.5);
      } else {
        amp = 0.55 + Math.sin(performance.now() * 0.012 + u.flickerPhase) * 0.2;
      }
      if (u.light) u.light.intensity = u.baseIntensity * amp;
      u.panelMat.emissiveIntensity = 0.35 + amp * 0.9;
    }
  },
  triggerNearPlayer(pos) {
    this.triggerClusterEvent(pos.x, pos.z, 16);
  },
  snapshot(unit) {
    if (!unit) return null;
    return { state: unit.state, inten: unit.light ? unit.light.intensity : 0, em: unit.panelMat.emissiveIntensity };
  },
  applySnapshot(unit, snap) {
    if (!unit || !snap) return;
    unit.state = snap.state;
    if (unit.light) unit.light.intensity = snap.inten;
    unit.panelMat.emissiveIntensity = snap.em;
  },
  unitsNear(x, z, maxDist, limit) {
    const out = [];
    const md = maxDist || 28;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= md) out.push({ u: u, d: d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, limit || 8).map((o) => o.u);
  },
  unitsInBand(x, z, minD, maxD) {
    const out = [];
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const d = Math.hypot(u.x - x, u.z - z);
      if (d >= minD && d <= maxD) out.push(u);
    }
    return out;
  },
  clear(sceneRef) {
    const s = sceneRef || scene;
    if (!s) return;
    for (let i = 0; i < this.lights.length; i++) s.remove(this.lights[i]);
    for (let i = 0; i < this.fixtures.length; i++) s.remove(this.fixtures[i]);
    this.lights.length = 0;
    this.fixtures.length = 0;
    this.units.length = 0;
    this.clusterUntil = 0;
  },
  // VERSION 3 hooks
  setFlickerEnabled(_on) {},
  failRandomLight() {},
  setEmergencyMode(_on) {},
  setFogDensity(near, far) {
    CONFIG.fogNear = near;
    CONFIG.fogFar = far;
    if (scene && scene.fog) {
      scene.fog.near = near;
      scene.fog.far = far;
    }
  }
};

