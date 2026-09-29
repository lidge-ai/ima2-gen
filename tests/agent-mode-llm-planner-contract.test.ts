import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedGrokAuth } from "./_grokAuthFixture.ts";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-planner-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");
// The grok planner lane resolves an OAuth bearer from ~/.progrok/auth.json.
const grokAuth = seedGrokAuth();

const { AGENT_ALLOWED_TOOLS } = await import("../lib/agentTypes.ts");
const { AGENT_TOOL_MANIFEST, formatToolManifestForPrompt } = await import("../lib/agentToolManifest.ts");
const { DEFAULT_AGENT_GENERATION_SETTINGS } = await import("../lib/agentSettings.ts");
const { cleanVideoParams, normalizeAgentGenerationPlan } = await import("../lib/agentGenerationPlanner.ts");
const { extractJsonObject, requestAgentPlanFromModel } = await import("../lib/agentPlannerModel.ts");
const { buildIma2Capabilities } = await import("../lib/capabilities.ts");
const db = await import("../lib/db.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  db.closeDb();
  grokAuth.cleanup();
  rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function plannerCtx() {
  return {
    config: { agentPlanner: { enabled: true, timeoutMs: 5_000 }, log: { level: "silent" } },
    oauthUrl: "http://127.0.0.1:9",
    packageVersion: "test",
    grokAuthHomeDir: grokAuth.homeDir,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Agent Mode LLM planner contract", () => {
  it("declares a manifest entry with parameters for every allowed tool", () => {
    assert.deepEqual(
      AGENT_TOOL_MANIFEST.map((entry) => entry.name),
      [...AGENT_ALLOWED_TOOLS],
    );
    for (const entry of AGENT_TOOL_MANIFEST) {
      assert.equal(typeof entry.description, "string");
      assert.ok(entry.description.length > 0);
      assert.equal((entry.parameters as { type?: string }).type, "object");
    }
    const promptBlock = formatToolManifestForPrompt();
    for (const tool of AGENT_ALLOWED_TOOLS) {
      assert.ok(promptBlock.includes(tool), `prompt manifest missing ${tool}`);
    }
    const imageTool = AGENT_TOOL_MANIFEST.find((entry) => entry.name === "ima2.generate_image");
    assert.ok(imageTool);
    const properties = (imageTool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    assert.ok(properties.sourceImagePolicy);
    assert.match(JSON.stringify(properties.sourceImagePolicy), /none/);
    assert.match(JSON.stringify(properties.sourceImagePolicy), /current/);
  });

  it("includes ima2.get_generation_errors as the fifth allowed tool", () => {
    assert.equal(AGENT_ALLOWED_TOOLS.length, 5);
    assert.ok(AGENT_ALLOWED_TOOLS.includes("ima2.get_generation_errors"));
  });

  it("keeps errors-mode plans intact instead of re-deriving a regex plan", () => {
    const plan = normalizeAgentGenerationPlan(
      "왜 아까 영상 생성이 실패했어?",
      { mode: "errors", prompts: [], source: "llm-planner", reason: "User asks about failures." },
      DEFAULT_AGENT_GENERATION_SETTINGS,
    );
    assert.equal(plan.mode, "errors");
    assert.deepEqual(plan.prompts, []);
    assert.equal(plan.plannedVariants, 0);
    assert.equal(plan.source, "llm-planner");
  });

  it("preserves the llm-planner source and video params on video plans", () => {
    const plan = normalizeAgentGenerationPlan(
      "방금 그 이미지를 10초 16:9 영상으로 만들어줘",
      {
        mode: "video",
        prompts: ["방금 그 이미지를 영상으로"],
        source: "llm-planner",
        videoParams: { duration: 10, resolution: "720p", aspectRatio: "16:9" },
      },
      DEFAULT_AGENT_GENERATION_SETTINGS,
    );
    assert.equal(plan.mode, "video");
    assert.equal(plan.source, "llm-planner");
    assert.deepEqual(plan.videoParams, { duration: 10, resolution: "720p", aspectRatio: "16:9" });
  });

  it("preserves planner source image policy on image plans", () => {
    const plan = normalizeAgentGenerationPlan(
      "이 이미지 스타일 유지해서 다시 만들어줘",
      {
        mode: "single",
        prompts: ["이 이미지 스타일 유지해서 다시 만들어줘"],
        source: "llm-planner",
        sourceImagePolicy: "current",
        reason: "explicit current image edit",
      },
      DEFAULT_AGENT_GENERATION_SETTINGS,
    );
    assert.equal(plan.mode, "single");
    assert.equal(plan.source, "llm-planner");
    assert.equal(plan.sourceImagePolicy, "current");
  });

  it("clamps and rejects malformed video params", () => {
    assert.deepEqual(cleanVideoParams({ duration: 99, resolution: "1080p", aspectRatio: "21:9" }), { duration: 15, resolution: "1080p" });
    assert.deepEqual(cleanVideoParams({ duration: 0.4, resolution: "480p" }), { duration: 1, resolution: "480p" });
    assert.equal(cleanVideoParams({ resolution: "8k" }), null);
    assert.equal(cleanVideoParams("nope"), null);
  });

  it("falls back to the regex deriver when planner output has no usable prompts", () => {
    const plan = normalizeAgentGenerationPlan(
      "make three distinct poster variants",
      { mode: "fanout", prompts: [] },
      DEFAULT_AGENT_GENERATION_SETTINGS,
    );
    assert.equal(plan.mode, "fanout");
    assert.equal(plan.plannedVariants, 3);
    assert.equal(plan.source, "auto-request");
  });

  it("extracts planner JSON from fenced or prose-wrapped output", () => {
    const fenced = "```json\n{\"mode\":\"single\",\"prompts\":[\"a cat\"]}\n```";
    assert.deepEqual(extractJsonObject(fenced), { mode: "single", prompts: ["a cat"] });
    const wrapped = "Here is the plan: {\"mode\":\"video\",\"prompts\":[\"clip\"],\"videoParams\":{\"duration\":7}} done";
    assert.deepEqual(extractJsonObject(wrapped), { mode: "video", prompts: ["clip"], videoParams: { duration: 7 } });
    assert.equal(extractJsonObject("no json here"), null);
    assert.equal(extractJsonObject("[1,2,3]"), null);
  });

  it("exposes the synced tool surface through capabilities", () => {
    const capabilities = buildIma2Capabilities({ packageVersion: "0.0.0-test", source: "local" });
    assert.deepEqual(capabilities.agentMode.allowedTools, [...AGENT_ALLOWED_TOOLS]);
    assert.deepEqual(
      capabilities.agentMode.toolManifest.map((entry) => entry.name),
      [...AGENT_ALLOWED_TOOLS],
    );
  });

  it("plans through the Responses endpoint for oauth sessions and tags the plan llm-planner", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return jsonResponse({
        output_text: '{"mode":"fanout","prompts":["poster a","poster b","poster c"],"plannedVariants":3,"reason":"user asked for variants"}',
      });
    }) as typeof fetch;
    const plan = await requestAgentPlanFromModel(plannerCtx(), {
      sessionId: "missing-session",
      prompt: "make three distinct posters",
      settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "oauth" },
    });
    assert.ok(plan);
    assert.equal(plan.mode, "fanout");
    assert.equal(plan.plannedVariants, 3);
    assert.equal(plan.source, "llm-planner");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/v1/responses"));
    assert.equal(calls[0].body.model, DEFAULT_AGENT_GENERATION_SETTINGS.model);
    const developerPrompt = (calls[0].body.input as Array<{ content: string }>)[0].content;
    assert.match(developerPrompt, /Tool execution contract:/);
    assert.match(developerPrompt, /session model is the planner\/LLM model, not an image or video model/);
    assert.match(developerPrompt, /grok-4\.5 means Grok planner\/provider routing/);
    assert.match(developerPrompt, /ima2\.generate_image/);
    assert.match(developerPrompt, /ima2\.get_generation_errors/);
    assert.match(developerPrompt, /sourceImagePolicy/);
    assert.match(developerPrompt, /i2i 말고/);
    assert.match(developerPrompt, /current image/);
  });

  it("plans through grok chat completions for grok sessions including video params", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return jsonResponse({
        choices: [{
          message: {
            content: '{"mode":"video","prompts":["cat surfing"],"videoParams":{"duration":10,"resolution":"1080p","aspectRatio":"16:9"},"reason":"video request"}',
          },
        }],
      });
    }) as typeof fetch;
    const plan = await requestAgentPlanFromModel(plannerCtx(), {
      sessionId: "missing-session",
      prompt: "고양이 서핑 10초 16:9 영상",
      settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "grok" },
    });
    assert.ok(plan);
    assert.equal(plan.mode, "video");
    assert.equal(plan.source, "llm-planner");
    assert.deepEqual(plan.videoParams, { duration: 10, resolution: "1080p", aspectRatio: "16:9" });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/v1/chat/completions"));
    assert.match((calls[0].body.messages as Array<{ content: string }>)[0].content, /Tool execution contract:/);
  });

  it("returns null for agy sessions, upstream failures, and unparseable output", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const agyPlan = await requestAgentPlanFromModel(plannerCtx(), {
      sessionId: "missing-session",
      prompt: "draw a cat",
      settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "agy" },
    });
    assert.equal(agyPlan, null);
    assert.equal(fetchCount, 0);

    const failedPlan = await requestAgentPlanFromModel(plannerCtx(), {
      sessionId: "missing-session",
      prompt: "draw a cat",
      settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "oauth" },
    });
    assert.equal(failedPlan, null);
    assert.equal(fetchCount, 1);

    globalThis.fetch = (async () => jsonResponse({ output_text: "sorry, no JSON" })) as typeof fetch;
    const unparseablePlan = await requestAgentPlanFromModel(plannerCtx(), {
      sessionId: "missing-session",
      prompt: "draw a cat",
      settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "oauth" },
    });
    assert.equal(unparseablePlan, null);
  });

  it("skips the planner entirely when disabled by config", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return jsonResponse({ output_text: "{}" });
    }) as typeof fetch;
    const plan = await requestAgentPlanFromModel(
      { ...plannerCtx(), config: { agentPlanner: { enabled: false }, log: { level: "silent" } } },
      {
        sessionId: "missing-session",
        prompt: "draw a cat",
        settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "oauth" },
      },
    );
    assert.equal(plan, null);
    assert.equal(fetchCount, 0);
  });
});
