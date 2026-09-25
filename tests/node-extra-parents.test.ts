import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse } from "./_executionRouteHarness.ts";
import { imagesJson } from "./_oauthNativeFixture.ts";

type Harness = Awaited<ReturnType<typeof openRouteHarness>>;
type Fixture = Parameters<Parameters<Harness["run"]>[2]>[0];
type Call = Parameters<Parameters<Harness["run"]>[1]["upstream"]>[0];

const BASE = {
  prompt: "ordered node parents",
  model: "gpt-5.4",
  quality: "medium",
  size: "1024x1024",
  format: "png",
  moderation: "low",
  mode: "direct",
  searchMode: "off",
  webSearchEnabled: false,
};

function successFrame(image: string) {
  return responsesSse([
    { type: "response.output_item.done", item: { type: "image_generation_call", result: image } },
    { type: "response.completed", response: { usage: { total_tokens: 1 } } },
  ]);
}

/** The ordered input images of one upstream call: Responses input_image parts, or Images API edit files. */
async function inputImages(call: Call): Promise<string[]> {
  if (call.url.endsWith("/v1/images/edits")) {
    const body = (call.raw ? Buffer.from(call.raw) : call.body) as unknown as BodyInit;
    const form = await new Request(call.url, { method: "POST", headers: call.headers, body }).formData();
    return Promise.all(form.getAll("image").map(async (file) =>
      `data:${(file as File).type};base64,${Buffer.from(await (file as File).arrayBuffer()).toString("base64")}`));
  }
  const wire = JSON.parse(call.body);
  return wire.input[1].content
    .filter((part: { type: string }) => part.type === "input_image")
    .map((part: { image_url: string }) => part.image_url);
}

async function seedNode(fixture: Fixture, nodeId: string, b64: string) {
  const { saveNode } = await import("../lib/nodeStore.ts");
  await saveNode(fixture.ctx.rootDir, {
    nodeId,
    b64,
    meta: { format: "png" },
    generatedDir: fixture.generatedDir,
  });
}

async function assertColor(imageUrl: string, expected: readonly [number, number, number]) {
  const b64 = imageUrl.slice(imageUrl.indexOf(",") + 1);
  const { data } = await sharp(Buffer.from(b64, "base64")).raw().toBuffer({ resolveWithObject: true });
  for (let channel = 0; channel < 3; channel++) {
    assert.ok(Math.abs(data[channel] - expected[channel]) < 20, `${[...data.subarray(0, 3)]} != ${expected}`);
  }
}

async function assertRejected(response: Response, code: string, fixture: Fixture, status = 400) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  await fixture.waitSettled();
  assert.equal(fixture.calls.length, 0);
}

