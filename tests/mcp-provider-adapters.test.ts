// WP5 (050): adapter mappings verified against the sanitized fixture schemas.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNWAY_MODEL_CATALOG, runwayAdapter } from "../lib/mcp/adapters/runway.js";
import { higgsfieldAdapter, HIGGSFIELD_BILLING_DENYLIST } from "../lib/mcp/adapters/higgsfield.js";
import { importUrlToHiggsfield, uploadLocalMediaToHiggsfield } from "../lib/mcp/adapters/higgsfieldUpload.js";

test("runway image request maps to generate_image with rationale and count=1", () => {
  const plan = runwayAdapter.buildGenerateCall({ kind: "image", prompt: "a red fox", model: "gen-4", ratio: "16:9" });
  assert.equal(plan.toolName, "generate_image");
  assert.equal(plan.args.promptText, "a red fox");
  assert.equal(plan.args.model, "gen-4");
  assert.equal(plan.args.count, 1);
  assert.ok(typeof plan.args.rationale === "string" && (plan.args.rationale as string).length > 0);
});

test("runway video request maps startFrame for image-to-video", () => {
  const plan = runwayAdapter.buildGenerateCall({ kind: "video", prompt: "camera pans", startFrameUrl: "https://x.example/a.png" });
  assert.equal(plan.toolName, "generate_video");
  assert.deepEqual(plan.args.startFrame, { url: "https://x.example/a.png" });
});

test("runway video input roles gate every declared reference surface", () => {
  const roleRequests = {
    start_image: { startFrameUrl: "https://cdn.example.com/start.png" },
    end_image: {
      startFrameUrl: "https://cdn.example.com/start.png",
      endFrameUrl: "https://cdn.example.com/end.png",
    },
    image_references: { referenceImages: [{ url: "https://cdn.example.com/ref.png" }] },
    video_references: { referenceVideoUrl: "https://cdn.example.com/ref.mp4" },
  };
  for (const entry of RUNWAY_MODEL_CATALOG.video) {
    for (const [role, fields] of Object.entries(roleRequests)) {
      const build = () => runwayAdapter.buildGenerateCall({
        kind: "video", prompt: "x", model: entry.id, ...fields,
      });
      if (entry.capabilities.inputRoles.includes(role)) assert.doesNotThrow(build, `${entry.id}:${role}`);
      else assert.throws(build, new RegExp(`MCP_INPUT_ROLE_UNSUPPORTED:${entry.id}:${role}`), `${entry.id}:${role}`);
    }
  }
});

test("runway requires a start frame whenever an end frame is present", () => {
  assert.throws(() => runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "x", model: "seedance-2",
    endFrameUrl: "https://cdn.example.com/end.png",
  }), /MCP_END_FRAME_REQUIRES_START:seedance-2/);
});

test("runway maps end frame and reference video into generate_video args", () => {
  const plan = runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "restyle", model: "seedance-2",
    startFrameUrl: "https://cdn.example.com/start.png",
    endFrameUrl: "https://cdn.example.com/end.png",
    referenceVideoUrl: "https://cdn.example.com/source.mp4",
  });
  assert.deepEqual(plan.args.startFrame, { url: "https://cdn.example.com/start.png" });
  assert.deepEqual(plan.args.endFrame, { url: "https://cdn.example.com/end.png" });
  assert.deepEqual(plan.args.referenceVideo, { url: "https://cdn.example.com/source.mp4" });
});

test("runway forwards only model-declared video presets", () => {
  const plan = runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "camera pans", model: "seedance-2", ratio: "9:16",
    parameters: { duration: 12, resolution: "1080p", generateAudio: false },
  });
  assert.equal(plan.args.duration, 12);
  assert.equal(plan.args.resolution, "1080p");
  assert.equal(plan.args.generateAudio, false);
});

test("runway rejects unsupported ratios, keys, and ranges before a tool plan", () => {
  assert.throws(() => runwayAdapter.buildGenerateCall({ kind: "image", prompt: "x", model: "gpt-image-2", ratio: "7:5" }), /MCP_PARAMETER_INVALID/);
  assert.throws(() => runwayAdapter.buildGenerateCall({ kind: "video", prompt: "x", model: "gen-4-turbo", parameters: { resolution: "1080p" } }), /MCP_PARAMETER_UNSUPPORTED/);
  assert.throws(() => runwayAdapter.buildGenerateCall({ kind: "video", prompt: "x", model: "seedance-2", parameters: { duration: 99 } }), /MCP_PARAMETER_INVALID/);
});

