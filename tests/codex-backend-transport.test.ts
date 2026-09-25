/**
 * Native GPT OAuth transport (lib/codexBackend/index.ts) against a local fake Codex backend.
 *
 * oauthFetch(ctx with oauthTransport "native") answers ima2's OpenAI-shaped /v1 calls by talking
 * to chatgpt.com/backend-api/codex itself. This pins the translation the retired proxy used to do:
 * Responses-lite shaping for GPT-6, the astra effort floor, multipart edits → JSON data URLs, the
 * model roster, and a typed 401 when there is no session. HOME and CODEX_HOME point at a temp dir
 * so no real credentials are ever read.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "ima2-codex-transport-"));
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.CODEX_HOME = join(root, ".codex");
process.env.IMA2_CODEX_CLIENT_VERSION = "0.157.0";

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: any };
const seen: Seen[] = [];
let upstream: Server;
let transport: typeof import("../lib/codexBackend/index.ts");
const native = { oauthTransport: "native" as const };

function jwt(payload: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.sig`;
}

function sse(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

describe("native GPT OAuth transport", () => {
  before(async () => {
    upstream = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : null });
        const path = (req.url ?? "").replace(/^\/backend-api\/codex/, "");
        if (path.startsWith("/models")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ models: [
            { slug: "gpt-6-luna", use_responses_lite: true },
            { slug: "gpt-6-astra", use_responses_lite: true },
            { slug: "hidden-model", visibility: "hide" },
          ] }));
          return;
        }
        if (path === "/responses") {
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(sse([
            { type: "response.output_item.done", item: { type: "function_call", call_id: "c1", name: "image_gen", arguments: "{\"prompt\":\"p\"}" } },
            { type: "response.completed", response: { id: "r1", output: [], usage: { total_tokens: 2 } } },
          ]));
          return;
        }
        if (path.startsWith("/images/")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ data: [{ b64_json: "aW1n" }] }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.IMA2_CODEX_BASE_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/backend-api/codex`;
    transport = await import("../lib/codexBackend/index.ts");
    const { createCodexSessionStore } = await import("../lib/codexBackend/session.ts");
    const { chatgptAuthFilePath } = await import("../lib/chatgptAuth.ts");
    const token = jwt({ exp: 2_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } });
    writeFileSync(chatgptAuthFilePath(root), JSON.stringify({ tokens: { access_token: token, refresh_token: "rt", account_id: "acct-1" } }));
    transport.setCodexSessionStoreForTests(createCodexSessionStore({ configDir: root, refresher: async () => ({}) }));
  });

  after(async () => {
    transport?.setCodexSessionStoreForTests(null);
    await new Promise((resolve) => upstream.close(resolve));
    rmSync(root, { recursive: true, force: true });
  });

  it("shapes a GPT-6 planner call as Responses-lite and streams the backend events back", async () => {
    seen.length = 0;
    const tool = { type: "function", name: "image_gen", parameters: { type: "object" } };
    const res = await transport.oauthFetch(native, "/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-6-astra", input: [{ role: "user", content: "draw" }], tools: [tool],
        tool_choice: { type: "function", name: "image_gen" }, reasoning: { effort: "none" }, stream: true }),
    });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /"name":"image_gen"/);
    const call = seen.find((entry) => entry.url.endsWith("/responses"))!;
    assert.equal(call.headers["x-openai-internal-codex-responses-lite"], "true");
    assert.equal(call.headers["chatgpt-account-id"], "acct-1");
    assert.match(String(call.headers.authorization), /^Bearer /);
    assert.equal(call.body.tools, undefined, "lite requests carry tools as an additional_tools item");
    assert.equal(call.body.tool_choice, undefined);
    assert.deepEqual(call.body.input[0], { type: "additional_tools", role: "developer", tools: [tool] });
    assert.deepEqual(call.body.input[1], { role: "user", content: [{ type: "input_text", text: "draw" }] });
    assert.deepEqual(call.body.reasoning, { effort: "low", context: "all_turns" }, "astra cannot take effort none");
    assert.equal(call.body.store, false);
    assert.equal(call.body.parallel_tool_calls, false);
  });

  it("collects a non-streaming Responses call into the completed response", async () => {
    const res = await transport.oauthFetch(native, "/v1/responses", {
      method: "POST", body: JSON.stringify({ model: "gpt-6-luna", input: "hi", stream: false }),
    });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { id?: string }).id, "r1");
  });

  it("turns a multipart edit into JSON data-URL images and keeps every render option", async () => {
    seen.length = 0;
    const form = new FormData();
    for (const [key, value] of Object.entries({ model: "gpt-image-2", prompt: "edit", quality: "low", size: "1024x1024", moderation: "low", background: "transparent" })) form.set(key, value);
    form.append("image", new Blob([Buffer.from("first")], { type: "image/png" }), "a.png");
    form.append("image", new Blob([Buffer.from("second")], { type: "image/jpeg" }), "b.jpg");
    const res = await transport.oauthFetch(native, "/v1/images/edits", { method: "POST", body: form });
    assert.equal(res.status, 200);
    const call = seen.find((entry) => entry.url.endsWith("/images/edits"))!;
    assert.deepEqual(call.body, {
      model: "gpt-image-2", prompt: "edit", background: "transparent", quality: "low", size: "1024x1024", moderation: "low",
      images: [
        { image_url: `data:image/png;base64,${Buffer.from("first").toString("base64")}` },
        { image_url: `data:image/jpeg;base64,${Buffer.from("second").toString("base64")}` },
      ],
    });
  });

  it("passes generations through with gpt-image-2 as the default renderer", async () => {
    seen.length = 0;
    const res = await transport.oauthFetch(native, "/v1/images/generations", {
      method: "POST", body: JSON.stringify({ prompt: "p", n: 1, moderation: "low", response_format: "b64_json" }),
    });
    assert.deepEqual(await res.json(), { data: [{ b64_json: "aW1n" }] });
    const call = seen.find((entry) => entry.url.endsWith("/images/generations"))!;
    assert.deepEqual(call.body, { prompt: "p", n: 1, moderation: "low", model: "gpt-image-2" });
  });

  it("lists the visible roster plus the renderer at the pinned client version", async () => {
    seen.length = 0;
    transport.resetCodexCaches();
    const res = await transport.oauthFetch(native, "/v1/models", { method: "GET" });
    const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((row) => row.id);
    assert.deepEqual(ids, ["gpt-6-luna", "gpt-6-astra", "gpt-image-2"]);
    assert.ok(seen.some((entry) => entry.url.includes("/models?client_version=0.157.0")));
  });

  it("answers a typed 401 when there is no ChatGPT session", async () => {
    const { createCodexSessionStore } = await import("../lib/codexBackend/session.ts");
    const empty = mkdtempSync(join(tmpdir(), "ima2-codex-empty-"));
    transport.setCodexSessionStoreForTests(createCodexSessionStore({ configDir: empty }));
    try {
      const res = await transport.oauthFetch(native, "/v1/images/generations", { method: "POST", body: "{}" });
      assert.equal(res.status, 401);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, "OAUTH_SESSION_REQUIRED");
      // Generation surfaces it as the existing ChatGPT sign-in code, with a login hint.
      const { postOAuthImages } = await import("../lib/responsesTransport.ts");
      await assert.rejects(
        postOAuthImages({ ctx: { ...native, oauthReadyState: "ready" } as never, scope: "test", kind: "generations", json: { prompt: "p" } }),
        (error: Error & { code?: string; status?: number }) => {
          assert.equal(error.code, "AUTH_CHATGPT_EXPIRED");
          assert.equal(error.status, 401);
          assert.match(error.message, /ima2 gpt login/);
          return true;
        },
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