if (executionTestProcess(import.meta.url)) describe("node extra parents", { concurrency: false }, () => {
  let harness: Harness;
  let output: string;
  let base: string;
  let extra: string;
  let user: string;

  before(async () => {
    harness = await openRouteHarness();
    [output, base, extra, user] = await Promise.all([
      "#ffffff", "#0000ff", "#ff0000", "#00ff00",
    ].map(async (background) => (await sharp({
      create: { width: 8, height: 8, channels: 3, background },
    }).png().toBuffer()).toString("base64")));
  });
  after(async () => harness?.close());

  for (const provider of ["api", "oauth"] as const) {
    test(`${provider} sends base, deduplicated extra parent, then user reference bytes`, async () => {
      await harness.run("node", { upstream: async (call: Call) => {
        // GPT OAuth in direct mode renders straight through the Images API edits endpoint.
        assert.equal(call.url, provider === "api"
          ? "https://api.openai.com/v1/responses"
          : "http://oauth-fixture.invalid/v1/images/edits");
        const images = await inputImages(call);
        assert.equal(images.length, 3);
        await assertColor(images[0]!, [0, 0, 255]);
        await assertColor(images[1]!, [255, 0, 0]);
        await assertColor(images[2]!, [0, 255, 0]);
        return provider === "api" ? successFrame(output) : imagesJson(output);
      } }, async (fixture) => {
        await seedNode(fixture, "n_base", base);
        await seedNode(fixture, "n_extra", extra);
        const response = await fixture.post({
          ...BASE,
          provider,
          parentNodeId: "n_base",
          extraParentNodeIds: ["n_base", "n_extra", "n_extra"],
          references: [user],
        });
        assert.equal(response.status, 200);
        await fixture.waitSettled();
        assert.equal(fixture.calls.length, 1);
      });
    });

    test(`${provider} rejects combined extra and user reference overflow before dispatch`, async () => {
      await harness.run("node", { upstream: () => assert.fail("overflow dispatched") }, async (fixture) => {
        await seedNode(fixture, "n_extra", extra);
        const response = await fixture.post({
          ...BASE,
          provider,
          extraParentNodeIds: ["n_extra"],
          references: [user, user, user, user, user],
        });
        await assertRejected(response, "REF_TOO_MANY", fixture);
      });
    });
  }

  test("missing requested extra parent is visible and never dispatches", async () => {
    await harness.run("node", { upstream: () => assert.fail("missing extra dispatched") }, async (fixture) => {
      const response = await fixture.post({ ...BASE, provider: "api", extraParentNodeIds: ["n_missing"] });
      await assertRejected(response, "NODE_NOT_FOUND", fixture, 404);
    });
  });

  for (const [value, code] of [
    ["n_extra", "EXTRA_PARENT_IDS_NOT_ARRAY"],
    [[42], "EXTRA_PARENT_ID_INVALID"],
    [["../escape"], "EXTRA_PARENT_ID_INVALID"],
  ] as const) {
    test(`malformed extra parent input rejects with ${code}`, async () => {
      await harness.run("node", { upstream: () => assert.fail("malformed extras dispatched") }, async (fixture) => {
        const response = await fixture.post({ ...BASE, provider: "api", extraParentNodeIds: value });
        await assertRejected(response, code, fixture);
      });
    });
  }

  test("deduplicated extra parent count is bounded before asset reads", async () => {
    await harness.run("node", { upstream: () => assert.fail("extra count overflow dispatched") }, async (fixture) => {
      const response = await fixture.post({
        ...BASE,
        provider: "api",
        extraParentNodeIds: ["n_1", "n_2", "n_3", "n_4", "n_5", "n_6", "n_6"],
      });
      await assertRejected(response, "EXTRA_PARENT_TOO_MANY", fixture);
    });
  });

  test("provider input cap includes the base parent", async () => {
    await harness.run("node", { upstream: () => assert.fail("provider overflow dispatched") }, async (fixture) => {
      await seedNode(fixture, "n_base", base);
      for (const id of ["n_1", "n_2", "n_3", "n_4", "n_5"]) await seedNode(fixture, id, extra);
      const response = await fixture.post({
        ...BASE,
        provider: "grok-api",
        model: "grok-imagine-image",
        parentNodeId: "n_base",
        extraParentNodeIds: ["n_1", "n_2", "n_3", "n_4", "n_5"],
      });
      await assertRejected(response, "GROK_REF_TOO_MANY", fixture);
    });
  });

  test("oversized extra parent bytes reject before dispatch", async () => {
    await harness.run("node", { upstream: () => assert.fail("oversized extra dispatched") }, async (fixture) => {
      const maxB64 = fixture.ctx.config.limits.maxRefB64Bytes;
      await writeFile(join(fixture.generatedDir, "n_huge.png"), Buffer.alloc(Math.ceil(maxB64 * 3 / 4) + 8));
      const response = await fixture.post({ ...BASE, provider: "api", extraParentNodeIds: ["n_huge"] });
      await assertRejected(response, "EXTRA_PARENT_TOO_LARGE", fixture);
    });
  });

  test("parent-only validates ids but skips missing extra assets with max-count user refs", async () => {
    await harness.run("node", { upstream: async (call: Call) => {
      const wire = JSON.parse(call.body);
      const images = wire.input[1].content.filter((part: { type: string }) => part.type === "input_image");
      assert.equal(images.length, 1);
      await assertColor(images[0].image_url, [0, 0, 255]);
      return successFrame(output);
    } }, async (fixture) => {
      await seedNode(fixture, "n_base", base);
      const response = await fixture.post({
        ...BASE,
        provider: "api",
        parentNodeId: "n_base",
        extraParentNodeIds: ["n_missing_but_not_read"],
        references: [user, user, user, user, user],
        contextMode: "parent-only",
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).refsCount, 0);
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 1);
    });
  });

  test("MiniMax parent-only cap counts its legacy user reference plus the base", async () => {
    await harness.run("node", {
      context: { minimaxApiKey: "minimax-fixture" },
      upstream: () => assert.fail("MiniMax provider overflow dispatched"),
    }, async (fixture) => {
      await seedNode(fixture, "n_base", base);
      const response = await fixture.post({
        ...BASE,
        provider: "minimax",
        model: "image-01",
        parentNodeId: "n_base",
        extraParentNodeIds: ["n_missing_but_not_read"],
        references: [user],
        contextMode: "parent-only",
      });
      await assertRejected(response, "MINIMAX_REF_TOO_MANY", fixture);
    });
  });
});
