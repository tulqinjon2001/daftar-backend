function parseAllowedOrigins(raw) {
  return String(raw || "http://localhost:5173")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function buildErrorResponse(err, isProduction) {
  const message = err?.publicMessage || "Internal server error";
  const out = { success: false, data: null, message };
  if (!isProduction) {
    out.error = {
      name: err?.name || "Error",
      detail: err?.message || String(err),
    };
  }
  return out;
}

module.exports = {
  parseAllowedOrigins,
  isOriginAllowed,
  buildErrorResponse,
};
