using System;

namespace CookingSimDonationMod
{
    // Real bridge into Cooking Simulator. The method bodies are the only places
    // that need the game's own classes; everything else in this mod is already
    // complete. Fill these in against the game's assemblies (Assembly-CSharp)
    // and raise the events as in-game things happen.
    //
    // Hook strategy (BepInEx + HarmonyX):
    //   * TryCreateOrder  -> call the game's order/queue manager to spawn an
    //     order for `recipeId`. Use a RUNTIME unlock so the recipe is craftable
    //     only while the mod is active — never write unlock state to the save
    //     (spec section 1). Verify the recipe is makeable in the current kitchen
    //     first; return false if not.
    //   * OrderCompleted/OrderFailed -> Harmony-patch the game's order-complete
    //     and order-expire/abandon methods; look up the eventId by the order
    //     handle you stored in TryCreateOrder, then raise the event.
    //   * GameStateChanged -> patch pause/unpause and scene/menu transitions.
    //     Do NOT drive timing with Time.timeScale; just report state and let the
    //     server hold the clock (spec section 6).
    //   * GetKitchenTokens/KitchenChanged -> read the active appliances and
    //     ingredient sources; map them to the same tokens used in recipes.json.
    public class CookingSimGameBridge : IGameBridge
    {
        public event Action<string> OrderCompleted;
        public event Action<string> OrderFailed;
        public event Action<string> GameStateChanged;
        public event Action KitchenChanged;

        // Map your in-game order handle to the donation eventId here, e.g.
        // private readonly Dictionary<GameOrder, string> byOrder = new();

        public bool TryCreateOrder(PendingOrder order)
        {
            // TODO: create the in-game order for order.recipeId and store the
            // handle so OrderCompleted/OrderFailed can resolve it to eventId.
            Plugin.Log.LogWarning(
                "CookingSimGameBridge.TryCreateOrder is not wired to the game yet: " +
                order.recipeId);
            return false;
        }

        public string[] GetKitchenTokens()
        {
            // TODO: return the tokens available in the current kitchen.
            // null = unrestricted until this is implemented.
            return null;
        }

        public void Tick(float deltaTime)
        {
            // TODO: optionally poll pause/menu and kitchen state, raising
            // GameStateChanged / KitchenChanged when they change. Prefer Harmony
            // patches over per-frame polling where the game exposes events.
        }

        // Call these from your Harmony patches:
        protected void RaiseCompleted(string eventId) => OrderCompleted?.Invoke(eventId);
        protected void RaiseFailed(string eventId) => OrderFailed?.Invoke(eventId);
        protected void RaiseGameState(string state) => GameStateChanged?.Invoke(state);
        protected void RaiseKitchenChanged() => KitchenChanged?.Invoke();
    }
}
