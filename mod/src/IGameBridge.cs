using System;

namespace CookingSimDonationMod
{
    // The seam between the protocol layer and Cooking Simulator itself.
    // Everything game-specific lives behind this interface so the donation
    // plumbing can be developed and tested without the game.
    public interface IGameBridge
    {
        // Create the in-game order for this grant. Return false if it genuinely
        // cannot be made right now (missing station/ingredient, kitchen full) —
        // the server will then regenerate a different recipe once (section 5).
        bool TryCreateOrder(PendingOrder order);

        // Equipment/ingredient tokens available in the current kitchen, matching
        // the recipes' `requires` tokens. Return null to mean "everything is
        // makeable" (the server treats a null kitchen as unrestricted).
        string[] GetKitchenTokens();

        // Called every frame on the main thread; bridges may poll game state
        // here and raise the events below.
        void Tick(float deltaTime);

        // Raised when an in-game order finishes successfully.
        event Action<string> OrderCompleted;   // eventId

        // Raised when an in-game order is abandoned/failed by the player.
        event Action<string> OrderFailed;      // eventId

        // Raised when the game pauses, resumes, or enters/leaves the main menu.
        // Argument is one of "playing" | "paused" | "menu".
        event Action<string> GameStateChanged;

        // Raised when the available kitchen equipment/ingredients change.
        event Action KitchenChanged;
    }
}
