"use strict";

/* ------------------------------------------------------------------
   Main menu / settings / control rebinding
   ------------------------------------------------------------------ */
const MenuSystem = {
  root: null,
  screen: "main",
  selected: 0,
  rebinding: null,
  error: "",
  storageKey: "backroomsRunner.menu.v1",
  actions: [
    ["forward", "Move Forward", "W"],
    ["backward", "Move Backward", "S"],
    ["left", "Move Left", "A"],
    ["right", "Move Right", "D"],
    ["sprint", "Sprint", "SHIFT"],
    ["crouch", "Crouch", "C"],
    ["jump", "Jump", "SPACE"],
    ["flashlight", "Flashlight", "F"],
    ["inventory", "Inventory", "I"],
    ["drink", "Drink Almond Water", "Q"],
    ["use", "Pick Up / Use", "E"],
    ["nearestExit", "Nearest Exit", "N"],
    ["regenerate", "New Layout", "G"],
    ["respawn", "Checkpoint Respawn", "R"]
  ],
  mainItems: ["play", "settings", "controls", "credits"],

  init() {
    this.root = document.getElementById("main-menu-root");
    if (!this.root) return;
    this.loadSettings();
    this.render();
    this.showMain();
  },

  loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || "null");
      if (!saved) return;
      if (saved.audio) {
        if (Number.isFinite(saved.audio.master)) CONFIG.audio.master = saved.audio.master;
        if (Number.isFinite(saved.audio.ambient)) CONFIG.audio.ambient = saved.audio.ambient;
        if (Number.isFinite(saved.audio.footsteps)) CONFIG.audio.footsteps = saved.audio.footsteps;
        if (Number.isFinite(saved.audio.events)) CONFIG.audio.events = saved.audio.events;
      }
      if (Number.isFinite(saved.lookSens)) CONFIG.lookSens = saved.lookSens;
      if (saved.keys && typeof saved.keys === "object") {
        for (const [name] of this.actions) {
          if (typeof saved.keys[name] === "string" && saved.keys[name]) CONFIG.keys[name] = saved.keys[name];
        }
      }
    } catch (_) {}
  },

  saveSettings() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        audio: CONFIG.audio,
        lookSens: CONFIG.lookSens,
        keys: CONFIG.keys
      }));
    } catch (_) {}
  },

  isMainOpen() {
    return !!(this.root && this.root.style.display !== "none" && this.screen === "main");
  },

  hide() {
    if (!this.root) return;
    this.rebinding = null;
    this.root.style.display = "none";
    this.root.setAttribute("aria-hidden", "true");
  },

  showMain() {
    if (!this.root) return;
    this.screen = "main";
    this.selected = 0;
    this.rebinding = null;
    this.error = "";
    this.root.style.display = "flex";
    this.root.setAttribute("aria-hidden", "false");
    this.render();
    this.focusSelected();
  },

  show(screen) {
    if (!this.root) return;
    this.screen = screen;
    this.selected = 0;
    this.rebinding = null;
    this.error = "";
    this.root.style.display = "flex";
    this.root.setAttribute("aria-hidden", "false");
    this.render();
    this.focusSelected();
  },

  activateSelected() {
    if (this.screen === "main") {
      const item = this.mainItems[this.selected];
      if (item === "play") return this.startGame();
      return this.show(item);
    }
    if (this.screen === "settings") {
      const el = this.root.querySelector("[data-menu-back]");
      if (el) this.showMain();
    } else if (this.screen === "controls") {
      const buttons = [...this.root.querySelectorAll("[data-control-index]")];
      const target = buttons[this.selected];
      if (target) this.beginRebind(target.dataset.controlIndex);
      else this.showMain();
    } else if (this.screen === "credits") {
      this.showMain();
    }
  },

  startGame() {
    if (typeof Game !== "undefined" && GameState.ready) Game.start();
  },

  focusSelected() {
    requestAnimationFrame(() => {
      const list = this.screen === "main"
        ? [...this.root.querySelectorAll("[data-main-index]")]
        : this.screen === "controls"
          ? [...this.root.querySelectorAll("[data-control-index]")]
          : [];
      if (list[this.selected]) list[this.selected].focus();
    });
  },

  handleKeydown(e) {
    if (!this.root || this.root.style.display === "none") return false;

    // Rebinding gets first priority. This prevents the key being assigned from
    // also activating a game action such as G (new layout).
    if (this.rebinding !== null) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return true;
      if (e.code === "Escape") {
        this.rebinding = null;
        this.error = "";
        this.render();
        this.focusSelected();
        return true;
      }
      if (e.code === "Backspace" || e.code === "Delete") {
        CONFIG.keys[this.rebinding] = "";
        this.rebinding = null;
        this.error = "UNBOUND — SELECT A CONTROL TO BIND IT AGAIN.";
        this.saveSettings();
        this.render();
        this.focusSelected();
        return true;
      }
      const conflict = this.findConflict(e.code, this.rebinding);
      if (conflict) {
        this.error = `KEY ${this.displayKey(e.code)} IS ALREADY BOUND TO ${this.actionLabel(conflict).toUpperCase()}. UNBIND THAT CONTROL FIRST.`;
        this.render();
        this.focusSelected();
        return true;
      }
      CONFIG.keys[this.rebinding] = e.code;
      this.rebinding = null;
      this.error = "SAVED.";
      this.saveSettings();
      this.render();
      this.focusSelected();
      return true;
    }

    if (this.screen === "main") {
      if (e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); e.stopImmediatePropagation(); this.selected = (this.selected + this.mainItems.length - 1) % this.mainItems.length; this.render(); this.focusSelected(); return true; }
      if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); e.stopImmediatePropagation(); this.selected = (this.selected + 1) % this.mainItems.length; this.render(); this.focusSelected(); return true; }
      if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); this.activateSelected(); return true; }
      return false;
    }

    if (e.code === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.showMain();
      return true;
    }

    if (this.screen === "controls") {
      const count = this.actions.length + 1;
      if (e.code === "ArrowUp" || e.code === "KeyW") { e.preventDefault(); e.stopImmediatePropagation(); this.selected = (this.selected + count - 1) % count; this.render(); this.focusSelected(); return true; }
      if (e.code === "ArrowDown" || e.code === "KeyS") { e.preventDefault(); e.stopImmediatePropagation(); this.selected = (this.selected + 1) % count; this.render(); this.focusSelected(); return true; }
      if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); e.stopImmediatePropagation(); this.activateSelected(); return true; }
    } else if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault(); e.stopImmediatePropagation(); this.activateSelected(); return true;
    }
    return false;
  },

  beginRebind(index) {
    const row = this.actions[Number(index)];
    if (!row) return;
    this.rebinding = row[0];
    this.error = "PRESS A KEY · BACKSPACE/DELETE TO UNBIND · ESC TO CANCEL";
    this.render();
  },

  findConflict(code, except) {
    for (const [name] of this.actions) {
      if (name !== except && CONFIG.keys[name] === code) return name;
    }
    if (code === "F3") return "Debug Visualization";
    return null;
  },

  actionLabel(name) {
    const row = this.actions.find(x => x[0] === name);
    return row ? row[1] : name;
  },

  displayKey(code) {
    if (!code) return "UNBOUND";
    const aliases = {
      Space: "SPACE", ShiftLeft: "SHIFT", ShiftRight: "SHIFT",
      ControlLeft: "CTRL", ControlRight: "CTRL", AltLeft: "ALT", AltRight: "ALT",
      Enter: "ENTER", Escape: "ESC", Tab: "TAB", Backspace: "BACKSPACE", Delete: "DELETE",
      ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      CapsLock: "CAPS LOCK", PageUp: "PAGE UP", PageDown: "PAGE DOWN",
      Home: "HOME", End: "END", Insert: "INSERT"
    };
    if (aliases[code]) return aliases[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return code.replace("Numpad", "NUM ");
    if (/^F\d+$/.test(code)) return code.toUpperCase();
    return code.replace(/^.+/, x => x.toUpperCase());
  },

  render() {
    if (!this.root) return;
    if (this.screen === "main") this.renderMain();
    else if (this.screen === "settings") this.renderSettings();
    else if (this.screen === "controls") this.renderControls();
    else this.renderCredits();
  },

  shell(title, subtitle, body) {
    this.root.innerHTML = `<div class="menu-backdrop"><div class="game-menu"><div class="menu-eyebrow">BACKROOMS RUNNER</div><h1>${title}</h1><div class="menu-subtitle">${subtitle}</div>${body}</div></div>`;
  },

  renderMain() {
    const labels = { play: "PLAY", settings: "SETTINGS", controls: "CONTROLS", credits: "CREDITS" };
    const buttons = this.mainItems.map((item, i) => `<button class="menu-option ${i === this.selected ? "selected" : ""}" data-main-index="${i}" type="button"><span class="menu-caret">${i === this.selected ? "▶" : ""}</span><span>${labels[item]}</span></button>`).join("");
    this.shell("THE BACKROOMS", "LEVEL 0 · FIND THE EXIT", `<div class="menu-options">${buttons}</div><div class="menu-footer">↑↓ SELECT · ENTER CONFIRM</div>`);
    this.root.querySelectorAll("[data-main-index]").forEach(btn => btn.addEventListener("click", () => { this.selected = Number(btn.dataset.mainIndex); this.activateSelected(); }));
  },

  renderSettings() {
    const a = CONFIG.audio;
    const slider = (id, label, value, step) => `<label class="setting-row"><span>${label}</span><input id="${id}" type="range" min="0" max="1" step="${step}" value="${value}"><output id="${id}-out">${Math.round(value * 100)}%</output></label>`;
    this.shell("SETTINGS", "CONFIGURE YOUR RUN", `<div class="settings-list">${slider("menu-master", "MASTER VOLUME", a.master, .01)}${slider("menu-ambient", "AMBIENT", a.ambient, .001)}${slider("menu-footsteps", "FOOTSTEPS", a.footsteps, .01)}${slider("menu-events", "EVENTS", a.events, .01)}${slider("menu-sens", "MOUSE SENSITIVITY", Math.max(.0005, Math.min(.006, CONFIG.lookSens)), .00005)}<div class="setting-row"><span>GAME MODE</span><span class="locked-value">NORMAL <b>UNLOCKED</b></span></div><div class="setting-row locked"><span>NIGHTMARE</span><span>🔒 LOCKED</span></div><div class="setting-row locked"><span>ENDLESS</span><span>🔒 LOCKED</span></div><button class="menu-option secondary" data-fullscreen type="button"><span>FULLSCREEN</span><span>${document.fullscreenElement ? "ON" : "OFF"}</span></button></div><div class="menu-message">${this.error || "SETTINGS AUTOSAVE TO THIS BROWSER."}</div><button class="menu-option back-option" data-menu-back type="button">← BACK</button>`);
    const set = (id, key, scale=1) => { const el=this.root.querySelector('#'+id); const out=this.root.querySelector('#'+id+'-out'); if(!el)return; el.addEventListener('input',()=>{ const v=Number(el.value)*scale; if(key==='lookSens') CONFIG.lookSens=v; else CONFIG.audio[key]=v; if(AudioSystem.master && AudioSystem.master.gain) AudioSystem.master.gain.value=CONFIG.audio.master; const busMap={ambient:'ambient',footsteps:'footsteps',events:'events'}; if(busMap[key] && AudioSystem.buses[busMap[key]]) AudioSystem.buses[busMap[key]].gain.value=v; if(out) out.textContent=Math.round(Number(el.value)*100)+'%'; this.saveSettings(); }); };
    set('menu-master','master'); set('menu-ambient','ambient'); set('menu-footsteps','footsteps'); set('menu-events','events');
    const sens=this.root.querySelector('#menu-sens'); if(sens) sens.addEventListener('input',()=>{ CONFIG.lookSens=Number(sens.value); this.saveSettings(); });
    this.root.querySelector('[data-fullscreen]').addEventListener('click',async()=>{ try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch(_) {} this.render(); });
    this.root.querySelector('[data-menu-back]').addEventListener('click',()=>this.showMain());
  },

  renderControls() {
    const rows=this.actions.map((row,i)=>`<button class="control-row ${this.rebinding===row[0]?"rebinding":""}" data-control-index="${i}" type="button"><span class="control-action">${row[1]}</span><kbd>${this.rebinding===row[0]?"PRESS KEY":this.displayKey(CONFIG.keys[row[0]])}</kbd></button>`).join("");
    const backIndex=this.actions.length;
    this.shell("CONTROLS", "CLICK A KEY TO REBIND IT", `<div class="controls-list">${rows}</div><div class="menu-message ${this.error && !/^SAVED/.test(this.error) ? "error" : ""}">${this.error || "Keys are saved automatically. Conflicts must be resolved before a key can be used twice."}</div><button class="menu-option back-option ${this.selected===backIndex?"selected":""}" data-control-index="${backIndex}" type="button">← BACK</button><div class="menu-footer">BACKSPACE / DELETE UNBINDS · ESC CANCELS</div>`);
    this.root.querySelectorAll("[data-control-index]").forEach(btn=>btn.addEventListener('click',()=>{ const i=Number(btn.dataset.controlIndex); this.selected=i; if(i===backIndex)this.showMain(); else this.beginRebind(i); }));
  },

  renderCredits() {
    this.shell("CREDITS", "BACKROOMS RUNNER", `<div class="credits-card"><p>A procedural first-person Backrooms exploration game.</p><p>Built with Three.js and browser technologies.</p><p class="muted">Explore. Survive. Find the exit.</p></div><button class="menu-option back-option" data-menu-back type="button">← BACK</button>`);
    this.root.querySelector('[data-menu-back]').addEventListener('click',()=>this.showMain());
  }
};

window.addEventListener("load", () => MenuSystem.init());
document.addEventListener("fullscreenchange", () => { if (MenuSystem.screen === "settings" && MenuSystem.root && MenuSystem.root.style.display !== "none") MenuSystem.render(); });
