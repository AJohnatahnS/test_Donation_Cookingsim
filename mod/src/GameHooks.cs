using System;
using HarmonyLib;

namespace CookingSimDonationMod
{
    // Harmony patches into Cooking Simulator's base-career order system
    // (FoodNetworkManager) and game state (GameManager), discovered from the
    // game's Assembly-CSharp.dll — see docs/cooking-sim-internals.md.
    //
    // The patches only RAISE static relay events; CookingSimGameBridge maps them
    // back to donation eventIds. Signatures verified against the installed DLL;
    // in-game SEMANTICS still marked VERIFY.
    internal static class GameHooks
    {
        public static event Action<int> OrderEnded;          // Recipe.Id
        public static event Action<int> OrderFailed;         // Recipe.Id
        public static event Action<bool, bool> GameStateChanged; // (paused, isMenu)

        internal static void RaiseOrderEnded(int recipeId) => OrderEnded?.Invoke(recipeId);
        internal static void RaiseOrderFailed(int recipeId) => OrderFailed?.Invoke(recipeId);
        internal static void RaiseGameState(bool paused, bool isMenu) => GameStateChanged?.Invoke(paused, isMenu);
    }

    // FoodNetworkManager.OrderEnd(Recipe) — order completed. The method is PRIVATE,
    // so patch by string name; Harmony injects the argument by its real name `recipe`.
    [HarmonyPatch(typeof(FoodNetworkManager), "OrderEnd")]
    internal static class Patch_OrderEnd
    {
        static void Postfix(Recipe recipe)
        {
            if (recipe != null) GameHooks.RaiseOrderEnded(recipe.Id);
        }
    }

    // FoodNetworkManager.OrderCancel(Recipe) — order abandoned/failed (also private).
    [HarmonyPatch(typeof(FoodNetworkManager), "OrderCancel")]
    internal static class Patch_OrderCancel
    {
        static void Postfix(Recipe recipe)
        {
            if (recipe != null) GameHooks.RaiseOrderFailed(recipe.Id);
        }
    }

    // GameManager.Paused and DuringGame are STATIC properties — there is no
    // GameStateChanged event nor instance singleton to read here. Patch their
    // static setters and read the statics back. isMenu is derived as !DuringGame
    // (GameManager.IsMenu is instance-only and unusable from a static-set patch).
    [HarmonyPatch(typeof(GameManager), "set_Paused")]
    internal static class Patch_SetPaused
    {
        static void Postfix()
        {
            GameHooks.RaiseGameState(GameManager.Paused, !GameManager.DuringGame);
        }
    }

    // set_DuringGame fires on entering/leaving gameplay (menu transitions).
    [HarmonyPatch(typeof(GameManager), "set_DuringGame")]
    internal static class Patch_SetDuringGame
    {
        static void Postfix()
        {
            GameHooks.RaiseGameState(GameManager.Paused, !GameManager.DuringGame);
        }
    }
}
