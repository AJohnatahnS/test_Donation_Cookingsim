// End-to-end integration driver: spawns server.js and fires fake platform
// events over real HTTP, covering every case several rounds, then reports.
//
//   node integration.js
//
// Exits non-zero if any check fails. Uses fresh server instances so stateful
// cases (queue cap, menu selection) start clean.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:3000";
const ROUNDS = 5;

let pass = 0;
let fail = 0;
let eventCounter = 0;

function nextId(prefix) {
  eventCounter += 1;
  return `${prefix}-${eventCounter}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(condition, label) {
  if (condition) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`    FAIL: ${label}`);
  }
}

async function post(pathname, body) {
  const res = await fetch(BASE + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}

async function get(pathname) {
  const res = await fetch(BASE + pathname);
  return { status: res.status, json: await res.json() };
}

async function isUp() {
  try {
    const res = await fetch(BASE + "/state");
    return res.ok;
  } catch {
    return false;
  }
}

async function withServer(run) {
  const proc = spawn(process.execPath, ["server.js"], { cwd: __dirname, stdio: ["ignore", "ignore", "pipe"] });

  let crashed = null;
  proc.stderr.on("data", (chunk) => {
    crashed = chunk.toString();
  });
  proc.on("exit", (code) => {
    if (code) crashed = crashed || `server exited with code ${code}`;
  });

  // Wait for boot.
  for (let i = 0; i < 50; i++) {
    if (crashed) throw new Error(`server failed to start: ${crashed.split("\n")[0]}`);
    if (await isUp()) break;
    await sleep(100);
  }
  if (!(await isUp())) throw new Error("server did not come up in time");

  try {
    await run();
  } finally {
    proc.kill();
    for (let i = 0; i < 50 && (await isUp()); i++) {
      await sleep(100);
    }
  }
}

async function waitForState(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await get("/state");
    if (predicate(json)) return json;
    await sleep(150);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// S1-S5 share one server: all assert on the immediate /event (or /finish)
// response, so a filling queue does not affect them.
async function statelessScenarios() {
  const ytTiers = [
    [10, "SUPPORT", "support_only"],
    [20, "STANDARD", "queued"],
    [49, "STANDARD", "queued"],
    [50, "VIEWER_CHOICE", "queued"],
    [100, "PRIORITY", "queued"],
    [300, "CHALLENGE", "queued"],
    [500, "HARD_CHALLENGE", "queued"],
    [1000, "BOSS_ORDER", "queued"],
  ];
  const ttTiers = [
    [5, "SUPPORT"],
    [20, "STANDARD"],
    [100, "VIEWER_CHOICE"],
    [500, "PRIORITY"],
    [1000, "CHALLENGE"],
    [3000, "HARD_CHALLENGE"],
    [10000, "BOSS_ORDER"],
  ];
  const memberships = [
    [{ type: "new" }, "VIEWER_CHOICE"],
    [{ type: "renew" }, "STANDARD"],
    [{ type: "milestone" }, "STANDARD"],
    [{ type: "gift", count: 3 }, "PRIORITY"],
    [{ type: "gift", count: 7 }, "CHALLENGE"],
    [{ type: "gift", count: 12 }, "BOSS_ORDER"],
  ];
  // A queued tier can also come back as queue_full once the queue fills — both
  // prove the event was received and tiered correctly.
  const accepted = (status) => ["queued", "queue_full", "support_only"].includes(status);

  for (let round = 1; round <= ROUNDS; round++) {
    // S1: YouTube tiers
    for (const [amount, tier] of ytTiers) {
      const r = await post("/event", {
        platform: "youtube",
        eventId: nextId("yt"),
        donor: { id: nextId("u"), name: "YT" },
        amountThb: amount,
      });
      check(r.json && r.json.tier === tier && accepted(r.json.status), `YT ${amount} -> ${tier} (got ${r.json && r.json.tier}/${r.json && r.json.status})`);
    }

    // S2: TikTok tiers
    for (const [coins, tier] of ttTiers) {
      const r = await post("/event", {
        platform: "tiktok",
        eventId: nextId("tt"),
        donor: { id: nextId("u"), name: "TT" },
        coins,
      });
      check(r.json && r.json.tier === tier && accepted(r.json.status), `TT ${coins} -> ${tier} (got ${r.json && r.json.tier}/${r.json && r.json.status})`);
    }

    // S3: Membership
    for (const [membership, tier] of memberships) {
      const r = await post("/event", {
        platform: "youtube",
        eventId: nextId("mem"),
        donor: { id: nextId("u"), name: "Mem" },
        membership,
      });
      check(r.json && r.json.tier === tier && accepted(r.json.status), `member ${JSON.stringify(membership)} -> ${tier} (got ${r.json && r.json.tier})`);
    }

    // S4: Duplicate event id -> 409
    const dupId = nextId("dup");
    await post("/event", { platform: "youtube", eventId: dupId, donor: { id: "d", name: "Dup" }, amountThb: 50 });
    const dup = await post("/event", { platform: "youtube", eventId: dupId, donor: { id: "d", name: "Dup" }, amountThb: 50 });
    check(dup.status === 409 && dup.json.status === "duplicate", `duplicate ${dupId} -> 409 (got ${dup.status})`);

    // S5: Invalid payloads -> 400
    const invalids = [
      {},
      { platform: "youtube", donor: { name: "" }, amountThb: 50 },
      { platform: "youtube", donor: { name: "X" } },
      { platform: "tiktok", donor: { name: "X" } },
      { platform: "myspace", donor: { name: "X" }, amountThb: 50 },
    ];
    for (const bad of invalids) {
      const r = await post("/event", bad);
      check(r.status === 400 && r.json.accepted === false, `invalid payload rejected (got ${r.status})`);
    }
  }
}

// S6: queue cap — fresh server per round so the boundary is meaningful.
async function queueCapScenario() {
  for (let round = 1; round <= ROUNDS; round++) {
    await withServer(async () => {
      // Fire 25 queueing events as fast as possible (before ticks can drain).
      const sends = [];
      for (let i = 0; i < 25; i++) {
        sends.push(
          post("/event", {
            platform: "youtube",
            eventId: nextId("cap"),
            donor: { id: nextId("u"), name: "Cap" },
            amountThb: 20,
          }),
        );
      }
      const results = await Promise.all(sends);
      const full = results.filter((r) => r.json && r.json.status === "queue_full");
      const allTiered = results.every((r) => r.json && r.json.tier === "STANDARD");
      check(full.length >= 1, `queue cap round ${round}: at least one queue_full (got ${full.length})`);
      check(allTiered, `queue cap round ${round}: every event still tiered`);
    });
  }
}

// S7: menu selection happy path — one server, /finish frees slots each round.
async function menuSelectionScenario() {
  await withServer(async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const id = nextId("vc");
      const owner = nextId("owner");
      await post("/event", {
        platform: "youtube",
        eventId: id,
        donor: { id: owner, name: `P${round}` },
        amountThb: 50,
      });

      const prompt = await waitForState((s) => s.visible && /pick a dish/.test(s.title), 5000);
      check(prompt !== null, `round ${round}: pick prompt appeared`);

      // Non-owner is ignored.
      const intruder = await post("/chat", { userId: "intruder", text: "1" });
      check(intruder.json.status === "wrong_owner", `round ${round}: non-owner ignored`);

      // Owner picks.
      const picked = await post("/chat", { userId: owner, text: "1" });
      check(picked.json.status === "accepted" && picked.json.recipe, `round ${round}: owner pick accepted`);

      const dispatched = await waitForState((s) => /^Order:/.test(s.subtitle), 2000);
      check(dispatched !== null, `round ${round}: order dispatched to mod`);

      const done = await post("/finish", { eventId: id, outcome: "COMPLETED" });
      check(done.json.ok === true, `round ${round}: /finish completed`);
    }
  });
}

// S8: full Mod lifecycle over HTTP — pick, /pending, /confirm, cook timer,
// pause/resume, /finish, plus the reject -> retry path.
async function modLifecycleScenario() {
  await withServer(async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      // --- happy path: timed Priority order ---
      const id = nextId("mod");
      const owner = nextId("owner");
      await post("/event", { platform: "youtube", eventId: id, donor: { id: owner, name: `M${round}` }, amountThb: 100 });

      const prompt = await waitForState((s) => s.visible && /pick a dish/.test(s.title), 5000);
      check(prompt !== null, `mod ${round}: pick prompt`);
      const picked = await post("/chat", { userId: owner, text: "1" });
      check(picked.json.status === "accepted", `mod ${round}: pick accepted`);

      const pending = await waitForPending((list) => list.some((o) => o.eventId === id), 2000);
      check(pending !== null, `mod ${round}: order appears in /pending`);

      const confirm = await post("/confirm", { eventId: id, ok: true });
      check(confirm.json.state === "COOKING", `mod ${round}: confirm -> cooking`);

      let stats = (await get("/stats")).json;
      check(stats.cooking >= 1, `mod ${round}: a cook timer is running`);

      check((await post("/game", { state: "paused" })).json.gameActive === false, `mod ${round}: game pauses`);
      check((await post("/game", { state: "playing" })).json.gameActive === true, `mod ${round}: game resumes`);

      const done = await post("/finish", { eventId: id, outcome: "COMPLETED" });
      check(done.json.ok === true, `mod ${round}: finish completed`);

      // --- reject path: Mod can't make it, server regenerates once ---
      const rid = nextId("rej");
      const rowner = nextId("owner");
      await post("/event", { platform: "youtube", eventId: rid, donor: { id: rowner, name: `R${round}` }, amountThb: 100 });
      await waitForState((s) => s.visible && /pick a dish/.test(s.title), 5000);
      await post("/chat", { userId: rowner, text: "1" });
      await waitForPending((list) => list.some((o) => o.eventId === rid), 2000);

      const reject = await post("/confirm", { eventId: rid, ok: false });
      check(reject.json.state === "DISPATCHED" && reject.json.recipe, `mod ${round}: reject regenerates a new recipe`);

      const retried = await waitForPending((list) => list.some((o) => o.eventId === rid), 2000);
      check(retried !== null, `mod ${round}: regenerated order back in /pending`);
      await post("/confirm", { eventId: rid, ok: true });
      await post("/finish", { eventId: rid, outcome: "COMPLETED" });
    }
  });
}

async function waitForPending(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await get("/pending");
    if (predicate(json.pending)) return json.pending;
    await sleep(120);
  }
  return null;
}

// ---------------------------------------------------------------------------

async function main() {
  if (await isUp()) {
    throw new Error("Port 3000 is already in use — stop the running server first.");
  }

  console.log(`Running integration scenarios, ${ROUNDS} rounds each...\n`);

  console.log("S1-S5  tiers / membership / dedup / validation");
  await withServer(statelessScenarios);

  console.log("S6     queue cap");
  await queueCapScenario();

  console.log("S7     menu selection + finish");
  await menuSelectionScenario();

  console.log("S8     mod lifecycle (confirm / cook / pause / finish / reject-retry)");
  await modLifecycleScenario();

  // Clean up the log the spawned servers wrote.
  const logPath = path.join(__dirname, "order-log.json");
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);

  console.log(`\n${pass} checks passed, ${fail} failed.`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Integration driver error:", error.message);
  process.exit(1);
});
