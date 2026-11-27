import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeServer } from "../src/fake/server.ts";
import { createStudioClient, type StudioClient } from "../src/client.ts";
import { StudioApiError } from "../src/http.ts";
import { readSse } from "../src/sse.ts";
import type { JobEvent } from "../src/types.ts";

const image = { model: "openai/gpt-image-2", task: "text-to-image" as const, inputs: [] };
const SECRET = "a-unique-private-key-73812";

interface Harness {
  client: StudioClient;
  url: string;
  /** Every non-SSE response body the client received. */
  bodies: string[];
}

async function withServer(
  options: Parameters<typeof startFakeServer>[0],
  run: (h: Harness) => Promise<void>,
): Promise<void> {
  const server = await startFakeServer(options);
  const bodies: string[] = [];
  const intercepted: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!response.headers.get("content-type")?.includes("text/event-stream"))
      bodies.push(await response.clone().text());
    return response;
  };
  try {
    await run({ client: createStudioClient({ baseUrl: server.url, fetch: intercepted }), url: server.url, bodies });
  } finally {
    await server.close();
  }
}

/** Collects job events until stop() is awaited. Resolves ready once the stream is open. */
function collect(client: StudioClient) {
  const abort = new AbortController();
  const events: JobEvent[] = [];
  let opened!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const following = client.events.follow({
    signal: abort.signal,
    onEvent: (e) => events.push(e),
    onStatus: (s) => {
      if (s === "open") opened();
    },
  });
  return {
    events,
    ready,
    stop: async () => {
      abort.abort();
      await following;
    },
  };
}

test("catalog lists keyed and keyless routes with direct first", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client }) => {
    const catalog = await client.catalog();
    assert.ok(catalog.models.length >= 20);
    assert.ok(catalog.models.some((m) => m.kind === "image") && catalog.models.some((m) => m.kind === "audio"));
    const gpt = catalog.models.find((m) => m.id === image.model)!;
    assert.deepEqual(
      gpt.routes.map((r) => [r.providerId, r.keyConfigured]),
      [
        ["openai", true],
        ["fal", true],
      ],
    );
    const vidu = catalog.models.find((m) => m.id === "vidu/vidu-q4")!;
    assert.equal(
      vidu.routes.every((r) => !r.keyConfigured),
      true,
    );
    assert.ok(
      catalog.models.some((m) => m.routes.some((r) => r.pricing.length === 0)),
      "some route has no published price",
    );
  });
});

test("keys save, validate and remove without echoing the key", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client, bodies }) => {
    const events = collect(client);
    await events.ready;
    await client.keys.save("kling", { apiKey: SECRET });
    await assert.rejects(
      client.keys.save("kling", { apiKey: "rejected-secret" }),
      (e: unknown) => e instanceof StudioApiError && e.code === "KEY_VALIDATION_FAILED",
    );
    assert.equal((await client.keys.list()).find((k) => k.keyVocabulary === "kling")?.configured, true);
    const job = await client.media.submit({
      model: "kling/kling-3",
      task: "text-to-video",
      prompt: "a lighthouse at dusk",
      inputs: [],
    });
    await client.watchJob(job.jobId);
    await client.keys.remove("kling");
    assert.equal((await client.keys.list()).find((k) => k.keyVocabulary === "kling")?.configured, false);
    await events.stop();
    assert.ok(!bodies.join("").includes(SECRET), "a response echoed the key");
    assert.ok(!JSON.stringify(events.events).includes(SECRET), "an event echoed the key");
  });
});

