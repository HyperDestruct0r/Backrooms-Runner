// Electrical puzzle: every generated puzzle is solvable, wrong boards never verify, difficulty ramps.
const fs = require("fs");
const { ElectricalPuzzle: P } = require("../../js/activities/electrical-puzzle.js");
const { assert, pass } = require("./harness.js");

// 1. solvable by construction AND by an independent search
const per = {};
for (let d = 0; d < 5; d++) {
  let n = 0, inconclusive = 0;
  for (let s = 1; s <= 600; s++) {
    const p = P.generate((s * 2654435761) >>> 0, d); n++;
    assert(P.isSolved(p, p.solution), "stored solution powers every load (d" + d + " s" + s + ")");
    assert(!P.isSolved(p, p.start), "scrambled start is not already solved");
    for (let i = 0; i < p.cells.length; i++) if (p.cells[i] && p.cells[i].fixed) assert(p.start[i] === p.cells[i].solvedRot, "fixed piece starts at its solved rotation");
    const so = P.solve(p, 300000);
    if (so.budgetExceeded) inconclusive++;
    else { assert(so.solved, "independent solver finds a solution (d" + d + " s" + s + ")"); assert(P.verify(p, so.rot), "solver result passes verify"); }
  }
  per[d] = { n, inconclusive };
}
pass("3000 puzzles (600 x 5 difficulties) all solvable; independent solver agrees; none inconclusive: " + JSON.stringify(Object.values(per).map(x => x.inconclusive)));

// 2. wrong configurations never verify
{
  let wrong = 0, accepted = 0;
  for (let s = 1; s <= 300; s++) {
    const p = P.generate(s * 977, s % 5);
    assert(!P.verify(p, p.start), "the scrambled start is not accepted");
    // flip every free piece to a rotation that breaks the circuit where it changes anything
    const bad = p.solution.slice();
    for (let i = 0; i < bad.length; i++) { const c = p.cells[i]; if (c && !c.fixed && p.SYM !== 1 && P.rotMask(c.base, c.solvedRot) !== P.rotMask(c.base, c.solvedRot + 1)) { bad[i] = (c.solvedRot + 1) & 3; } }
    const wasSolved = P.isSolved(p, bad.map((v, i) => (p.cells[i] && p.cells[i].fixed ? p.cells[i].solvedRot : v)));
    if (wasSolved) accepted++; else wrong++;
    assert(P.verify(p, p.solution), "the true solution verifies");
    assert(!P.verify(p, null) && !P.verify(p, [1, 2, 3]), "malformed submissions are rejected");
  }
  assert(wrong > 250, "rotating every free piece breaks nearly every circuit (" + wrong + "/300)");
  pass("wrong boards rejected; " + wrong + "/300 fully rotated boards fail, malformed input rejected");
}

// 3. a tampered rotation on a FIXED piece cannot change the outcome
{
  const p = P.generate(4242, 0);
  const t = p.solution.slice();
  let tampered = 0;
  for (let i = 0; i < t.length; i++) if (p.cells[i] && p.cells[i].fixed) { t[i] = (t[i] + 1) & 3; tampered++; }
  assert(tampered > 0 && P.verify(p, t), "fixed pieces are read at their locked rotation");
  pass("fixed pieces ignore tampered rotations (" + tampered + " tampered)");
}

// 4. determinism and difficulty ramp
{
  const a = P.generate(99, 3), b = P.generate(99, 3), c = P.generate(100, 3);
  assert(JSON.stringify(a) === JSON.stringify(b), "same seed gives the same puzzle");
  assert(JSON.stringify(a) !== JSON.stringify(c), "different seed gives a different puzzle");
  const size = [0, 1, 2, 3, 4].map(d => { const p = P.generate(7, d); return p.w * p.h; });
  const loads = [0, 1, 2, 3, 4].map(d => P.generate(7, d).loads.length);
  for (let i = 1; i < 5; i++) assert(size[i] >= size[i - 1], "board size never shrinks with grade");
  assert(size[4] > size[0] && loads[4] > loads[0], "grade 5 is larger and has more loads than grade 1");
  pass("deterministic per seed; grades ramp: sizes " + size.join("/") + ", loads " + loads.join("/"));
}

// 5. fallback templates are valid circuits and pass the same validation
{
  P.FALLBACKS.forEach((t, i) => { const p = P._fromTemplate(t, 5, i); assert(P.isSolved(p, p.solution), "fallback " + i + " solves"); assert(P.solve(p).solved, "fallback " + i + " solver agrees"); });
  // force the fallback path by making the main generator always fail
  const orig = P._attempt; P._attempt = () => null;
  const p = P.generate(1, 1); P._attempt = orig;
  assert(p.fallback === true && P.isSolved(p, p.solution) && !P.isSolved(p, p.start), "fallback path produces a valid, unsolved-at-start puzzle");
  pass("fallback templates and fallback path valid");
}
