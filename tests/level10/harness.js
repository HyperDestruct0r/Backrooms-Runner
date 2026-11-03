// Level 10 headless harness: the Level 9 harness (stub THREE, real physics) plus the Level 10 scripts and a few recorders.
// No GPU: these test logic, streaming, physics, transitions and the look numbers, not how anything renders.
const base = require("../level9/harness.js");
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..") + "/";
const { ctx, run, stats } = base;
run(`
  var __look = { fogs: [], bg: [] };
  THREE.Fog = class { constructor(c, n, f) { const self = this; this.near = n; this.far = f; this.color = { hex: c, setHex(h) { this.hex = h; } }; } };
  scene.background = { hex: 0, setHex(h) { this.hex = h; } };
  var __void = { calls: 0 };
  var VoidTransition = { then(fn) { __void.calls++; fn(); } };
  var __complete10 = [];
  Game.complete = function () { __complete.push(GameState.level); };
`, "l10-stubs");
for (const f of ["js/levels/level10-gen.js", "js/levels/level10.js"]) run(fs.readFileSync(ROOT + f, "utf8"), f);
// a walker: real collision, level-appropriate update each step
run(`
  var Walk = {
    colliders() { return Level10.active ? Level10.colliders : Level9.colliders; },
    step(dx, dz, dt, jump) {
      Level.colliders = this.colliders();
      const sp = 4.6, d = Math.hypot(dx, dz) || 1;
      Player.velocity.x = dx / d * sp; Player.velocity.z = dz / d * sp;
      if (jump && Player.onGround) { Player.velocity.y = 7.4; Player.onGround = false; }
      Player.velocity.y -= 24 * dt;
      Physics.moveAndCollide(Player.position, Player.velocity, 0.34, 1.72, dt);
      if (Level10.active) Level10.update(dt); else if (Level9.active) Level9.update(dt);
    }
  };
`, "walker");
// a walker that sprint-jumps and steers round walls (barns, lakes) when it stops making progress
run(`
  var Auto = { stuck: 0, side: 0, last: null,
    go(dx, dz, dt) {
      const P = Player.position, l = this.last; this.last = { x: P.x, z: P.z };
      if (l && Math.hypot(P.x - l.x, P.z - l.z) < 0.02) this.stuck++; else this.stuck = Math.max(0, this.stuck - 1);
      if (this.stuck > 25) { this.side = 40; this.sdir = Math.random() < 0.5 ? 1 : -1; this.stuck = 0; }
      let vx = dx, vz = dz;
      if (this.side > 0) { this.side--; vx = -dz * this.sdir; vz = dx * this.sdir; }
      Level.colliders = Level10.active ? Level10.colliders : Level9.colliders;
      const d = Math.hypot(vx, vz) || 1;
      Player.velocity.x = vx / d * 8.15; Player.velocity.z = vz / d * 8.15;
      if (Player.onGround) { Player.velocity.y = 7.4; Player.onGround = false; }
      Player.velocity.y -= 24 * dt;
      Physics.moveAndCollide(Player.position, Player.velocity, 0.34, 1.72, dt);
      Level10.update(dt);
    } };
`, "auto");
module.exports = { ctx, run, stats };
