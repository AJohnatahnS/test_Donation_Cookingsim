// Spec-accurate donation pipeline (docs/donation-game-rules.md).
//
//   POST /event  -> validate -> decideTier -> queue.admit
//   tick         -> queue.activate -> dispatchToMod (stub) -> overlay
//   POST /finish -> queue.finish (Mod reports the final outcome)
//
// Run this OR donation_test.js, not both (they share port 3000).

const fs = require("fs");
const http = require("http");
const path = require("path");

const { loadConfig, decideTier, getTierConfig } = require("./tiers");
const { DonationQueue } = require("./queue");
const { loadRecipePool } = require("./recipes");
const { SelectionManager } = require("./selection");
const { OrderTimers } = require("./timers");

const config = loadConfig();
const recipePool = loadRecipePool({
  disabled: config.recipePool.disabled,
  kitchen: config.recipePool.kitchen,
  cooldownWindow: config.menuSelection.recentRecipeCooldown,
});

const serverHost = "127.0.0.1";
const serverPort = 3000;

const overlayFilePath = path.join(__dirname, "overlay.html");
const overlayCssPath = path.join(__dirname, "overlay.css");
const overlayJsPath = path.join(__dirname, "overlay.js");
const soundsDir = path.resolve(__dirname, "sounds");
const orderLogPath = path.join(__dirname, "order-log.json");

const audioContentTypes = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const queue = new DonationQueue(config.queue);
const selection = new SelectionManager();
let selectionTimeoutId = null;

// Orders dispatched to the Mod, keyed by eventId: { grant, state }.
// state: "DISPATCHED" (awaiting in-game creation) | "COOKING" (created).
const orders = new Map();
const timers = new OrderTimers({ onExpire: expireOrder });

// Pauses while the game is paused or sitting in the main menu (section 6):
// no new orders are pulled and cook timers are frozen.
let gameActive = true;

const overlayState = {
  visible: false,
  title: "",
  subtitle: "",
  tier: null,
  color: "#ffcc00",
  sound: null,
  updatedAt: null,
};

let overlayHideTimeoutId = null;

// ---------------------------------------------------------------------------
// Logging — appended to order-log.json (separate from the prototype's log).
// ---------------------------------------------------------------------------

function loadOrderLog() {
  if (!fs.existsSync(orderLogPath)) {
    return [];
  }

  const saved = JSON.parse(fs.readFileSync(orderLogPath, "utf8"));

  if (!Array.isArray(saved)) {
    throw new Error("order-log.json must contain an array");
  }

  return saved;
}

const orderLog = loadOrderLog();

function logEntry(entry) {
  orderLog.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(orderLogPath, JSON.stringify(orderLog, null, 2));
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

function showOverlay(tierName, title, subtitle) {
  const tierOverlay = config.overlay.byTier[tierName] || {};
  const durationMs = tierOverlay.durationMs || config.overlay.defaultDurationMs;

  overlayState.visible = true;
  overlayState.title = title;
  overlayState.subtitle = subtitle;
  overlayState.tier = tierName;
  overlayState.color = tierOverlay.color || "#ffcc00";
  overlayState.sound = tierOverlay.sound || null;
  overlayState.updatedAt = new Date().toISOString();

  if (overlayHideTimeoutId) {
    clearTimeout(overlayHideTimeoutId);
  }

  overlayHideTimeoutId = setTimeout(function () {
    overlayState.visible = false;
  }, durationMs);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function validateEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Event must be an object");
  }

  if (event.platform !== "youtube" && event.platform !== "tiktok") {
    throw new Error("platform must be 'youtube' or 'tiktok'");
  }

  if (!event.donor || typeof event.donor.name !== "string" || event.donor.name.trim() === "") {
    throw new Error("donor.name is required");
  }

  if (event.message != null && typeof event.message !== "string") {
    throw new Error("message must be a string");
  }

  if (event.platform === "youtube") {
    const hasAmount = typeof event.amountThb === "number" && event.amountThb > 0;

    if (!hasAmount && !event.membership) {
      throw new Error("youtube event needs amountThb or membership");
    }
  }

  if (event.platform === "tiktok") {
    if (typeof event.coins !== "number" || event.coins <= 0) {
      throw new Error("tiktok event needs positive coins");
    }
  }
}

function describeAmount(event) {
  if (event.platform === "youtube") {
    if (event.membership) {
      const count = event.membership.count ? ` x${event.membership.count}` : "";
      return `membership: ${event.membership.type}${count}`;
    }
    return `${event.amountThb} THB`;
  }
  return `${event.coins} coins`;
}