test("upload, submit, watch and download, with idempotent resubmit", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client, url }) => {
    const upload = await client.uploads.put(new Uint8Array([1, 2, 3]), "image/png");
    assert.equal(upload.bytes, 3);
    const body = {
      ...image,
      prompt: "a lamp",
      inputs: [{ role: "reference-image" as const, inputId: upload.inputId }],
      clientRequestId: "same",
    };
    const accepted = await client.media.submit(body);
    await assert.rejects(client.media.submit(body), (e: unknown) => e instanceof StudioApiError && e.status === 409);
    const done = await client.watchJob(accepted.jobId);
    assert.equal(done.status, "succeeded");
    assert.equal(done.provider, "openai");
    assert.equal(done.progress, 1);
    const output = await fetch(url + done.outputs[0]!.url);
    assert.equal(output.headers.get("content-type"), "image/png");
    assert.ok((await output.arrayBuffer()).byteLength > 100);
    const video = await client.media.submit({
      model: "bytedance/seedance-2.5",
      provider: "fal",
      task: "text-to-video",
      inputs: [],
      aspectRatio: "9:16",
    });
    const finished = await client.watchJob(video.jobId);
    const range = await fetch(url + finished.outputs[0]!.url, { headers: { Range: "bytes=0-31" } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 32);
  });
});

test("watching a job that already finished still returns its saved outputs", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client, url }) => {
    const accepted = await client.media.submit({ ...image, prompt: "done before watching" });
    for (let i = 0; i < 100 && (await client.media.job(accepted.jobId)).status !== "succeeded"; i += 1) await new Promise((r) => setTimeout(r, 20));
    const done = await client.watchJob(accepted.jobId);
    assert.equal(done.status, "succeeded");
    assert.ok(done.outputs.length > 0, "a finished job has outputs");
    assert.equal((await fetch(url + done.outputs[0]!.url)).headers.get("content-type"), "image/png");
  });
});

test("history pages, favorites and deletes", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client }) => {
    for (const prompt of ["one", "two"]) await client.watchJob((await client.media.submit({ ...image, prompt })).jobId);
    const first = await client.history.list({ limit: 1 });
    assert.equal(first.items.length, 1);
    assert.ok(first.nextCursor);
    const second = await client.history.list({ limit: 1, cursor: first.nextCursor! });
    assert.notEqual(first.items[0]!.historyId, second.items[0]!.historyId);
    const id = first.items[0]!.historyId;
    assert.equal((await client.history.favorite(id, true)).favorite, true);
    assert.equal((await client.history.list({ favorite: true })).items.length, 1);
    await client.history.remove(id);
    assert.equal((await client.history.list({ kind: "image" })).items.length, 1);
  });
});

test("workflows estimate per step and run with step events", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client }) => {
    const defs = await client.workflows.list();
    assert.deepEqual(new Set(defs.map((d) => d.family)), new Set(["remix", "director"]));
    const restyle = { inputs: { prompt: "noir", video: [{ role: "source-video" as const, url: "/files/source" }] } };
    const estimate = await client.workflows.estimate("remix-restyle", restyle);
    assert.equal(estimate.steps.length, 2);
    await assert.rejects(
      client.workflows.run("remix-motion-transfer", restyle),
      (e: unknown) => e instanceof StudioApiError && e.status === 400,
    );
    const events = collect(client);
    await events.ready;
    const cinema = await client.workflows.run("director-cinema", {
      inputs: { prompt: "Two friends meet at a station." },
    });
    const done = await client.watchJob(cinema.jobId);
    await events.stop();
    assert.equal(done.status, "succeeded");
    assert.deepEqual(
      done.steps?.map((s) => s.status),
      ["succeeded"],
    );
    assert.ok(events.events.some((e) => e.jobId === cinema.jobId && e.event === "step"));
    assert.equal((await client.history.list({ workflow: "director-cinema" })).items.length, 1);
  });
});

