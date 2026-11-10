"use strict";

/* ------------------------------------------------------------------
   ACTIVITY TYPE: electrical-restoration
   Reroute power through a damaged circuit board by rotating pieces until
   every load lamp is fed from the source, then throw the ENERGIZE breaker.
   Puzzle rules and generation: electrical-puzzle.js. This file is the
   registration plus the screen that draws inside the maintenance computer.
   ------------------------------------------------------------------ */
const ElectricalActivity = {
  id: "electrical-restoration",
  title: "Electrical restoration",
  CELL: 76,

  createParams(inst) { return ElectricalPuzzle.generate(inst.seed, inst.difficulty); },
  verify(params, rotations) { return ElectricalPuzzle.verify(params, rotations); },

  ui: {
    mount(screen, host) {
      const P = ElectricalPuzzle, A = ElectricalActivity, inst = host.instance, puzzle = inst.params;
      const done0 = inst.completed;
      const set = host.set, sys = host.system;
      const unit = (set && set.meta && set.meta.unit) || "000";
      const grade = inst.difficulty + 1;
      const head = '<div class="mu-hd"><span>LIFT ' + unit + ' · AUX BUS</span><span>GRADE ' + grade + '/5</span></div>';
      let alive = true, timers = [];
      const later = (fn, ms) => { const t = setTimeout(() => { if (alive) fn(); }, ms); timers.push(t); };
      const beep = (f, d) => { try { if (typeof AudioSystem !== "undefined" && AudioSystem._tone) AudioSystem._tone(f, "square", d || 0.06, 0.02, "events"); } catch (e) { /* audio is optional */ } };

      const finishedView = () => {
        const p = sys.progress(inst.setId);
        const logs = inst.rewardResults.filter(Boolean);
        screen.innerHTML = head +
          '<div class="mu-msg">STATION ' + (inst.completed ? "RESTORED" : "OFFLINE") + '<br>LIFT POWER ' + p.percent + '% (' + p.done + '/' + p.total + ' STATIONS)' + (p.powered ? '<br>ALL STATIONS ONLINE — LIFT READY' : '') + '</div>' +
          (logs.length ? '<div class="mu-log">' + logs.map(l => "&gt; " + String(l).replace(/</g, "&lt;")).join("<br>") + '</div>' : '') +
          '<div class="mu-legend">Esc / Exit to close</div>';
        host.setLed("load", false); host.setLed("fault", false); host.setLed("pwr", true);
        host.setBreaker("thrown"); host.setFault(false);
      };
      if (done0) { finishedView(); return { destroy() { alive = false; } }; }

      screen.innerHTML = head +
        '<div class="mu-canvas-wrap"><canvas tabindex="0" aria-label="Circuit board"></canvas></div>' +
        '<div class="mu-msg"></div>' +
        '<div class="mu-legend">Click/Space rotate · Right-click/Q back · Arrows move · Enter energize</div>';
      const cv = screen.querySelector("canvas"), msg = screen.querySelector(".mu-msg");
      const S = A.CELL, dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
      cv.width = puzzle.w * S * dpr; cv.height = puzzle.h * S * dpr;
      cv.style.width = puzzle.w * S + "px"; cv.style.height = puzzle.h * S + "px";
      const g = cv.getContext("2d");

      const rot = puzzle.start.slice();
      let cur = puzzle.source, moves = 0, flash = 0, lastEval = null;

      const setMsg = (t, bad) => { msg.textContent = t; msg.classList.toggle("bad", !!bad); };
      const status = () => {
        const ev = lastEval = P.evaluate(puzzle, rot);
        host.setLed("load", ev.solved, false);
        host.setBreaker(ev.solved ? "armed" : "off");
        return ev;
      };

      function draw() {
        const ev = lastEval || status();
        const col = (a) => "rgba(125,255,138," + a + ")";
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, puzzle.w * S, puzzle.h * S);
        g.lineCap = "round";
        // board grid
        g.strokeStyle = col(0.10); g.lineWidth = 1;
        for (let x = 0; x <= puzzle.w; x++) { g.beginPath(); g.moveTo(x * S + .5, 0); g.lineTo(x * S + .5, puzzle.h * S); g.stroke(); }
        for (let z = 0; z <= puzzle.h; z++) { g.beginPath(); g.moveTo(0, z * S + .5); g.lineTo(puzzle.w * S, z * S + .5); g.stroke(); }
        for (let i = 0; i < puzzle.cells.length; i++) {
          const c = puzzle.cells[i], x = (i % puzzle.w) * S, z = ((i / puzzle.w) | 0) * S, cx = x + S / 2, cz = z + S / 2;
          if (!c) { g.fillStyle = col(0.18); for (const [ox, oz] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8]]) g.fillRect(x + ox - 1, z + oz - 1, 2, 2); continue; }
          if (c.kind === "block") {
            g.strokeStyle = "rgba(255,176,0,.55)"; g.lineWidth = 2;
            g.strokeRect(x + 14, z + 14, S - 28, S - 28);
            g.beginPath(); g.moveTo(x + 14, z + 14); g.lineTo(x + S - 14, z + S - 14); g.moveTo(x + S - 14, z + 14); g.lineTo(x + 14, z + S - 14); g.stroke();
            continue;
          }
          const on = ev.powered[i] === 1, m = P.maskOf(c, rot[i]);
          g.shadowColor = on ? "rgba(90,255,120,.9)" : "transparent"; g.shadowBlur = on ? 9 : 0;
          g.strokeStyle = on ? "#9dffa6" : "rgba(80,170,92,.55)"; g.lineWidth = 6;
          for (let d = 0; d < 4; d++) {
            if (!(m & (1 << d))) continue;
            g.beginPath(); g.moveTo(cx, cz); g.lineTo(cx + P.DX[d] * S / 2, cz + P.DZ[d] * S / 2); g.stroke();
          }
          g.shadowBlur = 0;
          if (c.role === "source") {
            g.fillStyle = "#031307"; g.fillRect(cx - 17, cz - 17, 34, 34);
            g.strokeStyle = "#9dffa6"; g.lineWidth = 2; g.strokeRect(cx - 17, cz - 17, 34, 34);
            g.fillStyle = "#9dffa6"; g.font = "bold 12px 'Courier New',monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("SRC", cx, cz);
          } else if (c.role === "load") {
            const li = puzzle.loads.indexOf(i) + 1;
            g.beginPath(); g.arc(cx, cz, 16, 0, 7); g.fillStyle = on ? "#c9ffcf" : "#031307"; g.fill();
            g.strokeStyle = on ? "#ffffff" : "rgba(125,255,138,.7)"; g.lineWidth = 2; g.stroke();
            g.fillStyle = on ? "#0a3014" : "#7dff8a"; g.font = "bold 11px 'Courier New',monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("L" + li, cx, cz + 1);
          } else {
            g.beginPath(); g.arc(cx, cz, c.kind === "end" ? 6 : 5, 0, 7); g.fillStyle = on ? "#c9ffcf" : "rgba(80,170,92,.8)"; g.fill();
            if (c.fixed) { g.fillStyle = "rgba(255,176,0,.85)"; g.fillRect(x + S - 13, z + 6, 7, 7); }   // bolted: cannot rotate
          }
        }
        // cursor
        const cxp = (cur % puzzle.w) * S, czp = ((cur / puzzle.w) | 0) * S, k = 14;
        g.strokeStyle = "#ffb020"; g.lineWidth = 2; g.shadowColor = "rgba(255,176,0,.7)"; g.shadowBlur = 6;
        for (const [ax, az, sx, sz] of [[cxp + 3, czp + 3, 1, 1], [cxp + S - 3, czp + 3, -1, 1], [cxp + 3, czp + S - 3, 1, -1], [cxp + S - 3, czp + S - 3, -1, -1]]) {
          g.beginPath(); g.moveTo(ax, az + sz * k); g.lineTo(ax, az); g.lineTo(ax + sx * k, az); g.stroke();
        }
        g.shadowBlur = 0;
        if (flash > 0) { g.fillStyle = "rgba(255,120,20," + (0.18 * flash) + ")"; g.fillRect(0, 0, puzzle.w * S, puzzle.h * S); }
      }

      function rotateAt(i, dir) {
        const c = puzzle.cells[i];
        if (!c || c.kind === "block") return;
        if (c.fixed) { setMsg("PIECE BOLTED IN PLACE", true); beep(140, 0.05); return; }
        rot[i] = (rot[i] + (dir < 0 ? 3 : 1)) & 3; moves++;
        beep(420 + (moves % 3) * 40, 0.03);
        const ev = status();
        setMsg(ev.solved ? "CIRCUIT CLOSED — LOADS " + ev.litLoads + "/" + ev.totalLoads + " — THROW BREAKER" : "LOADS SUPPLIED " + ev.litLoads + "/" + ev.totalLoads, false);
        draw();
      }

      const ctrl = {
        reset() {
          for (let i = 0; i < rot.length; i++) rot[i] = puzzle.start[i];
          moves = 0; status(); host.setLed("fault", false); host.setFault(false);
          setMsg("BOARD RESET — LOADS SUPPLIED " + lastEval.litLoads + "/" + lastEval.totalLoads, false); draw();
        },
        energize() {
          const ev = status();
          if (!ev.solved) {
            host.setLed("fault", true, true); host.setFault(true); host.shake(); beep(110, 0.18);
            setMsg("FAULT: LOAD NOT SUPPLIED (" + ev.litLoads + "/" + ev.totalLoads + ") — BREAKER WILL NOT HOLD", true);
            flash = 1; draw(); later(() => { flash = 0; host.setLed("fault", false); host.setFault(false); draw(); }, 700);
            return false;
          }
          const res = host.submit(rot.slice());
          if (!res.ok) { setMsg("FAULT: BOARD REJECTED", true); host.setLed("fault", true, true); return false; }
          host.setBreaker("thrown"); beep(220, 0.12); later(() => beep(330, 0.12), 120);
          later(finishedView, 450);
          return true;
        },
        onKey(e) {
          const W = puzzle.w, H = puzzle.h, x = cur % W, z = (cur / W) | 0;
          switch (e.code) {
            case "ArrowLeft": cur = z * W + Math.max(0, x - 1); break;
            case "ArrowRight": cur = z * W + Math.min(W - 1, x + 1); break;
            case "ArrowUp": cur = Math.max(0, z - 1) * W + x; break;
            case "ArrowDown": cur = Math.min(H - 1, z + 1) * W + x; break;
            case "Space": case "KeyR": rotateAt(cur, 1); return true;
            case "KeyQ": case "Backspace": rotateAt(cur, -1); return true;
            case "Enter": case "NumpadEnter": ctrl.energize(); return true;
            default: return false;
          }
          draw(); return true;
        },
        focus() { try { cv.focus({ preventScroll: true }); } catch (e) { /* ignore */ } },
        destroy() { alive = false; timers.forEach(clearTimeout); timers = []; }
      };

      const cellAt = (e) => {
        const r = cv.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * puzzle.w), z = Math.floor((e.clientY - r.top) / r.height * puzzle.h);
        return (x < 0 || z < 0 || x >= puzzle.w || z >= puzzle.h) ? -1 : z * puzzle.w + x;
      };
      cv.addEventListener("pointerdown", (e) => {
        const i = cellAt(e); if (i < 0) return;
        e.preventDefault(); cur = i; rotateAt(i, e.button === 2 ? -1 : 1);
      });
      cv.addEventListener("contextmenu", (e) => e.preventDefault());

      host.setLed("pwr", true); host.setLed("fault", false);
      const ev0 = status();
      setMsg("DIAGNOSTIC: " + ev0.totalLoads + " LOAD" + (ev0.totalLoads > 1 ? "S" : "") + " UNSUPPLIED — REROUTE SOURCE", false);
      draw();
      return ctrl;
    }
  }
};

if (typeof ActivitySystem !== "undefined" && typeof ElectricalPuzzle !== "undefined") ActivitySystem.registerType(ElectricalActivity);
if (typeof module !== "undefined" && module.exports) module.exports = { ElectricalActivity };
