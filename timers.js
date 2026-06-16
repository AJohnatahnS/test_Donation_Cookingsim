// Order cook-timers with pause/resume (docs/donation-game-rules.md section 6).
//
// Priority tier and above start a timer when the Mod confirms the order was
// created. Pausing the game stops every running timer and preserves the time
// remaining; resuming re-arms each with exactly that remainder. Returning to
// the main menu is modelled as a pause. Timers never rely on Time.timeScale —
// they are plain wall-clock timers here on the server.
//
// The clock and scheduler are injectable so the math is unit-testable without
// real time passing.

class OrderTimers {
  constructor({ onExpire, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.onExpire = onExpire;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;

    this.entries = new Map(); // eventId -> { handle, remainingMs, endAt, running }
    this.paused = false;
  }

  // Begins (or restarts) a timer for an order. If the game is paused the timer
  // is recorded but not armed until resume().
  start(eventId, durationMs) {
    this.stop(eventId);

    const entry = { handle: null, remainingMs: durationMs, endAt: null, running: false };
    this.entries.set(eventId, entry);

    if (!this.paused) {
      this._arm(eventId, entry);
    }

    return entry;
  }

  _arm(eventId, entry) {
    entry.endAt = this.now() + entry.remainingMs;
    entry.running = true;
    entry.handle = this.setTimer(() => {
      this.entries.delete(eventId);
      this.onExpire(eventId);
    }, entry.remainingMs);
  }

  _disarm(entry) {
    if (entry.handle !== null) {
      this.clearTimer(entry.handle);
      entry.handle = null;
    }
    if (entry.running && entry.endAt !== null) {
      entry.remainingMs = Math.max(0, entry.endAt - this.now());
    }
    entry.running = false;
    entry.endAt = null;
  }

  // Order finished/cancelled — cancel its timer without firing onExpire.
  stop(eventId) {
    const entry = this.entries.get(eventId);
    if (!entry) {
      return;
    }
    if (entry.handle !== null) {
      this.clearTimer(entry.handle);
    }
    this.entries.delete(eventId);
  }

  pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    for (const entry of this.entries.values()) {
      this._disarm(entry);
    }
  }

  resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    for (const [eventId, entry] of this.entries) {
      this._arm(eventId, entry);
    }
  }

  // Milliseconds left on an order's timer, or null if it has none.
  remaining(eventId) {
    const entry = this.entries.get(eventId);
    if (!entry) {
      return null;
    }
    if (entry.running && entry.endAt !== null) {
      return Math.max(0, entry.endAt - this.now());
    }
    return entry.remainingMs;
  }

  has(eventId) {
    return this.entries.has(eventId);
  }

  count() {
    return this.entries.size;
  }
}

module.exports = { OrderTimers };
