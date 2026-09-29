// 260722 hardening 030: MCP log surfaces must stay secret-free. Covers the
// scrubValue contract, the removed RAW SUBMIT dump (source canary), and the
// nested-cause path through the persistent jobs.log (audit R2 blocker).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubValue } from "../lib/mcp/sanitizer.js";
import { logMcpJobError, mcpJobLogPath } from "../lib/mcp/jobLog.js";

const SIGNED_URL = "https://cdn.example.com/out.mp4?sig=deadbeefcafe1234&expires=99";
const LONG_TOKEN = "faketoken0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EMAIL = "user@example.com";

test("scrubValue redacts signed query params, long tokens, and emails", () => {
  const scrubbed = scrubValue(`${SIGNED_URL} ${LONG_TOKEN} ${EMAIL}`);
  assert.ok(!scrubbed.includes("deadbeefcafe1234"));
  assert.ok(!scrubbed.includes(LONG_TOKEN));
  assert.ok(!scrubbed.includes(EMAIL));
  assert.ok(scrubbed.includes("[REDACTED]"));
});

test("scrubValue on stack-shaped multiline strings redacts embedded secrets", () => {
  const stack = `Error: MCP_TOOL_ERROR:generate_video:${SIGNED_URL}\n    at poll (/app/lib/mcp/executeMediaJob.ts:70:11)`;
  const scrubbed = scrubValue(stack);
  assert.ok(!scrubbed.includes("sig=deadbeefcafe1234"));
  assert.ok(scrubbed.includes("Error: MCP_TOOL_ERROR"));
});

test("executeMediaJob no longer dumps raw submit responses (RAW SUBMIT canary)", () => {
  const source = readFileSync(new URL("../lib/mcp/executeMediaJob.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("RAW SUBMIT"), "raw submit dump must stay removed (030-A)");
});

test("logMcpJobError scrubs nested cause before persisting to jobs.log", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ima2-joblog-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const generatedDir = join(dir, "generated");
  const error = new Error(`MCP_DOWNLOAD_FAILED:${SIGNED_URL}`);
  (error as { cause?: unknown }).cause = new Error(`fetch failed for ${SIGNED_URL} as ${EMAIL} token ${LONG_TOKEN}`);
  await logMcpJobError(generatedDir, { requestId: "req_1", provider: "higgsfield" }, error);
  const line = await readFile(mcpJobLogPath(generatedDir), "utf8");
  assert.ok(!line.includes("sig=deadbeefcafe1234"));
  assert.ok(!line.includes(LONG_TOKEN));
  assert.ok(!line.includes(EMAIL));
  assert.ok(line.includes('"event":"error"'));
  assert.ok(line.includes("[REDACTED]"));
});
