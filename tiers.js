const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "config.json");

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  validateConfig(config);
  return config;
}

function validateConfig(config) {
  if (!config.tiers || typeof config.tiers !== "object") {
    throw new Error("config.tiers must be an object");
  }

  for (const platform of ["youtube", "tiktok"]) {
    const section = config[platform];

    if (!section || !Array.isArray(section.thresholds)) {
      throw new Error(`config.${platform}.thresholds must be an array`);
    }

    for (const threshold of section.thresholds) {
      if (typeof threshold.minAmount !== "number") {
        throw new Error(`${platform} threshold needs numeric minAmount`);
      }

      if (!config.tiers[threshold.tier]) {
        throw new Error(`${platform} threshold maps to unknown tier: ${threshold.tier}`);
      }
    }

    // Thresholds must be sorted from highest minAmount to lowest so the
    // first match wins, mirroring the rules.json contract.
    for (let i = 1; i < section.thresholds.length; i++) {
      if (section.thresholds[i].minAmount > section.thresholds[i - 1].minAmount) {
        throw new Error(`${platform} thresholds must be sorted high to low`);
      }
    }
  }
}

// Picks the tier for a money/coins amount using the first matching threshold.
function tierForAmount(thresholds, amount) {
  for (const threshold of thresholds) {
    if (amount >= threshold.minAmount) {
      return threshold.tier;
    }
  }

  return "SUPPORT";
}

// Resolves an incoming event to a tier name.
// event = { platform, amountThb?, coins?, membership? }
function decideTier(config, event) {
  if (event.platform === "youtube") {
    if (event.membership) {
      return decideMembershipTier(config.youtube.membership, event.membership);
    }

    return tierForAmount(config.youtube.thresholds, event.amountThb ?? 0);
  }

  if (event.platform === "tiktok") {
    return tierForAmount(config.tiktok.thresholds, event.coins ?? 0);
  }

  throw new Error(`Unknown platform: ${event.platform}`);
}

// membership = { type: "new" | "renew" | "milestone" | "gift", count? }
function decideMembershipTier(membershipConfig, membership) {
  if (membership.type === "gift") {
    const count = membership.count ?? 1;

    for (const giftTier of membershipConfig.giftTiers) {
      if (count >= giftTier.minCount) {
        return giftTier.tier;
      }
    }

    return "SUPPORT";
  }

  const tier = membershipConfig[membership.type];

  if (!tier) {
    throw new Error(`Unknown membership type: ${membership.type}`);
  }

  return tier;
}

function getTierConfig(config, tierName) {
  const tier = config.tiers[tierName];

  if (!tier) {
    throw new Error(`Unknown tier: ${tierName}`);
  }

  return tier;
}

module.exports = {
  loadConfig,
  validateConfig,
  decideTier,
  decideMembershipTier,
  getTierConfig,
};
