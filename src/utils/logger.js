/**
 * Render.com va boshqa muhitlarda: vaqt belgili qatorlar, HTTP so‘rovlar, process xatolari.
 * LOG_LEVEL=error|warn|info|debug (standart: info)
 * LOG_HTTP_HEALTH=1 — GET /health har birini ham log qiladi (aks holda faqat debug’da)
 */

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function levelNum(name) {
  return LEVELS[name] ?? LEVELS.info;
}

function timestamp() {
  return new Date().toISOString();
}

function shouldLog(level) {
  return levelNum(level) <= levelNum(LOG_LEVEL);
}

function formatMsg(level, message) {
  return `[${timestamp()}] ${level.toUpperCase()} ${message}`;
}

const log = {
  error(message, detail) {
    console.error(formatMsg("error", message), detail != null ? detail : "");
  },
  warn(message, detail) {
    if (!shouldLog("warn")) return;
    if (detail !== undefined) console.warn(formatMsg("warn", message), detail);
    else console.warn(formatMsg("warn", message));
  },
  info(message, detail) {
    if (!shouldLog("info")) return;
    if (detail !== undefined) console.log(formatMsg("info", message), detail);
    else console.log(formatMsg("info", message));
  },
  debug(message, detail) {
    if (!shouldLog("debug")) return;
    if (detail !== undefined) console.log(formatMsg("debug", message), detail);
    else console.log(formatMsg("debug", message));
  },
};

/**
 * So‘rov tugagach: method path status vaqt (ms). /health — kamroq shovqin uchun ixtiyoriy.
 */
function requestLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const path = req.originalUrl || req.url || "";
  const isHealth = req.method === "GET" && (path === "/health" || path.startsWith("/health?"));

  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1_000_000n);
    if (isHealth && process.env.LOG_HTTP_HEALTH !== "1") {
      if (shouldLog("debug")) {
        log.debug(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
      }
      return;
    }
    log.info(`${req.method} ${path} ${res.statusCode} ${ms}ms`);
  });

  next();
}

function logProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", reason);
  });
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", err);
    process.exit(1);
  });
}

function logStartupMeta(port, extra = {}) {
  log.info("Server listening", {
    port: String(port),
    node: process.version,
    NODE_ENV: process.env.NODE_ENV || "development",
    RENDER: process.env.RENDER === "true" ? "true" : process.env.RENDER || "(not set)",
    RENDER_SERVICE_NAME: process.env.RENDER_SERVICE_NAME || "(not set)",
    LOG_LEVEL,
    ...extra,
  });
}

module.exports = {
  log,
  requestLoggerMiddleware,
  logProcessHandlers,
  logStartupMeta,
};
