import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { generateApi88Video, resumeApi88Video, api88VideoResultUrl, type Api88VideoEvent } from "../lib/api88/videoTransport.ts";
import { downloadApi88Video } from "../lib/api88/videoDownload.ts";

const originalFetch = globalThis.fetch;
test.beforeEach(() => {
  globalThis.fetch = (async () => { assert.fail("Unexpected upstream fetch"); }) as typeof fetch;
});
test.afterEach(() => { globalThis.fetch = originalFetch; });
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex");
const resultUrl = "https://cdn.example/out.mp4?signature=x%2Fy%2Bz&expires=1";
const code = (error: unknown) => (error as { code?: string }).code;
function ctx(timeout = 900_000) {
  const context = createTestRuntimeContext({ api88ImageKey: "image-only-secret", api88VideoKey: "video-only-secret" });
  return { ...context, config: { ...config, api88Provider: {
    ...config.api88Provider, baseUrl: "https://gateway.example/v1/", videoTimeoutMs: timeout,
  } } };
}
function clock() {
  let time = 0;
  const sleeps: number[] = [];
  return { now: () => time, sleeps,
    sleep: async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); sleeps.push(ms); time += ms; } };
}
interface Call { url: string; method: string; body?: Record<string, unknown>; }
function upstream(states: Array<Record<string, unknown> | Response>, calls: Call[], taskId = "task/a b") {
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    assert.ok(!url.includes("/v1/responses"));
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });
    if (url === resultUrl) {
      assert.equal(headers.get("authorization"), null);
      assert.equal(init?.redirect, "follow");
      assert.equal(init?.credentials, "omit");
      return new Response(mp4);
    }
    assert.equal(headers.get("authorization"), "Bearer video-only-secret");
    assert.equal(headers.get("cookie"), null);
    if (url === "https://gateway.example/v1/videos" && method === "POST") return Response.json({ id: taskId });
    assert.equal(url, `https://gateway.example/v1/videos/${encodeURIComponent(taskId)}`);
    assert.equal(method, "GET");
    const value = states[index++] ?? states.at(-1)!;
    return value instanceof Response ? value : Response.json(value);
  }) as typeof fetch;
}
const input = { model: "grok-imagine-video-1.5", prompt: "A cube", duration: 4, aspectRatio: "16:9", resolution: "480p" };
function assertSubmit(target: RequestInfo | URL, init?: RequestInit) {
  assert.equal(String(target), "https://gateway.example/v1/videos");
  assert.equal(init?.method, "POST");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer video-only-secret");
}
function assertDownload(target: RequestInfo | URL, init?: RequestInit) {
  assert.equal(String(target), resultUrl);
  assert.equal(init?.method ?? "GET", "GET");
  assert.equal(new Headers(init?.headers).get("authorization"), null);
  assert.equal(new Headers(init?.headers).get("cookie"), null);
  assert.equal(init?.redirect, "follow");
  assert.equal(init?.credentials, "omit");
}

