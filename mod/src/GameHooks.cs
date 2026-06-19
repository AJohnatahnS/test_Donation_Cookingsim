using System;
using HarmonyLib;

namespace CookingSimDonationMod
{
    // Harmony patches into Cooking Simulator's base-career order system
    // (FoodNetworkManager) and game state (GameManager), discovered from the
    // game's Assembly-CSharp.dll — see docs/cooking-sim-internals.md.
    //
    // The patches only RAISE static relay events; CookingSimGameBridge maps them
    // back to donation eventIds. Targets/signatures are taken from the DLL but
    // NOT yet verified in-game (marked VERIFY).
    internal static class GameHooks
    {
        public static event Action<int> OrderEnded;          // Recipe.Id
        public static event Action<int> OrderFailed;         // Recipe.Id
        public static event Action<bool, bool> GameStateChanged; // (paused, isMenu)

        internal static void RaiseOrderEnded(int recipeId) => OrderEnded?.Invoke(recipeId);
        internal static void RaiseOrderFailed(int recipeId) => OrderFailed?.Invoke(recipeId);

        // GameManager.Paused and GameManager.DuringGame are both STATIC in this build,
        // and IsMenu is an instance member with no singleton accessor — so we derive
        // the (paused, isMenu) pair from the static pair instead of needing an instance.
        // VERIFY in-game that DuringGame flips false exactly on the menu/non-gameplay
        // screens you care about (loading screens may also report false).
        internal static void RaiseCurrentState()
            => GameStateChanged?.Invoke(GameManager.Paused, !GameManager.DuringGame);
    }

    // FoodNetworkManager.OrderEnd(Recipe recipe) — order completed.
    // Private method: patched by name string (nameof won't see a private member),
    // and the parameter is injected by its real name `recipe` (confirmed in the DLL).
    [HarmonyPatch(typeof(FoodNetworkManager), "OrderEnd")]
    internal static class Patch_OrderEnd
    {
        static void Postfix(Recipe recipe)
        {
            if (recipe != null) GameHooks.RaiseOrderEnded(recipe.CoreId.Id);
        }
    }

    // FoodNetworkManager.OrderCancel(Recipe recipe) — order abandoned/failed (private).
    [HarmonyPatch(typeof(FoodNetworkManager), "OrderCancel")]
    internal static class Patch_OrderCancel
    {
        static void Postfix(Recipe recipe)
        {
            if (recipe != null) GameHooks.RaiseOrderFailed(recipe.CoreId.Id);
        }
    }

    // GameManager.set_Paused(bool) — pause/resume. Static setter, so no __instance.
    [HarmonyPatch(typeof(GameManager), "set_Paused")]
    internal static class Patch_SetPaused
    {
        static void Postfix() => GameHooks.RaiseCurrentState();
    }

    // GameManager.set_GameState(GameState) — entering/leaving menu, mode changes.
    [HarmonyPatch(typeof(GameManager), "set_GameState")]
    internal static class Patch_SetGameState
    {
        static void Postfix() => GameHooks.RaiseCurrentState();
    }
}
