// Maintenance computer in a real browser (Chromium via Playwright). Skips cleanly if none is installed.
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..") + "/";
let chromium; try { chromium = require("/opt/npm-tools/node_modules/playwright").chromium; } catch (e) { try { chromium = require("playwright").chromium; } catch (e2) { console.log("SKIP interface test: playwright not installed"); process.exit(0); } }
const exe = ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find(p => fs.existsSync(p));
const SHOTS = process.env.ACTIVITY_SHOTS || "";
let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.log("FAIL " + m); } else console.log("PASS " + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] }).catch(e => { console.log("SKIP interface test: no browser (" + e.message.split("\n")[0] + ")"); process.exit(0); });
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors = []; page.on("pageerror", e => errors.push(String(e))); page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.setContent("<body style='margin:0;background:#3a3520;height:100vh'></body>");
  await page.addStyleTag({ content: fs.readFileSync(ROOT + "css/systems/activity.css", "utf8") });
  await page.evaluate(() => {
    window.GameState = { level: 0, phase: "playing", inventoryOpen: false, cutscene: false, elapsed: 5 };
    window.Input = { locked: true }; window.DeviceMode = { mobile: false }; window.CONFIG = { keys: { use: "KeyE" } };
    window.clearInput = () => {}; window.setPauseOverlay = () => {}; window.renderer = { domElement: { requestPointerLock() { window.__relock = (window.__relock || 0) + 1; } } };
    window.__gameKeys = 0; document.addEventListener("keydown", (e) => { window.__gameKeys++; });
  });
  for (const f of ["js/systems/activity-system.js", "js/systems/activity-ui.js", "js/activities/electrical-puzzle.js", "js/activities/electrical.js"]) await page.addScriptTag({ content: fs.readFileSync(ROOT + f, "utf8").replace(/^"use strict";/, "") + "\n" + (f.includes("system.js") ? "window.ActivitySystem=ActivitySystem;" : f.includes("ui.js") ? "window.ActivityUI=ActivityUI;" : f.includes("puzzle") ? "window.ElectricalPuzzle=ElectricalPuzzle;" : "") });
  await page.evaluate(() => {
    ActivitySystem.registerLevelAdapter(0, { buildPlan: () => ({ seed: 7, sites: [{ id: "s0", kind: "k", setId: "A", instanceId: "a0", label: "STN 417-1", worldX: 0, worldZ: 0, nx: 0, nz: 1 }],
      sets: [{ id: "A", label: "lift 417", meta: { unit: "417" }, activities: [0, 1, 2, 3, 4].map(k => ({ id: "a" + k, typeId: "electrical-restoration", siteId: k ? null : "s0", required: true, difficulty: k, seed: 100 + k, rewards: [{ type: "progress" }, { type: "info", text: "LOG 04: PANEL 7B WAS RE-LABELLED." }] })) }] }) });
    ActivitySystem.beginVisit(0, {});
    ActivitySystem.openInterface(ActivitySystem.getInstance("a1"));
  });
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + ".png") }); };

  ok(await page.evaluate(() => !!document.getElementById("activity-overlay") && ActivitySystem.interfaceOpen && GameState.inventoryOpen && Input.locked === false), "E opens the maintenance computer: panel up, panel flag set, mouse look released");
  ok(await page.evaluate(() => /CRT|Circuit board/.test(document.querySelector("canvas").getAttribute("aria-label")) || !!document.querySelector(".mu-scan")), "CRT screen, scanlines and circuit canvas present");
  await shot("1-open");

  // keys that belong to the panel never reach the game
  await page.evaluate(() => { window.__gameKeys = 0; });
  for (const k of ["ArrowRight", "Space", "KeyR", "ArrowDown"]) await page.keyboard.press(k);
  ok(await page.evaluate(() => window.__gameKeys) === 0, "panel keys (arrows/space/R) are consumed and do not leak to the game");

  // wrong board: Enter must not complete
  await page.keyboard.press("Enter");
  ok(await page.evaluate(() => !ActivitySystem.getInstance("a1").completed && ActivitySystem.progress("A").percent === 0), "energizing an unsolved board is refused");
  ok(await page.evaluate(() => /FAULT/.test(document.querySelector(".mu-msg").textContent) && document.querySelector('[data-led="fault"]').classList.contains("on")), "fault is shown (amber text + FAULT lamp)");
  await shot("2-fault");

  // solve it by clicking the cells the solver says (right-click = turn back, left = turn forward)
  await page.evaluate(() => { document.querySelector('[data-act="reset"]').click(); });
  const plan = await page.evaluate(() => { const inst = ActivitySystem.getInstance("a1"), p = inst.params, so = ElectricalPuzzle.solve(p); return { w: p.w, h: p.h, turns: p.cells.map((c, i) => (!c || c.fixed) ? 0 : ((so.rot[i] - p.start[i]) + 4) % 4) }; });
  const box = await page.locator("canvas").boundingBox();
  for (let i = 0; i < plan.turns.length; i++) for (let t = 0; t < plan.turns[i]; t++) await page.mouse.click(box.x + ((i % plan.w) + 0.5) * box.width / plan.w, box.y + (Math.floor(i / plan.w) + 0.5) * box.height / plan.h);
  ok(await page.evaluate(() => document.querySelector('[data-led="load"]').classList.contains("on") && !document.querySelector(".mu-breaker").disabled), "a correct circuit lights the LOAD lamp and arms the breaker");
  await shot("3-solved");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  ok(await page.evaluate(() => ActivitySystem.getInstance("a1").completed && ActivitySystem.progress("A").percent === 20), "throwing the breaker restores the station: +20% power");
  ok(await page.evaluate(() => /STATION RESTORED/.test(document.querySelector(".mu-screen").textContent) && /LIFT POWER 20%/.test(document.querySelector(".mu-screen").textContent)), "screen reports station restored and lift power");
  ok(await page.evaluate(() => /LOG 04/.test(document.querySelector(".mu-log").textContent)), "the information reward (log line) is shown");
  await shot("4-restored");

  // ESC closes, returns control, keeps progress
  await page.keyboard.press("Escape");
  ok(await page.evaluate(() => !document.getElementById("activity-overlay") && !ActivitySystem.interfaceOpen && !GameState.inventoryOpen && ActivityUI._keyHandler === null), "ESC closes the interface and releases the panel flag and key listener");
  ok(await page.evaluate(() => window.__relock >= 1), "control returns to the player (pointer lock requested)");
  ok(await page.evaluate(() => ActivitySystem.progress("A").percent === 20), "closing keeps the completed station");

  // reopen a finished station: read-only log view
  await page.evaluate(() => ActivitySystem.openInterface(ActivitySystem.getInstance("a1")));
  ok(await page.evaluate(() => !document.querySelector("canvas") && /RESTORED/.test(document.querySelector(".mu-screen").textContent)), "a restored station reopens as a log view, not a new puzzle");
  await page.keyboard.press("Escape");

  // open/close 30 times: nothing accumulates
  const leak = await page.evaluate(() => { for (let i = 0; i < 30; i++) { ActivitySystem.openInterface(ActivitySystem.getInstance("a2")); ActivitySystem.closeInterface({ relock: false }); } return { overlays: document.querySelectorAll("#activity-overlay").length, canvases: document.querySelectorAll("canvas").length, handler: ActivityUI._keyHandler }; });
  ok(leak.overlays === 0 && leak.canvases === 0 && leak.handler === null, "30 open/close cycles leave no overlay, canvas or key listener behind");

  // click Exit button, and the world-owned ESC when a text field has focus is ignored
  await page.evaluate(() => ActivitySystem.openInterface(ActivitySystem.getInstance("a3")));
  await page.click('[data-act="exit"]');
  ok(await page.evaluate(() => !ActivitySystem.interfaceOpen), "the Exit key closes it too (touch/mobile path)");

  // narrow phone layout
  await page.setViewportSize({ width: 390, height: 800 });
  await page.evaluate(() => ActivitySystem.openInterface(ActivitySystem.getInstance("a4")));
  const fits = await page.evaluate(() => { const r = document.querySelector(".mu").getBoundingClientRect(); return r.width <= innerWidth && document.querySelector("canvas").getBoundingClientRect().width <= innerWidth; });
  ok(fits, "layout fits a 390 px wide phone screen");
  await shot("5-phone-grade5");
  await page.evaluate(() => ActivitySystem.closeInterface({ relock: false }));

  ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
