/* Backrooms Runner — partitioned source.
 * Extracted from the working Rev. 9 game.js.
 * This file is intentionally a classic script so the existing shared game state
 * remains available to the other partitioned files.
 */

"use strict";

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
  lastDamageAgo: 999,
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
    this.lastDamageAgo = 999;
    this.sprintJumping = false;
    Checkpoints.respawn();
  },

  damagePlayer(amount) {
    const dmg = Math.max(0, amount | 0);
    if (dmg > 0) {
      this.hp = Math.max(0, Math.min(this.maxHp, this.hp - dmg));
      this.lastDamageAgo = 0;
      this.hpRegenAcc = 0;
    }
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
    const smilerDrain = (typeof Level1 !== "undefined" && Level1.active && typeof SmilerSystem !== "undefined")
      ? SmilerSystem.activeCount()
      : 0;
    const rate = C.drain + (chasing ? C.chaseDrain : 0) + smilerDrain;
    this.sanityAcc += rate * dt;
    this.lastDamageAgo += dt;
    while (this.sanityAcc >= 1 && this.sanity > 0) {
      this.sanityAcc -= 1;
      this.sanity -= 1;
    }
    if (this.sanity <= 0) { this.sanity = 0; this.sanityAcc = 0; }
    if (this.sanity > C.hpRegenSanityNeed &&
        this.stamina > C.hpRegenStaminaNeed &&
        this.lastDamageAgo >= C.hpRegenDelay &&
        this.hp < this.maxHp) {
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
        // Level 1 blackouts give the player a small recovery advantage.
        // This applies only during the actual outage, not the normal game.
        const blackoutRegen = (typeof Level1 !== 'undefined' && Level1.active && Level1.blackoutState === 'outage')
          ? 0.65
          : S.regen;
        this.stamAcc += blackoutRegen * dt;
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
    const wantCrouch = isActionDown("crouch");
    const wantSprint = isActionDown("sprint");
    const wantJump = isActionDown("jump");

    // Look: desktop uses pointer-lock mouse deltas; mobile uses the right
    // virtual stick. Horizontal input rotates yaw, vertical input rotates pitch.
    if (DeviceMode.mobile) {
      const stick = MobileControls;
      const lookGain = CONFIG.lookSens * 18 * stick.lookSensitivity / 0.055;
      this.yaw -= stick.lookX * lookGain * dt * 60;
      this.pitch -= stick.lookY * lookGain * dt * 60;
    } else {
      this.yaw -= Input.mouseDX * CONFIG.lookSens;
      this.pitch -= Input.mouseDY * CONFIG.lookSens;
      Input.resetMouse();
    }
    const lim = Math.PI * 0.48;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;

    // Slide
    if (wantCrouch && wantSprint && this.onGround && !this.sliding && this.stamina > 12 &&
        (isActionDown("forward") || this.velocity.length() > 4)) {
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
    if (DeviceMode.mobile) {
      fwd = -MobileControls.moveY;
      str = MobileControls.moveX;
      const len = Math.hypot(fwd, str);
      if (len > 1) { fwd /= len; str /= len; }
    } else {
      if (isActionDown("forward")) fwd += 1;
      if (isActionDown("backward")) fwd -= 1;
      if (isActionDown("right")) str += 1;
      if (isActionDown("left")) str -= 1;
      const len = Math.hypot(fwd, str);
      if (len > 0) { fwd /= len; str /= len; }
    }

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
    this.light = new THREE.SpotLight(0xf4f8ff, 0, f.distance, f.angle, f.penumbra, f.decay);
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
    } else if (!DeviceMode.mobile && renderer && renderer.domElement && GameState.phase === "playing") {
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
    const regionType = Level1.macroType(rx, rz);
    const almondChance = regionType === 'parking'
      ? CONFIG.items.parkingAlmondChance
      : CONFIG.items.almondChance;
    tryPlace('almond',CONFIG.items.almondAttempts,almondChance,CONFIG.items.almondMaxPerRegion);
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
