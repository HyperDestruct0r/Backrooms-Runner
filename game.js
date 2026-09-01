/* =============================================================================
     BACKROOMS RUNNER — VERSION 1 PROTOTYPE
     Systems: Game / Input / Player / Physics / Collision / Level / Checkpoints
              HUD / Audio / Lighting / GameState
     Future hooks are marked VERSION 2–5.
     ========================================================================== */

  (function () {
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
        hpRegenNeed: 80,
        hpRegenRate: 0.2
      },
      items: {
        regionSize: 150,
        almondChance: 0.01,
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
        inventory: "KeyI",
        drink: "KeyQ",
        use: "KeyE",
        flashlight: "KeyF"
      },
      flashlight: {
        intensity: 1.35,
        distance: 18,
        angle: 0.38,
        penumbra: 0.45,
        decay: 1.6
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
      inventoryOpen: false,
      fps: 0,
      exitReached: false,
      elevatorShake: 0,
      level: 0,
      cinematicCamera: false,
      regenerating: false
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

    function isGameplayKey(code) {
      return code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD" ||
        code === "KeyC" || code === "KeyR" || code === "KeyG" ||
        code === "KeyI" || code === "KeyQ" || code === "KeyE" || code === "KeyF" ||
        code === "Space" || code === "ShiftLeft" || code === "ShiftRight" ||
        code === "ControlLeft" || code === "ControlRight" || code === "F3";
    }

    window.addEventListener("keydown", (e) => {
      if (e.code === "ControlLeft" || e.code === "ControlRight") Input.ctrlDown = true;
      Input.keys[e.code] = true;

      const playing = GameState.phase === "playing" || GameState.phase === "complete";
      if (e.code === "Escape" && GameState.phase === "playing" && !GameState.inventoryOpen && !Stairwell.sequenceActive) {
        // Pointer Lock will normally be released by Escape; show the pause UI
        // immediately as well so the player gets clear feedback.
        setPauseOverlay(true);
      }
      if (playing || Input.locked) {
        if (e.ctrlKey || e.metaKey || e.altKey || isGameplayKey(e.code)) {
          e.preventDefault();
        }
      } else if (["Space", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        e.preventDefault();
      }

      if (e.code === "KeyR" && GameState.phase === "playing") {
        Checkpoints.respawn();
      }
      if (e.code === "KeyG" && GameState.ready && (GameState.phase === "playing" || GameState.phase === "complete" || GameState.phase === "start")) {
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
      const paused = GameState.phase === "playing" && !Input.locked && !GameState.inventoryOpen;
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

    /* ------------------------------------------------------------------
       SHARED GEOMETRY / MATERIALS / PROCEDURAL TEXTURES
       Swap CONFIG.textures.* to local files later without changing materials.
       ------------------------------------------------------------------ */
    const Geometries = {};
    const Materials = {};
    const TextureFactory = {
      loader: null,
      makeCanvas(size) {
        const c = document.createElement("canvas");
        c.width = size;
        c.height = size;
        return c;
      },
      hash(x, y) {
        let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
        return n - Math.floor(n);
      },
      noise(x, y) {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const h = this.hash.bind(this);
        const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      },
      fbm(x, y) {
        return this.noise(x, y) * 0.55 + this.noise(x * 2.1, y * 2.1) * 0.3 + this.noise(x * 4.3, y * 4.3) * 0.15;
      },
      toTexture(canvas) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 8;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      },
      fromConfigOrCanvas(key, builder) {
        if (CONFIG.textures[key] && this.loader) {
          const tex = this.loader.load(CONFIG.textures[key]);
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          return tex;
        }
        return builder();
      },
      wallpaper(seed, warmth) {
        const size = 512;
        const c = this.makeCanvas(size);
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n = this.fbm(x * 0.035 + seed, y * 0.05 + seed * 1.7);
            const n2 = this.fbm(x * 0.12 + 9, y * 0.09 + 4);
            const stripe = Math.sin((x + n2 * 6) * Math.PI * 2 / 18) * 0.5 + 0.5;
            const fine = this.hash(x * 0.7 + seed, y * 1.9) * 0.08;
            let stain = this.fbm(x * 0.02 + seed * 3, y * 0.018);
            stain = stain > 0.62 ? (stain - 0.62) * 0.55 : 0;
            const speckle = this.hash(x + y * 13 + seed * 20, y * 3) > 0.97 ? 0.07 : 0;
            const baseR = 226 + warmth;
            const baseG = 206 + warmth * 0.4;
            const baseB = 108 + warmth * 0.15;
            let r = baseR + (n - 0.5) * 22 + stripe * 10 - stain * 38 - speckle * 40 + fine * 20;
            let g = baseG + (n - 0.5) * 18 + stripe * 8 - stain * 32 - speckle * 30 + fine * 16;
            let b = baseB + (n - 0.5) * 10 + stripe * 4 - stain * 18 + fine * 8;
            const i = (y * size + x) * 4;
            d[i] = Math.max(0, Math.min(255, r));
            d[i + 1] = Math.max(0, Math.min(255, g));
            d[i + 2] = Math.max(0, Math.min(255, b));
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return this.toTexture(c);
      },
      carpet() {
        const size = 512;
        const c = this.makeCanvas(size);
        const ctx = c.getContext("2d");
        const img = ctx.createImageData(size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n = this.fbm(x * 0.08, y * 0.08);
            const fiber = this.hash(x * 3.1, y * 0.4) * 0.12 + this.hash(x * 0.3, y * 2.7) * 0.1;
            const fleck = this.hash(x * 1.7, y * 2.3) > 0.93 ? -18 : 0;
            const r = 188 + (n - 0.5) * 28 + fiber * 22 + fleck;
            const g = 154 + (n - 0.5) * 22 + fiber * 14 + fleck * 0.7;
            const b = 62 + (n - 0.5) * 12 + fiber * 6;
            const i = (y * size + x) * 4;
            d[i] = Math.max(0, Math.min(255, r));
            d[i + 1] = Math.max(0, Math.min(255, g));
            d[i + 2] = Math.max(0, Math.min(255, b));
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return this.toTexture(c);
      },
      concrete() {
        const size = 512;
        const c = this.makeCanvas(size);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#8a8a84";
        ctx.fillRect(0, 0, size, size);
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n = this.fbm(x * 0.035, y * 0.035);
            const n2 = this.fbm(x * 0.12, y * 0.12);
            const stain = this.hash(x * 0.07, y * 0.09) > 0.97 ? -22 : 0;
            const i = (y * size + x) * 4;
            const v = 128 + (n - 0.5) * 28 + (n2 - 0.5) * 14 + stain;
            d[i] = Math.max(70, Math.min(170, v));
            d[i + 1] = Math.max(70, Math.min(168, v - 2));
            d[i + 2] = Math.max(66, Math.min(160, v - 8));
            d[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        return this.toTexture(c);
      },
      chainlink() {
        const size = 256;
        const c = this.makeCanvas(size);
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, size, size);
        ctx.strokeStyle = "rgba(40,40,38,0.92)";
        ctx.lineWidth = 3;
        const cell = 16;
        for (let y = -size; y < size * 2; y += cell) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y + size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(size, y);
          ctx.lineTo(0, y + size);
          ctx.stroke();
        }
        const tex = this.toTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        return tex;
      },
      ceiling() {
        const size = 512;
        const c = this.makeCanvas(size);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#e6dcb0";
        ctx.fillRect(0, 0, size, size);
        const img = ctx.getImageData(0, 0, size, size);
        const d = img.data;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const n = this.fbm(x * 0.04, y * 0.04);
            const i = (y * size + x) * 4;
            d[i] = Math.min(255, d[i] + (n - 0.5) * 16);
            d[i + 1] = Math.min(255, d[i + 1] + (n - 0.5) * 14);
            d[i + 2] = Math.min(255, d[i + 2] + (n - 0.5) * 8);
          }
        }
        ctx.putImageData(img, 0, 0);
        ctx.strokeStyle = "rgba(150,138,80,0.55)";
        ctx.lineWidth = 3;
        const cell = size / 2;
        for (let i = 0; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(i * cell, 0);
          ctx.lineTo(i * cell, size);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, i * cell);
          ctx.lineTo(size, i * cell);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(120,110,60,0.28)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
          ctx.beginPath();
          ctx.moveTo(i * (size / 4), 0);
          ctx.lineTo(i * (size / 4), size);
          ctx.stroke();
        }
        ctx.fillStyle = "rgba(90,80,40,0.35)";
        for (let gy = 0; gy < 2; gy++) {
          for (let gx = 0; gx < 2; gx++) {
            ctx.fillRect(gx * cell + 6, gy * cell + 6, 4, 4);
            ctx.fillRect(gx * cell + cell - 10, gy * cell + 6, 4, 4);
            ctx.fillRect(gx * cell + 6, gy * cell + cell - 10, 4, 4);
            ctx.fillRect(gx * cell + cell - 10, gy * cell + cell - 10, 4, 4);
          }
        }
        return this.toTexture(c);
      }
    };

    function applyBoxUVs(geometry, w, h, d, tilesPerMeter) {
      const uv = geometry.attributes.uv;
      const t = tilesPerMeter || 0.5;
      const faces = [
        [d * t, h * t],
        [d * t, h * t],
        [w * t, d * t],
        [w * t, d * t],
        [w * t, h * t],
        [w * t, h * t]
      ];
      for (let f = 0; f < 6; f++) {
        const i = f * 4;
        const us = faces[f][0], vs = faces[f][1];
        uv.setXY(i + 0, 0, vs);
        uv.setXY(i + 1, us, vs);
        uv.setXY(i + 2, 0, 0);
        uv.setXY(i + 3, us, 0);
      }
      uv.needsUpdate = true;
      return geometry;
    }

    function makeWorldBox(w, h, d, tilesPerMeter) {
      const g = new THREE.BoxGeometry(w, h, d);
      return applyBoxUVs(g, w, h, d, tilesPerMeter);
    }

    function initAssets() {
      TextureFactory.loader = new THREE.TextureLoader();
      Geometries.box = new THREE.BoxGeometry(1, 1, 1);
      Geometries.lightPanel = new THREE.PlaneGeometry(1.55, 0.42);
      Geometries.lightHousing = new THREE.BoxGeometry(1.72, 0.08, 0.58);
      Geometries.floorTile = new THREE.PlaneGeometry(CONFIG.tile, CONFIG.tile);
      Geometries.column = makeWorldBox(0.55, CONFIG.wallH, 0.55, 0.55);
      Geometries.beam = new THREE.BoxGeometry(1, 0.1, 0.18);

      const wallMap = TextureFactory.fromConfigOrCanvas("wall", () => TextureFactory.wallpaper(1.2, 0));
      const wallAltMap = TextureFactory.fromConfigOrCanvas("wallAlt", () => TextureFactory.wallpaper(4.8, -8));
      const carpetMap = TextureFactory.fromConfigOrCanvas("carpet", () => TextureFactory.carpet());
      const ceilingMap = TextureFactory.fromConfigOrCanvas("ceiling", () => TextureFactory.ceiling());

      Materials.wall = new THREE.MeshStandardMaterial({
        map: wallMap, roughness: 0.86, metalness: 0.02, color: 0xffffff
      });
      Materials.wallAlt = new THREE.MeshStandardMaterial({
        map: wallAltMap, roughness: 0.88, metalness: 0.02, color: 0xf6eec8
      });
      Materials.wallTrim = new THREE.MeshStandardMaterial({
        color: 0xbba24a, roughness: 0.72, metalness: 0.04
      });
      Materials.carpet = new THREE.MeshStandardMaterial({
        map: carpetMap, roughness: 0.97, metalness: 0.0, color: 0xffffff
      });
      Materials.carpetDark = new THREE.MeshStandardMaterial({
        map: carpetMap, roughness: 0.97, metalness: 0.0, color: 0xb89a48
      });
      Materials.ceiling = new THREE.MeshStandardMaterial({
        map: ceilingMap, roughness: 0.9, metalness: 0.0, color: 0xffffff
      });
      Materials.column = new THREE.MeshStandardMaterial({
        map: wallMap, roughness: 0.84, metalness: 0.02, color: 0xf0e4a8
      });
      Materials.light = new THREE.MeshStandardMaterial({
        color: 0xfff6d8, emissive: 0xfff1c2, emissiveIntensity: 1.35, roughness: 0.4, metalness: 0
      });
      Materials.lightHousing = new THREE.MeshStandardMaterial({
        color: 0xcfc8a0, roughness: 0.55, metalness: 0.08
      });
      Materials.checkpoint = new THREE.MeshStandardMaterial({
        color: 0x8fd18f, emissive: 0x1a4a1a, roughness: 0.6, metalness: 0.05
      });
      Materials.exit = new THREE.MeshStandardMaterial({
        color: 0x8fa8d8, emissive: 0x1a2a48, roughness: 0.6, metalness: 0.05
      });
      Materials.frame = new THREE.MeshStandardMaterial({
        color: 0xb8a040, roughness: 0.7, metalness: 0.05
      });
      Materials.beam = new THREE.MeshStandardMaterial({
        color: 0xcfc28a, roughness: 0.78, metalness: 0.04
      });
      const concMap = TextureFactory.concrete();
      Materials.concrete = new THREE.MeshStandardMaterial({
        map: concMap, roughness: 0.90, metalness: 0.02, color: 0xc2c0ba
      });
      Materials.concreteDark = new THREE.MeshStandardMaterial({
        map: concMap, roughness: 0.93, metalness: 0.01, color: 0x8f8d87
      });
      Materials.nosing = new THREE.MeshStandardMaterial({
        color: 0xc9b23a, roughness: 0.55, metalness: 0.08, emissive: 0x2a2208, emissiveIntensity: 0.12
      });
      const meshMap = TextureFactory.chainlink();
      meshMap.repeat.set(6, 4);
      Materials.chainlink = new THREE.MeshStandardMaterial({
        map: meshMap, transparent: true, roughness: 0.7, metalness: 0.15,
        color: 0x2a2a28, side: THREE.DoubleSide, depthWrite: false
      });
      Materials.tube = new THREE.MeshStandardMaterial({
        color: 0xf4f0d8, emissive: 0xfff4c8, emissiveIntensity: 1.6, roughness: 0.25
      });
    }

    /* ------------------------------------------------------------------
       SEEDED RNG + PROCEDURAL LEVEL 0
       Modules occupy a cell grid, then stamp tiles for the existing
       collider / mesh / lighting pipeline.
       VERSION 4 entities can query MapGraph / Module records.
       ------------------------------------------------------------------ */
    const TILE = { WALL: 1, FLOOR: 0, START: 2, CHECK: 3, EXIT: 4, COLUMN: 5, DEAD: 6 };

    function mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const DIR4 = [
      { x: 0, z: -1, name: "N" },
      { x: 1, z: 0, name: "E" },
      { x: 0, z: 1, name: "S" },
      { x: -1, z: 0, name: "W" }
    ];
    function oppDir(d) { return (d + 2) & 3; }

    const MapGraph = {
      nodes: [],
      edges: [],
      cellOwner: [],
      reset() {
        this.nodes = [];
        this.edges = [];
        this.cellOwner = [];
      },
      nodeAt(gx, gz) {
        if (!this.cellOwner[gz]) return null;
        const id = this.cellOwner[gz][gx];
        if (id == null) return null;
        return this.nodes[id] || null;
      }
    };

    const LevelGenerator = {
      CELL: 6,
      GRID_W: 64,
      GRID_H: 56,
      last: null,

      generate(seed) {
        const rng = mulberry32(seed >>> 0);
        const C = this.CELL;
        const W = this.GRID_W;
        const H = this.GRID_H;
        const cols = W * C;
        const rows = H * C;
        const tiles = [];
        for (let z = 0; z < rows; z++) {
          tiles.push(new Array(cols).fill(TILE.WALL));
        }

        MapGraph.reset();
        MapGraph.cellOwner = [];
        for (let z = 0; z < H; z++) MapGraph.cellOwner.push(new Array(W).fill(null));

        const occupied = [];
        for (let z = 0; z < H; z++) occupied.push(new Array(W).fill(false));

        const self = this;
        function inGrid(gx, gz) { return gx >= 0 && gz >= 0 && gx < W && gz < H; }
        function footprintFree(gx, gz, w, h) {
          if (gx < 0 || gz < 0 || gx + w > W || gz + h > H) return false;
          for (let z = gz; z < gz + h; z++) {
            for (let x = gx; x < gx + w; x++) {
              if (occupied[z][x]) return false;
            }
          }
          return true;
        }
        function markFoot(gx, gz, w, h, nodeId) {
          for (let z = gz; z < gz + h; z++) {
            for (let x = gx; x < gx + w; x++) {
              occupied[z][x] = true;
              MapGraph.cellOwner[z][x] = nodeId;
            }
          }
        }
        function localFloor(gx, gz, lx, lz, val) {
          const tx = gx * C + lx;
          const tz = gz * C + lz;
          if (tz >= 0 && tz < rows && tx >= 0 && tx < cols) tiles[tz][tx] = val;
        }
        function carveArm(gx, gz, dir) {
          // 2-tile-wide passage from cell center to an edge
          if (dir === 0) { // N
            for (let z = 0; z <= 3; z++) { localFloor(gx, gz, 2, z, TILE.FLOOR); localFloor(gx, gz, 3, z, TILE.FLOOR); }
          } else if (dir === 2) { // S
            for (let z = 2; z <= 5; z++) { localFloor(gx, gz, 2, z, TILE.FLOOR); localFloor(gx, gz, 3, z, TILE.FLOOR); }
          } else if (dir === 1) { // E
            for (let x = 2; x <= 5; x++) { localFloor(gx, gz, x, 2, TILE.FLOOR); localFloor(gx, gz, x, 3, TILE.FLOOR); }
          } else { // W
            for (let x = 0; x <= 3; x++) { localFloor(gx, gz, x, 2, TILE.FLOOR); localFloor(gx, gz, x, 3, TILE.FLOOR); }
          }
        }
        function carveRoomCell(gx, gz) {
          for (let z = 1; z <= 4; z++) {
            for (let x = 1; x <= 4; x++) localFloor(gx, gz, x, z, TILE.FLOOR);
          }
        }
        function openInternalEdge(gx0, gz0, gx1, gz1) {
          if (gx0 === gx1 && gz1 === gz0 + 1) {
            for (let x = 1; x <= 4; x++) {
              localFloor(gx0, gz0, x, 5, TILE.FLOOR);
              localFloor(gx1, gz1, x, 0, TILE.FLOOR);
            }
          } else if (gx0 === gx1 && gz0 === gz1 + 1) {
            openInternalEdge(gx1, gz1, gx0, gz0);
          } else if (gz0 === gz1 && gx1 === gx0 + 1) {
            for (let z = 1; z <= 4; z++) {
              localFloor(gx0, gz0, 5, z, TILE.FLOOR);
              localFloor(gx1, gz1, 0, z, TILE.FLOOR);
            }
          } else if (gz0 === gz1 && gx0 === gx1 + 1) {
            openInternalEdge(gx1, gz1, gx0, gz0);
          }
        }
        function linkDoor(ax, az, dir) {
          const bx = ax + DIR4[dir].x;
          const bz = az + DIR4[dir].z;
          if (!inGrid(bx, bz) || !occupied[bz][bx]) return false;
          carveArm(ax, az, dir);
          carveArm(bx, bz, oppDir(dir));
          return true;
        }

        function addNode(type, gx, gz, w, h, extra) {
          const node = {
            id: MapGraph.nodes.length,
            type: type,
            gx: gx,
            gz: gz,
            w: w,
            h: h,
            connections: [],
            deadEnd: type === "dead_end",
            hasExit: false,
            hasCheckpoint: false,
            hasStart: type === "start",
            // Persistent per-module lighting profile.
            lightProfile: (function () {
              const r = rng();
              return r < 0.28 ? "DARK" : (r > 0.78 ? "BRIGHT" : "NORMAL");
            })(),
            dark: false,
            skipLights: false,
            anomaly: null,
            extra: extra || null
          };
          MapGraph.nodes.push(node);
          markFoot(gx, gz, w, h, node.id);
          return node;
        }
        function addEdge(a, b, dir) {
          if (a.connections.indexOf(b.id) < 0) a.connections.push(b.id);
          if (b.connections.indexOf(a.id) < 0) b.connections.push(a.id);
          MapGraph.edges.push({ a: a.id, b: b.id, dir: dir });
        }

        const sockets = []; // {gx,gz,dir,nodeId}

        function pushSockets(node, dirs) {
          for (let i = 0; i < dirs.length; i++) {
            const d = dirs[i];
            let cx = node.gx, cz = node.gz;
            if (d === 1) cx = node.gx + node.w - 1;
            if (d === 2) cz = node.gz + node.h - 1;
            if (d === 0) cz = node.gz;
            if (d === 3) cx = node.gx;
            // pick a perimeter cell for this side
            if (d === 0 || d === 2) cx = node.gx + ((node.w > 1 && rng() > 0.5) ? node.w - 1 : 0);
            if (d === 1 || d === 3) cz = node.gz + ((node.h > 1 && rng() > 0.5) ? node.h - 1 : 0);
            sockets.push({ gx: cx, gz: cz, dir: d, nodeId: node.id });
          }
        }

        function carveModule(node, incomingDir) {
          if (node.type === "room_small" || node.type === "room_large" || node.type === "room_pillar" || node.type === "start" || node.type === "exit_room") {
            for (let z = 0; z < node.h; z++) {
              for (let x = 0; x < node.w; x++) carveRoomCell(node.gx + x, node.gz + z);
            }
            for (let z = 0; z < node.h; z++) {
              for (let x = 0; x < node.w; x++) {
                if (x + 1 < node.w) openInternalEdge(node.gx + x, node.gz + z, node.gx + x + 1, node.gz + z);
                if (z + 1 < node.h) openInternalEdge(node.gx + x, node.gz + z, node.gx + x, node.gz + z + 1);
              }
            }
            if (node.type === "room_pillar" || (node.type === "room_large" && rng() > 0.35)) {
              for (let z = 0; z < node.h; z++) {
                for (let x = 0; x < node.w; x++) {
                  localFloor(node.gx + x, node.gz + z, 2, 2, TILE.COLUMN);
                  if (rng() > 0.45) localFloor(node.gx + x, node.gz + z, 3, 3, TILE.COLUMN);
                }
              }
            }
            if (node.type === "room_small" && rng() > 0.55) {
              localFloor(node.gx, node.gz, 2, 2, TILE.DEAD);
            }
          } else {
            // corridor family: plus-arms, start with incoming so the join exists
            for (let z = 0; z < node.h; z++) {
              for (let x = 0; x < node.w; x++) {
                localFloor(node.gx + x, node.gz + z, 2, 2, TILE.FLOOR);
                localFloor(node.gx + x, node.gz + z, 3, 2, TILE.FLOOR);
                localFloor(node.gx + x, node.gz + z, 2, 3, TILE.FLOOR);
                localFloor(node.gx + x, node.gz + z, 3, 3, TILE.FLOOR);
              }
            }
            for (let z = 0; z < node.h; z++) {
              for (let x = 0; x < node.w; x++) {
                if (x + 1 < node.w) openInternalEdge(node.gx + x, node.gz + z, node.gx + x + 1, node.gz + z);
                if (z + 1 < node.h) openInternalEdge(node.gx + x, node.gz + z, node.gx + x, node.gz + z + 1);
              }
            }
            if (incomingDir != null) {
              // incoming lands on the attachment cell
            }
          }
        }

        function tryPlace(type, attachGX, attachGZ, incomingDir) {
          let w = 1, h = 1;
          if (type === "hall_long") {
            const len = 2 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
            if (incomingDir === 1 || incomingDir === 3) { w = len; h = 1; }
            else { w = 1; h = len; }
          } else if (type === "room_large" || type === "room_pillar") {
            w = 2; h = 2;
            if (rng() < 0.25) { w = 3; h = 2; }
            if (rng() < 0.12) { w = 2; h = 3; }
          } else if (type === "room_small" && rng() < 0.2) {
            w = 2; h = 1;
          }

          // origin so the attachment cell is on the incoming side of the footprint
          let ox = attachGX, oz = attachGZ;
          if (incomingDir === 1) ox = attachGX; // placed to the east, west cell is attach
          if (incomingDir === 3) ox = attachGX - (w - 1);
          if (incomingDir === 2) oz = attachGZ;
          if (incomingDir === 0) oz = attachGZ - (h - 1);

          if (!footprintFree(ox, oz, w, h)) {
            // try 1x1 fallback
            if (w !== 1 || h !== 1) return tryPlace("corridor", attachGX, attachGZ, incomingDir);
            return null;
          }

          const node = addNode(type, ox, oz, w, h, null);
          carveModule(node, incomingDir);
          return node;
        }

        // --- spine first so shortest path can hit 500–1000m, then branches ---
        const targetPath = CONFIG.gen.minPath + rng() * (CONFIG.gen.maxPath - CONFIG.gen.minPath);
        const spineNeed = Math.ceil(targetPath / 11.5) + 3;

        const startGZ = 4 + Math.floor(rng() * (H - 8));
        const startNode = addNode("start", 2, startGZ, 1, 1, null);
        carveModule(startNode, null);

        const spine = [startNode];
        let cgx = 2, cgz = startGZ, cdir = 1, straight = 0;
        let spineGuard = 0;
        while (spine.length < spineNeed && spineGuard++ < 800) {
          const turnNow = straight >= 2 + Math.floor(rng() * 4);
          const order = [];
          if (turnNow) {
            order.push((cdir + (rng() < 0.5 ? 1 : 3)) & 3);
            order.push(cdir);
            order.push((cdir + (rng() < 0.5 ? 3 : 1)) & 3);
          } else {
            order.push(cdir);
            if (rng() < 0.2) order.push((cdir + 1) & 3);
            if (rng() < 0.2) order.push((cdir + 3) & 3);
          }
          let placed = null, usedDir = -1;
          for (let i = 0; i < order.length; i++) {
            const d = order[i];
            const nx = cgx + DIR4[d].x;
            const nz = cgz + DIR4[d].z;
            if (!inGrid(nx, nz) || occupied[nz][nx]) continue;
            let typ = "corridor";
            if (rng() < 0.16) typ = "hall_long";
            else if (rng() < 0.12) typ = "room_small";
            else if (rng() < 0.05) typ = "junction";
            const node = tryPlace(typ === "hall_long" ? "corridor" : typ, nx, nz, d);
            if (!node) continue;
            if (linkDoor(cgx, cgz, d)) addEdge(spine[spine.length - 1], node, d);
            placed = node;
            usedDir = d;
            cgx = d === 1 ? node.gx + node.w - 1 : d === 3 ? node.gx : node.gx;
            cgz = d === 2 ? node.gz + node.h - 1 : d === 0 ? node.gz : node.gz;
            if (d === 1 || d === 3) { cgx = nx; cgz = nz; }
            else { cgx = nx; cgz = nz; }
            break;
          }
          if (!placed) break;
          spine.push(placed);
          if (usedDir === cdir) straight++;
          else { cdir = usedDir; straight = 0; }
        }

        if (spine.length < 20) return null;

        sockets.length = 0;
        for (let i = 1; i < spine.length - 1; i++) {
          if (rng() < 0.55) {
            const n = spine[i];
            const dirs = [];
            for (let d = 0; d < 4; d++) {
              const nx = n.gx + DIR4[d].x, nz = n.gz + DIR4[d].z;
              if (inGrid(nx, nz) && !occupied[nz][nx]) dirs.push(d);
            }
            if (dirs.length) pushSockets(n, [dirs[Math.floor(rng() * dirs.length)]]);
          }
        }
        pushSockets(startNode, rng() < 0.5 ? [0] : [2]);

        // Grow a large, persistent branching network instead of making the
        // non-spine paths terminate after a handful of modules.
        const branchTarget = Math.min(
          W * H - 24,
          spine.length + 105 + Math.floor(rng() * 75)
        );
        let guard = 0;
        while (MapGraph.nodes.length < branchTarget && sockets.length && guard++ < 2600) {
          const si = Math.floor(rng() * sockets.length);
          const sock = sockets[si];
          sockets.splice(si, 1);
          const ngx = sock.gx + DIR4[sock.dir].x;
          const ngz = sock.gz + DIR4[sock.dir].z;
          if (!inGrid(ngx, ngz)) continue;

          if (occupied[ngz][ngx]) {
            continue;
          }

          const roll = rng();
          let type = "corridor";
          if (roll < 0.24) type = "corridor";
          else if (roll < 0.38) type = "hall_long";
          else if (roll < 0.50) type = "corner";
          else if (roll < 0.66) type = "junction";
          else if (roll < 0.79) type = "room_small";
          else if (roll < 0.90) type = "room_large";
          else type = "room_pillar";

          const node = tryPlace(type, ngx, ngz, sock.dir);
          if (!node) continue;
          if (!linkDoor(sock.gx, sock.gz, sock.dir)) {
            // should not happen; keep growing anyway
          }
          addEdge(MapGraph.nodes[sock.nodeId], node, sock.dir);

          // outgoing sockets except the incoming face
          const out = [];
          if (type === "corridor" || type === "hall_long") {
            out.push(sock.dir);
            if (rng() < 0.52) out.push((sock.dir + 1) & 3);
            if (rng() < 0.42) out.push((sock.dir + 3) & 3);
          } else if (type === "corner") {
            out.push(rng() < 0.5 ? ((sock.dir + 1) & 3) : ((sock.dir + 3) & 3));
            if (rng() < 0.32) out.push(sock.dir);
          } else if (type === "junction") {
            out.push(sock.dir);
            out.push((sock.dir + 1) & 3);
            out.push((sock.dir + 3) & 3);
            if (rng() < 0.28) out.push(oppDir(sock.dir));
          } else {
            const cand = [0, 1, 2, 3].filter((d) => d !== oppDir(sock.dir));
            const extra = 2 + (rng() < 0.38 ? 1 : 0);
            for (let k = 0; k < extra && cand.length; k++) {
              const pick = Math.floor(rng() * cand.length);
              out.push(cand[pick]);
              cand.splice(pick, 1);
            }
          }
          pushSockets(node, out);
        }

        // Deliberately add many cross-connections between nearby occupied modules.
        // This keeps the Level 0 layout maze-like but makes intersections and loops
        // much more common than the old mostly-tree generation.
        const seenLinks = new Set();
        for (let gz = 0; gz < H; gz++) {
          for (let gx = 0; gx < W; gx++) {
            if (!occupied[gz][gx]) continue;
            const a = MapGraph.cellOwner[gz][gx];
            if (a == null) continue;
            for (const d of [1, 2]) {
              const nx = gx + DIR4[d].x, nz = gz + DIR4[d].z;
              if (!inGrid(nx, nz) || !occupied[nz][nx]) continue;
              const b = MapGraph.cellOwner[nz][nx];
              if (b == null || a === b) continue;
              const key = a < b ? a + ':' + b : b + ':' + a;
              if (seenLinks.has(key)) continue;
              seenLinks.add(key);
              if (MapGraph.nodes[a].connections.indexOf(b) >= 0) continue;
              // Higher chance at true junction candidates; still deterministic.
              const chance = (MapGraph.nodes[a].type === 'junction' || MapGraph.nodes[b].type === 'junction') ? 0.82 : 0.48;
              if (rng() < chance && linkDoor(gx, gz, d)) addEdge(MapGraph.nodes[a], MapGraph.nodes[b], d);
            }
          }
        }

        // A few extra branch sockets are opened from existing modules so the
        // network grows sideways rather than terminating as often as before.
        for (let i = 0; i < MapGraph.nodes.length; i++) {
          const n = MapGraph.nodes[i];
          if (!n || n.type === 'start') continue;
          const free = [];
          for (let d = 0; d < 4; d++) {
            const nx = n.gx + DIR4[d].x, nz = n.gz + DIR4[d].z;
            if (inGrid(nx, nz) && !occupied[nz][nx]) free.push(d);
          }
          if (free.length && rng() < 0.62) pushSockets(n, [free[Math.floor(rng() * free.length)]]);
        }

        // Graph distance from start
        const dist = new Array(MapGraph.nodes.length).fill(9999);
        dist[startNode.id] = 0;
        const q = [startNode.id];
        while (q.length) {
          const id = q.shift();
          const n = MapGraph.nodes[id];
          for (let i = 0; i < n.connections.length; i++) {
            const nid = n.connections[i];
            if (dist[nid] > dist[id] + 1) {
              dist[nid] = dist[id] + 1;
              q.push(nid);
            }
          }
        }

        // The exit is selected by actual shortest walking distance, not by the
        // length of the original generation spine. This is important now that
        // Level 0 contains many loops: a 500m-looking route is not enough if a
        // shortcut makes the true shortest path shorter than 500m.
        let exitNode = spine[spine.length - 1];
        if (!exitNode || exitNode.id === startNode.id || dist[exitNode.id] < 12) return null;
        let farCandidates = spine.slice().reverse().filter(n => n && n.id !== startNode.id && dist[n.id] < 9000);
        for (const candidate of farCandidates) {
          if (dist[candidate.id] * C >= CONFIG.gen.minPath && dist[candidate.id] * C <= CONFIG.gen.maxPath) {
            exitNode = candidate;
            break;
          }
        }

        // Checkpoint about halfway along the primary route.
        let cpNode = null;
        const mid = Math.max(2, Math.floor(dist[exitNode.id] * 0.5));
        let best = 99;
        for (let i = 0; i < MapGraph.nodes.length; i++) {
          if (i === startNode.id || i === exitNode.id) continue;
          const d = Math.abs(dist[i] - mid);
          if (dist[i] < 9000 && d < best) { best = d; cpNode = MapGraph.nodes[i]; }
        }
        if (cpNode) cpNode.hasCheckpoint = true;

        function stampSpecial(node, kind) {
          const cx = node.gx + Math.floor(node.w / 2);
          const cz = node.gz + Math.floor(node.h / 2);
          const lx = 2, lz = 2;
          const tx = cx * C + lx;
          const tz = cz * C + lz;
          const tryFind = (x, z) => {
            if (z < 0 || x < 0 || z >= rows || x >= cols) return null;
            if (tiles[z][x] === TILE.WALL || tiles[z][x] === TILE.COLUMN) return null;
            return { x: x, z: z };
          };
          const center = tryFind(tx, tz);
          if (center) {
            tiles[center.z][center.x] = kind;
            return center;
          }
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const p = tryFind(tx + dx, tz + dz);
              if (p) {
                tiles[p.z][p.x] = kind;
                return p;
              }
            }
          }
          return null;
        }

        function findSpecialCell(node) {
          const cx = node.gx + Math.floor(node.w / 2);
          const cz = node.gz + Math.floor(node.h / 2);
          const tx = cx * C + 2;
          const tz = cz * C + 2;
          const tryFind = (x, z) => {
            if (z < 0 || x < 0 || z >= rows || x >= cols) return null;
            const t = tiles[z][x];
            if (t === TILE.WALL || t === TILE.COLUMN) return null;
            return { x: x, z: z };
          };
          const center = tryFind(tx, tz);
          if (center) return center;
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              const p = tryFind(tx + dx, tz + dz);
              if (p) return p;
            }
          }
          return null;
        }

        const startStamp = stampSpecial(startNode, TILE.START);
        if (!startStamp) return null;

        function walkable(t) { return t !== TILE.WALL && t !== TILE.COLUMN; }

        // Exact tile walking distance from a point to every reachable floor tile.
        // Int32 is used because the enlarged world can contain >32k tiles.
        function distanceMap(from) {
          const dm = [];
          for (let z = 0; z < rows; z++) dm.push(new Int32Array(cols).fill(-1));
          const tq = [[from.x, from.z]];
          dm[from.z][from.x] = 0;
          let qi = 0;
          while (qi < tq.length) {
            const p = tq[qi++];
            const d0 = dm[p[1]][p[0]];
            for (let d = 0; d < 4; d++) {
              const nx = p[0] + DIR4[d].x, nz = p[1] + DIR4[d].z;
              if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
              if (dm[nz][nx] >= 0 || !walkable(tiles[nz][nx])) continue;
              dm[nz][nx] = d0 + 1;
              tq.push([nx, nz]);
            }
          }
          return dm;
        }

        const startDistances = distanceMap(startStamp);

        // First exit remains the original long-route exit, preserving the
        // established 500–1000m objective. Additional exits are chosen from
        // other reachable branches and are separated by real walking distance.
        const firstExitCell = findSpecialCell(exitNode);
        if (!firstExitCell) return null;
        const firstPathMeters = startDistances[firstExitCell.z][firstExitCell.x] * CONFIG.tile;
        if (firstPathMeters < CONFIG.gen.minPath || firstPathMeters > CONFIG.gen.maxPath) return null;

        const exitNodes = [exitNode];
        const exitCandidates = [];
        for (let i = 0; i < MapGraph.nodes.length; i++) {
          const n = MapGraph.nodes[i];
          if (!n || n.id === startNode.id || n.id === exitNode.id || n.id === (cpNode ? cpNode.id : -1)) continue;
          if (n.deadEnd || n.type === "dead_end") continue;
          const cell = findSpecialCell(n);
          if (!cell) continue;
          const d0 = startDistances[cell.z][cell.x];
          if (d0 < 0 || d0 * CONFIG.tile < CONFIG.gen.exitSpacing) continue;
          exitCandidates.push({
            node: n,
            cell: cell,
            startM: d0 * CONFIG.tile,
            score: Math.abs(d0 * CONFIG.tile - (firstPathMeters + 700))
          });
        }
        exitCandidates.sort((a, b) => a.score - b.score);

        // Exact tile BFS is expensive on a 288x240 tile field.  The old
        // implementation ran one full BFS for nearly every candidate, which
        // could make the browser appear frozen at the loading screen. Keep
        // the exact validation, but only run it for a small, well-ranked set
        // of candidates. The first candidate selection still uses the exact
        // start-distance map above.
        const candidateLimit = Math.min(exitCandidates.length, 28);
        exitCandidates.length = candidateLimit;

        function tileDistance(a, b, capTiles) {
          const dm = new Int32Array(rows * cols);
          dm.fill(-1);
          const queue = new Int32Array(rows * cols);
          let head = 0, tail = 0;
          const startIdx = a.z * cols + a.x;
          const targetIdx = b.z * cols + b.x;
          dm[startIdx] = 0;
          queue[tail++] = startIdx;
          const cap = capTiles == null ? 1000000 : capTiles;
          while (head < tail) {
            const idx = queue[head++];
            const x = idx % cols;
            const z = (idx / cols) | 0;
            const d0 = dm[idx];
            if (idx === targetIdx) return d0;
            if (d0 >= cap) continue;
            for (let d = 0; d < 4; d++) {
              const nx = x + DIR4[d].x, nz = z + DIR4[d].z;
              if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
              const ni = nz * cols + nx;
              if (dm[ni] >= 0 || !walkable(tiles[nz][nx])) continue;
              dm[ni] = d0 + 1;
              queue[tail++] = ni;
            }
          }
          return -1;
        }

        const chosenCells = [firstExitCell];
        const exitDistances = [firstPathMeters];
        let previousCell = firstExitCell;

        for (let i = 0; i < exitCandidates.length && exitNodes.length < CONFIG.gen.maxExits; i++) {
          const c = exitCandidates[i];
          let valid = true;
          for (let j = 0; j < chosenCells.length; j++) {
            const dTiles = tileDistance(chosenCells[j], c.cell, Math.ceil(CONFIG.gen.exitSpacing / CONFIG.tile));
            if (dTiles >= 0 && dTiles * CONFIG.tile < CONFIG.gen.exitSpacing) {
              valid = false;
              break;
            }
          }
          if (!valid) continue;

          const fromPrevious = tileDistance(previousCell, c.cell, Math.ceil(CONFIG.gen.exitChainMax / CONFIG.tile) + 2);
          if (fromPrevious < 0 || fromPrevious * CONFIG.tile > CONFIG.gen.exitChainMax) continue;

          exitNodes.push(c.node);
          chosenCells.push(c.cell);
          exitDistances.push(c.startM);
          previousCell = c.cell;
        }

        // Mark the chosen exits only after selection, so rejected candidates
        // never become accidental exit tiles.
        for (let i = 0; i < exitNodes.length; i++) {
          exitNodes[i].hasExit = true;
        }
        const exitStamps = [];
        for (let i = 0; i < exitNodes.length; i++) {
          const stamp = stampSpecial(exitNodes[i], TILE.EXIT);
          if (!stamp) return null;
          exitStamps.push(stamp);
        }

        const cpStamp = cpNode ? stampSpecial(cpNode, TILE.CHECK) : null;
        if (!cpStamp && cpNode) return null;

        // The primary exit must remain hidden from the starting area.
        function visibleLine(ax, az, bx, bz) {
          const steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az));
          if (steps < 8) return true;
          for (let i = 1; i < steps; i++) {
            const x = Math.round(ax + (bx - ax) * (i / steps));
            const z = Math.round(az + (bz - az) * (i / steps));
            if (!walkable(tiles[z][x])) return false;
          }
          return true;
        }
        if (visibleLine(startStamp.x, startStamp.z, exitStamps[0].x, exitStamps[0].z)) return null;

        // Preserve the legacy single-exit fields for compatibility, while
        // exposing the full list to the multi-elevator renderer.
        const pathMeters = exitDistances[0];
        const exitStamp = exitStamps[0];

        // Rare anomalies on non-start modules
        if (rng() < 0.22 && MapGraph.nodes.length > 8) {
          const an = MapGraph.nodes[2 + Math.floor(rng() * (MapGraph.nodes.length - 3))];
          if (an && !an.hasStart && !an.hasExit) {
            const rollA = rng();
            if (rollA < 0.35) { an.anomaly = "object"; an.type = an.type; }
            else if (rollA < 0.6) an.skipLights = true;
            else if (rollA < 0.85) an.dark = true;
            else an.anomaly = "odd_door";
          }
        }

        // carpet speckle
        for (let z = 0; z < rows; z++) {
          for (let x = 0; x < cols; x++) {
            if (tiles[z][x] === TILE.FLOOR && rng() < 0.03) tiles[z][x] = TILE.DEAD;
          }
        }

        const result = {
          seed: seed >>> 0,
          tiles: tiles,
          rows: rows,
          cols: cols,
          modules: MapGraph.nodes,
          startNode: startNode,
          exitNode: exitNode,
          exitNodes: exitNodes,
          checkpointNode: cpNode,
          startStamp: startStamp,
          exitStamp: exitStamp,
          exitStamps: exitStamps,
          exitDistances: exitDistances,
          pathMeters: pathMeters,
          targetPath: targetPath
        };
        this.last = result;
        return result;
      },

      generateValid(seed, maxTries) {
        let s = seed >>> 0;
        const tries = maxTries || 40;
        for (let i = 0; i < tries; i++) {
          const res = this.generate((s + i * 7919) >>> 0);
          if (res) {
            res.seed = (s + i * 7919) >>> 0;
            return res;
          }
        }
        return this.generate(s) || null;
      }
    };

    const SpawnManager = {
      apply(result) {
        if (!result || !result.startStamp) return;
        const w = Level.tileToWorld(result.startStamp.x, result.startStamp.z);
        Level.startPos.set(w.x, 0, w.z);
      }
    };

    const DebugPath = {
      visible: false,
      line: null,
      refreshT: 0,
      toggle() {
        if (this.visible) this.hide();
        else this.show();
      },
      show() {
        this.visible = true;
        this.refreshT = 0;
        this.rebuild();
      },
      hide() {
        this.visible = false;
        if (this.line && scene) {
          scene.remove(this.line);
          if (this.line.geometry) this.line.geometry.dispose();
        }
        this.line = null;
      },
      walkable(t) {
        return t !== TILE.WALL && t !== TILE.COLUMN;
      },
      rebuild() {
        if (this.line && scene) {
          scene.remove(this.line);
          if (this.line.geometry) this.line.geometry.dispose();
          this.line = null;
        }
        if (!this.visible || !Level.tiles) return;
        const T = CONFIG.tile;
        const sx = Math.floor(Player.position.x / T);
        const sz = Math.floor(Player.position.z / T);
        let ex = -1, ez = -1, exitIndex = 0;
        const result = LevelGenerator.last;
        const stamps = result && (result.exitStamps || (result.exitStamp ? [result.exitStamp] : []));
        if (!stamps || !stamps.length || !Level.inBounds(sx, sz)) return;
        // The actual nearest exit is chosen by walking distance after BFS,
        // rather than by straight-line distance.
        ex = stamps[0].x; ez = stamps[0].z;
        const cols = Level.cols, rows = Level.rows;
        const dist = [];
        const prev = [];
        for (let z = 0; z < rows; z++) {
          dist.push(new Int16Array(cols).fill(-1));
          prev.push(new Int32Array(cols).fill(-1));
        }
        let startX = sx, startZ = sz;
        if (!this.walkable(Level.getTile(startX, startZ))) {
          let found = false;
          for (let r = 1; r <= 4 && !found; r++) {
            for (let dz = -r; dz <= r && !found; dz++) {
              for (let dx = -r; dx <= r && !found; dx++) {
                const x = sx + dx, z = sz + dz;
                if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) {
                  startX = x; startZ = z; found = true;
                }
              }
            }
          }
          if (!found) return;
        }
        const q = [[startX, startZ]];
        dist[startZ][startX] = 0;
        let qi = 0;
        while (qi < q.length) {
          const p = q[qi++];
          for (let i = 0; i < 4; i++) {
            const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            if (dist[nz][nx] >= 0) continue;
            if (!this.walkable(Level.getTile(nx, nz))) continue;
            dist[nz][nx] = dist[p[1]][p[0]] + 1;
            prev[nz][nx] = p[0] | (p[1] << 16);
            q.push([nx, nz]);
          }
        }
        // Select the closest exit by actual navigable distance.
        let bestExitTiles = Infinity;
        for (let i = 0; i < stamps.length; i++) {
          const dd = dist[stamps[i].z][stamps[i].x];
          if (dd >= 0 && dd < bestExitTiles) {
            bestExitTiles = dd;
            exitIndex = i;
            ex = stamps[i].x;
            ez = stamps[i].z;
          }
        }
        if (bestExitTiles === Infinity) return;

        const pts = [new THREE.Vector3(Player.position.x, 0.35, Player.position.z)];
        const tiles = [];
        let cx = ex, cz = ez;
        while (!(cx === startX && cz === startZ)) {
          tiles.push([cx, cz]);
          const pr = prev[cz][cx];
          if (pr < 0) break;
          cx = pr & 65535;
          cz = pr >>> 16;
        }
        tiles.reverse();
        for (let i = 0; i < tiles.length; i += 2) {
          const w = Level.tileToWorld(tiles[i][0], tiles[i][1]);
          pts.push(new THREE.Vector3(w.x, 0.28, w.z));
        }
        const last = Level.tileToWorld(ex, ez);
        pts.push(new THREE.Vector3(last.x, 0.25, last.z));
        const routeStair = Stairwell.exits && Stairwell.exits[exitIndex]
          ? Stairwell.exits[exitIndex]
          : (Stairwell.exits && Stairwell.exits[0] ? Stairwell.exits[0] : null);
        if (routeStair) {
          const botAlong = routeStair.depth * 0.10;
          const bot = routeStair.local(0, botAlong);
          pts.push(new THREE.Vector3(bot.x, 0.35, bot.z));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7ec8ff }));
        if (scene) scene.add(this.line);
      },
      update(dt) {
        if (!this.visible) return;
        if (!GameState.debug) { this.hide(); return; }
        this.refreshT -= dt;
        if (this.refreshT <= 0) {
          this.refreshT = 0.45;
          this.rebuild();
        }
      }
    };

    const ExitManager = {
      worldPos() {
        const list = Stairwell.exits && Stairwell.exits.length
          ? Stairwell.exits
          : [];
        if (list.length) {
          let best = list[0].origin;
          let bestD = Math.hypot(best.x - Player.position.x, best.z - Player.position.z);
          for (let i = 1; i < list.length; i++) {
            const o = list[i].origin;
            const d = Math.hypot(o.x - Player.position.x, o.z - Player.position.z);
            if (d < bestD) { best = o; bestD = d; }
          }
          return best.clone();
        }
        const res = LevelGenerator.last;
        if (!res) return null;
        const stamp = res.exitStamp || (res.exitStamps && res.exitStamps[0]);
        if (!stamp) return null;
        const w = Level.tileToWorld(stamp.x, stamp.z);
        return new THREE.Vector3(w.x, 0, w.z);
      }
    };

    const Stairwell = {
      // Kept under the old internal name so the existing generator/debug code
      // remains compatible. Visually and mechanically this is now a concrete
      // elevator exit, not a stairwell.
      exits: [],
      origin: null,
      hole: null,
      minY: -10,
      reached: false,
      width: 4.6,
      depth: 5.2,
      height: 3.2,
      fx: 0, fz: 1, rx: 1, rz: 0,
      sequenceActive: false,
      sequenceT: 0,
      sequenceDuration: 6.5,
      sequenceExitIndex: -1,
      cabGroups: [],
      avatarGroups: [],
      doorPairs: [],

      reset() {
        this.exits = [];
        this.origin = null;
        this.hole = null;
        this.minY = -10;
        this.reached = false;
        this.sequenceActive = false;
        this.sequenceT = 0;
        this.sequenceExitIndex = -1;
        for (const g of this.cabGroups) { if (g && scene) scene.remove(g); }
        this.cabGroups = [];
        this.avatarGroups = [];
        this.doorPairs = [];
        GameState.exitReached = false;
        GameState.elevatorShake = 0;
        const ov = document.getElementById('elevator-sequence');
        if (ov) ov.style.display = 'none';
      },

      planOne(result, stamp, exitNode) {
        const ex = stamp.x, ez = stamp.z;
        const w = Level.tileToWorld(ex, ez);
        const dirs = [
          { fx: 0, fz: 1, rx: 1, rz: 0 },
          { fx: 0, fz: -1, rx: -1, rz: 0 },
          { fx: 1, fz: 0, rx: 0, rz: -1 },
          { fx: -1, fz: 0, rx: 0, rz: 1 }
        ];
        let best = dirs[0], bestScore = -1e9;
        // Face the direction the player approaches from. The exit stamp is in
        // the center of a generated module, so this selects a broad open side
        // rather than trying to extend a staircase into neighboring modules.
        for (let i = 0; i < dirs.length; i++) {
          const d = dirs[i];
          let score = 0, behindRun = 0;
          for (let ss = 1; ss <= 5; ss++) {
            const tx = ex - Math.round(d.fx * ss), tz = ez - Math.round(d.fz * ss);
            if (!Level.inBounds(tx, tz)) break;
            const t = Level.getTile(tx, tz);
            if (t === TILE.WALL || t === TILE.COLUMN) break;
            behindRun++;
          }
          score += behindRun * 20;
          if (exitNode && exitNode.connections) {
            for (let c = 0; c < exitNode.connections.length; c++) {
              const nb = MapGraph.nodes[exitNode.connections[c]];
              if (!nb) continue;
              const ndx = (exitNode.gx + exitNode.w * 0.5) - (nb.gx + nb.w * 0.5);
              const ndz = (exitNode.gz + exitNode.h * 0.5) - (nb.gz + nb.h * 0.5);
              const cx = Math.abs(ndx) >= Math.abs(ndz) ? (ndx >= 0 ? 1 : -1) : 0;
              const cz = Math.abs(ndx) >= Math.abs(ndz) ? 0 : (ndz >= 0 ? 1 : -1);
              if (cx === d.fx && cz === d.fz) score += 35;
            }
          }
          if (score > bestScore) { bestScore = score; best = d; }
        }

        const elevator = {
          fx: best.fx, fz: best.fz, rx: best.rx, rz: best.rz,
          // Center the cab on the special tile. Its front doors face the
          // approach direction (-fx,-fz), so the player enters straight ahead.
          origin: new THREE.Vector3(w.x, 0, w.z),
          hole: null,
          minY: -10,
          width: 4.6,
          depth: 5.2,
          height: 3.2,
          steps: 0,
          rise: 0,
          run: 0,
          landingAfter: 0,
          landingLen: 3.8,
          exitStamp: stamp,
          exitNode: exitNode,
          local(side, along) {
            return { x: this.origin.x + this.rx * side + this.fx * along,
                     z: this.origin.z + this.rz * side + this.fz * along };
          }
        };
        const half = elevator.width * 0.5;
        const halfD = elevator.depth * 0.5;
        // Cut only the elevator shaft footprint from the Level 0 floor. The
        // cabin floor covers it before descent and moves down with the cab.
        const corners = [
          elevator.local(-half, -halfD), elevator.local(half, -halfD),
          elevator.local(-half, halfD), elevator.local(half, halfD)
        ];
        let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9;
        for (const c of corners) { minx=Math.min(minx,c.x); maxx=Math.max(maxx,c.x); minz=Math.min(minz,c.z); maxz=Math.max(maxz,c.z); }
        elevator.hole = {minx:minx-0.10,maxx:maxx+0.10,minz:minz-0.10,maxz:maxz+0.10};
        elevator.minY = -11;
        return elevator;
      },

      planFrom(result) {
        this.reset();
        if (!result || !result.exitStamps || !result.exitStamps.length) return;
        const nodes = result.exitNodes || [];
        for (let i=0;i<result.exitStamps.length;i++) {
          const st=this.planOne(result,result.exitStamps[i],nodes[i]||result.exitNode);
          if(st) this.exits.push(st);
        }
        if(this.exits.length){
          const first=this.exits[0];
          this.origin=first.origin; this.hole=first.hole; this.minY=first.minY;
          this.fx=first.fx; this.fz=first.fz; this.rx=first.rx; this.rz=first.rz;
          this.width=first.width; this.depth=first.depth; this.height=first.height;
        }
      },

      local(side, along) {
        if(this.exits.length) return this.exits[0].local(side,along);
        return {x:this.origin.x+this.rx*side+this.fx*along,z:this.origin.z+this.rz*side+this.fz*along};
      },

      containsWorld(x,z){
        for(const st of this.exits){const h=st.hole;if(h&&x>=h.minx&&x<=h.maxx&&z>=h.minz&&z<=h.maxz)return true;}
        return false;
      },
      nearConcrete(x,z){
        for(const st of this.exits){
          const h=st.hole;if(!h||!st.origin)continue;
          const pad=2.4;
          if(x>=h.minx-pad&&x<=h.maxx+pad&&z>=h.minz-pad&&z<=h.maxz+pad)return true;
        }
        return false;
      },
      playerInside(){
        for(const st of this.exits){const h=st.hole;if(h&&Player.position.x>=h.minx&&Player.position.x<=h.maxx&&Player.position.z>=h.minz&&Player.position.z<=h.maxz)return true;}
        return false;
      },
      addBox(group,mat,cx,cy,cz,sx,sy,sz){const m=new THREE.Mesh(Geometries.box,mat);m.scale.set(sx,sy,sz);m.position.set(cx,cy,cz);group.add(m);return m;},
      addCol(minx,miny,minz,maxx,maxy,maxz){Level.addBoxCollider(minx,miny,minz,maxx,maxy,maxz);},
      span(st,along,across){return{x:Math.abs(st.rx)*across+Math.abs(st.fx)*along,z:Math.abs(st.rz)*across+Math.abs(st.fz)*along};},
      slab(group,st,mat,side,along,y,alongLen,across,thick){const p=st.local(side,along),sz=this.span(st,alongLen,across);this.addBox(group,mat,p.x,y,p.z,sz.x,thick,sz.z);return p;},

      buildOne(sceneRef,st,index){
        const g=new THREE.Group();
        g.name='ConcreteElevator_'+index;

        // A deliberately realistic industrial elevator: concrete shaft/lobby,
        // recessed metal doors, concrete wall panels, a proper cab ceiling,
        // control panel, handrail, floor threshold and practical lighting.
        const concrete = Materials.concrete;
        const concreteDark = Materials.concreteDark;
        const concreteLight = new THREE.MeshStandardMaterial({
          map: Materials.concrete.map || null,
          color: 0xc2c2bd,
          emissive: 0x161716, emissiveIntensity: 0.22,
          roughness: 0.91,
          metalness: 0.02
        });
        const concreteEdge = new THREE.MeshStandardMaterial({
          map: Materials.concrete.map || null,
          color: 0x94948f,
          emissive: 0x0a0b0a, emissiveIntensity: 0.10,
          roughness: 0.96,
          metalness: 0.02
        });
        const steel = new THREE.MeshStandardMaterial({
          color: 0x777a78,
          roughness: 0.62,
          metalness: 0.58
        });
        const steelDark = new THREE.MeshStandardMaterial({
          color: 0x343735,
          roughness: 0.72,
          metalness: 0.5
        });
        const brushed = new THREE.MeshStandardMaterial({
          color: 0x9a9d99,
          roughness: 0.42,
          metalness: 0.78
        });
        const black = new THREE.MeshStandardMaterial({
          color: 0x161817,
          roughness: 0.8,
          metalness: 0.18
        });
        const panelMat = new THREE.MeshStandardMaterial({
          color: 0x696b68,
          roughness: 0.76,
          metalness: 0.25
        });
        const buttonMat = new THREE.MeshStandardMaterial({
          color: 0xb7b8b3,
          roughness: 0.32,
          metalness: 0.72
        });
        const indicatorMat = new THREE.MeshStandardMaterial({
          color: 0xd7ddd7,
          emissive: 0x6f7b73,
          emissiveIntensity: 0.7,
          roughness: 0.25,
          metalness: 0.1
        });

        const W=st.width, D=st.depth, H=st.height, half=W/2, halfD=D/2;
        const p=st.origin;
        const L=(side,along)=>st.local(side,along);
        const sref=sceneRef||scene;

        // ---------- Concrete shaft / exterior frame ----------
        // Keep the shaft visually substantial but leave the actual entrance open.
        const shaftDepth = D + 1.25;
        const shaftBottom = -12;
        const wallT = 0.34;
        // Keep the shaft walls behind the elevator face. They must not project
        // several metres into the Level 0 approach corridor.
        const shaftAlongCenter = (0.70);
        for(const side of [-1,1]){
          const q=L(side*(half+wallT*0.5),shaftAlongCenter);
          const sz=this.span(st,shaftDepth,wallT);
          this.addBox(g,concreteEdge,q.x,(shaftBottom+H)/2,q.z,sz.x,H-shaftBottom,sz.z);
        }
        const back=L(0,halfD+0.55);
        const backSz=this.span(st,wallT,W+wallT*2);
        this.addBox(g,concreteEdge,back.x,(shaftBottom+H)/2,back.z,backSz.x,H-shaftBottom,backSz.z);

        // Large concrete entrance surround, intentionally lighter than the shaft.
        const jambW=0.48, lintelH=0.42;
        for(const side of [-1,1]){
          const q=L(side*(half+jambW*0.5-0.04),-halfD+0.18);
          const sz=this.span(st,0.55,jambW);
          this.addBox(g,concreteLight,q.x,H*0.5,q.z,sz.x,H,sz.z);
        }
        const ql=L(0,-halfD+0.18);
        const qls=this.span(st,0.55,W+jambW*2-0.08);
        this.addBox(g,concreteLight,ql.x,H-lintelH*0.5,ql.z,qls.x,lintelH,qls.z);

        // Concrete panel seams on the exterior surround — subtle, not decorative.
        for(const side of [-1,1]){
          for(const yy of [0.92,1.86,2.78]){
            const q=L(side*(half+0.012),-halfD+0.22);
            const sz=this.span(st,0.07,0.24);
            this.addBox(g,concreteEdge,q.x,yy,q.z,sz.x,0.028,sz.z);
          }
        }
        const topSeam=L(0,-halfD+0.205);
        const topSeamSz=this.span(st,0.07,W-0.9);
        this.addBox(g,concreteEdge,topSeam.x,2.48,topSeam.z,topSeamSz.x,0.025,topSeamSz.z);

        // ---------- Elevator cab ----------
        // The cabin floor sits at Level 0 until the sequence begins, then the
        // whole group descends. This keeps the exit self-contained.
        this.addBox(g,concreteLight,p.x,-0.08,p.z,W,0.16,D);
        this.addBox(g,concreteEdge,p.x,-0.17,p.z,W+0.08,0.12,D+0.08);

        // Back wall with large concrete panels and central seam.
        const backCab=L(0,halfD-0.08);
        const backCabSz=this.span(st,0.20,W);
        this.addBox(g,concreteLight,backCab.x,H*0.5,backCab.z,backCabSz.x,H,backCabSz.z);
        const backSeam=L(0,halfD-0.185);
        const seamSz=this.span(st,0.025,0.035);
        this.addBox(g,concreteEdge,backSeam.x,1.65,backSeam.z,seamSz.x,3.0,seamSz.z);

        // Side walls, with shallow panel strips.
        for(const side of [-1,1]){
          const q=L(side*(half-0.12),0);
          const sz=this.span(st,D-0.24,0.24);
          this.addBox(g,concreteLight,q.x,H*0.5,q.z,sz.x,H,sz.z);
          for(const along of [-1.35,0,1.35]){
            const sq=L(side*(half-0.245),along);
            const ssz=this.span(st,0.028,0.035);
            this.addBox(g,concreteEdge,sq.x,1.62,sq.z,ssz.x,2.82,ssz.z);
          }
        }

        // Ceiling recess and practical fluorescent light.
        this.addBox(g,concreteEdge,p.x,H-0.08,p.z,W,0.16,D);
        const ceilingInset=L(0,0.12);
        const csz=this.span(st,2.25,0.44);
        this.addBox(g,black,ceilingInset.x,H-0.18,ceilingInset.z,csz.x,0.08,csz.z);
        const lsz=this.span(st,1.95,0.16);
        this.addBox(g,Materials.light,ceilingInset.x,H-0.12,ceilingInset.z,lsz.x,0.055,lsz.z);

        // Recessed metal door pocket around the front opening.
        const doorH=2.46;
        const doorW=(W-0.34)/2;
        const pocketY=doorH*0.5;
        const pocketL=L(-half+0.17+doorW*0.5,-halfD+0.19);
        const pocketR=L(half-0.17-doorW*0.5,-halfD+0.19);
        const doorSize=this.span(st,0.12,doorW);
        const dl=this.addBox(g,brushed,pocketL.x,pocketY,pocketL.z,doorSize.x,doorH,doorSize.z);
        const dr=this.addBox(g,brushed,pocketR.x,pocketY,pocketR.z,doorSize.x,doorH,doorSize.z);
        dl.userData.elevatorDoor=true;
        dr.userData.elevatorDoor=true;
        const pair={left:dl,right:dr,openLeft:pocketL.x,openRight:pocketR.x,st:st,doorW:doorW,doorH:doorH};
        this.doorPairs[index]=pair;

        // Door seams and top/bottom tracks.
        const center=L(0,-halfD+0.13);
        const seamSize=this.span(st,0.10,0.032);
        this.addBox(g,steelDark,center.x,doorH/2,center.z,seamSize.x,doorH,seamSize.z);
        const track=this.span(st,0.34,W-0.46);
        this.addBox(g,steelDark,center.x,0.105,center.z,track.x,0.06,track.z);
        this.addBox(g,steelDark,center.x,doorH+0.015,center.z,track.x,0.05,track.z);

        // ---------- Real elevator controls ----------
        const cp=L(-half+0.34,0.08);
        // Panel stands slightly proud of the concrete wall.
        const cps=this.span(st,0.46,0.46);
        this.addBox(g,panelMat,cp.x,1.30,cp.z,cps.x,1.00,cps.z);
        const screen=L(-half+0.34,0.08);
        const ss=this.span(st,0.06,0.25);
        this.addBox(g,black,screen.x,1.68,screen.z,ss.x,0.18,ss.z);
        this.addBox(g,indicatorMat,screen.x,1.68,screen.z,ss.x*0.72,0.045,ss.z*0.62);
        for(let i=0;i<3;i++){
          const b=L(-half+0.34,0.95+i*0.18);
          const bs=this.span(st,0.05,0.07);
          this.addBox(g,buttonMat,b.x,1.38-i*0.18,b.z,bs.x,0.075,bs.z);
        }

        // Handrail on the back wall: unmistakably elevator-like, but industrial.
        const railMat=brushed;
        const railY=0.92;
        const railL=L(-half+0.48,halfD-0.28);
        const railR=L(half-0.48,halfD-0.28);
        const railSpan=this.span(st,0.10,W-0.96);
        this.addBox(g,railMat, p.x,railY,railL.z,railSpan.x,0.075,railSpan.z);
        for(const side of [-1,1]){
          const rq=L(side*(half-0.52),halfD-0.28);
          const rs=this.span(st,0.10,0.045);
          this.addBox(g,railMat,rq.x,railY*0.65,rq.z,rs.x,0.50,rs.z);
        }

        // Threshold at the entrance.
        const threshold=L(0,-halfD+0.02);
        const ths=this.span(st,0.24,W-0.26);
        this.addBox(g,brushed,threshold.x,0.075,threshold.z,ths.x,0.10,ths.z);

        // Small warning/maintenance plate above the doors.
        const plate=L(0,-halfD+0.03);
        const ps=this.span(st,0.04,0.44);
        this.addBox(g,steelDark,plate.x,2.68,plate.z,ps.x,0.16,ps.z);
        const ptxt=L(0,-halfD+0.055);
        const pts=this.span(st,0.02,0.27);
        this.addBox(g,indicatorMat,ptxt.x,2.68,ptxt.z,pts.x,0.035,pts.z);

        // Lighting: a strong cabin ceiling light + softer shaft/lobby light.
        if(sref){
          const cabLight=new THREE.PointLight(0xfff3d7,2.4,8.0,1.5);
          cabLight.position.set(ceilingInset.x,H-0.30,ceilingInset.z);
          sref.add(cabLight); LightingSystem.lights.push(cabLight);
          const lobbyLight=new THREE.PointLight(0xe6e8e2,1.65,8.5,1.55);
          const lp=L(0,-halfD-0.55);
          lobbyLight.position.set(lp.x,2.65,lp.z);
          sref.add(lobbyLight); LightingSystem.lights.push(lobbyLight);
          const facadeL=L(-half-0.55,-halfD-0.45);
          const facadeR=L(half+0.55,-halfD-0.45);
          const fl=new THREE.PointLight(0xf0ead2,1.15,5.5,1.8); fl.position.set(facadeL.x,2.0,facadeL.z);
          const fr=new THREE.PointLight(0xf0ead2,1.15,5.5,1.8); fr.position.set(facadeR.x,2.0,facadeR.z);
          sref.add(fl,fr); LightingSystem.lights.push(fl,fr);
        }

        // Simple visible player avatar for the descent cinematic. It is intentionally
        // stylized and neutral so the first-person player can see their own body.
        const avatar=new THREE.Group(); avatar.name='PlayerCinematicAvatar';
        const suit=new THREE.MeshStandardMaterial({color:0x60645f,roughness:0.82,metalness:0.04});
        const skin=new THREE.MeshStandardMaterial({color:0xb59a80,roughness:0.9,metalness:0});
        const torso=new THREE.Mesh(Geometries.box,suit); torso.scale.set(0.42,0.92,0.25); torso.position.y=1.08;
        const head=new THREE.Mesh(Geometries.box,skin); head.scale.set(0.30,0.34,0.28); head.position.y=1.72;
        const legL=new THREE.Mesh(Geometries.box,suit); legL.scale.set(0.15,0.68,0.16); legL.position.set(-0.12,0.34,0);
        const legR=new THREE.Mesh(Geometries.box,suit); legR.scale.set(0.15,0.68,0.16); legR.position.set(0.12,0.34,0);
        avatar.add(torso,head,legL,legR); avatar.position.set(p.x,p.y+0.02,p.z); avatar.rotation.y=Math.atan2(-st.fx,-st.fz); g.add(avatar);
        this.avatarGroups=this.avatarGroups||[]; this.avatarGroups[index]=avatar;

        sceneRef.add(g);
        this.cabGroups[index]=g;

        // Static floor collider lets the player stand inside before descent.
        const h=st.hole;
        this.addCol(h.minx+0.08,-0.02,h.minz+0.08,h.maxx-0.08,0.04,h.maxz-0.08);

        // Enter only from the intended front-facing corridor.
        const trCenter=L(0,-halfD*0.72);
        const trW=W*0.74, trD=1.05;
        const a=L(-trW/2,-halfD-trD/2), b=L(trW/2,-halfD+trD/2);
        Level.triggers.push({type:'exit',exitIndex:index,minx:Math.min(a.x,b.x),maxx:Math.max(a.x,b.x),minz:Math.min(a.z,b.z),maxz:Math.max(a.z,b.z)});
      },

      build(sceneRef){
        if(!this.exits.length||!Level.group)return;
        for(let i=0;i<this.exits.length;i++)this.buildOne(sceneRef,this.exits[i],i);
      },

      startSequence(index){
        if(this.sequenceActive||GameState.phase!=='playing')return;
        this.sequenceActive=true; this.sequenceT=0; this.sequenceExitIndex=index|0; this.reached=true; GameState.exitReached=true; GameState.cinematicCamera=true;
        clearInput();
        const pair=this.doorPairs[this.sequenceExitIndex];
        if(pair){
          // Capture the initial world-space door positions in the elevator's
          // local frame. The group itself remains at the cab origin.
          pair.startL=pair.left.position.clone(); pair.startR=pair.right.position.clone();
          const c=pair.startL.clone().add(pair.startR).multiplyScalar(0.5);
          pair.closeL=c.clone().add(new THREE.Vector3(pair.st.rx*0.012,0,pair.st.rz*0.012));
          pair.closeR=c.clone().add(new THREE.Vector3(-pair.st.rx*0.012,0,-pair.st.rz*0.012));
        }
        const ov=document.getElementById('elevator-sequence');
        if(ov)ov.style.display='flex';
        setPauseOverlay(false);
        const status=document.getElementById('elevator-status');
        if(status)status.textContent='DOORS CLOSING';
        const bar=document.getElementById('elevator-fill'); if(bar)bar.style.width='0%';
        if(document.pointerLockElement)document.exitPointerLock();
        AudioSystem._tone&&AudioSystem._tone(72,'sine',0.18,0.05,'events');
      },

      update(dt){
        if(!this.sequenceActive)return;
        this.sequenceT+=dt;
        const t=this.sequenceT, dur=this.sequenceDuration;
        const pair=this.doorPairs[this.sequenceExitIndex];
        const g=this.cabGroups[this.sequenceExitIndex];
        const st=this.exits[this.sequenceExitIndex];
        const openPhase=0.8, closePhase=1.6;
        if(pair){
          const q=Math.min(1,Math.max(0,(t-openPhase)/(closePhase-openPhase)));
          // Doors slide toward the center seam.
          pair.left.position.lerpVectors(pair.startL,pair.closeL,q);
          pair.right.position.lerpVectors(pair.startR,pair.closeR,q);
        }
        let descend=0;
        if(t>=1.6) descend=Math.min(10.5, (t-1.6)/(dur-1.6)*10.5);
        if(g)g.position.y=-descend;
        if(st){
          Player.position.x=st.origin.x; Player.position.z=st.origin.z; Player.position.y=-descend;
          Player.velocity.set(0,0,0); Player.onGround=true;
          Player.yaw=Math.atan2(-st.fx,-st.fz);
          Player.pitch*=0.96;
        }
        GameState.elevatorShake = t>1.55 ? Math.min(1,0.35+0.65*Math.sin(t*9)*Math.sin(t*3.1)) : 0;
        const status=document.getElementById('elevator-status');
        const bar=document.getElementById('elevator-fill');
        if(t<1.6){if(status)status.textContent='DOORS CLOSING';}
        else if(t<2.4){if(status)status.textContent='ELEVATOR DEPARTING';}
        else if(t<5.7){if(status)status.textContent='DESCENDING — LEVEL 1';}
        else if(status)status.textContent='ARRIVING';
        if(bar)bar.style.width=Math.min(100,(t/dur)*100).toFixed(1)+'%';
        const floor=document.getElementById('elevator-floor');
        if(floor){const depth=Math.min(10.5,Math.max(0,descend));floor.textContent='DEPTH  −'+depth.toFixed(1)+' m';}
        // Keep the avatar centered in the cab while the cabin descends.
        const avatar=this.avatarGroups&&this.avatarGroups[this.sequenceExitIndex];
        if(avatar){avatar.position.y=0.02; avatar.rotation.y=Math.atan2(-st.fx,-st.fz);}
        if(t>=dur){
          if(status)status.textContent='LEVEL 1 — DOORS OPENING';
          const openT=Math.min(1,(t-dur)/1.25);
          if(pair){
            const eased=1-Math.pow(1-openT,3);
            const far=pair.doorW*0.92;
            pair.left.position.x=pair.startL.x + (pair.startL.x < pair.startR.x ? -far : far)*eased;
            pair.right.position.x=pair.startR.x + (pair.startR.x > pair.startL.x ? far : -far)*eased;
          }
          if(openT>=1){
            this.sequenceActive=false;
            GameState.elevatorShake=0;
            GameState.cinematicCamera=false;
            if(g)g.visible=false;
            if(this.avatarGroups&&this.avatarGroups[this.sequenceExitIndex]) this.avatarGroups[this.sequenceExitIndex]=null;
            const exitSeed=((GameState.seed^0x51f15e5d)>>>0)||1;
            Level1.enter(exitSeed, st);
            const exitForward=new THREE.Vector3(st.fx,0,st.fz);
            Player.position.set(st.origin.x + exitForward.x*3.2, st.minY||-10.5, st.origin.z + exitForward.z*3.2);
            Player.yaw=Math.atan2(-st.fx,-st.fz); Player.pitch=0;
            GameState.elapsed=0; GameState.distance=0; GameState.exitReached=false;
            GameState.elevatorShake=0;
            const ov=document.getElementById('elevator-sequence');if(ov)ov.style.display='none';
            if(document.getElementById('hud-obj'))document.getElementById('hud-obj').textContent='Objective: explore Level 1';
            const lvlLabel=document.getElementById('hud-level-label'); if(lvlLabel)lvlLabel.textContent='LEVEL 1';
            renderer.domElement.requestPointerLock();
          }
        }
      }
    };

    /* ------------------------------------------------------------------
       LEVEL / MAP — consumes generated tiles
       ------------------------------------------------------------------ */

    const MAP_STRINGS_UNUSED = [
      "################################################",
      "#..............####..............####..........#",
      "#..............####..............####..........#",
      "#..##########..####..##########.........####...#",
      "#..#........#..####..#........#.........#  #...#",
      "#..#........#........#........#.........#  #...#",
      "#..#...C....#........#...C....##########.......#",
      "#..#........##########.........................#",
      "#..#........#........+........+....#####..######",
      "#...........#.........................###......#",
      "#...........#..#####.....##.....##....###......#",
      "#####..######..#...#.....##.....##.............#",
      "#..............#...#..............##...........#",
      "#..S...........#...#..............##.....K.....#",
      "#..............#####..######..###########..#####",
      "#.....................#....#...................#",
      "##########.....C......#....#.....C....##########",
      "#........#............#....#............#......#",
      "#........#..#######...######...#######..#......#",
      "#........#..#.....#............#.....#..#......#",
      "#...........#.....+............+.....#.........#",
      "#...........#.....#....####....#.....#.........#",
      "#####..######.....#....#  #....#.....######..###",
      "#.................#....#  #....#...............#",
      "#..###########..........  ...........########..#",
      "#..#.........#...C............C......#......#..#",
      "#..#.........#.......................#......#..#",
      "#..#....C....##########...###########.......#..#",
      "#..#........................................#..#",
      "#..######################.###################..#",
      "#......................#...#...................#",
      "#......................#...#..............E....#",
      "#..#####..######..######...######..#####.......#",
      "#..#...........#...............#...............#",
      "#..#...........#...............#..###########..#",
      "#..............#####.....C.....#...............#",
      "#..............................#...............#",
      "################################################"
    ];

    const Level = {
      cols: 0,
      rows: 0,
      tiles: [],
      colliders: [], // axis-aligned boxes {min,max} THREE.Vector3
      triggers: [],
      startPos: new THREE.Vector3(2, 0, 2),
      group: null,
      worldMin: new THREE.Vector3(),
      worldMax: new THREE.Vector3(),

      inBounds(tx, tz) {
        return tz >= 0 && tz < this.rows && tx >= 0 && tx < this.cols;
      },
      getTile(tx, tz) {
        if (!this.inBounds(tx, tz)) return TILE.WALL;
        return this.tiles[tz][tx];
      },
      isSolidTile(t) {
        return t === TILE.WALL;
      },
      tileToWorld(tx, tz) {
        return {
          x: (tx + 0.5) * CONFIG.tile,
          z: (tz + 0.5) * CONFIG.tile
        };
      },

      loadGenerated(result) {
        this.tiles = result.tiles;
        this.rows = result.rows;
        this.cols = result.cols;
        this.worldMin.set(0, -1, 0);
        this.worldMax.set(this.cols * CONFIG.tile, CONFIG.wallH + 2, this.rows * CONFIG.tile);
        this.triggers.length = 0;
        this.pathMeters = result.pathMeters || 0;
        this.targetPath = result.targetPath || 0;
      },

      clear(sceneRef) {
        const s = sceneRef || scene;
        LightingSystem.clear(s);
        if (this.group && s) {
          this.group.traverse((obj) => {
            if (obj.geometry && obj.geometry.dispose) {
              const shared = obj.geometry === Geometries.box ||
                obj.geometry === Geometries.lightPanel ||
                obj.geometry === Geometries.lightHousing ||
                obj.geometry === Geometries.floorTile ||
                obj.geometry === Geometries.column ||
                obj.geometry === Geometries.beam;
              if (!shared) obj.geometry.dispose();
            }
          });
          s.remove(this.group);
        }
        this.group = null;
        this.colliders.length = 0;
        this.triggers.length = 0;
        Stairwell.reset();
        if (typeof DebugPath !== "undefined") DebugPath.hide();
      },

      /* Greedy horizontal merge of wall runs, then emit box colliders.
         Corners stay closed because adjacent runs meet at tile edges. */
      buildColliders() {
        this.colliders.length = 0;
        const T = CONFIG.tile;
        const H = CONFIG.wallH;

        const used = [];
        for (let z = 0; z < this.rows; z++) used.push(new Array(this.cols).fill(false));

        for (let z = 0; z < this.rows; z++) {
          for (let x = 0; x < this.cols; x++) {
            if (used[z][x] || !this.isSolidTile(this.getTile(x, z))) continue;
            let x2 = x;
            while (x2 + 1 < this.cols && this.isSolidTile(this.getTile(x2 + 1, z)) && !used[z][x2 + 1]) x2++;
            let z2 = z;
            let canGrow = true;
            while (canGrow && z2 + 1 < this.rows) {
              for (let xx = x; xx <= x2; xx++) {
                if (!this.isSolidTile(this.getTile(xx, z2 + 1)) || used[z2 + 1][xx]) { canGrow = false; break; }
              }
              if (canGrow) z2++;
            }
            for (let zz = z; zz <= z2; zz++) {
              for (let xx = x; xx <= x2; xx++) used[zz][xx] = true;
            }
            this.addBoxCollider(x * T, 0, z * T, (x2 + 1) * T, H, (z2 + 1) * T);
          }
        }

        // Invisible world envelope so the player cannot leave the map
        const W = this.cols * T;
        const D = this.rows * T;
        const thick = 2;
        const holes = Stairwell.exits.map((st) => st.hole).filter(Boolean);

        // Keep the world boundary solid everywhere except the actual elevator
        // openings. Multiple exits are handled by horizontal strips so one
        // opening can never accidentally seal another.
        const zCuts = [0, D];
        for (let i = 0; i < holes.length; i++) {
          zCuts.push(Math.max(0, holes[i].minz), Math.min(D, holes[i].maxz));
        }
        zCuts.sort((a, b) => a - b);
        const uniqueZ = [];
        for (let i = 0; i < zCuts.length; i++) {
          if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
        }
        for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
          const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
          if (z1 - z0 < 0.01) continue;
          const midZ = (z0 + z1) * 0.5;
          const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
          const xCuts = [0, W];
          for (let i = 0; i < active.length; i++) {
            xCuts.push(Math.max(0, active[i].minx), Math.min(W, active[i].maxx));
          }
          xCuts.sort((a, b) => a - b);
          const uniqueX = [];
          for (let i = 0; i < xCuts.length; i++) {
            if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
          }
          for (let xi = 0; xi < uniqueX.length - 1; xi++) {
            const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
            const midX = (x0 + x1) * 0.5;
            const insideHole = active.some((h) => midX >= h.minx && midX <= h.maxx);
            if (!insideHole && x1 - x0 > 0.01) {
              this.addBoxCollider(x0, -2, z0, x1, 0.0, z1);
            }
          }
        }

        // Slightly oversized side/top boundary walls.
        this.addBoxCollider(-thick, -2, -thick, 0, H + 2, D + thick);
        this.addBoxCollider(W, -2, -thick, W + thick, H + 2, D + thick);
        this.addBoxCollider(-thick, -2, -thick, W + thick, H + 2, 0);
        this.addBoxCollider(-thick, -2, D, W + thick, H + 2, D + thick);
        this.addBoxCollider(-thick, H, -thick, W + thick, H + 2, D + thick); // ceiling slab

        // Column colliders
        for (let z = 0; z < this.rows; z++) {
          for (let x = 0; x < this.cols; x++) {
            if (this.getTile(x, z) !== TILE.COLUMN) continue;
            const w = this.tileToWorld(x, z);
            const r = 0.32;
            this.addBoxCollider(w.x - r, 0, w.z - r, w.x + r, H, w.z + r);
          }
        }
      },

      addBoxCollider(minx, miny, minz, maxx, maxy, maxz) {
        this.colliders.push({
          min: new THREE.Vector3(minx, miny, minz),
          max: new THREE.Vector3(maxx, maxy, maxz)
        });
      },

      buildMeshes(scene) {
        this.group = new THREE.Group();
        this.group.name = "LevelMeshes";
        const T = CONFIG.tile;
        const H = CONFIG.wallH;

        // One floor and one ceiling covering the playable bounds (few draw calls)
        const worldW = this.cols * T;
        const worldD = this.rows * T;
        const floorMap = Materials.carpet.map.clone();
        floorMap.repeat.set(worldW / 2, worldD / 2);
        floorMap.needsUpdate = true;
        const floorMat = Materials.carpet.clone();
        floorMat.map = floorMap;
        const addFloorRect = (minx, minz, maxx, maxz) => {
          const w = maxx - minx, d = maxz - minz;
          if (w < 0.05 || d < 0.05) return;
          const geo = new THREE.PlaneGeometry(w, d);
          const mesh = new THREE.Mesh(geo, floorMat);
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set((minx + maxx) * 0.5, 0, (minz + maxz) * 0.5);
          this.group.add(mesh);
        };
        const holes = Stairwell.exits.map((st) => st.hole).filter(Boolean);
        if (!holes.length) {
          addFloorRect(0, 0, worldW, worldD);
        } else {
          const zCuts = [0, worldD];
          for (let i = 0; i < holes.length; i++) {
            zCuts.push(Math.max(0, holes[i].minz), Math.min(worldD, holes[i].maxz));
          }
          zCuts.sort((a, b) => a - b);
          const uniqueZ = [];
          for (let i = 0; i < zCuts.length; i++) {
            if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
          }
          for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
            const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
            const midZ = (z0 + z1) * 0.5;
            const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
            const xCuts = [0, worldW];
            for (let i = 0; i < active.length; i++) {
              xCuts.push(Math.max(0, active[i].minx), Math.min(worldW, active[i].maxx));
            }
            xCuts.sort((a, b) => a - b);
            const uniqueX = [];
            for (let i = 0; i < xCuts.length; i++) {
              if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
            }
            for (let xi = 0; xi < uniqueX.length - 1; xi++) {
              const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
              const insideHole = active.some((h) => midZ >= h.minz && midZ <= h.maxz && ((x0+x1)*0.5) >= h.minx && ((x0+x1)*0.5) <= h.maxx);
              if (!insideHole && x1 - x0 > 0.05 && z1 - z0 > 0.05) addFloorRect(x0, z0, x1, z1);
            }
          }
        }
        // Ceiling, but with real vertical openings above the elevators.
        // This prevents the exit from becoming a low-ceiling tunnel and lets
        // the player descend naturally into the concrete structure.
        const ceilMap = Materials.ceiling.map.clone();
        ceilMap.repeat.set(worldW / 2, worldD / 2);
        ceilMap.needsUpdate = true;
        const ceilMat = Materials.ceiling.clone();
        ceilMat.map = ceilMap;
        const addCeilRect = (minx, minz, maxx, maxz) => {
          const w = maxx - minx, d = maxz - minz;
          if (w < 0.05 || d < 0.05) return;
          const geo = new THREE.PlaneGeometry(w, d);
          const mesh = new THREE.Mesh(geo, ceilMat);
          mesh.rotation.x = Math.PI / 2;
          mesh.position.set((minx + maxx) * 0.5, H, (minz + maxz) * 0.5);
          this.group.add(mesh);
        };
        if (!holes.length) {
          addCeilRect(0, 0, worldW, worldD);
        } else {
          const zCuts = [0, worldD];
          for (let i = 0; i < holes.length; i++) {
            zCuts.push(Math.max(0, holes[i].minz), Math.min(worldD, holes[i].maxz));
          }
          zCuts.sort((a, b) => a - b);
          const uniqueZ = [];
          for (let i = 0; i < zCuts.length; i++) {
            if (!uniqueZ.length || Math.abs(uniqueZ[uniqueZ.length - 1] - zCuts[i]) > 0.001) uniqueZ.push(zCuts[i]);
          }
          for (let zi = 0; zi < uniqueZ.length - 1; zi++) {
            const z0 = uniqueZ[zi], z1 = uniqueZ[zi + 1];
            const midZ = (z0 + z1) * 0.5;
            const active = holes.filter((h) => midZ >= h.minz && midZ <= h.maxz);
            const xCuts = [0, worldW];
            for (let i = 0; i < active.length; i++) {
              xCuts.push(Math.max(0, active[i].minx), Math.min(worldW, active[i].maxx));
            }
            xCuts.sort((a, b) => a - b);
            const uniqueX = [];
            for (let i = 0; i < xCuts.length; i++) {
              if (!uniqueX.length || Math.abs(uniqueX[uniqueX.length - 1] - xCuts[i]) > 0.001) uniqueX.push(xCuts[i]);
            }
            for (let xi = 0; xi < uniqueX.length - 1; xi++) {
              const x0 = uniqueX[xi], x1 = uniqueX[xi + 1];
              const insideHole = active.some((h) => midZ >= h.minz && midZ <= h.maxz && ((x0 + x1) * 0.5) >= h.minx && ((x0 + x1) * 0.5) <= h.maxx);
              if (!insideHole && x1 - x0 > 0.05 && z1 - z0 > 0.05) addCeilRect(x0, z0, x1, z1);
            }
          }
        }



        // Wall meshes from same merged regions as colliders (skip envelope)
        const used = [];
        for (let z = 0; z < this.rows; z++) used.push(new Array(this.cols).fill(false));
        for (let z = 0; z < this.rows; z++) {
          for (let x = 0; x < this.cols; x++) {
            if (used[z][x] || !this.isSolidTile(this.getTile(x, z))) continue;
            let x2 = x;
            while (x2 + 1 < this.cols && this.isSolidTile(this.getTile(x2 + 1, z)) && !used[z][x2 + 1]) x2++;
            let z2 = z;
            let canGrow = true;
            while (canGrow && z2 + 1 < this.rows) {
              for (let xx = x; xx <= x2; xx++) {
                if (!this.isSolidTile(this.getTile(xx, z2 + 1)) || used[z2 + 1][xx]) { canGrow = false; break; }
              }
              if (canGrow) z2++;
            }
            for (let zz = z; zz <= z2; zz++) for (let xx = x; xx <= x2; xx++) used[zz][xx] = true;

            const sx = (x2 - x + 1) * T;
            const sz = (z2 - z + 1) * T;
            // Level 0 walls remain normal Backrooms wallpaper all the way to the elevator.
            // The elevator facade provides its own concrete surround; recoloring nearby
            // procedural wall runs was causing large black-looking slabs beside the exit.
            const wallMat = (((x + z) % 3 === 0) ? Materials.wallAlt : Materials.wall);
            const mesh = new THREE.Mesh(makeWorldBox(sx, H, sz, 0.5), wallMat);
            mesh.position.set((x + x2 + 1) * T * 0.5, H * 0.5, (z + z2 + 1) * T * 0.5);
            this.group.add(mesh);

            const trim = new THREE.Mesh(Geometries.box, Materials.wallTrim);
            trim.scale.set(sx + 0.03, 0.11, sz + 0.03);
            trim.position.set(mesh.position.x, 0.055, mesh.position.z);
            this.group.add(trim);

            const cap = new THREE.Mesh(Geometries.box, Materials.wallTrim);
            cap.scale.set(sx + 0.03, 0.06, sz + 0.03);
            cap.position.set(mesh.position.x, H - 0.03, mesh.position.z);
            this.group.add(cap);
          }
        }

        // Columns, frames, special pads
        for (let z = 0; z < this.rows; z++) {
          for (let x = 0; x < this.cols; x++) {
            const t = this.getTile(x, z);
            const w = this.tileToWorld(x, z);

            if (t === TILE.COLUMN) {
              const col = new THREE.Mesh(Geometries.column, Materials.column);
              col.position.set(w.x, H * 0.5, w.z);
              this.group.add(col);
            }
            if (t === TILE.START) {
              this.startPos.set(w.x, 0, w.z);
            }
            if (t === TILE.CHECK) {
              const pad = new THREE.Mesh(Geometries.box, Materials.checkpoint);
              pad.scale.set(1.6, 0.06, 1.6);
              pad.position.set(w.x, 0.03, w.z);
              this.group.add(pad);
              const cpId = "cp" + Checkpoints.list.filter((c) => c.id !== "start").length;
              this.triggers.push({ type: "checkpoint", id: cpId, minx: w.x - 1.2, maxx: w.x + 1.2, minz: w.z - 1.2, maxz: w.z + 1.2 });
              Checkpoints.register(cpId, new THREE.Vector3(w.x, 0, w.z), 0);
            }
          }
        }

        // IMPORTANT PERFORMANCE FIX:
        // Older revisions created a fluorescent fixture for roughly every
        // third walkable tile. In a 48x40 module world that can mean thousands
        // of THREE.Mesh objects, making startup appear frozen at 52%.
        // Lighting is now generated once per procedural module instead.
        // DARK modules receive no overhead fixtures at all.
        for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
          const mod = MapGraph.nodes[ni];
          if (!mod) continue;
          const profile = mod.lightProfile || "NORMAL";
          if (profile === "DARK") continue;

          const centerX = Math.floor(mod.gx + mod.w * 0.5) * LevelGenerator.CELL + 2;
          const centerZ = Math.floor(mod.gz + mod.h * 0.5) * LevelGenerator.CELL + 2;
          const candidates = [];

          // Use the module center and, for larger/bright modules, one or two
          // additional positions. Find actual walkable tiles before placing.
          candidates.push([centerX, centerZ]);
          if (profile === "BRIGHT" && (mod.w * mod.h >= 2)) {
            candidates.push([mod.gx * LevelGenerator.CELL + 2, mod.gz * LevelGenerator.CELL + 2]);
            if (mod.w * mod.h >= 4) {
              candidates.push([(mod.gx + mod.w - 1) * LevelGenerator.CELL + 3,
                               (mod.gz + mod.h - 1) * LevelGenerator.CELL + 3]);
            }
          }

          const usedLightTiles = [];
          for (let ci = 0; ci < candidates.length; ci++) {
            const tx = candidates[ci][0], tz = candidates[ci][1];
            if (!this.inBounds(tx, tz) || this.getTile(tx, tz) === TILE.WALL || this.getTile(tx, tz) === TILE.COLUMN) continue;
            let duplicate = false;
            for (let ui = 0; ui < usedLightTiles.length; ui++) {
              if (usedLightTiles[ui][0] === tx && usedLightTiles[ui][1] === tz) { duplicate = true; break; }
            }
            if (duplicate) continue;
            usedLightTiles.push([tx, tz]);
            const w = this.tileToWorld(tx, tz);
            const scale = profile === "BRIGHT" ? 1.22 : 0.98;
            const withPoint = profile === "BRIGHT" && LightingSystem.lights.length < 34;
            LightingSystem.addFluorescent(scene, w.x, H - 0.06, w.z, withPoint, scale);
          }
        }

        // A small number of structural beams are placed per module instead of
        // per tile. This preserves the industrial ceiling language without
        // creating thousands of separate THREE.Mesh objects during startup.
        for (let ni = 0; ni < MapGraph.nodes.length; ni++) {
          const mod = MapGraph.nodes[ni];
          if (!mod || mod.lightProfile === "DARK") continue;
          const tx = Math.floor(mod.gx + mod.w * 0.5) * LevelGenerator.CELL + 2;
          const tz = Math.floor(mod.gz + mod.h * 0.5) * LevelGenerator.CELL + 2;
          if (!this.inBounds(tx, tz) || this.getTile(tx, tz) === TILE.WALL || this.getTile(tx, tz) === TILE.COLUMN) continue;
          const w = this.tileToWorld(tx, tz);
          if (Stairwell.containsWorld(w.x, w.z)) continue;
          const beam = new THREE.Mesh(Geometries.beam, Materials.beam);
          beam.scale.set(T * Math.min(4.2, Math.max(2.0, mod.w * 1.8)), 1, T * 0.28);
          beam.position.set(w.x, H - 0.14, w.z);
          this.group.add(beam);
        }

        // Rare anomaly props (no gameplay effect)
        for (let i = 0; i < MapGraph.nodes.length; i++) {
          const n = MapGraph.nodes[i];
          if (n.anomaly !== "object" && n.anomaly !== "odd_door") continue;
          const w = this.tileToWorld(n.gx * LevelGenerator.CELL + 3, n.gz * LevelGenerator.CELL + 3);
          if (n.anomaly === "object") {
            const box = new THREE.Mesh(Geometries.box, Materials.frame);
            box.scale.set(0.7, 1.15, 0.45);
            box.position.set(w.x, 0.58, w.z);
            this.group.add(box);
          } else {
            const frame = new THREE.Mesh(Geometries.box, Materials.wallTrim);
            frame.scale.set(1.6, 2.4, 0.12);
            frame.position.set(w.x, 1.2, w.z);
            this.group.add(frame);
          }
        }

        scene.add(this.group);
      },

      buildHandcrafted(sceneRef) {
        this.buildProcedural(sceneRef, GameState.seed || 483921);
      },

      buildProcedural(sceneRef, seed) {
        const result = LevelGenerator.generateValid(seed, 40);
        if (!result) {
          console.warn("Procedural generation failed; retrying with a fresh seed");
          const retrySeed = ((seed ^ 0x9e3779b9) >>> 0);
          const retry = LevelGenerator.generateValid(retrySeed, 40);
          if (!retry) {
            const startSeed = document.getElementById("start-seed");
            if (startSeed) startSeed.textContent = "LEVEL 0 GENERATION FAILED — PRESS R TO RETRY";
            return false;
          }
          return this.buildProcedural(sceneRef, retry.seed);
        }
        GameState.seed = result.seed;
        Checkpoints.reset();
        this.clear(sceneRef);
        this.loadGenerated(result);
        Stairwell.planFrom(result);
        this.buildColliders();
        this.buildMeshes(sceneRef);
        Stairwell.build(sceneRef);
        SpawnManager.apply(result);
        PickupSystem.generate(result.seed);
        const seedEl = document.getElementById("hud-seed-val");
        if (seedEl) seedEl.textContent = String(result.seed);
        const startSeed = document.getElementById("start-seed");
        if (startSeed) startSeed.textContent = "LEVEL 0 · SEED " + result.seed;
        return true;
      },

      queryTriggers(px, pz, fn) {
        for (let i = 0; i < this.triggers.length; i++) {
          const t = this.triggers[i];
          if (px >= t.minx && px <= t.maxx && pz >= t.minz && pz <= t.maxz) fn(t);
        }
      }
    };

    /* ------------------------------------------------------------------
       LEVEL 1 — CONCRETE SERVICE / PARKING COMPLEX
       A separate playable space used after the Level 0 elevator descent.
       It intentionally uses broad concrete lanes, pillars, sparse lighting,
       reflective floors and darker side sections.
       ------------------------------------------------------------------ */
    /* ------------------------------------------------------------------
       LEVEL 1 — INFINITE CONCRETE SERVICE / PARKING COMPLEX
       Streaming chunk generator. Chunks are deterministic from the run seed
       and chunk coordinates, so the world is effectively infinite while only
       a small window around the player is kept in the scene/collision list.
       ------------------------------------------------------------------ */
    const Level1 = {
      active:false, group:null, colliders:[], triggers:[],
      macroSize:600, microSize:60, activeRadius:2, seed:0,
      chunks:new Map(), center:new THREE.Vector3(), start:new THREE.Vector3(),
      baseY:0, lights:[], ambientLights:[], puddles:[], resourceRegions:Object.create(null),
      streamTimer:0, lastMCX:999999, lastMCZ:999999,
      levelTime:0, blackoutState:'idle', blackoutTimer:0, blackoutNext:60,
      blackoutCooldown:0, blackoutDuration:0, blackoutCycle:0,
      blackoutFlickerT:0, blackoutFlickerNext:0, blackoutWindowStart:0,
      shared:{}, macroCache:new Map(), exitMacro:null,
      resetVisuals(){
        if(this.group && scene) scene.remove(this.group);
        for(const L of this.lights){ if(L.parent) L.parent.remove(L); else if(scene) scene.remove(L); }
        for(const L of this.ambientLights){ if(L.parent) L.parent.remove(L); else if(scene) scene.remove(L); }
        this.chunks.clear(); this.colliders.length=0; this.triggers.length=0;
        this.lights.length=0; this.ambientLights.length=0; this.puddles.length=0;
        this.group=null; this.active=false; this.lastMCX=999999; this.lastMCZ=999999; this.resourceRegions=Object.create(null);
        this.levelTime=0; this.blackoutState='idle'; this.blackoutTimer=0; this.blackoutNext=60;
        this.blackoutCooldown=0; this.blackoutDuration=0; this.blackoutCycle=0;
        this.blackoutFlickerT=0; this.blackoutFlickerNext=0; this.blackoutWindowStart=0; this.macroCache.clear(); this.exitMacro=null;
        if(scene){ scene.fog=null; scene.background && scene.background.setHex(0x202321); }
        if(CameraRig.camera){ CameraRig.camera.far=CONFIG.cameraFar; CameraRig.camera.updateProjectionMatrix(); }
      },
      hash2(x,z,salt=0){
        let h=(this.seed>>>0)^Math.imul((x|0)+salt,0x45d9f3b)^Math.imul((z|0)-salt,0x27d4eb2d);
        h^=h>>>16; h=Math.imul(h,0x85ebca6b); h^=h>>>13; h=Math.imul(h,0xc2b2ae35); h^=h>>>16;
        return (h>>>0)/4294967296;
      },
      rngFor(cx,cz,salt=0){
        let h=(this.seed>>>0)^Math.imul((cx|0)+salt,0x45d9f3b)^Math.imul((cz|0)-salt,0x27d4eb2d);
        h^=h>>>16; h=Math.imul(h,0x85ebca6b); h^=h>>>13; h=Math.imul(h,0xc2b2ae35); h^=h>>>16;
        let a=(h>>>0)||1;
        return ()=>{ a^=a<<13; a^=a>>>17; a^=a<<5; return (a>>>0)/4294967296; };
      },
      macroKey(mx,mz){ return mx+','+mz; },
      macroRaw(mx,mz){ return this.hash2(mx,mz,17); },
      macroType(mx,mz){
        const key=this.macroKey(mx,mz); if(this.macroCache.has(key)) return this.macroCache.get(key);
        // Parking starts at 60%. Each neighboring macro-region whose own raw roll
        // lands in the parking band lowers this region by 10 percentage points.
        let p=0.60;
        const ns=[[mx-1,mz],[mx+1,mz],[mx,mz-1],[mx,mz+1]];
        let parkingNeighbors=0;
        for(const [nx,nz] of ns) if(this.macroRaw(nx,nz)<0.60) parkingNeighbors++;
        p=Math.max(0.20, p-0.10*parkingNeighbors);
        // The elevator's macro is always maintenance so the player never starts
        // in the middle of a 600m parking expanse.
        if(this.start && Math.floor(this.start.x/this.macroSize)===mx && Math.floor(this.start.z/this.macroSize)===mz) return 'maintenance';
        const type=this.macroRaw(mx,mz)<p?'parking':'maintenance';
        this.macroCache.set(key,type); return type;
      },
      macroBounds(mx,mz){ return {minx:mx*this.macroSize,minz:mz*this.macroSize,maxx:(mx+1)*this.macroSize,maxz:(mz+1)*this.macroSize}; },
      addBox(g,mat,x,y,z,sx,sy,sz){ const m=new THREE.Mesh(Geometries.box,mat); m.position.set(x,y,z); m.scale.set(sx,sy,sz); g.add(m); return m; },
      addWall(g,rec,x,z,sx,sz,h=3.15){
        this.addBox(g,this.shared.concrete,x,this.baseY+h/2,z,sx,h,sz);
        rec.colliders.push({min:new THREE.Vector3(x-sx/2,this.baseY,z-sz/2),max:new THREE.Vector3(x+sx/2,this.baseY+h,z+sz/2)});
      },
      pillar(g,rec,x,z){
        this.addBox(g,this.shared.concretePillar,x,this.baseY+2.4,z,0.92,4.8,0.92);
        rec.colliders.push({min:new THREE.Vector3(x-.46,this.baseY,z-.46),max:new THREE.Vector3(x+.46,this.baseY+4.8,z+.46)});
        this.addBox(g,this.shared.concreteDark,x,this.baseY+0.12,z,1.18,0.24,1.18);
      },
      fixture(g,x,z,bright,rng,rec){
        const panel=new THREE.Mesh(Geometries.lightPanel,this.shared.light);
        panel.scale.set(1.35,1,0.34); panel.position.set(x,this.baseY+4.55,z); g.add(panel);
        const housing=new THREE.Mesh(Geometries.lightHousing,Materials.lightHousing);
        housing.scale.set(1.42,1,0.4); housing.position.set(x,this.baseY+4.5,z); g.add(housing);
        const blackout=this.blackoutState==='flicker'||this.blackoutState==='outage';
        panel.material.emissiveIntensity=blackout?0:2.0*bright;
        rec.fixtures.push({panel,housing,base:bright});
        if(rng()<0.10 && this.lights.length<12){
          const L=new THREE.PointLight(0xfff3d4,blackout?0:0.72*bright,20,1.8);
          L.position.set(x,this.baseY+4.0,z); scene.add(L); this.lights.push(L); rec.pointLights.push(L);
        }
      },
      pipeRun(g,x,z,lenX,lenZ,rng){
        if(lenX>0) this.addBox(g,this.shared.pipe,x,this.baseY+4.28,z,lenX,0.16,0.16);
        else this.addBox(g,this.shared.pipe,x,this.baseY+4.28,z,0.16,0.16,lenZ);
        if(rng()<0.35){
          const px=x+(lenX>0?lenX*.22:0), pz=z+(lenZ>0?lenZ*.22:0);
          this.addBox(g,this.shared.pipe,px,this.baseY+3.95,pz,0.12,0.52,0.12);
        }
      },
      concreteTexture(repeatX,repeatY){
        const t=TextureFactory.concrete(); t.repeat.set(repeatX,repeatY); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.needsUpdate=true; return t;
      },
      waterTexture(){
        const c=document.createElement('canvas'); c.width=256; c.height=256;
        const ctx=c.getContext('2d'); ctx.fillStyle='#273b3c'; ctx.fillRect(0,0,256,256);
        for(let i=0;i<900;i++){
          const x=Math.random()*256,y=Math.random()*256,r=Math.random()*1.8;
          ctx.fillStyle='rgba(180,205,205,'+(0.03+Math.random()*0.10)+')'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
        }
        for(let r=22;r<128;r+=22){ ctx.strokeStyle='rgba(210,225,225,0.10)'; ctx.lineWidth=1.2; ctx.beginPath(); ctx.arc(128,128,r,0,Math.PI*2); ctx.stroke(); }
        const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;
      },
      materialSet(){
        if(this.shared.floor) return;
        const floorMap=this.concreteTexture(6,6);
        const pillarMap=this.concreteTexture(2.2,7.0);
        const ceilMap=this.concreteTexture(5,5);
        this.shared.floor=new THREE.MeshStandardMaterial({map:floorMap,color:0xb0b0aa,roughness:0.62,metalness:0.06});
        this.shared.concrete=new THREE.MeshStandardMaterial({map:floorMap.clone(),color:0xa3a6a1,roughness:0.78,metalness:0.02});
        this.shared.concretePillar=new THREE.MeshStandardMaterial({map:pillarMap,color:0x9da09b,roughness:0.82,metalness:0.02});
        this.shared.concreteDark=new THREE.MeshStandardMaterial({map:pillarMap.clone(),color:0x747874,roughness:0.88,metalness:0.01});
        this.shared.concreteLight=new THREE.MeshStandardMaterial({map:ceilMap,color:0xb7b9b4,roughness:0.74,metalness:0.02});
        this.shared.beam=new THREE.MeshStandardMaterial({map:pillarMap.clone(),color:0x686d69,roughness:0.82,metalness:0.04});
        this.shared.metal=new THREE.MeshStandardMaterial({color:0x6f7471,roughness:0.42,metalness:0.72});
        this.shared.light=new THREE.MeshStandardMaterial({color:0xf1eee0,emissive:0xfff1c8,emissiveIntensity:2.0,roughness:0.4});
        this.shared.pipe=new THREE.MeshStandardMaterial({color:0x777b78,roughness:0.62,metalness:0.5});
        this.shared.water=new THREE.MeshPhysicalMaterial({map:this.waterTexture(),color:0x496668,transparent:true,opacity:0.78,roughness:0.08,metalness:0.12,clearcoat:0.75,clearcoatRoughness:0.08,side:THREE.DoubleSide});
        this.shared.water.needsUpdate=true;
      },
      addPuddle(g,wx,wz,rng){
        const r=0.46+rng()*0.08;
        const geo=new THREE.CircleGeometry(r,24);
        const mesh=new THREE.Mesh(geo,this.shared.water);
        mesh.rotation.x=-Math.PI/2; mesh.position.set(wx,this.baseY+0.012,wz); g.add(mesh);
        this.puddles.push({x:wx,z:wz,r:r*0.92});
      },
      generatePuddles(g,rec,bx,bz,S,rng,openMask){
        let made=0;
        const cells=S/15;
        for(let tx=0;tx<cells && made<8;tx++) for(let tz=0;tz<cells && made<8;tz++){
          if(rng()>0.03) continue;
          const x=bx+tx*15+7.5, z=bz+tz*15+7.5;
          if(openMask && !openMask(x,z)) continue;
          if(this.puddles.some(p=>(p.x-x)*(p.x-x)+(p.z-z)*(p.z-z)<1.4)) continue;
          this.addPuddle(g,x+(rng()-.5)*5,z+(rng()-.5)*5,rng); made++;
        }
      },
      getMaintenanceWalls(mx,mz){
        const key=this.macroKey(mx,mz)+':walls';
        if(this.macroCache.has(key)) return this.macroCache.get(key);
        const mb=this.macroBounds(mx,mz), sector=150, cell=5, n=30, walls=[];
        const rng=this.rngFor(mx,mz,707);
        const push=(x,z,sx,sz,h=3.45)=>walls.push({x,z,sx,sz,h});
        // Each 150x150 maintenance sector is a Level-0-inspired maze: actual
        // concrete walls define corridors, but a high loop-removal rate creates
        // many intersections and wider junctions instead of constant dead ends.
        for(let sy=0;sy<4;sy++) for(let sx=0;sx<4;sx++){
          const x0=mb.minx+sx*sector,z0=mb.minz+sy*sector;
          const visited=Array.from({length:n},()=>new Uint8Array(n));
          const openH=Array.from({length:n},()=>new Uint8Array(n-1));
          const openV=Array.from({length:n-1},()=>new Uint8Array(n));
          const stack=[[Math.floor(rng()*n),Math.floor(rng()*n)]];
          visited[stack[0][1]][stack[0][0]]=1;
          while(stack.length){
            const [cx,cz]=stack[stack.length-1];
            const dirs=[];
            for(const d of [0,1,2,3]){
              const nx=cx+DIR4[d].x,nz=cz+DIR4[d].z;
              if(nx>=0&&nz>=0&&nx<n&&nz<n&&!visited[nz][nx]) dirs.push(d);
            }
            if(!dirs.length){stack.pop();continue;}
            const d=dirs[Math.floor(rng()*dirs.length)],nx=cx+DIR4[d].x,nz=cz+DIR4[d].z;
            if(d===1)openH[cz][cx]=1; if(d===3)openH[cz][nx]=1;
            if(d===2)openV[cz][cx]=1; if(d===0)openV[nz][cx]=1;
            visited[nz][nx]=1; stack.push([nx,nz]);
          }
          // Add many loops. Around 28% of remaining walls disappear, making
          // intersections common while retaining the visual maze language.
          for(let z=0;z<n;z++) for(let x=0;x<n-1;x++) if(!openH[z][x] && rng()<0.28) openH[z][x]=1;
          for(let z=0;z<n-1;z++) for(let x=0;x<n;x++) if(!openV[z][x] && rng()<0.28) openV[z][x]=1;
          // Emit only closed boundaries as concrete wall strips.
          for(let z=0;z<n;z++){
            for(let x=0;x<n-1;x++) if(!openH[z][x]) push(x0+(x+1)*cell,z0+(z+.5)*cell,0.38,cell+0.12);
          }
          for(let z=0;z<n-1;z++){
            for(let x=0;x<n;x++) if(!openV[z][x]) push(x0+(x+.5)*cell,z0+(z+1)*cell,cell+0.12,0.38);
          }
          // Do not wall off the internal 150m sectors. Their maze networks
          // deliberately bleed into one another, creating the larger, open
          // intersections that distinguish Level 1 maintenance areas from Level 0.
          // The outer 600m boundary remains visually open to neighboring macro areas.
        }
        // Add a handful of larger concrete partitions/open bays.
        for(let i=0;i<10;i++){
          const x=mb.minx+30+rng()*540,z=mb.minz+30+rng()*540;
          if(rng()<0.5) push(x,z,0.38,18+rng()*30); else push(x,z,18+rng()*30,0.38);
        }
        this.macroCache.set(key,walls); return walls;
      },
      addClippedWall(g,rec,wall,bx,bz,S){
        const minX=Math.max(wall.x-wall.sx/2,bx), maxX=Math.min(wall.x+wall.sx/2,bx+S);
        const minZ=Math.max(wall.z-wall.sz/2,bz), maxZ=Math.min(wall.z+wall.sz/2,bz+S);
        if(maxX-minX<0.02 || maxZ-minZ<0.02) return;
        // Keep the elevator landing comfortably clear of maintenance geometry.
        if(this.start && Math.abs((minX+maxX)*0.5-this.start.x)<10 && Math.abs((minZ+maxZ)*0.5-this.start.z)<10) return;
        this.addBox(g,this.shared.concrete,(minX+maxX)/2,this.baseY+wall.h/2,(minZ+maxZ)/2,maxX-minX,wall.h,maxZ-minZ);
        rec.colliders.push({min:new THREE.Vector3(minX,this.baseY,minZ),max:new THREE.Vector3(maxX,this.baseY+wall.h,maxZ)});
      },
      buildMaintenanceMacroParts(g,rec,mx,mz,bx,bz,S,rng){
        const walls=this.getMaintenanceWalls(mx,mz);
        for(const wall of walls) this.addClippedWall(g,rec,wall,bx,bz,S);
      },
      macroGeometry(mx,mz){
        const key=this.macroKey(mx,mz), type=this.macroType(mx,mz);
        if(this.macroCache.has(key+':geometry')) return this.macroCache.get(key+':geometry');
        const data={type,exitEdge:null};
        this.macroCache.set(key+':geometry',data); return data;
      },
      buildChunk(cx,cz){
        const key=cx+','+cz; if(this.chunks.has(key)) return;
        const rng=this.rngFor(cx,cz,101), g=new THREE.Group(); g.name='L1_chunk_'+key;
        const rec={cx,cz,group:g,colliders:[],fixtures:[],pointLights:[]};
        const ox=cx*this.microSize, oz=cz*this.microSize, S=this.microSize;
        const centerX=ox+S/2, centerZ=oz+S/2;
        const mx=Math.floor(centerX/this.macroSize), mz=Math.floor(centerZ/this.macroSize);
        const type=this.macroType(mx,mz); rec.type=type; rec.mx=mx; rec.mz=mz;
        // Continuous concrete floor and ceiling. Texture repetition makes the
        // huge world read as actual concrete rather than a flat gray plane.
        const floorMap=this.shared.floor.map.clone(); floorMap.repeat.set(S/12,S/12); floorMap.needsUpdate=true;
        const floorMat=this.shared.floor.clone(); floorMat.map=floorMap;
        const floor=new THREE.Mesh(new THREE.PlaneGeometry(S,S),floorMat); floor.rotation.x=-Math.PI/2; floor.position.set(centerX,this.baseY,centerZ); g.add(floor);
        rec.colliders.push({min:new THREE.Vector3(ox,this.baseY-0.18,oz),max:new THREE.Vector3(ox+S,this.baseY,oz+S)});
        const ceilMap=this.shared.concreteLight.map.clone(); ceilMap.repeat.set(S/14,S/14); ceilMap.needsUpdate=true;
        const ceilMat=this.shared.concreteLight.clone(); ceilMat.map=ceilMap;
        this.addBox(g,ceilMat,centerX,this.baseY+4.82,centerZ,S,0.22,S);
        // Structural grid is present in both spaces, but parking lots are more open.
        for(let ix=8;ix<S;ix+=16) for(let iz=8;iz<S;iz+=16){
          if(rng()<0.10) continue;
          this.pillar(g,rec,ox+ix,oz+iz);
        }
        if(type==='maintenance'){
          this.buildMaintenanceMacroParts(g,rec,mx,mz,ox,oz,S,rng);
        } else {
          // Parking lots get a few sparse dividers, never enough to destroy the
          // enormous sightlines.
          if(rng()<0.35){
            const z=oz+S*(0.35+0.3*rng()); this.addWall(g,rec,ox+S*.5,z,S*.58,0.34,1.4);
          }
          if(rng()<0.25){
            const x=ox+S*(0.25+0.5*rng()); this.addWall(g,rec,x,oz+S*.55,0.34,S*.38,1.4);
          }
        }
        // Ceiling beams/pipes continue across both generation types.
        if(rng()<0.85) this.pipeRun(g,centerX,oz+S*.35,S*.72,0,rng);
        if(rng()<0.65) this.pipeRun(g,ox+S*.68,centerZ,0,S*.70,rng);
        const lightMode=rng(); rec.dark=lightMode<0.18; rec.bright=lightMode>0.78;
        const spacing=type==='parking' ? (rec.bright?12:18) : (rec.bright?10:14);
        if(!rec.dark){
          for(let x=spacing/2;x<S;x+=spacing) for(let z=spacing/2;z<S;z+=spacing){
            if(rng()<(rec.bright?0.08:0.32)) continue;
            this.fixture(g,ox+x,oz+z,rec.bright?1.3:0.86,rng,rec);
          }
        }
        // Puddles are preferentially placed in parking/open floor; a smaller number
        // can appear in unusually wide maintenance sections.
        if(type==='parking' || rng()<0.20){
          const openMask=(x,z)=>{
            if(type==='parking') return true;
            return !rec.colliders.some(c=>x>=c.min.x-1 && x<=c.max.x+1 && z>=c.min.z-1 && z<=c.max.z+1);
          };
          this.generatePuddles(g,rec,ox,oz,S,rng,openMask);
        }
        // Resource density is defined on 150x150m regions, not streaming chunks.
        // Generate a region once as soon as one of its chunks becomes active.
        const rx=Math.floor(centerX/CONFIG.items.regionSize), rz=Math.floor(centerZ/CONFIG.items.regionSize);
        PickupSystem.generateLevel1Region(rx,rz,this.seed);
        this.group.add(g); this.chunks.set(key,rec);
      },
      rebuildColliders(){
        this.colliders.length=0;
        for(const rec of this.chunks.values()) for(const c of rec.colliders) this.colliders.push(c);
      },
      unloadFar(cx,cz){
        for(const [key,rec] of this.chunks){
          if(Math.max(Math.abs(rec.cx-cx),Math.abs(rec.cz-cz))>this.activeRadius){
            if(rec.group.parent) rec.group.parent.remove(rec.group);
            this.chunks.delete(key);
          }
        }
        // Remove puddles belonging to unloaded chunks from the proximity list.
        this.puddles=this.puddles.filter(p=>Math.max(Math.abs(Math.floor(p.x/this.microSize)-cx),Math.abs(Math.floor(p.z/this.microSize)-cz))<=this.activeRadius);
      },
      stream(force=false){
        if(!this.active) return;
        const source=(typeof Player!=='undefined'&&Player.position)?Player.position:this.center;
        const mcx=Math.floor(source.x/this.microSize), mcz=Math.floor(source.z/this.microSize);
        if(!force&&mcx===this.lastMCX&&mcz===this.lastMCZ) return;
        this.lastMCX=mcx; this.lastMCZ=mcz;
        const wanted=[];
        for(let dz=-this.activeRadius;dz<=this.activeRadius;dz++) for(let dx=-this.activeRadius;dx<=this.activeRadius;dx++) wanted.push([dx*dx+dz*dz,dx,dz]);
        wanted.sort((a,b)=>a[0]-b[0]);
        for(const [,dx,dz] of wanted) this.buildChunk(mcx+dx,mcz+dz);
        this.unloadFar(mcx,mcz); this.rebuildColliders();
        this.center.copy(source); this.center.y=this.baseY;
      },
      setFixtureState(on,dim=1){
        for(const rec of this.chunks.values()){
          for(const f of rec.fixtures){
            const e=on ? 2.0*f.base*dim : 0.0;
            f.panel.material.emissiveIntensity=e;
            f.panel.visible=true; f.housing.visible=true;
          }
          for(const L of rec.pointLights) L.intensity=on ? 0.72*dim : 0;
        }
      },
      startBlackout(){
        if(this.blackoutState!=='idle') return;
        this.blackoutState='flicker'; this.blackoutFlickerT=0; this.blackoutFlickerNext=0.10;
        this.blackoutDuration=30+this.rngFor(this.blackoutCycle,0,333)()*30;
        this.setFixtureState(false);
        if(scene){ scene.background && scene.background.setHex(0x050606); scene.fog=new THREE.Fog(0x000000,18,64); }
      },
      beginOutage(){
        this.blackoutState='outage'; this.blackoutTimer=0;
        this.setFixtureState(false);
        if(scene){ scene.background && scene.background.setHex(0x000000); if(!scene.fog) scene.fog=new THREE.Fog(0x000000,10,64); scene.fog.near=10; scene.fog.far=64; scene.fog.color.setHex(0x000000); }
      },
      endBlackout(){
        this.blackoutState='cooldown'; this.blackoutCooldown=60+this.rngFor(this.blackoutCycle,7,334)()*30;
        this.setFixtureState(true,1);
        if(scene){ scene.fog=null; scene.background && scene.background.setHex(0x202321); }
      },
      updateBlackout(dt){
        this.levelTime+=dt;
        if(this.blackoutState==='idle' && this.levelTime>=this.blackoutNext){
          const atGuarantee=this.levelTime >= this.blackoutWindowStart+90;
          if(atGuarantee || Math.random()<0.10){
            this.startBlackout();
          } else {
            // Missed the 60s roll: try again every 6s until the hard 90s guarantee.
            this.blackoutNext=Math.min(this.blackoutWindowStart+90,this.levelTime+6);
          }
        }
        if(this.blackoutState==='flicker'){
          this.blackoutFlickerT+=dt;
          if(this.blackoutFlickerT>=2.4){ this.beginOutage(); return; }
          if(this.blackoutFlickerT>=this.blackoutFlickerNext){
            this.blackoutFlickerNext=this.blackoutFlickerT+(0.07+Math.random()*0.22);
            const on=Math.random()>0.38; this.setFixtureState(on,on?1:0.08);
          }
        } else if(this.blackoutState==='outage'){
          this.blackoutTimer+=dt;
          this.setFixtureState(false);
          if(scene&&scene.fog){ scene.fog.near=10; scene.fog.far=64; scene.fog.color.setHex(0x000000); }
          if(this.blackoutTimer>=this.blackoutDuration) this.endBlackout();
        } else if(this.blackoutState==='cooldown'){
          this.blackoutCooldown-=dt;
          if(this.blackoutCooldown<=0){
            this.blackoutState='idle'; this.blackoutCycle++;
            // New blackout cycle begins 60s after the cooldown ends.
            this.blackoutWindowStart=this.levelTime+60;
            this.blackoutNext=this.blackoutWindowStart+60;
          }
        }
      },
      updatePuddleVisibility(){
        if(!CameraRig.camera) return;
        let inside=false;
        for(const p of this.puddles){ const dx=Player.position.x-p.x,dz=Player.position.z-p.z; if(dx*dx+dz*dz<=p.r*p.r){inside=true;break;} }
        const base=(this.blackoutState==='flicker'||this.blackoutState==='outage')?64:320;
        const target=inside ? base*0.85 : base;
        if(Math.abs(CameraRig.camera.far-target)>0.5){ CameraRig.camera.far+=(target-CameraRig.camera.far)*0.35; CameraRig.camera.updateProjectionMatrix(); }
      },
      placeExit(){
        // Pick the nearest maintenance/parking boundary from the forced spawn macro.
        // The exit is never placed in the middle of a parking lot.
        const smx=Math.floor(this.start.x/this.macroSize), smz=Math.floor(this.start.z/this.macroSize);
        let best=null;
        for(let dz=-2;dz<=2;dz++) for(let dx=-2;dx<=2;dx++){
          const mx=smx+dx,mz=smz+dz,type=this.macroType(mx,mz); const dist=Math.hypot(dx,dz);
          if(type==='maintenance' || Math.abs(dx)+Math.abs(dz)<=1){ if(!best||dist<best.dist) best={mx,mz,type,dist}; }
        }
        if(!best) best={mx:smx,mz:smz,type:'maintenance',dist:0};
        this.exitMacro=best;
        const mb=this.macroBounds(best.mx,best.mz);
        const side=Math.floor(this.hash2(best.mx,best.mz,99)*4), inset=12, x0=mb.minx+inset, x1=mb.maxx-inset, z0=mb.minz+inset, z1=mb.maxz-inset;
        let x=(x0+x1)/2,z=(z0+z1)/2;
        if(side===0) z=z0+3; if(side===1) x=x1-3; if(side===2) z=z1-3; if(side===3) x=x0+3;
        const trigger={type:'level1exit',minx:x-2.2,maxx:x+2.2,minz:z-2.2,maxz:z+2.2};
        this.triggers.push(trigger);
        const g=new THREE.Group(); g.name='Level1_Exit';
        const back=this.addBox(g,this.shared.concreteLight,x,this.baseY+1.55,z,4.8,3.1,0.32);
        const door=this.addBox(g,this.shared.metal,x,this.baseY+1.45,z+0.19,2.2,2.9,0.12); door.material=this.shared.metal;
        const signMat=new THREE.MeshStandardMaterial({color:0xb8c0bb,emissive:0x24352d,emissiveIntensity:0.7});
        this.addBox(g,signMat,x,this.baseY+3.15,z+0.18,1.5,0.28,0.08);
        this.addBox(g,this.shared.light,x,this.baseY+3.55,z,2.0,0.08,0.38);
        g.position.y=0; this.group.add(g);
      },
      build(seed,origin){
        this.resetVisuals(); this.materialSet(); this.active=true; this.seed=seed>>>0;
        this.center.set(origin.x,this.baseY,origin.z); this.start.set(origin.x,this.baseY,origin.z);
        this.group=new THREE.Group(); this.group.name='Level1_InfiniteWorld'; scene.add(this.group);
        const hemi=new THREE.HemisphereLight(0xe4ebe9,0x202323,0.78);
        const amb=new THREE.AmbientLight(0x9fa6a2,0.28); scene.add(hemi,amb); this.ambientLights.push(hemi,amb);
        scene.fog=null; if(scene.background) scene.background.setHex(0x202321);
        if(CameraRig.camera){ CameraRig.camera.far=320; CameraRig.camera.updateProjectionMatrix(); }
        this.lastMCX=999999; this.lastMCZ=999999; this.stream(true); this.placeExit();
      },
      enter(seed,elevatorState){
        if(Level.group&&scene)scene.remove(Level.group); LightingSystem.clear(scene);
        if(Stairwell&&Stairwell.exits)Stairwell.reset();
        const origin=elevatorState?{x:elevatorState.origin.x,z:elevatorState.origin.z}:{x:0,z:0};
        PickupSystem.reset();
        this.build(seed,origin);
        Level.cols=Infinity; Level.rows=Infinity; Level.tiles=[]; Level.colliders=this.colliders; Level.triggers=this.triggers; Level.group=this.group;
        Level.worldMin.set(-Infinity,-2,-Infinity); Level.worldMax.set(Infinity,8,Infinity);
        Level.startPos.set(origin.x,0,origin.z); GameState.level=1;
        const obj=document.getElementById('hud-obj');if(obj)obj.textContent='Objective: explore Level 1';
        const lvl=document.getElementById('hud-level-label');if(lvl)lvl.textContent='LEVEL 1';
        const seedEl=document.getElementById('hud-seed-val');if(seedEl)seedEl.textContent=String(this.seed);
        const title=document.getElementById('start-seed');if(title)title.textContent='LEVEL 1 · SEED '+this.seed;
        Checkpoints.reset(); Checkpoints.register('level1-start',new THREE.Vector3(origin.x,0,origin.z),0); Checkpoints.activate('level1-start');
        Player.position.set(origin.x,0,origin.z); Player.velocity.set(0,0,0); Player.onGround=true;
        EntitySystem.despawn(); EncounterManager.reset(); DebugPath.hide(); DarknessSystem.reset(); AtmosphereSystem.reset(); EnvEventSystem.reset(); Flashlight.reset();
      },
      update(dt){
        if(!this.active) return;
        this.streamTimer+=dt; if(this.streamTimer>0.18){this.streamTimer=0;this.stream(false);}
        this.updateBlackout(dt); this.updatePuddleVisibility();
        Level.worldMin.set(-Infinity,-2,-Infinity); Level.worldMax.set(Infinity,8,Infinity);
      }
    };

    /* ------------------------------------------------------------------
       CHECKPOINTS
       ------------------------------------------------------------------ */
    const Checkpoints = {
      list: [],
      current: null,
      reset() {
        this.list.length = 0;
        this.current = null;
      },
      register(id, position, yaw) {
        const rec = { id, position: position.clone(), yaw: yaw || 0 };
        this.list.push(rec);
        if (!this.current) this.current = rec;
      },
      activate(id) {
        const rec = this.list.find((c) => c.id === id);
        if (rec) this.current = rec;
      },
      respawn() {
        const rec = this.current;
        if (!rec) return;
        Player.position.copy(rec.position);
        Player.position.y = 0;
        Player.velocity.set(0, 0, 0);
        Player.yaw = rec.yaw;
        Player.pitch = 0;
        Player.onGround = true;
        Player.sliding = false;
        Player.slideTimer = 0;
        Player.heightCurrent = CONFIG.player.heightStand;
      }
    };

    /* ------------------------------------------------------------------
       COLLISION / PHYSICS
       Capsule approximated as a vertical AABB (radius x height).
       Move and collide one axis at a time so corners do not swallow the player.
       ------------------------------------------------------------------ */
    const _overlap = { x: 0, y: 0, z: 0 };

    function aabbOverlap(amin, amax, bmin, bmax) {
      return amin.x < bmax.x && amax.x > bmin.x &&
             amin.y < bmax.y && amax.y > bmin.y &&
             amin.z < bmax.z && amax.z > bmin.z;
    }

    function resolveAxis(pos, radius, height, axis) {
      const min = new THREE.Vector3(pos.x - radius, pos.y, pos.z - radius);
      const max = new THREE.Vector3(pos.x + radius, pos.y + height, pos.z + radius);
      let pushed = 0;
      const boxes = Level.colliders;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (!aabbOverlap(min, max, b.min, b.max)) continue;
        if (axis === "x") {
          const penL = max.x - b.min.x;
          const penR = b.max.x - min.x;
          if (penL < penR) { pos.x -= penL; max.x -= penL; min.x -= penL; pushed -= penL; }
          else { pos.x += penR; max.x += penR; min.x += penR; pushed += penR; }
        } else if (axis === "z") {
          const penL = max.z - b.min.z;
          const penR = b.max.z - min.z;
          if (penL < penR) { pos.z -= penL; max.z -= penL; min.z -= penL; pushed -= penL; }
          else { pos.z += penR; max.z += penR; min.z += penR; pushed += penR; }
        } else {
          const penD = max.y - b.min.y;
          const penU = b.max.y - min.y;
          if (penD < penU) { pos.y -= penD; max.y -= penD; min.y -= penD; pushed -= penD; }
          else { pos.y += penU; max.y += penU; min.y += penU; pushed += penU; }
        }
      }
      return pushed;
    }

    const Physics = {
      moveAndCollide(pos, vel, radius, height, dt) {
        const groundedBefore = Player.onGround;
        pos.x += vel.x * dt;
        resolveAxis(pos, radius, height, "x");
        pos.z += vel.z * dt;
        resolveAxis(pos, radius, height, "z");
        pos.y += vel.y * dt;
        const yPush = resolveAxis(pos, radius, height, "y");

        let onGround = false;
        if (yPush > 0 && vel.y <= 0.05) {
          onGround = true;
          vel.y = 0;
        } else if (yPush < 0 && vel.y > 0) {
          vel.y = 0;
        }

        // Safety: fell out of the world
        if (pos.y < -12) {
          Checkpoints.respawn();
          return Player.onGround;
        }
        Player.onGround = onGround;
        if (onGround && !groundedBefore && vel.y <= 0.01) {
          AudioSystem.land();
          Player.lastNoise = 0.16;
          Player.lastNoiseRadius = CONFIG.entity.hearLand;
          Player.lastNoisePos.copy(Player.position);
          Player.landKick = Math.min(0.14, 0.035 + Math.abs(Player.wasFallSpeed || 0) * 0.012);
        }
        if (!onGround) Player.wasFallSpeed = vel.y;
        return onGround;
      }
    };

    /* ------------------------------------------------------------------
       PLAYER
       ------------------------------------------------------------------ */
    const Player = {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      onGround: false,
      crouching: false,
      sliding: false,
      slideTimer: 0,
      slideYaw: 0,
      heightCurrent: CONFIG.player.heightStand,
      stamina: CONFIG.stamina.max,
      stamAcc: 0,
      stamDelay: 0,
      stamRegenOn: false,
      moveState: "idle",
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      sanity: 100,
      sanityAcc: 0,
      hpRegenAcc: 0,
      sprintJumping: false,
      lastNoise: 0,
      lastNoisePos: new THREE.Vector3(),
      lastNoiseRadius: 0,
      wishSprint: false,
      landKick: 0,
      wasFallSpeed: 0,
      bobTime: 0,
      strafeAmt: 0,

      eyeHeight() {
        return this.heightCurrent - CONFIG.player.eyeOffset;
      },

      resetToStart() {
        if (!Checkpoints.list.find((c) => c.id === "start")) {
          Checkpoints.register("start", Level.startPos.clone(), 0);
        }
        Checkpoints.activate("start");
        this.stamina = CONFIG.stamina.max;
        this.stamAcc = 0;
        this.stamDelay = 0;
        this.stamRegenOn = false;
        this.hp = this.maxHp;
        this.sanity = CONFIG.sanity.max;
        this.sanityAcc = 0;
        this.hpRegenAcc = 0;
        this.sprintJumping = false;
        Checkpoints.respawn();
      },

      damagePlayer(amount) {
        this.hp = Math.max(0, Math.min(this.maxHp, this.hp - Math.max(0, amount | 0)));
        return this.hp;
      },
      healPlayer(amount) {
        this.hp = Math.max(0, Math.min(this.maxHp, this.hp + Math.max(0, amount | 0)));
        return this.hp;
      },
      getPlayerHP() { return this.hp | 0; },
      getSanity() { return this.sanity | 0; },
      addSanity(n) {
        this.sanity = Math.max(0, Math.min(CONFIG.sanity.max, (this.sanity | 0) + (n | 0)));
        return this.sanity;
      },
      tickSanity(dt) {
        const C = CONFIG.sanity;
        const chasing = EntitySystem && EntitySystem.spawned && EntitySystem.state === "PURSUING";
        const rate = C.drain + (chasing ? C.chaseDrain : 0);
        this.sanityAcc += rate * dt;
        while (this.sanityAcc >= 1 && this.sanity > 0) {
          this.sanityAcc -= 1;
          this.sanity -= 1;
        }
        if (this.sanity <= 0) { this.sanity = 0; this.sanityAcc = 0; }
        if (this.sanity >= C.hpRegenNeed && this.stamina >= C.hpRegenNeed && this.hp < this.maxHp) {
          this.hpRegenAcc += C.hpRegenRate * dt;
          while (this.hpRegenAcc >= 1 && this.hp < this.maxHp) {
            this.hpRegenAcc -= 1;
            this.hp += 1;
          }
        } else {
          this.hpRegenAcc = 0;
        }
      },

      applyStamina(dt, moving, drainRate) {
        const S = CONFIG.stamina;
        if (moving && drainRate > 0) {
          this.stamDelay = S.delay;
          this.stamRegenOn = false;
          this.stamAcc += drainRate * dt;
          while (this.stamAcc >= 1 && this.stamina > 0) {
            this.stamAcc -= 1;
            this.stamina -= 1;
          }
          if (this.stamina <= 0) {
            this.stamina = 0;
            this.stamAcc = 0;
          }
        } else if (!moving) {
          this.stamDelay -= dt;
          if (this.stamDelay <= 0) {
            this.stamRegenOn = true;
            this.stamAcc += S.regen * dt;
            while (this.stamAcc >= 1 && this.stamina < S.max) {
              this.stamAcc -= 1;
              this.stamina += 1;
            }
            if (this.stamina >= S.max) {
              this.stamina = S.max;
              this.stamAcc = 0;
            }
          } else {
            this.stamRegenOn = false;
          }
        } else {
          this.stamDelay = S.delay;
          this.stamRegenOn = false;
        }
      },

      update(dt) {
        const P = CONFIG.player;
        const wantCrouch = !!(Input.keys.ControlLeft || Input.keys.ControlRight || Input.keys.KeyC);
        const wantSprint = !!(Input.keys.ShiftLeft || Input.keys.ShiftRight);
        const wantJump = !!Input.keys.Space;

        // Look
        this.yaw -= Input.mouseDX * CONFIG.lookSens;
        this.pitch -= Input.mouseDY * CONFIG.lookSens;
        const lim = Math.PI * 0.48;
        if (this.pitch > lim) this.pitch = lim;
        if (this.pitch < -lim) this.pitch = -lim;
        Input.resetMouse();

        // Slide
        if (wantCrouch && wantSprint && this.onGround && !this.sliding && this.stamina > 12 &&
            (Input.keys.KeyW || this.velocity.length() > 4)) {
          this.sliding = true;
          this.slideTimer = P.slideDuration;
          this.slideYaw = this.yaw;
          AudioSystem.sprintFootstep();
        }
        if (this.sliding) {
          this.slideTimer -= dt;
          if (this.slideTimer <= 0 || !this.onGround) this.sliding = false;
        }

        this.crouching = wantCrouch || this.sliding;
        const targetH = this.crouching ? P.heightCrouch : P.heightStand;
        this.heightCurrent += (targetH - this.heightCurrent) * Math.min(1, dt * 12);

        this.wishSprint = wantSprint && !this.crouching && this.stamina > 0 && (this.onGround || this.sprintJumping);

        // Camera-relative wish on XZ. Three.js yaw: local forward is (-sin(y), -cos(y)).
        let fwd = 0, str = 0;
        if (Input.keys.KeyW) fwd += 1;
        if (Input.keys.KeyS) fwd -= 1;
        if (Input.keys.KeyD) str += 1;
        if (Input.keys.KeyA) str -= 1;
        const len = Math.hypot(fwd, str);
        if (len > 0) { fwd /= len; str /= len; }

        const sinY = Math.sin(this.yaw);
        const cosY = Math.cos(this.yaw);
        const fwdX = -sinY;
        const fwdZ = -cosY;
        const rightX = cosY;
        const rightZ = -sinY;
        const wishX = fwdX * fwd + rightX * str;
        const wishZ = fwdZ * fwd + rightZ * str;
        this.strafeAmt = str;

        let speed = P.walkSpeed;
        if (this.sliding) speed = P.slideSpeed * (0.55 + 0.45 * (this.slideTimer / P.slideDuration));
        else if (this.crouching) speed = P.crouchSpeed;
        else if (this.sprintJumping && this.wishSprint) speed = P.sprintSpeed * P.sprintJumpMult;
        else if (this.wishSprint) speed = P.sprintSpeed;

        const accel = this.onGround ? P.accel : P.airAccel;
        const fric = this.onGround ? P.friction : P.airFriction;

        // Horizontal velocity toward wish
        const hvx = this.velocity.x;
        const hvz = this.velocity.z;
        const hsp = Math.hypot(hvx, hvz);

        if (this.onGround) {
          if (hsp > 0.05) {
            const drop = Math.min(hsp, fric * dt * hsp);
            this.velocity.x *= (hsp - drop) / hsp;
            this.velocity.z *= (hsp - drop) / hsp;
          } else {
            this.velocity.x = 0;
            this.velocity.z = 0;
          }
        } else {
          this.velocity.x *= Math.max(0, 1 - P.airFriction * dt);
          this.velocity.z *= Math.max(0, 1 - P.airFriction * dt);
        }

        if (len > 0 || this.sliding) {
          let wx = wishX, wz = wishZ;
          if (this.sliding) {
            wx = -Math.sin(this.slideYaw);
            wz = -Math.cos(this.slideYaw);
            // slight steer
            wx += wishX * 0.35;
            wz += wishZ * 0.35;
            const sl = Math.hypot(wx, wz) || 1;
            wx /= sl; wz /= sl;
          }
          this.velocity.x += wx * accel * dt * speed;
          this.velocity.z += wz * accel * dt * speed;
          const ns = Math.hypot(this.velocity.x, this.velocity.z);
          const cap = speed * (this.onGround ? 1 : 1.05);
          if (ns > cap) {
            this.velocity.x *= cap / ns;
            this.velocity.z *= cap / ns;
          }
        }

        // Jump / gravity
        if (wantJump && this.onGround && !this.sliding) {
          this.velocity.y = P.jumpVel;
          this.onGround = false;
          this.sprintJumping = !!(this.wishSprint && this.stamina > 0);
          if (this.sprintJumping) {
            const boost = P.sprintJumpMult;
            this.velocity.x *= boost;
            this.velocity.z *= boost;
          }
          AudioSystem.jump();
          this.lastNoise = 0.12;
          this.lastNoiseRadius = CONFIG.entity.hearJump;
          this.lastNoisePos.copy(this.position);
        }
        this.velocity.y -= P.gravity * dt;
        if (this.velocity.y < -P.maxFall) this.velocity.y = -P.maxFall;

        const before = this.position.clone();
        Physics.moveAndCollide(this.position, this.velocity, P.radius, this.heightCurrent, dt);

        const dx = this.position.x - before.x;
        const dz = this.position.z - before.z;
        GameState.distance += Math.hypot(dx, dz);

        const spd = Math.hypot(this.velocity.x, this.velocity.z);
        const moving = spd > CONFIG.stamina.moveThreshold;
        if (this.onGround) this.sprintJumping = false;

        if (this.sprintJumping) this.moveState = "sprint_jump";
        else if (this.sliding) this.moveState = "sprint";
        else if (this.wishSprint && moving) this.moveState = "sprint";
        else if (this.crouching && moving) this.moveState = "crouch";
        else if (moving) this.moveState = "walk";
        else this.moveState = "idle";

        const S = CONFIG.stamina;
        let drain = 0;
        if (this.moveState === "sprint_jump") drain = S.sprintJumpDrain;
        else if (this.moveState === "sprint") drain = S.sprintDrain;
        else if (this.moveState === "walk") drain = S.walkDrain;
        else if (this.moveState === "crouch") drain = S.crouchDrain;
        this.applyStamina(dt, moving, drain);
        if (this.stamina <= 0) {
          this.wishSprint = false;
          this.sliding = false;
          this.sprintJumping = false;
        }

        if (this.moveState === "sprint" || this.moveState === "sprint_jump") {
          this.lastNoiseRadius = CONFIG.entity.hearSprint;
          this.lastNoise = 0.12;
          this.lastNoisePos.copy(this.position);
        } else if (this.moveState === "walk") {
          this.lastNoiseRadius = CONFIG.entity.hearWalk;
          this.lastNoise = 0.08;
          this.lastNoisePos.copy(this.position);
        } else if (this.moveState === "crouch") {
          this.lastNoiseRadius = CONFIG.entity.hearCrouch;
          this.lastNoise = 0.05;
          this.lastNoisePos.copy(this.position);
        } else {
          this.lastNoise = Math.max(0, this.lastNoise - dt);
        }

        // Footsteps
        if (this.onGround && spd > 1.15) {
          const cadence = this.crouching ? 0.55 : this.wishSprint ? 1.25 : 0.85;
          AudioSystem.lastStep += dt * (spd * cadence);
          if (AudioSystem.lastStep > 1) {
            AudioSystem.lastStep = 0;
            const mat = Stairwell.playerInside() ? "concrete" : "carpet";
            if (this.crouching) AudioSystem.footstepOn(mat, "crouch");
            else if (this.wishSprint) AudioSystem.footstepOn(mat, "sprint");
            else AudioSystem.footstepOn(mat, "walk");
          }
        }

        // Triggers
        Level.queryTriggers(this.position.x, this.position.z, (t) => {
          if (t.type === "checkpoint") Checkpoints.activate(t.id);
          if (t.type === "exit") {
            if (!GameState.exitReached) {
              GameState.exitReached = true;
              Stairwell.reached = true;
              HUD.toast("ELEVATOR_ENTERED");
              Stairwell.startSequence(t.exitIndex || 0);
            }
          } else if (t.type === "level1exit") {
            if (!GameState.exitReached && GameState.level === 1) {
              GameState.exitReached = true;
              HUD.toast("EXIT_REACHED");
              Game.complete();
            }
          }
        });
        this.tickSanity(dt);
      }
    };

    /* ------------------------------------------------------------------
       CAMERA
       ------------------------------------------------------------------ */
    const CameraRig = {
      camera: null,
      roll: 0,
      fov: 72,
      chaseAmp: 0,
      init() {
        this.fov = CONFIG.cameraFov;
        this.camera = new THREE.PerspectiveCamera(
          this.fov,
          window.innerWidth / window.innerHeight,
          0.08,
          CONFIG.cameraFar
        );
      },
      update(dt) {
        if (GameState.cinematicCamera) {
          this.updateCinematic(dt);
          return;
        }
        const spd = Math.hypot(Player.velocity.x, Player.velocity.z);
        const moving = Player.onGround && spd > 0.6;
        if (moving) {
          const rate = Player.wishSprint ? 11.5 : 8.2;
          Player.bobTime += dt * rate * Math.min(1.25, spd / 4.2);
        } else {
          Player.bobTime += dt * 1.2;
        }
        const walkAmp = Player.crouching ? 0.008 : 0.018;
        const amp = Player.wishSprint ? 0.028 : walkAmp;
        const bobY = moving ? Math.sin(Player.bobTime * 2) * amp : 0;
        const bobX = moving ? Math.cos(Player.bobTime) * amp * 0.35 : 0;

        Player.landKick *= Math.max(0, 1 - dt * 8.5);
        const land = -Player.landKick;

        const wantRoll = THREE.MathUtils.clamp(-Player.strafeAmt * 0.028, -0.035, 0.035);
        this.roll += (wantRoll - this.roll) * Math.min(1, dt * 8);

        const chaseAmp = this.chaseAmp || 0;
        const wantFov = (Player.wishSprint ? CONFIG.sprintFov : CONFIG.cameraFov) + chaseAmp * 4;
        this.fov += (wantFov - this.fov) * Math.min(1, dt * 6);
        if (Math.abs(this.camera.fov - this.fov) > 0.05) {
          this.camera.fov = this.fov;
          this.camera.updateProjectionMatrix();
        }

        const sinY = Math.sin(Player.yaw);
        const cosY = Math.cos(Player.yaw);
        const rightX = cosY;
        const rightZ = -sinY;

        const elevatorShake = GameState.elevatorShake || 0;
        const shake = chaseAmp * 0.018 + elevatorShake * 0.025;
        this.camera.position.set(
          Player.position.x + rightX * bobX + (Math.random() - 0.5) * shake,
          Player.position.y + Player.eyeHeight() + bobY + land + Math.sin(performance.now()*0.055) * elevatorShake * 0.012 + (Math.random() - 0.5) * shake * 0.6,
          Player.position.z + rightZ * bobX + (Math.random() - 0.5) * shake
        );
        this.camera.rotation.order = "YXZ";
        this.camera.rotation.y = Player.yaw;
        this.camera.rotation.x = Player.pitch;
        this.camera.rotation.z = this.roll;
      },
      updateCinematic(dt) {
        const st = Stairwell.exits && Stairwell.exits[Stairwell.sequenceExitIndex|0];
        if (!st || !this.camera) return;
        const t = Stairwell.sequenceT || 0;
        const g = Stairwell.cabGroups[Stairwell.sequenceExitIndex|0];
        const y = g ? g.position.y : 0;
        const fx = st.fx, fz = st.fz, rx = st.rx, rz = st.rz;
        // Camera sits inside the cabin looking diagonally toward the player.
        const side = 1.28, back = -1.15;
        const cx = st.origin.x + rx*side + fx*back;
        const cz = st.origin.z + rz*side + fz*back;
        const cy = y + 1.65;
        this.camera.position.set(cx, cy, cz);
        this._cinTarget = this._cinTarget || new THREE.Vector3();
        this._cinTarget.set(st.origin.x + rx*0.15, y + 1.0, st.origin.z + rz*0.15);
        this.camera.lookAt(this._cinTarget);
        this.camera.rotation.z = Math.sin(t*1.7)*0.004;
      },
      apply() {
        this.update(0);
      },
      resize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
      }
    };

    const Flashlight = {
      light: null,
      enabled: false,
      init() {
        if (this.light || !CameraRig.camera) return;
        const f = CONFIG.flashlight;
        this.light = new THREE.SpotLight(0xfff2d0, 0, f.distance, f.angle, f.penumbra, f.decay);
        this.light.position.set(0.12, -0.08, 0.15);
        const target = new THREE.Object3D();
        target.position.set(0, -0.04, -1);
        CameraRig.camera.add(this.light);
        CameraRig.camera.add(target);
        this.light.target = target;
        this.enabled = false;
      },
      toggle() {
        this.init();
        this.enabled = !this.enabled;
        if (this.light) this.light.intensity = this.enabled ? CONFIG.flashlight.intensity : 0;
        AudioSystem._tone && AudioSystem._tone(this.enabled ? 240 : 160, "square", 0.04, 0.018, "events");
      },
      reset() {
        this.enabled = false;
        if (this.light) this.light.intensity = 0;
      }
    };

    /* ------------------------------------------------------------------
       INVENTORY / PICKUPS / HUD
       ------------------------------------------------------------------ */
    const Inventory = {
      items: Object.create(null),
      defs: {
        almondWater: { name: "Almond Water", max: null, consumeSanity: 10 }
      },
      addItem(id, amount) {
        const n = amount == null ? 1 : amount;
        const cap = id === "almondWater" ? CONFIG.items.maxCarry : 99;
        const have = this.getItemCount(id);
        if (have >= cap) return 0;
        const add = Math.min(n, cap - have);
        this.items[id] = have + add;
        this.refresh();
        return add;
      },
      removeItem(id, amount) {
        const n = amount == null ? 1 : amount;
        const have = this.getItemCount(id);
        const take = Math.min(n, have);
        this.items[id] = have - take;
        this.refresh();
        return take;
      },
      hasItem(id) { return this.getItemCount(id) > 0; },
      getItemCount(id) { return this.items[id] | 0; },
      reset() {
        this.items = Object.create(null);
        this.refresh();
      },
      use(id) {
        if (id !== "almondWater") return false;
        if (!this.hasItem("almondWater")) {
          HUD.toast("No Almond Water");
          AudioSystem._tone && AudioSystem._tone(90, "sine", 0.05, 0.02, "events");
          return false;
        }
        this.removeItem("almondWater", 1);
        Player.addSanity(CONFIG.sanity.restoreDrink);
        HUD.toast("+" + CONFIG.sanity.restoreDrink + " sanity");
        AudioSystem._tone && AudioSystem._tone(220, "sine", 0.12, 0.03, "events");
        AudioSystem._noise && AudioSystem._noise(0.1, 0.02, "events", null, 200, 900);
        return true;
      },
      toggle() {
        GameState.inventoryOpen = !GameState.inventoryOpen;
        const el = document.getElementById("inv-overlay");
        if (el) el.style.display = GameState.inventoryOpen ? "flex" : "none";
        if (GameState.inventoryOpen) {
          setPauseOverlay(false);
          this.refresh();
          if (document.pointerLockElement) document.exitPointerLock();
        } else if (renderer && renderer.domElement && GameState.phase === "playing") {
          renderer.domElement.requestPointerLock();
        }
      },
      close() {
        if (!GameState.inventoryOpen) return;
        GameState.inventoryOpen = false;
        const el = document.getElementById("inv-overlay");
        if (el) el.style.display = "none";
      },
      refresh() {
        const list = document.getElementById("inv-list");
        if (!list) return;
        const n = this.getItemCount("almondWater");
        list.innerHTML = "";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Almond Water   ×" + n + " / " + CONFIG.items.maxCarry;
        btn.addEventListener("click", () => this.use("almondWater"));
        list.appendChild(btn);
        const energyNote = document.createElement("div");
        energyNote.style.opacity = "0.65";
        energyNote.textContent = "Energy Bars: E pickup restores +25 stamina";
        list.appendChild(energyNote);
        if (n === 0) {
          const empty = document.createElement("div");
          empty.style.opacity = "0.55";
          empty.textContent = "Empty";
          list.appendChild(empty);
        }
      }
    };

    const PickupSystem = {
      list: [],
      regions: Object.create(null),
      used: Object.create(null),
      level1Regions: Object.create(null),
      group: null,
      reset() {
        if (this.group && scene) scene.remove(this.group);
        this.list = [];
        this.regions = Object.create(null);
        this.used = Object.create(null);
        this.level1Regions = Object.create(null);
        this.group = null;
      },
      regionKey(x, z) {
        const s = CONFIG.items.regionSize;
        return Math.floor(x / s) + ':' + Math.floor(z / s);
      },
      regionCount(x, z, kind) {
        const k = this.regionKey(x, z);
        const r = this.regions[k];
        if (!r) return 0;
        return kind === 'energy' ? (r.energy | 0) : (r.almond | 0);
      },
      _regionRec(k) {
        return this.regions[k] || (this.regions[k] = {almond:0, energy:0});
      },
      _isOpenLevel0(tx, tz) {
        if (!Level.inBounds(tx, tz)) return false;
        const t = Level.getTile(tx, tz);
        return t !== TILE.WALL && t !== TILE.COLUMN && t !== TILE.START && t !== TILE.EXIT && t !== TILE.CHECK;
      },
      _addMesh(kind, x, z) {
        const mat = kind === 'energy'
          ? new THREE.MeshStandardMaterial({color:0xc7c7c7,roughness:0.48,metalness:0.18,emissive:0x2a312f,emissiveIntensity:0.18})
          : new THREE.MeshStandardMaterial({color:0xe8d8b0,roughness:0.35,metalness:0.08,emissive:0x332818,emissiveIntensity:0.15});
        const mesh = new THREE.Mesh(Geometries.box, mat);
        if (kind === 'energy') { mesh.scale.set(0.42,0.18,0.14); mesh.position.set(x,0.18,z); }
        else { mesh.scale.set(0.12,0.28,0.12); mesh.position.set(x,0.22,z); }
        this.group.add(mesh);
        const id = kind + ':' + x.toFixed(3) + ',' + z.toFixed(3);
        this.list.push({id:id,kind:kind,x:x,z:z,mesh:mesh,taken:false});
      },
      generate(seed) {
        this.reset();
        this.group = new THREE.Group();
        const rng = mulberry32((seed ^ 0xA11D5) >>> 0);
        const T = CONFIG.tile, R = CONFIG.items.regionSize;
        const minX = 0, minZ = 0, maxX = Level.cols * T, maxZ = Level.rows * T;
        for (let rz = 0; rz * R < maxZ; rz++) {
          for (let rx = 0; rx * R < maxX; rx++) {
            const k = rx + ':' + rz, rec = this._regionRec(k);
            const baseX = rx * R, baseZ = rz * R;
            for (let a = 0; a < CONFIG.items.almondAttempts && rec.almond < CONFIG.items.almondMaxPerRegion; a++) {
              if (rng() >= CONFIG.items.almondChance) continue;
              let placed = false;
              for (let tries = 0; tries < 8 && !placed; tries++) {
                const x = baseX + 3 + rng() * Math.max(1,R-6), z = baseZ + 3 + rng() * Math.max(1,R-6);
                const tx = Math.floor(x / T), tz = Math.floor(z / T);
                if (!this._isOpenLevel0(tx,tz)) continue;
                const w = Level.tileToWorld(tx,tz);
                const uid = 'almond:' + tx + ',' + tz;
                if (this.used[uid]) continue;
                this.used[uid] = true; rec.almond++; this._addMesh('almond',w.x,w.z); placed=true;
              }
            }
            for (let a = 0; a < CONFIG.items.energyAttempts && rec.energy < CONFIG.items.energyMaxPerRegion; a++) {
              if (rng() >= CONFIG.items.energyChance) continue;
              let placed = false;
              for (let tries = 0; tries < 8 && !placed; tries++) {
                const x = baseX + 3 + rng() * Math.max(1,R-6), z = baseZ + 3 + rng() * Math.max(1,R-6);
                const tx = Math.floor(x / T), tz = Math.floor(z / T);
                if (!this._isOpenLevel0(tx,tz)) continue;
                const w = Level.tileToWorld(tx,tz);
                const uid = 'energy:' + tx + ',' + tz;
                if (this.used[uid]) continue;
                this.used[uid] = true; rec.energy++; this._addMesh('energy',w.x,w.z); placed=true;
              }
            }
          }
        }
        if (scene) scene.add(this.group);
      },
      isOpenLevel1(x,z) {
        if (!Level1 || !Level1.active) return false;
        const type = Level1.macroType(Math.floor(x/Level1.macroSize),Math.floor(z/Level1.macroSize));
        // Keep resources off structural pillars.
        const localX = ((x % 16) + 16) % 16, localZ = ((z % 16) + 16) % 16;
        if (localX > 7.2 && localX < 8.8 && localZ > 7.2 && localZ < 8.8) return false;
        if (type === 'maintenance') {
          const walls = Level1.getMaintenanceWalls(Math.floor(x/Level1.macroSize),Math.floor(z/Level1.macroSize));
          for (const w of walls) if (x >= w.x-w.sx/2-0.8 && x <= w.x+w.sx/2+0.8 && z >= w.z-w.sz/2-0.8 && z <= w.z+w.sz/2+0.8) return false;
        }
        return true;
      },
      generateLevel1Region(rx,rz,seed) {
        const key = rx + ':' + rz;
        if (this.level1Regions[key] || !this.group) return;
        this.level1Regions[key] = true;
        const R = CONFIG.items.regionSize, baseX = rx*R, baseZ = rz*R;
        const rng = mulberry32((seed ^ Math.imul(rx,0x45d9f3b) ^ Math.imul(rz,0x27d4eb2d) ^ 0xE11E5) >>> 0);
        const rec = this._regionRec('L1:'+key);
        const tryPlace = (kind, attempts, chance, cap) => {
          for(let a=0;a<attempts && rec[kind] < cap;a++) {
            if(rng() >= chance) continue;
            let placed=false;
            for(let t=0;t<10 && !placed;t++) {
              const x=baseX+4+rng()*(R-8), z=baseZ+4+rng()*(R-8);
              if(!this.isOpenLevel1(x,z)) continue;
              const uid='L1:'+kind+':'+Math.round(x*10)+','+Math.round(z*10);
              if(this.used[uid]) continue;
              this.used[uid]=true; rec[kind]++; this._addMesh(kind,x,z); placed=true;
            }
          }
        };
        tryPlace('almond',CONFIG.items.almondAttempts,CONFIG.items.almondChance,CONFIG.items.almondMaxPerRegion);
        tryPlace('energy',CONFIG.items.energyAttempts,CONFIG.items.energyChance,CONFIG.items.energyMaxPerRegion);
      },
      nearest() {
        let best=null,bestD=CONFIG.items.interactDist;
        for(const p of this.list){
          if(p.taken) continue;
          const d=Math.hypot(p.x-Player.position.x,p.z-Player.position.z);
          if(d<bestD){bestD=d;best=p;}
        }
        return best;
      },
      tryPickup() {
        const p=this.nearest(); if(!p) return false;
        if(p.kind==='energy'){
          if(Player.stamina >= CONFIG.stamina.max){ HUD.toast('Energy already full'); return false; }
          Player.stamina=Math.min(CONFIG.stamina.max,Player.stamina+25);
          Player.stamAcc=0; Player.stamDelay=0; Player.stamRegenOn=false;
          p.taken=true; if(p.mesh)p.mesh.visible=false;
          HUD.toast('+25 stamina');
          AudioSystem._tone&&AudioSystem._tone(420,'sine',0.10,0.025,'events');
          return true;
        }
        if(Inventory.getItemCount('almondWater') >= CONFIG.items.maxCarry){HUD.toast('Inventory Full');return false;}
        if(!Inventory.addItem('almondWater',1)){HUD.toast('Inventory Full');return false;}
        p.taken=true; if(p.mesh)p.mesh.visible=false;
        HUD.toast('Almond Water ×'+Inventory.getItemCount('almondWater'));
        AudioSystem._tone&&AudioSystem._tone(310,'sine',0.08,0.025,'events');
        return true;
      }
    };

    const HUD = {
      timeEl: null,
      stamEl: null,
      hpEl: null,
      sanEl: null,
      toastEl: null,
      toastT: 0,
      init() {
        this.timeEl = document.getElementById("hud-time");
        this.stamEl = document.getElementById("hud-stam");
        this.hpEl = document.getElementById("hud-hp");
        this.sanEl = document.getElementById("hud-san");
        this.toastEl = document.getElementById("toast-note");
        ChaseFx.init();
      },
      toast(msg) {
        if (!this.toastEl) this.toastEl = document.getElementById("toast-note");
        if (!this.toastEl) return;
        this.toastEl.textContent = msg;
        this.toastEl.style.opacity = "0.9";
        this.toastT = 1.6;
      },
      resourceColor(pct) {
        const C = CONFIG.hudColors;
        const stops = [
          [0, C.dark], [0.2, C.red], [0.4, C.orange], [0.6, C.yellow], [0.85, C.green], [1, C.green]
        ];
        const t = Math.max(0, Math.min(1, pct));
        let a = stops[0], b = stops[stops.length - 1];
        for (let i = 0; i < stops.length - 1; i++) {
          if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
        }
        const u = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
        const r = (a[1][0] + (b[1][0] - a[1][0]) * u) | 0;
        const g = (a[1][1] + (b[1][1] - a[1][1]) * u) | 0;
        const bl = (a[1][2] + (b[1][2] - a[1][2]) * u) | 0;
        return "rgb(" + r + "," + g + "," + bl + ")";
      },
      setBar(fillId, labelEl, cur, max) {
        const el = document.getElementById(fillId);
        if (!el) return;
        const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
        el.style.transform = "scaleX(" + pct + ")";
        el.style.background = this.resourceColor(pct);
        if (labelEl) labelEl.textContent = (cur | 0) + " / " + (max | 0);
      },
      formatTime(t) {
        const m = Math.floor(t / 60);
        const s = t - m * 60;
        return String(m).padStart(2, "0") + ":" + s.toFixed(1).padStart(4, "0");
      },
      update() {
        if (this.timeEl) this.timeEl.textContent = this.formatTime(GameState.elapsed);
        this.setBar("hp-fill", this.hpEl, Player.getPlayerHP(), Player.maxHp);
        this.setBar("stam-fill", this.stamEl, Player.stamina | 0, CONFIG.stamina.max);
        this.setBar("san-fill", this.sanEl, Player.getSanity(), CONFIG.sanity.max);
        if (this.toastT > 0) {
          this.toastT -= 0.016;
          if (this.toastT <= 0 && this.toastEl) this.toastEl.style.opacity = "0";
        }
        const near = PickupSystem.nearest && PickupSystem.nearest();
        if (near && !GameState.inventoryOpen && this.toastT <= 0) {
          if (this.toastEl) {
            this.toastEl.textContent = near.kind === "energy" ? "E  Energy Bar (+25 stamina)" : "E  Almond Water";
            this.toastEl.style.opacity = "0.7";
          }
        }
        const seedNode=document.getElementById("hud-seed");
        if(seedNode && GameState.level===1) seedNode.innerHTML="LEVEL 1 · SEED <span id=\"hud-seed-val\">"+(GameState.seed>>>0)+"</span>";
        if (GameState.debug) this.updateDebug();
      },
      updateDebug() {
        const panel = document.getElementById("debug-panel");
        if (!panel) return;
        const C = LevelGenerator.CELL;
        const T = CONFIG.tile;
        const tx = Math.floor(Player.position.x / T);
        const tz = Math.floor(Player.position.z / T);
        const gx = Math.floor(tx / C);
        const gz = Math.floor(tz / C);
        const mod = MapGraph.nodeAt(gx, gz);
        const exit = ExitManager.worldPos();
        const dist = exit ? Math.hypot(exit.x - Player.position.x, exit.z - Player.position.z) : -1;
        const cp = Checkpoints.current ? Checkpoints.current.id : "none";
        const entDist = EntitySystem.spawned
          ? Math.hypot(EntitySystem.position.x - Player.position.x, EntitySystem.position.z - Player.position.z)
          : -1;
        const exitFound = !!(Stairwell.origin);
        panel.textContent =
          "DEBUG MODE\n" +
          "FPS " + (GameState.fps | 0) + "\n" +
          "LEVEL 0\n" +
          "SEED " + GameState.seed + "\n" +
          "XYZ " + Player.position.x.toFixed(1) + " " + Player.position.y.toFixed(2) + " " + Player.position.z.toFixed(1) + "\n" +
          "TILE " + tx + "," + tz + "  CELL " + gx + "," + gz + "\n" +
          "MODULE " + (mod ? (mod.id + " " + mod.type) : "none") + "\n" +
          "LIGHT ZONE " + (mod ? (mod.lightProfile || "NORMAL") : "none") + "\n" +
          "DARK FOG " + (DarknessSystem.active ? "ON" : "OFF") + "  FAR " + (scene && scene.fog ? scene.fog.far.toFixed(1) + "m" : "—") + "\n" +
          "MODULES " + MapGraph.nodes.length + "\n" +
          "CHECKPOINT " + cp + "\n" +
          "PATH TO EXIT " + (Level.pathMeters ? Level.pathMeters.toFixed(0) + " m" : "—") + "\n" +
          "EUCLID EXIT " + (dist >= 0 ? dist.toFixed(1) + " m" : "—") + "\n" +
          "ENTITY " + (EncounterManager.entitySpawned ? "SPAWNED" : "NOT SPAWNED") + "\n" +
          "ENCOUNTER " + (EncounterManager.encounterSystemActive ? "ACTIVE" : "IDLE") + "\n" +
          "SPAWN P " + (EncounterManager.lastProbability * 100).toFixed(1) + "%\n" +
          "UNTIL GUARANTEE " + Math.ceil(EncounterManager.timeUntilGuarantee()) + "s\n" +
          "TRAVELED " + GameState.distance.toFixed(0) + " m\n" +
          "ENTITY PATH " + (EncounterManager.entitySpawned ? EncounterManager.lastPathDist.toFixed(0) + " m" : "—") + "\n" +
          "ENTITY STATE " + (EntitySystem.spawned ? EntitySystem.state : "NONE") + "\n" +
          "E MODULE " + (EntitySystem.targetModule ? EntitySystem.targetModule.type : "—") + "\n" +
          "P VISIBLE " + (EntitySystem.playerVisible ? "YES" : "NO") + "  HEARD " + (EntitySystem.playerHeard ? "YES" : "NO") + "\n" +
          "HP " + Player.getPlayerHP() + " / " + Player.maxHp + "\n" +
          "STAMINA " + (Player.stamina | 0) + " / " + CONFIG.stamina.max + "\n" +
          "MOVE " + Player.moveState + "\n" +
          "REGEN " + (Player.stamRegenOn ? "YES" : "NO") +
          "  DELAY " + Math.max(0, Player.stamDelay).toFixed(1) + "s\n" +
          "SANITY " + Player.getSanity() + " / " + CONFIG.sanity.max + "\n" +
          "INVENTORY AW " + Inventory.getItemCount("almondWater") + " / " + CONFIG.items.maxCarry + "\n" +
          "REGION " + PickupSystem.regionKey(Player.position.x, Player.position.z) +
          "  AW " + PickupSystem.regionCount(Player.position.x, Player.position.z, "almond") + " / " + CONFIG.items.almondMaxPerRegion +
          "  ENERGY " + PickupSystem.regionCount(Player.position.x, Player.position.z, "energy") + " / " + CONFIG.items.energyMaxPerRegion + "\n" +
          "ENV " + (EnvEventSystem.active ? "ACTIVE" : "INACTIVE") +
          "  CD " + (EnvEventSystem.cooldown > 0 ? EnvEventSystem.cooldown.toFixed(0) + "s" : "READY") + "\n" +
          "ENV CHECK " + Math.max(0, EnvEventSystem.startIn > 0 ? EnvEventSystem.startIn : EnvEventSystem.checkIn).toFixed(1) + "s\n" +
          "LAST EVENT " + EnvEventSystem.lastId + "  COUNT " + EnvEventSystem.eventCount +
          (EnvEventSystem.current ? "\nACTIVE EVENT " + EnvEventSystem.current + "  " + EnvEventSystem.remain.toFixed(1) + "s" : "") +
          "\nFLASHLIGHT " + (Flashlight.enabled ? "ON" : "OFF") +
          "\nCROUCH " + (Player.crouching ? "YES" : "NO") + "  SPRINT " + (Player.wishSprint ? "YES" : "NO") +
          "\nYAW " + Player.yaw.toFixed(2) + "  PITCH " + Player.pitch.toFixed(2) +
          "\nENTITY DIST " + (entDist >= 0 ? entDist.toFixed(1) + " m" : "—") +
          "\nEXITS " + (LevelGenerator.last && LevelGenerator.last.exitStamps ? LevelGenerator.last.exitStamps.length : 0) +
          "  SPACING >= " + CONFIG.gen.exitSpacing + "m" +
          "\nEXIT " + (exitFound ? "FOUND" : "NONE") + "  TYPE CONCRETE ELEVATOR" +
          "\nNEAREST EXIT DIST " + (dist >= 0 ? dist.toFixed(1) + " m" : "—") +
          "\nTRANSITION " + (GameState.exitReached ? "REACHED" : "NOT REACHED") +
          "\nCHASE SANITY " + ((EntitySystem.spawned && EntitySystem.state === "PURSUING") ? "-0.2/sec" : "INACTIVE") +
          "\nENTITY CONTACT " + (EntitySystem.inContact ? "YES" : "NO") +
          "\nENTITY DAMAGE " + (EntitySystem.inContact ? ("-" + CONFIG.entity.damagePerSec + " HP/sec") : "—") +
          "\nEXIT PATH " + (DebugPath.visible ? "ON" : "OFF");
      }
    };

    /* ------------------------------------------------------------------
       ENTITY SYSTEM STUB — VERSION 4
       ------------------------------------------------------------------ */
    /* ------------------------------------------------------------------
       ATMOSPHERE / ENVIRONMENTAL EVENTS
       Rare, timer-based. Entities later can call WorldAPI.
       ------------------------------------------------------------------ */
    const DarknessSystem = {
      active: false,
      profile: "NORMAL",
      targetOpacity: 0,
      update(dt) {
        if (!scene || !scene.fog || !Player || GameState.phase !== "playing") return;
        const T = CONFIG.tile;
        const C = LevelGenerator.CELL;
        const tx = Math.floor(Player.position.x / T);
        const tz = Math.floor(Player.position.z / T);
        const gx = Math.floor(tx / C);
        const gz = Math.floor(tz / C);
        const mod = MapGraph.nodeAt(gx, gz);
        let profile = mod && mod.lightProfile ? mod.lightProfile : "NORMAL";
        // Preview nearby modules so lighting transitions are visible before
        // the player actually crosses into the next hallway/room.
        let previewProfile = profile, previewWeight = 0;
        for (let r = 1; r <= 22; r++) {
          const samples = [[tx+r,tz],[tx-r,tz],[tx,tz+r],[tx,tz-r]];
          for (const q of samples) {
            const nm = MapGraph.nodeAt(Math.floor(q[0]/C),Math.floor(q[1]/C));
            if (!nm || !nm.lightProfile || nm === mod) continue;
            const w = Math.max(0, 1 - (r*CONFIG.tile)/66);
            if (w > previewWeight) { previewWeight=w; previewProfile=nm.lightProfile; }
          }
        }
        if (Stairwell.playerInside()) profile = "ELEVATOR";
        this.profile = profile;
        let darkBlend = profile === "DARK" ? 1 : 0;
        let brightBlend = profile === "BRIGHT" ? 1 : 0;
        if (previewProfile === "DARK" && profile !== "DARK") darkBlend = Math.max(darkBlend, previewWeight);
        if (previewProfile === "BRIGHT" && profile !== "BRIGHT") brightBlend = Math.max(brightBlend, previewWeight);
        if (profile === "DARK" && previewProfile !== "DARK") darkBlend = Math.max(0, 1-previewWeight);
        if (profile === "BRIGHT" && previewProfile === "NORMAL") brightBlend = Math.max(0, 1-previewWeight);
        const dark = darkBlend > 0.5;
        this.active = dark;
        const flashlightOn = !!Flashlight.enabled;
        const normalFar = 140 + brightBlend*25;
        const targetNear = darkBlend > 0 ? (flashlightOn ? 3.0 : 1.6 + 36*(1-darkBlend)) : 38;
        const targetFar = darkBlend > 0 ? (flashlightOn ? 18 + 120*(1-darkBlend) : 6.2 + 134*(1-darkBlend)) : normalFar;
        const targetColorObj = new THREE.Color(CONFIG.fogColor).lerp(new THREE.Color(0x11151a), Math.min(1, darkBlend));
        scene.fog.near += (targetNear - scene.fog.near) * Math.min(1, dt * 5);
        scene.fog.far += (targetFar - scene.fog.far) * Math.min(1, dt * 5);
        scene.fog.color.lerp(targetColorObj, Math.min(1, dt * 4));
        scene.background.lerp(targetColorObj, Math.min(1, dt * 4));
        if (LightingSystem.ambient && LightingSystem.hemi) {
          const normalAmb = 0.30 + brightBlend * 0.04;
          const normalHemi = 0.36 + brightBlend * 0.04;
          const darkAmb = flashlightOn ? 0.10 : 0.045;
          const darkHemi = flashlightOn ? 0.14 : 0.075;
          const amb = normalAmb*(1-darkBlend) + darkAmb*darkBlend;
          const hemi = normalHemi*(1-darkBlend) + darkHemi*darkBlend;
          LightingSystem.ambient.intensity += (amb - LightingSystem.ambient.intensity) * Math.min(1, dt * 4);
          LightingSystem.hemi.intensity += (hemi - LightingSystem.hemi.intensity) * Math.min(1, dt * 4);
        }
        // Suppress spill from neighboring fixtures while the player is inside
        // a dark module. Nearby lights still exist, but their illumination falls
        // off quickly so a dark module actually feels dark.
        for (let i = 0; i < LightingSystem.units.length; i++) {
          const u = LightingSystem.units[i];
          if (!u.light || u.state === "BROKEN") continue;
          const d = Math.hypot(u.x - Player.position.x, u.z - Player.position.z);
          const home = u.homeState === "NORMAL" || u.homeState === "DIM" || u.homeState === "FLICKERING";
          if (dark && home) {
            let mult = d < 5 ? 0.35 : d < 8 ? 0.10 : 0.015;
            if (flashlightOn) mult *= 1.45;
            u.light.intensity = u.baseIntensity * mult;
          } else if (home && u.light) {
            const stateMult = u.state === "DIM" ? 0.42 : u.state === "BROKEN" ? 0 : 1;
            u.light.intensity = u.baseIntensity * stateMult;
          }
        }
        const fogEl = document.getElementById("dark-fog");
        if (fogEl) {
          const op = dark ? (flashlightOn ? 0.18 : 0.62) : 0;
          this.targetOpacity += (op - this.targetOpacity) * Math.min(1, dt * 5);
          fogEl.style.opacity = this.targetOpacity.toFixed(3);
        }
      },
      reset() {
        this.active = false;
        this.profile = "NORMAL";
        this.targetOpacity = 0;
        const el = document.getElementById("dark-fog");
        if (el) el.style.opacity = "0";
        if (scene && scene.fog) {
          scene.fog.near = CONFIG.fogNear;
          scene.fog.far = CONFIG.fogFar;
          scene.fog.color.setHex(CONFIG.fogColor);
        }
        if (scene && scene.background) scene.background.setHex(CONFIG.fogColor);
      }
    };

    const AtmosphereSystem = {
      update(dt) {
        if (GameState.phase !== "playing") return;
        const gx = Math.floor(Player.position.x / (CONFIG.tile * LevelGenerator.CELL));
        const gz = Math.floor(Player.position.z / (CONFIG.tile * LevelGenerator.CELL));
        const mod = MapGraph.nodeAt(gx, gz);
        let size = 0.35;
        if (mod) {
          if (mod.type === "room_large" || mod.type === "room_pillar") size = 1;
          else if (mod.type === "room_small" || mod.type === "start") size = 0.7;
          else if (mod.type === "hall_long") size = 0.55;
        }
        if (Stairwell.playerInside()) {
          size = 1.15;
          AudioSystem.setRoomAmbience(size);
          return;
        }
        AudioSystem.setRoomAmbience(size);
      },
      fireAmbientEvent() {},
      reset() {}
    };

    const EnvEventSystem = {
      active: false,
      startIn: 75,
      checkIn: 10,
      cooldown: 0,
      eventCount: 0,
      lastId: "none",
      current: null,
      remain: 0,
      restore: [],
      ghost: null,
      rng: null,
      events: null,

      reset() {
        this.endCurrent(true);
        const E = CONFIG.envEvents;
        this.rng = mulberry32(((GameState.seed || 1) ^ 0xE7E700) + ((performance.now() | 0) & 0xffff));
        this.startIn = E.startMin + this.rand() * (E.startMax - E.startMin);
        this.checkIn = E.checkInterval;
        this.cooldown = 0;
        this.active = false;
        this.eventCount = 0;
        this.lastId = "none";
        this.current = null;
        this.remain = 0;
      },
      rand() { return this.rng ? this.rng() : Math.random(); },

      onStart(id) { /* future sanity / AI hooks */ },
      onEnd(id) { /* future sanity / AI hooks */ },

      register() {
        if (this.events) return this.events;
        this.events = [
          { id: "light_flicker", weight: 26, execute: () => this.evFlicker() },
          { id: "distant_footsteps", weight: 16, execute: () => this.evFootsteps() },
          { id: "electrical_surge", weight: 14, execute: () => this.evSurge() },
          { id: "light_shuts_off", weight: 14, execute: () => this.evLightFail() },
          { id: "distant_thump", weight: 14, execute: () => this.evThump() },
          { id: "dark_corridor", weight: 8, execute: () => this.evDark() },
          { id: "light_behind_player", weight: 6, execute: () => this.evBehind() },
          { id: "visual_movement", weight: 3, execute: () => this.evVisual() },
          { id: "unknown_event", weight: 2, execute: () => this.evUnknown() }
        ];
        return this.events;
      },

      pickEvent() {
        const list = this.register();
        let sum = 0;
        for (let i = 0; i < list.length; i++) sum += list[i].weight;
        let r = this.rand() * sum;
        for (let i = 0; i < list.length; i++) {
          r -= list[i].weight;
          if (r <= 0) return list[i];
        }
        return list[0];
      },

      walkPoint(minD, maxD) {
        const T = CONFIG.tile;
        const px = Math.floor(Player.position.x / T);
        const pz = Math.floor(Player.position.z / T);
        for (let n = 0; n < 18; n++) {
          const ang = this.rand() * Math.PI * 2;
          const d = minD + this.rand() * (maxD - minD);
          const tx = Math.floor((Player.position.x + Math.cos(ang) * d) / T);
          const tz = Math.floor((Player.position.z + Math.sin(ang) * d) / T);
          if (Level.inBounds(tx, tz)) {
            const t = Level.getTile(tx, tz);
            if (t !== TILE.WALL && t !== TILE.COLUMN) {
              const w = Level.tileToWorld(tx, tz);
              return { x: w.x, z: w.z };
            }
          }
        }
        const ang = this.rand() * Math.PI * 2;
        const d = (minD + maxD) * 0.5;
        return { x: Player.position.x + Math.cos(ang) * d, z: Player.position.z + Math.sin(ang) * d };
      },

      begin(id, dur, restoreList) {
        this.current = id;
        this.lastId = id;
        this.remain = dur;
        this.restore = restoreList || [];
        this.eventCount++;
        const E = CONFIG.envEvents;
        this.cooldown = E.cooldownMin + this.rand() * (E.cooldownMax - E.cooldownMin);
        this.onStart(id);
      },

      endCurrent(silent) {
        for (let i = 0; i < this.restore.length; i++) {
          const r = this.restore[i];
          if (r.unit && r.snap) LightingSystem.applySnapshot(r.unit, r.snap);
        }
        this.restore = [];
        if (this.ghost && scene) {
          scene.remove(this.ghost);
          this.ghost = null;
        }
        const id = this.current;
        this.current = null;
        this.remain = 0;
        if (id && !silent) this.onEnd(id);
      },

      evFlicker() {
        const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 22, 4);
        if (!near.length) return false;
        const snaps = [];
        const n = 1 + Math.floor(this.rand() * Math.min(3, near.length));
        for (let i = 0; i < n; i++) {
          snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
          near[i].state = "FLICKERING";
          near[i].burstLeft = CONFIG.envEvents.flickerDur;
        }
        AudioSystem.playPositional("flicker", near[0].x, near[0].y, near[0].z, { gain: 0.035, bus: "electrical" });
        this.begin("light_flicker", CONFIG.envEvents.flickerDur, snaps);
        return true;
      },

      evLightFail() {
        const band = LightingSystem.unitsInBand(Player.position.x, Player.position.z, 10, 42);
        const pool = band.length ? band : LightingSystem.unitsNear(Player.position.x, Player.position.z, 40, 8);
        if (!pool.length) return false;
        const u = pool[Math.floor(this.rand() * pool.length)];
        const snaps = [{ unit: u, snap: LightingSystem.snapshot(u) }];
        LightingSystem.setFixtureState(u, "BROKEN");
        AudioSystem.playPositional("pop", u.x, u.y, u.z, { gain: 0.04, bus: "electrical" });
        this.begin("light_shuts_off", CONFIG.envEvents.failDur, snaps);
        return true;
      },

      evSurge() {
        const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 18, 5);
        const snaps = [];
        for (let i = 0; i < near.length; i++) {
          snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
          near[i].state = "FLICKERING";
          near[i].burstLeft = 0.35;
          if (near[i].light) near[i].light.intensity = near[i].baseIntensity * (0.7 + this.rand() * 0.55);
        }
        AudioSystem.playPositional("buzz", Player.position.x, 2.4, Player.position.z, { gain: 0.03, bus: "electrical" });
        this.begin("electrical_surge", CONFIG.envEvents.surgeDur, snaps);
        return true;
      },

      evFootsteps() {
        const p = this.walkPoint(16, 38);
        AudioSystem.playPositional("creak", p.x, 0.2, p.z, { gain: 0.04, bus: "events", max: 48 });
        setTimeout(() => {
          if (GameState.phase === "playing") AudioSystem.playPositional("creak", p.x + 1.2, 0.2, p.z + 0.4, { gain: 0.03, bus: "events", max: 48 });
        }, 280);
        this.begin("distant_footsteps", 0.9, []);
        return true;
      },

      evThump() {
        const p = this.walkPoint(20, 48);
        const kinds = ["thump", "metal", "pipe", "impact", "pop"];
        const k = kinds[Math.floor(this.rand() * kinds.length)];
        AudioSystem.playPositional(k, p.x, 1.2, p.z, { gain: 0.055, bus: "events", max: 60 });
        this.begin("distant_thump", 0.6, []);
        return true;
      },

      evDark() {
        const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 16, 7);
        if (!near.length) return false;
        const snaps = [];
        for (let i = 0; i < near.length; i++) {
          snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
          LightingSystem.setFixtureState(near[i], "DIM");
        }
        this.begin("dark_corridor", CONFIG.envEvents.darkDur, snaps);
        return true;
      },

      evBehind() {
        const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
        const cand = [];
        for (let i = 0; i < LightingSystem.units.length; i++) {
          const u = LightingSystem.units[i];
          const dx = u.x - Player.position.x, dz = u.z - Player.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 6 || d > 28) continue;
          if (dx * fx + dz * fz < -0.15) cand.push(u);
        }
        const pool = cand.length ? cand : LightingSystem.unitsNear(Player.position.x, Player.position.z, 24, 6);
        if (!pool.length) return false;
        const u = pool[Math.floor(this.rand() * pool.length)];
        const snaps = [{ unit: u, snap: LightingSystem.snapshot(u) }];
        if (u.light) u.light.intensity = u.baseIntensity * 1.55;
        u.panelMat.emissiveIntensity = 1.8;
        AudioSystem.playPositional("buzz", u.x, u.y, u.z, { gain: 0.02, bus: "electrical", max: 22 });
        this.begin("light_behind_player", CONFIG.envEvents.behindDur, snaps);
        return true;
      },

      evVisual() {
        const p = this.walkPoint(8, 18);
        const mat = new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 1, transparent: true, opacity: 0.55 });
        const mesh = new THREE.Mesh(Geometries.box, mat);
        mesh.scale.set(0.35, 1.5, 0.18);
        mesh.position.set(p.x, 0.75, p.z);
        if (scene) scene.add(mesh);
        this.ghost = mesh;
        this.begin("visual_movement", CONFIG.envEvents.visualDur, []);
        return true;
      },

      evUnknown() {
        const near = LightingSystem.unitsNear(Player.position.x, Player.position.z, 30, 6);
        const snaps = [];
        for (let i = 0; i < near.length; i++) {
          snaps.push({ unit: near[i], snap: LightingSystem.snapshot(near[i]) });
          near[i].state = "FLICKERING";
          near[i].burstLeft = 0.2 + i * 0.12;
        }
        const p = this.walkPoint(22, 40);
        AudioSystem.playPositional("pipe", p.x, 1.6, p.z, { gain: 0.04, bus: "events" });
        this.begin("unknown_event", 2.2, snaps);
        return true;
      },

      update(dt) {
        if (GameState.phase !== "playing") return;
        if (this.remain > 0) {
          this.remain -= dt;
          if (this.ghost && this.ghost.material) {
            this.ghost.material.opacity = Math.max(0, this.remain / Math.max(0.05, CONFIG.envEvents.visualDur));
          }
          if (this.remain <= 0) this.endCurrent(false);
        }
        if (this.startIn > 0) {
          this.startIn -= dt;
          this.active = false;
          return;
        }
        this.active = true;
        if (this.cooldown > 0) this.cooldown -= dt;
        if (this.current) return;
        this.checkIn -= dt;
        if (this.checkIn > 0) return;
        this.checkIn = CONFIG.envEvents.checkInterval;
        if (this.cooldown > 0) return;
        if (this.rand() > CONFIG.envEvents.chance) return;
        const ev = this.pickEvent();
        if (!ev.execute()) {
          const fallback = this.register()[0];
          fallback.execute();
        }
      }
    };

    const WorldAPI = {
      playPositionalSound(kind, x, y, z, opts) { AudioSystem.playPositional(kind, x, y, z, opts); },
      triggerLightingEvent(x, z, r) { LightingSystem.triggerClusterEvent(x, z, r); },
      currentModule() {
        const C = LevelGenerator.CELL * CONFIG.tile;
        return MapGraph.nodeAt(Math.floor(Player.position.x / C), Math.floor(Player.position.z / C));
      },
      playerPosition() { return Player.position; },
      nearbyModules(rangeCells) {
        const C = LevelGenerator.CELL * CONFIG.tile;
        const gx = Math.floor(Player.position.x / C);
        const gz = Math.floor(Player.position.z / C);
        const out = [];
        const r = rangeCells || 2;
        for (let z = gz - r; z <= gz + r; z++) {
          for (let x = gx - r; x <= gx + r; x++) {
            const n = MapGraph.nodeAt(x, z);
            if (n && out.indexOf(n) < 0) out.push(n);
          }
        }
        return out;
      }
    };

    const EntitySystem = {
      entities: [],
      mesh: null,
      position: new THREE.Vector3(),
      spawned: false,
      pathDistanceAtSpawn: 0,
      spawnYaw: 0,
      yaw: 0,
      state: "WANDERING",
      path: [],
      pathI: 0,
      repathT: 0,
      senseT: 0,
      pauseT: 0,
      searchT: 0,
      lastKnown: new THREE.Vector3(),
      lastKnownModule: null,
      lastSeenTime: -999,
      playerVisible: false,
      playerHeard: false,
      inContact: false,
      dmgAcc: 0,
      targetModule: null,
      debugLine: null,
      vel: new THREE.Vector3(),

      spawn(position, yaw) {
        this.despawn();
        this.position.copy(position);
        this.spawnYaw = yaw || 0;
        this.yaw = this.spawnYaw;
        this.spawned = true;
        this.state = "WANDERING";
        this.path = [];
        this.pathI = 0;
        this.pauseT = 0.4;
        this.searchT = 0;
        this.playerVisible = false;
        this.playerHeard = false;
        this.lastKnown.copy(position);
        const group = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({
          color: 0x1a1814, roughness: 0.92, metalness: 0.02
        });
        const torso = new THREE.Mesh(Geometries.box, mat);
        torso.scale.set(0.42, 0.95, 0.28);
        torso.position.y = 1.15;
        const head = new THREE.Mesh(Geometries.box, mat);
        head.scale.set(0.28, 0.32, 0.26);
        head.position.y = 1.78;
        const legL = new THREE.Mesh(Geometries.box, mat);
        legL.scale.set(0.16, 0.7, 0.16);
        legL.position.set(-0.12, 0.35, 0);
        const legR = new THREE.Mesh(Geometries.box, mat);
        legR.scale.set(0.16, 0.7, 0.16);
        legR.position.set(0.12, 0.35, 0);
        group.add(torso, head, legL, legR);
        group.position.copy(position);
        group.rotation.y = this.yaw;
        if (scene) scene.add(group);
        this.mesh = group;
        this.entities = [this];
        this.pickWanderTarget();
        return this;
      },
      despawn() {
        if (this.mesh && scene) scene.remove(this.mesh);
        if (this.debugLine && scene) scene.remove(this.debugLine);
        this.debugLine = null;
        this.mesh = null;
        this.spawned = false;
        this.entities = [];
        this.pathDistanceAtSpawn = 0;
        this.state = "WANDERING";
        ChaseFx.reset();
      },
      getPosition() { return this.position; },
      isSpawned() { return this.spawned; },
      clear() { this.despawn(); },

      tileOf(pos) {
        return {
          x: Math.floor(pos.x / CONFIG.tile),
          z: Math.floor(pos.z / CONFIG.tile)
        };
      },
      walkable(t) { return t !== TILE.WALL && t !== TILE.COLUMN && t !== TILE.EXIT; },

      clearLineToPlayer() {
        const T = CONFIG.tile;
        const dx = Player.position.x - this.position.x;
        const dz = Player.position.z - this.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.2) return true;
        const steps = Math.max(2, Math.ceil(dist / (T * 0.35)));
        for (let i = 1; i < steps; i++) {
          const x = this.position.x + dx * (i / steps);
          const z = this.position.z + dz * (i / steps);
          const tx = Math.floor(x / T), tz = Math.floor(z / T);
          if (!Level.inBounds(tx, tz) || !this.walkable(Level.getTile(tx, tz))) return false;
        }
        return true;
      },
      losToPlayer() {
        const T = CONFIG.tile;
        const E = CONFIG.entity;
        const dx = Player.position.x - this.position.x;
        const dz = Player.position.z - this.position.z;
        const dist = Math.hypot(dx, dz);
        const range = E.visionRange * (Player.crouching ? E.crouchVisMult : 1);
        if (dist > range || dist < 0.2) return dist < 1.4;
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const ang = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / dist)));
        if (ang > (E.fovDeg * Math.PI / 180) * 0.5) return false;
        const steps = Math.max(2, Math.ceil(dist / (T * 0.4)));
        for (let i = 1; i < steps; i++) {
          const x = this.position.x + dx * (i / steps);
          const z = this.position.z + dz * (i / steps);
          const tx = Math.floor(x / T), tz = Math.floor(z / T);
          if (!Level.inBounds(tx, tz) || !this.walkable(Level.getTile(tx, tz))) return false;
        }
        return true;
      },

      hearPlayer() {
        if (Player.lastNoise <= 0) return false;
        const d = Math.hypot(Player.lastNoisePos.x - this.position.x, Player.lastNoisePos.z - this.position.z);
        return d <= Player.lastNoiseRadius;
      },

      buildPath(tx, tz) {
        const start = this.tileOf(this.position);
        if (!Level.inBounds(start.x, start.z) || !Level.inBounds(tx, tz)) return [];
        const cols = Level.cols, rows = Level.rows;
        const dist = [];
        const prev = [];
        for (let z = 0; z < rows; z++) {
          dist.push(new Int16Array(cols).fill(-1));
          prev.push(new Int32Array(cols).fill(-1));
        }
        if (!this.walkable(Level.getTile(start.x, start.z))) return [];
        const q = [[start.x, start.z]];
        dist[start.z][start.x] = 0;
        let qi = 0, found = false;
        const cap = 140;
        while (qi < q.length) {
          const p = q[qi++];
          if (p[0] === tx && p[1] === tz) { found = true; break; }
          if (dist[p[1]][p[0]] > cap) continue;
          for (let i = 0; i < 4; i++) {
            const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            if (dist[nz][nx] >= 0) continue;
            if (!this.walkable(Level.getTile(nx, nz))) continue;
            dist[nz][nx] = dist[p[1]][p[0]] + 1;
            prev[nz][nx] = p[0] | (p[1] << 16);
            q.push([nx, nz]);
          }
        }
        if (!found) return [];
        const tiles = [];
        let cx = tx, cz = tz;
        while (!(cx === start.x && cz === start.z)) {
          tiles.push([cx, cz]);
          const pr = prev[cz][cx];
          if (pr < 0) break;
          cx = pr & 65535;
          cz = pr >>> 16;
        }
        tiles.reverse();
        const pts = [];
        for (let i = 0; i < tiles.length; i += 2) {
          const w = Level.tileToWorld(tiles[i][0], tiles[i][1]);
          pts.push(new THREE.Vector3(w.x, 0, w.z));
        }
        if (tiles.length) {
          const last = tiles[tiles.length - 1];
          const w = Level.tileToWorld(last[0], last[1]);
          pts.push(new THREE.Vector3(w.x, 0, w.z));
        }
        return pts;
      },

      setPathToWorld(wx, wz) {
        const t = { x: Math.floor(wx / CONFIG.tile), z: Math.floor(wz / CONFIG.tile) };
        this.path = this.buildPath(t.x, t.z);
        this.pathI = 0;
        const gx = Math.floor(t.x / LevelGenerator.CELL);
        const gz = Math.floor(t.z / LevelGenerator.CELL);
        this.targetModule = MapGraph.nodeAt(gx, gz);
      },

      pickWanderTarget() {
        const here = this.tileOf(this.position);
        const gx = Math.floor(here.x / LevelGenerator.CELL);
        const gz = Math.floor(here.z / LevelGenerator.CELL);
        const cur = MapGraph.nodeAt(gx, gz);
        let destGx = gx, destGz = gz;
        if (cur && cur.connections && cur.connections.length) {
          const nid = cur.connections[Math.floor(Math.random() * cur.connections.length)];
          const n = MapGraph.nodes[nid];
          if (n) { destGx = n.gx; destGz = n.gz; }
        } else {
          destGx = gx + (Math.random() < 0.5 ? -1 : 1);
          destGz = gz + (Math.random() < 0.5 ? -1 : 1);
        }
        const tx = destGx * LevelGenerator.CELL + 2;
        const tz = destGz * LevelGenerator.CELL + 2;
        this.path = this.buildPath(tx, tz);
        this.pathI = 0;
        this.targetModule = MapGraph.nodeAt(destGx, destGz);
        if (!this.path.length) {
          for (let k = 0; k < 8 && !this.path.length; k++) {
            const ox = here.x + ((Math.random() * 11) | 0) - 5;
            const oz = here.z + ((Math.random() * 11) | 0) - 5;
            if (Level.inBounds(ox, oz) && this.walkable(Level.getTile(ox, oz))) {
              this.path = this.buildPath(ox, oz);
              this.pathI = 0;
            }
          }
        }
      },

      pickSearchTarget() {
        const here = this.tileOf(this.lastKnown);
        const opts = [];
        for (let dz = -4; dz <= 4; dz++) {
          for (let dx = -4; dx <= 4; dx++) {
            if (Math.abs(dx) + Math.abs(dz) < 2) continue;
            const x = here.x + dx, z = here.z + dz;
            if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) opts.push([x, z]);
          }
        }
        if (!opts.length) { this.pickWanderTarget(); return; }
        const p = opts[(Math.random() * opts.length) | 0];
        this.path = this.buildPath(p[0], p[1]);
        this.pathI = 0;
      },

      setState(next) {
        if (this.state === next) return;
        const prev = this.state;
        this.state = next;
        if (next === "PURSUING" && prev !== "PURSUING") ChaseFx.onPursuitStart();
        if (next === "SEARCHING") this.searchT = CONFIG.entity.searchTime;
        if (next === "WANDERING") this.pauseT = 0.4 + Math.random() * 0.6;
      },

      followPath(dt, speed) {
        if (!this.path.length || this.pathI >= this.path.length) return false;
        const goal = this.path[this.pathI];
        const dx = goal.x - this.position.x;
        const dz = goal.z - this.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.45) {
          this.pathI++;
          return this.pathI < this.path.length;
        }
        const vx = (dx / d) * speed;
        const vz = (dz / d) * speed;
        this.yaw = Math.atan2(-vx, -vz);
        const r = CONFIG.entity.radius, h = CONFIG.entity.height;
        this.position.x += vx * dt;
        resolveAxis(this.position, r, h, "x");
        this.position.z += vz * dt;
        resolveAxis(this.position, r, h, "z");
        resolveAxis(this.position, r, h, "y");
        if (this.position.y < -12) this.position.y = 0;
        return true;
      },

      update(dt) {
        if (!this.spawned) return;
        const E = CONFIG.entity;
        this.senseT -= dt;
        if (this.senseT <= 0) {
          this.senseT = E.senseInterval;
          this.playerVisible = this.losToPlayer();
          this.playerHeard = this.hearPlayer();
          if (this.playerVisible) {
            this.lastKnown.copy(Player.position);
            this.lastSeenTime = GameState.elapsed;
            const t = this.tileOf(Player.position);
            this.lastKnownModule = MapGraph.nodeAt(Math.floor(t.x / LevelGenerator.CELL), Math.floor(t.z / LevelGenerator.CELL));
            this.setState("PURSUING");
          } else if (this.playerHeard && this.state !== "PURSUING") {
            this.lastKnown.copy(Player.lastNoisePos);
            this.setState("ALERTED");
          }
        }

        const distP = Math.hypot(Player.position.x - this.position.x, Player.position.z - this.position.z);
        this.inContact = false;
        if (this.spawned && distP <= CONFIG.entity.contactDist && this.clearLineToPlayer()) {
          this.inContact = true;
          this.dmgAcc += CONFIG.entity.damagePerSec * dt;
          let hit = 0;
          while (this.dmgAcc >= 1) {
            this.dmgAcc -= 1;
            hit += 1;
          }
          if (hit > 0) {
            Player.damagePlayer(hit);
            ChaseFx.hitFlash();
            if (Player.getPlayerHP() <= 0) Game.gameOver();
          }
        } else {
          this.dmgAcc = 0;
        }

        if (this.state === "PURSUING") {
          const close = distP;
          if (close < 1.65) {
            this.vel.set(0, 0, 0);
          } else {
            this.repathT -= dt;
            const pt = this.tileOf(Player.position);
            const pmod = MapGraph.nodeAt(Math.floor(pt.x / LevelGenerator.CELL), Math.floor(pt.z / LevelGenerator.CELL));
            if (this.repathT <= 0 || (pmod && pmod !== this.targetModule)) {
              this.repathT = E.repath;
              if (this.playerVisible) this.lastKnown.copy(Player.position);
              this.setPathToWorld(this.lastKnown.x, this.lastKnown.z);
            }
            this.followPath(dt, E.chaseSpeed);
          }
          if (!this.playerVisible && GameState.elapsed - this.lastSeenTime > 0.35) {
            const dLast = Math.hypot(this.lastKnown.x - this.position.x, this.lastKnown.z - this.position.z);
            if (dLast < 1.8 || !this.path.length) this.setState("SEARCHING");
          }
        } else if (this.state === "ALERTED") {
          this.repathT -= dt;
          if (this.repathT <= 0) {
            this.repathT = 0.6;
            this.setPathToWorld(this.lastKnown.x, this.lastKnown.z);
          }
          const moving = this.followPath(dt, E.walkSpeed * 1.15);
          if (!moving) {
            this.yaw += dt * 1.8;
            this.pauseT -= dt;
            if (this.pauseT <= 0) this.setState("SEARCHING");
          }
        } else if (this.state === "SEARCHING") {
          this.searchT -= dt;
          if (!this.path.length || this.pathI >= this.path.length) {
            this.pickSearchTarget();
            this.yaw += dt * 2.2;
          } else {
            this.followPath(dt, E.walkSpeed);
          }
          if (this.searchT <= 0) this.setState("WANDERING");
        } else {
          if (this.pauseT > 0) {
            this.pauseT -= dt;
            this.yaw += dt * 0.4;
          } else if (!this.path.length || this.pathI >= this.path.length) {
            this.pauseT = E.pauseMin + Math.random() * (E.pauseMax - E.pauseMin);
            this.pickWanderTarget();
          } else {
            this.followPath(dt, E.walkSpeed);
          }
        }

        if (this.mesh) {
          this.mesh.position.copy(this.position);
          this.mesh.rotation.y = this.yaw;
        }
        if (this.state === "PURSUING" && Math.random() < dt * 0.7) {
          AudioSystem.playPositional("creak", this.position.x, 1.4, this.position.z, { gain: 0.028, bus: "entity", max: 36 });
        }
        this.updateDebugViz();
      },

      updateDebugViz() {
        if (this.debugLine && scene) {
          scene.remove(this.debugLine);
          if (this.debugLine.geometry) this.debugLine.geometry.dispose();
          this.debugLine = null;
        }
        if (!GameState.debugViz || !this.spawned || !this.path.length) return;
        const pts = [this.position.clone()];
        for (let i = this.pathI; i < this.path.length; i++) pts.push(this.path[i]);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        this.debugLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6644 }));
        scene.add(this.debugLine);
      }
    };

    const ChaseFx = {
      intensity: 0,
      flash: 0,
      vig: null,
      runEl: null,
      init() {
        this.vig = document.getElementById("chase-vignette");
        this.runEl = document.getElementById("run-flash");
      },
      reset() {
        this.intensity = 0;
        this.flash = 0;
        if (this.vig) this.vig.style.opacity = "0";
        if (this.runEl) this.runEl.style.opacity = "0";
      },
      hitFlash() {
        const el = document.getElementById("dmg-flash");
        if (el) {
          el.style.opacity = "0.55";
          setTimeout(() => { if (el) el.style.opacity = "0"; }, 90);
        }
        this.intensity = Math.min(CONFIG.chase.redMaxOpacity, this.intensity + 0.18);
        CameraRig.chaseAmp = Math.max(CameraRig.chaseAmp || 0, 0.35);
        AudioSystem._tone && AudioSystem._tone(70, "sawtooth", 0.07, 0.03, "events");
      },
      onPursuitStart() {
        this.flash = CONFIG.chase.runFlash;
        AudioSystem.playPositional("thump", EntitySystem.position.x, 1.2, EntitySystem.position.z, { gain: 0.06, bus: "entity" });
      },
      update(dt) {
        if (!this.vig) this.init();
        let target = 0;
        if (EntitySystem.spawned && EntitySystem.state === "PURSUING") {
          const d = Math.hypot(EntitySystem.position.x - Player.position.x, EntitySystem.position.z - Player.position.z);
          const t = 1 - Math.max(0, Math.min(1, (d - CONFIG.chase.redMin) / (CONFIG.chase.redMax - CONFIG.chase.redMin)));
          target = CONFIG.chase.redMaxOpacity * t;
        } else if (EntitySystem.spawned && EntitySystem.state === "SEARCHING") {
          target = CONFIG.chase.redMaxOpacity * 0.22;
        } else if (EntitySystem.spawned && EntitySystem.state === "ALERTED") {
          target = CONFIG.chase.redMaxOpacity * 0.08;
        }
        const san = Player.getSanity ? Player.getSanity() / CONFIG.sanity.max : 1;
        if (san < 0.45) target = Math.max(target, (0.45 - san) * 0.35);
        this.intensity += (target - this.intensity) * Math.min(1, dt * 2.4);
        if (this.vig) this.vig.style.opacity = String(Math.max(0, this.intensity));
        if (this.flash > 0) {
          this.flash -= dt;
          const p = Math.max(0, this.flash / CONFIG.chase.runFlash);
          const blink = (Math.sin(this.flash * 28) * 0.5 + 0.5);
          if (this.runEl) this.runEl.style.opacity = String(p * (0.45 + blink * 0.55));
        } else if (this.runEl) this.runEl.style.opacity = "0";
        CameraRig.chaseAmp = this.intensity;
      }
    };

    const EncounterManager = {
      entitySpawned: false,
      encounterSystemActive: false,
      checkTimer: 0,
      distanceSinceCheck: 0,
      lastDistance: 0,
      lastProbability: 0,
      lastPathDist: 0,
      rng: null,

      reset() {
        this.entitySpawned = false;
        this.encounterSystemActive = false;
        this.checkTimer = 0;
        this.distanceSinceCheck = 0;
        this.lastDistance = 0;
        this.lastProbability = 0;
        this.lastPathDist = 0;
        const salt = 0xE4C011;
        this.rng = mulberry32(((GameState.seed || 1) ^ salt) >>> 0);
        EntitySystem.despawn();
      },
      rand() { return this.rng ? this.rng() : Math.random(); },

      currentProbability() {
        const E = CONFIG.encounter;
        const elapsed = GameState.elapsed;
        if (elapsed < E.startTime) return 0;
        if (elapsed >= E.guaranteeTime) return 1;
        const t = Math.max(0, Math.min(1, (elapsed - E.startTime) / (E.guaranteeTime - E.startTime)));
        const timeP = E.baseCheck + (E.maxCheck - E.baseCheck) * Math.pow(t, E.curveExp);
        const distP = Math.min(E.distWeightMax, (GameState.distance / E.distStep) * E.distWeight);
        return Math.max(0, Math.min(0.96, timeP + distP));
      },

      timeUntilGuarantee() {
        return Math.max(0, CONFIG.encounter.guaranteeTime - GameState.elapsed);
      },

      walkable(t) {
        return t !== TILE.WALL && t !== TILE.COLUMN;
      },

      playerTile() {
        const T = CONFIG.tile;
        return {
          x: Math.floor(Player.position.x / T),
          z: Math.floor(Player.position.z / T)
        };
      },

      visibleFromPlayer(tx, tz) {
        const T = CONFIG.tile;
        const px = Player.position.x;
        const pz = Player.position.z;
        const py = Player.position.y + Player.eyeHeight();
        const wx = (tx + 0.5) * T;
        const wz = (tz + 0.5) * T;
        const dx = wx - px;
        const dz = wz - pz;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) return true;
        const fx = -Math.sin(Player.yaw);
        const fz = -Math.cos(Player.yaw);
        const ndx = dx / dist, ndz = dz / dist;
        const facing = fx * ndx + fz * ndz;
        const steps = Math.max(2, Math.ceil(dist / (T * 0.45)));
        let blocked = false;
        for (let i = 1; i < steps; i++) {
          const x = px + dx * (i / steps);
          const z = pz + dz * (i / steps);
          const tileX = Math.floor(x / T);
          const tileZ = Math.floor(z / T);
          if (!Level.inBounds(tileX, tileZ) || !this.walkable(Level.getTile(tileX, tileZ))) {
            blocked = true;
            break;
          }
        }
        if (blocked) return false;
        if (facing > 0.18 && dist < 95) return true;
        if (facing > 0.55) return true;
        return false;
      },

      findSpawnTile(minM, maxM) {
        const start = this.playerTile();
        if (!Level.inBounds(start.x, start.z)) return null;
        const cols = Level.cols, rows = Level.rows;
        const dist = [];
        for (let z = 0; z < rows; z++) dist.push(new Int16Array(cols).fill(-1));
        if (!this.walkable(Level.getTile(start.x, start.z))) {
          let found = false;
          for (let r = 1; r <= 3 && !found; r++) {
            for (let dz = -r; dz <= r && !found; dz++) {
              for (let dx = -r; dx <= r && !found; dx++) {
                const x = start.x + dx, z = start.z + dz;
                if (Level.inBounds(x, z) && this.walkable(Level.getTile(x, z))) {
                  start.x = x; start.z = z; found = true;
                }
              }
            }
          }
          if (!found) return null;
        }
        const q = [[start.x, start.z]];
        dist[start.z][start.x] = 0;
        let qi = 0;
        const tileMin = Math.floor(minM / CONFIG.tile);
        const tileMax = Math.ceil(maxM / CONFIG.tile);
        const raw = [];
        const pgx = Math.floor(start.x / LevelGenerator.CELL);
        const pgz = Math.floor(start.z / LevelGenerator.CELL);
        while (qi < q.length) {
          const p = q[qi++];
          const d = dist[p[1]][p[0]];
          if (d > tileMax) continue;
          if (d >= tileMin && d <= tileMax) raw.push(p);
          if (d === tileMax) continue;
          for (let i = 0; i < 4; i++) {
            const nx = p[0] + DIR4[i].x, nz = p[1] + DIR4[i].z;
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            if (dist[nz][nx] >= 0) continue;
            const tt = Level.getTile(nx, nz);
            if (!this.walkable(tt) || tt === TILE.START || tt === TILE.EXIT) continue;
            dist[nz][nx] = d + 1;
            q.push([nx, nz]);
          }
        }
        if (!raw.length) return null;

        function score(p) {
          const gx = Math.floor(p[0] / LevelGenerator.CELL);
          const gz = Math.floor(p[1] / LevelGenerator.CELL);
          const mod = MapGraph.nodeAt(gx, gz);
          let s = 0;
          if (mod && (gx !== pgx || gz !== pgz)) s += 4;
          if (mod && (mod.type === "corridor" || mod.type === "junction" || mod.type === "hall_long" || mod.type === "room_large" || mod.type === "room_small")) s += 3;
          if (mod && mod.deadEnd) s -= 6;
          if (!EncounterManager.visibleFromPlayer(p[0], p[1])) s += 8;
          return s;
        }

        let hidden = raw.filter((p) => !this.visibleFromPlayer(p[0], p[1]));
        let pool = hidden.length ? hidden : raw;
        pool.sort((a, b) => score(b) - score(a));
        const top = pool.slice(0, Math.min(12, pool.length));
        const pick = top[Math.floor(this.rand() * top.length)];
        return {
          x: pick[0],
          z: pick[1],
          pathM: dist[pick[1]][pick[0]] * CONFIG.tile
        };
      },

      trySpawn(force) {
        if (this.entitySpawned) return false;
        const want = CONFIG.encounter.pathMin + this.rand() * (CONFIG.encounter.pathMax - CONFIG.encounter.pathMin);
        let found = this.findSpawnTile(Math.max(50, want - 12), Math.min(100, want + 12));
        if (!found) found = this.findSpawnTile(50, 100);
        if (!found) found = this.findSpawnTile(40, 120);
        if (!found) return false;
        const w = Level.tileToWorld(found.x, found.z);
        const yaw = this.rand() * Math.PI * 2;
        EntitySystem.spawn(new THREE.Vector3(w.x, 0, w.z), yaw);
        EntitySystem.pathDistanceAtSpawn = found.pathM;
        this.entitySpawned = true;
        this.lastPathDist = found.pathM;
        this.onSpawned(w);
        return true;
      },

      onSpawned(worldPos) {
        if (this.rand() < 0.7) {
          AudioSystem.playPositional("creak", worldPos.x, 1.2, worldPos.z, { gain: 0.035, max: 55 });
        }
        if (this.rand() < 0.55) {
          LightingSystem.triggerClusterEvent(worldPos.x, worldPos.z, 10);
        }
      },

      update(dt) {
        if (GameState.phase !== "playing") return;
        const E = CONFIG.encounter;
        if (this.entitySpawned) return;

        if (GameState.elapsed >= E.startTime) this.encounterSystemActive = true;
        else {
          this.lastProbability = 0;
          return;
        }

        const moved = GameState.distance - this.lastDistance;
        if (moved > 0) {
          this.distanceSinceCheck += moved;
          this.lastDistance = GameState.distance;
        }
        this.checkTimer += dt;

        const timeDue = this.checkTimer >= E.checkInterval;
        const distDue = this.distanceSinceCheck >= E.distStep;
        if (!timeDue && !distDue) return;
        if (timeDue) this.checkTimer = 0;
        if (distDue) this.distanceSinceCheck = 0;

        const p = this.currentProbability();
        this.lastProbability = p;
        const force = GameState.elapsed >= E.guaranteeTime;
        if (force || this.rand() < p) this.trySpawn(force);
      }
    };

    function spawnEntity(position) {
      const e = EntitySystem.spawn(position);
      EncounterManager.entitySpawned = true;
      return e;
    }
    function despawnEntity() {
      EncounterManager.entitySpawned = false;
      EntitySystem.despawn();
    }
    function getEntityPosition() { return EntitySystem.getPosition(); }
    function isEntitySpawned() { return EntitySystem.isSpawned(); }

    /* ------------------------------------------------------------------
       GAME LOOP / INIT
       ------------------------------------------------------------------ */
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
        Level.buildProcedural(scene, GameState.seed);
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

        document.getElementById("btn-start").addEventListener("click", () => this.start());
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
          const startOverlay = document.getElementById("start-overlay");
          if (GameState.ready && GameState.phase === "start" && startOverlay && getComputedStyle(startOverlay).display !== "none") {
            e.preventDefault();
            this.start();
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
        document.getElementById("start-overlay").style.display = "flex";
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
        GameState.elapsed = 0;
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
        const built = Level.buildProcedural(scene, newSeed);
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
        document.getElementById("stat-time").textContent = HUD.formatTime(GameState.elapsed);
        document.getElementById("stat-dist").textContent = GameState.distance.toFixed(1) + " m";
        document.getElementById("complete-overlay").style.display = "flex";
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
      },

      loop() {
        requestAnimationFrame(() => this.loop());
        const now = performance.now();
        let dt = (now - GameState.lastTime) / 1000;
        GameState.lastTime = now;
        if (dt > 0.05) dt = 0.05;

        if (GameState.phase === "playing" && Stairwell.sequenceActive) {
          GameState.elapsed += dt;
          Stairwell.update(dt);
          CameraRig.update(dt);
        } else if (GameState.phase === "playing" && Input.locked) {
          GameState.elapsed += dt;
          if (GameState.level === 1 && Level1.active) Level1.update(dt);
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
  })();
