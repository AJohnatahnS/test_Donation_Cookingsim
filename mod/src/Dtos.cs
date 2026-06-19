using System;

namespace CookingSimDonationMod
{
    // Wire types for docs/mod-protocol.md. All are [Serializable] so Unity's
    // built-in JsonUtility can (de)serialize them without an extra JSON library.

    [Serializable]
    public class PendingOrder
    {
        public string eventId;
        public string tier;
        public string recipe;
        public string recipeId;
        public string donor;
        public int cookMinutes; // 0 = untimed (Standard / Viewer Choice)
    }

    [Serializable]
    public class PendingResponse
    {
        public PendingOrder[] pending;
    }

    [Serializable]
    public class ConfirmRequest
    {
        public string eventId;
        public bool ok;
    }

    [Serializable]
    public class ConfirmResponse
    {
        public bool ok;
        public string state; // "COOKING" | "DISPATCHED" | "FAILED"
        public string recipe;
        public string eventId;
    }

    [Serializable]
    public class FinishRequest
    {
        public string eventId;
        public string outcome; // COMPLETED | EXPIRED | FAILED | CANCELLED
    }

    [Serializable]
    public class GameRequest
    {
        public string state; // "playing" | "paused" | "menu"
    }

    [Serializable]
    public class CatalogEntry
    {
        public string id;          // game Recipe.Id as a string
        public string name;
        public string difficulty;  // "easy" | "normal" | "hard"
        public bool makeable;      // unlocked and buildable in the current kitchen
    }

    [Serializable]
    public class CatalogRequest
    {
        public CatalogEntry[] recipes;
    }
}
