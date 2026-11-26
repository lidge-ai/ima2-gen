import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "ima2-media-contract-"));
for (const name of ["open", "xdg-open", "explorer"]) {
  const path = join(root, name); await writeFile(path, "#!/bin/sh\nexit 0\n"); await chmod(path, 0o755);
}
test.after(() => rm(root, { recursive: true, force: true }));
async function cli(base: string, args: string[], stdin = "") {
  const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "media", ...args, "--server", base], {
    env: { PATH: `${root}:${process.env.PATH}`, TMPDIR: process.env.TMPDIR, NO_COLOR: "1", HOME: root, USERPROFILE: root,
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
  let stream: ServerResponse | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const url = req.url ?? "", body = Buffer.concat(chunks).toString();
    calls.push({ url, method: req.method ?? "", body });
    if (url === "/api/events") { stream = res; res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return; }
    res.setHeader("Content-Type", "application/json");
    if (url === "/api/media") {
      const data = JSON.parse(body) as { requestId: string; model: string };
      res.end(JSON.stringify({ requestId: data.requestId }));
      const error = data.model.startsWith("error-");
      stream?.write(`event: ${error ? "error" : "running"}\ndata: ${JSON.stringify(error ? { jobId: data.requestId, code: data.model.slice(6), error: "failed", category: "auth" } : { jobId: data.requestId, progress: 42 })}\n\n`);
      if (!error) stream?.write(`event: done\ndata: ${JSON.stringify({ jobId: data.requestId, outputs: [{ filename: "result.png" }], elapsed: 1.2 })}\n\n`);
      return;
    }
    if (url === "/api/media/jobs/used") return void res.end('{"status":"completed"}');
    if (url === "/api/media/jobs/running") return void res.end('{"status":"running"}');
    if (url.startsWith("/api/history") && url.includes("requestId=result")) return void res.end('{"items":[{"filename":"result.png"}]}');
    if (url === "/generated/result.png") return void res.end("saved");
    if (url === "/api/workflows") return void res.end('{"workflows":[{"id":"demo","fields":[{"name":"prompt","type":"string","help":"Describe it"}]}]}');
    if (url === "/api/workflows/demo" || url === "/api/workflows/demo/estimate") return void res.end(body);
    if (url === "/api/studios/default") return void res.end(body);
    if (url === "/api/health") return void res.end('{"ok":true}');
    if (url === "/api/media/catalog") return void res.end(JSON.stringify({ adapters: [], models: [
      { id: "v/a", vendor: "v", kind: "image", tasks: ["generate"], routes: [{ adapter: "direct", hasKey: true, pricing: [{ usd: 0.1 }] }] },
      { id: "x/b", vendor: "x", kind: "image", tasks: ["edit"], routes: [{ adapter: "other", hasKey: false, pricing: [{ usd: 1 }] }] }] }));
    if (url === "/api/media/estimate") return void res.end(body);
    if (url === "/api/media/tools") return void res.end(JSON.stringify({ tools: Array.from({ length: 14 }, (_, i) => ({ name: `tool${i}` })) }));
    if (url === "/api/keys/broken/validate") return void res.end('{}');
    if (url === "/api/keys/vocabulary" && req.headers["x-never"]) { res.statusCode = 500; return void res.end('{}'); }
    if (url === "/api/keys/vocabulary") return void res.end(JSON.stringify({ vocabularies: [{ vocabulary: "fake", extraFields: [{ name: "secret", secret: true }] }] }));
    if (url === "/api/keys/fake/validate") {
      const parsed = JSON.parse(body) as { extra?: { secret?: string } };
      if (parsed.extra?.secret && parsed.extra.secret.length < 6) { res.statusCode = 400; return void res.end('{"code":"KEY_TOO_SHORT","error":"too short"}'); }
      return void res.end(body);
    }
    if (url === "/api/keys/fake") return void res.end('{"ok":true}');
    if (url === "/api/workflows/demo/schema") return void res.end('{"id":"demo","label":"Demo","schema":{"type":"object","properties":{"prompt":{"type":"string","maxLength":100}},"required":["prompt"]}}');
    if (url === "/api/studios") return void res.end('{"studios":[{"name":"demo","built":true,"url":"/studio/demo/"}],"defaultUi":"web"}');
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
  for (const [flag, value] of [["--vendor", "missing"], ["--task", "missing"], ["--model", "missing"], ["--adapter", "missing"], ["--max-usd", "0.01"]]) {
    const absent = await cli(base, ["models", flag!, value!, "--json"]); assert.equal(absent.code, 0, absent.stderr); assert.deepEqual(JSON.parse(absent.stdout).models, []);
  }
  const estimate = await cli(base, ["estimate", "--model", "v/a", "--task", "generate", "--price-variant", "large", "--json"]);
  assert.equal(estimate.code, 0, estimate.stderr);
  assert.equal(JSON.parse(calls.find((call) => call.url === "/api/media/estimate")!.body).priceVariant, "large");
}));
test("keys reject argv secrets and redact validation response", async () => fixture(async (base, calls) => {
  const bad = await cli(base, ["keys", "set", "fake", "--key-stdin", "--extra", "secret=wrong"], "short");
  assert.match(bad.stderr, /MEDIA_SECRET_ON_ARGV/); assert.equal(calls.filter((c) => c.url === "/api/keys/fake").length, 0);
  const valid = await cli(base, ["keys", "validate", "fake", "--stdin-json", "--json"], '{"apiKey":"abcdef","extra":{"secret":"ghijkl"}}');
  assert.equal(valid.code, 0, valid.stderr); assert.doesNotMatch(valid.stdout + valid.stderr, /abcdef|ghijkl/);
  const no = await cli(base, ["keys", "delete", "fake"]); assert.match(no.stderr, /MEDIA_CONFIRM_REQUIRED/);
  const yes = await cli(base, ["keys", "delete", "fake", "--yes"]); assert.equal(yes.code, 0, yes.stderr);
  assert.equal(calls.filter((c) => c.url === "/api/keys/fake" && c.method === "DELETE").length, 1);
}));
test("schema, tools and unknown studio", async () => fixture(async (base) => {
  const schema = await cli(base, ["workflow", "demo", "--schema", "--json"]);
  assert.equal(schema.code, 0, schema.stderr); assert.equal(JSON.parse(schema.stdout).schema.type, "object");
  const human = await cli(base, ["workflow", "demo", "--schema"]); assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /prompt.*string.*yes.*100.*Describe it/);
  const tools = await cli(base, ["tools", "--json"]); assert.equal(tools.code, 0, tools.stderr); assert.equal(JSON.parse(tools.stdout).tools.length, 14);
  const unknown = await cli(base, ["studio", "open", "nope"]); assert.match(unknown.stderr, /STUDIO_UNKNOWN/);
}));


