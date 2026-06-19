using System;
using System.Collections.Generic;
using BepInEx.Configuration;
using UnityEngine;

namespace CookingSimDonationMod
{
    // "Stream mode": a streamer-facing cheat that, on a single key press, unlocks
    // everything in the base career — all player abilities, the whole perk/skill
    // tree, and every recipe. Independent of the donation pipeline: it works
    // whether or not the donation server is running.
    //
    // The targets below come from Assembly-CSharp.dll (see
    // docs/cooking-sim-internals.md, "Stream mode unlock-all"):
    //   - Player.Me.UnlockAllAbilitiesForSchool()  (public static field Me)
    //   - SkillSystem.Me.UnlockAllPerks() + UpgradeAllSkills()  (TemporalSingleton)
    //   - RecipesManager.Me: foreach Recipes -> UnlockRecipe(r,false,false,false)
    // All members verified public against the installed DLL. The calls are wrapped
    // and null-guarded so an absent singleton (e.g. in the main menu) is a no-op
    // rather than an exception. Marked VERIFY: in-game behaviour not yet confirmed.
    public class StreamModeController : MonoBehaviour
    {
        private KeyCode _hotkey = KeyCode.F8;
        private bool _enabled = true;

        public void Configure(ConfigFile config)
        {
            _enabled = config.Bind("StreamMode", "Enabled", true,
                "Enable the Stream-mode unlock-all hotkey.").Value;
            _hotkey = config.Bind("StreamMode", "Hotkey", KeyCode.F8,
                "Key that unlocks all skills, perks, abilities and recipes.").Value;

            if (_enabled)
                Plugin.Log.LogInfo($"Stream mode armed — press {_hotkey} to unlock all skills & recipes.");
        }

        private void Update()
        {
            if (!_enabled) return;
            if (Input.GetKeyDown(_hotkey))
                UnlockEverything();
        }

        // Public so a future server/overlay trigger can call it too.
        public void UnlockEverything()
        {
            Plugin.Log.LogInfo("Stream mode: unlocking all skills & recipes…");
            UnlockAbilities();
            UnlockPerksAndSkills();
            UnlockAllRecipes();
            Plugin.Log.LogInfo("Stream mode: done.");
        }

        private static void UnlockAbilities()
        {
            try
            {
                var player = Player.Me;
                if (player == null)
                {
                    Plugin.Log.LogWarning("Stream mode: Player.Me is null — skipping abilities (not in a kitchen?).");
                    return;
                }
                player.UnlockAllAbilitiesForSchool();
                Plugin.Log.LogInfo("Stream mode: unlocked all player abilities.");
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Stream mode: failed to unlock abilities — " + e.Message);
            }
        }

        private static void UnlockPerksAndSkills()
        {
            try
            {
                var skills = SkillSystem.Me;
                if (skills == null)
                {
                    Plugin.Log.LogWarning("Stream mode: SkillSystem.Me is null — skipping perks/skills.");
                    return;
                }
                skills.UnlockAllPerks();
                skills.UpgradeAllSkills();
                Plugin.Log.LogInfo("Stream mode: unlocked all perks and maxed all skills.");
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Stream mode: failed to unlock perks/skills — " + e.Message);
            }
        }

        private static void UnlockAllRecipes()
        {
            try
            {
                var rm = RecipesManager.Me;
                if (rm == null || rm.Recipes == null)
                {
                    Plugin.Log.LogWarning("Stream mode: RecipesManager.Me/Recipes is null — skipping recipes.");
                    return;
                }

                // Snapshot first: UnlockRecipe mutates the manager's internal lists.
                var all = new List<Recipe>(rm.Recipes);
                int unlocked = 0;
                foreach (var recipe in all)
                {
                    if (recipe == null) continue;
                    // payCP=false (free), notifyProducts=false, notifyRecipe=false:
                    // bulk-unlock silently. UnlockRecipe is a no-op for already-known
                    // recipes, so this is idempotent.
                    if (rm.UnlockRecipe(recipe, false, false, false))
                        unlocked++;
                }
                Plugin.Log.LogInfo($"Stream mode: unlocked {unlocked} recipe(s) (of {all.Count} in catalog).");
            }
            catch (Exception e)
            {
                Plugin.Log.LogError("Stream mode: failed to unlock recipes — " + e.Message);
            }
        }
    }
}
