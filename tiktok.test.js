const assert = require("assert");
const { GiftComboTracker } = require("./tiktok");

// A streaming combo emits nothing until it ends, then one grant with the total.
(function combo() {
  const t = new GiftComboTracker();
  const base = { comboId: "k1", giftId: "rose", userId: "u1", userName: "Alice", coinValue: 100 };

  assert.strictEqual(t.handle({ ...base, repeatCount: 1, repeatEnd: false }), null);
  assert.strictEqual(t.handle({ ...base, repeatCount: 2, repeatEnd: false }), null);
  assert.strictEqual(t.handle({ ...base, repeatCount: 3, repeatEnd: false }), null);
  assert.strictEqual(t.openComboCount(), 1);

  const event = t.handle({ ...base, repeatCount: 5, repeatEnd: true });
  assert.ok(event, "combo end emits an event");
  assert.strictEqual(event.platform, "tiktok");
  assert.strictEqual(event.coins, 500, "totalCoins = coinValue * final repeatCount");
  assert.strictEqual(event.eventId, "tt-k1");
  assert.deepStrictEqual(event.donor, { id: "u1", name: "Alice" });
  assert.strictEqual(t.openComboCount(), 0, "combo cleared after ending");
  console.log("ok  combo aggregates to one grant on end");
})();

// A non-combo gift arrives once with repeatEnd true.
(function single() {
  const t = new GiftComboTracker();
  const event = t.handle({ comboId: "k2", giftId: "heart", userId: "u2", userName: "Bob", coinValue: 5, repeatCount: 1, repeatEnd: true });
  assert.strictEqual(event.coins, 5);
  console.log("ok  single gift emits immediately");
})();

// Two concurrent combos are tracked independently by comboId.
(function concurrent() {
  const t = new GiftComboTracker();
  t.handle({ comboId: "a", giftId: "g", userId: "u1", userName: "A", coinValue: 10, repeatCount: 1, repeatEnd: false });
  t.handle({ comboId: "b", giftId: "g", userId: "u2", userName: "B", coinValue: 20, repeatCount: 1, repeatEnd: false });
  assert.strictEqual(t.openComboCount(), 2);
  const ea = t.handle({ comboId: "a", giftId: "g", userId: "u1", userName: "A", coinValue: 10, repeatCount: 4, repeatEnd: true });
  assert.strictEqual(ea.coins, 40);
  assert.strictEqual(t.openComboCount(), 1, "only combo a cleared");
  console.log("ok  concurrent combos tracked independently");
})();

// Bad payloads are rejected.
(function validation() {
  const t = new GiftComboTracker();
  assert.throws(() => t.handle({ comboId: "x", coinValue: 0, repeatCount: 1, repeatEnd: true }), /positive coinValue/);
  assert.throws(() => t.handle({ comboId: "x", coinValue: 10, repeatCount: 0, repeatEnd: true }), /repeatCount >= 1/);
  console.log("ok  invalid gift payloads rejected");
})();

console.log("\nAll TikTok adapter tests passed.");