test("run progress, SSE error bytes, id reuse and vendor option merge", async () => fixture(async (base, calls) => {
  const run = await cli(base, ["run", "--model", "v/a", "--task", "generate", "--vendor-json", '{"x":"old","y":1}', "--vendor-option", "x=new"]);
  assert.equal(run.code, 0, run.stderr); assert.equal(run.stdout, `${join(root, "result.png")}\n`); assert.match(run.stderr, /running/); assert.match(run.stderr, /done in 1.2s/);
  assert.deepEqual(JSON.parse(calls.find((c) => c.url === "/api/media")!.body).vendorOptions, { x: "new", y: 1 });
  for (const code of ["MEDIA_KEY_MISSING", "CREDIT", "MODERATION", "MEDIA_ROUTE_UNKNOWN"]) {
    const failure = await cli(base, ["run", "--model", `error-${code}`, "--task", "generate"]);
    assert.equal(failure.stderr, `${code}: failed (auth)\n`);
  }
  const before = calls.filter((c) => c.url === "/api/media").length;
  const used = await cli(base, ["run", "--model", "v/a", "--task", "generate", "--request-id", "used"]);
  assert.match(used.stderr, /REQUEST_ID_IN_USE/); assert.equal(calls.filter((c) => c.url === "/api/media").length, before);
}));
test("status, timed wait, result and output download", async () => fixture(async (base) => {
  const status = await cli(base, ["status", "running", "--json"]); assert.equal(status.code, 0, status.stderr);
  const wait = await cli(base, ["wait", "running", "--timeout", "1", "--json"]); assert.equal(wait.code, 0, wait.stderr); assert.equal(JSON.parse(wait.stdout).timedOut, true);
  const result = await cli(base, ["result", "result", "--out", join(root, "saved"), "--json"]); assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).paths, [join(root, "saved", "result.png")]);
}));
test("keys preserve short set, reject short validate and reject secret extra for both actions", async () => fixture(async (base, calls) => {
  const set = await cli(base, ["keys", "set", "fake", "--key-stdin"], "abc"); assert.equal(set.code, 0, set.stderr);
  assert.equal(JSON.parse(calls.find((c) => c.url === "/api/keys/fake" && c.method === "PUT")!.body).apiKey, "abc");
  const short = await cli(base, ["keys", "validate", "fake", "--key-stdin"], "abcde"); assert.match(short.stderr, /KEY_TOO_SHORT/);
  const before = calls.filter((c) => c.url === "/api/keys/fake/validate").length;
  const secret = await cli(base, ["keys", "validate", "fake", "--extra", "secret=123456"]); assert.match(secret.stderr, /MEDIA_SECRET_ON_ARGV/);
  assert.equal(calls.filter((c) => c.url === "/api/keys/fake/validate").length, before);
  const collision = await cli(base, ["keys", "validate", "fake", "--key-stdin", "--json"], "redact"); assert.doesNotMatch(collision.stdout + collision.stderr, /redact/);
}));
test("workflow selections, studios and invalid flag safety", async () => fixture(async (base, calls) => {
  const wf = await cli(base, ["workflow", "demo", "--estimate", "--slot-model", "one=v/a", "--slot-route", "one=direct", "--json"]);
  assert.equal(wf.code, 0, wf.stderr); const body = JSON.parse(calls.find((c) => c.url === "/api/workflows/demo/estimate")!.body);
  assert.match(JSON.stringify(body.selection), /v\/a/); assert.match(JSON.stringify(body.selection), /direct/);
  const studios = await cli(base, ["studios", "--json"]); assert.equal(studios.code, 0, studios.stderr);
  const def = await cli(base, ["studio", "default", "classic", "--json"]); assert.equal(def.code, 0, def.stderr);
  const before = calls.length; const bad = await cli(base, ["keys", "delete", "fake", "--yes=false"]); assert.match(bad.stderr, /MEDIA_CLI_ERROR/); assert.equal(calls.length, before);
  const badFlag = await cli(base, ["models", "--quiet"]); assert.match(badFlag.stderr, /MEDIA_CLI_ERROR/); assert.equal(calls.length, before);
}));