test("queued → in_progress → completed waits 4s then 12s, submitted precedes polling", async () => {
  const calls: Call[] = [];
  const events: Api88VideoEvent[] = [];
  const time = clock();
  upstream([{ status: "queued", progress: 100 }, { status: "in_progress", progress: 50 },
    { status: "completed", url: resultUrl }], calls);
  const videoOnly = ctx(); videoOnly.api88ImageKey = undefined;
  const result = await generateApi88Video(videoOnly, input, { ...time, onEvent: (event) => {
    events.push(event);
    if (event.phase === "submitted") assert.equal(calls.length, 1);
  } });
  assert.deepEqual(time.sleeps, [4000, 12_000, 12_000]);
  assert.deepEqual(events.map((event) => event.phase), ["submitted", "progress", "progress"]);
  assert.equal(events[1].progress, 1);
  assert.equal(events[2].progress, 0.5);
  assert.equal(result.providerTaskId, "task/a b");
  assert.equal(result.providerUrl, resultUrl);
  assert.deepEqual(result.videoBuffer, mp4);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
test("failed status rejects even when progress is 100", async () => {
  const calls: Call[] = [];
  upstream([{ status: "failed", progress: 100, url: resultUrl }], calls);
  await assert.rejects(generateApi88Video(ctx(), input, clock()), (error: unknown) => code(error) === "API88_VIDEO_FAILED");
  assert.equal(calls.length, 2);
});
test("three consecutive unknown states fail; a known state resets the counter", async () => {
  const calls: Call[] = [];
  upstream([{ status: "unknown" }, { status: "unknown" }, { status: "queued" },
    { status: "unknown" }, { status: "unexpected" }, {}], calls);
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_STATUS_UNKNOWN");
  assert.equal(calls.filter((call) => call.method === "GET").length, 6);
});
test("waiting timeout never resubmits and retains taskId", async () => {
  const calls: Call[] = [];
  const time = clock();
  upstream([{ status: "queued" }], calls);
  await assert.rejects(generateApi88Video(ctx(16_000), input, time), (error: unknown) => {
    assert.equal((error as { providerTaskId?: string }).providerTaskId, "task/a b");
    return code(error) === "API88_VIDEO_TIMEOUT";
  });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(time.sleeps, [4000, 12_000]);
});
test("ambiguous submit network failure is never retried", async () => {
  let posts = 0;
  globalThis.fetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
    assertSubmit(target, init); posts += 1;
    throw new TypeError("Socket disappeared after send");
  }) as typeof fetch;
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_SUBMIT_UNCERTAIN");
  assert.equal(posts, 1);
});
test("submit AbortSignal timeout is uncertain and has no second POST", async () => {
  let posts = 0;
  globalThis.fetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
    assertSubmit(target, init);
    posts += 1;
    assert.ok(init?.signal);
    throw new DOMException("Request timed out after send", "TimeoutError");
  }) as typeof fetch;
  await assert.rejects(generateApi88Video(ctx(), input, clock()),
    (error: unknown) => code(error) === "API88_VIDEO_SUBMIT_UNCERTAIN");
  assert.equal(posts, 1);
});
test("submit HTTP 429 and missing id do not retry", async () => {
  for (const response of [Response.json({}, { status: 429 }), Response.json({ task_id: "legacy-is-not-an-id" })]) {
    let posts = 0;
    globalThis.fetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
      assertSubmit(target, init); posts += 1; return response;
    }) as typeof fetch;
    await assert.rejects(generateApi88Video(ctx(), input, clock()), (error: unknown) =>
      ["API88_VIDEO_REQUEST_FAILED", "API88_VIDEO_SUBMIT_UNCERTAIN"].includes(code(error) ?? ""));
    assert.equal(posts, 1);
  }
});
test("poll HTTP 429 honors Retry-After, 5xx backoff only retries GET", async () => {
  const calls: Call[] = [];
  const time = clock();
  upstream([Response.json({}, { status: 429, headers: { "Retry-After": "7" } }),
    Response.json({}, { status: 503 }), { status: "completed", url: resultUrl }], calls);
  await generateApi88Video(ctx(), input, time);
  assert.deepEqual(time.sleeps, [4000, 7000, 2000]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});
test("URL key preference includes nested output/data and keeps query unchanged", () => {
  assert.equal(api88VideoResultUrl({ url: "u", video_url: "v", result_url: "r" }), "u");
  assert.equal(api88VideoResultUrl({ video_url: "v", output: { url: "u" } }), "u");
  assert.equal(api88VideoResultUrl({ video_url: "v", result_url: "r" }), "v");
  assert.equal(api88VideoResultUrl({ data: { output: { result_url: resultUrl } } }), resultUrl);
  assert.equal(api88VideoResultUrl({ status: "completed" }), null);
});
test("resume performs no POST and preserves opaque model/task ids", async () => {
  for (const model of ["SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    const calls: Call[] = [];
    upstream([{ status: "completed", output: { data: "unused", result_url: resultUrl } }], calls);
    const result = await resumeApi88Video(ctx(), "task/a b", model, clock());
    assert.equal(result.model, model);
    assert.equal(calls.some((call) => call.method === "POST"), false);
  }
});
test("space and CJK IDs are sent byte-exact in JSON", async () => {
  for (const model of ["SD2.5 720P", "Seedance-2.0-720p官方版"]) {
    const calls: Call[] = [];
    upstream([{ status: "completed", video_url: resultUrl }], calls);
    await generateApi88Video(ctx(), { model, prompt: "A cube" }, clock());
    assert.equal(calls[0].body?.model, model);
    assert.deepEqual(Buffer.from(String(calls[0].body?.model)), Buffer.from(model));
  }
});
test("image-only or blank video key fails closed without fetch", async () => {
  globalThis.fetch = (async () => { assert.fail("No network when video key is absent"); }) as typeof fetch;
  for (const key of [undefined, "", " "]) {
    const context = ctx(); context.api88VideoKey = key;
    await assert.rejects(generateApi88Video(context, input, clock()),
      (error: unknown) => code(error) === "API88_VIDEO_KEY_MISSING");
    await assert.rejects(resumeApi88Video(context, "saved-task", input.model, clock()),
      (error: unknown) => code(error) === "API88_VIDEO_KEY_MISSING");
  }
});
test("invalid MP4 and declared/streamed oversize never persist or resubmit", async () => {
  for (const response of [new Response("<html>no video</html>"),
    new Response(mp4, { headers: { "Content-Length": String(200 * 1024 * 1024 + 1) } }),
    new Response(new ReadableStream<Uint8Array>({ start(controller) {
      const chunk = new Uint8Array(1024 * 1024);
      for (let i = 0; i < 201; i += 1) controller.enqueue(chunk);
      controller.close();
    } }))]) {
    globalThis.fetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
      assertDownload(target, init);
      return response;
    }) as typeof fetch;
    await assert.rejects(downloadApi88Video(resultUrl, new AbortController().signal, 200 * 1024 * 1024));
  }
});
test("abort during a stalled body cancels its reader promptly", async () => {
  const controller = new AbortController();
  let canceled = false;
  globalThis.fetch = (async (target: RequestInfo | URL, init?: RequestInit) => {
    assertDownload(target, init);
    return new Response(new ReadableStream<Uint8Array>({
      start() { queueMicrotask(() => controller.abort()); },
      cancel() { canceled = true; },
    }));
  }) as typeof fetch;
  await assert.rejects(downloadApi88Video(resultUrl, controller.signal, 200 * 1024 * 1024));
  assert.equal(canceled, true);
});
