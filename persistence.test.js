const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const persistence = require("./persistence");

function tmpFile() {
  return path.join(os.tmpdir(), `dono-persist-test-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
}

// Round trip: what we save is what we load.
(function roundTrip() {
  const file = tmpFile();
  const state = { seenEventIds: ["a", "b"], grants: [{ eventId: "a", tier: "STANDARD" }] };
  persistence.save(file, state);
  const loaded = persistence.load(file);
  assert.deepStrictEqual(loaded, state);
  fs.unlinkSync(file);
  console.log("ok  save/load round trip");
})();

// Save is atomic: no leftover temp file remains.
(function atomic() {
  const file = tmpFile();
  persistence.save(file, { seenEventIds: [], grants: [] });
  assert.strictEqual(fs.existsSync(file + ".tmp"), false, "temp file cleaned up");
  fs.unlinkSync(file);
  console.log("ok  save leaves no temp file");
})();

// Missing file loads as empty state.
(function missing() {
  const loaded = persistence.load(tmpFile());
  assert.deepStrictEqual(loaded, { seenEventIds: [], grants: [] });
  console.log("ok  missing file -> empty state");
})();

// "none" disables persistence on both ends.
(function disabled() {
  persistence.save("none", { seenEventIds: ["x"], grants: [] }); // must not throw
  assert.deepStrictEqual(persistence.load("none"), { seenEventIds: [], grants: [] });
  console.log("ok  'none' disables persistence");
})();

// A corrupt snapshot does not crash the loader.
(function corrupt() {
  const file = tmpFile();
  fs.writeFileSync(file, "{ not valid json");
  assert.deepStrictEqual(persistence.load(file), { seenEventIds: [], grants: [] });
  fs.unlinkSync(file);
  console.log("ok  corrupt file -> empty state, no throw");
})();

console.log("\nAll persistence tests passed.");
