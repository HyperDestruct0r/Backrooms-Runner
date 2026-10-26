"use strict";

/* Class rates. Normal class is the room. E means the place itself is the hazard.
   Only 0 through 5 are wired. The rest wait for those levels. */
const Sanity = {
  rates: { 0: 0, 1: 0.02, 2: 0.05, 3: 0.10, 4: 0.18, 5: 0.30, deadzone: 1.6 },
  eRates: { 0: 0, 1: 0.08, 2: 0.16, 3: 0.30, 4: 0.50, 5: 0.80, deadzone: 1.6 },

  ofLevel(level) {
    if (level === 0) return { class: 0, e: false };
    if (level === 1) return { class: 1, e: false };
    if (level === 2) return { class: 2, e: false };
    if (level === 3) return { class: 4, e: false };
    if (level === 4) return { class: 1, e: false };
    if (level === 5) return { class: 5, e: false };
    return { class: 0, e: false };
  },

  ambient(level) {
    const info = this.ofLevel(level);
    const table = info.e ? this.eRates : this.rates;
    return table[info.class] == null ? 0 : table[info.class];
  },

  blocksHeal(level) {
    return this.ofLevel(level).class >= 3;
  }
};
