// The small edits to shared files that keep input, movement and the world loop correct while a panel is open.
const fs = require("fs");
const { assert, pass, ROOT } = require("./harness.js");
const rd = (f) => fs.readFileSync(ROOT + f, "utf8");
const core = rd("js/core.js"), player = rd("js/systems/player.js"), game = rd("js/game.js"), l0 = rd("js/levels/level0.js");

assert(/function isActivityPanelOpen\(\)/.test(core), "core defines isActivityPanelOpen");
assert((core.match(/isActivityPanelOpen\(\)\) \{/g) || []).length === 2, "both keydown and keyup ignore game bindings while the panel is open");
assert(/ActivitySystem\.tryUse\(\)\) return;\s*\n\s*if \(typeof Level2/.test(core), "E reaches the Activity System first in the existing use chain");
assert(/ActivitySystem\.tryUse\(\)\)\) PickupSystem\.tryPickup\(\)/.test(core), "the mobile Use button reaches it too");
pass("core.js: game keys ignored while a panel is open; E and mobile Use routed to the Activity System before pickups");

assert(/const panel = typeof ActivitySystem !== "undefined" && ActivitySystem\.interfaceOpen;/.test(player), "player has a panel lock");
assert(/!panel && isActionDown\("crouch"\)/.test(player) && /!panel && isActionDown\("sprint"\)/.test(player) && /!panel && isActionDown\("jump"\)/.test(player), "crouch/sprint/jump are ignored while the panel is open");
assert(/if \(panel\) \{\s*\/\/ no movement input/.test(player), "movement input is zeroed while the panel is open");
assert(!/Physics\.moveAndCollide[^\n]*panel/.test(player), "physics (gravity, collision) is NOT skipped: only input is");
pass("player.js: only movement input is disabled while interacting; gravity and collision keep running");

assert(/\(Input\.locked \|\| \(typeof ActivitySystem !== "undefined" && ActivitySystem\.interfaceOpen\)\)/.test(game), "the running branch of the loop stays active with the mouse released");
assert(/ActivitySystem\.update\(dt\);/.test(game) && /ActivitySystem\.guard\(\)/.test(game), "per-frame update and the close-on-death guard are wired");
const loopOrder = game.indexOf("EncounterManager.update(dt)");
assert(loopOrder > 0 && game.indexOf("Input.locked ||") < loopOrder, "entities, atmosphere and events update inside that same branch");
pass("game.js: world, entities and environmental events keep running while a panel is open");

assert(/Level0Sites\.planWorld\(/.test(l0) && !/hasElevatorHallway/.test(l0) && !/exitCandidates/.test(l0), "the superseded exit selection was replaced, not duplicated");
pass("level0.js: one elevator planner (the old exit-selection code is gone, not kept alongside)");
