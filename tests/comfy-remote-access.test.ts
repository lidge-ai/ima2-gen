import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import express from "express";

import { config } from "../config.js";
import { ComfyAccess, deleteComfyRemote, normalizeRemoteOrigin, putComfyRemote } from "../lib/comfy/access.ts";
import { generateViaComfy, probeComfyOrigins, type ComfyQueueInfo } from "../lib/comfyImageAdapter.ts";
import { putWorkflow } from "../lib/comfyWorkflowStore.ts";
import { registerComfyRoutes } from "../routes/comfy.ts";
import { startFakeComfy, type FakeComfy, type FakeComfyOptions } from "./_fakeComfyServer.ts";

const TOKEN = "proxy-token-123456";
const REMOTE = "https://comfy.example.com";
const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 1, positive: ["6", 0] } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ima2", images: ["3", 0] } },
};
const BIND = { prompt: { node: "6", input: "text" }, output: { node: "9" } };

const original = { configDir: config.storage.configDir, configFile: config.storage.configFile };
const cleanup: Array<() => Promise<void>> = [];

/** A private config dir and file, so the allow list under test is never the developer's own. */
async function scratchConfig(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-access-"));
  const storage = config.storage as { configDir: string; configFile: string };
  storage.configDir = dir;
  storage.configFile = join(dir, "config.json");
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return storage.configFile;
}

async function fakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
  const fake = await startFakeComfy(options);
  cleanup.push(() => fake.close());
  return fake;
}

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
  Object.assign(config.storage, original);
});

function ctx(): any {
  return { config: { ...config, comfy: { ...config.comfy, pollIntervalMs: 10, generationTimeoutMs: 5_000, healthTimeoutMs: 500 } } };
}

async function withRoutes<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerComfyRoutes(app, { config } as never);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    return await fn("http://127.0.0.1:" + String(port));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("comfy server allow list", () => {
  it("accepts loopback without an entry and nothing else", async () => {
    const access = await ComfyAccess.load(await scratchConfig());
    assert.equal(access.target("http://127.0.0.1:8188").origin, "http://127.0.0.1:8188");
    for (const address of [REMOTE, "http://192.168.0.20:8188", "http://169.254.169.254", "http://example.com:8188"]) {
      assert.throws(() => access.target(address), (e: any) => e?.code === "COMFY_URL_NOT_LOCAL", address);
    }
  });

  it("matches an added server by exact origin only", async () => {
    const file = await scratchConfig();
    await putComfyRemote(file, { origin: REMOTE + "/", token: TOKEN });
    const access = await ComfyAccess.load(file);
    const target = access.target(REMOTE);
    assert.deepEqual(target.headers, { Authorization: "Bearer " + TOKEN });
    for (const near of ["http://comfy.example.com", REMOTE + ":8443", "https://comfy.example.com.evil.test", "https://sub.comfy.example.com"]) {
      assert.throws(() => access.target(near), (e: any) => e?.code === "COMFY_URL_NOT_LOCAL", near);
    }
  });

  it("refuses addresses that are not a bare origin", () => {
    for (const bad of ["", "comfy.example.com", "ftp://comfy.example.com", "https://user:pw@comfy.example.com", "https://comfy.example.com/api", "https://comfy.example.com/?x=1"]) {
      assert.throws(() => normalizeRemoteOrigin(bad), (e: any) => e?.code === "COMFY_REMOTE_ORIGIN_INVALID", bad);
    }
  });

  it("stores the token in the owner-only config file and keeps it on re-save without one", async () => {
    const file = await scratchConfig();
    await putComfyRemote(file, { origin: REMOTE, token: TOKEN });
    await putComfyRemote(file, { origin: REMOTE });
    assert.deepEqual((await ComfyAccess.load(file)).list(), [{ origin: REMOTE, hasToken: true, insecure: false }]);
    assert.equal(JSON.parse(await readFile(file, "utf8")).comfyRemotes[REMOTE].token, TOKEN);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    await putComfyRemote(file, { origin: REMOTE, clearToken: true });
    assert.equal((await ComfyAccess.load(file)).list()[0]!.hasToken, false);
    assert.equal(await deleteComfyRemote(file, REMOTE), true);
    assert.equal(await deleteComfyRemote(file, REMOTE), false);
  });

  it("flags plain http to another machine and rejects a token that is not one header value", async () => {
    const file = await scratchConfig();
    assert.equal((await putComfyRemote(file, { origin: "http://192.168.0.20:8188" })).insecure, true);
    await assert.rejects(
      () => putComfyRemote(file, { origin: REMOTE, token: "a\r\nX-Injected: 1" }),
      (e: any) => e?.code === "COMFY_REMOTE_TOKEN_INVALID",
    );
  });
});

