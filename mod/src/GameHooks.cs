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
        internal static void RaiseGameState(bool paused, bool isMenu) => GameStateChanged?.Invoke(paused, isMenu);
    }

    // FoodNetworkManager.OrderEnd(Recipe) — order completed.
    [HarmonyPatch(typeof(FoodNetworkManager), nameof(FoodNetworkManager.OrderEnd))]
    internal static class Patch_OrderEnd
    {
        // __0 = the Recipe argument. VERIFY the param order in-game.
        static void Postfix(Recipe __0)
        {
            if (__0 != null) GameHooks.RaiseOrderEnded(__0.Id);
        }
    }

    // FoodNetworkManager.OrderCancel(Recipe) — order abandoned/failed.
    [HarmonyPatch(typeof(FoodNetworkManager), nameof(FoodNetworkManager.OrderCancel))]
    internal static class Patch_OrderCancel
    {
        static void Postfix(Recipe __0)
        {
            if (__0 != null) GameHooks.RaiseOrderFailed(__0.Id);
        }
    }

    // GameManager.set_Paused(bool) — pause/resume.
    [HarmonyPatch(typeof(GameManager), "set_Paused")]
    internal static class Patch_SetPaused
    {
        static void Postfix(GameManager __instance)
        {
            GameHooks.RaiseGameState(__instance.Paused, __instance.IsMenu);
        }
    }

    // GameManager.set_GameState(GameState) — entering/leaving menu, mode changes.
    [HarmonyPatch(typeof(GameManager), "set_GameState")]
    internal static class Patch_SetGameState
    {
        static void Postfix(GameManager __instance)
        {
            GameHooks.RaiseGameState(__instance.Paused, __instance.IsMenu);
        }
    }
}
