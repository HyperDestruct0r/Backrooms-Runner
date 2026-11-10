# Backrooms Runner

**Backrooms Runner** is a browser-based first-person exploration game inspired by the Backrooms. Explore procedurally generated environments, manage your resources, and find your way onward.

**Play:** https://hyperdestruct0r.github.io/Backrooms-Runner/

## Current Features

* First-person 3D gameplay powered by **Three.js**
* Several distinct levels, each generated from a seed
* Streaming environments that build as you explore
* Flashlight, sprint, crouch, and jump
* Inventory and consumable items
* Dynamic lighting and atmospheric effects
* A heads-up display

## Gameplay

> **Find a way through.**

The layout is generated for each run. You cannot rely on a fixed map. What a level contains, and how you leave it, is for you to find.

## Levels

* **Level 0** — yellow rooms, fluorescent lights, repeating corridors
* **Level 1** — a much larger concrete and service space
* **Level 2** — "Pipe Dreams": dim, narrow concrete maintenance tunnels with hot pipes, metal shelves, flickering fluorescents and unmarked doors out (to Levels 0, 1 and 3)
* **Level 3** — "Electrical Station": claustrophobic yellow-brick tunnels, iron doors (openable ones, and locked ones that only show a black void), leaking and scalding pipes, hidden electrical rooms with generators, breaker boxes and old monitors, machinery that arcs when you pass, and an elevator to Level 4 that needs power first
* **Level 5** — "The Hotel": a kept 1930s hotel of patterned carpet, dark wood and warm low light. A lobby that is a reception (desk, key rack, sign), long numbered halls, a few guest rooms and dead ends, and off the halls a ballroom with double doors and a dining room with a kitchen behind it. The lobby has no door back: the way back to the office is a door further in, the way on is at the far end
* **Level 8** — "The Cave System": an endless cave of rocky chambers joined by short crooked passages, streamed in as you walk and dropped behind you. The arrival door is sealed; the way back to Level 6 is a few chambers in. Real exits are rare holes or narrow shafts in a chamber floor, roughly one per 400 m grid point the seed picks (never within 500 m of the start, at least one in every 1000 m square). Dropping through one leads down to Level 9
* **Level 9** — "The Suburbs": an endless suburban neighbourhood at midnight, streamed in by block as you walk. Dark, muted colours, thick grey-green fog, a few warm windows and orange streetlights (some flicker, some are dead). Houses are real places: every front door swings, about a third are unlocked, and an open door builds the house behind it (two rooms down, a landing and one room up). Almond water is rare (a fridge, now and then). The flashlight works at half range and half strength. Hounds keep away from you unless chased for a long time; Smilers come out of the dark; the Mangled lurks in the dark and gets commoner the farther you go (nothing within 500 m); the Watch observes from a distance. The way back to Level 8 is a hole in a vacant lot about 200 m out. A worn path into a field leads to Level 10. The Level 11 exit is 2000 m or more out, at the end of a road with growing arrow signs. Walking into the field break enters Level 10; Level 11 is not built yet, so reaching it ends the run for now
* **Level 10** — "The Field": an endless wheat field under a grey overcast sky, streamed in as you walk. The wheat is taller than your eyes and shorter than the top of a jump, so it blocks the view. Plots are split by low hedges and some fences; a dirt path is rare. You walk in from Level 9 through a thick ring of wheat: the sky and fog lighten from Level 9's night as you leave the ring, and walking back before about 150 m returns you to Level 9. Past 150 m the ring is gone and there is no way back. Empty barns and sheds with hay, and still lakes, are rare; almond water is only in a barn. The way on is a barn far out. Level 11 is not built yet, so reaching it ends the run for now

Each level is meant to feel different. The same seed produces the same layout.

## Procedural Generation

The world is not one stored map. It is generated as you move, so a run can be larger than a hand-built level while only keeping the nearby part loaded. Generation is deterministic: the same seed and coordinates reproduce the same place.

## Technology

* **HTML**
* **CSS**
* **JavaScript**
* **Three.js**

The project uses classic multi-file JavaScript rather than ES modules, so the existing browser setup stays intact.

## Running the Game

The easiest way to play is through GitHub Pages:

**https://hyperdestruct0r.github.io/Backrooms-Runner/**

To run it locally, clone the repository and open `index.html` in a modern browser. Three.js loads from jsDelivr, so the first visit needs a connection unless that library is hosted locally.

## Seed selection

The Play menu offers a generated seed and a custom seed.

- A generated seed is chosen when you start that run.
- A custom seed is an unsigned 32-bit integer and starts Level 0 from that value.
- If a seed cannot produce a valid map, the run is rejected and you can try another.
- Generation does not run during boot, so a bad seed cannot lock you out of the menu.

