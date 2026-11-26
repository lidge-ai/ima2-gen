import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreparedWorkflow } from "../lib/workflows/index.js";
import type { MediaRunnerDeps } from "../lib/providers/media/runnerTypes.js";
import type { WorkflowDeps } from "../lib/workflows/index.js";

const dir = mkdtempSync(join(tmpdir(), "ima2-workflow-redaction-"));
process.env.IMA2_CONFIG_DIR = dir;
process.env.IMA2_DB_PATH = join(dir, "sessions.db");
const secret = "sentinel-secret-for-workflow-test";
mock.module(new URL("../lib/workflows/index.ts", import.meta.url).href, {
  namedExports: { runWorkflow: async () => { throw new Error(secret); } },
});
const { launchWorkflowJob } = await import("../lib/providers/media/workflowJob.js");
const { subscribe } = await import("../lib/eventBus.js");
const { configureLogger } = await import("../lib/logger.js");
const { closeDb } = await import("../lib/db.js");

after(() => {
  configureLogger({ level: "info", sink: console });
  closeDb();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("unexpected workflow errors never expose provider secrets", async () => {
  const logs: string[] = [];
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  configureLogger({ level: "info", sink: { info: (line) => logs.push(line) } });
  const unsubscribe = subscribe((event) => events.push(event));
  const prepared = { definition: { id: "remix-restyle" }, values: {} } as PreparedWorkflow;
  try {
    await launchWorkflowJob({} as MediaRunnerDeps, {} as WorkflowDeps, prepared, {
      requestId: "workflow-redaction-test", runsDir: dir,
    });
  } finally {
    unsubscribe();
  }
  const event = events.find((entry) => entry.event === "error");
  assert.equal(event?.data.code, "WORKFLOW_INTERNAL");
  assert.equal(event?.data.error, "Workflow failed (internal error); see the server log");
  assert.ok(logs.some((line) => line.includes("internal-error")));
  assert.ok(!JSON.stringify({ events, logs }).includes(secret));
});
