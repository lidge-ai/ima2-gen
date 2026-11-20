import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each backend uses an owned temporary home and a local fake server.
describe("OAuth transport with empty catalog", { concurrency: false }, () => {
  const root = mkdtempSync(join(tmpdir(), "ima2-lineup-codex-"));
  let server: Server;
  let transport: typeof import("../lib/codexBackend/index.ts");
  let client: typeof import("../lib/codexBackend/client.ts");
  let seen: { headers: import("node:http").IncomingHttpHeaders; body: Record<string, any> }[] = [];
  const oldHome = process.env.HOME, oldProfile = process.env.USERPROFILE, oldCodex = process.env.CODEX_HOME;
  const oldUrl = process.env.IMA2_CODEX_BASE_URL;
  before(async () => {
    process.env.HOME = root; process.env.USERPROFILE = root; process.env.CODEX_HOME = join(root, ".codex");
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        if (req.url?.includes("/models?")) { res.writeHead(200, { "content-type": "application/json" }).end('{"models":[]}'); return; }
        seen.push({ headers: req.headers, body: JSON.parse(raw) });
        res.writeHead(200, { "content-type": "text/event-stream" }).end('data: {"type":"response.completed","response":{"output":[]}}\n\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.IMA2_CODEX_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/backend-api/codex`;
    transport = await import("../lib/codexBackend/index.ts");
    client = await import("../lib/codexBackend/client.js");
    const { createCodexSessionStore } = await import("../lib/codexBackend/session.ts");
    const { chatgptAuthFilePath } = await import("../lib/chatgptAuth.ts");
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const token = `${encode({ alg: "none" })}.${encode({ exp: 2_000_000_000, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })}.sig`;
    writeFileSync(chatgptAuthFilePath(root), JSON.stringify({ tokens: { access_token: token, refresh_token: "rt", account_id: "acct-1" } }));
    transport.setCodexSessionStoreForTests(createCodexSessionStore({ configDir: root, refresher: async () => ({}) }));
  });
  after(async () => {
    transport?.setCodexSessionStoreForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    for (const [key, value] of Object.entries({ HOME: oldHome, USERPROFILE: oldProfile, CODEX_HOME: oldCodex, IMA2_CODEX_BASE_URL: oldUrl })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  test("5 OAuth upstream effort", async () => {
    seen = [];
    const response = await transport.codexFetch("/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-6.2-sol", input: "draw", reasoning: { effort: "none" }, stream: true }) });
    await response.text();
    assert.equal(seen[0]?.body.reasoning?.effort, "low");
  });
  test("5 OAuth upstream lite header", async () => {
    seen = [];
    const response = await transport.codexFetch("/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-6.2-sol", input: "draw", stream: true }) });
    await response.text();
    assert.equal(seen[0]?.headers["x-openai-internal-codex-responses-lite"], "true");
  });
  for (const model of ["gpt-6.1-terra", "gpt-6.2-astra"]) test(`6 lite fallback ${model}`, async () => assert.equal(await client.isLiteModel(model), true));
  test("6 client version floor", () => assert.ok(client.CODEX_CLIENT_VERSION_FLOOR.localeCompare("0.166.0", undefined, { numeric: true }) >= 0, `floor ${client.CODEX_CLIENT_VERSION_FLOOR} must be >= 0.166.0`));
  for (const [model, effort] of [["gpt-6.1-terra", "none"], ["gpt-6.2-astra", "low"]]) {
    test(`OAuth ${model} effort`, async () => {
      seen = [];
      const response = await transport.codexFetch("/v1/responses", { method: "POST", body: JSON.stringify({ model, input: "draw", reasoning: { effort: "none" }, stream: true }) });
      await response.text();
      assert.equal(seen[0]?.body.model, model);
      assert.equal(seen[0]?.body.reasoning?.effort, effort);
    });
  }
});
