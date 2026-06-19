// Manual fake-API injector for in-game testing.
//
// Fires fake donation events (POST /event) and chat picks (POST /chat) at a
// running server.js while the REAL mod + game are connected — so you can drive
// the in-game test cases (docs/in-game-test-cases.md) by hand, without any real
// YouTube/TikTok credentials.
//
//   node test-inject.js              # interactive REPL (type commands live)
//   node test-inject.js boss         # fire one Boss-tier donation and exit
//   node test-inject.js flood 5      # fire 5 Standard donations and exit
//   BASE=http://127.0.0.1:3000 node test-inject.js   # override server URL
//
// Uses only Node's built-in http (no deps), matching server.js.

const http = require("http");
const readline = require("readline");

const BASE = process.env.BASE || "http://127.0.0.1:3000";

// Per-tier preset amounts (THB) chosen to land in each YouTube tier bucket
// (see config.json youtube.thresholds). All flow through POST /event.
const TIERS = {
  support: { amountThb: 10, label: "Support (thank-you only)" },
  standard: { amountThb: 25, label: "Standard (random easy)" },
  choice: { amountThb: 60, label: "Viewer Choice (pick easy)" },
  priority: { amountThb: 150, label: "Priority (pick normal, 12m)" },
  challenge: { amountThb: 350, label: "Challenge (pick normal, 10m)" },
  hard: { amountThb: 600, label: "Hard Challenge (pick hard, 8m)" },
  boss: { amountThb: 1200, label: "Boss Order (pick hard, 6m)" },
};

let seq = 0;
// Remembers the last donor who opened a choice window, so `pick <n>` can answer
// the selection as the order's owner (selection is owner-by-userId).
let lastChoiceDonor = null;

function post(path, body) {
  return request("POST", path, body);
}

function get(path) {
  return request("GET", path, null);
}

function request(method, path, body) {
  const data = body == null ? null : Buffer.from(JSON.stringify(body));
  const url = new URL(path, BASE);

  return new Promise((resolve) => {
    const req = http.request(
      url,
      {
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": data.length }
          : {},
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          let parsed = chunks;
          try {
            parsed = JSON.parse(chunks);
          } catch {
            /* leave as text */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: { error: err.message } }));
    if (data) req.write(data);
    req.end();
  });
}

function nextDonor() {
  seq += 1;
  return { name: `Tester${seq}`, userId: `u${seq}` };
}

// Fires one donation at the given tier preset (or a custom THB amount).
async function fireTier(name, customThb) {
  const preset = TIERS[name];
  if (!preset && customThb == null) {
    console.log(`! unknown tier '${name}'. try: ${Object.keys(TIERS).join(", ")}`);
    return;
  }

  const donor = nextDonor();
  const amountThb = customThb != null ? customThb : preset.amountThb;
  const event = {
    platform: "youtube",
    donor,
    amountThb,
    message: `test ${name || customThb + " THB"}`,
  };

  const res = await post("/event", event);
  const tier = res.body && res.body.tier;
  console.log(
    `→ /event ${donor.name} (${amountThb} THB) [${res.status}] ` +
      `tier=${tier} status=${res.body && res.body.status}`,
  );

  // If it opened a choice window, remember the owner so `pick` works.
  const choiceTiers = ["VIEWER_CHOICE", "PRIORITY", "CHALLENGE", "HARD_CHALLENGE", "BOSS_ORDER"];
  if (choiceTiers.includes(tier)) {
    lastChoiceDonor = donor;
    console.log(
      `  ↳ choice window open — pick with:  pick <n>   (as ${donor.userId}), ` +
        `or wait for the 20s timeout`,
    );
  }
}

async function fireTikTok(coins) {
  const donor = nextDonor();
  const res = await post("/event", { platform: "tiktok", donor, coins });
  console.log(`→ /event ${donor.name} (${coins} coins) [${res.status}] ` +
    `tier=${res.body && res.body.tier} status=${res.body && res.body.status}`);
}

async function fireMembership(type) {
  const donor = nextDonor();
  const res = await post("/event", {
    platform: "youtube",
    donor,
    membership: { type: type || "new", count: 1 },
  });
  console.log(`→ /event ${donor.name} (membership:${type || "new"}) [${res.status}] ` +
    `tier=${res.body && res.body.tier} status=${res.body && res.body.status}`);
}

