// YouTube adapter: normalizes Super Chat / Super Sticker / membership events
// into the canonical /event payload (docs/donation-game-rules.md section 2).
//
// The raw shapes here mirror the fields the YouTube liveChatMessages API
// exposes (flattened for clarity). Amounts arrive in micros of the original
// currency and must be converted to THB before tiering, keeping the original
// amount, currency, and rate on the record.

function round2(value) {
  return Math.round(value * 100) / 100;
}

// raw = { id, authorChannelId, authorName, amountMicros, currency, comment, kind? }
// rates = { CUR: rateToThb, ... }
function normalizeSuperChat(raw, rates) {
  if (typeof raw.amountMicros !== "number" || raw.amountMicros <= 0) {
    throw new Error("super chat needs a positive amountMicros");
  }

  const rate = rates[raw.currency];

  if (typeof rate !== "number") {
    throw new Error(`No THB exchange rate configured for currency: ${raw.currency}`);
  }

  const originalAmount = raw.amountMicros / 1_000_000;
  const amountThb = round2(originalAmount * rate);

  return {
    platform: "youtube",
    eventId: raw.id,
    donor: { id: raw.authorChannelId, name: raw.authorName },
    amountThb,
    message: raw.comment || "",
    source: {
      kind: raw.kind || "superchat",
      original: { amount: round2(originalAmount), currency: raw.currency, rate },
      amountThb,
    },
  };
}

// raw = { id, authorChannelId, authorName, type: "new"|"renew"|"milestone"|"gift", giftCount? }
function normalizeMembership(raw) {
  let membership;

  if (raw.type === "gift") {
    if (typeof raw.giftCount !== "number" || raw.giftCount < 1) {
      throw new Error("gift membership needs a positive giftCount");
    }
    membership = { type: "gift", count: raw.giftCount };
  } else if (["new", "renew", "milestone"].includes(raw.type)) {
    membership = { type: raw.type };
  } else {
    throw new Error(`Unknown membership type: ${raw.type}`);
  }

  return {
    platform: "youtube",
    eventId: raw.id,
    donor: { id: raw.authorChannelId, name: raw.authorName },
    membership,
    message: "",
    source: { kind: "membership" },
  };
}

module.exports = { normalizeSuperChat, normalizeMembership };
