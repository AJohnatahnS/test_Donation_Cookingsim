// Recipe pool with the selection filters from
// docs/donation-game-rules.md section 8.
//
// A recipe is { id, name, difficulty, requires: [token...] }. Difficulty is
// declared per recipe (never guessed from the name). The pool excludes:
//   - disabled recipes (config.recipePool.disabled)
//   - recipes not makeable in the current kitchen
//   - recipes already cooking, when other options exist
//   - recipes used in the last N orders (cooldown), when other options exist
//
// Kitchen state is null until the Mod reports it; null means "treat all as
// makeable" so the pipeline runs before the Mod exists.

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
    this.byDifficulty = { easy: [], normal: [], hard: [] };

    for (const recipe of recipes) {
      if (!DIFFICULTIES.includes(recipe.difficulty)) {
        throw new Error(`Recipe ${recipe.id} has invalid difficulty: ${recipe.difficulty}`);
      }
      if (!Array.isArray(recipe.requires)) {
        throw new Error(`Recipe ${recipe.id} must list requires`);
      }
      this.byDifficulty[recipe.difficulty].push(recipe);
    }

    this.disabled = new Set(options.disabled || []);
    this.cooldownWindow = options.cooldownWindow ?? 5;
    // null kitchen => everything is makeable (no Mod reporting yet).
    this.kitchen = options.kitchen ? new Set(options.kitchen) : null;
    this.recentIds = [];
  }

  setKitchen(tokens) {
    this.kitchen = tokens ? new Set(tokens) : null;
  }

  isMakeable(recipe) {
    if (!this.kitchen) {
      return true;
    }
    return recipe.requires.every((token) => this.kitchen.has(token));
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
