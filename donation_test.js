const fs = require("fs");
const http = require("http");
const path = require("path");

const rulesFilePath = path.join(__dirname, "rules.json");
const actionsFilePath = path.join(__dirname, "actions.json");
const eventLogFilePath = path.join(__dirname, "event-log.json");

const rulesText = fs.readFileSync(rulesFilePath, "utf8");
const rules = JSON.parse(rulesText);

const actionText = fs.readFileSync(actionsFilePath, "utf8");
const actionConfig = JSON.parse(actionText);

const overlayFilePath = path.join(__dirname, "overlay.html");
const overlayCssPath = path.join(__dirname, "overlay.css");
const overlayJsPath = path.join(__dirname, "overlay.js");
const soundsDir = path.resolve(__dirname, "sounds");
const serverHost = "127.0.0.1";
const serverPort = 3000;
const mockDonationsEnabled = process.env.ENABLE_MOCK_DONATIONS === "true";

const audioContentTypes = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

const donations = [
  {
    platform: "youtube",
    name: "A",
    amount: 10,
    message: "hello",
  },
  {
    platform: "youtube",
    name: "B",
    amount: 20,
    message: "hello",
  },
  {
    platform: "youtube",
    name: "C",
    amount: 50,
    message: "hello",
  },
  {
    platform: "youtube",
    name: "D",
    amount: 100,
    message: "hello",
  },
  {
    platform: "youtube",
    name: "E",
    amount: 300,
    message: "hello",
  },
  {
    platform: "youtube",
    name: "F",
    amount: 500,
    message: "hello",
  },
];

const gameState = {
  orders: 0,
  chaosEvents: 0,
  bossOrders: 0,
  freezeEvents: 0,
  megaRushEvents: 0,
};

const overlayState = {
  visible: false,
  title: "",
  subtitle: "",
  action: "NO_ACTION",
  color: "#ffcc00",
  sound: null,
  updatedAt: null,
};

function loadEventLog() {
  if (!fs.existsSync(eventLogFilePath)) {
    return [];
  }

  try {
    const savedLog = JSON.parse(fs.readFileSync(eventLogFilePath, "utf8"));

    if (!Array.isArray(savedLog)) {
      throw new Error("event-log.json must contain an array");
    }

    return savedLog;
  } catch (error) {
    throw new Error(`Failed to load event-log.json: ${error.message}`);
  }
}

const eventLog = loadEventLog();
let nextEventId =
  eventLog.reduce(function (highestId, entry) {
    return typeof entry.id === "number" && entry.id > highestId
      ? entry.id
      : highestId;
  }, 0) + 1;
const donationQueue = [];

const actionHandlers = {
  ADD_1_ORDER: function () {
    gameState.orders += 1;
    console.log("Added 1 order");
  },

  ADD_3_ORDERS: function () {
    gameState.orders += 3;
    console.log("Added 3 orders");
  },

  CHAOS_EVENT: function () {
    gameState.chaosEvents += 1;
    console.log("Chaos event triggered");
  },

  BOSS_ORDER: function () {
    gameState.bossOrders += 1;
    console.log("Boss order added");
  },

  FREEZE_TIME: function () {
    gameState.freezeEvents += 1;
    console.log("Time frozen");
  },

  MEGA_RUSH: function () {
    gameState.megaRushEvents += 1;
    console.log("Mega rush started");
  },
};

function decideAction(amount) {
  for (const rule of rules) {
    if (amount >= rule.minAmount) {
      return rule.action;
    }
  }

  return "NO_ACTION";
}

