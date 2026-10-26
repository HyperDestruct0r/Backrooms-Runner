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
* **Level 5** — "The Hotel": a kept 1930s hotel of patterned carpet, dark wood and warm low light. A bright lobby, long numbered halls, a few guest rooms and dead ends. The way back is in the lobby, the way on is at the far end

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
