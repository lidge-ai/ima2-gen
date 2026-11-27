// Resolution names: providers spell the same size differently ("1K" and "1k", "480P" and "480p").
// The catalog offers one readable label per size, and a request may use any spelling: the provider
// is always sent its own.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configDir = await mkdtemp(join(tmpdir(), "ima2-resolution-labels-"));
process.env.IMA2_CONFIG_DIR = configDir;

const { resolutionLabel, resolutionOptions, sameResolution, specResolution } = await import("../lib/providers/media/resolutionLabel.ts");
const { MediaRegistry } = await import("../lib/providers/media/registry.ts");
const { MediaKeySnapshot } = await import("../lib/providers/media/credentials.ts");
const { buildMediaCatalog } = await import("../lib/providers/media/catalog.ts");
const { prepareMediaJob } = await import("../lib/providers/media/runner.ts");
const { parseMediaJobBody } = await import("../lib/providers/media/validate.ts");
const { FAKE_KEY, fakeSpec, makeFakeAdapter } = await import("./_mediaFakeAdapter.ts");
const { releaseDatabase } = await import("./helpers/releaseDatabase.ts");

test.after(async () => {
  await releaseDatabase();
  await rm(configDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("a size reads the same however the provider spells it; anything else is left as written", () => {
  assert.deepEqual(["1k", "1.5K", "4k", "480P", "720p", "1080P"].map(resolutionLabel), ["1K", "1.5K", "4K", "480p", "720p", "1080p"]);
  assert.deepEqual(["1080p-SR", "4k-esr", "1080p-esr & 60fps"].map(resolutionLabel), ["1080p-sr", "4K-esr", "1080p-esr & 60fps"]);
  assert.deepEqual(["1024x1536", "auto", "768sq"].map(resolutionLabel), ["1024x1536", "auto", "768sq"]);
  assert.ok(sameResolution("1K", " 1k ") && sameResolution("480P", "480p") && !sameResolution("1K", "2K") && !sameResolution("1080p", "1080p-sr"));
});

test("options list each size once with the provider's own value, and a request finds that value by any spelling", () => {
  assert.deepEqual(resolutionOptions(["480P", "720P", "1080P"]), [{ value: "480P", label: "480p" }, { value: "720P", label: "720p" }, { value: "1080P", label: "1080p" }]);
  assert.deepEqual(resolutionOptions(["1k", "1K", "2k"]), [{ value: "1k", label: "1K" }, { value: "2k", label: "2K" }], "the first spelling is the one sent");
  assert.equal(specResolution(["480P", "720P"], "720p"), "720P");
  assert.equal(specResolution(["1k", "2k"], "2K"), "2k");
  assert.equal(specResolution(["480P", "720P"], "1080p"), undefined);
  assert.equal(specResolution(undefined, "720p"), undefined);
});

test("the catalog carries the labels, and a job is checked and sent in the route's own spelling", async () => {
  const script = { states: [{ status: "succeeded" as const, outputs: [] }], submitted: [] as import("../lib/providers/media/contract.ts").MediaSubmitRequest[] };
  const adapter = makeFakeAdapter({ script, models: [fakeSpec("acme/clip-1", { params: { durationsSec: [5], resolutions: ["480P", "720P"] } })] });
  const registry = new MediaRegistry([adapter]);
  const catalog = buildMediaCatalog(registry, new MediaKeySnapshot({ env: {}, fileConfig: {} }), "video");
  const route = catalog.models[0]!.routes[0]!;
  assert.deepEqual(route.params.resolutions, ["480P", "720P"], "the provider's spelling is unchanged");
  assert.deepEqual(route.resolutionOptions, [{ value: "480P", label: "480p" }, { value: "720P", label: "720p" }]);
  const configFile = join(configDir, "config.json");
  await writeFile(configFile, JSON.stringify({ fakeApiKey: FAKE_KEY }));
  const deps = { registry, configFile, env: {}, generatedDir: join(configDir, "generated"), inputsDir: join(configDir, "inputs") } as never;
  const prepared = await prepareMediaJob(deps, parseMediaJobBody({ model: "acme/clip-1", task: "text-to-video", prompt: "a fox", durationSec: 5, resolution: "720p" }));
  assert.equal(prepared.request.resolution, "720P");
  await assert.rejects(prepareMediaJob(deps, parseMediaJobBody({ model: "acme/clip-1", task: "text-to-video", prompt: "a fox", resolution: "1080p" })), /does not support resolution 1080p/);
});