function validateRules(rules) {
  if (!Array.isArray(rules)) {
    throw new Error("rules.json must contain an array");
  }

  for (const rule of rules) {
    if (typeof rule.minAmount !== "number") {
      throw new Error("Each rule must have minAmount as a number");
    }

    if (typeof rule.action !== "string") {
      throw new Error("Each rule must have action as a string");
    }

    if (!actionHandlers[rule.action]) {
      throw new Error(`Unknown action: ${rule.action}`);
    }

    const config = actionConfig[rule.action];

    if (!config) {
      throw new Error(`Missing action config: ${rule.action}`);
    }

    if (typeof config.label !== "string") {
      throw new Error(
        `Action config must have label as a string: ${rule.action}`,
      );
    }

    if (typeof config.overlayDurationMs !== "number") {
      throw new Error(
        `Action config must have overlayDurationMs as a number: ${rule.action}`,
      );
    }

    if (typeof config.color !== "string") {
      throw new Error(
        `Action config must have color as a string: ${rule.action}`,
      );
    }

    if (typeof config.sound !== "string") {
      throw new Error(
        `Action config must have sound as a string: ${rule.action}`,
      );
    }

    if (config.sound) {
      const soundExtension = path.extname(config.sound).toLowerCase();

      if (!audioContentTypes[soundExtension]) {
        throw new Error(`Unsupported sound type for action: ${rule.action}`);
      }
    }
  }

  for (let index = 1; index < rules.length; index++) {
    const previousRule = rules[index - 1];
    const currentRule = rules[index];

    if (currentRule.minAmount > previousRule.minAmount) {
      throw new Error("Rules must be sorted from highest minAmount to lowest");
    }
  }
}
validateRules(rules);

function validateDonation(donation) {
  if (!donation || typeof donation !== "object") {
    throw new Error("Donation must be an object");
  }

  if (typeof donation.name !== "string" || donation.name.trim() === "") {
    throw new Error("Donation name is required");
  }

  if (
    typeof donation.amount !== "number" ||
    !Number.isFinite(donation.amount) ||
    donation.amount <= 0
  ) {
    throw new Error("Donation amount must be a positive number");
  }

  if (typeof donation.message !== "string") {
    throw new Error("Donation message must be a string");
  }
}

function handleAction(action) {
  const handler = actionHandlers[action];

  if (!handler) {
    console.log("No action");
    return;
  }

  handler();
}

let overlayHideTimeoutId = null;

function updateOverlay(donation, action) {
  if (action === "NO_ACTION") {
    return;
  }

  const config = actionConfig[action] || {};
  const actionLabel = config.label || action;
  const overlayDurationMs = config.overlayDurationMs || 5000;
  const color = config.color || "#ffcc00";
  const sound = config.sound || null;

  overlayState.visible = true;
  overlayState.title = `${donation.name} triggered ${actionLabel}`;
  overlayState.subtitle = `${donation.amount} donated: ${donation.message}`;
  overlayState.action = action;
  overlayState.color = color;
  overlayState.sound = sound;
  overlayState.updatedAt = new Date().toISOString();

  if (overlayHideTimeoutId) {
    clearTimeout(overlayHideTimeoutId);
  }

  overlayHideTimeoutId = setTimeout(function () {
    overlayState.visible = false;
  }, overlayDurationMs);
}