test("runway normalizes dependent combos to the nearest supported contract", () => {
  // Veo 3.1 at 1080p only supports 8s output: coerce instead of self-reject.
  const veo = runwayAdapter.buildGenerateCall({ kind: "video", prompt: "x", model: "veo-3.1", parameters: { resolution: "1080p", duration: 6 } });
  assert.equal(veo.args.duration, 8);
  assert.equal(veo.args.resolution, "1080p");
  // Gen-4.5 image-to-video does not accept generateAudio: drop the default
  // instead of rejecting the stock UI state (sol review F3).
  const gen45 = runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "x", model: "gen-4.5",
    parameters: { duration: 10, generateAudio: true },
    startFrameUrl: "https://example.com/frame.png",
  });
  assert.equal("generateAudio" in gen45.args, false);
  assert.deepEqual(gen45.args.startFrame, { url: "https://example.com/frame.png" });
});

test("runway omits Auto presets instead of inventing provider arguments", () => {
  const plan = runwayAdapter.buildGenerateCall({ kind: "video", prompt: "x", model: "veo-3.1", parameters: {} });
  assert.equal("duration" in plan.args, false);
  assert.equal("resolution" in plan.args, false);
  assert.equal("generateAudio" in plan.args, false);
});

test("reference images ride the image_references input role only", () => {
  // seedance-2 declares image_references: URLs forward as {url} objects.
  const seedance = runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "x", model: "seedance-2",
    referenceImages: [{ url: "https://cdn.example.com/a.png" }, { url: "http://insecure.example.com/b.png" }],
  });
  assert.deepEqual(seedance.args.referenceImages, [{ url: "https://cdn.example.com/a.png" }]);
  // gen-4-turbo declares only start_image: references reject before any call.
  assert.throws(() => runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "x", model: "gen-4-turbo",
    referenceImages: [{ url: "https://cdn.example.com/a.png" }],
  }), /MCP_INPUT_ROLE_UNSUPPORTED:gen-4-turbo:image_references/);
  // image models with image_references accept them too.
  const image = runwayAdapter.buildGenerateCall({
    kind: "image", prompt: "x", model: "gen-4",
    referenceImages: [{ url: "https://cdn.example.com/a.png" }],
  });
  assert.deepEqual(image.args.referenceImages, [{ url: "https://cdn.example.com/a.png" }]);
});

test("reference tags forward as Runway @aliases; invalid tags drop silently", () => {
  const plan = runwayAdapter.buildGenerateCall({
    kind: "video", prompt: "@Jipy waves at the crosswalk", model: "seedance-2",
    referenceImages: [
      { url: "https://cdn.example.com/a.png", tag: "Jipy" },
      { url: "https://cdn.example.com/b.png", tag: "bad tag with spaces!" },
    ],
  });
  assert.deepEqual(plan.args.referenceImages, [
    { url: "https://cdn.example.com/a.png", tag: "Jipy" },
    { url: "https://cdn.example.com/b.png" },
  ]);
});

test("unsupported model ids are rejected before any call", () => {
  assert.throws(() => runwayAdapter.buildGenerateCall({ kind: "image", prompt: "x", model: "dall-e-9" }), /MCP_MODEL_UNSUPPORTED/);
  assert.throws(() => runwayAdapter.buildGenerateCall({ kind: "video", prompt: "x", model: "sora-99" }), /MCP_MODEL_UNSUPPORTED/);
});

