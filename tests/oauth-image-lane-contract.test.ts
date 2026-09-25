/**
 * GPT OAuth image lane through the real routes (lib/oauthImages.ts).
 *
 * GPT OAuth plans with a GPT-6 model (streamed /v1/responses with the `image_gen` function tool)
 * and renders with gpt-image-2 through /v1/images/{generations,edits}. Direct mode skips the
 * planner. These cases pin that wire, the metadata the routes persist, and legacy model migration.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, type RouteCase, type RouteHarness, type UpstreamCall } from "./_executionRouteHarness.ts";
import { imagesJson, plannerSse } from "./_oauthNativeFixture.ts";

const OAUTH = "http://oauth-fixture.invalid";
const BASE = { provider: "oauth", prompt: "lane raw prompt", quality: "high", size: "1536x1024", moderation: "low",
  reasoningEffort: "medium", webSearchEnabled: false, sizeNudge: false, format: "png" };

async function fields(call: UpstreamCall) {
  if (call.url.endsWith("/v1/images/generations")) return { json: JSON.parse(call.body), images: 0 };
  const form = await new Request(call.url, { method: "POST", headers: call.headers, body: call.body }).formData();
  const json: Record<string, string> = {};
  let images = 0;
  form.forEach((value, key) => {
    if (key === "image") images++;
    else if (typeof value === "string") json[key] = value;
  });
  return { json, images };
}

async function meta(f: RouteCase, filename: unknown) {
  assert.equal(typeof filename, "string");
  return JSON.parse(await readFile(join(f.generatedDir, `${filename}.json`), "utf8"));
}

const endpointOf = (call: UpstreamCall) => call.url.slice(OAUTH.length);

if (executionTestProcess(import.meta.url)) describe("GPT OAuth image lane contract", { concurrency: false }, () => {
  let harness: RouteHarness;
  let red: string, green: string, blue: string, mask: string;
  before(async () => {
    harness = await openRouteHarness();
    [red, green, blue] = await Promise.all(["#ff0000", "#00ff00", "#0000ff"].map(async (background) =>
      (await sharp({ create: { width: 8, height: 8, channels: 3, background } }).png().toBuffer()).toString("base64")));
    mask = (await sharp(Buffer.from(green, "base64")).ensureAlpha(0.5).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });

  for (const surface of ["classic", "node", "edit", "multimode"] as const) {
    it(`direct ${surface}: one render call, legacy model migrated, metadata persisted`, async () => {
      await harness.run(surface, { upstream: () => imagesJson(red) }, async (f) => {
        const response = await f.post({ ...BASE, mode: "direct", model: "gpt-5.6-luna",
          ...(surface === "edit" ? { image: blue } : { references: [green] }),
          ...(surface === "multimode" ? { async: true, maxImages: 1 } : {}) });
        assert.equal(response.status, surface === "multimode" ? 202 : 200);
        const result = surface === "multimode" ? (await f.waitTerminal()).data : await response.json();
        await f.waitSettled();
        assert.deepEqual(f.calls.map(endpointOf), ["/v1/images/edits"], "direct mode skips the planner");
        assert.equal(f.calls[0]!.headers.get("authorization"), null, "the proxy transport adds no credentials");
        const { json, images } = await fields(f.calls[0]!);
        assert.deepEqual(json, { model: "gpt-image-2", prompt: BASE.prompt, quality: "high", size: "1536x1024", moderation: "low" });
        assert.equal(images, 1);
        const image = surface === "multimode" ? f.events.find((e) => e.event === "image")!.data : result;
        assert.equal(image.image, `data:image/png;base64,${red}`);
        const saved = await meta(f, image.filename);
        assert.equal(saved.provider, "oauth");
        assert.equal(saved.model, "gpt-6-luna", "a legacy OAuth id runs on its GPT-6 tier");
        assert.equal(saved.prompt, BASE.prompt);
        assert.equal((await readdir(f.generatedDir)).filter((file) => file.endsWith(".json")).length, 1);
      });
    });
  }

  it("auto classic: the GPT-6 planner writes the prompt and gpt-image-2 renders it", async () => {
    await harness.run("classic", { upstream: (call) => (
      endpointOf(call) === "/v1/responses" ? plannerSse(["a red square, studio light"]) : imagesJson(red)
    ) }, async (f) => {
      const response = await f.post({ ...BASE, mode: "auto", model: "gpt-6-sol", webSearchEnabled: true });
      assert.equal(response.status, 200);
      const result = await response.json();
      await f.waitSettled();
      assert.deepEqual(f.calls.map(endpointOf), ["/v1/responses", "/v1/images/generations"]);
      const plan = JSON.parse(f.calls[0]!.body);
      assert.equal(plan.model, "gpt-6-sol");
      assert.equal(plan.stream, true);
      assert.deepEqual(plan.reasoning, { effort: "medium" });
      assert.deepEqual(plan.tools.map((tool: { type: string; name?: string }) => tool.name ?? tool.type), ["web_search", "image_gen"]);
      assert.equal(plan.input[0].role, "developer");
      assert.match(JSON.stringify(plan.input[1].content), /lane raw prompt/);
      const { json } = await fields(f.calls[1]!);
      assert.deepEqual(json, { model: "gpt-image-2", prompt: "a red square, studio light", n: 1, quality: "high", size: "1536x1024", moderation: "low" });
      assert.equal(result.image, `data:image/png;base64,${red}`);
      assert.equal((await meta(f, result.filename)).revisedPrompt, "a red square, studio light");
    });
  });

  it("auto multimode: planned stages render in order, one image each", async () => {
    const byPrompt: Record<string, string> = { "stage A": red, "stage B": blue };
    await harness.run("multimode", { upstream: async (call) => {
      if (endpointOf(call) === "/v1/responses") return plannerSse(["stage A", "stage B"]);
      return imagesJson(byPrompt[(await fields(call)).json.prompt]!);
    } }, async (f) => {
      const response = await f.post({ ...BASE, mode: "auto", model: "gpt-6-luna", async: true, maxImages: 2 });
      assert.equal(response.status, 202);
      await f.waitTerminal();
      await f.waitSettled();
      assert.deepEqual(f.calls.map(endpointOf), ["/v1/responses", "/v1/images/generations", "/v1/images/generations"]);
      const images = f.events.filter((e) => e.event === "image").map((e) => e.data.image);
      assert.deepEqual(images, [`data:image/png;base64,${red}`, `data:image/png;base64,${blue}`]);
    });
  });

  it("auto edit with a mask: the planner and renderer see source then mask guide", async () => {
    await harness.run("edit", { upstream: (call) => (
      endpointOf(call) === "/v1/responses" ? plannerSse(["recolor the masked area"]) : imagesJson(red)
    ) }, async (f) => {
      const response = await f.post({ ...BASE, mode: "auto", model: "gpt-6-luna", image: green, mask: `data:image/png;base64,${mask}` });
      assert.equal(response.status, 200);
      await f.waitSettled();
      assert.deepEqual(f.calls.map(endpointOf), ["/v1/responses", "/v1/images/edits"]);
      const content = JSON.parse(f.calls[0]!.body).input[1].content;
      assert.deepEqual(content.map((part: { type: string }) => part.type), ["input_image", "input_image", "input_text"]);
      assert.match(content[2].text, /edit mask guide/);
      assert.equal((await fields(f.calls[1]!)).images, 2);
    });
  });

  it("a plan without image_gen is retried once, then fails without rendering or saving", async () => {
    await harness.run("classic", { upstream: () => plannerSse([]) }, async (f) => {
      const response = await f.post({ ...BASE, mode: "auto", model: "gpt-6-luna" });
      assert.equal(response.status, 422);
      await f.waitSettled();
      assert.deepEqual(f.calls.map(endpointOf), ["/v1/responses", "/v1/responses"]);
      assert.match(JSON.parse(f.calls[1]!.body).input[0].content, /did not call image_gen/);
      assert.deepEqual(await readdir(f.generatedDir), []);
    });
  });

  it("direct multimode with several images still plans one prompt per stage", async () => {
    await harness.run("multimode", { upstream: async (call) => (
      endpointOf(call) === "/v1/responses" ? plannerSse(["stage one", "stage two"]) : imagesJson(red)
    ) }, async (f) => {
      const response = await f.post({ ...BASE, mode: "direct", model: "gpt-6-luna", async: true, maxImages: 2 });
      assert.equal(response.status, 202);
      await f.waitTerminal();
      await f.waitSettled();
      assert.deepEqual(f.calls.map(endpointOf), ["/v1/responses", "/v1/images/generations", "/v1/images/generations"]);
      const prompts = await Promise.all(f.calls.slice(1).map(async (call) => (await fields(call)).json.prompt));
      assert.deepEqual(prompts.sort(), ["stage one", "stage two"]);
    });
  });
});