// Returns { status, ...detail } describing how the event was handled.
function ingestEvent(event) {
  validateEvent(event);

  const eventId =
    typeof event.eventId === "string" && event.eventId.trim() !== ""
      ? event.eventId
      : `${event.platform}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const tier = decideTier(config, event);
  const tierConfig = getTierConfig(config, tier);
  const amountText = describeAmount(event);

  // Support tier: overlay thank-you only, never enters the order queue (section 2/3).
  if (tier === "SUPPORT") {
    showOverlay(tier, `${event.donor.name} — thank you!`, amountText);
    logEntry({ eventId, platform: event.platform, tier, donor: event.donor.name, outcome: "SUPPORT_ONLY" });
    return { status: "support_only", eventId, tier };
  }

  const grant = {
    eventId,
    platform: event.platform,
    tier,
    selection: tierConfig.selection,
    difficulty: tierConfig.difficulty,
    cookMinutes: tierConfig.cookMinutes,
    donor: event.donor,
    message: event.message || "",
    amountText,
    receivedAt: new Date().toISOString(),
  };

  const result = queue.admit(grant);

  if (!result.accepted && result.reason === "duplicate") {
    return { status: "duplicate", eventId, tier };
  }

  if (!result.accepted && result.reason === "queue_full") {
    showOverlay(tier, `${event.donor.name} — thank you!`, "Queue is full, recorded with thanks");
    logEntry({ eventId, platform: event.platform, tier, donor: event.donor.name, outcome: "QUEUE_CAP_REACHED" });
    return { status: "queue_full", eventId, tier };
  }

  logEntry({ eventId, platform: event.platform, tier, donor: event.donor.name, outcome: "QUEUED" });
  return { status: "queued", eventId, tier, queueSize: queue.stats().queued };
}

// Hands an order to the Mod. The Mod polls GET /pending, creates the in-game
// order, then calls POST /confirm. The console line mirrors what it will see.
function dispatchToMod(grant) {
  orders.set(grant.eventId, { grant, state: "DISPATCHED" });
  console.log(
    `[mod] dispatch ${grant.tier} order for ${grant.donor.name}: ${grant.recipe.name} ` +
      `(${grant.cookMinutes ?? "no"} min)`,
  );
}

// Names of recipes currently cooking, so the pool can avoid duplicates.
function cookingNames() {
  return queue.active
    .filter((grant) => grant.recipe)
    .map((grant) => grant.recipe.name);
}

// No makeable recipe exists for this grant — cancel it (spec section 5).
function failNoRecipe(grant) {
  queue.finish(grant.eventId, "FAILED");
  showOverlay(grant.tier, `${grant.donor.name} — order cancelled`, "No available recipe right now");
  logEntry({
    eventId: grant.eventId,
    tier: grant.tier,
    donor: grant.donor.name,
    outcome: "FAILED_GAME_NOT_READY",
  });
}

// A recipe has been chosen (random, picked, or timed-out) — create the order.
function finalizeOrder(grant, recipe, timedOut) {
  grant.recipe = recipe;
  recipePool.recordPicked(recipe.id);

  const label = getTierConfig(config, grant.tier).label;
  showOverlay(grant.tier, `${grant.donor.name} — ${label}`, `Order: ${recipe.name}`);
  dispatchToMod(grant);
  logEntry({
    eventId: grant.eventId,
    tier: grant.tier,
    donor: grant.donor.name,
    recipe: recipe.name,
    outcome: timedOut ? "DISPATCHED_TIMEOUT_PICK" : "DISPATCHED",
  });
}

// Opens the viewer menu-selection window for a choice-tier grant.
function openSelection(grant) {
  const options = recipePool.choose(grant.difficulty, config.menuSelection.choiceCount, {
    cookingNames: cookingNames(),
  });

  if (options.length === 0) {
    failNoRecipe(grant);
    return;
  }

  selection.open(grant, options);

  const optionText = options.map((recipe, i) => `${i + 1}) ${recipe.name}`).join("   ");
  const seconds = config.menuSelection.timeoutSeconds;
  showOverlay(grant.tier, `${grant.donor.name} — pick a dish (${seconds}s)`, optionText);

  selectionTimeoutId = setTimeout(resolveSelectionTimeout, seconds * 1000);
}

function resolveSelectionTimeout() {
  const result = selection.timeout();

  if (result) {
    finalizeOrder(result.grant, result.recipe, true);
  }
}

// Routes a chat message to the open selection window.
function handleChat(userId, text) {
  const result = selection.submit(userId, text);

  if (result.status === "accepted") {
    clearTimeout(selectionTimeoutId);
    finalizeOrder(result.grant, result.recipe, false);
  }

  return result;
}

function tick() {
  // Suspend processing while the game is paused or in the menu (section 6).
  if (!gameActive) {
    return;
  }

  // One menu window at a time (section 7): don't pull a new grant while a
  // viewer is still choosing.
  if (selection.isBusy()) {
    return;
  }

  const grant = queue.activate();

  if (!grant) {
    return;
  }

  if (grant.selection === "choice") {
    openSelection(grant);
    return;
  }

  // Standard tier: random makeable recipe, no viewer input.
  const recipe = recipePool.chooseOne(grant.difficulty, { cookingNames: cookingNames() });

  if (!recipe) {
    failNoRecipe(grant);
    return;
  }

  finalizeOrder(grant, recipe, false);
}

// The Mod confirms (ok=true) or rejects (ok=false) in-game order creation.
function confirmOrder(eventId, ok) {
  const order = orders.get(eventId);

  if (!order || order.state !== "DISPATCHED") {
    throw new Error(`No dispatched order for event: ${eventId}`);
  }

  if (!ok) {
    return rejectOrder(order);
  }

  order.state = "COOKING";
  const grant = order.grant;

  // Only Priority and above are timed; the clock starts now, on confirmation,
  // so menu-selection and queue time are never counted (section 6).
  if (grant.cookMinutes) {
    timers.start(eventId, grant.cookMinutes * 60_000);
  }

  const label = getTierConfig(config, grant.tier).label;
  showOverlay(grant.tier, `${grant.donor.name} — ${label}`, `Cooking: ${grant.recipe.name}`);
  logEntry({ eventId, tier: grant.tier, donor: grant.donor.name, recipe: grant.recipe.name, outcome: "COOKING" });
  return { state: "COOKING", eventId };
}

// Mod could not make the chosen recipe. Regenerate a different recipe once
// (section 5); if that also fails, cancel as FAILED_GAME_NOT_READY.
function rejectOrder(order) {
  const grant = order.grant;
  grant.retries = (grant.retries || 0) + 1;

  if (grant.retries <= 1) {
    const replacement = recipePool.choose(grant.difficulty, 1, {
      cookingNames: cookingNames().filter((name) => name !== grant.recipe.name),
    })[0];

    if (replacement && replacement.id !== grant.recipe.id) {
      grant.recipe = replacement;
      recipePool.recordPicked(replacement.id);
      order.state = "DISPATCHED";
      showOverlay(grant.tier, `${grant.donor.name} — retrying`, `New dish: ${replacement.name}`);
      logEntry({ eventId: grant.eventId, tier: grant.tier, donor: grant.donor.name, recipe: replacement.name, outcome: "DISPATCHED_RETRY" });
      return { state: "DISPATCHED", eventId: grant.eventId, recipe: replacement.name };
    }
  }

  orders.delete(grant.eventId);
  queue.finish(grant.eventId, "FAILED");
  showOverlay(grant.tier, `${grant.donor.name} — order cancelled`, "Could not make this order");
  logEntry({ eventId: grant.eventId, tier: grant.tier, donor: grant.donor.name, outcome: "FAILED_GAME_NOT_READY" });
  return { state: "FAILED", eventId: grant.eventId };
}

// A cook timer ran out (section 6): end just that order.
function expireOrder(eventId) {
  if (!orders.has(eventId)) {
    return;
  }
  const grant = finishOrder(eventId, "EXPIRED");
  showOverlay(grant.tier, `${grant.donor.name} — time's up`, `${grant.recipe.name} expired`);
}

