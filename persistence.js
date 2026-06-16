// Crash-recovery snapshot of recoverable pipeline state.
//
// The donation pipeline keeps its working state in memory. If the server is
// restarted mid-stream we must not (a) re-process donations that were already
// handled, nor (b) drop grants viewers already paid for. This module persists
// just enough to recover both: the set of seen event ids (dedup) and the
// non-terminal grants (so they can be re-queued).
//
// Writes are atomic (temp file + rename) so a crash mid-write cannot corrupt
// the snapshot.

const fs = require("fs");

const EMPTY = { seenEventIds: [], grants: [] };

function load(filePath) {
  if (!filePath || filePath === "none" || !fs.existsSync(filePath)) {
    return { ...EMPTY };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      seenEventIds: Array.isArray(parsed.seenEventIds) ? parsed.seenEventIds : [],
      grants: Array.isArray(parsed.grants) ? parsed.grants : [],
    };
  } catch (error) {
    // A corrupt snapshot must not stop the server from starting.
    console.error(`Could not read state from ${filePath}: ${error.message}`);
    return { ...EMPTY };
  }
}

function save(filePath, state) {
  if (!filePath || filePath === "none") {
    return;
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath); // atomic replace
}

module.exports = { load, save };
