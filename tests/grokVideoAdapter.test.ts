import { after, afterEach, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import { fakeMp4Bytes, makeVideoStreamFixture } from "./_videoStreamFixture.ts";
import { executionTestProcess } from "./_executionTestProcess.ts";
import type { GrokVideoEvent, GrokVideoPlan } from "../lib/grokVideoAdapter.js";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";
import type { UpstreamCall } from "./_executionRouteHarness.ts";

if (executionTestProcess(import.meta.url)) {
const { openVideoFixture } = await import("./_videoExecutionFixture.ts");
const fixture = await openVideoFixture();
after(async () => { await fixture.close(); });
beforeEach(() => { fixture.beginCase(); });
const { buildVideoGenerationPayload, buildGrokVideoPlannerPayload, downloadVideo,
  parseGrokVideoPlanPrompt, normalizeVideoPoll, generateVideoViaGrok, startVideoRequest } = await import("../lib/grokVideoAdapter.js");
const { buildGrokVideoPlannerSystemPrompt, formatDurationPacingGuidance } = await import("../lib/grokVideoPlannerPrompt.js");
const { normalizeGrokVideoModel, VALID_GROK_VIDEO_MODELS } = await import("../lib/imageModels.js");
const { parsePngInfo } = await import("../lib/pngInfo.js");
const { DEFAULT_GROK_PLANNER_MODEL } = await import("../config.js");
const config = fixture.config;
/** Both lanes call xAI directly now; only the credential differs. */
const XAI = "https://api.x.ai";
const ARTIFACT = "https://vidgen.example/v.mp4";

function ctx(overrides: Partial<RouteRuntimeContext> = {}): RouteRuntimeContext {
  return {
    config: {
      ...config,
      grokProvider: {
        ...config.grokProvider,
        plannerModel: "grok-4.3",
        plannerTimeoutMs: 10_000,
        videoStartTimeoutMs: 10_000,
        videoPollIntervalMs: 1,
        videoTimeoutMs: 60_000,
        videoDownloadTimeoutMs: 10_000,
      },
    },
    packageVersion: "test",
    grokAuthHomeDir: fixture.grokAuthHomeDir,
    ...overrides,
  };
}

function jsonRes(body: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

function videoBytesRes() {
  return artifactStream([fakeMp4Bytes()]).response;
}

function artifactStream(chunks: readonly Uint8Array[], options: Parameters<typeof makeVideoStreamFixture>[1] = {}) {
  const stream = makeVideoStreamFixture(chunks, { headers: { "content-type": "video/mp4" }, ...options });
  artifactStreams.push(stream);
  fixture.addStream(stream);
  return stream;
}

const artifactStreams: ReturnType<typeof makeVideoStreamFixture>[] = [];
afterEach(async () => {
  await fixture.finishCase();
  for (const stream of artifactStreams.splice(0)) {
    assert.equal(stream.stats.arrayBufferCalls, 0);
    stream.assertDrained();
  }
});
const searchRes = () => jsonRes({ output: [{ type: "message", content: [{ type: "text", text: "current cinematic references" }] }] });

function plannerRes(prompt = "An English cinematic 1-second push-in shot.") {
  return jsonRes({
    choices: [
      {
        message: {
          tool_calls: [
            { type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt, mode: "text-to-video", duration: 99, resolution: "720p" }) } },
          ],
        },
      },
    ],
  });
}

