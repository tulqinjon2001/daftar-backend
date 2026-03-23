const buckets = new Map();

function cleanupOldBuckets(now) {
  for (const [k, v] of buckets.entries()) {
    if (now >= v.resetAt) buckets.delete(k);
  }
}

function makeKey(req, keyBy) {
  if (keyBy === "ip") return req.ip || req.headers["x-forwarded-for"] || "unknown";
  if (typeof keyBy === "function") return keyBy(req);
  return req.ip || "unknown";
}

function createRateLimit({ windowMs, max, keyBy = "ip", message = "Too many requests" }) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    cleanupOldBuckets(now);

    const baseKey = makeKey(req, keyBy);
    const key = `${req.path}:${baseKey}`;
    const existing = buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    if (existing.count > max) {
      const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
      return res.status(429).json({ success: false, data: null, message });
    }
    return next();
  };
}

module.exports = { createRateLimit };
