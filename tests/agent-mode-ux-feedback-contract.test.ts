import { after, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adaptFetchAssignmentsForNativeOAuth } from "./_oauthNativeFixture.ts";

// GPT OAuth plans then renders; keep this file's one-call image fixtures (see the helper).
adaptFetchAssignmentsForNativeOAuth();

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-agent-ux-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerAgentRoutes } = await import("../routes/agent.ts");
const { normalizeAgentGenerationPlan } = await import("../lib/agentGenerationPlanner.ts");
const { requestAgentPlanFromModel } = await import("../lib/agentPlannerModel.ts");
const { DEFAULT_AGENT_GENERATION_SETTINGS } = await import("../lib/agentSettings.ts");
const db = await import("../lib/db.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

type TurnLike = { role: string; status?: string; text: string; imageIds?: string[] };
const TEST_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGOSHzRgAAAAABJRU5ErkJggg==";

function sseResponse(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  agentPlanner: { enabled: boolean; timeoutMs?: number } = { enabled: false },
) {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  registerAgentRoutes(app, {
    apiKey: "sk-test",
    config: {
      storage: { generatedDir: join(TEST_DIR, `generated-${Date.now()}`) },
      log: { level: "silent" },
      agentPlanner,
    },
    packageVersion: "test",
  });
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function createSession(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/agent/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "ux contract" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { selectedSessionId: string };
  return body.selectedSessionId;
}

async function turnsFor(baseUrl: string, sessionId: string): Promise<TurnLike[]> {
  const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}`);
  const body = await res.json() as { turnsBySession: Record<string, TurnLike[]> };
  return body.turnsBySession[sessionId] ?? [];
}

async function waitFor<T>(probe: () => Promise<T | undefined | false>, label: string, timeoutMs = 15_000): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await probe();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("Agent Mode UX feedback contract", () => {
  it("keeps question-mode plans intact instead of re-deriving a regex video plan", () => {
    const plan = normalizeAgentGenerationPlan(
      "영상 생성가능하니",
      { mode: "question", prompts: [], source: "llm-planner", assistantText: "네, 영상 생성이 가능해요." },
      DEFAULT_AGENT_GENERATION_SETTINGS,
    );
    assert.equal(plan.mode, "question");
    assert.deepEqual(plan.prompts, []);
    assert.equal(plan.assistantText, "네, 영상 생성이 가능해요.");
    assert.equal(plan.source, "llm-planner");
  });

  it("lets the LLM planner answer capability questions through assistantText", async () => {
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<{ role: string; content: string }> };
      assert.ok(body.input[0].content.includes("mode question"), "planner prompt must teach question mode");
      return new Response(JSON.stringify({
        output_text: '{"mode":"question","prompts":[],"assistantText":"네, ima2.generate_video 도구로 영상 생성이 가능합니다.","reason":"capability question"}',
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const plan = await requestAgentPlanFromModel(
      { config: { agentPlanner: { enabled: true, timeoutMs: 5_000 }, log: { level: "silent" } }, oauthUrl: "http://127.0.0.1:9", packageVersion: "test" },
      {
        sessionId: "missing-session",
        prompt: "영상 생성가능하니",
        settings: { ...DEFAULT_AGENT_GENERATION_SETTINGS, provider: "oauth" },
      },
    );
    assert.ok(plan);
    assert.equal(plan.mode, "question");
    assert.ok(plan.assistantText?.includes("영상 생성이 가능"));
  });

  it("shows the planner chat prelude before media tools finish", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/api/agent/")) return originalFetch(url, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: Array<{ role: string; content: string }>;
      };
      const firstPrompt = body.input?.[0]?.content ?? "";
      if (firstPrompt.includes("generation planner")) {
        return Response.json({
          output_text: JSON.stringify({
            mode: "single",
            prompts: ["잔잔한 고양이 포스터"],
            assistantText: "좋아요. 먼저 한 장으로 방향을 잡아볼게요.",
            reason: "image request",
          }),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      return sseResponse([
        {
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: TEST_PNG_B64, revised_prompt: "잔잔한 고양이 포스터" },
        },
        { type: "response.completed", response: { usage: { total_tokens: 3 } } },
      ]);
    }) as typeof fetch;
    await withApp(async (baseUrl) => {
      const sessionId = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "잔잔한 고양이 포스터 만들어줘", provider: "api" }),
      });
      assert.equal(res.status, 202);
      const prelude = await waitFor(async () => {
        const turns = await turnsFor(baseUrl, sessionId);
        return turns.find((turn) => turn.role === "assistant" && turn.text.includes("방향을 잡아볼게요"));
      }, "planner prelude before generation completes", 700);
      assert.equal(prelude.status, "complete");
      const finalTurn = await waitFor(async () => {
        const turns = await turnsFor(baseUrl, sessionId) as Array<TurnLike & { imageIds?: string[] }>;
        return turns.find((turn) => turn.role === "assistant" && (turn.imageIds?.length ?? 0) > 0);
      }, "final assistant turn with generated artifact");
      assert.ok((finalTurn.imageIds?.length ?? 0) > 0);
    }, { enabled: true, timeoutMs: 5_000 });
  });

  it("surfaces video-path queue failures as an assistant error turn in the chat", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/api/agent/")) return originalFetch(url, init);
      return new Response("upstream down", { status: 502 });
    }) as typeof fetch;
    await withApp(async (baseUrl) => {
      const sessionId = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "고양이 영상 만들어줘" }),
      });
      assert.equal(res.status, 202);
      const errorTurn = await waitFor(async () => {
        const turns = await turnsFor(baseUrl, sessionId);
        return turns.find((turn) => turn.role === "assistant" && turn.status === "error");
      }, "assistant error turn after video failure");
      assert.ok(errorTurn.text.length > 0);
    });
  });

  it("does not duplicate error turns when the image runtime already recorded one", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/api/agent/")) return originalFetch(url, init);
      return new Response("upstream down", { status: 502 });
    }) as typeof fetch;
    await withApp(async (baseUrl) => {
      const sessionId = await createSession(baseUrl);
      const res = await fetch(`${baseUrl}/api/agent/sessions/${sessionId}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "draw one quiet poster", provider: "api" }),
      });
      assert.equal(res.status, 202);
      await waitFor(async () => {
        const turns = await turnsFor(baseUrl, sessionId);
        return turns.some((turn) => turn.role === "assistant" && turn.status === "error");
      }, "assistant error turn after image failure");
      await new Promise((resolve) => setTimeout(resolve, 400));
      const turns = await turnsFor(baseUrl, sessionId);
      const errorTurns = turns.filter((turn) => turn.role === "assistant" && turn.status === "error");
      assert.equal(errorTurns.length, 1, `expected exactly one error turn, got: ${JSON.stringify(errorTurns)}`);
    });
  });
});
