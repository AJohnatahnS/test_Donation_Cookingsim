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

        // The game's live recipe catalog: real Recipe.Ids with their difficulty
        // bucket and current makeability (unlocked + buildable in this kitchen).
        // Return null to skip reporting (the server keeps its current pool).
        CatalogEntry[] GetRecipeCatalog();

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

        // Raised when the recipe catalog changes (unlock/kitchen change), so the
        // mod re-reports it to the server.
        event Action CatalogChanged;
    }
}
