// Minimal recipe provider grouped by difficulty.
//
// NOTE: this is the v1 seam for docs/donation-game-rules.md section 8. The full
// version must also apply kitchen-availability filtering, a 5-order cooldown,
// and the configurable disabled list. For now it just returns random recipes
// from the difficulty group so menu selection can be built and tested.

const fs = require("fs");
const path = require("path");

const recipesPath = path.join(__dirname, "recipes.json");

function loadRecipes() {
  const recipes = JSON.parse(fs.readFileSync(recipesPath, "utf8"));

  for (const group of ["easy", "normal", "hard"]) {
    if (!Array.isArray(recipes[group]) || recipes[group].length === 0) {
      throw new Error(`recipes.${group} must be a non-empty array`);
    }
  }

  return recipes;
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Returns up to `count` distinct recipes from the difficulty group. If the
// group has fewer than `count`, returns whatever is available (spec section 4).
function pickChoices(recipes, difficulty, count) {
  const group = recipes[difficulty] || [];
  return shuffle(group).slice(0, count);
}

function pickOne(recipes, difficulty) {
  const group = recipes[difficulty] || [];
  return group[Math.floor(Math.random() * group.length)];
}

module.exports = { loadRecipes, pickChoices, pickOne };
