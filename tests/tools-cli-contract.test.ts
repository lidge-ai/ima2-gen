// WP7 (070): real CLI spawn — offline envelope + documented-call rejection.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), "ima2-tools-cli-"));
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const env = { ...process.env, IMA2_CONFIG_DIR: dir, IMA2_DB_PATH: join(dir, "db.sqlite") };

async function cli(args: string[]): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await run("node", ["--import", "tsx", "bin/ima2.ts", ...args], { env, timeout: 60_000 });
    return { stdout, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; code?: number };
    return { stdout: e.stdout ?? "", code: e.code ?? 1 };
  }
}

test("tools list --json --offline: versioned envelope with documented mcp tools + builtin ima2 tools", async () => {
  const { stdout, code } = await cli(["tools", "list", "--json", "--offline"]);
  assert.equal(code, 0);
  const payload = JSON.parse(stdout) as {
    ok: boolean; schemaVersion: number; catalogVersion: string; cliVersion: string; requestId: string;
    data: { tools: Array<{ id: string; namespace: string; availability: { state: string } }>; source: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.schemaVersion, 1);
  assert.match(payload.catalogVersion, /^sha256:/);
  assert.equal(payload.data.source, "local-snapshot");
  const runwayTool = payload.data.tools.find((t) => t.id === "mcp.runway.generate_video");
  assert.equal(runwayTool?.availability.state, "documented");
  assert.ok(payload.data.tools.some((t) => t.namespace === "ima2"));
  assert.ok(!/access_token|refresh_token/.test(stdout));
});

test("tools call on a documented tool is rejected pre-network with auth_required", async () => {
  const { stdout, code } = await cli(["tools", "call", "mcp.runway.generate_image", "--json", "--offline", "--input", "{}"]);
  assert.equal(code, 1);
  const payload = JSON.parse(stdout) as { ok: boolean; error: { code: string } };
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "auth_required");
});

test("tools show surfaces the execution binding contract offline", async () => {
  const { stdout } = await cli(["tools", "show", "mcp.runway.upscale_video", "--json", "--offline"]);
  const payload = JSON.parse(stdout) as { data: { tool: { execution: { binding: string; endpoint: string } } } };
  assert.equal(payload.data.tool.execution.binding, "mcp-media-action");
  assert.match(payload.data.tool.execution.endpoint, /media-action/);
});
