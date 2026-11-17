"use strict";

/* ------------------------------------------------------------------
   CHUNK VIEW  (Pass 7E)
   Decides which streaming chunks should be PREPARED (built) for the player's view. It only answers "which chunk
   offsets are wanted"; building, queuing, unloading and caching stay in the level that owns the chunks.

   Level 0 and Level 1 used one hard-coded 84 degree cone (CONFIG.fovDeg does not exist at the top level of CONFIG, so
   `CONFIG.fovDeg || 84` was always 84) plus 12 degrees, and tested only the chunk CENTRE. That cone is narrower than
   the real picture: the camera's FOV is vertical (69 degrees, 78 sprinting), so a 16:9 window sees about 101 / 110
   degrees across and an ultrawide one more. A large chunk whose centre was just outside the cone could still cover the
   edge of the screen, and was only built when its centre crossed in: visible pop-in at the screen edges and when turning.

   What this does instead:
     - the cone's half-angle comes from the live camera (vertical FOV and aspect ratio, so sprinting and resizing are
       followed) plus a margin that depends on the quality profile;
     - a chunk is tested as its bounding circle, not as a point: it is wanted as soon as any part of it can be inside
       the margin cone and inside reach;
     - while the player is turning, the cone leans toward the turn by the angle the view will cover in a fraction of a
       second, so the chunks the view is about to reach are already requested;
     - the chunks around the player (Chebyshev distance <= 1) are always wanted, in every direction, as before.
   Pure functions plus one tiny tracker object per level; nothing here touches three.js, the scene or the DOM.
   ------------------------------------------------------------------ */
const ChunkView = {
  // extra degrees past the camera's own horizontal half-angle, per quality profile (not part of Quality.PROFILES)
  MARGIN_DEG: { high: 16, medium: 12, low: 9 },
  DEFAULT_MARGIN_DEG: 14,
  MIN_HALF_DEG: 40,          // a tall, narrow phone window still prepares a usable cone
  MAX_HALF_DEG: 120,         // beyond this the cone is simply everything in reach
  LEAD_SECONDS: 0.30,        // how far ahead (in time) a turn is anticipated
  LEAD_MAX_DEG: 30,
  FALLBACK_FOV_DEG: 69,
  FALLBACK_ASPECT: 16 / 9,
  // chunks that are wanted but outside the real view sort after those inside it by about this many chunk-distances squared
  OUT_OF_VIEW_PENALTY: 5,

  marginDeg() {
    const q = (typeof Quality !== "undefined" && Quality && Quality.name) ? Quality.name : "";
    return this.MARGIN_DEG[q] != null ? this.MARGIN_DEG[q] : this.DEFAULT_MARGIN_DEG;
  },

  // Horizontal half-angle of the camera in radians, from its vertical FOV and aspect ratio.
  cameraHalfAngle(camera) {
    let fov = camera && camera.fov > 1 ? camera.fov : ((typeof CONFIG !== "undefined" && CONFIG.cameraFov) || this.FALLBACK_FOV_DEG);
    let aspect = camera && camera.aspect > 0.1 ? camera.aspect : this.FALLBACK_ASPECT;
    if (!(camera && camera.aspect > 0.1) && typeof window !== "undefined" && window && window.innerWidth > 0 && window.innerHeight > 0) {
      aspect = window.innerWidth / window.innerHeight;
    }
    return Math.atan(Math.tan(fov * Math.PI / 360) * aspect);
  },

  // One tracker per level: remembers the last yaw so the turn rate can be estimated between stream() calls.
  createTracker() { return { yaw: null, t: 0, rate: 0 }; },
  // Smoothed signed yaw rate in radians per second (positive = yaw increasing). `now` is seconds.
  turnRate(tr, yaw, now) {
    if (tr.yaw == null) { tr.yaw = yaw; tr.t = now; tr.rate = 0; return 0; }
    const dt = now - tr.t;
    if (dt <= 1e-4) return tr.rate;
    let d = yaw - tr.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));            // shortest signed difference, safe across +-PI
    const inst = d / dt;
    tr.rate += (inst - tr.rate) * Math.min(1, dt * 8);   // light smoothing: ~0.12 s
    tr.yaw = yaw; tr.t = now;
    if (dt > 0.5) tr.rate = 0;                           // a pause or a tab switch is not a turn
    return tr.rate;
  },

  // The view cone for the current frame: a centre direction and a half-angle, both widened toward the turn.
  // `rate` is the signed yaw rate from turnRate(); the camera looks along (-sin yaw, -cos yaw), so yaw increasing
  // turns the view toward the player's left, which is a positive rotation of that direction.
  makeView(camera, yaw, rate) {
    const marginRad = this.marginDeg() * Math.PI / 180;
    let half = this.cameraHalfAngle(camera) + marginRad;
    const minHalf = this.MIN_HALF_DEG * Math.PI / 180, maxHalf = this.MAX_HALF_DEG * Math.PI / 180;
    if (half < minHalf) half = minHalf;
    const strictHalf = Math.min(this.cameraHalfAngle(camera), maxHalf);
    let lead = (rate || 0) * this.LEAD_SECONDS;
    const leadMax = this.LEAD_MAX_DEG * Math.PI / 180;
    if (lead > leadMax) lead = leadMax; else if (lead < -leadMax) lead = -leadMax;
    const centre = yaw + lead * 0.5;                      // lean toward the turn, widen by the same amount
    half += Math.abs(lead) * 0.5;
    if (half > maxHalf) half = maxHalf;
    return {
      fx: -Math.sin(centre), fz: -Math.cos(centre), half,
      // the strict (no margin, no lead) cone around the actual view direction, used only to order the work
      sfx: -Math.sin(yaw), sfz: -Math.cos(yaw), strictHalf
    };
  },

  // Is the circle (centre vx,vz relative to the player, radius r) inside the cone?
  _inCone(vx, vz, dist, r, fx, fz, half) {
    if (dist <= r) return true;                           // the player is inside the chunk's bounding circle
    const cosA = (vx * fx + vz * fz) / dist;
    const ang = Math.acos(cosA > 1 ? 1 : cosA < -1 ? -1 : cosA);
    const widen = Math.asin(r / dist > 1 ? 1 : r / dist);
    return ang <= half + widen;
  },

  /* Offsets [dx, dz, inView] of the chunks to prepare around chunk (cx, cz), for a player at (px, pz).
       size   chunk edge in metres
       reach  how far out chunks are prepared, measured to the chunk's NEAREST EDGE (fog distance + a preparation margin)
       view   from makeView()
       ring   chunks within this Chebyshev distance are always wanted (default 1)
     inView is 1 when the chunk is also inside the strict, margin-free view; callers use it to order the work. */
  wantedOffsets(cx, cz, size, px, pz, reach, view, ring) {
    ring = ring == null ? 1 : ring;
    const r = size * Math.SQRT1_2;                         // bounding circle of a square chunk
    const span = Math.ceil((reach + r) / size);
    const out = [];
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const vx = (cx + dx + 0.5) * size - px, vz = (cz + dz + 0.5) * size - pz;
        const dist = Math.hypot(vx, vz);
        const near = Math.max(Math.abs(dx), Math.abs(dz)) <= ring;
        if (!near && dist - r > reach) continue;
        const inView = dist <= r || this._inCone(vx, vz, dist, r, view.sfx, view.sfz, view.strictHalf) ? 1 : 0;
        if (near || this._inCone(vx, vz, dist, r, view.fx, view.fz, view.half)) out.push([dx, dz, inView]);
      }
    }
    return out;
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { ChunkView };
