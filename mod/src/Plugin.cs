using BepInEx;
using BepInEx.Configuration;
using BepInEx.Logging;
using UnityEngine;

namespace CookingSimDonationMod
{
    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "com.monitise.cookingsim.donation";
        public const string Name = "Cooking Sim Donation Mod";
        public const string Version = "0.1.0";

        internal static ManualLogSource Log;

        private void Awake()
        {
            Log = Logger;

            var baseUrl = Config.Bind("Server", "BaseUrl", "http://127.0.0.1:3000",
                "Donation server base URL").Value;
            var pollMs = Config.Bind("Server", "PollIntervalMs", 400,
                "How often to poll /pending, in milliseconds").Value;
            var useSimulated = Config.Bind("Game", "UseSimulatedBridge", true,
                "Use the fake game bridge (true) to test the server link without the game, " +
                "or the real Cooking Simulator bridge (false)").Value;
            var simCookSeconds = Config.Bind("Game", "SimulatedCookSeconds", 5f,
                "How long the simulated bridge 'cooks' each order").Value;

            IGameBridge bridge = useSimulated
                ? (IGameBridge)new SimulatedGameBridge(simCookSeconds)
                : new CookingSimGameBridge();

            var host = new GameObject("DonationRuntime");
            DontDestroyOnLoad(host);
            host.hideFlags = HideFlags.HideAndDontSave;
            host.AddComponent<DonationRuntime>().Init(new ProtocolClient(baseUrl), bridge, pollMs);

            Log.LogInfo($"{Name} {Version} loaded — server {baseUrl}, " +
                        (useSimulated ? "simulated bridge" : "Cooking Simulator bridge"));
        }
    }
}
