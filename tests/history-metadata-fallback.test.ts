import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { listHistoryRows } from "../lib/historyList.ts";
import { embedImageMetadata } from "../lib/imageMetadataStore.ts";

async function makeEmbeddedPng(meta) {
  const raw = await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 3,
      background: { r: 30, g: 120, b: 220 },
    },
  }).png().toBuffer();
  return (await embedImageMetadata(raw, "png", meta)).buffer;
}

test("history rows use embedded metadata when sidecar json is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-history-meta-"));
  try {
    const image = await makeEmbeddedPng({
      kind: "classic",
      userPrompt: "sidecar 없는 PNG 복원",
      revisedPrompt: "restored from embedded metadata",
      size: "1536x1024",
      format: "png",
      quality: "high",
      model: "gpt-5.4",
      provider: "oauth",
      requestId: "req_history_meta",
      refsCount: 1,
    });
    await writeFile(join(dir, "embedded.png"), image);

    const rows = await listHistoryRows(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].filename, "embedded.png");
    assert.equal(rows[0].userPrompt, "sidecar 없는 PNG 복원");
    assert.equal(rows[0].revisedPrompt, "restored from embedded metadata");
    assert.equal(rows[0].size, "1536x1024");
    assert.equal(rows[0].quality, "high");
    assert.equal(rows[0].requestId, "req_history_meta");
    assert.equal(rows[0].refsCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("history rows prefer sidecar metadata over embedded metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-history-meta-"));
  try {
    const image = await makeEmbeddedPng({
      userPrompt: "embedded prompt",
      size: "1024x1024",
      format: "png",
    });
    await writeFile(join(dir, "prefer.png"), image);
    await writeFile(
      join(dir, "prefer.png.json"),
      JSON.stringify({
        createdAt: 123,
        prompt: "sidecar prompt",
        userPrompt: "sidecar prompt",
        size: "2048x2048",
        format: "png",
        quality: "medium",
      }),
    );

    const rows = await listHistoryRows(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userPrompt, "sidecar prompt");
    assert.equal(rows[0].size, "2048x2048");
    assert.equal(rows[0].quality, "medium");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