type RequestKind = "search" | "planner" | "start" | "poll" | "artifact";
function respond(handler: (kind: RequestKind, call: UpstreamCall) => Response | Promise<Response>, artifactUrl = ARTIFACT, key?: string) {
  fixture.respond((call) => {
    assert.ok(call.signal instanceof AbortSignal);
    const headers: Record<string, string> = {};
    call.headers.forEach((value, name) => { headers[name] = value; });
    if (call.url === artifactUrl) {
      assert.equal(call.method, "GET"); assert.equal(call.body, "");
      assert.deepEqual(headers, {});
      return handler("artifact", call);
    }
    const paths: Record<string, RequestKind> = { [`${XAI}/v1/responses`]: "search",
      [`${XAI}/v1/chat/completions`]: "planner", [`${XAI}/v1/videos/generations`]: "start",
      [`${XAI}/v1/videos/vid-1`]: "poll" };
    assert.ok(Object.hasOwn(paths, call.url), `Unexpected video URL: ${call.url}`);
    const kind = paths[call.url];
    assert.equal(call.method, kind === "poll" ? "GET" : "POST");
    assert.deepEqual(headers, { authorization: key ? `Bearer ${key}` : fixture.grokBearer, "content-type": "application/json" });
    if (kind === "poll") assert.equal(call.body, "");
    else { const body = JSON.parse(call.body); assert.ok(body && typeof body === "object" && !Array.isArray(body)); }
    return handler(kind, call);
  });
}

function installFetch(opts: { pollSequence: unknown[]; start?: unknown; captureStart?: (body: Record<string, unknown>) => void;
  startResponse?: (body: Record<string, unknown>) => Response; artifact?: () => Response; directKey?: string }) {
  let pollIdx = 0;
  const counts = { start: 0, poll: 0, artifact: 0 };
  respond((kind, call) => {
    if (kind === "search") return searchRes();
    if (kind === "planner") return plannerRes();
    counts[kind]++;
    if (kind === "start") {
      const body = JSON.parse(call.body); opts.captureStart?.(body);
      return opts.startResponse?.(body) ?? jsonRes(opts.start ?? { request_id: "vid-1" });
    }
    if (kind === "poll") {
      const next = opts.pollSequence[Math.min(pollIdx, opts.pollSequence.length - 1)];
      pollIdx += 1;
      return jsonRes(next);
    }
    return opts.artifact?.() ?? videoBytesRes();
  }, ARTIFACT, opts.directKey);
  return counts;
}

const DONE_POLL = { status: "done", progress: 100, video: { url: "https://vidgen.example/v.mp4", duration: 1, respect_moderation: true }, usage: { cost_in_usd_ticks: 500000000 } };

