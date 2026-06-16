// TikTok adapter: aggregates gift combos (docs/donation-game-rules.md section 3).
//
// Streamable gifts arrive as repeated events with a rising repeatCount and a
// repeatEnd flag on the final one. A combo must produce exactly ONE grant when
// it ends — never one per repeat tick. totalCoins = coinValue * repeatCount.
// Non-combo gifts simply arrive once with repeatEnd = true.

class GiftComboTracker {
  constructor() {
    // comboId -> last seen repeatCount, so a missing repeatEnd is still bounded.
    this.openCombos = new Map();
  }

  // event = { comboId, giftId, giftName?, userId, userName, coinValue, repeatCount, repeatEnd }
  // Returns a normalized /event payload when the combo ends, otherwise null.
  handle(event) {
    if (typeof event.coinValue !== "number" || event.coinValue <= 0) {
      throw new Error("gift needs a positive coinValue");
    }
    if (typeof event.repeatCount !== "number" || event.repeatCount < 1) {
      throw new Error("gift needs a repeatCount >= 1");
    }

    if (!event.repeatEnd) {
      // Combo still streaming — remember progress, emit nothing.
      this.openCombos.set(event.comboId, event.repeatCount);
      return null;
    }

    this.openCombos.delete(event.comboId);

    const totalCoins = event.coinValue * event.repeatCount;

    return {
      platform: "tiktok",
      // One eventId per combo guarantees one grant even if the end event is
      // delivered more than once.
      eventId: `tt-${event.comboId}`,
      donor: { id: event.userId, name: event.userName },
      coins: totalCoins,
      message: "",
      source: {
        giftId: event.giftId,
        giftName: event.giftName || null,
        coinValue: event.coinValue,
        repeatCount: event.repeatCount,
      },
    };
  }

  openComboCount() {
    return this.openCombos.size;
  }
}

module.exports = { GiftComboTracker };