`ts/systems/seed.ts` is the typed source for the seed utilities. `js/systems/seed.js` is what the browser runs. `tsconfig.json` is included for checking the TypeScript source.

## Chromebook installation (Progressive Web App)

Backrooms Runner can be installed from Chrome on ChromeOS without Google Play.

1. Publish this folder to the repository's GitHub Pages location.
2. Open the Pages site in Chrome over HTTPS and let the first load finish.
3. Use the install icon in the address bar, or Chrome's menu: **Install Backrooms Runner** or **Save and share → Install page as app**.
4. Launch **Backrooms Runner** from the Chromebook launcher.

The in-game install button appears only when Chrome offers the prompt. The service worker caches the app after that first visit. Offline play works for a guest run. Accounts and anything that talks to a server still need the network.

When you publish a release, bump `CACHE_VERSION` at the top of `service-worker.js` so installed copies pick up the new files.

## Level 0: elevators, maintenance stations and wall markings

Level 0 has five elevators, and every one leads to Level 1. None is usable until its own five electrical maintenance stations have been restored.

* **Elevators.** One primary elevator sits 100-150 m of walking from the start and out of its sight. Four more are placed one per quadrant, each 500-750 m from the start in a straight line and at least 500 m (straight line) from every other elevator. The planner never relaxes these rules: a bad draw is redrawn, and a seed that cannot satisfy them is rejected like any other bad seed. Nothing marks, lights or points to any elevator.
* **Stations.** Each elevator has five wall-mounted maintenance stations within about 150 m of walking. Press **E** at a station to open its terminal, rotate circuit pieces until every load lamp is fed, then throw **ENERGIZE**. Each restored station adds 20% power (five lamps over the doors). At 100%, press **E** at the doors. Completing any one elevator's five stations is enough to leave.
* **The terminal.** A CRT with green phosphor text. **Esc** (or the Exit key) closes it. Movement is disabled while it is open; the world keeps running. Every puzzle has a known solution checked by an independent solver.
* **Reset.** Progress belongs to the current visit to Level 0, survives closing the terminal, walking away, chunks unloading and regions being evicted, and resets when you leave Level 0. Nothing is saved.
* **Wall markings.** Sparse hand-drawn marks generated from the world seed and wall-face identity, so they never change when a chunk reloads.

### Architecture (js/levels/level0-world.js, level0-sites.js, level0.js)
* **Unbounded, deterministic regions.** The map is a lattice of regions, each a pure function of `(seed, rx, rz)`: 48 x 48 cells (6 x 6 tiles of 2 m) = 576 m square, stored as one `Uint8Array`. Neighbouring regions agree on one doorway per shared edge, derived from a hash of the edge, so seams always match and the whole world is connected.
* **Residency.** Only nearby regions are kept (cap `maxRegions`, default 30). A dropped region is rebuilt identically from the seed; tiles that must persist (elevator doors, start tile) are recorded as overrides and re-applied. Regions near elevators and stations are pinned. Rebuild counting uses a capped set, so no history grows with exploration.
* **Region generation** is a generator function. While the player walks, the region ahead is built in 1-2 ms slices per frame (never one 10-50 ms block). A whole-region synchronous build remains only as a fallback if a tile is requested before the slices finish, and the planner builds the ~9 regions around the elevators synchronously while the level loads.
* **Chunks.** Meshes and colliders stream in 24 x 24-tile chunks with a per-frame build budget; walls and light housings are merged per chunk; chunks stay 5 s after leaving view. Leaving Level 0 (`Level.clear`) releases chunks, regions, lights, colliders and planner state.
* **Light pool.** A fixed number of real point lights (24 / 12 / 6) is assigned to the nearest fixtures with hysteresis; the scene's light count never changes, so no shader recompiles while walking. A gain (1.07 / 1.18 / 1.30) compensates for the dropped lights.

### Graphics settings (Settings -> GRAPHICS)
`Auto` (default), `High`, `Medium`, `Low`. Auto picks High on a desktop pointer, Medium on a phone/tablet, Low on a phone reporting <= 3 GB memory or <= 4 cores. A manual choice is saved in `localStorage` (`backroomsRunner.quality.v1`) and is never overwritten by detection.

| | High | Medium | Low |
|---|---|---|---|
| Pooled point lights (gain) | 24 (1.07) | 12 (1.18) | 6 (1.30) |
| Level 0 fog far / near | 175 m / 58 m | 155 m / 52 m | 125 m / 42 m |
| Camera far plane | 180 | 160 | 130 |
| Chunk build budget per frame | 8 ms | 5 ms | 3 ms |
| Render scale (dynamic) | 1.0 fixed | 0.75-1.0 | 0.55-0.85 |

The render-scale governor (Medium/Low only) decides once per second from the average frame time, ignores frames over 250 ms, needs two consecutive slow seconds to step down by 0.1 and six fast seconds to step up by 0.05, and waits two seconds after each change. High never changes resolution.

