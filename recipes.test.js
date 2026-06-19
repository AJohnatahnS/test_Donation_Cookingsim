const assert = require("assert");
const { RecipePool, loadRecipePool } = require("./recipes");

const SAMPLE = [
  { id: "a", name: "A", difficulty: "easy" },
  { id: "b", name: "B", difficulty: "easy" },
  { id: "c", name: "C", difficulty: "easy" },
  { id: "d", name: "D", difficulty: "easy" },
  { id: "x", name: "X", difficulty: "hard" },
];

// Builds a sample where the listed ids are not makeable.
function withUnmakeable(unmakeableIds) {
  const set = new Set(unmakeableIds);
  return SAMPLE.map((r) => ({ ...r, makeable: !set.has(r.id) }));
}

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

// config.recipePool.difficultyOverrides re-buckets a recipe by id (§8), and is
// reapplied when a fresh catalog arrives.
(function difficultyOverrides() {
  const pool = new RecipePool(SAMPLE, { difficultyOverrides: { a: "hard" } });
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["b", "c", "d"]);
  assert.deepStrictEqual(ids(pool.baseCandidates("hard")), ["a", "x"]);
  pool.setCatalog(SAMPLE); // re-report: override still applies
  assert.deepStrictEqual(ids(pool.baseCandidates("hard")), ["a", "x"]);
  console.log("ok  difficultyOverrides re-bucket by id and survive re-catalog");
})();

// Makeability comes from the catalog's makeable flag (game-reported).
(function makeable() {
  const pool = new RecipePool(withUnmakeable(["c"]));
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "d"]);
  // A new catalog with c makeable again restores it.
  pool.setCatalog(SAMPLE);
  assert.deepStrictEqual(ids(pool.baseCandidates("easy")), ["a", "b", "c", "d"]);
  console.log("ok  makeable flag filters candidates and tracks the catalog");
})();

// setCatalog preserves the cooldown history (re-reporting doesn't reset it).
(function catalogKeepsCooldown() {
  const pool = new RecipePool(SAMPLE, { cooldownWindow: 5 });
  pool.recordPicked("a");
  pool.setCatalog(SAMPLE);
  for (let i = 0; i < 20; i++) {
    assert.ok(pool.chooseOne("easy").id !== "a", "recent dish still avoided after re-catalog");
  }
  console.log("ok  setCatalog keeps cooldown history");
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
  const pool = new RecipePool(withUnmakeable(["c"]), { cooldownWindow: 5 });
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
  pool.setCatalog(SAMPLE.map((r) => ({ ...r, makeable: false })));
  assert.deepStrictEqual(pool.choose("easy", 3), [], "no makeable recipe -> empty");
  assert.strictEqual(pool.chooseOne("easy"), null);
  console.log("ok  choose is bounded, distinct, and empty when unmakeable");
})();

// The placeholder recipes.json loads and is grouped.
(function loadsReal() {
  const pool = loadRecipePool();
  assert.ok(pool.baseCandidates("easy").length >= 3);
  assert.ok(pool.baseCandidates("normal").length >= 3);
  assert.ok(pool.baseCandidates("hard").length >= 3);
  console.log("ok  recipes.json loads into a pool");
})();

console.log("\nAll recipe pool tests passed.");
