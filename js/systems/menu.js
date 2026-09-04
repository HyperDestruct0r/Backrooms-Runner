"use strict";

const MenuSystem = {
  bindings: [
    ["forward", "Move forward"],
    ["backward", "Move backward"],
    ["left", "Move left"],
    ["right", "Move right"],
    ["sprint", "Sprint"],
    ["crouch", "Crouch"],
    ["jump", "Jump"],
    ["flashlight", "Flashlight"],
    ["inventory", "Inventory"],
    ["drink", "Drink Almond Water"],
    ["use", "Pick up / interact"],
    ["nearestExit", "Nearest exit"],
    ["recordRun", "Record run"],
    ["regenerate", "New layout"]
  ],
  menuIndex: 0,
  menuItems: ["play", "settings", "controls", "credits"],
  rebinding: null,
  settingsKey: "backroomsRunner.settings.v1",
  bindingsKey: "backroomsRunner.bindings.v1",

  init() {
    this.loadSettings();
    this.loadBindings();
    this.renderBindings();
    this.bindButtons();
    this.applyAudio();
    this.updateSensitivity();
    this.selectMain(0);
  },

  showMain() {
    this.cancelRebind();
    const overlay = document.getElementById("start-overlay");
    if (overlay) overlay.style.display = "flex";
    this.showPage("main");
    this.selectMain(this.menuIndex);
    if (typeof setPauseOverlay === "function") setPauseOverlay(false);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  },

  showPage(page) {
    document.querySelectorAll(".menu-page").forEach(el => el.classList.remove("is-open"));
    const target = document.getElementById("menu-page-" + page);
    if (target) {
      requestAnimationFrame(() => target.classList.add("is-open"));
    }
    const main = document.getElementById("menu-main");
    if (main) main.classList.toggle("is-hidden", page !== "main");
  },

  closePage() {
    this.cancelRebind();
    const page = document.querySelector(".menu-page.is-open:not(#menu-page-main)");
    if (page) page.classList.remove("is-open");
    setTimeout(() => this.showPage("main"), 360);
  },

  bindButtons() {
    document.querySelectorAll("[data-menu-action]").forEach(btn => {
      btn.addEventListener("click", () => this.activate(btn.dataset.menuAction));
    });
    document.querySelectorAll("[data-menu-index]").forEach(btn => {
      btn.addEventListener("mouseenter", () => this.selectMain(Number(btn.dataset.menuIndex)));
    });

    document.querySelectorAll(".menu-back").forEach(back => {
      back.addEventListener("click", () => this.closePage());
    });

    document.querySelectorAll(".menu-range").forEach(input => {
      input.addEventListener("input", () => {
        const key = input.dataset.setting;
        const value = Number(input.value);
        this.settings[key] = value;
        const out = document.getElementById(input.id + "-value");
        if (out) out.textContent = Math.round(value * 100) + "%";
        this.applyAudio();
        this.saveSettings();
      });
    });

    const sens = document.getElementById("setting-sensitivity");
    if (sens) sens.addEventListener("input", () => {
      this.settings.sensitivity = Number(sens.value);
      const out = document.getElementById("setting-sensitivity-value");
      if (out) out.textContent = Number(sens.value).toFixed(3);
      this.updateSensitivity();
      this.saveSettings();
    });

    const fullscreen = document.getElementById("setting-fullscreen");
    if (fullscreen) fullscreen.addEventListener("change", () => {
      this.settings.fullscreen = fullscreen.checked;
      this.saveSettings();
      this.setFullscreen(fullscreen.checked);
    });

    window.addEventListener("keydown", e => {
      if (this.rebinding) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") return this.cancelRebind();
        if (e.code === "Backspace" || e.code === "Delete") return this.unbind(this.rebinding.action);
        this.tryBind(this.rebinding.action, e.code);
        return;
      }

      const overlay = document.getElementById("start-overlay");
      if (!overlay || getComputedStyle(overlay).display === "none") return;
      const active = document.querySelector(".menu-page.is-open");
      if (!active || active.id !== "menu-page-main") return;
      if (["ArrowDown", "KeyS"].includes(e.code)) {
        e.preventDefault(); this.selectMain((this.menuIndex + 1) % this.menuItems.length);
      } else if (["ArrowUp", "KeyW"].includes(e.code)) {
        e.preventDefault(); this.selectMain((this.menuIndex - 1 + this.menuItems.length) % this.menuItems.length);
      } else if (["Enter", "Space"].includes(e.code)) {
        e.preventDefault(); this.activate(this.menuItems[this.menuIndex]);
      }
    }, true);
  },

  activate(action) {
    if (action === "play") {
      if (typeof Game !== "undefined") Game.start();
      return;
    }
    if (action === "settings" || action === "controls" || action === "credits") {
      this.showPage(action);
    }
  },

  selectMain(index) {
    this.menuIndex = Math.max(0, Math.min(this.menuItems.length - 1, index));
    document.querySelectorAll("[data-menu-index]").forEach(btn => {
      btn.classList.toggle("selected", Number(btn.dataset.menuIndex) === this.menuIndex);
    });
  },

  defaultSettings() {
    return { master: 0.55, ambient: 0.028, footsteps: 0.22, events: 0.18, sensitivity: 0.00215, fullscreen: false };
  },

  settings: {},

  loadSettings() {
    this.settings = this.defaultSettings();
    try {
      const saved = JSON.parse(localStorage.getItem(this.settingsKey) || "null");
      if (saved && typeof saved === "object") Object.assign(this.settings, saved);
    } catch (_) {}
    const values = ["master", "ambient", "footsteps", "events"];
    values.forEach(k => {
      const input = document.querySelector('[data-setting="' + k + '"]');
      if (input) input.value = this.settings[k];
      const out = document.getElementById("setting-" + k + "-value");
      if (out) out.textContent = Math.round(this.settings[k] * 100) + "%";
    });
    const sens = document.getElementById("setting-sensitivity");
    if (sens) sens.value = this.settings.sensitivity;
    const sout = document.getElementById("setting-sensitivity-value");
    if (sout) sout.textContent = Number(this.settings.sensitivity).toFixed(3);
    const fs = document.getElementById("setting-fullscreen");
    if (fs) fs.checked = !!this.settings.fullscreen;
  },

  saveSettings() {
    try { localStorage.setItem(this.settingsKey, JSON.stringify(this.settings)); } catch (_) {}
  },

  applyAudio() {
    if (typeof CONFIG !== "undefined") {
      CONFIG.audio.master = this.settings.master;
      CONFIG.audio.ambient = this.settings.ambient;
      CONFIG.audio.footsteps = this.settings.footsteps;
      CONFIG.audio.events = this.settings.events;
    }
    if (typeof AudioSystem !== "undefined" && AudioSystem.master) {
      AudioSystem.master.gain.value = this.settings.master;
      if (AudioSystem.buses.ambient) AudioSystem.buses.ambient.gain.value = this.settings.ambient;
      if (AudioSystem.buses.footsteps) AudioSystem.buses.footsteps.gain.value = this.settings.footsteps;
      if (AudioSystem.buses.events) AudioSystem.buses.events.gain.value = this.settings.events;
    }
  },

  updateSensitivity() {
    if (typeof CONFIG !== "undefined") CONFIG.lookSens = Number(this.settings.sensitivity) || 0.00215;
  },

  async setFullscreen(enabled) {
    try {
      if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch (_) {}
  },

  loadBindings() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.bindingsKey) || "null");
      if (!saved || typeof saved !== "object" || typeof CONFIG === "undefined") return;
      this.bindings.forEach(([action]) => {
        if (typeof saved[action] === "string" && saved[action]) CONFIG.keys[action] = saved[action];
      });
    } catch (_) {}
  },

  saveBindings() {
    if (typeof CONFIG === "undefined") return;
    const data = {};
    this.bindings.forEach(([action]) => { data[action] = CONFIG.keys[action] || null; });
    try { localStorage.setItem(this.bindingsKey, JSON.stringify(data)); } catch (_) {}
  },

  renderBindings() {
    const list = document.getElementById("controls-list");
    if (!list || typeof CONFIG === "undefined") return;
    list.innerHTML = "";
    this.bindings.forEach(([action, label]) => {
      const row = document.createElement("div");
      row.className = "control-row";
      row.innerHTML = `<div><strong>${label}</strong><small>${action === "recordRun" || action === "regenerate" ? "Utility" : "Gameplay"}</small></div>`;
      const right = document.createElement("div"); right.className = "control-right";
      const key = document.createElement("button"); key.type = "button"; key.className = "key-button";
      key.textContent = this.formatKey(CONFIG.keys[action]);
      key.addEventListener("click", () => this.beginRebind(action, key));
      const unbind = document.createElement("button"); unbind.type = "button"; unbind.className = "unbind-button"; unbind.textContent = "UNBIND";
      unbind.addEventListener("click", () => this.unbind(action));
      right.append(key, unbind); row.appendChild(right); list.appendChild(row);
    });
  },

  formatKey(code) {
    if (!code) return "UNBOUND";
    const special = { Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT", ControlLeft: "CTRL", ControlRight: "CTRL", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "ESC", Backspace: "BACKSPACE", Delete: "DELETE", Enter: "ENTER", Tab: "TAB" };
    if (special[code]) return special[code];
    if (code.startsWith("Key")) return code.slice(3).toUpperCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) return "NUM " + code.slice(6);
    return code.replace(/Left|Right/g, "").toUpperCase();
  },

  beginRebind(action, button) {
    this.cancelRebind();
    this.rebinding = { action, button };
    button.classList.add("rebinding");
    button.textContent = "PRESS A KEY…";
    const error = document.getElementById("controls-error");
    if (error) { error.textContent = "Press a key to bind. Backspace/Delete unbinds · Esc cancels."; error.className = "controls-message info"; }
  },

  tryBind(action, code) {
    if (["Escape", "Tab"].includes(code)) return;
    const conflict = this.bindings.find(([other]) => other !== action && CONFIG.keys[other] === code);
    if (conflict) {
      const error = document.getElementById("controls-error");
      if (error) { error.textContent = `${this.formatKey(code)} is already bound to “${conflict[1]}”. Unbind that control first.`; error.className = "controls-message error"; }
      return;
    }
    CONFIG.keys[action] = code;
    this.saveBindings();
    this.renderBindings();
    const error = document.getElementById("controls-error");
    if (error) { error.textContent = `Saved: ${this.formatKey(code)} → ${this.bindings.find(x => x[0] === action)[1]}.`; error.className = "controls-message success"; }
    this.rebinding = null;
  },

  unbind(action) {
    CONFIG.keys[action] = null;
    this.saveBindings();
    this.renderBindings();
    const error = document.getElementById("controls-error");
    if (error) { error.textContent = `${this.bindings.find(x => x[0] === action)[1]} unbound.`; error.className = "controls-message success"; }
    this.rebinding = null;
  },

  cancelRebind() {
    if (this.rebinding) {
      this.rebinding = null;
      this.renderBindings();
    }
  }
};
