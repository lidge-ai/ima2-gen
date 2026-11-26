import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "ima2-media-contract-"));
test.after(() => rm(root, { recursive: true, force: true }));
async function cli(base: string, args: string[], stdin = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "media", ...args, "--server", base], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, NO_COLOR: "1", HOME: root, USERPROFILE: root,
      IMA2_CONFIG_DIR: root, IMA2_GENERATED_DIR: root, IMA2_ADVERTISE_FILE: join(root, "absent") },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
  child.stdin.end(stdin);
  const timer = setTimeout(() => child.kill(), 10000);
  const [code] = await once(child, "close"); clearTimeout(timer);
  return { code, stdout, stderr };
}
async function fixture(run: (base: string, calls: { url: string; method: string; body: string }[]) => Promise<void>) {
  const calls: { url: string; method: string; body: string }[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const url = req.url ?? "", body = Buffer.concat(chunks).toString();
    calls.push({ url, method: req.method ?? "", body });
    res.setHeader("Content-Type", "application/json");
    if (url === "/api/health") return void res.end('{"ok":true}');
    if (url === "/api/media/catalog") return void res.end(JSON.stringify({ adapters: [], models: [
      { id: "v/a", vendor: "v", kind: "image", tasks: ["generate"], routes: [{ adapter: "direct", hasKey: true, pricing: [{ usd: 0.1 }] }] },
      { id: "x/b", vendor: "x", kind: "image", tasks: ["edit"], routes: [{ adapter: "other", hasKey: false, pricing: [{ usd: 1 }] }] }] }));
    if (url === "/api/media/estimate") return void res.end(body);
    if (url === "/api/media/tools") return void res.end(JSON.stringify({ tools: Array.from({ length: 14 }, (_, i) => ({ name: `tool${i}` })) }));
    if (url === "/api/keys/vocabulary") return void res.end(JSON.stringify({ vocabularies: [{ vocabulary: "fake", extraFields: [{ name: "secret", secret: true }] }] }));
    if (url === "/api/keys/fake/validate") return void res.end(body);
    if (url === "/api/keys/fake") return void res.end('{"ok":true}');
    if (url === "/api/workflows/demo/schema") return void res.end('{"type":"object","properties":{"prompt":{"type":"string"}}}');
    if (url === "/api/studios") return void res.end('{"studios":[],"defaultUi":"web"}');
    if (url.startsWith("/api/media/jobs/")) { res.statusCode = 404; return void res.end('{"code":"MEDIA_JOB_UNKNOWN","error":"missing"}'); }
    if (url.startsWith("/api/history")) return void res.end('{"items":[]}');
    res.statusCode = 404; res.end('{}');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, calls); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("catalog filters and estimate use the shared API", async () => fixture(async (base, calls) => {
  const filtered = await cli(base, ["models", "--vendor", "v", "--task", "generate", "--adapter", "direct", "--keyed", "--max-usd", "0.2", "--json"]);
  assert.equal(filtered.code, 0, filtered.stderr); assert.deepEqual(JSON.parse(filtered.stdout).models.map((m: { id: string }) => m.id), ["v/a"]);
  const estimate = await cli(base, ["estimate", "--model", "v/a", "--task", "generate", "--price-variant", "large", "--json"]);
  assert.equal(estimate.code, 0, estimate.stderr);
  assert.equal(JSON.parse(calls.find((call) => call.url === "/api/media/estimate")!.body).priceVariant, "large");
}));
test("keys reject argv secrets and redact validation response", async () => fixture(async (base, calls) => {
  const bad = await cli(base, ["keys", "set", "fake", "--key-stdin", "--extra", "secret=wrong"], "short");
  assert.match(bad.stderr, /MEDIA_SECRET_ON_ARGV/); assert.equal(calls.filter((c) => c.url === "/api/keys/fake").length, 0);
  const valid = await cli(base, ["keys", "validate", "fake", "--stdin-json", "--json"], '{"apiKey":"abc","extra":{"secret":"xyz"}}');
  assert.equal(valid.code, 0, valid.stderr); assert.doesNotMatch(valid.stdout + valid.stderr, /abc|xyz/);
  const no = await cli(base, ["keys", "delete", "fake"]); assert.match(no.stderr, /MEDIA_CONFIRM_REQUIRED/);
  const yes = await cli(base, ["keys", "delete", "fake", "--yes"]); assert.equal(yes.code, 0, yes.stderr);
  assert.equal(calls.filter((c) => c.url === "/api/keys/fake" && c.method === "DELETE").length, 1);
}));
test("schema, tools and unknown studio", async () => fixture(async (base) => {
  const schema = await cli(base, ["workflow", "demo", "--schema", "--json"]);
  assert.equal(schema.code, 0, schema.stderr); assert.equal(JSON.parse(schema.stdout).type, "object");
  const tools = await cli(base, ["tools", "--json"]); assert.equal(tools.code, 0, tools.stderr); assert.equal(JSON.parse(tools.stdout).tools.length, 14);
  const unknown = await cli(base, ["studio", "open", "nope"]); assert.match(unknown.stderr, /STUDIO_UNKNOWN/);
}));