test("task id parses from structuredContent or text", () => {
  assert.equal(runwayAdapter.parseTaskId({ structuredContent: { taskId: "abc-1" } }), "abc-1");
  assert.equal(
    runwayAdapter.parseTaskId({ content: [{ type: "text", text: "Task created: 123e4567-e89b-12d3-a456-426614174000. Poll get_task." }] }),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assert.equal(runwayAdapter.parseTaskId({ content: [{ type: "text", text: "no id here" }] }), null);
});

test("poll parsing distinguishes succeeded/failed/running and extracts media urls", () => {
  const done = runwayAdapter.parsePoll({ content: [{ type: "text", text: "status: SUCCEEDED output: https://dnznrvs05pmza.cloudfront.net/abc.mp4?_jwt=secret" }] });
  assert.equal(done.status, "succeeded");
  assert.match(done.outputUrls[0], /cloudfront/);
  const failed = runwayAdapter.parsePoll({ content: [{ type: "text", text: "status: FAILED reason: safety" }] });
  assert.equal(failed.status, "failed");
  assert.match(failed.detail ?? "", /safety/);
  assert.equal(runwayAdapter.parsePoll({ content: [{ type: "text", text: "RUNNING 42%" }] }).status, "running");
});

test("higgsfield adapter is executable: billing tools denylisted, generate/poll wired", () => {
  assert.equal(higgsfieldAdapter.executable, true);
  assert.deepEqual([...HIGGSFIELD_BILLING_DENYLIST], ["confirm_billing_purchase", "cancel_trial_auto_renewal", "confirm_trial_cancel"]);
  assert.ok(higgsfieldAdapter.models.image.length > 0);
  assert.ok(higgsfieldAdapter.models.video.length > 0);
  const call = higgsfieldAdapter.buildGenerateCall({ kind: "image", prompt: "a cat", model: "soul_2" });
  assert.equal(call.toolName, "generate_image");
  const callParams = call.args.params as Record<string, unknown>; // justified: ToolCallPlan.args is Record<string, unknown>
  assert.equal(callParams.model, "soul_2");
  // 260723: use_unlim defaults on (web-app contract); whitelisted knobs forward.
  assert.equal(callParams.use_unlim, true);
  const lowRes = higgsfieldAdapter.buildGenerateCall({ kind: "image", prompt: "a cat", model: "nano_banana_2", parameters: { resolution: "1k", duration: 5, bogus: "x" } });
  const lowResParams = lowRes.args.params as Record<string, unknown>; // justified: ToolCallPlan.args is Record<string, unknown>
  assert.equal(lowResParams.resolution, "1k");
  assert.equal(lowResParams.duration, undefined); // image kind never gets duration
  assert.equal(lowResParams.bogus, undefined); // non-whitelisted keys are dropped
  const override = higgsfieldAdapter.buildGenerateCall({ kind: "image", prompt: "a cat", parameters: { use_unlim: false } });
  assert.equal((override.args.params as Record<string, unknown>).use_unlim, false); // justified: ToolCallPlan.args is Record<string, unknown>
  const poll = higgsfieldAdapter.buildPollCall("abc-123");
  assert.equal(poll.toolName, "job_status");
  assert.equal(poll.args.jobId, "abc-123");
});

test("higgsfield medias use provider-declared roles (start_image/end_image/image/video)", () => {
  const plan = higgsfieldAdapter.buildGenerateCall({
    kind: "video", prompt: "pan", model: "cinematic_studio_3_0",
    startFrameUrl: "media-start", endFrameUrl: "media-end",
    referenceImages: [{ url: "media-ref", tag: "Jipy" }],
    referenceVideoUrl: "media-video",
  });
  const params = plan.args.params as Record<string, unknown>; // justified: ToolCallPlan.args is Record<string, unknown>
  // Tags are a Runway @alias concept; higgsfield medias carry only {value, role}.
  assert.deepEqual(params.medias, [
    { value: "media-start", role: "start_image" },
    { value: "media-end", role: "end_image" },
    { value: "media-ref", role: "image" },
    { value: "media-video", role: "video" },
  ]);
});

test("higgsfield requires a start frame whenever an end frame is present", () => {
  assert.throws(() => higgsfieldAdapter.buildGenerateCall({
    kind: "video", prompt: "x", model: "cinematic_studio_3_0", endFrameUrl: "media-end",
  }), /MCP_END_FRAME_REQUIRES_START:cinematic_studio_3_0/);
});

test("higgsfield upload flows media_upload -> PUT -> media_confirm and returns media_id", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-upload-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "in.png");
  writeFileSync(file, Buffer.from([1, 2, 3]));
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const manager = {
    callTool: async (_provider: string, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "media_upload") {
        return { structuredContent: { uploads: [{ upload_url: "https://93.184.216.34/put/1", media_id: "mid-1" }] } };
      }
      if (name === "media_confirm") {
        return { structuredContent: { results: [{ media_id: "mid-1", status: "confirmed" }] } };
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  const puts: string[] = [];
  t.mock.method(globalThis, "fetch", async (target: unknown) => {
    puts.push(String(target));
    return new Response(null, { status: 200 });
  });
  const id = await uploadLocalMediaToHiggsfield(manager as never, file, { fileName: "in.png", mimeType: "image/png" });
  assert.equal(id, "mid-1");
  assert.deepEqual(puts, ["https://93.184.216.34/put/1"]);
  assert.deepEqual(calls.map((call) => call.name), ["media_upload", "media_confirm"]);
  assert.equal(calls[1].args.type, "image");
});

test("higgsfield import wraps media_import_url and returns media_id", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const manager = {
    callTool: async (_provider: string, name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { structuredContent: { media_id: "mid-9", type: "image" } };
    },
  };
  const id = await importUrlToHiggsfield(manager as never, "https://cdn.example.com/a.png", "image");
  assert.equal(id, "mid-9");
  assert.deepEqual(calls, [{ name: "media_import_url", args: { url: "https://cdn.example.com/a.png", type: "image" } }]);
});
