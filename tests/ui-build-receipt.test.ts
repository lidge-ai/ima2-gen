import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseUiBuildReceipt, sourceInputDigest, assertUiReceiptBinding } from "../scripts/lib/uiBuildReceipt.mjs";
import { fixtureCompilerEnvironment } from "../scripts/lib/uiBuildReceiptFiles.mjs";

const options: any = { mode: "production", sourcemap: false, devUi: false, nodeMode: true, cardNews: true, agentMode: true };
const files = [{ path: "ui/index.html", bytes: 1, sha256: "a".repeat(64) }, { path: "ui/src/a.ts", bytes: 2, sha256: "b".repeat(64) }];
const outputs = [{ path: "index.html", bytes: 1, sha256: "c".repeat(64) }];
const source: any = { headSha: "d".repeat(40), sourceInputDigest: "e".repeat(64), buildOptions: options };
const receipt = () => ({ schemaVersion: 1, ...source, outputs });

test("receipt digest has an independent fixed preimage and enumeration is order independent", () => {
  assert.equal(sourceInputDigest(files, options), "fa81e0c5165375779f4113b861eefd46402bf74b8a227c7fa9286408587f4c10");
  assert.equal(sourceInputDigest([...files].reverse(), options), sourceInputDigest(files, options));
  const independent = createHash("sha256").update(JSON.stringify([1,
    ["production", false, false, true, true, true], files.map((f) => [f.path, f.bytes, f.sha256])])).digest("hex");
  assert.equal(sourceInputDigest(files, options), independent);
  assert.notEqual(sourceInputDigest(files, { ...options, devUi: true }), independent);
});

test("receipt parser rejects malformed schema, unsafe or duplicated outputs without defaults", () => {
  assert.deepEqual(parseUiBuildReceipt(receipt()), receipt());
  for (const patch of [{ schemaVersion: 2 }, { headSha: 7 }, { extra: true }, { sourceInputDigest: "bad" },
    { outputs: [] }, { buildOptions: { ...options, devUi: "false" } }]) {
    assert.throws(() => parseUiBuildReceipt({ ...receipt(), ...patch }), { code: "UI_RECEIPT_SCHEMA" });
  }
  for (const path of ["../x", "/x", "a\\b", "a//b", "C:x", ".ima2-ui-build-receipt.json"]) {
    assert.throws(() => parseUiBuildReceipt({ ...receipt(), outputs: [{ ...outputs[0], path }] }), { code: "UI_RECEIPT_SCHEMA" });
  }
  for (const rows of [[...outputs, ...outputs], [{ ...outputs[0], path: "Index.html" }, ...outputs]]) {
    assert.throws(() => parseUiBuildReceipt({ ...receipt(), outputs: rows }), { code: "UI_RECEIPT_SCHEMA" });
  }
});

test("binding detects changed head, source, flags, same-sized output and archive constraints", () => {
  assert.equal(assertUiReceiptBinding(receipt(), source, outputs, true), "git-and-source");
  assert.throws(() => assertUiReceiptBinding(receipt(), { ...source, headSha: "f".repeat(40) }, outputs, true), { code: "UI_RECEIPT_HEAD" });
  assert.throws(() => assertUiReceiptBinding(receipt(), { ...source, sourceInputDigest: "f".repeat(64) }, outputs, false), { code: "UI_RECEIPT_SOURCE" });
  assert.throws(() => assertUiReceiptBinding(receipt(), { ...source, buildOptions: { ...options, devUi: true } }, outputs, false), { code: "UI_RECEIPT_SOURCE" });
  for (const rows of [[], [...outputs, { ...outputs[0], path: "new" }], [{ ...outputs[0], sha256: "f".repeat(64) }]]) {
    assert.throws(() => assertUiReceiptBinding(receipt(), source, rows, false), { code: "UI_RECEIPT_OUTPUT" });
  }
  const archive = { ...source, headSha: null };
  assert.equal(assertUiReceiptBinding({ ...receipt(), headSha: null }, archive, outputs, false), "source-digest");
  assert.throws(() => assertUiReceiptBinding({ ...receipt(), headSha: null }, archive, outputs, true), { code: "UI_RECEIPT_HEAD" });
});

test("strict compiler environment fixes resolver target and excludes secret and loader variables", () => {
  const child = fixtureCompilerEnvironment({ PATH: "/synthetic/bin", HOME: "/unread-home", OPENAI_API_KEY: "sentinel",
    NODE_OPTIONS: "--import sentinel", HTTPS_PROXY: "sentinel", IMA2_ADVERTISE_FILE: "/sentinel", VITE_IMA2_NODE_MODE: "0" });
  assert.deepEqual(child, { PATH: "/synthetic/bin", VITE_IMA2_NODE_MODE: "0", NODE_ENV: "production",
    VITE_IMA2_API_TARGET: "http://127.0.0.1:1", IMA2_UI_RECEIPT_BUILD: "1" });
  for (const env of [{ VITE_UNKNOWN: "secret" }, { VITE_SOURCEMAP: "yes" }, { VITE_IMA2_API_TARGET: "http://foreign" }]) {
    assert.throws(() => fixtureCompilerEnvironment(env), { code: "UI_RECEIPT_OPTIONS" });
  }
});
