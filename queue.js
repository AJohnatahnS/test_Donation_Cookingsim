// Donation grant queue with the caps and dedup rules from
// docs/donation-game-rules.md section 7.
//
// Lifecycle of a grant:
//   admit() -> QUEUED -> activate() -> ACTIVE -> finish(outcome) -> terminal
//
// Terminal outcomes: COMPLETED, EXPIRED, FAILED, CANCELLED, QUEUE_CAP_REACHED.

const TERMINAL_OUTCOMES = new Set([
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
  "QUEUE_CAP_REACHED",
]);

class DonationQueue {
  constructor(options) {
    this.maxQueued = options.maxQueued;
    this.maxConcurrentOrders = options.maxConcurrentOrders;
    this.maxConcurrentBoss = options.maxConcurrentBoss;

    this.queued = [];
    this.active = [];
    this.seenEventIds = new Set();
  }

  // Returns { accepted, reason, grant }.
  // reason is one of: "ok", "duplicate", "queue_full".
  admit(grant) {
    if (this.seenEventIds.has(grant.eventId)) {
      return { accepted: false, reason: "duplicate", grant: null };
    }

    // Reserve the id immediately so a retried/duplicate delivery of the same
    // event can never produce a second grant, even if it is rejected here.
    this.seenEventIds.add(grant.eventId);

    if (this.queued.length >= this.maxQueued) {
      grant.status = "QUEUE_CAP_REACHED";
      return { accepted: false, reason: "queue_full", grant };
    }

    grant.status = "QUEUED";
    this.queued.push(grant);
    return { accepted: true, reason: "ok", grant };
  }

  // Promotes the next eligible queued grant to active, respecting concurrency
  // caps. Processes strictly in receive order (FIFO) — no value-based jumping.
  // Returns the activated grant, or null if nothing could be activated.
  activate() {
    if (this.active.length >= this.maxConcurrentOrders) {
      return null;
    }

    const bossActive = this.active.filter((g) => g.tier === "BOSS_ORDER").length;

    for (let i = 0; i < this.queued.length; i++) {
      const grant = this.queued[i];

      if (grant.tier === "BOSS_ORDER" && bossActive >= this.maxConcurrentBoss) {
        continue;
      }

      this.queued.splice(i, 1);
      grant.status = "ACTIVE";
      this.active.push(grant);
      return grant;
    }

    return null;
  }

  // Moves an active grant to a terminal outcome and frees its slot.
  finish(eventId, outcome) {
    if (!TERMINAL_OUTCOMES.has(outcome)) {
      throw new Error(`Invalid terminal outcome: ${outcome}`);
    }

    const index = this.active.findIndex((g) => g.eventId === eventId);

    if (index === -1) {
      throw new Error(`No active grant for event: ${eventId}`);
    }

    const [grant] = this.active.splice(index, 1);
    grant.status = outcome;
    return grant;
  }

  stats() {
    return {
      queued: this.queued.length,
      active: this.active.length,
      bossActive: this.active.filter((g) => g.tier === "BOSS_ORDER").length,
    };
  }
}

module.exports = { DonationQueue, TERMINAL_OUTCOMES };
