// Runs the Activity System / Level 0 checks. Usage: node tests/activity/run-all.js
// Logic, generation, state and geometry data run headless; 05 drives the real UI in Chromium if available.
// None of this tests rendering performance (no GPU here).
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const checks = fs.readdirSync(__dirname).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
let bad = 0;
for (const f of checks) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8", cwd: path.resolve(__dirname, "../..") });
  const out = (r.stdout || "") + (r.stderr || "");
  const skipped = /^SKIP/m.test(out);
  const pass = r.status === 0 && !/^FAIL/m.test(out);
  console.log((skipped ? "SKIP  " : pass ? "PASS  " : "FAIL  ") + f + "  (" + ((Date.now() - t) / 1000).toFixed(1) + "s, " + (out.match(/^PASS/gm) || []).length + " checks)");
  if (!pass) { bad++; console.log(out.split("\n").filter(l => /FAIL|Error/.test(l)).slice(0, 6).join("\n")); }
  else for (const l of out.split("\n")) if (/^INFO/.test(l)) console.log("      " + l);
}
console.log(bad ? bad + " check file(s) failed" : "all " + checks.length + " activity check files passed");
process.exit(bad ? 1 : 0);
