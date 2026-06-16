// Mock platform source: generates raw YouTube/TikTok events at a realistic
// cadence, runs them through the real adapters, and posts the normalized
// result to a running server's /event endpoint.
//
//   node server.js        (in one terminal)
//   node mock-source.js   (in another)
//
// This stands in for the real liveChatMessages poll / TikTok gift socket until
// credentials are wired up. It demonstrates currency conversion and gift-combo
// aggregation feeding the pipeline.

const { loadConfig } = require("./tiers");
const { normalizeSuperChat, normalizeMembership } = require("./youtube");
const { GiftComboTracker } = require("./tiktok");

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const config = loadConfig();
const rates = config.youtube.exchangeRatesToThb;
const combos = new GiftComboTracker();

let seq = 0;
function uid(prefix) {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postEvent(normalized, note) {
  const res = await fetch(BASE + "/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalized),
  });
  const json = await res.json().catch(() => null);
  console.log(
    `  -> POST /event ${note} :: ${res.status} ${json ? json.status : "?"} ${json && json.tier ? json.tier : ""}`,
  );
  return json;
}

// --- YouTube ---------------------------------------------------------------

async function superChat(currency, amount, name, comment) {
  const normalized = normalizeSuperChat(
    {
      id: uid("yt-sc"),
      authorChannelId: uid("chan"),
      authorName: name,
      amountMicros: Math.round(amount * 1_000_000),
      currency,
      comment,
    },
    rates,
  );
  console.log(`YouTube Super Chat: ${name} ${amount} ${currency} -> ${normalized.amountThb} THB`);
  await postEvent(normalized, `${name} ${normalized.amountThb}THB`);
}

async function membership(type, name, giftCount) {
  const normalized = normalizeMembership({ id: uid("yt-mem"), authorChannelId: uid("chan"), authorName: name, type, giftCount });
  console.log(`YouTube Membership: ${name} ${type}${giftCount ? ` x${giftCount}` : ""}`);
  await postEvent(normalized, `${name} ${type}`);
}

// --- TikTok ----------------------------------------------------------------

// Streams a combo: several repeat ticks (no grant) then the end (one grant).
async function giftCombo(giftName, coinValue, finalCount, name) {
  const comboId = uid("combo");
  console.log(`TikTok Gift combo: ${name} sends ${giftName} (${coinValue} coins) x${finalCount}`);

  for (let count = 1; count < finalCount; count++) {
    const grant = combos.handle({ comboId, giftId: giftName, giftName, userId: uid("ttu"), userName: name, coinValue, repeatCount: count, repeatEnd: false });
    console.log(`  .. repeat ${count} (no grant: ${grant === null})`);
    await sleep(120);
  }

  const normalized = combos.handle({ comboId, giftId: giftName, giftName, userId: "tt-" + name, userName: name, coinValue, repeatCount: finalCount, repeatEnd: true });
  console.log(`  combo ended: total ${normalized.coins} coins`);
  await postEvent(normalized, `${name} ${normalized.coins} coins`);
}

// --- Script ----------------------------------------------------------------

async function main() {
  console.log(`Feeding mock events to ${BASE}\n`);

  await superChat("THB", 50, "Ploy", "อร่อยมาก");
  await sleep(400);
  await superChat("USD", 10, "John", "make pizza");
  await sleep(400);
  await superChat("JPY", 3000, "Kenji", "頑張って");
  await sleep(400);
  await membership("new", "Mai");
  await sleep(400);
  await membership("gift", "Big Spender", 12);
  await sleep(400);
  await giftCombo("Rose", 100, 6, "Nok");
  await sleep(400);
  await giftCombo("Galaxy", 1000, 12, "Whale");

  console.log("\nMock source finished.");
}

main().catch((error) => {
  console.error("Mock source error:", error.message);
  process.exit(1);
});
