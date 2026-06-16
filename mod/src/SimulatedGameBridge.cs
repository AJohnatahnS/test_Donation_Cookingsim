using System;
using System.Collections.Generic;

namespace CookingSimDonationMod
{
    // A fully working bridge that fakes the game, so the mod can be run against
    // a live `node server.js` to validate the HTTP integration before the real
    // Cooking Simulator hooks exist. It "cooks" every order for a short fixed
    // time, then reports completion.
    public class SimulatedGameBridge : IGameBridge
    {
        public event Action<string> OrderCompleted;
        public event Action<string> OrderFailed;
        public event Action<string> GameStateChanged;
        public event Action KitchenChanged;

        private readonly float cookSeconds;
        private readonly Dictionary<string, float> cooking = new Dictionary<string, float>();

        public SimulatedGameBridge(float cookSeconds)
        {
            this.cookSeconds = cookSeconds;
        }

        public bool TryCreateOrder(PendingOrder order)
        {
            Plugin.Log.LogInfo($"[sim] cooking {order.tier} '{order.recipe}' for {order.donor} ({cookSeconds}s)");
            cooking[order.eventId] = cookSeconds;
            return true;
        }

        public string[] GetKitchenTokens()
        {
            // null => server treats the kitchen as unrestricted.
            return null;
        }

        public void Tick(float deltaTime)
        {
            if (cooking.Count == 0)
            {
                return;
            }

            List<string> done = null;
            // Copy keys so we can mutate the dictionary while iterating.
            foreach (var eventId in new List<string>(cooking.Keys))
            {
                float left = cooking[eventId] - deltaTime;
                if (left <= 0f)
                {
                    cooking.Remove(eventId);
                    (done ??= new List<string>()).Add(eventId);
                }
                else
                {
                    cooking[eventId] = left;
                }
            }

            if (done != null)
            {
                foreach (var eventId in done)
                {
                    Plugin.Log.LogInfo("[sim] completed " + eventId);
                    OrderCompleted?.Invoke(eventId);
                }
            }
        }

        // Keep the compiler from warning about events the simulation never raises.
        private void Unused()
        {
            OrderFailed?.Invoke(null);
            GameStateChanged?.Invoke(null);
            KitchenChanged?.Invoke();
        }
    }
}
