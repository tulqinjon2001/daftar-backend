const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAllowedOrigins,
  isOriginAllowed,
  buildErrorResponse,
} = require("../src/config/http");

test("parseAllowedOrigins trims and drops empties", () => {
  const list = parseAllowedOrigins(" http://a.com, ,http://b.com  ");
  assert.deepEqual(list, ["http://a.com", "http://b.com"]);
});

test("isOriginAllowed permits missing origin and whitelisted origin", () => {
  const allowed = ["http://localhost:5173"];
  assert.equal(isOriginAllowed(undefined, allowed), true);
  assert.equal(isOriginAllowed("http://localhost:5173", allowed), true);
  assert.equal(isOriginAllowed("http://evil.local", allowed), false);
});

test("buildErrorResponse returns safe message in production", () => {
  const payload = buildErrorResponse(new Error("db down"), true);
  assert.equal(payload.success, false);
  assert.equal(payload.message, "Internal server error");
  assert.equal("error" in payload, false);
});

test("buildErrorResponse returns details in development", () => {
  const payload = buildErrorResponse(new Error("db down"), false);
  assert.equal(payload.success, false);
  assert.equal(payload.message, "Internal server error");
  assert.equal(payload.error.detail, "db down");
});
