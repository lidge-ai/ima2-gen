import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { persistVideoArtifact } from "../lib/videoArtifactPersistence.ts";

test("persistVideoArtifact rolls back the MP4 when atomic sidecar commit fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-video-persist-"));
  const filename = "broken.mp4";
  try {
    await mkdir(join(dir, `${filename}.json`));
    await assert.rejects(persistVideoArtifact(dir, filename, Buffer.from("video"), { kind: "video" }));
    await assert.rejects(access(join(dir, filename)), (error: any) => error?.code === "ENOENT");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
