"use strict";

/* The Void — shared transition curtain and lifecycle coordinator.
   Level generators remain responsible for deciding where/when to exit.
   This system owns sequencing, duplicate protection, error handling and
   pointer-lock restoration. Physical transition shells can be layered on
   this lifecycle without being owned by streamed level chunks. */
const VoidTransition = {
  minHold: 0.9,
  fadeDuration: 460,
  shownAt: 0,
  active: false,
  _runId: 0,
  _activePromise: null,
  _restorePointerLock: false,
  _physicalShell: null,

  // A temporary elevator-like cabin owned by the transition system rather
  // than either streamed level. Its meshes and materials are independent of
  // chunk disposal, so it survives the old level being reset.
  createPhysicalShell() {
    if (typeof THREE === "undefined" || typeof scene === "undefined" || !scene ||
        typeof Player === "undefined" || !Player.position) return null;
    this.disposePhysicalShell();
    const root = new THREE.Group();
    root.name = "PersistentTransitionShell";
    const metal = new THREE.MeshStandardMaterial({ color: 0x737b80, roughness: 0.48, metalness: 0.55 });
    const inner = new THREE.MeshStandardMaterial({ color: 0x30383b, roughness: 0.82, metalness: 0.12 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a4, roughness: 0.38, metalness: 0.62 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x454b4e, roughness: 0.72, metalness: 0.22 });
    const addBox = (name, material, x, y, z, w, h, d) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.name = name;
      mesh.position.set(x, y, z);
      root.add(mesh);
      return mesh;
    };
    // Cabin is centered on the player; the open face points along local +Z.
    addBox("floor", floorMat, 0, 0, 0, 2.8, 0.12, 2.8);
    addBox("ceiling", metal, 0, 2.45, 0, 2.8, 0.12, 2.8);
    addBox("back-wall", inner, 0, 1.22, -1.34, 2.8, 2.45, 0.12);
    addBox("left-wall", metal, -1.34, 1.22, 0, 0.12, 2.45, 2.8);
    addBox("right-wall", metal, 1.34, 1.22, 0, 0.12, 2.45, 2.8);
    const doorL = addBox("left-door", doorMat, -0.69, 1.2, 1.34, 1.36, 2.38, 0.10);
    const doorR = addBox("right-door", doorMat, 0.69, 1.2, 1.34, 1.36, 2.38, 0.10);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.035, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xffe8bd }));
    lamp.position.set(0, 2.37, 0);
    root.add(lamp);
    root.position.set(Player.position.x, Player.position.y - 0.05, Player.position.z);
    root.rotation.y = Number.isFinite(Player.yaw) ? Player.yaw : 0;
    scene.add(root);
    this._physicalShell = { root, doorL, doorR, materials: [metal, inner, doorMat, floorMat, lamp.material] };
    return this._physicalShell;
  },

  movePhysicalShellToPlayer() {
    const shell = this._physicalShell;
    if (!shell || typeof Player === "undefined") return;
    shell.root.position.set(Player.position.x, Player.position.y - 0.05, Player.position.z);
    shell.root.rotation.y = Number.isFinite(Player.yaw) ? Player.yaw : 0;
  },

  async openPhysicalShell() {
    const shell = this._physicalShell;
    if (!shell) return;
    const start = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    await new Promise(resolve => {
      const step = now => {
        const t = Math.min(1, Math.max(0, ((now || Date.now()) - start) / 520));
        const eased = 1 - Math.pow(1 - t, 3);
        shell.doorL.position.x = -0.69 - 0.68 * eased;
        shell.doorR.position.x = 0.69 + 0.68 * eased;
        if (t >= 1) resolve();
        else if (typeof requestAnimationFrame === "function") requestAnimationFrame(step);
        else setTimeout(() => step(Date.now()), 16);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(step);
      else setTimeout(() => step(Date.now()), 16);
    });
    await this._delay(250);
    this.disposePhysicalShell();
  },

  disposePhysicalShell() {
    const shell = this._physicalShell;
    if (!shell) return;
    if (shell.root.parent) shell.root.parent.remove(shell.root);
    shell.root.traverse(obj => { if (obj.geometry) obj.geometry.dispose(); });
    for (const material of shell.materials) if (material && material.dispose) material.dispose();
    this._physicalShell = null;
  },

  show(from, to) {
    const el = document.getElementById("void-overlay");
    this._restorePointerLock = !!document.pointerLockElement;
    if (el) {
      el.classList.remove("is-out");
      el.classList.add("is-on");
      el.setAttribute("aria-hidden", "false");
      const line = el.querySelector(".void-line");
      if (line) line.textContent = "THE VOID";
    }
    this.shownAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    this.active = true;
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement && typeof document.exitPointerLock === "function") document.exitPointerLock();
    return !!el;
  },

  _nextPaint() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(resolve));
      else setTimeout(resolve, 32);
    });
  },

  _delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); },

  // Runs a destination activation only after the curtain has had a chance to
  // paint. Resolves true on success and false on failure; never leaves the
  // overlay stuck over a failed destination load.
  then(fn, options) {
    if (this.active) {
      console.warn("VOID TRANSITION IGNORED: another transition is already active");
      return Promise.resolve(false);
    }
    const config = options || {};
    const runId = ++this._runId;
    this.show(config.from, config.to);
    const minHold = Number.isFinite(config.minHold) ? Math.max(0, config.minHold) : this.minHold;

    const task = (async () => {
      let succeeded = false;
      try {
        await this._nextPaint();
        if (runId !== this._runId) return false;
        if (config.physical) this.createPhysicalShell();
        if (typeof fn === "function") await fn();
        if (config.physical) this.movePhysicalShellToPlayer();
        succeeded = true;
      } catch (err) {
        console.error("VOID TRANSITION FAILED", err);
        this.disposePhysicalShell();
      }

      const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      await this._delay(Math.max(0, minHold * 1000 - (now - this.shownAt)));
      if (runId === this._runId) await this.hide(runId);
      if (config.physical && succeeded && runId === this._runId) await this.openPhysicalShell();
      return succeeded;
    })();

    this._activePromise = task.finally(() => {
      if (runId === this._runId) {
        this.active = false;
        this._activePromise = null;
      }
    });
    return this._activePromise;
  },

  async hide(runId) {
    if (runId !== undefined && runId !== this._runId) return;
    const el = document.getElementById("void-overlay");
    if (el) {
      el.classList.add("is-out");
      await this._delay(this.fadeDuration);
      if (runId !== undefined && runId !== this._runId) return;
      el.classList.remove("is-on", "is-out");
      el.setAttribute("aria-hidden", "true");
    }
    this.active = false;
    const shouldRestore = this._restorePointerLock;
    this._restorePointerLock = false;
    if (shouldRestore && typeof renderer !== "undefined" && renderer && renderer.domElement &&
        typeof DeviceMode !== "undefined" && !DeviceMode.mobile &&
        typeof GameState !== "undefined" && GameState.phase === "playing") {
      try { renderer.domElement.requestPointerLock(); } catch (_) {}
    }
  }
};
