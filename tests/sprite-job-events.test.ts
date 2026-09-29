import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Response } from "express";

const testRoot = mkdtempSync(join(tmpdir(), "ima2-sprite-events-"));
process.env.IMA2_CONFIG_DIR = testRoot;
process.env.IMA2_DB_PATH = join(testRoot, "sessions.db");
const { createSpriteJobEmitter } = await import("../lib/spriteJobEvents.ts");
const jobs = await import("../lib/inflight.ts");
const bus = await import("../lib/eventBus.ts");
const { closeDb } = await import("../lib/db.ts");
beforeEach(() => { jobs._resetForTests(); bus._resetForTest(); });
after(() => { closeDb(); rmSync(testRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

function response() {
  const chunks: string[] = [];
  const res = { writableEnded: false, destroyed: false,
    write(chunk: string) { chunks.push(chunk); return true; },
    end() { this.writableEnded = true; },
  };
  return { chunks, res: res as unknown as Response };
}

test("Sprite canonical error flattens nested fields without changing direct legacy SSE", () => {
  jobs.startJob({ requestId: "sprite", kind: "sprite-row" });
  const { res, chunks } = response();
  const emitter = createSpriteJobEmitter(res, "sprite");
  const data = { requestId: "sprite", status: 499, error: { code: "GENERATION_CANCELED", message: "Generation canceled" } };
  assert.equal(emitter.emit("error", data), true);
  const [event] = bus.replaySince(0);
  assert.equal(event.envelope?.phase, "cancelled");
  assert.equal(event.envelope?.error?.code, "GENERATION_CANCELED");
  assert.deepEqual(data.error, { code: "GENERATION_CANCELED", message: "Generation canceled" });
  assert.ok(chunks.join("").includes(JSON.stringify(data)));
  emitter.end(); assert.equal(res.writableEnded, true);
});

test("Sprite late error and done do not replace registry cancellation on the bus", () => {
  jobs.startJob({ requestId: "sprite", kind: "sprite-row" });
  jobs.abortJob("sprite");
  const { res } = response(); res.end();
  const emitter = createSpriteJobEmitter(res, "sprite");
  assert.equal(emitter.emit("error", { error: { code: "INVALID_REQUEST", message: "late" } }), false);
  assert.equal(emitter.emit("done", {}), false);
  assert.equal(bus.peekJobSeq("sprite"), 1);
  assert.equal(bus.replaySince(0).length, 1);
  assert.equal(emitter.emit("phase", { phase: "legacy-nonterminal" }), true);
  assert.equal(bus.replaySince(0).length, 2, "raw nonterminal behavior is not suppressed by this contract");
});