test("missing keys, failures and cancellation", async () => {
  const server = await startFakeServer({ timeScale: 0.05, keyed: [] });
  const client = createStudioClient({ baseUrl: server.url });
  try {
    await assert.rejects(
      client.media.submit(image),
      (e: unknown) => e instanceof StudioApiError && e.status === 400 && e.code === "MEDIA_KEY_MISSING",
    );
    await assert.rejects(
      client.media.submit({ ...image, model: "unknown" }),
      (e: unknown) => e instanceof StudioApiError && e.code === "MEDIA_MODEL_UNKNOWN",
    );
    await client.keys.save("fal", { apiKey: "x-private-value" });
    const job = await client.media.submit({ ...image, prompt: "[fail:rate-limit]" });
    const failed = await client.watchJob(job.jobId);
    assert.equal(failed.error?.category, "rate-limit");
    assert.equal(failed.error?.code, "FAKE_RATE_LIMIT");
    const pending = await client.media.submit(image);
    assert.equal((await client.media.cancel(pending.jobId)).job.status, "canceled");
    assert.equal((await client.watchJob(pending.jobId)).status, "canceled");
  } finally {
    await server.close();
  }
});

test("SSE replay resumes and reports gaps", async () => {
  const server = await startFakeServer({ timeScale: 0.001 });
  const client = createStudioClient({ baseUrl: server.url });
  try {
    for (let i = 0; i < 22; i++) {
      const a = await client.media.submit(image);
      await client.watchJob(a.jobId);
    }
    const controller = new AbortController();
    const response = await fetch(server.url + "/api/events", {
      headers: { "Last-Event-ID": "1" },
      signal: controller.signal,
    });
    const seen: number[] = [];
    let gap = false;
    for await (const event of readSse(response.body!)) {
      if (event.event === "replay-gap") gap = true;
      if (event.id) seen.push(Number(event.id));
      if (seen.length === 100) break;
    }
    controller.abort();
    assert.equal(gap, true);
    assert.equal(new Set(seen).size, 100);
    assert.deepEqual(
      seen,
      Array.from({ length: 100 }, (_, i) => seen[0]! + i),
    );
    const cursor = seen[seen.length - 3]!;
    const stop = new AbortController();
    const replay = await fetch(server.url + "/api/events", {
      headers: { "Last-Event-ID": String(cursor) },
      signal: stop.signal,
    });
    const ids: number[] = [];
    for await (const event of readSse(replay.body!)) {
      if (event.id) ids.push(Number(event.id));
      if (ids.length === 2) break;
    }
    stop.abort();
    assert.deepEqual(ids, [cursor + 1, cursor + 2]);
  } finally {
    await server.close();
  }
});

test("wire keys, validation, session filtering and workflow field errors", async () => {
  const server = await startFakeServer({ timeScale: 1, keyed: [], envKeys: ["openai"] });
  const client = createStudioClient({ baseUrl: server.url, sessionId: "tab-a", browserId: "browser-a" });
  try {
    await assert.rejects(
      client.keys.remove("openai"),
      (e: unknown) => e instanceof StudioApiError && e.code === "ENV_KEY_IMMUTABLE",
    );
    const accepted = await client.media.submit(image);
    assert.equal((await client.media.jobs({ status: "active" }))[0]?.jobId, accepted.jobId);
    await assert.rejects(
      client.workflows.run("remix-motion-transfer", { inputs: {} }),
      (e: unknown) => e instanceof StudioApiError && e.code === "WORKFLOW_INPUT_INVALID",
    );
    await assert.rejects(
      client.workflows.estimate("no-such-workflow", { inputs: {} }),
      (e: unknown) => e instanceof StudioApiError && e.code === "WORKFLOW_UNKNOWN",
    );
    await client.media.cancel(accepted.jobId);
  } finally {
    await server.close();
  }
});

