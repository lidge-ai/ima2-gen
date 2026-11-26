import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.IMA2_CONFIG_DIR = await mkdtemp(join(tmpdir(), "ima2-media-ui-"));
const { extraFieldStatus } = await import("../ui/src/lib/mediaKeys.js");

test("extra fields combine vocabulary with legacy adapter status", () => {
  const vocabulary = { vocabulary: "vertex", label: "Vertex", legacy: true, consoleUrl: "", keyPrefix: null,
    extraFields: [{ name: "location", secret: false, required: true }] };
  assert.deepEqual(extraFieldStatus(vocabulary, undefined, [{ keyVocabulary: "vertex", extraFields: [
    { name: "location", secret: false, required: true, configured: true, source: "config", value: "us" },
  ] }]), [{ name: "location", secret: false, required: true, configured: true, source: "config", value: "us" }]);
});

test("media status takes precedence and secret values stay absent", () => {
  const vocabulary = { vocabulary: "fake", label: "Fake", legacy: false, consoleUrl: "", keyPrefix: null,
    extraFields: [{ name: "secret", secret: true, required: true }] };
  const fields = extraFieldStatus(vocabulary, { configured: true, source: "env", maskedKey: "***",
    extraFields: [{ name: "secret", secret: true, required: true, configured: true, source: "env" }] }, []);
  assert.equal(fields[0]?.configured, true);
  assert.equal(fields[0]?.value, undefined);
});
