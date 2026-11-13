"use strict";

/* ------------------------------------------------------------------
   ACHIEVEMENT ART LOOKUP  (Pass 7D)

   Maps an achievement to its artwork FILE. There is no per-achievement table: the file name is derived from the id, so replacing an
   icon means replacing one file in assets/achievements/ and nothing else.

     achievement in a chain with more than one tier  ->  assets/achievements/<chain id>.svg      (tiers share it; the Roman numeral is drawn by the UI)
     any other achievement                           ->  assets/achievements/<achievement id>.svg

   assets/achievements/_fallback.svg is used by the UI if a file fails to load.
   Pure functions, no DOM, no state. Takes the view/payload objects AchievementSystem already produces ({ id, chain }).
   ------------------------------------------------------------------ */
const AchievementArt = (() => {
  const BASE = "assets/achievements/";
  const FALLBACK = BASE + "_fallback.svg";
  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const keyFor = (a) => (a && a.chain && a.chain.of > 1) ? a.chain.id : (a ? a.id : null);
  const urlFor = (a) => { const k = keyFor(a); return k ? BASE + k + ".svg" : FALLBACK; };
  // A numeral only where it distinguishes tiers of a real chain (a chain of one tier shows none).
  const numeralFor = (a) => (a && a.chain && a.chain.of > 1 && ROMAN[a.chain.tier]) ? ROMAN[a.chain.tier] : "";
  return { BASE, FALLBACK, keyFor, urlFor, numeralFor };
})();
