const assert = require("assert");
const { RecipePool, loadRecipePool } = require("./recipes");

const SAMPLE = [
  { id: "a", name: "A", difficulty: "easy", requires: ["stove"] },
  { id: "b", name: "B", difficulty: "easy", requires: ["stove"] },
  { id: "c", name: "C", difficulty: "easy", requires: ["oven"] },
  { id: "d", name: "D", difficulty: "easy", requires: ["stove"] },
  { id: "x", name: "X", difficulty: "hard", requires: ["stove"] },
];

function ids(recipes) {
  return recipes.map((r) => r.id).sort();
}

// Difficulty grouping is taken from the declared field, not the name.
(function grouping() {
  const pool = new RecipePool(SAMPLE);
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(ids(pool.baseCandidates("hard")), ["x"]);
  console.log("ok  recipes grouped by declared difficulty");
})();

// Disabled recipes are excluded.
(function disabled() {
  const pool = new RecipePool(SAMPLE, { disabled: ["c"] });
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "d"]);
  console.log("ok  disabled recipes excluded");
})();

// Kitchen filtering: only recipes whose requires are all available.
(function kitchen() {
  const pool = new RecipePool(SAMPLE, { kitchen: ["stove"] });
  // c needs an oven -> excluded.
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "d"]);
  pool.setKitchen(null);
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "c", "d"]);
  console.log("ok  kitchen availability filters candidates");
})();

// Currently-cooking recipes are avoided while enough alternatives remain.
// easy = a,b,c,d; cooking A,B leaves c,d as the two fresh options.
(function avoidCooking() {
  const pool = new RecipePool(SAMPLE);
  for (let i = 0; i < 20; i++) {
    const choice = pool.choose("easy", 2, { cookingNames: ["A", "B"] });
    assert.deepStrictEqual(ids(choice), ["c", "d"], "cooking dishes avoided");
  }
  // When more slots than alternatives, a cooking dish is allowed to fill in.
  const filled = pool.choose("easy", 3, { cookingNames: ["A", "B"] });
  assert.strictEqual(filled.length, 3, "fills the third slot from cooking dishes");
  console.log("ok  avoids cooking dishes, fills only when slots exceed alternatives");
})();

// Recently-picked recipes are avoided when alternatives exist...
(function cooldown() {
  const pool = new RecipePool(SAMPLE, { cooldownWindow: 5 });
  pool.recordPicked("a");
  pool.recordPicked("b");
  for (let i = 0; i < 20; i++) {
    const one = pool.chooseOne("easy");
    assert.ok(one.id !== "a" && one.id !== "b", "recent dishes avoided when alternatives exist");
  }
  console.log("ok  cooldown avoids recent dishes when alternatives exist");
})();

// ...but recent dishes still appear when they're the only options left.
(function cooldownFallback() {
  const pool = new RecipePool(SAMPLE, { kitchen: ["stove"], cooldownWindow: 5 });
  // makeable easy = a, b, d. Mark all recent.
  pool.recordPicked("a");
  pool.recordPicked("b");
  pool.recordPicked("d");
  const choice = pool.choose("easy", 3);
  assert.deepStrictEqual(ids(choice), ["a", "b", "d"], "falls back to recent when nothing else");
  console.log("ok  cooldown falls back when no fresh options remain");
})();

// choose returns at most count distinct recipes; empty when nothing makeable.
(function bounds() {
  const pool = new RecipePool(SAMPLE);
  assert.strictEqual(pool.choose("easy", 3).length, 3);
  assert.strictEqual(new Set(pool.choose("easy", 3).map((r) => r.id)).size, 3, "distinct");
  pool.setKitchen(["nothing"]);
  assert.deepStrictEqual(pool.choose("easy", 3), [], "no makeable recipe -> empty");
  assert.strictEqual(pool.chooseOne("easy"), null);
  console.log("ok  choose is bounded, distinct, and empty when unmakeable");
})();

// The real recipes.json loads and is grouped.
(function loadsReal() {
  const pool = loadRecipePool();
  assert.ok(pool.baseCandidates("easy").length >= 3);
  assert.ok(pool.baseCandidates("normal").length >= 3);
  assert.ok(pool.baseCandidates("hard").length >= 3);
  console.log("ok  recipes.json loads into a pool");
})();

console.log("\nAll recipe pool tests passed.");