function processDonation(donation) {
  const processedAt = new Date().toISOString();
  const beforeState = { ...gameState };

  const action = decideAction(donation.amount);

  console.log("----------------");
  console.log(`${donation.name} donated ${donation.amount}`);
  console.log(`Message: ${donation.message}`);
  console.log(`Action: ${action}`);

  handleAction(action);
  updateOverlay(donation, action);

  const afterState = { ...gameState };

  const eventId = nextEventId;
  nextEventId += 1;

  const logEntry = {
    id: eventId,
    processedAt: processedAt,
    donation: donation,
    action: action,
    beforeState: beforeState,
    afterState: afterState,
  };

  eventLog.push(logEntry);
  fs.writeFileSync(eventLogFilePath, JSON.stringify(eventLog, null, 2));

  console.log("Current game state:", gameState);
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let body = "";
    let bodyTooLarge = false;

    req.on("data", function (chunk) {
      if (bodyTooLarge) {
        return;
      }

      body += chunk;

      if (body.length > 10_000) {
        bodyTooLarge = true;
        body = "";
      }
    });

    req.on("end", function () {
      if (bodyTooLarge) {
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

function startOverlayServer() {
  const server = http.createServer(async function (req, res) {
    const requestUrl = new URL(req.url, "http://localhost");
    const pathname = requestUrl.pathname;
    if (pathname === "/state") {
      res.writeHead(200, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify(overlayState));
      return;
    }

    if (pathname === "/test-donation") {
      if (req.method !== "POST") {
        res.writeHead(405, {
          "Content-Type": "application/json; charset=utf-8",
          Allow: "POST",
        });
        res.end(
          JSON.stringify({
            accepted: false,
            error: "Method not allowed",
          }),
        );
        return;
      }

      try {
        const donation = await readJsonBody(req);

        validateDonation(donation);

        donation.platform = donation.platform || "test";
        donationQueue.push(donation);

        res.writeHead(202, {
          "Content-Type": "application/json; charset=utf-8",
        });

        res.end(
          JSON.stringify({
            accepted: true,
            queueSize: donationQueue.length,
          }),
        );
      } catch (error) {
        const statusCode =
          error.message === "Request body too large" ? 413 : 400;

        res.writeHead(statusCode, {
          "Content-Type": "application/json; charset=utf-8",
        });

        res.end(
          JSON.stringify({
            accepted: false,
            error: error.message,
          }),
        );
      }

      return;
    }

    if (pathname.startsWith("/sounds/")) {
      let soundFileName;

      try {
        soundFileName = decodeURIComponent(pathname.slice("/sounds/".length));
      } catch {
        res.writeHead(400, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        res.end("Invalid URL");
        return;
      }

      const soundPath = path.resolve(soundsDir, soundFileName);

      if (
        soundPath !== soundsDir &&
        !soundPath.startsWith(soundsDir + path.sep)
      ) {
        res.writeHead(403, {
          "Content-Type": "text/plain",
        });
        res.end("Forbidden");
        return;
      }

      const extension = path.extname(soundPath).toLowerCase();
      const contentType = audioContentTypes[extension];

      if (!contentType) {
        res.writeHead(415, {
          "Content-Type": "text/plain",
        });
        res.end("Unsupported audio type");
        return;
      }

      let soundStats;

      try {
        soundStats = fs.statSync(soundPath);
      } catch {
        res.writeHead(404, {
          "Content-Type": "text/plain",
        });
        res.end("Sound not found");
        return;
      }

      if (!soundStats.isFile()) {
        res.writeHead(404, {
          "Content-Type": "text/plain",
        });
        res.end("Sound not found");
        return;
      }

      const soundStream = fs.createReadStream(soundPath);

      soundStream.on("error", function (error) {
        console.error(`Failed to read sound: ${soundPath}`);
        console.error(error.message);

        if (!res.headersSent) {
          res.writeHead(500, {
            "Content-Type": "text/plain",
          });
        }

        res.end("Failed to read sound");
      });

      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": soundStats.size,
      });

      soundStream.pipe(res);
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

    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end("Not found");
  });
  server.listen(serverPort, serverHost, function () {
    console.log(
      `Overlay server running at http://${serverHost}:${serverPort}`,
    );
  });
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, function (error, fileData) {
    if (error) {
      console.error(`Failed to read ${filePath}:`, error.message);

      res.writeHead(500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Failed to load file");
      return;
    }

    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": fileData.length,
    });
    res.end(fileData);
  });
}

startOverlayServer();

let donationIndex = 0;

if (mockDonationsEnabled) {
  const incomingIntervalId = setInterval(function () {
    if (donationIndex >= donations.length) {
      clearInterval(incomingIntervalId);
      console.log("No more incoming donations");
      return;
    }

    const donation = donations[donationIndex];
    donationQueue.push(donation);

    console.log(`Queued donation from ${donation.name}`);
    console.log(`Queue size: ${donationQueue.length}`);

    donationIndex += 1;
  }, 1000);
} else {
  console.log(
    "Mock donations disabled. Set ENABLE_MOCK_DONATIONS=true to enable them.",
  );
}

const processorIntervalId = setInterval(function () {
  if (donationQueue.length === 0) {
    return;
  }

  const donation = donationQueue.shift();
  processDonation(donation);

  console.log(`Queue size after processing: ${donationQueue.length}`);
}, 3000);