### Known limits
* Walking distance spawn -> additional elevators is long (742-2712 m in the 24-seed test, median ~1260 m). That follows from the straight-line rules.
* Low and Medium shorten Level 0 fog; this is visible by design.
* Level 0 build is slower than before (~1.2 s headless vs ~0.6 s) because five elevators are planned across ~9 regions.
* Rendering, GPU time, draw calls, thermal behaviour, touch controls and the settings selector's look have **not** been verified in a real browser or on a device. See PASS6-REPORT.md.
* Test Beta (alternative Level 0 generator) has no planned sites and keeps the original walk-in elevators.

### Tuning
`Level0Sites.settings` (level0-sites.js) holds distances and counts. `Level0World.cfg`/`maxRegions` hold generation and residency. `Quality.PROFILES` (js/systems/quality.js) holds the profile table. `Level0Markings.cfg` holds marking density.

### Tests
* `node tests/activity/run-all.js` - Activity System, elevator generation, puzzle, markings, CRT UI (Chromium via Playwright if available, otherwise skipped), world streaming, lifecycle/persistence/tab-hidden.
* `node tests/perf/quality.js` - quality profiles and the render-scale governor (logic only).
* `node tests/perf/lightpool-fidelity.js` - light pool vs. the old per-fixture lighting.
* `node tests/pwa/sw-cache.js` - service-worker cache and script-order consistency.
* `node tests/transitions/*.js` - Level 0 transition shell.
* `node --expose-gc tests/perf/bench.js [--root other-checkout] [--json]` - headless CPU benchmark.
* `tests/level9` and `tests/level10` fail identically with or without Passes 5-6 (their stub harness lacks `AudioSystem.setLevel`; Level 10 has one look-lerp assertion).
None of these measure GPU rendering or real-device frame rate.

## Development Status

Backrooms Runner is an **active work in progress**.

### Planned

* More levels
* More entities
* More environmental variety and audio
* More performance work (real-device profiling, draw-call merging, entity update tiers)

## Account roles

The account hierarchy is **User → Tester → Moderator → Developer → Owner**. Owner remains the existing `owner = true` profile flag; the owner's stored role remains `developer` for compatibility. Moderators are recognized as staff and can use the developer console, but the current build does not yet include chat moderation actions. Only Developers and the Owner can manage account roles. Developers can assign User, Tester, or Moderator; only the Owner can promote a Developer. Owner accounts are protected from role changes in the role-management database function.

After updating the site files, run `supabase/moderator-hierarchy.sql` in the Supabase SQL Editor. This creates the role validation and the two server-side RPC functions used by the Admin panel. Review the `profiles` table's existing RLS policies as directed in the SQL file: do not leave a broad policy that lets ordinary users update other accounts' `role` or `owner` fields.

## Developer console

These commands are for testing. They are not part of play, and they will skip things you are meant to find.

* `/level 0` through `/level 5` — enter a level (`/level5` also works)
* `/level 2 reset`, `/level 3 reset` — regenerate
* `/level 2 seed <n>`, `/level 3 seed <n>` — enter with a seed
* `/level 2 info`, `/level 3 info` — seed and size
* `/level 2 exit`, `/level 3 exit` — jump to the end of that level
* `/level 3 button`, `/level 3 power` — testing shortcuts for Level 3
* `/level 5 back` — jump to the lobby's back door (`/level 5 exit` jumps to the forward door)

## License

This project is a personal development project.

---

**Backrooms Runner**
*You weren't supposed to find this place.*

## Community chat (new in v37; offline-account moderation in v38)

The main menu now includes **Community Chat**. The first release includes the `general`, `announcements`, `level-discussion`, and `feedback` channels; live messages; replies; editing and deletion of your own messages; reactions; online presence; and basic @mention highlighting. Direct messages, attachments, voice chat, and advanced search are intentionally not part of this release.

### Supabase setup

1. Open the Supabase SQL Editor for the project already used by Backrooms Runner.
2. Confirm that `supabase/moderator-hierarchy.sql` has already been run successfully.
3. Run the complete `supabase/community-chat.sql` migration.
4. For an existing installation of v37, also run `supabase/offline-account-moderation.sql` to replace username-based moderation targeting with account-ID targeting and add moderator-only account search. Fresh installs can run both migrations; the incremental migration is safe to run after the main chat migration.
5. In Supabase, confirm that `chat_messages` and `chat_reactions` are included in the `supabase_realtime` publication. The migration attempts to add them automatically.
6. Reload the deployed game and sign in. Open **Community Chat** from the main menu.

The browser uses the existing Supabase anon/publishable key. Never put a service-role key in the game. Chat tables use row-level security; moderation and appeal actions use narrowly scoped database functions.

### Roles and moderation

