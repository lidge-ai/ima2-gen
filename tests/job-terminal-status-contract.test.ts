// Terminal-status boundary (roadmap 050).
//
// The success vocabulary is split three ways: finishJob defaults to
// "completed", MCP commits write "done", and CLI recovery historically only
// accepted "done". Nothing typed or tested that seam, so a new MCP route
// calling finishJob(requestId) without a status would strand recovery.
//
// These tests drive the REAL producers (finishJob -> listTerminalJobs) and the
// REAL consumer (runMcpJob's replay-gap recovery), and they deliberately
// suppress the live terminal SSE event: commitMediaResult publishes one right
// after recording the snapshot, and a naive test would consume that instead of
// exercising recovery at all.
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTerminalStatus, isTerminalSuccess, TERMINAL_SUCCESS } from "../lib/jobStatus.ts";
import { McpJobError, runMcpJob, type McpJobOptions } from "../bin/lib/mcpJob.ts";

// Establish every storage path before any producer can import runtime config.
const testRoot = mkdtempSync(join(tmpdir(), "ima2-terminal-status-"));
const ownedEnv = {
  IMA2_CONFIG_DIR: testRoot, IMA2_DB_PATH: join(testRoot, "sessions.db"),
  IMA2_GENERATED_DIR: join(testRoot, "generated"), IMA2_TRASH_DIR: join(testRoot, "trash"),
  IMA2_GENERATION_REQUEST_LOG_FILE: join(testRoot, "requests.json"), IMA2_LOG_LEVEL: "silent",
};
const savedEnv = new Map(Object.keys(process.env).filter(key => key.startsWith("IMA2_"))
  .map(key => [key, process.env[key]]));
for (const key of savedEnv.keys()) delete process.env[key];
Object.assign(process.env, ownedEnv);
// A valid owned config also prevents fallback to package-local user config.
writeFileSync(join(testRoot, "config.json"), "{}");
let db: typeof import("../lib/db.ts") | undefined;
after(() => {
  db?.closeDb();
  for (const key of Object.keys(ownedEnv)) delete process.env[key];
  for (const [key, value] of savedEnv) process.env[key] = value;
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  assert.equal(existsSync(testRoot), false);
});
const { config } = await import("../config.ts");
assert.equal(config.storage.configDir, testRoot);
assert.equal(config.storage.dbPath, ownedEnv.IMA2_DB_PATH);
assert.equal(config.storage.generatedDir, ownedEnv.IMA2_GENERATED_DIR);
db = await import("../lib/db.ts");
const inflight = await import("../lib/inflight.ts");
const { finishJob, startJob, _resetForTests } = inflight;
let snapshotOwner = inflight;
const { commitMediaResult } = await import("../lib/mcp/commitMediaResult.ts");

describe("terminal status normalization", () => {
  it("collapses every success spelling that reaches the snapshot", () => {
    for (const spelling of ["done", "completed", "complete", "COMPLETED", " done "]) {
      assert.equal(normalizeTerminalStatus(spelling), "done", `${spelling} must count as success`);
      assert.equal(isTerminalSuccess(spelling), true);
    }
    assert.equal(TERMINAL_SUCCESS, "done");
  });

  it("keeps failure spellings out of the success bucket", () => {
    assert.equal(normalizeTerminalStatus("error"), "error");
    assert.equal(normalizeTerminalStatus("failed"), "error");
    assert.equal(normalizeTerminalStatus("canceled"), "canceled");
    assert.equal(normalizeTerminalStatus("cancelled"), "canceled");
    for (const spelling of ["error", "failed", "canceled"]) {
      assert.equal(isTerminalSuccess(spelling), false);
    }
  });

  it("refuses unknown values instead of guessing success", () => {
    for (const value of ["weird", "", null, undefined, 42, {}]) {
      assert.equal(normalizeTerminalStatus(value), "unknown");
      assert.equal(isTerminalSuccess(value), false);
    }
  });

});

// --- Integration: producer -> snapshot -> CLI recovery -------------------

type Client = ServerResponse;
const clients = new Set<Client>();
const reconnectCursors: string[] = [];
const requests: string[] = [];
const violations: unknown[] = [];
let serverBase = "";
let server: ReturnType<typeof createServer>;
// Each case registers what finishJob should record before the stream drops.
const pending = new Map<string, string | undefined | null>();
// Cases that must run through the real commitMediaResult instead of finishJob.
const commitCases = new Set<string>();
const expiryCases = new Set<string>();
let generatedDir = "";

