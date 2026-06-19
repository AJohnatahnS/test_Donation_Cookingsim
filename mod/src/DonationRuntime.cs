using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace CookingSimDonationMod
{
    // Drives the donation loop on the Unity main thread:
    //   * polls GET /pending and creates orders through the bridge, then POSTs
    //     /confirm with the result
    //   * forwards bridge events (completed/failed/state/catalog) to the server
    public class DonationRuntime : MonoBehaviour
    {
        private ProtocolClient client;
        private IGameBridge bridge;
        private float pollSeconds;

        // eventIds currently being confirmed, so overlapping polls don't
        // double-handle the same dispatched order.
        private readonly HashSet<string> inFlight = new HashSet<string>();

        public void Init(ProtocolClient client, IGameBridge bridge, int pollIntervalMs)
        {
            this.client = client;
            this.bridge = bridge;
            this.pollSeconds = Mathf.Max(0.05f, pollIntervalMs / 1000f);

            bridge.OrderCompleted += eventId => StartCoroutine(client.Finish(eventId, "COMPLETED"));
            bridge.OrderFailed += eventId => StartCoroutine(client.Finish(eventId, "FAILED"));
            bridge.GameStateChanged += state => StartCoroutine(client.Game(state));
            bridge.CatalogChanged += PushCatalog;

            PushCatalog();
            StartCoroutine(PollLoop());
        }

        private void Update()
        {
            bridge.Tick(Time.unscaledDeltaTime);
        }

        private IEnumerator PollLoop()
        {
            var wait = new WaitForSecondsRealtime(pollSeconds);

            while (true)
            {
                PendingOrder[] pending = null;
                yield return StartCoroutine(client.GetPending(result => pending = result));

                if (pending != null)
                {
                    foreach (var order in pending)
                    {
                        if (inFlight.Contains(order.eventId))
                        {
                            continue;
                        }

                        inFlight.Add(order.eventId);

                        bool created = false;
                        try { created = bridge.TryCreateOrder(order); }
                        catch (System.Exception e) { Plugin.Log.LogError("TryCreateOrder threw: " + e); }

                        string eventId = order.eventId;
                        yield return StartCoroutine(client.Confirm(eventId, created, _ => inFlight.Remove(eventId)));
                    }
                }

                yield return wait;
            }
        }

        private void PushCatalog()
        {
            CatalogEntry[] recipes = bridge.GetRecipeCatalog();
            // null means "nothing to report yet"; the server keeps its pool.
            if (recipes != null && recipes.Length > 0)
            {
                StartCoroutine(client.Catalog(recipes));
            }
        }
    }
}
