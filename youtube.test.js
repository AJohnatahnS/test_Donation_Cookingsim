const assert = require("assert");
const { normalizeSuperChat, normalizeMembership } = require("./youtube");

const rates = { THB: 1, USD: 36.5, JPY: 0.23 };

// THB super chat passes through unconverted.
(function thb() {
  const e = normalizeSuperChat(
    { id: "m1", authorChannelId: "c1", authorName: "Alice", amountMicros: 50_000_000, currency: "THB", comment: "hi" },
    rates,
  );
  assert.strictEqual(e.platform, "youtube");
  assert.strictEqual(e.eventId, "m1");
  assert.deepStrictEqual(e.donor, { id: "c1", name: "Alice" });
  assert.strictEqual(e.amountThb, 50);
  assert.strictEqual(e.message, "hi");
  console.log("ok  THB super chat normalized");
})();

// Foreign currency is converted to THB and keeps the original on the record.
(function usd() {
  const e = normalizeSuperChat(
    { id: "m2", authorChannelId: "c2", authorName: "Bob", amountMicros: 2_000_000, currency: "USD" },
    rates,
  );
  assert.strictEqual(e.amountThb, 73); // 2 USD * 36.5
  assert.deepStrictEqual(e.source.original, { amount: 2, currency: "USD", rate: 36.5 });
  console.log("ok  USD converted to THB, original preserved");
})();

// Unknown currency is rejected (must be configured).
(function unknownCurrency() {
  assert.throws(
    () => normalizeSuperChat({ id: "m3", authorChannelId: "c", authorName: "X", amountMicros: 1_000_000, currency: "AUD" }, rates),
    /No THB exchange rate/,
  );
  console.log("ok  unknown currency rejected");
})();

// Membership events map to the membership object the tier engine expects.
(function membership() {
  const nw = normalizeMembership({ id: "n1", authorChannelId: "c", authorName: "N", type: "new" });
  assert.deepStrictEqual(nw.membership, { type: "new" });

  const gift = normalizeMembership({ id: "g1", authorChannelId: "c", authorName: "G", type: "gift", giftCount: 5 });
  assert.deepStrictEqual(gift.membership, { type: "gift", count: 5 });

  assert.throws(() => normalizeMembership({ id: "g2", authorChannelId: "c", authorName: "G", type: "gift" }), /positive giftCount/);
  assert.throws(() => normalizeMembership({ id: "x", authorChannelId: "c", authorName: "G", type: "bogus" }), /Unknown membership/);
  console.log("ok  membership events normalized");
})();

console.log("\nAll YouTube adapter tests passed.");
