"use strict";

/* ------------------------------------------------------------------
   ACHIEVEMENT CATALOG  (Pass 7 / Checkpoint 7B)

   Data only. Every achievement the game can award is defined here, once. Nothing in gameplay code mentions an
   achievement; gameplay reports events to the Progression bus, AchievementSystem evaluates these definitions.

   IDs are permanent. They are stored in saves (and, in 7C, on a server). Never rename or reuse one; retire an
   achievement by leaving it here (it can stay unlockable) or by moving it to `retired`.

   Definition fields
     id          permanent, "<prefix>.<snake_case>"
     category    exploration | survival | entities | items | activities | collection | secrets
     rarity      common | uncommon | rare | epic | legendary | mythic     (metadata only; it never changes behaviour)
     name, description   shown to the player (hidden achievements only after they unlock)
     hidden      true: no name/description/requirement is exposed by AchievementSystem views until unlocked
     chain       { id, tier, of }  tiers must unlock in order: tier N never unlocks before tier N-1
     rewards     ids from REWARDS (cosmetic only; never gameplay)
     when        the condition (below)

   Conditions (data, no code)
     { t: "event", on: <bus event type>, match: { field: value | { lt|lte|gt|gte: n } } }   an event of that type with a matching payload
     { t: "threshold", metric: <metric id>, arg?: <string>, gte|lte|eq: n }                 a lifetime or run statistic
     { t: "all", of: [ ...conditions ] }                                                     every part, evaluated on any part's trigger

   Metrics (defined and documented in achievements.js): lifetime.* include finished runs plus the run in progress;
   run.* describe the run in progress only.
   ------------------------------------------------------------------ */
