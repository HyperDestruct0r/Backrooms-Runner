export type SeedMode = "random" | "custom";


export interface SeedSelection {
  mode: SeedMode;
  seed?: number;
}

/**
 * Seed utilities used by Backrooms Runner.
 *
 * The browser runtime uses the compiled JavaScript counterpart in
 * js/systems/seed.js. Keep this file as the typed source of truth.
 */
export const SeedSystem = {
  random(): number {
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

  parseCustom(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;

    const numeric = Number(trimmed);
    if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xFFFFFFFF) {
      return null;
    }

    return numeric >>> 0;
  }
};
