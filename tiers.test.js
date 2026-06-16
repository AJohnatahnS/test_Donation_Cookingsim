const assert = require("assert");
const { loadConfig, decideTier } = require("./tiers");

const config = loadConfig();

function check(label, event, expected) {
  const actual = decideTier(config, event);
  assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
  console.log(`ok  ${label} -> ${actual}`);
}

// YouTube (THB) boundaries from docs/donation-game-rules.md section 2
check("YT 10", { platform: "youtube", amountThb: 10 }, "SUPPORT");
check("YT 20", { platform: "youtube", amountThb: 20 }, "STANDARD");
check("YT 49", { platform: "youtube", amountThb: 49 }, "STANDARD");
check("YT 50", { platform: "youtube", amountThb: 50 }, "VIEWER_CHOICE");
check("YT 100", { platform: "youtube", amountThb: 100 }, "PRIORITY");
check("YT 300", { platform: "youtube", amountThb: 300 }, "CHALLENGE");
check("YT 500", { platform: "youtube", amountThb: 500 }, "HARD_CHALLENGE");
check("YT 1000", { platform: "youtube", amountThb: 1000 }, "BOSS_ORDER");

// TikTok (coins) boundaries from section 3
check("TT 5", { platform: "tiktok", coins: 5 }, "SUPPORT");
check("TT 20", { platform: "tiktok", coins: 20 }, "STANDARD");
check("TT 100", { platform: "tiktok", coins: 100 }, "VIEWER_CHOICE");
check("TT 500", { platform: "tiktok", coins: 500 }, "PRIORITY");
check("TT 1000", { platform: "tiktok", coins: 1000 }, "CHALLENGE");
check("TT 3000", { platform: "tiktok", coins: 3000 }, "HARD_CHALLENGE");
check("TT 10000", { platform: "tiktok", coins: 10000 }, "BOSS_ORDER");

// Membership mapping from section 2
check("YT member new", { platform: "youtube", membership: { type: "new" } }, "VIEWER_CHOICE");
check("YT member renew", { platform: "youtube", membership: { type: "renew" } }, "STANDARD");
check("YT gift 3", { platform: "youtube", membership: { type: "gift", count: 3 } }, "PRIORITY");
check("YT gift 7", { platform: "youtube", membership: { type: "gift", count: 7 } }, "CHALLENGE");
check("YT gift 12", { platform: "youtube", membership: { type: "gift", count: 12 } }, "BOSS_ORDER");

console.log("\nAll tier tests passed.");
