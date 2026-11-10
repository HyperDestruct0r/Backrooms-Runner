/* Run with: node tests/transitions/level0-physical-integration.js */
"use strict";
const fs = require("fs");
const assert = require("assert");
const source = fs.readFileSync("js/levels/level0.js", "utf8");
const start = source.indexOf("const go = async () => {", source.indexOf("startSequence(index)"));
const end = source.indexOf("transition.then((succeeded)=>", start);
assert(start >= 0 && end > start, "Level 0 transition callback should exist");
const callback = source.slice(start, end);
assert(callback.includes("await Level1.enter(exitSeed,exitState)"), "destination generation must be awaited");
assert(callback.includes("Player.position.set(exitState.origin.x-0.95*exitState.fx"), "destination spawn must be set inside the callback");
assert(callback.includes("Player.yaw=Math.atan2(-exitState.fx,-exitState.fz)"), "destination facing must be set before cabin placement");
const transitionCall = source.slice(end, source.indexOf("transition.then((succeeded)=>", end) + 30);
assert(/from:\s*0,\s*to:\s*1,\s*physical:\s*true/.test(source.slice(start - 500, end + 250)), "Level 0 → Level 1 should request the persistent physical cabin");
process.stdout.write("PASS Level 0 destination spawn is established before the persistent cabin opens\n");