- Users and Testers can use ordinary channels.
- Moderators can remove messages, issue warnings, mute accounts temporarily, suspend chat access temporarily, and submit permanent chat-ban requests. They cannot act on accounts at their own staff level or above.
- Moderation target search checks registered profiles, not the live-presence list. Offline accounts can be selected and actions are applied by account UUID, so logging out does not evade moderation.
- Developers and the Owner can review permanent chat-ban requests and appeals. The announcements channel is staff-post-only.
- Muted accounts retain read access but cannot send messages or react. Chat-suspended and chat-banned accounts cannot read normal chat and are shown the appeal interface.
- Chat restrictions are separate from game access. This migration does not implement game suspensions or game bans.

**Important:** Run the SQL migration before expecting chat to work. This ZIP contains the client and migration files; it does not apply changes to the hosted Supabase database.


### Developer review queue SQL fix

If the Developer Review Queue reports `column reference "id" is ambiguous`, run `supabase/fix-review-queue-ambiguous-id.sql` in the Supabase SQL Editor after the community-chat migrations. This is an incremental function replacement; it does not require rebuilding chat tables or changing account data.


### Persistent chat appeal cases (v39)

Run `supabase/appeal-case-interface.sql` after the existing chat and moderation migrations. Appeals are stored as persistent case records with WAITING, REJECTED, and APPROVED states. Users can edit a pending appeal, submit a new appeal after rejection (prior records remain in history), and acknowledge an approved appeal with Return to Chat. Approval clears chat-only restrictions; it does not change game restrictions.

### Appeal applications per restriction

For an existing installation, run `supabase/appeal-per-ban-applications.sql` after the earlier chat and appeal migrations. It gives each newly issued chat ban/suspension a unique restriction ID, permits one pending appeal at a time, and prevents an approval on an older appeal from lifting a newer restriction. Rejected appeals can be followed by a new application, and a later ban after an approval can be appealed independently.

## AutoMod v1 (incremental migration)

This build adds server-enforced AutoMod to community chat. It is intentionally separate from the original chat schema: for an existing installation, run **only** `supabase/automod-v1.sql` once, after the existing community-chat, offline-moderation, appeal-case, and per-ban-appeal migrations have been applied. Do not rerun the consolidated `community-chat.sql` or earlier migrations to install AutoMod. The migration does not apply itself to the hosted Supabase project.

AutoMod v1 uses database RPCs for message sending and editing, so ordinary clients cannot bypass message-insert checks by writing directly to `chat_messages`. Established-account defaults are 5 messages/10 seconds, 20/minute, 3 identical messages/minute, 5 normalized-similar messages/2 minutes, and 30 repeated characters. During the first 7 account days, the corresponding limits are 3/10 seconds, 12/minute, 2 identical messages/minute, 3 similar messages/2 minutes, and 20 repeated characters.

Mention defaults are 5 distinct users/message, 10 mentions/minute, and 5 mentions of the same user/minute; first-week accounts use 3 distinct users/message, 6 mentions/minute, and 3 mentions of the same user/minute. More than 5 links/30 seconds or 5/10 minutes triggers the established-account link limit; first-week accounts are limited to 1/30 seconds and 3/10 minutes. `@everyone` and `@here` are reserved for Developers and Owners. Unknown domains are allowed but flagged for staff review.

Ordinary accounts receive the agreed category-specific strike progression and a separate 90-day formal-warning progression. The stronger resulting restriction wins; punishments are chat-only. Strike expirations are 7 days for spam, 14 days for mentions and links, 30 days for harassment/evasion reports, and 60 days for hate-speech reports. Users can view active counts, next consequences, and recent history in **My Moderation Status**. Formal warning history remains visible after expiry. If a permanent AutoMod suspension is successfully appealed, escalation returns to the pre-Strike-5 state: the four most recent active strikes in the triggering category and the three most recent active formal warnings remain; older records stay in history but no longer count toward escalation.

Moderators, Developers, and Owners are not automatically punished. Detected staff violations are placed in the Developer/Owner review queue. A reviewer must outrank the target; a different Owner may review an Owner case. Users can report messages for harassment, hate speech, spam, links, or evasion; reports are review signals only and do not automatically create strikes. Authorized staff can inspect target history and reverse an applied AutoMod event, which also deactivates its associated formal warning. Configuration changes and enforcement events are recorded in audit tables. Developers and Owners can configure thresholds, view AutoMod statistics/overturn counts, and disable enforcement while leaving detection/logging active.

**Conservative-scope note:** This first pass does not use an external threat-intelligence feed or an AI text classifier. It does not automatically decide that an unfamiliar link is malicious, nor does it automatically classify ambiguous harassment/hate-speech language. Those cases rely on user reports and staff review to avoid keyword-based false positives. The built-in trusted-domain list is in `chat_automod_allowed_domains`; it can be extended by an authorized database operator.
