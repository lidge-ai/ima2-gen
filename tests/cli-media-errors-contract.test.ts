import { test } from "node:test";
import assert from "node:assert/strict";
import { toMediaApiError, scrub, formatMediaError, cliErrorJson, mcpErrorStructured } from "../bin/lib/mediaErrors.js";

test("errors retain allowed fields and expose consistent CLI and MCP representations", () => {
  const error = toMediaApiError({ body: { code: "MEDIA_KEY_MISSING", error: "No key saved for Sume", category: "auth", retryable: false, status: 400, field: "key", stepId: "a", secret: "no" } });
  assert.equal(formatMediaError(error), "MEDIA_KEY_MISSING: No key saved for Sume (auth)");
  assert.deepEqual(cliErrorJson(error), { ok: false, code: "MEDIA_KEY_MISSING", error: "No key saved for Sume", category: "auth" });
  assert.match(String(mcpErrorStructured(error).hint), /ima2 media keys/);
  assert.equal("secret" in mcpErrorStructured(error), false);
  assert.equal(toMediaApiError({ code: "SSE_ERROR", error: "bad" }).message, "bad");
  assert.equal(toMediaApiError(new Error("oops")).code, "MEDIA_CLI_ERROR");
});

test("scrubbing removes overlapping secrets and replacement collisions", () => {
  for (const secrets of [["12345678901234567890123456789012"], ["abcdef", "cdefgh"], ["redact"], ["123456"]]) {
    const output = scrub(secrets.join(" "), secrets);
    for (const secret of secrets) assert.equal(output.includes(secret), false);
  }
  assert.equal(formatMediaError(toMediaApiError(new Error("oops"))), "MEDIA_CLI_ERROR: oops");
});


test("formatting stays compatible for quota, moderation and route errors", () => {
  for (const [code, message, category, expected] of [
    ["FAL_INSUFFICIENT_CREDIT", "No credit", "quota", "FAL_INSUFFICIENT_CREDIT: No credit (quota)"],
    ["BYTEPLUS_REAL_PERSON_BLOCKED", "Blocked", "moderation", "BYTEPLUS_REAL_PERSON_BLOCKED: Blocked (moderation)"],
    ["MEDIA_ROUTE_UNKNOWN", "Unknown route", undefined, "MEDIA_ROUTE_UNKNOWN: Unknown route"],
  ]) assert.equal(formatMediaError(toMediaApiError({ code, error: message, category })), expected);
});