describe("comfy remote routes", () => {
  it("never return a token, in any response", async () => {
    await scratchConfig();
    // A loopback fixture that demands the token, so the probe really sends it.
    const fake = await fakeComfy({ token: TOKEN });
    await withRoutes(async (base) => {
      const put = await fetch(base + "/api/comfy/remotes", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: fake.origin, token: TOKEN }),
      });
      const putText = await put.text();
      assert.equal(put.status, 200);
      assert.deepEqual(JSON.parse(putText), { ok: true, remote: { origin: fake.origin, hasToken: true, insecure: false } });
      const listText = await (await fetch(base + "/api/comfy/remotes")).text();
      const probe = await fetch(base + "/api/comfy/probe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: fake.origin }),
      });
      const probeText = await probe.text();
      assert.deepEqual(JSON.parse(probeText).health, { ok: true, version: "0.46.0" }, "the probe was authorized by the saved token");
      for (const body of [putText, listText, probeText]) assert.ok(!body.includes(TOKEN), "token leaked: " + body);
    });
  });

  it("refuse a workflow on a server that was not added, and accept it once it is", async () => {
    await scratchConfig();
    await withRoutes(async (base) => {
      const register = () => fetch(base + "/api/comfy/workflows", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "remote-wf", origin: REMOTE, graph: GRAPH, bind: BIND }),
      });
      const refused = await register();
      assert.equal(refused.status, 400);
      assert.equal((await refused.json()).error.code, "COMFY_URL_NOT_LOCAL");
      await fetch(base + "/api/comfy/remotes", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin: REMOTE }),
      });
      const accepted = await register();
      assert.equal(accepted.status, 200);
      assert.equal((await accepted.json()).workflow.origin, REMOTE);
      const removed = await fetch(base + "/api/comfy/remotes?origin=" + encodeURIComponent(REMOTE), { method: "DELETE" });
      assert.deepEqual(await removed.json(), { ok: true, origin: REMOTE, strandedWorkflows: ["remote-wf"] });
    });
  });
});

