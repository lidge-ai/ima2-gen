import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendGenerationRequestLog,
  listGenerationRequestLog,
  type GenerationRequestLogEntry,
} from "../lib/generationRequestLog.ts";

function makeEntry(id: string, overrides?: Partial<GenerationRequestLogEntry>): GenerationRequestLogEntry {
  return {
    id,
    requestId: `req-${id}`,
    createdAt: Date.now(),
    prompt: `test prompt ${id}`,
    requested: 1,
    succeeded: 1,
    error: null,
    ...overrides,
  };
}

describe("generation request log", () => {
  it("appends and reads entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-gen-log-"));
    const logPath = join(root, "log.json");
    try {
      await appendGenerationRequestLog(logPath, makeEntry("1"));
      await appendGenerationRequestLog(logPath, makeEntry("2"));
      const entries = await listGenerationRequestLog(logPath);
      assert.equal(entries.length, 2);
      assert.equal(entries[0].id, "2");
      assert.equal(entries[1].id, "1");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("returns empty array for missing file", async () => {
    const entries = await listGenerationRequestLog("/nonexistent/path.json");
    assert.deepEqual(entries, []);
  });

  it("returns empty array for corrupted file", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-gen-log-"));
    const logPath = join(root, "log.json");
    try {
      await writeFile(logPath, "not-json");
      const entries = await listGenerationRequestLog(logPath);
      assert.deepEqual(entries, []);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("caps entries at 200", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-gen-log-"));
    const logPath = join(root, "log.json");
    try {
      const existing = Array.from({ length: 200 }, (_, i) => makeEntry(`existing-${i}`));
      await writeFile(logPath, JSON.stringify(existing));
      await appendGenerationRequestLog(logPath, makeEntry("new"));
      const entries = await listGenerationRequestLog(logPath);
      assert.equal(entries.length, 200);
      assert.equal(entries[0].id, "new");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("recovers the write queue after a filesystem failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-gen-log-"));
    const blockedParent = join(root, "not-a-directory");
    const validPath = join(root, "log.json");
    try {
      await writeFile(blockedParent, "file");
      await assert.rejects(
        appendGenerationRequestLog(join(blockedParent, "log.json"), makeEntry("fail")),
      );
      await appendGenerationRequestLog(validPath, makeEntry("recover"));
      const entries = await listGenerationRequestLog(validPath);
      assert.deepEqual(entries.map((e) => e.id), ["recover"]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("records error entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-gen-log-"));
    const logPath = join(root, "log.json");
    try {
      await appendGenerationRequestLog(logPath, makeEntry("err", {
        succeeded: 0,
        error: "moderation_blocked",
      }));
      const entries = await listGenerationRequestLog(logPath);
      assert.equal(entries[0].succeeded, 0);
      assert.equal(entries[0].error, "moderation_blocked");
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
