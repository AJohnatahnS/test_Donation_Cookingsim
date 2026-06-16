// Mock Cooking Simulator Mod: stands in for the Unity/C# side until it exists.
//
//   node server.js       (terminal 1)
//   node mock-source.js  (terminal 2 — feeds donations)
//   node mock-mod.js     (terminal 3 — plays the orders)
//
// Polls GET /pending, "creates" each order and POSTs /confirm, then completes
// it a moment later via /finish. To exercise the retry path it rejects the
// very first order once (ok=false), which the server regenerates (section 5).

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const COOK_MS = 1200;
const POLL_MS = 400;
const RUN_MS = 8000;

const inFlight = new Set();
let demoRejectDone = false;

async function get(pathname) {
  const res = await fetch(BASE + pathname);
  return res.json();
}

async function post(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function handleOrder(order) {
  if (inFlight.has(order.eventId)) {
    return;
  }
  inFlight.add(order.eventId);

  try {
    // Demo the retry path: reject the first order we ever see, once.
    if (!demoRejectDone) {
      demoRejectDone = true;
      const r = await post("/confirm", { eventId: order.eventId, ok: false });
      console.log(`reject  ${order.eventId} (${order.recipe}) -> ${r.state}${r.recipe ? " " + r.recipe : ""}`);
      return; // reappears as a fresh dispatch with a new recipe
    }

    await post("/confirm", { eventId: order.eventId, ok: true });
    console.log(`confirm ${order.eventId} ${order.tier} cooking ${order.recipe}...`);

    setTimeout(async () => {
      const done = await post("/finish", { eventId: order.eventId, outcome: "COMPLETED" });
      console.log(`done    ${order.eventId} -> ${done.outcome || done.error}`);
    }, COOK_MS);
  } finally {
    inFlight.delete(order.eventId);
  }
}

async function main() {
  console.log(`Mock Mod polling ${BASE}/pending\n`);
  const stopAt = Date.now() + RUN_MS;

  while (Date.now() < stopAt) {
    try {
      const { pending } = await get("/pending");
      for (const order of pending) {
        await handleOrder(order);
      }
    } catch (error) {
      console.error("poll error:", error.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Let any in-progress cook timers finish.
  await new Promise((r) => setTimeout(r, COOK_MS + 500));
  console.log("\nMock Mod finished.");
}

main();