describe("comfy jobs against a real socket", () => {
  const events = (promptId: string) => [
    { type: "execution_start", data: { prompt_id: promptId } },
    { type: "execution_cached", data: { prompt_id: promptId, nodes: ["6"] } },
    { type: "executing", data: { prompt_id: promptId, node: "3" } },
    { type: "progress", data: { prompt_id: promptId, node: "3", value: 1, max: 2 } },
    { type: "progress_state", data: { prompt_id: promptId, nodes: { "3": { value: 1, max: 2, state: "running" } } } },
    { type: "progress", data: { prompt_id: "another-users-job", node: "3", value: 2, max: 2 } },
  ];

  it("reports node and step progress while it waits, then returns the image", async () => {
    await scratchConfig();
    const fake = await fakeComfy({ events });
    await putWorkflow({ id: "wf", label: "WF", origin: fake.origin, graph: GRAPH, bind: BIND, params: [] } as never);
    const seen: ComfyQueueInfo[] = [];
    const result = await generateViaComfy("a red fox", ctx(), { model: "wf", onQueue: (info) => seen.push(info) });
    assert.equal(result.mime, "image/png");
    const submitted = fake.prompts[0]!;
    assert.equal(result.promptId, submitted.promptId);
    assert.equal(fake.sockets[0]?.clientId, submitted.clientId, "the socket and the job share one client id");
    assert.match(String(submitted.clientId), /^ima2-[0-9a-f-]{36}$/);
    const live = seen.filter((info) => info.nodeType === "KSampler");
    assert.ok(live.some((info) => info.fraction === 0.5), "graph fraction: " + JSON.stringify(seen));
    assert.ok(live.some((info) => info.step?.value === 1 && info.step.max === 2), "sampler step");
    assert.ok(!seen.some((info) => info.step?.value === 2), "another job's progress is not ours");
  });

  it("sends the saved token on every request and on the socket, and stops when the server leaves the list", async () => {
    const file = await scratchConfig();
    const fake = await fakeComfy({ token: TOKEN, events });
    // The fixture is loopback, so the entry here only supplies the token.
    await putComfyRemote(file, { origin: fake.origin, token: TOKEN });
    await putWorkflow({ id: "wf", label: "WF", origin: fake.origin, graph: GRAPH, bind: BIND, params: [] } as never);
    await generateViaComfy("a red fox", ctx(), { model: "wf" });
    assert.ok(fake.requests.length >= 3);
    for (const request of fake.requests) assert.equal(request.authorization, "Bearer " + TOKEN, request.path);
    assert.equal(fake.sockets[0]?.authorization, "Bearer " + TOKEN);
    const health = await probeComfyOrigins([fake.origin], 500, undefined, await ComfyAccess.load(file));
    assert.deepEqual(health.get(fake.origin), { ok: true, version: "0.46.0" });
  });

  it("refuses to run a workflow whose server is no longer allowed, without contacting it", async () => {
    const file = await scratchConfig();
    await putComfyRemote(file, { origin: REMOTE });
    await putWorkflow({ id: "wf", label: "WF", origin: REMOTE, graph: GRAPH, bind: BIND, params: [] } as never);
    await deleteComfyRemote(file, REMOTE);
    const calls: string[] = [];
    const fetchImpl = (async (input: any) => { calls.push(String(input)); throw new Error("must not be called"); }) as typeof fetch;
    await assert.rejects(
      () => generateViaComfy("x", ctx(), { model: "wf", fetchImpl }),
      (e: any) => e?.code === "COMFY_ORIGIN_NOT_ALLOWED" && e?.status === 400,
    );
    assert.deepEqual(calls, []);
    const health = await probeComfyOrigins([REMOTE], 500, fetchImpl, await ComfyAccess.load(file));
    assert.deepEqual(health.get(REMOTE), { ok: false, reason: "not an allowed ComfyUI server" });
    assert.deepEqual(calls, []);
  });

  it("cancels the job on the server through the jobs endpoint when the caller aborts", async () => {
    await scratchConfig();
    const fake = await fakeComfy({ hold: true, events });
    await putWorkflow({ id: "wf", label: "WF", origin: fake.origin, graph: GRAPH, bind: BIND, params: [] } as never);
    const controller = new AbortController();
    await assert.rejects(
      () => generateViaComfy("x", ctx(), {
        model: "wf", signal: controller.signal,
        onQueue: (info) => { if (info.nodeType) controller.abort(); },
      }),
      (e: any) => e?.code === "GENERATION_CANCELED",
    );
    assert.deepEqual(fake.canceledBy, ["jobs"]);
  });

  it("still finishes when the progress socket is refused", async () => {
    await scratchConfig();
    const fake = await fakeComfy({ events });
    await putWorkflow({ id: "wf", label: "WF", origin: fake.origin, graph: GRAPH, bind: BIND, params: [] } as never);
    const result = await generateViaComfy("x", ctx(), {
      model: "wf",
      openSocket: (_url, _headers, handlers) => { queueMicrotask(() => handlers.onClose()); return { close() {} }; },
    });
    assert.equal(result.mime, "image/png");
  });

  it("turns a missing model into a sentence a person can act on", async () => {
    await scratchConfig();
    const fake = await fakeComfy({ reject: { status: 400, body: {
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
      node_errors: { "4": { class_type: "UNETLoader", errors: [{ type: "value_not_in_list", extra_info: { input_name: "unet_name", received_value: "flux-2-klein-4b.safetensors" } }] } },
    } } });
    await putWorkflow({ id: "wf", label: "WF", origin: fake.origin, graph: GRAPH, bind: BIND, params: [] } as never);
    await assert.rejects(
      () => generateViaComfy("x", ctx(), { model: "wf" }),
      (e: any) => e?.code === "COMFY_SUBMIT_REJECTED" && e?.status === 400
        && e.message === "ComfyUI rejected the workflow: node 4 (UNETLoader) unet_name: model file 'flux-2-klein-4b.safetensors' is not on this ComfyUI server",
    );
  });
});
