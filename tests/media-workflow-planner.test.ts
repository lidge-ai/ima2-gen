// The workflow text planner (Director shot planning) over the GPT OAuth proxy transport.
// A local fake server stands in for the proxy; nothing leaves the machine.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isolatedConfigDir = await mkdtemp(join(tmpdir(), "ima2-wf-planner-"));
process.env.IMA2_CONFIG_DIR = isolatedConfigDir;
const { config } = await import("../config.ts");
const { createOAuthPlanText } = await import("../lib/providers/media/workflowPlanner.ts");

test.after(async () => { await rm(isolatedConfigDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

async function withProxy(reply: (body: Record<string, unknown>) => { status: number; body: string }, fn: (url: string, seen: Record<string, unknown>[]) => Promise<void>) {
  const seen: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push({ path: req.url, ...body });
      const r = reply(body);
      res.writeHead(r.status, { "content-type": "application/json" }).end(r.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try { await fn(`http://127.0.0.1:${port}`, seen); } finally { await new Promise<void>((r) => server.close(() => r())); }
}

const request = { purpose: "director-shots", system: "Split the scene.", user: "Scene: a fox. Shots: 2" };

test("planText sends one JSON-mode Responses call and returns the parsed JSON", async () => {
  await withProxy(() => ({ status: 200, body: JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"shots":[{"prompt":"a"},{"prompt":"b"}]}' }] }] }) }), async (url, seen) => {
    const planText = createOAuthPlanText({ oauthUrl: url, oauthTransport: "proxy", config: { ...config, workflowPlanner: { model: "planner-x", timeoutMs: 5000 } } as never });
    const out = await planText(request, new AbortController().signal);
    assert.deepEqual(out, { shots: [{ prompt: "a" }, { prompt: "b" }] });
    assert.equal(seen[0]!.path, "/v1/responses");
    assert.equal(seen[0]!.model, "planner-x");
    assert.deepEqual(seen[0]!.text, { format: { type: "json_object" } });
  });
});

test("planText turns upstream failures and non-JSON text into coded workflow errors", async () => {
  await withProxy(() => ({ status: 503, body: "{}" }), async (url) => {
    const planText = createOAuthPlanText({ oauthUrl: url, oauthTransport: "proxy", config: config as never });
    await assert.rejects(planText(request, new AbortController().signal), (e: { code?: string; options?: { retryable?: boolean } }) => e.code === "WORKFLOW_PLANNER_FAILED" && e.options?.retryable === true);
  });
  await withProxy(() => ({ status: 200, body: JSON.stringify({ output_text: "not json" }) }), async (url) => {
    const planText = createOAuthPlanText({ oauthUrl: url, oauthTransport: "proxy", config: config as never });
    await assert.rejects(planText(request, new AbortController().signal), { code: "WORKFLOW_PLANNER_INVALID" });
  });
});
