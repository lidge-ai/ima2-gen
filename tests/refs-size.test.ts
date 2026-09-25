// tests/refs-size.test.ts — 0.09.7 validator returns { error, code } for all 6 paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectImageMimeFromB64, summarizeReferencePayload, validateAndNormalizeRefs } from "../lib/refs.ts";

const VALID_B64 = "aGVsbG8=";

test("REF_NOT_ARRAY when references is not an array", () => {
  const r = validateAndNormalizeRefs("nope");
  assert.equal(r.code, "REF_NOT_ARRAY");
  assert.match(r.error, /must be an array/);
});

test("REF_TOO_MANY when over maxCount", () => {
  const refs = Array(6).fill(VALID_B64);
  const r = validateAndNormalizeRefs(refs, { maxCount: 5 });
  assert.equal(r.code, "REF_TOO_MANY");
});

test("REF_NOT_STRING when element is non-string", () => {
  const r = validateAndNormalizeRefs([123]);
  assert.equal(r.code, "REF_NOT_STRING");
});

test("REF_EMPTY when element is empty", () => {
  const r = validateAndNormalizeRefs([""]);
  assert.equal(r.code, "REF_EMPTY");
});

test("REF_TOO_LARGE when element exceeds maxB64Bytes", () => {
  const big = "A".repeat(100);
  const r = validateAndNormalizeRefs([big], { maxB64Bytes: 50 });
  assert.equal(r.code, "REF_TOO_LARGE");
  assert.match(r.error, /exceeds 50 bytes/);
});

test("REF_NOT_BASE64 when element has invalid chars", () => {
  const r = validateAndNormalizeRefs(["not valid !!!"]);
  assert.equal(r.code, "REF_NOT_BASE64");
});

test("valid references strip data URL prefix and return normalized b64", () => {
  const r = validateAndNormalizeRefs([`data:image/png;base64,${VALID_B64}`]);
  assert.deepEqual(r.refs, [VALID_B64]);
  assert.equal(r.error, undefined);
});

test("valid references without prefix pass through", () => {
  const r = validateAndNormalizeRefs([VALID_B64, VALID_B64]);
  assert.deepEqual(r.refs, [VALID_B64, VALID_B64]);
});

test("reference diagnostics preserve declared and detected MIME without exposing raw b64", () => {
  const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
  const r = validateAndNormalizeRefs([`data:image/png;base64,${jpegB64}`]);

  assert.equal(r.error, undefined);
  assert.equal(r.refDetails[0].declaredMime, "image/png");
  assert.equal(r.refDetails[0].detectedMime, "image/jpeg");
  assert.deepEqual(r.refDetails[0].warnings, ["mime_mismatch"]);
  assert.equal((r.referenceDiagnostics[0] as { b64?: unknown }).b64, undefined);
  assert.equal(r.referenceDiagnostics[0].detectedMime, "image/jpeg");
});

test("detectImageMimeFromB64 detects common image signatures", () => {
  assert.equal(detectImageMimeFromB64(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")), "image/png");
  assert.equal(detectImageMimeFromB64(Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64")), "image/jpeg");
  assert.equal(detectImageMimeFromB64(Buffer.from("RIFFxxxxWEBP", "ascii").toString("base64")), "image/webp");
});

test("summarizeReferencePayload reports count and byte diagnostics without raw payload", () => {
  const payload = summarizeReferencePayload([`data:image/png;base64,${VALID_B64}`, VALID_B64]);

  assert.equal(payload.refsCount, 2);
  assert.equal(payload.referenceB64Chars, VALID_B64.length * 2);
  assert.equal(payload.referenceBytes, Buffer.from(VALID_B64, "base64").length * 2);
});
