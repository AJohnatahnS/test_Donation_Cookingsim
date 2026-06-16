const assert = require("assert");
const { parsePick, SelectionManager } = require("./selection");

// parsePick accepts "N" and "!pick N" within range, rejects everything else.
(function parsing() {
  assert.strictEqual(parsePick("1", 3), 1);
  assert.strictEqual(parsePick(" 2 ", 3), 2);
  assert.strictEqual(parsePick("!pick 3", 3), 3);
  assert.strictEqual(parsePick("!PICK 2", 3), 2);
  assert.strictEqual(parsePick("4", 3), null, "out of range");
  assert.strictEqual(parsePick("0", 3), null);
  assert.strictEqual(parsePick("two", 3), null);
  assert.strictEqual(parsePick("pick 1", 3), null, "needs ! prefix");
  console.log("ok  parsePick accepts only 1..N and !pick N");
})();

function grant(ownerId) {
  return { eventId: "e1", tier: "VIEWER_CHOICE", donor: { id: ownerId, name: "Alice" } };
}

// Only the grant owner (by user ID) can pick.
(function ownership() {
  const m = new SelectionManager();
  m.open(grant("user-1"), ["A", "B", "C"]);
  assert.strictEqual(m.submit("user-2", "1").status, "wrong_owner");
  assert.ok(m.isBusy(), "window stays open after a non-owner message");
  const res = m.submit("user-1", "2");
  assert.strictEqual(res.status, "accepted");
  assert.strictEqual(res.recipe, "B");
  assert.strictEqual(m.isBusy(), false, "window closes on a valid pick");
  console.log("ok  only owner picks; valid pick closes the window");
})();

// Invalid owner input warns once and does not extend or close the window.
(function invalidWarnOnce() {
  const m = new SelectionManager();
  m.open(grant("user-1"), ["A", "B", "C"]);
  assert.deepStrictEqual(m.submit("user-1", "9"), { status: "invalid", warn: true });
  assert.deepStrictEqual(m.submit("user-1", "nope"), { status: "invalid", warn: false });
  assert.ok(m.isBusy(), "still open after invalid input");
  console.log("ok  invalid input warns once, window stays open");
})();

// Timeout picks one of the shown options and closes the window.
(function timeout() {
  const m = new SelectionManager();
  const options = ["A", "B", "C"];
  m.open(grant("user-1"), options);
  const res = m.timeout();
  assert.ok(options.includes(res.recipe), "timeout chooses a shown option");
  assert.strictEqual(res.grant.eventId, "e1");
  assert.strictEqual(m.isBusy(), false);
  assert.strictEqual(m.timeout(), null, "no window left to time out");
  console.log("ok  timeout picks a shown option and closes");
})();

// Only one window open at a time (section 7).
(function oneAtATime() {
  const m = new SelectionManager();
  m.open(grant("user-1"), ["A", "B"]);
  assert.throws(() => m.open(grant("user-2"), ["C", "D"]), /already open/);
  console.log("ok  only one selection window at a time");
})();

// Missing owner id can never be claimed (falls through to timeout).
(function noOwnerId() {
  const m = new SelectionManager();
  m.open(grant(undefined), ["A", "B"]);
  assert.strictEqual(m.submit("user-1", "1").status, "wrong_owner");
  console.log("ok  null owner id cannot be claimed by chat");
})();

console.log("\nAll selection tests passed.");
