import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveChildVideoLineage, normalizeVideoLineage } from "../lib/videoLineage.ts";
import { listHistoryRows } from "../lib/historyList.ts";

test("deriveChildVideoLineage preserves roots across children and siblings", () => {
  const child = deriveChildVideoLineage("child.mp4", "root.mp4", null);
  const grandchild = deriveChildVideoLineage("grandchild.mp4", "child.mp4", { videoLineage: child });
  const sibling = deriveChildVideoLineage("sibling.mp4", "root.mp4", null);

  assert.deepEqual(child, { id: "child.mp4", parentId: "root.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 1 });
  assert.deepEqual(grandchild, { id: "grandchild.mp4", parentId: "child.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 2 });
  assert.deepEqual({ ...sibling, id: child.id }, child);
});

test("normalizeVideoLineage fails closed for malformed durable identity", () => {
  assert.throws(
    () => normalizeVideoLineage({ id: "child.mp4", parentId: "../root.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 1 }),
    (error: any) => error?.code === "VIDEO_LINEAGE_INVALID",
  );
  assert.throws(
    () => deriveChildVideoLineage("grandchild.mp4", "other.mp4", { videoLineage: { id: "child.mp4", parentId: "root.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 1 } }),
    (error: any) => error?.code === "VIDEO_LINEAGE_INVALID",
  );
});

test("history rows round-trip videoLineage from the sidecar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-video-lineage-history-"));
  const videoLineage = { id: "child.mp4", parentId: "root.mp4", rootId: "root.mp4", seriesId: "root.mp4", sequenceIndex: 1 };
  try {
    await writeFile(join(dir, "child.mp4"), Buffer.from("video"));
    await writeFile(join(dir, "child.mp4.json"), JSON.stringify({ kind: "video", mediaType: "video", createdAt: 1, videoLineage }));
    const row = (await listHistoryRows(dir)).find((item) => item.filename === "child.mp4");
    assert.deepEqual(row?.videoLineage, videoLineage);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