function emit(res: Client, event: string, data: unknown, id: number) {
  res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Serves the same two endpoints runMcpJob uses. The SSE stream never emits a
// terminal event: it emits progress, then drops the connection, which is the
// replay gap that forces recovery through /api/inflight.
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    let text = "";
    for await (const chunk of req) text += String(chunk);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.flushHeaders();
      clients.add(res);
      res.on("close", () => clients.delete(res));
      if (url.searchParams.has("lastEventId")) {
        // This controlled gap forces the public consumer to read the real snapshot.
        reconnectCursors.push(String(url.searchParams.get("lastEventId")));
        res.write(`event: replay-gap\ndata: {"oldestAvailableId":99}\n\n`);
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/inflight" && url.search === "?includeTerminal=1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobs: snapshotOwner.listJobs(), terminalJobs: snapshotOwner.listTerminalJobs() }));
      return;
    }
    if (req.method === "POST" && ["/api/mcp/generate", "/api/mcp/media-action"].includes(url.pathname)) {
      const body = await readJson(req);
      const requestId = String(body.requestId ?? "");
      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accepted: true, requestId }));
      await finishAndDropStream(requestId, body.kind === "video" ? "video" : "image");
      return;
    }
    violations.push(`${req.method} ${req.url}`);
    res.writeHead(404).end();
  } catch (error) {
    violations.push(error);
    res.destroy();
    for (const client of clients) client.end();
  }
}

function opts(requestId: string): McpJobOptions {
  return {
    serverBase,
    kind: "image",
    body: { provider: "runway", prompt: "test" },
    requestId,
    // Recovery has to survive a dropped stream and a reconnect, and a loaded
    // Windows runner can spend most of a 5s budget on process scheduling
    // alone. The contract under test is "recovery happens", not "recovery is
    // fast", so give it room rather than letting the clock decide.
    timeoutMs: 20_000,
    json: true,
  };
}

// Finishes the job the way a producer would, then drops the stream so the CLI
// has to recover from the snapshot rather than from a live terminal event.
async function finishAndDropStream(requestId: string, kind: "image" | "video") {
  try {
    if (!pending.has(requestId)) return;
    const status = pending.get(requestId);
    startJob({ requestId, kind, meta: {} });
    for (const client of clients) emit(client, "progress", { jobId: requestId, phase: "persisting" }, 10);
    if (expiryCases.has(requestId)) {
      await expireAndRestore(requestId);
      return;
    }
    if (commitCases.has(requestId)) {
      await commitThenDrop(requestId);
      return;
    }
    if (status === "canceled") {
      // Exercise the real cancel path: options.canceled overrides status.
      finishJob(requestId, { canceled: true, meta: { filename: `${requestId}.png` } });
    } else {
      finishJob(requestId, status === null
        ? { meta: { filename: `${requestId}.png` } }
        : { status, meta: { filename: `${requestId}.png` } });
    }
  } finally {
    for (const client of [...clients]) client.end();
  }
}

async function expireAndRestore(requestId: string) {
  // Age a real admitted row; purge, not fixture JSON, must produce the terminal.
  const now = Date.now();
  const meta = { sessionId: "owned-session", clientNodeId: "owned-node", message: "synthetic private metadata" };
  db!.getDb().prepare("UPDATE inflight SET started_at = ?, meta = ?, session_id = ?, client_node_id = ? WHERE request_id = ?")
    .run(now - config.inflight.ttlMs - 1, JSON.stringify(meta), meta.sessionId, meta.clientNodeId, requestId);
  inflight.purgeStaleJobs(now);
  const row = db!.getDb().prepare("SELECT status, error_code, http_status, finished_at FROM terminal_jobs WHERE request_id = ?")
    .get(requestId) as Record<string, unknown> | undefined;
  assert.deepEqual(row, { status: "error", error_code: "JOB_TRACKING_TIMEOUT", http_status: 504, finished_at: now });
  db!.closeDb();
  const restarted: typeof inflight = await import(`../lib/inflight.ts?wp07-restart=${requestId}`);
  assert.notEqual(restarted.listTerminalJobs, inflight.listTerminalJobs, "fresh producer module required");
  const restored = restarted.listTerminalJobs({ sessionId: meta.sessionId });
  assert.equal(restored.length, 1);
  assert.equal(restored[0]!.requestId, requestId);
  assert.equal(restored[0]!.errorCode, "JOB_TRACKING_TIMEOUT");
  assert.equal(restored[0]!.httpStatus, 504);
  assert.equal(restored[0]!.status, "error");
  assert.equal(restored[0]!.finishedAt, now);
  assert.equal(restored[0]!.meta.message, meta.message);
  assert.equal(restored[0]!.meta.clientNodeId, meta.clientNodeId);
  assert.equal(restarted.listJobs().length, 0);
  snapshotOwner = restarted;
}

