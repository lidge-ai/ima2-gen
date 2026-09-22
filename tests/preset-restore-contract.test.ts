import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { buildIma2Xmp, buildIma2MetadataPayload, parseIma2Xmp } from "../lib/imageMetadata.ts";
import { isImageToolModel, normalizeImageQuality } from "../ui/src/lib/imageModels.ts";

/**
 * The Home preset grid was removed in 3.3.0. That leaves a trap: a presetIds
 * array stored by an earlier version would keep prepending its prompt fragment
 * to every generation, with no UI left to show or clear it.
 *
 * storePersistence.ts cannot be imported here — it pulls in Vite-only
 * import.meta.env through the provider registry. So instead of mocking a
 * browser, these tests execute the loader's real restore body against stored
 * payloads: the source is read, the function is extracted, and the behaviour is
 * exercised. If someone re-adds the presetIds branch, the extracted body starts
 * returning it and these tests fail.
 */

const persistenceSource = readFileSync("ui/src/store/storePersistence.ts", "utf8");

/**
 * Runs the real restore body against a payload. Guards and helpers that need
 * the app runtime are replaced with permissive stand-ins, so the assertions
 * below are about which keys survive, not about each validator.
 */
function restoreDefaults(payload: unknown): Record<string, unknown> {
  const start = persistenceSource.indexOf("export function loadGenerationDefaults");
  assert.ok(start > 0, "loadGenerationDefaults must exist");
  const bodyStart = persistenceSource.indexOf("{", start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < persistenceSource.length; i += 1) {
    if (persistenceSource[i] === "{") depth += 1;
    else if (persistenceSource[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = persistenceSource
    .slice(bodyStart, end)
    .replace(/:\s*GenerationDefaults/g, "")
    .replace(/\(id\): id is string =>/g, "(id) =>")
    .replace(/as Record<string, unknown>/g, "")
    .replace(/ as string \| null/g, "");

  const pass = () => true;
  const fn = new Function(
    "localStorage",
    "GENERATION_DEFAULTS_STORAGE_KEY",
    "isProvider",
    "isQuality",
    "isSizePreset",
    "isFormat",
    "isModeration",
    "isPromptMode",
    "normalizeMcpRatio",
    "normalizeMcpParameters",
    "normalizeCount",
    "normalizeInsertedPromptArray",
    "parseRequestedCustomSide",
    "getPresetById",
    "isImageToolModel",
    "normalizeImageQuality",
    `return (function ()${body})();`,
  );

  return fn(
    { getItem: () => (payload === undefined ? null : JSON.stringify(payload)) },
    "ima2:generation-defaults",
    pass, pass, pass, pass, pass, pass,
    (v: unknown) => v,
    (v: unknown) => v,
    (v: unknown) => v,
    (v: unknown) => (Array.isArray(v) ? v : undefined),
    (v: unknown) => v,
    () => true,
    isImageToolModel,
    normalizeImageQuality,
  ) as Record<string, unknown>;
}

describe("preset restore contract", () => {
  it("drops a stored presetIds array instead of restoring it", () => {
    const restored = restoreDefaults({
      provider: "oauth",
      presetIds: ["cinematic", "golden-hour"],
    });

    assert.equal(
      restored.presetIds,
      undefined,
      "a stored preset selection must not come back: nothing can clear it anymore",
    );
  });

  it("keeps every other stored default while dropping presetIds", () => {
    const restored = restoreDefaults({
      provider: "grok",
      quality: "high",
      format: "png",
      prompt: "a lighthouse at dusk",
      count: 3,
      presetIds: ["anime"],
    });

    assert.equal(restored.provider, "grok");
    assert.equal(restored.quality, "high");
    assert.equal(restored.format, "png");
    assert.equal(restored.prompt, "a lighthouse at dusk");
    assert.equal(restored.count, 3);
    assert.equal(restored.presetIds, undefined);
  });

  it("survives a stored payload with no presetIds at all", () => {
    const restored = restoreDefaults({ provider: "api", count: 2 });

    assert.equal(restored.provider, "api");
    assert.equal(restored.count, 2);
    assert.equal(restored.presetIds, undefined);
  });

  it("no longer resolves preset definitions while loading defaults", () => {
    // getPresetById was imported only to validate stored ids. Keeping the
    // import would mean the catalog is still on the restore path.
    assert.ok(
      !persistenceSource.includes("getPresetById"),
      "storePersistence must not reach into the preset catalog anymore",
    );
  });

  it("rebuilds saved defaults from the loader, so a stale array cannot survive a write", () => {
    // saveGenerationDefaultsPatch spreads loadGenerationDefaults() before the
    // patch. Since the loader now drops presetIds, every write drops it too.
    assert.match(
      persistenceSource,
      /export function saveGenerationDefaultsPatch[\s\S]*?const current = loadGenerationDefaults\(\)[\s\S]*?\.\.\.current/,
    );
  });

  it("round-trips preset IDs through XMP generation metadata", () => {
    // Unchanged on purpose: historical images carry presetIds as provenance and
    // that parser stays readable even though the UI can no longer set them.
    const metadata = buildIma2MetadataPayload({
      prompt: "A cinematic city",
      presetIds: ["cinematic", "golden-hour"],
    });

    const restored = parseIma2Xmp(buildIma2Xmp(metadata));
    assert.deepEqual(restored?.presetIds, ["cinematic", "golden-hour"]);
  });
});
