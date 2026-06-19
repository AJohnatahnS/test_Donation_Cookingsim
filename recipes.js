// Recipe pool with the selection filters from
// docs/donation-game-rules.md section 8.
//
// A recipe is { id, name, difficulty, makeable }. `id` is the game's real
// Recipe.Id once the Mod reports its catalog; `makeable` is reported by the
// game (a recipe is makeable when it is unlocked and buildable in the current
// kitchen). Difficulty is declared per recipe and never guessed from the name;
// config.recipePool.difficultyOverrides can re-bucket any recipe id, so the
// operator tunes grouping from real cook-time data (§8) without trusting the
// game's own three-level difficulty blindly.
//
// The pool excludes:
//   - disabled recipes (config.recipePool.disabled)
//   - recipes the game reports as not makeable
//   - recipes already cooking, when other options exist
//   - recipes used in the last N orders (cooldown), when other options exist
//
// Before the Mod connects, the pool is bootstrapped from recipes.json (a
// placeholder catalog) where every recipe is treated as makeable, so the whole
// pipeline runs without the game. setCatalog() then swaps in the real catalog.

const fs = require("fs");
const path = require("path");

const recipesPath = path.join(__dirname, "recipes.json");
const DIFFICULTIES = ["easy", "normal", "hard"];

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class RecipePool {
  constructor(recipes, options = {}) {
    this.disabled = new Set(options.disabled || []);
    this.cooldownWindow = options.cooldownWindow ?? 5;
    this.difficultyOverrides = options.difficultyOverrides || {};
    this.recentIds = [];
    this.setCatalog(recipes);
  }

  // Replaces the entire recipe set — used both at boot (recipes.json) and every
  // time the Mod reports the game's live catalog. The cooldown history is kept
  // so re-reporting the catalog does not reset recent-dish avoidance.
  setCatalog(recipes) {
    this.byDifficulty = { easy: [], normal: [], hard: [] };
    this.byId = new Map();

    for (const recipe of recipes) {
      const difficulty = this.difficultyOverrides[recipe.id] || recipe.difficulty;
      if (!DIFFICULTIES.includes(difficulty)) {
        throw new Error(`Recipe ${recipe.id} has invalid difficulty: ${difficulty}`);
      }
      // Absent makeable means "makeable" — the placeholder catalog and any
      // dev caller that does not know kitchen state get an unrestricted pool.
      const entry = {
        id: recipe.id,
        name: recipe.name,
        difficulty,
        makeable: recipe.makeable !== false,
      };
      this.byDifficulty[difficulty].push(entry);
      this.byId.set(entry.id, entry);
    }
  }

  isMakeable(recipe) {
    return recipe.makeable !== false;
  }

  // Enabled and makeable recipes in a difficulty group.
  baseCandidates(difficulty) {
    return (this.byDifficulty[difficulty] || []).filter(
      (recipe) => !this.disabled.has(recipe.id) && this.isMakeable(recipe),
    );
  }

  // Returns up to `count` distinct recipes, preferring ones that are neither
  // currently cooking nor recently used, but falling back to fill the slots so
  // a viewer always gets choices when any makeable recipe exists.
  choose(difficulty, count, context = {}) {
    const cooking = new Set(context.cookingNames || []);
    const recent = new Set(this.recentIds);
    const base = this.baseCandidates(difficulty);

    const notCookingNotRecent = base.filter((r) => !cooking.has(r.name) && !recent.has(r.id));
    const notCooking = base.filter((r) => !cooking.has(r.name));

    const ordered = [];
    const seen = new Set();

    for (const bucket of [notCookingNotRecent, notCooking, base]) {
      for (const recipe of shuffle(bucket)) {
        if (!seen.has(recipe.id)) {
          seen.add(recipe.id);
          ordered.push(recipe);
        }
      }
    }

    return ordered.slice(0, count);
  }

  chooseOne(difficulty, context = {}) {
    return this.choose(difficulty, 1, context)[0] ?? null;
  }

  // Records a created order so the cooldown window can exclude it next time.
  recordPicked(recipeId) {
    this.recentIds.push(recipeId);
    while (this.recentIds.length > this.cooldownWindow) {
      this.recentIds.shift();
    }
  }
}

function loadRecipePool(options = {}) {
  const parsed = JSON.parse(fs.readFileSync(recipesPath, "utf8"));

  if (!Array.isArray(parsed.recipes) || parsed.recipes.length === 0) {
    throw new Error("recipes.json must contain a non-empty recipes array");
  }

  return new RecipePool(parsed.recipes, options);
}

module.exports = { RecipePool, loadRecipePool };
