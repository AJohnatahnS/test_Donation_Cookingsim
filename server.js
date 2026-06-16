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

const config = loadConfig();

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

// Stub for the future Cooking Simulator Mod integration. For now it only logs;
// the Mod will eventually create the in-game order and report back via /finish.
function dispatchToMod(grant) {
  console.log(
    `[mod] create ${grant.tier} order for ${grant.donor.name} ` +
      `(${grant.selection}/${grant.difficulty}, ${grant.cookMinutes ?? "no"} min)`,
  );
}

function tick() {
  const grant = queue.activate();

  if (!grant) {
    return;
  }

  const label = getTierConfig(config, grant.tier).label;
  showOverlay(grant.tier, `${grant.donor.name} — ${label}`, grant.amountText);
  dispatchToMod(grant);
  logEntry({ eventId: grant.eventId, tier: grant.tier, donor: grant.donor.name, outcome: "ACTIVE" });
}

function finishOrder(eventId, outcome) {
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

  if (pathname === "/stats") {
    sendJson(res, 200, queue.stats());
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