const AchievementCatalog = (() => {
  const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
  const CATEGORIES = ["exploration", "survival", "entities", "items", "activities", "collection", "secrets"];
  const REWARD_TYPES = ["title", "emblem", "nameplate", "decoration"];

  // Cosmetic rewards. Owning one is permanent; none of them changes gameplay.
  const REWARDS = {
    "title.newcomer":      { type: "title",      name: "Newcomer" },
    "title.survivor":      { type: "title",      name: "Survivor" },
    "title.insomniac":     { type: "title",      name: "Insomniac" },
    "title.slayer":        { type: "title",      name: "Slayer" },
    "title.pathfinder":    { type: "title",      name: "Pathfinder" },
    "title.technician":    { type: "title",      name: "Technician" },
    "emblem.gallery":      { type: "emblem",     name: "Rogues' Gallery" },
    "nameplate.static":    { type: "nameplate",  name: "Static" },
    "decoration.flicker":  { type: "decoration", name: "Flicker" }
  };

  const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const defs = [];
  const add = (d) => { defs.push(d); return d; };

  // chain(): one definition per tier, ids "<prefix>_<tier>", names "<name> <roman>"
  function chain(prefix, category, name, tiers, build) {
    tiers.forEach((t, i) => {
      const d = build(t, i + 1);
      add(Object.assign({ id: prefix + "_" + (i + 1), category, name: name + " " + ROMAN[i + 1], chain: { id: prefix, tier: i + 1, of: tiers.length } }, d, { rarity: t.rarity }));
    });
  }
  const th = (metric, gte, arg) => (arg === undefined ? { t: "threshold", metric, gte } : { t: "threshold", metric, arg, gte });
  const ev = (on, match) => ({ t: "event", on, match });

  /* ---------------- exploration ---------------- */
  const visit = (n, rarity, name, rewards) => add({ id: "exp.visit_level_" + n, category: "exploration", rarity, name, description: "Enter Level " + n + ".", rewards, when: ev("level_entered", { level: n }) });
  visit(0, "common", "Welcome In", ["title.newcomer"]);
  visit(1, "common", "First Descent");
  visit(2, "common", "Pipe Works");
  visit(3, "uncommon", "Live Wire");
  visit(5, "uncommon", "Check-In");
  visit(6, "rare", "Lights Out");
  visit(9, "rare", "After Dark");
  visit(10, "epic", "Open Air");
  chain("exp.wanderer", "exploration", "Wanderer", [{ n: 4, rarity: "common" }, { n: 7, rarity: "rare" }, { n: 10, rarity: "epic" }],
    (t) => ({ description: "Visit " + t.n + " different levels.", when: th("lifetime.levelsVisited", t.n) }));
  add({ id: "exp.escape_level_0", category: "exploration", rarity: "common", name: "First Exit", description: "Escape Level 0.", when: ev("level_escaped", { level: 0 }) });
  add({ id: "exp.escape_level_5", category: "exploration", rarity: "uncommon", name: "Checkout", description: "Escape Level 5.", when: ev("level_escaped", { level: 5 }) });
  add({ id: "exp.escape_level_10", category: "exploration", rarity: "legendary", name: "The Way Out", description: "Escape Level 10.", when: ev("level_escaped", { level: 10 }) });

  /* ---------------- survival ---------------- */
  add({ id: "sur.out_alive", category: "survival", rarity: "rare", name: "Daylight", description: "Complete a run without dying.", rewards: ["title.survivor"], when: ev("run_ended", { outcome: "escape" }) });
  chain("sur.staying_alive", "survival", "Staying Alive", [{ min: 5, rarity: "common" }, { min: 15, rarity: "uncommon" }, { min: 40, rarity: "rare" }],
    (t, n) => ({ description: "Survive " + t.min + " minutes in a single run.", rewards: n === 3 ? ["title.insomniac"] : undefined, when: th("run.elapsed", t.min * 60) }));
  chain("sur.long_walk", "survival", "Long Walk", [{ m: 1000, rarity: "common" }, { m: 3000, rarity: "uncommon" }, { m: 8000, rarity: "rare" }, { m: 20000, rarity: "mythic" }],
    (t, n) => ({ description: "Travel " + (t.m / 1000) + " km in a single run.", rewards: n === 4 ? ["decoration.flicker"] : undefined, when: th("run.distance", t.m) }));
  chain("sur.descender", "survival", "Descender", [{ n: 2, rarity: "uncommon" }, { n: 4, rarity: "rare" }, { n: 7, rarity: "epic" }],
    (t) => ({ description: "Escape " + t.n + " levels in a single run.", when: th("run.levelsEscaped", t.n) }));
  chain("sur.pathfinder", "survival", "Pathfinder", [{ km: 10, rarity: "uncommon" }, { km: 50, rarity: "rare" }, { km: 250, rarity: "legendary" }],
    (t, n) => ({ description: "Travel " + t.km + " km in total.", rewards: n === 3 ? ["title.pathfinder"] : undefined, when: th("lifetime.distance", t.km * 1000) }));
  add({ id: "sur.returning_1", category: "survival", rarity: "common", name: "Returning", description: "Finish 10 runs.", chain: { id: "sur.returning", tier: 1, of: 1 }, when: th("lifetime.runsFinalized", 10) });

  /* ---------------- entities ---------------- */
  chain("ent.slayer", "entities", "Entity Slayer", [{ n: 1, rarity: "common" }, { n: 5, rarity: "uncommon" }, { n: 15, rarity: "rare" }, { n: 40, rarity: "epic" }, { n: 100, rarity: "legendary" }],
    (t, n) => ({ description: "Defeat " + t.n + (t.n === 1 ? " entity." : " entities."), rewards: n === 3 ? ["title.slayer"] : n === 5 ? ["nameplate.static"] : undefined, when: th("lifetime.entitiesDefeated", t.n) }));
  const meet = (type, rarity, name, what) => add({ id: "ent.meet_" + type, category: "entities", rarity, name, description: "Encounter " + what + ".", when: ev("entity_encountered", { entityType: type }) });
  meet("smiler", "common", "Smile for Me", "a Smiler");
  meet("hound", "uncommon", "Heard the Growl", "a Hound");
  meet("entity", "uncommon", "Not Alone", "the entity of Level 0");
  meet("mangled", "rare", "Stalked", "a Mangled");
  meet("beast", "rare", "No Mercy", "the Beast");
  meet("watch", "epic", "Watched", "The Watch");
  add({ id: "ent.all_types", category: "entities", rarity: "legendary", name: "Rogues' Gallery", description: "Encounter every kind of entity.", rewards: ["emblem.gallery"], when: th("lifetime.entityTypes", 6) });
  add({ id: "ent.seen_1", category: "entities", rarity: "uncommon", name: "Seen Things I", description: "Have 10 entity encounters.", chain: { id: "ent.seen", tier: 1, of: 2 }, when: th("lifetime.entitiesEncountered", 10) });
  add({ id: "ent.seen_2", category: "entities", rarity: "rare", name: "Seen Things II", description: "Have 50 entity encounters.", chain: { id: "ent.seen", tier: 2, of: 2 }, when: th("lifetime.entitiesEncountered", 50) });
  add({ id: "ent.slipped_away", category: "entities", rarity: "uncommon", name: "Slipped Away", description: "Lose something that was chasing you.", when: ev("entity_escaped", {}) });

  /* ---------------- items ---------------- */
  chain("itm.hungry", "items", "Hungry", [{ n: 3, rarity: "uncommon" }, { n: 6, rarity: "rare" }],
    (t) => ({ description: "Eat " + t.n + " Energy Bars in a single run.", when: th("run.item", t.n, "energyBar") }));
  chain("itm.thirsty", "items", "Thirsty", [{ n: 3, rarity: "uncommon" }, { n: 6, rarity: "rare" }],
    (t) => ({ description: "Drink " + t.n + " cans of Almond Water in a single run.", when: th("run.item", t.n, "almondWater") }));
  chain("itm.provisions", "items", "Provisions", [{ n: 25, rarity: "uncommon" }, { n: 100, rarity: "rare" }],
    (t) => ({ description: "Consume " + t.n + " items in total.", when: th("lifetime.itemsConsumed", t.n) }));

  /* ---------------- activities ---------------- */
  add({ id: "act.first_restore", category: "activities", rarity: "common", name: "Back in Power", description: "Complete an electrical puzzle.", when: ev("activity_completed", { typeId: "electrical-restoration" }) });
  chain("act.technician", "activities", "Technician", [{ n: 5, rarity: "uncommon" }, { n: 25, rarity: "rare" }, { n: 75, rarity: "epic" }],
    (t, n) => ({ description: "Complete " + t.n + " activities.", rewards: n === 2 ? ["title.technician"] : undefined, when: th("lifetime.activities", t.n) }));
  add({ id: "act.overtime", category: "activities", rarity: "rare", name: "Overtime", description: "Complete 5 activities in a single run.", when: th("run.activities", 5) });

  /* ---------------- secrets (hidden: nothing about them is shown before they unlock) ---------------- */
  add({ id: "sec.dead_end", category: "secrets", rarity: "uncommon", hidden: true, name: "Dead End", description: "Die within a minute of starting a run.", when: ev("run_ended", { outcome: "death", durationSec: { lt: 60 } }) });
  add({ id: "sec.nine_lives", category: "secrets", rarity: "uncommon", hidden: true, name: "Nine Lives", description: "Die nine times.", when: th("lifetime.deaths", 9) });
  add({ id: "sec.pacifist", category: "secrets", rarity: "rare", hidden: true, name: "Peaceful Passage", description: "Escape three levels in one run without defeating anything.",
    when: { t: "all", of: [th("run.levelsEscaped", 3), { t: "threshold", metric: "run.entitiesDefeated", lte: 0 }] } });
  add({ id: "sec.abstainer", category: "secrets", rarity: "rare", hidden: true, name: "Nothing to Declare", description: "Escape four levels in one run without consuming a single item.",
    when: { t: "all", of: [th("run.levelsEscaped", 4), { t: "threshold", metric: "run.itemsConsumed", lte: 0 }] } });
  add({ id: "sec.staredown", category: "secrets", rarity: "rare", hidden: true, name: "Stare Down", description: "Defeat three Smilers in a single run.", when: th("run.entitiesDefeated", 3, "smiler") });

  /* ---------------- not implemented: no reliable trigger exists today. Documented, never awarded. ---------------- */
  const deferred = [
    { id: "col.documents", why: "No document can be collected in the game; document_collected is never emitted." },
    { id: "col.document_types", why: "There are no document types." },
    { id: "col.fragments", why: "There are no readable fragments." },
    { id: "sec.hidden_area", why: "No hidden areas exist; secret_discovered is never emitted." },
    { id: "sec.unusual_location", why: "There is no definition of an unusual location and no detection for one." },
    { id: "ent.rare_entity", why: "Entities have no rarity flag, and no entity is rare in a way the code can identify." },
    { id: "ent.defeat_other_types", why: "The only player-caused removal of an entity is the flashlight repelling a Smiler." },
    { id: "act.elevator", why: "Level 0 elevator sets are not reported as activity_completed with their own type." },
    { id: "exp.visit_level_4_8", why: "Levels 4 and 8 have no individual achievement in the initial catalog (kept to ~60); trivially addable." },
    { id: "exp.visit_level_7", why: "Level 7 is not built." },
    { id: "sur.score", why: "There is no ScoreSystem." }
  ];

  /* ---------------- validation (run by the tests, and cheap enough to run at load in dev) ---------------- */
  function validateCond(c, where, out) {
    if (!c || typeof c !== "object") { out.push(where + ": no condition"); return; }
    if (c.t === "event") { if (typeof c.on !== "string") out.push(where + ": event without on"); }
    else if (c.t === "threshold") {
      if (typeof c.metric !== "string") out.push(where + ": threshold without metric");
      if (!["gte", "lte", "eq"].some(k => typeof c[k] === "number")) out.push(where + ": threshold without gte/lte/eq");
    } else if (c.t === "all") { if (!Array.isArray(c.of) || !c.of.length) out.push(where + ": empty all"); else c.of.forEach((x, i) => validateCond(x, where + ".of[" + i + "]", out)); }
    else out.push(where + ": unknown condition type " + c.t);
  }
  function validate(list, rewards) {
    const L = list || defs, R = rewards || REWARDS, out = [], seen = new Set();
    for (const d of L) {
      const w = d.id || "(no id)";
      if (!/^[a-z]+\.[a-z0-9_]+$/.test(String(d.id))) out.push(w + ": bad id");
      if (seen.has(d.id)) out.push(w + ": duplicate id"); seen.add(d.id);
      if (CATEGORIES.indexOf(d.category) < 0) out.push(w + ": bad category");
      if (RARITIES.indexOf(d.rarity) < 0) out.push(w + ": bad rarity");
      if (!d.name || !d.description) out.push(w + ": missing name/description");
      for (const r of d.rewards || []) if (!R[r]) out.push(w + ": unknown reward " + r);
      validateCond(d.when, w, out);
      if (d.chain) {
        if (!Number.isInteger(d.chain.tier) || d.chain.tier < 1 || d.chain.tier > d.chain.of) out.push(w + ": bad chain tier");
        if (d.chain.tier > 1 && !L.some(x => x.chain && x.chain.id === d.chain.id && x.chain.tier === d.chain.tier - 1)) out.push(w + ": chain tier without predecessor");
      }
    }
    for (const k of Object.keys(R)) if (REWARD_TYPES.indexOf(R[k].type) < 0 || !R[k].name || k.split(".")[0] !== R[k].type) out.push("reward " + k + ": malformed");
    return out;
  }

  return { RARITIES, CATEGORIES, REWARD_TYPES, REWARDS, ROMAN, all: defs, deferred, validate };
})();
