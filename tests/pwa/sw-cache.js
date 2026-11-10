// Service-worker cache consistency (static check; no browser): every local script/stylesheet index.html loads is
// precached, every precached file exists, the cache version is a bumped string, and old caches are purged on activate.
// Usage: node tests/pwa/sw-cache.js
"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "../..");
let bad = 0; const pass = (m) => console.log("PASS " + m), fail = (m) => { bad++; console.log("FAIL " + m); };
const sw = fs.readFileSync(path.join(root, "service-worker.js"), "utf8"), html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const shell = [...sw.matchAll(/^\s*"\.\/([^"]+)"/gm)].map(m => m[1]);
const local = (u) => u && !/^(https?:)?\/\//.test(u) && !u.startsWith("data:");
const used = [...html.matchAll(/<script[^>]+src="([^"]+)"/g), ...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(m => m[1].split("?")[0]).filter(local);
const missingFromShell = used.filter(u => !shell.includes(u.replace(/^\.\//, "")));
(missingFromShell.length ? fail : pass)("every local script/style in index.html is precached" + (missingFromShell.length ? ": " + missingFromShell.join(", ") : " (" + used.length + " files)"));
const missingOnDisk = shell.filter(f => !fs.existsSync(path.join(root, f)));
(missingOnDisk.length ? fail : pass)("every precached file exists" + (missingOnDisk.length ? ": " + missingOnDisk.join(", ") : " (" + shell.length + " files)"));
const dup = shell.filter((f, i) => shell.indexOf(f) !== i);
(dup.length ? fail : pass)("no duplicate cache entries" + (dup.length ? ": " + dup.join(", ") : ""));
const jsOnDisk = []; (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", "tests", "ts", "supabase"].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) jsOnDisk.push(path.relative(root, p).replace(/\\/g, "/")); } })(root);
const unreferenced = jsOnDisk.filter(f => f !== "run-all.js" && f !== "service-worker.js" && !shell.includes(f));
(unreferenced.length ? fail : pass)("every shipped .js file is precached" + (unreferenced.length ? ": " + unreferenced.join(", ") : ""));
const ver = (sw.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
(ver && /v\d+$/.test(ver) ? pass : fail)("cache version present (" + ver + ")");
(/caches\.keys\(\)/.test(sw) && /caches\.delete\(/.test(sw) && /activate/.test(sw) ? pass : fail)("activate handler deletes caches from older versions");
(/skipWaiting|clients\.claim/.test(sw) ? pass : fail)("new worker takes over (skipWaiting/clients.claim)");
// script order: world before level0; quality before game; core before levels
const order = used.filter(u => /\.js$/.test(u)), idx = (n) => order.indexOf(n);
(idx("js/levels/level0-world.js") >= 0 && idx("js/levels/level0-world.js") < idx("js/levels/level0.js") ? pass : fail)("level0-world.js loads before level0.js");
(idx("js/systems/quality.js") >= 0 && idx("js/systems/quality.js") < idx("js/game.js") ? pass : fail)("quality.js loads before game.js");
(idx("js/core.js") < idx("js/levels/level0.js") ? pass : fail)("core.js loads before the levels");
console.log(bad ? bad + " FAILED" : "all service-worker checks passed"); process.exit(bad ? 1 : 0);
