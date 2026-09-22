"use strict";

/**
 * Runtime JavaScript counterpart of ts/systems/seed.ts.
 * The browser does not execute TypeScript directly; this file is the
 * checked-in runtime version of the typed seed utilities.
 */
const SeedSystem = {
  random() {
    try {
      const buf = new Uint32Array(1);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(buf);
        if (buf[0] !== 0) return buf[0] >>> 0;
      }
    } catch (_) {}

    const fallback = (Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0;
    return fallback || 483921;
  },

  parseCustom(value) {
    const trimmed = String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(trimmed)) return null;

    const numeric = Number(trimmed);
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xFFFFFFFF) {
      return null;
    }

    return numeric >>> 0;
  }
};
