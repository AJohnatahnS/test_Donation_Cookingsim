using System;
using System.Collections.Generic;
using System.Linq;

namespace CookingSimDonationMod
{
    // Real bridge into Cooking Simulator's base-career order system, wired to the
    // classes found in Assembly-CSharp.dll (see docs/cooking-sim-internals.md).
    //
    // IMPORTANT: this draft references the real game API but has NOT been built
    // or run in this repo (the game assemblies + BepInEx are needed). Lines
    // marked VERIFY must be confirmed in-game.
    //
    // Design assumption (see internals doc, mismatch #2): the server sends the
    // game's own Recipe.Id (as a string) in `recipeId`, so the recipe pool is
    // driven by the game's real base-game recipes. Also set
    // config.queue.maxConcurrentOrders = 1, because the base career serves one
    // dish at a time (mismatch #1).
    public class CookingSimGameBridge : IGameBridge
    {
        public event Action<string> OrderCompleted;
        public event Action<string> OrderFailed;
        public event Action<string> GameStateChanged;
        public event Action KitchenChanged;

        // game Recipe.Id -> donation eventId, set when we force an order.
        private readonly Dictionary<int, string> recipeToEvent = new Dictionary<int, string>();

        public CookingSimGameBridge()
        {
            GameHooks.OrderEnded += OnGameOrderEnded;
            GameHooks.OrderFailed += OnGameOrderFailed;
            GameHooks.GameStateChanged += OnGameStateChanged;
        }

        public bool TryCreateOrder(PendingOrder order)
        {
            var fnm = FoodNetworkManager.Me; // confirmed singleton accessor
            if (fnm == null)
            {
                Plugin.Log.LogWarning("FoodNetworkManager.Me is null (not in Food Network mode?)");
                return false;
            }

            if (!int.TryParse(order.recipeId, out int gameId))
            {
                Plugin.Log.LogWarning("recipeId is not a game Recipe.Id: " + order.recipeId);
                return false;
            }

            // Find the recipe among the base-game Food Network dishes. VERIFY that
            // FoodnetworkDish is the right source and is populated at this point.
            Recipe recipe = fnm.FoodnetworkDish.FirstOrDefault(r => r != null && r.Id == gameId);
            if (recipe == null || !recipe.BaseGameRecipe)
            {
                Plugin.Log.LogWarning($"recipe {gameId} not found / not base game");
                return false; // server will regenerate or fail (section 5)
            }

            // Force this recipe as the next order. VERIFY this triggers an order
            // on demand within OrderLoop's cadence.
            fnm.SetDebugRecipesOrder(true, recipe);
            recipeToEvent[recipe.Id] = order.eventId;
            Plugin.Log.LogInfo($"forced order recipe {recipe.Id} for {order.donor}");
            return true;
        }

        public string[] GetKitchenTokens()
        {
            // Base-game makeability is handled by only offering BaseGameRecipe
            // recipes the game reports; no token mapping needed. Return null
            // (unrestricted) until/unless finer filtering is wanted.
            return null;
        }

        public void Tick(float deltaTime)
        {
            // Event-driven via Harmony patches; nothing to poll.
        }

        private void OnGameOrderEnded(int recipeId)
        {
            if (recipeToEvent.TryGetValue(recipeId, out string eventId))
            {
                recipeToEvent.Remove(recipeId);
                OrderCompleted?.Invoke(eventId);
            }
        }

        private void OnGameOrderFailed(int recipeId)
        {
            if (recipeToEvent.TryGetValue(recipeId, out string eventId))
            {
                recipeToEvent.Remove(recipeId);
                OrderFailed?.Invoke(eventId);
            }
        }

        private void OnGameStateChanged(bool paused, bool isMenu)
        {
            string state = isMenu ? "menu" : paused ? "paused" : "playing";
            GameStateChanged?.Invoke(state);
            KitchenChanged?.Invoke(); // kitchen may differ after a scene change
        }
    }
}
