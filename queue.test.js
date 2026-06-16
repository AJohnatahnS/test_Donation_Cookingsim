const assert = require("assert");
const { DonationQueue } = require("./queue");

function grant(id, tier) {
  return { eventId: id, tier: tier || "STANDARD" };
}

// Dedup: same event id is admitted only once.
(function dedup() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  assert.strictEqual(q.admit(grant("e1")).accepted, true);
  const second = q.admit(grant("e1"));
  assert.strictEqual(second.accepted, false);
  assert.strictEqual(second.reason, "duplicate");
  console.log("ok  duplicate event rejected");
})();

// Queue cap: 21st queued grant is rejected as QUEUE_CAP_REACHED.
(function queueCap() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  for (let i = 0; i < 20; i++) {
    assert.strictEqual(q.admit(grant("q" + i)).accepted, true);
  }
  const overflow = q.admit(grant("q20"));
  assert.strictEqual(overflow.accepted, false);
  assert.strictEqual(overflow.reason, "queue_full");
  assert.strictEqual(overflow.grant.status, "QUEUE_CAP_REACHED");
  console.log("ok  queue cap enforced");
})();

// Concurrency: at most 3 active orders at once.
(function concurrency() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  for (let i = 0; i < 5; i++) q.admit(grant("c" + i));
  assert.ok(q.activate());
  assert.ok(q.activate());
  assert.ok(q.activate());
  assert.strictEqual(q.activate(), null, "should not exceed 3 active");
  assert.strictEqual(q.stats().active, 3);
  console.log("ok  max 3 concurrent orders");
})();

// Boss cap: only one boss order active; non-boss can still activate.
(function bossCap() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  q.admit(grant("b1", "BOSS_ORDER"));
  q.admit(grant("b2", "BOSS_ORDER"));
  q.admit(grant("s1", "STANDARD"));
  assert.strictEqual(q.activate().eventId, "b1");
  // b2 is a second boss -> skipped; s1 activates instead.
  assert.strictEqual(q.activate().eventId, "s1");
  assert.strictEqual(q.stats().bossActive, 1);
  console.log("ok  max 1 boss order, others still flow");
})();

// FIFO: grants activate in receive order, not by tier value.
(function fifo() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  q.admit(grant("first", "STANDARD"));
  q.admit(grant("second", "HARD_CHALLENGE"));
  assert.strictEqual(q.activate().eventId, "first");
  console.log("ok  FIFO order preserved");
})();

// finish() frees a slot and records the outcome.
(function finish() {
  const q = new DonationQueue({ maxQueued: 20, maxConcurrentOrders: 3, maxConcurrentBoss: 1 });
  for (let i = 0; i < 4; i++) q.admit(grant("f" + i));
  q.activate();
  q.activate();
  q.activate();
  const done = q.finish("f0", "COMPLETED");
  assert.strictEqual(done.status, "COMPLETED");
  assert.strictEqual(q.stats().active, 2);
  assert.ok(q.activate(), "freed slot lets the next grant in");
  assert.throws(() => q.finish("f0", "BOGUS"), /Invalid terminal outcome/);
  console.log("ok  finish frees slot and validates outcome");
})();

console.log("\nAll queue tests passed.");
