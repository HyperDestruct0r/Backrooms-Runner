// Runs the Level 9 headless checks. Usage: node tests/level9/run-all.js
// There is no GPU or three.js here: THREE is a small stub (see harness.js), so these test logic, streaming, physics,
// persistence and entity behaviour. They do NOT test how anything looks or how fast it renders in a browser.
const { spawnSync } = require("child_process"), fs = require("fs"), path = require("path");
const checks = fs.readdirSync(__dirname).filter(f => /^\d\d-.*\.js$/.test(f) && !/profile|step-cost|plan-cost|query-cost/.test(f)).sort();
let bad = 0;
for (const f of checks) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const pass = r.status === 0 && !/\bFAIL\b|FAILS|Error/.test(out);
  console.log((pass ? "PASS  " : "FAIL  ") + f);
  if (!pass) { bad++; console.log(out.split("\n").filter(l => /FAIL|Error/.test(l)).slice(0, 6).join("\n")); }
}
console.log(bad ? bad + " check(s) failed" : "all " + checks.length + " checks passed");
process.exit(bad ? 1 : 0);
