// Menu-selection window for Viewer Choice and above
// (docs/donation-game-rules.md sections 4-5).
//
// Only one window is open at a time (section 7). Ownership is checked by
// platform user ID, never display name (section 4 rule 5). Timers live in the
// server; this module is pure logic so it can be unit-tested deterministically.

// Accepts "1".."N", or "!pick N". Returns the 1-based index or null.
function parsePick(text, max) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  const pickMatch = /^!pick\s+(\d+)$/i.exec(trimmed);

  let n;
  if (pickMatch) {
    n = Number(pickMatch[1]);
  } else if (/^\d+$/.test(trimmed)) {
    n = Number(trimmed);
  } else {
    return null;
  }

  if (!Number.isInteger(n) || n < 1 || n > max) {
    return null;
  }

  return n;
}

class SelectionManager {
  constructor() {
    this.active = null;
  }

  isBusy() {
    return this.active !== null;
  }

  // Opens a window for a grant. options is the list of recipe choices.
  open(grant, options) {
    if (this.active) {
      throw new Error("A selection window is already open");
    }

    this.active = {
      grant,
      options,
      ownerId: grant.donor.id ?? null,
      warned: false,
    };

    return this.active;
  }

  // Handles a chat message. Returns:
  //   { status: "idle" }                         no window open
  //   { status: "wrong_owner" }                  not the grant owner — ignored
  //   { status: "invalid", warn }                owner sent garbage; warn=true once
  //   { status: "accepted", grant, recipe }      valid pick; window closed
  submit(userId, text) {
    if (!this.active) {
      return { status: "idle" };
    }

    // Ownership by user ID only. A null ownerId can never be matched.
    if (this.active.ownerId === null || userId !== this.active.ownerId) {
      return { status: "wrong_owner" };
    }

    const pick = parsePick(text, this.active.options.length);

    if (pick === null) {
      const warn = !this.active.warned;
      this.active.warned = true;
      return { status: "invalid", warn };
    }

    const recipe = this.active.options[pick - 1];
    const grant = this.active.grant;
    this.active = null;
    return { status: "accepted", grant, recipe };
  }

  // Called on timeout: picks a random shown option (section 5).
  // Returns { grant, recipe } or null if no window is open.
  timeout() {
    if (!this.active) {
      return null;
    }

    const { options, grant } = this.active;
    const recipe = options[Math.floor(Math.random() * options.length)];
    this.active = null;
    return { grant, recipe };
  }
}

module.exports = { parsePick, SelectionManager };
