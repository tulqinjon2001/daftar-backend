require("dotenv/config");
const express = require("express");
const cors = require("cors");
const prisma = require("./prisma");
const {
  parseAllowedOrigins,
  isOriginAllowed,
  buildErrorResponse,
} = require("./config/http");
const {
  log,
  requestLoggerMiddleware,
  logProcessHandlers,
  logStartupMeta,
} = require("./utils/logger");

logProcessHandlers();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

// ——— CORS ———
const allowedOrigins = parseAllowedOrigins(process.env.CLIENT_ALLOWED_ORIGIN);

app.use(
  cors({
    origin: (origin, callback) => {
      // curl yoki Postman kabi origin bo'lmagan so'rovlarga ham ruxsat
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

app.use(express.json());
app.use(requestLoggerMiddleware);

// CORS rad etilgan so'rovlar uchun aniq 403 javob
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return res
      .status(403)
      .json({
        success: false,
        data: null,
        message: `CORS: ${origin} ruxsatsiz`,
      });
  }
  return next();
});

// ——— Standart API javob formati: { success, data, message } ———
function apiResponse(
  res,
  success,
  data = null,
  message = "",
  statusCode = 200,
) {
  return res.status(statusCode).json({ success, data, message });
}

// ——— Routes: API v1 ———
const authRoutes = require("./routes/authRoutes");
const clientRoutes = require("./routes/clientRoutes");
const debtRoutes = require("./routes/debtRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const balanceRoutes = require("./routes/balanceRoutes");
const reportsRoutes = require("./routes/reportsRoutes");
const telegramRoutes = require("./routes/telegramRoutes");

app.use("/api/v1/telegram", telegramRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/clients", clientRoutes);
app.use("/api/v1/debts", debtRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/suppliers", supplierRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/balance", balanceRoutes);
app.use("/api/v1/reports", reportsRoutes);

// ——— Asosiy / health ———
app.get("/", (_req, res) => {
  apiResponse(
    res,
    true,
    { service: "Qarz Daftar API", version: "1.0.0" },
    "OK",
  );
});

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    apiResponse(res, true, { db: "connected" }, "OK");
  } catch (err) {
    log.error("health: database check failed", err);
    apiResponse(res, false, null, "Database connection failed", 503);
  }
});

// ——— 404 handler ———
app.use((req, res) => {
  res.status(404).json({ success: false, data: null, message: "Not found" });
});

// ——— Global xato handler ———
app.use((err, _req, res, _next) => {
  log.error("Unhandled error", err);
  const status = Number(err?.statusCode) || 500;
  const payload = buildErrorResponse(err, isProduction);
  res.status(status).json(payload);
});

async function gracefulShutdown(signal) {
  log.info(`Signal ${signal}, shutting down...`);
  try {
    await prisma.$disconnect();
    log.info("Prisma disconnected");
  } catch (e) {
    log.error("Prisma disconnect error", e);
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
});

// ——— Server ———
app.listen(PORT, () => {
  logStartupMeta(PORT, {
    service: "Qarz Daftar API",
    corsOrigins: allowedOrigins.length ? allowedOrigins.join(", ") : "(hamma origin — ro‘yxat bo‘sh)",
  });
  log.info(`HTTP: http://localhost:${PORT}  (Render’da RENDER_EXTERNAL_URL ni tekshiring)`);
  const { startTelegramPolling } = require("./services/telegramPolling");
  startTelegramPolling();
});
