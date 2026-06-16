const assert = require("assert");
const { OrderTimers } = require("./timers");

// A fake clock + scheduler so timer math is fully deterministic.
function fakeEnv() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map(); // id -> { fireAt, cb }

  const env = {
    now: () => now,
    setTimer: (cb, ms) => {
      const id = nextId++;
      scheduled.set(id, { fireAt: now + ms, cb });
      return id;
    },
    clearTimer: (id) => scheduled.delete(id),
    // Advance virtual time, firing any timers whose deadline passes.
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...scheduled.entries()]) {
        if (t.fireAt <= now) {
          scheduled.delete(id);
          t.cb();
        }
      }
    },
  };
  return env;
}

// Timer fires onExpire after the full duration.
(function expires() {
  const env = fakeEnv();
  const fired = [];
  const timers = new OrderTimers({ onExpire: (id) => fired.push(id), now: env.now, setTimer: env.setTimer, clearTimer: env.clearTimer });

  timers.start("o1", 1000);
  env.advance(999);
  assert.deepStrictEqual(fired, [], "not yet");
  env.advance(1);
  assert.deepStrictEqual(fired, ["o1"], "expired at deadline");
  assert.strictEqual(timers.has("o1"), false);
  console.log("ok  timer fires onExpire at the deadline");
})();

// stop() cancels without firing.
(function stop() {
  const env = fakeEnv();
  const fired = [];
  const timers = new OrderTimers({ onExpire: (id) => fired.push(id), now: env.now, setTimer: env.setTimer, clearTimer: env.clearTimer });
  timers.start("o1", 1000);
  timers.stop("o1");
  env.advance(2000);
  assert.deepStrictEqual(fired, [], "stopped timer never fires");
  console.log("ok  stop cancels a timer");
})();

// Pause preserves the remaining time; resume continues from there.
(function pauseResume() {
  const env = fakeEnv();
  const fired = [];
  const timers = new OrderTimers({ onExpire: (id) => fired.push(id), now: env.now, setTimer: env.setTimer, clearTimer: env.clearTimer });

  timers.start("o1", 1000);
  env.advance(400);
  timers.pause();
  assert.strictEqual(timers.remaining("o1"), 600, "600ms left at pause");

  env.advance(5000); // time passes while paused
  assert.strictEqual(timers.remaining("o1"), 600, "paused timer does not drain");
  assert.deepStrictEqual(fired, [], "paused timer cannot expire");

  timers.resume();
  env.advance(599);
  assert.deepStrictEqual(fired, [], "still 1ms left");
  env.advance(1);
  assert.deepStrictEqual(fired, ["o1"], "expires after the remainder");
  console.log("ok  pause preserves remainder, resume continues");
})();

// Multiple timers pause and resume together.
(function multiple() {
  const env = fakeEnv();
  const fired = [];
  const timers = new OrderTimers({ onExpire: (id) => fired.push(id), now: env.now, setTimer: env.setTimer, clearTimer: env.clearTimer });

  timers.start("a", 1000);
  env.advance(200);
  timers.start("b", 500);
  env.advance(100); // a:700 left, b:400 left
  timers.pause();
  assert.strictEqual(timers.remaining("a"), 700);
  assert.strictEqual(timers.remaining("b"), 400);
  timers.resume();
  env.advance(400);
  assert.deepStrictEqual(fired, ["b"], "b expires first");
  env.advance(300);
  assert.deepStrictEqual(fired, ["b", "a"], "then a");
  console.log("ok  multiple timers pause/resume independently");
})();

console.log("\nAll timer tests passed.");
