import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const root = await mkdtemp(join(tmpdir(), "ima2-cli-media-"));
process.env.IMA2_CONFIG_DIR = root;
test.after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
async function cli(base: string, args: string[], stdin = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "media", ...args, "--server", base], {
    env: { ...process.env, IMA2_CONFIG_DIR: root, IMA2_GENERATED_DIR: root, NO_COLOR: "1" },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
  child.stdin.end(stdin);
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}
async function fixture(run: (base: string, calls: { url: string; body: string; type: string }[]) => Promise<void>) {
  const calls: { url: string; body: string; type: string }[] = [];
  let stream: ServerResponse | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const url = req.url ?? "";
    calls.push({ url, body, type: String(req.headers["content-type"] ?? "") });
    if (url === "/api/health") { res.end('{"ok":true}'); return; }
    if (url === "/api/events") { stream = res; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return; }
    res.setHeader("Content-Type", "application/json");
    if (url === "/api/media/inputs") { res.statusCode = 201; res.end('{"ref":"input:fake.png"}'); return; }
    if (url === "/api/media") {
      const data = JSON.parse(body) as { requestId: string; model: string };
      if (data.model === "bad") { res.statusCode = 400; res.end('{"code":"BAD","error":"wrong","category":"invalid"}'); return; }
      res.statusCode = 202; res.end(JSON.stringify({ requestId: data.requestId }));
      stream?.write(`event: done\ndata: ${JSON.stringify({ jobId: "unrelated", outputs: [] })}\n\n`);
      stream?.write(`event: done\ndata: ${JSON.stringify({ jobId: data.requestId, outputs: [{ filename: "result.png" }] })}\n\n`);
      return;
    }
    if (url === "/api/workflows") { res.end(JSON.stringify({ workflows: [{ id: "demo", fields: [{ name: "image", type: "media", accept: "image" }, { name: "count", type: "integer" }, { name: "enabled", type: "boolean" }, { name: "palette", type: "colors" }] }] })); return; }
    if (url === "/api/workflows/demo/estimate") { res.end('{"estimate":{"usd":0.2,"complete":true,"steps":[]},"steps":[]}'); return; }
    if (url === "/api/workflows/demo") {
      const data = JSON.parse(body) as { requestId: string };
      res.statusCode = 202; res.end(JSON.stringify({ requestId: data.requestId }));
      stream?.write(`event: done\ndata: ${JSON.stringify({ jobId: data.requestId, outputs: [{ filename: "result.png" }] })}\n\n`); return;
    }
    if (url === "/api/keys/fake") { res.statusCode = 400; res.end(JSON.stringify({ code: "KEY_BAD", error: `bad ${JSON.parse(body).apiKey}` })); return; }
    if (url === "/generated/result.png") { res.end("saved"); return; }
    if (url === "/api/media/catalog?kind=video") { res.end(JSON.stringify({ models: [{ id: "vendor/a", kind: "video", vendor: "vendor", routes: [{ adapter: "direct", route: "direct", hasKey: true, pricing: [{ usd: 0.2, unit: "second", variant: "720p" }] }] }] })); return; }
    res.statusCode = 404; res.end('{}');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`, calls); } finally { stream?.destroy(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("models display routes and price", async () => fixture(async (base) => {
  const result = await cli(base, ["models", "--kind", "video"]);
  assert.equal(result.code, 0); assert.match(result.stdout, /vendor\/a.*video.*vendor/); assert.match(result.stdout, /key:yes.*\$0.2\/second \(720p\)/);
}));
test("run uploads input, submits parsed options and waits for matching SSE", async () => fixture(async (base, calls) => {
  const image = join(root, "input.png"); await writeFile(image, "image-data");
  const target = join(root, "out");
  const result = await cli(base, ["run", "--model", "vendor/a", "--task", "image-to-video", "--input", `first-frame=${image}`, "--input", "reference-image=https://example.test/a.png", "--duration", "5", "--no-audio", "--vendor-option", "foo=bar", "--out", target, "--json"]);
  assert.equal(result.code, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).paths, [join(target, "result.png")]);
  assert.equal(await readFile(join(target, "result.png"), "utf8"), "saved");
  const upload = calls.find((c) => c.url === "/api/media/inputs"); assert.equal(upload?.type, "image/png"); assert.equal(upload?.body, "image-data");
  const body = JSON.parse(calls.find((c) => c.url === "/api/media")!.body);
  assert.deepEqual(body.inputs, [{ role: "first-frame", ref: "input:fake.png" }, { role: "reference-image", url: "https://example.test/a.png" }]);
  assert.equal(body.durationSec, 5); assert.equal(body.audio, false); assert.deepEqual(body.vendorOptions, { foo: "bar" });
  assert.ok(calls.findIndex((c) => c.url === "/api/events") < calls.findIndex((c) => c.url === "/api/media"));
}));
test("server error retains code and category and exits nonzero", async () => fixture(async (base) => {
  const result = await cli(base, ["run", "--model", "bad", "--task", "text-to-video", "--json"]);
  assert.notEqual(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { ok: false, code: "BAD", error: "wrong", category: "invalid" });
}));
test("key from stdin is redacted even if server echoes it", async () => fixture(async (base, calls) => {
  const secret = "fake-stdin-secret";
  const result = await cli(base, ["keys", "set", "fake", "--key-stdin", "--json"], secret);
  assert.notEqual(result.code, 0); assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  assert.equal(JSON.parse(calls.find((c) => c.url === "/api/keys/fake")!.body).apiKey, secret);
}));

test("workflow estimate converts typed and uploaded inputs; run waits for completion", async () => fixture(async (base, calls) => {
  const image = join(root, "workflow.png"); await writeFile(image, "pixels");
  const flags = ["workflow", "demo", "--input", `image=${image}`, "--input", "count=3", "--input", "enabled=false", "--input", "palette=#112233,#445566", "--json"];
  const estimate = await cli(base, [...flags, "--estimate"]);
  assert.equal(estimate.code, 0, estimate.stderr);
  assert.deepEqual(JSON.parse(calls.find((c) => c.url === "/api/workflows/demo/estimate")!.body).values,
    { image: [{ ref: "input:fake.png" }], count: 3, enabled: false, palette: ["#112233", "#445566"] });
  const run = await cli(base, flags);
  assert.equal(run.code, 0, run.stderr); assert.equal(JSON.parse(run.stdout).paths[0], join(root, "result.png"));
}));