// Top-level node:test cases run serially; keep every executable callback bounded.
  it("builds a T2V payload and omits aspect_ratio when auto", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "text-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video" });
    assert.equal(payload.model, "grok-imagine-video");
    assert.equal(payload.duration, 5);
    assert.equal(payload.resolution, "480p");
    assert.equal("aspect_ratio" in payload, false);
    assert.equal("image" in payload, false);
  });

  it("includes aspect_ratio when explicitly set", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "text-to-video", duration: 3, resolution: "720p", aspectRatio: "16:9", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video" });
    assert.equal(payload.aspect_ratio, "16:9");
  });

  it("builds an I2V payload with image url", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "image-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video", sourceImageUrl: "data:image/png;base64,AAAA" });
    assert.deepEqual(payload.image, { url: "data:image/png;base64,AAAA" });
  });

  it("builds a Ref2V payload with reference_images and no source image", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "reference-to-video", duration: 5, resolution: "480p", aspectRatio: "1:1", webSearchCalls: 1 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video", referenceImageUrls: ["data:image/png;base64,A", "data:image/png;base64,B"] });
    assert.equal(payload.aspect_ratio, "1:1");
    assert.deepEqual(payload.reference_images, [{ url: "data:image/png;base64,A" }, { url: "data:image/png;base64,B" }]);
    assert.equal("image" in payload, false);
  });

  it("video planner prompt asks for dialogue, audio, and ending-frame continuity", () => {
    const payload = buildGrokVideoPlannerPayload("continue", {
      model: "grok-imagine-video",
      mode: "reference-to-video",
      duration: 10,
      resolution: "720p",
      aspectRatio: "16:9",
      referenceImageUrls: ["data:image/png;base64,A", "data:image/png;base64,B"],
    });
    const system = String(payload.messages[0].content);
    const userText = String((payload.messages[1].content as any[])[0].text);
    assert.equal(payload.model, DEFAULT_GROK_PLANNER_MODEL);
    assert.match(system, /MULTI-CHARACTER DIALOGUE/);
    assert.match(system, /ENDING FRAME \/ CONTINUATION CUT PLANNING/);
    assert.match(system, /no background music/);
    assert.match(system, /sound effects only/);
    assert.match(system, /Duration pacing is mandatory/);
    assert.match(userText, /Duration pacing \(10s total\)/);
    assert.match(userText, /complete visual arc/);
    assert.match(userText, /Beat structure for/);
  });

  it("formats duration pacing without forbidding useful timing detail", () => {
    const guidance = formatDurationPacingGuidance(15, "text-to-video");
    assert.match(guidance, /15s total/);
    assert.match(guidance, /naturally across the entire duration/);
    assert.match(guidance, /Beat structure for 11-15s/);
    assert.match(guidance, /anticipation/);
    assert.doesNotMatch(guidance, /Do not use second-by-second/);
    assert.doesNotMatch(guidance, /0\.0-2\.0s/);
  });

  it("keeps the planner system prompt duration-scaled instead of word-count capped", () => {
    const system = buildGrokVideoPlannerSystemPrompt();
    assert.match(system, /Duration pacing is mandatory/);
    assert.match(system, /Scale detail to duration/);
    assert.doesNotMatch(system, /30-80 words/);
  });

  it("rejects I2V without a source image", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "image-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    assert.throws(() => buildVideoGenerationPayload(plan, { model: "grok-imagine-video" }), (e: any) => e.code === "GROK_VIDEO_INVALID_MODE");
  });

  it("rejects invalid Ref2V payload combinations", () => {
    const plan: GrokVideoPlan = { prompt: "p", mode: "reference-to-video", duration: 5, resolution: "480p", aspectRatio: "auto", webSearchCalls: 1 };
    // One reference is valid now (issue #157) — the floor is zero references, not one.
    // devlog/_plan/260820_grok15_multi_reference_video/030_single_ref_mode_choice.md
    assert.throws(() => buildVideoGenerationPayload(plan, { model: "grok-imagine-video", referenceImageUrls: [] }), (e: any) => e.code === "GROK_VIDEO_INVALID_MODE");
    assert.throws(
      () => buildVideoGenerationPayload(plan, { model: "grok-imagine-video", referenceImageUrls: ["A", "B"], sourceImageUrl: "data:image/png;base64,S" }),
      (e: any) => e.code === "GROK_VIDEO_INVALID_MODE",
    );
    // 15 is the first count xAI refuses: "Too many reference images: 15. Maximum
    // allowed is 14." (2026-09-08). Eight used to be over the line and now is not.
    const fifteen = Array.from({ length: 15 }, (_, i) => "ref" + i);
    assert.throws(() => buildVideoGenerationPayload(plan, { model: "grok-imagine-video", referenceImageUrls: fifteen }), (e: any) => e.code === "GROK_VIDEO_REF_TOO_MANY");
    // The base model's r2v ceiling is 10s, so a 15s plan is caught before it is billed.
    const longPlan: GrokVideoPlan = { ...plan, duration: 15 };
    assert.throws(() => buildVideoGenerationPayload(longPlan, { model: "grok-imagine-video", referenceImageUrls: ["A", "B"] }), (e: any) => e.code === "INVALID_VIDEO_DURATION");
    // 1.5 accepts the same 15s.
    assert.doesNotThrow(() => buildVideoGenerationPayload(longPlan, { model: "grok-imagine-video-1.5", referenceImageUrls: ["A", "B"] }));
  });

  it("parses the generate_video planner prompt", () => {
    const prompt = parseGrokVideoPlanPrompt({
      choices: [{ message: { tool_calls: [{ type: "function", function: { name: "generate_video", arguments: JSON.stringify({ prompt: "hello" }) } }] } }],
    });
    assert.equal(prompt, "hello");
  });

  it("throws when the planner does not call generate_video", () => {
    assert.throws(() => parseGrokVideoPlanPrompt({ choices: [{ message: { tool_calls: [] } }] }), (e: any) => e.code === "GROK_PLANNER_EMPTY_TOOL_CALL");
  });

  it("normalizes pending and done poll responses", () => {
    assert.equal(normalizeVideoPoll({ status: "pending", progress: 40 }).status, "pending");
    const done = normalizeVideoPoll(DONE_POLL);
    assert.equal(done.videoUrl, "https://vidgen.example/v.mp4");
    assert.equal(done.respectModeration, true);
    assert.equal(done.usage?.grok_cost_usd_ticks, 500000000);
  });

  it("runs the full T2V flow: search -> planner -> start -> poll -> download", async () => {
    const events: GrokVideoEvent[] = [];
    installFetch({ pollSequence: [{ status: "pending", progress: 10 }, DONE_POLL] });
    const result = await generateVideoViaGrok("makje a clip", ctx(), {
      duration: 5,
      resolution: "480p",
      onEvent: (ev) => events.push(ev),
    });
    assert.equal(result.videoBuffer.subarray(4, 8).toString("ascii"), "ftyp");
    assert.equal(result.contentType, "video/mp4");
    assert.equal(result.mode, "text-to-video");
    assert.equal(result.xaiVideoRequestId, "vid-1");
    assert.equal(result.duration, 1);
    assert.ok(events.some((e) => e.phase === "planning"));
    assert.ok(events.some((e) => e.phase === "submitted" && e.xaiVideoRequestId === "vid-1"));
    assert.ok(events.some((e) => e.phase === "progress"));
  });

  it("request settings win over planner duration/resolution", async () => {
    let startBody: any = null;
    installFetch({ pollSequence: [DONE_POLL], captureStart: (b) => (startBody = b) });
    await generateVideoViaGrok("clip", ctx(), { duration: 5, resolution: "480p" });
    // planner returned duration 99 / 720p, but request 5 / 480p must win
    assert.equal(startBody.duration, 5);
    assert.equal(startBody.resolution, "480p");
  });

  it("auto-selects I2V when a source image is supplied", async () => {
    let startBody: any = null;
    installFetch({ pollSequence: [DONE_POLL], captureStart: (b) => (startBody = b) });
    const result = await generateVideoViaGrok("animate", ctx(), { sourceImage: Buffer.from("img").toString("base64"), duration: 1, resolution: "480p" });
    assert.equal(result.mode, "image-to-video");
    assert.ok(startBody.image?.url?.startsWith("data:image/"));
  });

  it("maps moderation-suppressed done to GROK_VIDEO_MODERATION_BLOCKED", async () => {
    installFetch({ pollSequence: [{ status: "done", progress: 100, video: { url: "https://vidgen.example/v.mp4", respect_moderation: false } }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_MODERATION_BLOCKED");
  });

  it("maps done-without-url to GROK_VIDEO_EMPTY_RESPONSE", async () => {
    installFetch({ pollSequence: [{ status: "done", progress: 100, video: {} }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_EMPTY_RESPONSE");
  });

  it("maps failed status to GROK_VIDEO_FAILED", async () => {
    installFetch({ pollSequence: [{ status: "failed", error: { code: "internal_error" } }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_FAILED");
  });

  it("maps expired status to GROK_VIDEO_EXPIRED", async () => {
    installFetch({ pollSequence: [{ status: "expired" }] });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === "GROK_VIDEO_EXPIRED");
  });

  it("maps failed status codes to stable error taxonomy", async () => {
    for (const [failedCode, expected] of [
      ["invalid_argument", "GROK_VIDEO_REQUEST_FAILED"],
      ["permission_denied", "GROK_VIDEO_REQUEST_FAILED"],
      ["failed_precondition", "GROK_VIDEO_REQUEST_FAILED"],
      ["service_unavailable", "GROK_VIDEO_POLL_FAILED"],
    ] as const) {
      installFetch({ pollSequence: [{ status: "failed", error: { code: failedCode } }] });
      await assert.rejects(generateVideoViaGrok("clip", ctx(), { duration: 1 }), (e: any) => e.code === expected);
    }
  });

  it("maps start HTTP errors and caller cancellation", async () => {
    respond((kind, call) => {
      assert.equal(kind, "start");
      call.signal.throwIfAborted();
      return jsonRes({ error: "bad request" }, 400);
    });
    await assert.rejects(startVideoRequest(ctx(), { prompt: "x" }, {}), {
      code: "GROK_VIDEO_REQUEST_FAILED", status: 400, message: 'Grok video request failed: {"error":"bad request"}',
    });
    const controller = fixture.controller();
    controller.abort();
    await assert.rejects(startVideoRequest(ctx(), { prompt: "x" }, { signal: controller.signal }), (e: any) => e.code === "GENERATION_CANCELED" && e.status === 499);
  });

  it("rejects unsafe video download responses", async () => {
    respond(() => { assert.fail("Unsafe URL must not reach fetch"); });
    await assert.rejects(downloadVideo(ctx(), "http://example.com/v.mp4"), {
      code: "GROK_VIDEO_DOWNLOAD_FAILED", status: 502, message: "Grok video download URL must be HTTPS",
    });
    assert.equal(fixture.calls.length, 0);
    const cases = [
      { path: "not-video", chunks: [], options: { holdOpen: true, headers: { "content-type": "text/html" } }, message: "returned a non-video response", preflight: true },
      { path: "empty.mp4", chunks: [], options: {}, message: "was empty", preflight: false },
      { path: "bad.mp4", chunks: [Buffer.from("<html>not an mp4</html>")], options: {}, message: "returned an invalid MP4 container", preflight: false },
      { path: "too-large.mp4", chunks: [], options: { holdOpen: true, headers: { "content-length": "104857601", "content-type": "video/mp4" } }, message: "exceeds the 100MB limit", preflight: true },
      { path: "large-html", chunks: [], options: { holdOpen: true, headers: { "content-length": "104857601", "content-type": "text/html" } }, message: "exceeds the 100MB limit", preflight: true },
    ];
    for (const entry of cases) {
      const stream = artifactStream(entry.chunks, entry.options);
      respond((kind) => { assert.equal(kind, "artifact"); return stream.response; }, `https://vidgen.example/${entry.path}`);
      await assert.rejects(downloadVideo(ctx(), `https://vidgen.example/${entry.path}`), {
        code: "GROK_VIDEO_DOWNLOAD_FAILED", status: 502, message: `Grok video download ${entry.message}`,
      });
      assert.equal(stream.stats.arrayBufferCalls, 0);
      assert.equal(stream.body.locked, false);
      if (entry.preflight) {
        assert.equal(stream.stats.pulls, 0);
        assert.equal(stream.stats.sourceCancelCalls, 1);
      } else assert.equal(stream.stats.releaseLockCalls, 1);
    }
  });

  it("maps video download timeout to GROK_VIDEO_TIMEOUT", async () => {
    respond((kind, call) => {
      assert.equal(kind, "artifact");
      return new Promise<Response>((_resolve, reject) => {
        if (call.signal.aborted) reject(call.signal.reason);
        else call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true });
      });
    }, "https://vidgen.example/slow.mp4");
    await fixture.track(assert.rejects(downloadVideo(ctx({ config: { ...config,
      grokProvider: { ...config.grokProvider, videoDownloadTimeoutMs: 1 } } }),
    "https://vidgen.example/slow.mp4", fixture.controller().signal), {
      code: "GROK_VIDEO_TIMEOUT", status: 504, message: "Grok video download timed out",
    }));
    assert.equal(fixture.calls.length, 1);
  });

  it("preserves the downloader facade and scoped URL behavior", async () => {
    assert.equal(downloadVideo, (await import("../lib/grokVideoDownload.js")).downloadVideo);
    for (const url of [ARTIFACT, "http://localhost/fixture.mp4", "http://127.0.0.1/fixture.mp4"]) {
      respond((kind) => { assert.equal(kind, "artifact"); return videoBytesRes(); }, url);
      assert.deepEqual(await downloadVideo(ctx(), url), { buffer: fakeMp4Bytes(), contentType: "video/mp4" });
    }
    assert.equal(fixture.calls.length, 3);
    await assert.rejects(downloadVideo(ctx(), "not a URL"), { code: "GROK_VIDEO_DOWNLOAD_FAILED", status: 502 });
    assert.equal(fixture.calls.length, 3);
  });

  // lane=oauth resolves the seeded ~/.progrok session; lane=api-key carries an explicit key.
  for (const directKey of [undefined, "video-fixture-direct-key"]) {
    for (const failure of ["invalid", "read-reset"] as const) it(`never regenerates on ${failure}, lane=${directKey ? "api-key" : "oauth"}`, async () => {
      const reset = Object.assign(new Error("fixture body reset"), { code: "ECONNRESET" });
      const stream = artifactStream([failure === "invalid" ? Buffer.from("<html>not an mp4</html>") : fakeMp4Bytes()],
        failure === "read-reset" ? { failAfterChunks: reset } : {});
      const counts = installFetch({ pollSequence: [DONE_POLL], artifact: () => stream.response, directKey,
        captureStart: (body) => assert.deepEqual(body, { model: "grok-imagine-video", prompt: "bounded video", duration: 1, resolution: "480p" }),
      });
      await fixture.track(assert.rejects(generateVideoViaGrok("clip", ctx(), {
        model: "grok-imagine-video", plannedPrompt: "bounded video", duration: 1,
        ...(directKey ? { credential: { kind: "api-key" as const, key: directKey } } : {}),
        signal: fixture.controller().signal,
      }), { code: "GROK_VIDEO_DOWNLOAD_FAILED", status: 502, message: failure === "invalid"
        ? "Grok video download returned an invalid MP4 container" : "Grok video download request failed: fixture body reset" }));
      assert.deepEqual(counts, { start: 1, poll: 1, artifact: 1 });
      assert.equal(fixture.calls.length, 3);
      assert.equal(stream.stats.arrayBufferCalls, 0);
      assert.equal(stream.stats.readerCancelCalls, 1); assert.equal(stream.stats.releaseLockCalls, 1);
      assert.equal(stream.body.locked, false);
    });
  }

  for (const failure of ["reset", "503"] as const) it(`retries ${failure} artifact GET without another billed start`, async () => {
    const reset = Object.assign(new Error("fixture header reset"), { code: "ECONNRESET" });
    fixture.allowFailure(reset);
    const transient = artifactStream([], { status: 503, holdOpen: true, headers: { "retry-after": "0" } });
    let attempts = 0;
    const counts = installFetch({ pollSequence: [DONE_POLL], artifact() {
      if (++attempts > 1) return videoBytesRes();
      if (failure === "reset") throw reset;
      return transient.response;
    } });
    const result = await fixture.track(generateVideoViaGrok("clip", ctx(), {
      model: "grok-imagine-video", plannedPrompt: "bounded video", duration: 1, signal: fixture.controller().signal,
    }));
    assert.deepEqual(result.videoBuffer, fakeMp4Bytes());
    assert.deepEqual(counts, { start: 1, poll: 1, artifact: 2 });
    assert.equal(fixture.calls.length, 4);
    assert.equal(transient.stats.sourceCancelCalls, failure === "503" ? 1 : 0);
    assert.equal(transient.stats.pulls, 0);
  });

  for (const failure of ["reset", "503"] as const) it(`does not replay generation POST on ${failure}`, async () => {
    const reset = Object.assign(new Error("fixture start reset"), { code: "ECONNRESET" });
    fixture.allowFailure(reset);
    const counts = installFetch({ pollSequence: [DONE_POLL], startResponse() {
      if (failure === "reset") throw reset;
      return jsonRes({ error: "unavailable" }, 503);
    } });
    await fixture.track(assert.rejects(generateVideoViaGrok("clip", ctx(), {
      model: "grok-imagine-video", plannedPrompt: "bounded video", signal: fixture.controller().signal,
    }), { code: "GROK_VIDEO_REQUEST_FAILED", status: 502, message: failure === "reset"
      ? "Grok video start request failed: fixture start reset" : 'Grok video request failed: {"error":"unavailable"}' }));
    assert.deepEqual(counts, { start: 1, poll: 0, artifact: 0 });
    assert.equal(fixture.calls.length, 1);
  });

  it("accepts canonical 1.5 and normalizes preview alias", () => {
    assert.ok(VALID_GROK_VIDEO_MODELS.has("grok-imagine-video-1.5"));
    assert.ok(VALID_GROK_VIDEO_MODELS.has("grok-imagine-video-1.5-preview"));
    assert.equal((normalizeGrokVideoModel("grok-imagine-video-1.5") as any).model, "grok-imagine-video-1.5");
    const result = normalizeGrokVideoModel("grok-imagine-video-1.5-preview");
    assert.equal((result as any).model, "grok-imagine-video-1.5");
  });

  it("surfaces a 1.5 start 400 without resubmitting on another model", async () => {
    const starts: any[] = [];
    const counts = installFetch({ pollSequence: [DONE_POLL], startResponse(body) {
        starts.push(body);
        return jsonRes({ error: "`reference_images` is not supported for this model." }, 400);
    } });
    await assert.rejects(generateVideoViaGrok("clip", ctx(), {
      model: "grok-imagine-video-1.5-preview",
      plannedPrompt: "reference motion",
      mode: "reference-to-video",
      referenceImages: ["A", "B"],
      duration: 10,
    }), (e: any) => e.status === 400);
    assert.deepEqual(starts.map((s) => s.model), ["grok-imagine-video-1.5"]);
    assert.equal(counts.start, 1);
  });

  it("builds 1.5 I2V payload with 1080p", () => {
    const plan: GrokVideoPlan = { prompt: "dance", mode: "image-to-video", duration: 5, resolution: "1080p", aspectRatio: "16:9", webSearchCalls: 0 };
    const payload = buildVideoGenerationPayload(plan, { model: "grok-imagine-video-1.5-preview", sourceImageUrl: "data:image/png;base64,AAAA" });
    assert.equal(payload.model, "grok-imagine-video-1.5");
    assert.equal(payload.resolution, "1080p");
    assert.deepEqual(payload.image, { url: "data:image/png;base64,AAAA" });
  });

  it("allows native 1080p text-to-video on 1.5 and rejects 1080p elsewhere", () => {
    const t2v: GrokVideoPlan = { prompt: "p", mode: "text-to-video", duration: 5, resolution: "1080p", aspectRatio: "auto", webSearchCalls: 0 };
    const i2v: GrokVideoPlan = { ...t2v, mode: "image-to-video" };
    const ref2v: GrokVideoPlan = { ...t2v, mode: "reference-to-video" };
    const native = buildVideoGenerationPayload(t2v, { model: "grok-imagine-video-1.5" });
    assert.equal(native.resolution, "1080p"); assert.equal("image" in native, false);
    assert.throws(() => buildVideoGenerationPayload(i2v, { model: "grok-imagine-video", sourceImageUrl: "data:image/png;base64,AAAA" }), (e: any) => e.code === "INVALID_VIDEO_RESOLUTION");
    assert.throws(() => buildVideoGenerationPayload(ref2v, { model: "grok-imagine-video-1.5", referenceImageUrls: ["A", "B"] }), (e: any) => e.code === "INVALID_VIDEO_RESOLUTION");
  });

  it("sends 1.5-preview 1080p T2V natively without a canvas", async () => {
    let startBody: any = null;
    installFetch({ pollSequence: [DONE_POLL], captureStart: (b) => (startBody = b) });
    const result = await generateVideoViaGrok("make a freeform clip", ctx(), {
      model: "grok-imagine-video-1.5-preview",
      plannedPrompt: "A freeform cinematic clip.",
      duration: 5,
      resolution: "1080p",
      aspectRatio: "16:9",
    });
    assert.equal(result.mode, "text-to-video");
    assert.equal(startBody.model, "grok-imagine-video-1.5");
    assert.equal(startBody.resolution, "1080p");
    assert.equal("image" in startBody, false);
    assert.equal(startBody.prompt, "A freeform cinematic clip.");
  });
}