test("waitUntil slices until terminal state or its absolute deadline", async () => {
  const { waitUntil } = await import("../bin/lib/media/jobCmd.js");
  let statusCalls = 0;
  const server = createServer((req, res) => {
    if (req.url === "/api/events") { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); return; }
    statusCalls++; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ status: statusCalls >= 3 ? "completed" : "running" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const value = await waitUntil(`http://127.0.0.1:${address.port}`, "id", { deadlineMs: Date.now() + 1000, sliceMs: 20 });
    assert.equal(value.pollAfterSeconds, 0); assert.ok(statusCalls >= 3);
    const alreadyDone = await waitUntil(`http://127.0.0.1:${address.port}`, "id", { deadlineMs: Date.now() + 1000, sliceMs: 20 });
    assert.equal(alreadyDone.pollAfterSeconds, 0);
    statusCalls = -100;
    const timeout = await waitUntil(`http://127.0.0.1:${address.port}`, "id", { deadlineMs: Date.now() + 60, sliceMs: 20 });
    assert.equal(timeout.timedOut, true);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});


test("validateKey scrubs echoed success and overlapping secrets", async () => fixture(async (base) => {
  const { validateKey } = await import("../bin/lib/mediaApi.js");
  const result = await validateKey(base, "fake", { apiKey: "redact", extra: { secret: "abcdef", other: "cdefgh" } });
  const text = JSON.stringify(result); for (const secret of ["redact", "abcdef", "cdefgh"]) assert.ok(!text.includes(secret), text);
}));
test("flags are scoped, short secrets are rejected, studio output and quiet mode", async () => fixture(async (base, calls) => {
  const before = calls.length;
  const wrong = await cli(base, ["status", "running", "--model", "v/a"]); assert.match(wrong.stderr, /MEDIA_CLI_ERROR/); assert.equal(calls.length, before);
  const short = await cli(base, ["keys", "validate", "fake", "--stdin-json"], '{"apiKey":"abcdef","extra":{"secret":"short"}}');
  assert.match(short.stderr, /KEY_TOO_SHORT/);
  const nonsecret = await cli(base, ["keys", "validate", "fake", "--stdin-json", "--json"], '{"apiKey":"abcdef","extra":{"region":"us"}}');
  assert.equal(nonsecret.code, 0, nonsecret.stderr);
  const studio = await cli(base, ["studio", "open", "demo"]); assert.equal(studio.code, 0, studio.stderr); assert.equal(studio.stdout, `${base}/studio/demo/\n`);
  const quiet = await cli(base, ["run", "--model", "v/a", "--task", "generate", "--quiet"]); assert.equal(quiet.code, 0, quiet.stderr); assert.equal(quiet.stderr, "");
}));
