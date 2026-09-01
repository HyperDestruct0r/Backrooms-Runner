# Backrooms Runner — Infinite Level 1 prototype

This version splits the prototype into HTML/CSS/JS and replaces Level 1 with a deterministic streaming world.

## Run
Open `index.html` in a browser. The game still loads Three.js from jsDelivr, so an internet connection is required unless you vendor Three.js locally.

## Level 1 generation
Level 1 is generated in 48m x 48m chunks. Only a 5x5 chunk window is retained around the player, and chunks are seeded from the game seed plus integer chunk coordinates. Some chunks are broad open parking/service spaces; others contain branching concrete partitions, columns, pipes, and different lighting densities.

The world can therefore continue in any direction without a predefined outer boundary.


## Level 1 blackout event

Level 1 now has a level-wide electrical outage event. The first opportunity is at 60 seconds after entering Level 1. If it has not triggered, the game makes another 10% roll every 6 seconds; it is guaranteed to begin by 90 seconds. The lights flicker for about 2.4 seconds, then remain off for 30–60 seconds, after which they come back on. A 60–90 second cooldown follows before another blackout can begin. Because Level 1 streams infinitely, the event applies to every currently loaded fixture and newly streamed fixtures are also created in the appropriate off state while the outage is active.
