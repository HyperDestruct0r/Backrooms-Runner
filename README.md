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

## Development Status

Backrooms Runner is an **active work in progress**.

### Planned

* More levels
* More entities
* More environmental variety and audio
* Performance work

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