// e2: the real producer. commitMediaResult writes the snapshot AND publishes a
// live done event; the live event is suppressed here (no SSE bridge is wired to
// publishJobEvent in this harness) and the stream is dropped, so the client has
// to recover from the snapshot commitMediaResult actually wrote.
async function commitThenDrop(requestId: string) {
  const tempPath = join(generatedDir, `${requestId}-src.png`);
  writeFileSync(tempPath, "not-a-real-png");
  try {
    await commitMediaResult({
      ctx: {
        config: {
          ids: { generatedHexBytes: 4 },
          storage: { generatedDir },
        },
      } as never,
      deps: { writeSidecar: async () => undefined },
      requestId,
      kind: "image",
      tempPath,
      cleanup: async () => undefined,
      ext: "png",
      meta: {},
      doneExtra: {},
    });
  } finally {
    for (const client of [...clients]) client.end();
  }
}

describe("finishJob snapshot reaches CLI recovery", () => {
  before(async () => {
    generatedDir = ownedEnv.IMA2_GENERATED_DIR;
    mkdirSync(generatedDir);
    server = createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    serverBase = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    requests.length = 0;
    reconnectCursors.length = 0;
    snapshotOwner = inflight;
  });

  afterEach(() => {
    assert.deepEqual(violations, [], "producer and HTTP fixture errors must remain observable");
    assert.equal(requests.filter(request => request.startsWith("POST ")).length, 1);
    assert.deepEqual(reconnectCursors, ["10"]);
    assert.deepEqual(requests.filter(request => request.startsWith("GET ")), [
      "GET /api/events", "GET /api/events?lastEventId=10", "GET /api/inflight?includeTerminal=1",
    ]);
  });

  after(async () => {
    for (const client of clients) client.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(server.listening, false);
    assert.equal(clients.size, 0);
    _resetForTests();
  });

  it("recovers a job committed by the real commitMediaResult (e2)", async () => {
    _resetForTests();
    pending.set("commit-job", TERMINAL_SUCCESS);
    commitCases.add("commit-job");
    const result = await runMcpJob(opts("commit-job"));
    // The filename is minted inside commitMediaResult, so a passing assertion
    // proves the snapshot came from the real producer, not from the harness.
    assert.match(result.filename, /_mcp\.png$/);
    assert.equal(result.url, `/generated/${encodeURIComponent(result.filename)}`);
  });

  it("recovers a job finished with the MCP 'done' spelling", async () => {
    _resetForTests();
    pending.set("status-done", TERMINAL_SUCCESS);
    const result = await runMcpJob(opts("status-done"));
    assert.equal(result.filename, "status-done.png");
    assert.ok(reconnectCursors.length > 0, "recovery must have reconnected after the gap");
  });

  it("recovers a job finished with the 'completed' spelling (e1)", async () => {
    _resetForTests();
    pending.set("status-completed", "completed");
    const result = await runMcpJob(opts("status-completed"));
    assert.equal(result.filename, "status-completed.png");
  });

  it("recovers a job finished without any status at all (e3)", async () => {
    // finishJob's default is "completed"; before this phase recovery only
    // accepted "done", so this call stranded the CLI.
    _resetForTests();
    pending.set("status-omitted", null);
    const result = await runMcpJob(opts("status-omitted"));
    assert.equal(result.filename, "status-omitted.png");
  });

  it("still surfaces failures rather than treating them as success", async () => {
    _resetForTests();
    pending.set("status-error", "error");
    await assert.rejects(runMcpJob(opts("status-error")));
  });

  it("reports a canceled job as canceled, not as an unrecoverable gap", async () => {
    // finishJob's options.canceled wins over status, so this is the real
    // cancel path. Without explicit handling it fell through to the generic
    // SSE_REPLAY_GAP, which tells the user nothing.
    _resetForTests();
    pending.set("status-canceled", "canceled");
    await assert.rejects(runMcpJob(opts("status-canceled")), (error: { code?: string }) => {
      assert.notEqual(error.code, "SSE_REPLAY_GAP");
      assert.equal(error.code, "GENERATION_CANCELED");
      return true;
    });
  });

  for (const kind of ["image", "video", "upscale"] as const) {
    it(`recovers persisted tracking expiry after fresh producer restore (${kind})`, async () => {
      _resetForTests();
      const requestId = `persisted-expiry-${kind}`;
      pending.set(requestId, "error");
      expiryCases.add(requestId);
      const options = opts(requestId);
      if (kind === "video") options.kind = "video";
      if (kind === "upscale") {
        options.postPath = "/api/mcp/media-action";
        options.body = { provider: "runway", action: "upscale", filename: "owned.png" };
      }
      await assert.rejects(runMcpJob(options), (error: unknown) => {
        assert.ok(error instanceof McpJobError);
        assert.equal(error.code, "JOB_TRACKING_TIMEOUT");
        assert.equal(error.status, 504);
        assert.equal(error.message, "Job tracking expired; upstream completion is unknown. Inspect history before retrying.");
        assert.equal(error.body, undefined);
        return true;
      });
      assert.notEqual(snapshotOwner, inflight);
      assert.deepEqual(requests.filter(request => request.startsWith("POST ")), [
        `POST ${options.postPath ?? "/api/mcp/generate"}`,
      ]);
    });
  }
});