// Answers the open selection window as the last choice donor.
async function pick(n) {
  if (!lastChoiceDonor) {
    console.log("! no choice window opened yet (fire choice/priority/boss first)");
    return;
  }
  const res = await post("/chat", { userId: lastChoiceDonor.userId, text: String(n) });
  console.log(`→ /chat ${lastChoiceDonor.userId} "${n}" [${res.status}] ` +
    JSON.stringify(res.body));
}

// Sends a raw chat line as an arbitrary user (e.g. to test wrong-user warnings).
async function chat(userId, text) {
  const res = await post("/chat", { userId, text });
  console.log(`→ /chat ${userId} "${text}" [${res.status}] ` + JSON.stringify(res.body));
}

// Same eventId twice — exercises dedup (second should be 409 duplicate).
async function dupe() {
  const donor = nextDonor();
  const eventId = `dupe-${Date.now()}`;
  const event = { platform: "youtube", donor, amountThb: 60, eventId };
  const a = await post("/event", event);
  const b = await post("/event", event);
  console.log(`→ dupe first [${a.status}] ${a.body.status} | second [${b.status}] ${b.body.status}`);
}

// Many quick Standard donations — exercises the queue cap / one-at-a-time intake.
async function flood(count) {
  const n = Number(count) || 5;
  for (let i = 0; i < n; i++) {
    await fireTier("standard");
  }
  await show("state");
}

async function show(what) {
  const path = what === "stats" ? "/stats" : what === "pending" ? "/pending" : "/state";
  const res = await get(path);
  console.log(`← ${path} [${res.status}]`);
  console.log(JSON.stringify(res.body, null, 2));
}

const HELP = `
Commands (type while the game + server are running):
  support|standard|choice|priority|challenge|hard|boss   fire one donation at that tier
  yt <thb>           fire a YouTube donation of <thb> THB (server picks the tier)
  tt <coins>         fire a TikTok gift of <coins> coins
  member [type]      fire a YouTube membership (type: new|milestone|gift)
  pick <n>           answer the open choice window as its owner (pick option n)
  chat <user> <txt>  send a raw chat line as <user> (test wrong-user / !pick)
  dupe               fire the same eventId twice (dedup -> 409)
  flood [n]          fire n Standard donations (default 5) then show state
  state|pending|stats  GET that endpoint and print it
  help               show this
  quit               exit
`;

async function runCommand(line) {
  const [cmd, ...args] = line.trim().split(/\s+/);
  if (!cmd) return true;

  switch (cmd) {
    case "support": case "standard": case "choice":
    case "priority": case "challenge": case "hard": case "boss":
      await fireTier(cmd);
      break;
    case "yt": await fireTier(null, Number(args[0])); break;
    case "tt": await fireTikTok(Number(args[0])); break;
    case "member": await fireMembership(args[0]); break;
    case "pick": await pick(args[0]); break;
    case "chat": await chat(args[0], args.slice(1).join(" ")); break;
    case "dupe": await dupe(); break;
    case "flood": await flood(args[0]); break;
    case "state": case "pending": case "stats": await show(cmd); break;
    case "help": case "?": console.log(HELP); break;
    case "quit": case "exit": case "q": return false;
    default: console.log(`? unknown '${cmd}' — type 'help'`);
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2);

  // One-shot mode: run the command from argv and exit.
  if (args.length > 0) {
    console.log(`server: ${BASE}`);
    await runCommand(args.join(" "));
    return;
  }

  // Interactive REPL.
  console.log(`Fake-API injector → ${BASE}`);
  console.log(HELP);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "inject> " });

  // Process lines strictly one at a time. readline emits 'line' for every queued
  // line at once (e.g. piped input), so without this an async command like
  // `pick` could run before the preceding `choice` finishes.
  const pending = [];
  let busy = false;
  let closed = false; // stdin hit EOF (piped input) — exit once the queue drains
  async function pump() {
    if (busy) return;
    busy = true;
    while (pending.length > 0) {
      const keepGoing = await runCommand(pending.shift());
      if (!keepGoing) {
        process.exit(0);
      }
    }
    busy = false;
    if (closed) process.exit(0);
    rl.prompt();
  }

  rl.prompt();
  rl.on("line", (line) => {
    pending.push(line);
    pump();
  });
  // EOF: don't exit while a command is still running — let pump() finish first.
  rl.on("close", () => {
    closed = true;
    if (!busy) process.exit(0);
  });
}

main();
