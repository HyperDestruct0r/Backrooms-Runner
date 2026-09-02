# Backrooms Runner

**Backrooms Runner** is a browser-based first-person exploration/horror game inspired by the Backrooms. Explore procedurally generated environments, manage your resources, survive strange entities and environmental events, and find your way to the next level.

**Play:** https://hyperdestruct0r.github.io/Backrooms-Runner/

## Current Features

* First-person 3D gameplay powered by **Three.js**
* **Level 0** — the classic yellow Backrooms environment
* **Level 1** — a large procedurally generated concrete/maintenance environment
* Procedural world generation with deterministic seeds
* Streaming environments that generate as the player explores
* Flashlight system
* Sprinting, crouching, jumping, and movement mechanics
* Inventory and consumable items
* Almond Water
* Smiler entity
* Dynamic lighting
* Level 1 electrical blackout events
* Level transitions
* Exit detection and navigation assistance
* Atmospheric effects and environmental audio
* HUD and gameplay notifications

## Gameplay

The basic objective is simple:

> **Find the exit.**

Getting there is not necessarily simple.

The Backrooms are designed to be confusing and disorienting. Corridors, rooms, maintenance areas, and other environments are procedurally generated, meaning the player cannot rely on a single fixed map.

As development continues, different levels will have increasingly distinct environments, mechanics, and threats.

##  Level 0

Level 0 is based around the familiar Backrooms environment:

* Yellow wallpaper
* Repeating rooms and corridors
* Fluorescent lighting
* Large procedurally generated spaces
* Disorienting layouts
* Smilers and other hazards

The goal is to find a way out while navigating an environment that intentionally feels repetitive and difficult to memorize.

## Level 1

Level 1 is a much larger concrete and maintenance environment.

It features:

* Procedurally generated maintenance areas
* Concrete corridors and partitions
* Large service/industrial spaces
* Columns and pipes
* Dynamic lighting
* Electrical blackouts
* Streaming world generation
* A Level 1 exit

Level 1 is intended to feel substantially different from Level 0 rather than simply being another maze with different textures.

The generation system is deterministic: the same world seed and coordinates produce the same environment, while still allowing the game to create a very large world.

## Blackout Events

Level 1 contains a level-wide electrical outage system.

When a blackout occurs:

1. The lights begin to flicker.
2. The electrical system shuts down.
3. The environment remains dark for a period of time.
4. The lights eventually return.

The blackout system also accounts for newly generated areas while the event is active, so streaming into a new area does not immediately restore its lights.

## Entities

### Smiler

Smilers are hostile entities that can appear while exploring.

They are intended to make the player think carefully about lighting and their surroundings rather than simply turning exploration into constant combat.

More entities are planned as development continues.

## Procedural Generation

A major part of Backrooms Runner is its procedural generation system.

Rather than storing one enormous predefined map, the game generates parts of the world as the player explores.

This allows the game to create environments much larger than a traditional hand-built map while keeping the amount of geometry loaded at any one time manageable.

The generation system is also deterministic, allowing the same seed and coordinates to reproduce the same environment.

## Technology

Backrooms Runner is built using:

* **HTML**
* **CSS**
* **JavaScript**
* **Three.js**

The project currently uses a classic multi-file JavaScript architecture rather than ES modules. This keeps the different game systems separated while maintaining compatibility with the existing browser-based codebase.

## ▶️Running the Game

The easiest way to play is through GitHub Pages:

**https://hyperdestruct0r.github.io/Backrooms-Runner/**

To run the project locally, clone the repository and open `index.html` in a modern browser.

The game currently loads Three.js from jsDelivr, so an internet connection is required unless the dependency is hosted locally.

## Development Status

Backrooms Runner is an **active work in progress**.

The current focus is improving the procedural generation, atmosphere, performance, entity behavior, and level design before expanding the game with additional levels.

### Planned Improvements

* More Backrooms levels
* More entities
* Improved procedural generation
* More environmental variety
* Additional sound and atmospheric effects
* Improved entity AI
* More gameplay mechanics
* Performance optimization
* More detailed environments
* Additional level-specific events

## License

This project is currently a personal development project.

See the repository for the latest source code and project information.

---

**Backrooms Runner**
*You weren't supposed to find this place.*