test("a ComfyUI workflow runs on this computer: no key, no price, a run time, and its own failure", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client }) => {
    const catalog = await client.catalog();
    const klein = catalog.models.find((m) => m.id === "comfy/klein");
    assert.equal(klein?.routes[0]?.route, "local");
    assert.equal(klein?.routes[0]?.keyless, true);
    assert.equal(klein?.routes[0]?.keyConfigured, true);
    assert.equal(klein?.defaultRoute, "comfy-local");
    // A keyless lane is never listed among the keys to add.
    assert.equal((await client.keys.list()).some((k) => k.keyVocabulary === "comfy-local"), false);
    const estimate = await client.media.estimate({ model: "comfy/klein", task: "text-to-image", prompt: "a fox", inputs: [] });
    assert.deepEqual(estimate, { route: "local", usd: 0, quote: { state: "local" }, note: "runs locally; no provider charge", local: { expectedSec: 42, basis: "median of 3 earlier runs", mayBill: false } });
    const { jobId } = await client.media.submit({ model: "comfy/klein", task: "text-to-image", prompt: "[fail:comfy-offline] a fox", inputs: [] });
    const done = await client.watchJob(jobId);
    assert.equal(done.status, "failed");
    assert.equal(done.error?.code, "COMFY_OFFLINE");
    assert.match(done.error?.message ?? "", /Lost contact with ComfyUI/);
  });
});

test("voices need a key, and a voice's sample address plays", async () => {
  await withServer({}, async ({ client, url }) => {
    await client.keys.remove("elevenlabs").catch(() => undefined);
    await assert.rejects(
      client.voices.list("elevenlabs"),
      (e: unknown) => e instanceof StudioApiError && e.code === "MEDIA_KEY_MISSING",
    );
    await client.keys.save("elevenlabs", { apiKey: SECRET });
    const list = await client.voices.list("elevenlabs");
    assert.ok(list.voices.some((v) => v.owned), "the user's own voices are marked");
    const sample = list.voices.find((v) => v.previewUrl)?.previewUrl;
    assert.ok(sample, "at least one voice has a sample");
    const played = await fetch(new URL(sample, url));
    assert.equal(played.status, 200);
    assert.match(played.headers.get("content-type") ?? "", /^audio\//);
    assert.ok((await played.arrayBuffer()).byteLength > 0);
  });
});

test("a route that declares an edit task refuses fields outside it and a task it does not serve", async () => {
  await withServer({}, async ({ client }) => {
    await client.keys.save("xai", { apiKey: SECRET });
    const upload = await client.uploads.put(new Uint8Array([0, 0, 0, 24]), "video/mp4");
    const base = { model: "xai/grok-imagine-video", provider: "xai", task: "video-to-video" as const, inputs: [{ role: "source-video" as const, inputId: upload.inputId }] };
    const refused = (e: unknown) => e instanceof StudioApiError && e.code === "MEDIA_INVALID_REQUEST";
    await assert.rejects(client.media.submit(base), refused, "the prompt is required");
    await assert.rejects(client.media.submit({ ...base, prompt: "snow", resolution: "720p" }), refused, "an edit follows its source");
    const accepted = await client.media.submit({ ...base, prompt: "snow" });
    assert.ok(accepted.jobId);
    await assert.rejects(
      client.media.submit({ model: "bytedance/seedance-2", provider: "fal", task: "video-to-video", prompt: "snow", inputs: base.inputs }),
      (e: unknown) => e instanceof StudioApiError && e.code === "MEDIA_TASK_UNSUPPORTED",
    );
    await client.keys.remove("xai");
  });
});

test("estimates come from the server's rule, including rows a studio-side matcher could not read", async () => {
  await withServer({ timeScale: 0.02 }, async ({ client }) => {
    // PixVerse "720p audio off, no video references; 9 credits/s": extend sends no sound flag.
    const extend = await client.media.estimate({ model: "pixverse/pixverse-v6", provider: "pixverse", task: "video-extend", durationSec: 5, resolution: "720p", inputs: [] });
    assert.equal(extend.quote.state, "exact");
    assert.equal(extend.usd, 0.2);
    // MiniMax "768P to 2K output": priced for the clip's length, unknown without it.
    const upscale = { model: "minimax/hailuo-h3-regen", provider: "minimax", task: "video-upscale" as const, resolution: "2K", inputs: [] };
    assert.equal((await client.media.estimate(upscale)).quote.state, "unknown");
    const sized = await client.media.estimate({ ...upscale, durationSec: 6 });
    assert.deepEqual([sized.quote.state, sized.usd], ["exact", 0.3]);
  });
});