// Game state from the Mod: "playing" resumes, "paused"/"menu" suspends.
function setGameState(state) {
  if (state === "playing") {
    gameActive = true;
    timers.resume();
  } else if (state === "paused" || state === "menu") {
    gameActive = false;
    timers.pause();
  } else {
    throw new Error(`Unknown game state: ${state}`);
  }
  logEntry({ outcome: "GAME_STATE", state });
  return { gameActive };
}

function finishOrder(eventId, outcome) {
  timers.stop(eventId);
  orders.delete(eventId);
  const grant = queue.finish(eventId, outcome);
  logEntry({ eventId, tier: grant.tier, donor: grant.donor.name, outcome });
  return grant;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let body = "";
    let tooLarge = false;

    req.on("data", function (chunk) {
      if (tooLarge) return;
      body += chunk;
      if (body.length > 10_000) {
        tooLarge = true;
        body = "";
      }
    });

    req.on("end", function () {
      if (tooLarge) {
        reject(new Error("Request body too large"));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, function (error, data) {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Failed to load file");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Content-Length": data.length });
    res.end(data);
  });
}

function serveSound(res, pathname) {
  let fileName;
  try {
    fileName = decodeURIComponent(pathname.slice("/sounds/".length));
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Invalid URL");
    return;
  }

  const soundPath = path.resolve(soundsDir, fileName);

  if (soundPath !== soundsDir && !soundPath.startsWith(soundsDir + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  const contentType = audioContentTypes[path.extname(soundPath).toLowerCase()];

  if (!contentType) {
    res.writeHead(415, { "Content-Type": "text/plain" });
    res.end("Unsupported audio type");
    return;
  }

  let stats;
  try {
    stats = fs.statSync(soundPath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Sound not found");
    return;
  }

  if (!stats.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Sound not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentType, "Content-Length": stats.size });
  fs.createReadStream(soundPath).pipe(res);
}

const server = http.createServer(async function (req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname === "/state") {
    sendJson(res, 200, overlayState);
    return;
  }

  if (pathname === "/event") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ accepted: false, error: "Method not allowed" }));
      return;
    }

    try {
      const result = ingestEvent(await readJsonBody(req));
      const accepted = result.status === "queued" || result.status === "support_only";
      const statusCode = result.status === "duplicate" ? 409 : accepted ? 202 : 200;
      sendJson(res, statusCode, { accepted, ...result });
    } catch (error) {
      const statusCode = error.message === "Request body too large" ? 413 : 400;
      sendJson(res, statusCode, { accepted: false, error: error.message });
    }
    return;
  }

  if (pathname === "/finish") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const grant = finishOrder(body.eventId, body.outcome);
      sendJson(res, 200, { ok: true, eventId: grant.eventId, outcome: grant.status });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/chat") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);

      if (typeof body.userId !== "string" || typeof body.text !== "string") {
        throw new Error("chat needs userId and text strings");
      }

      const result = handleChat(body.userId, body.text);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/kitchen") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }

    try {
      const body = await readJsonBody(req);

      // tokens: array of available equipment/ingredient tokens, or null for "all".
      if (body.tokens !== null && !Array.isArray(body.tokens)) {
        throw new Error("kitchen tokens must be an array or null");
      }

      recipePool.setKitchen(body.tokens);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  // Mod polls this for orders to create in-game.
  if (pathname === "/pending") {
    const pending = [];
    for (const [eventId, order] of orders) {
      if (order.state === "DISPATCHED") {
        pending.push({
          eventId,
          tier: order.grant.tier,
          recipe: order.grant.recipe.name,
          recipeId: order.grant.recipe.id,
          donor: order.grant.donor.name,
          cookMinutes: order.grant.cookMinutes,
        });
      }
    }
    sendJson(res, 200, { pending });
    return;
  }

  // Mod confirms (ok=true) or rejects (ok=false) in-game order creation.
  if (pathname === "/confirm") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }
    try {
      const body = await readJsonBody(req);
      if (typeof body.eventId !== "string") {
        throw new Error("confirm needs an eventId");
      }
      const result = confirmOrder(body.eventId, body.ok !== false);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  // Mod reports game state: { state: "playing" | "paused" | "menu" }.
  if (pathname === "/game") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
      return;
    }
    try {
      const body = await readJsonBody(req);
      const result = setGameState(body.state);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (pathname === "/stats") {
    sendJson(res, 200, { ...queue.stats(), cooking: timers.count(), gameActive });
    return;
  }

  if (pathname.startsWith("/sounds/")) {
    serveSound(res, pathname);
    return;
  }

  if (pathname === "/overlay.css") {
    sendFile(res, overlayCssPath, "text/css; charset=utf-8");
    return;
  }

  if (pathname === "/overlay.js") {
    sendFile(res, overlayJsPath, "application/javascript; charset=utf-8");
    return;
  }

  if (pathname === "/" || pathname === "/overlay") {
    sendFile(res, overlayFilePath, "text/html; charset=utf-8");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(serverPort, serverHost, function () {
  console.log(`Donation pipeline running at http://${serverHost}:${serverPort}`);
});

setInterval(tick, 2000);

module.exports = { ingestEvent, finishOrder, tick, overlayState, queue };
