import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, type RouteHarness } from "./_executionRouteHarness.ts";

const BASE = { prompt: "Flat vector fox logo", quality: "low", size: "1024x1024",
  webSearchEnabled: false, provider: "api", imageToolModel: "gpt-image-2.6-sunburst", format: "svg" };
const UPSTREAM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" fill="#f60" onclick="x()"/></svg>';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),
  { status, headers: { "content-type": "application/json" } });

if (executionTestProcess(import.meta.url)) describe("SVG output contract", { concurrency: false }, () => {
  let harness: RouteHarness;
  let reference: string;
  before(async () => {
    harness = await openRouteHarness();
    reference = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { await harness?.close(); });
  const upstream = () => json({ data: [{ b64_json: Buffer.from(UPSTREAM_SVG).toString("base64") }], output_format: "svg",
    svg_usage: { model: "fixture-author", input_tokens: 10, output_tokens: 20, reasoning_tokens: 0, total_tokens: 30 } });

  it("generates SVG through /v1/images/generations and saves sanitized markup as .svg", async () => {
    await harness.run("classic", { upstream }, async (f) => {
      const response = await f.post(BASE);
      assert.equal(response.status, 200);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0]!.url, "https://api.openai.com/v1/images/generations");
      const body = JSON.parse(f.calls[0]!.body);
      assert.equal(body.output_format, "svg");
      assert.deepEqual(body.svg, { model: "gpt-5.6-luna" });
      assert.equal("n" in body, false);
      assert.match(result.filename, /\.svg$/);
      assert.equal(result.image.startsWith("data:image/svg+xml;base64,"), true);
      const saved = await readFile(join(f.generatedDir, result.filename), "utf8");
      assert.match(saved, /<rect width="10" height="10" fill="#f60"\/>/);
      assert.doesNotMatch(saved, /script|onclick|alert/);
      assert.equal(Buffer.from(result.image.split(",")[1], "base64").toString("utf8"), saved);
      const sidecar = JSON.parse(await readFile(join(f.generatedDir, `${result.filename}.json`), "utf8"));
      assert.equal(sidecar.format, "svg");
      assert.equal(sidecar.animation.svgModel, "gpt-5.6-luna");
      assert.equal(sidecar.svgUsage.total_tokens, 30);
      const { listHistoryRows } = await import("../lib/historyList.ts");
      const row = (await listHistoryRows(f.generatedDir)).find((entry) => entry.filename === result.filename);
      assert.equal(row?.format, "svg");
      // The thumbnail is a rasterized JPEG next to the SVG.
      await stat(join(f.generatedDir, `${result.filename}.thumb.jpg`)).catch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await stat(join(f.generatedDir, `${result.filename}.thumb.jpg`));
      });
    });
  });

  it("sends an explicit svg.model and reasoning", async () => {
    await harness.run("classic", { upstream }, async (f) => {
      const response = await f.post({ ...BASE, svgModel: "custom-author", svgReasoningEffort: "low" });
      assert.equal(response.status, 200);
      await f.waitSettled();
      assert.deepEqual(JSON.parse(f.calls[0]!.body).svg, { model: "custom-author", reasoning: { effort: "low" } });
    });
  });

  const rejected: Array<[string, Record<string, unknown>, string]> = [
    ["GPT OAuth", { provider: "oauth", imageToolModel: undefined }, "SVG_OUTPUT_UNSUPPORTED"],
    ["a 2.5 model", { imageToolModel: "gpt-image-2.5-sunburst" }, "SVG_OUTPUT_UNSUPPORTED"],
    ["n=2", { n: 2 }, "SVG_COUNT_UNSUPPORTED"],
    ["reference images", { references: ["REF"] }, "SVG_EDIT_UNSUPPORTED"],
    ["a malformed svgModel", { svgModel: "bad model!" }, "INVALID_SVG_MODEL"],
    ["an unknown reasoning effort", { svgModel: "gpt-5.6-luna", svgReasoningEffort: "ultra" }, "INVALID_SVG_REASONING_EFFORT"],
    ["reasoning without a model", { svgReasoningEffort: "low" }, "SVG_REASONING_REQUIRES_MODEL"],
    ["SVG options on a PNG", { format: "png", svgModel: "gpt-5.6-luna" }, "SVG_OPTIONS_WITHOUT_SVG"],
  ];
  for (const [label, patch, code] of rejected) {
    it(`rejects ${label} with ${code} before upstream`, async () => {
      await harness.run("classic", { upstream: () => { throw new Error("Unexpected upstream"); } }, async (f) => {
        const body: Record<string, unknown> = { ...BASE, ...patch };
        if (Array.isArray(body.references)) body.references = [reference];
        const response = await f.post(body);
        assert.equal(response.status, 400);
        const result = await response.json();
        assert.equal(result.code ?? result.error?.code, code);
        await f.waitSettled();
        assert.equal(f.calls.length, 0);
      });
    });
  }

  it("a project without SVG access gets IMAGE_FEATURE_NOT_ENABLED naming SVG output", async () => {
    const gated = () => json({ error: { message: "SVG output requires project access.",
      type: "invalid_request_error", param: "output_format", code: null } }, 400);
    await harness.run("classic", { upstream: gated }, async (f) => {
      const response = await f.post(BASE);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(response.status, 400);
      assert.equal(result.code ?? result.error?.code, "IMAGE_FEATURE_NOT_ENABLED");
      assert.match(JSON.stringify(result), /has not enabled SVG output/);
    });
  });

  it("returns the Image API missing-parameter reason without leaking the request", async () => {
    const invalid = () => json({ error: { message: "SVG generation requires 'svg.model'.",
      type: "invalid_request_error", param: "svg.model", code: "missing_required_parameter" } }, 400);
    await harness.run("classic", { upstream: invalid }, async (f) => {
      const response = await f.post(BASE);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(response.status, 400);
      assert.equal(result.code ?? result.error?.code, "INVALID_REQUEST");
      assert.match(JSON.stringify(result), /SVG generation requires 'svg.model'\./);
      assert.doesNotMatch(JSON.stringify(result), /Flat vector fox logo/);
    });
  });

  it("does not expose arbitrary upstream messages or unsafe parameter values", async () => {
    const invalid = () => json({ error: { message: "prompt: private scene sk-secret123456789",
      type: "invalid_request_error", param: "sk-secret123456789", code: "invalid_value" } }, 400);
    await harness.run("classic", { upstream: invalid }, async (f) => {
      const response = await f.post(BASE);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(result.code ?? result.error?.code, "INVALID_REQUEST");
      assert.doesNotMatch(JSON.stringify(result), /private scene|sk-secret/);
    });
  });

  it("markup that is not an SVG document fails as SVG_OUTPUT_INVALID without a retry", async () => {
    const notSvg = () => json({ data: [{ b64_json: Buffer.from("<html>nope</html>").toString("base64") }] });
    await harness.run("classic", { upstream: notSvg }, async (f) => {
      const response = await f.post(BASE);
      const result = await response.json();
      await f.waitSettled();
      assert.equal(result.code ?? result.error?.code, "SVG_OUTPUT_INVALID");
      assert.equal(f.calls.length, 1);
    });
  });
});
