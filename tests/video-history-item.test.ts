import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listHistoryRows } from "../lib/historyList.ts";
import { toVideoHistoryItem, type VideoExtendDone } from "../ui/src/lib/videoHistoryItem.ts";
import type { GenerateItem } from "../ui/src/types.ts";

const STABLE_FIELDS = [
  "image", "url", "providerUrl", "filename", "mediaType", "prompt", "userPrompt",
  "revisedPrompt", "provider", "model", "format", "elapsed", "usage", "webSearchCalls",
  "video", "videoSeries", "videoContinuity", "videoLineage", "requestId", "createdAt",
  "sessionId",
] as const satisfies ReadonlyArray<keyof GenerateItem>;

function stableVideoShape(item: GenerateItem): Record<string, unknown> {
  return Object.fromEntries(STABLE_FIELDS.map((field) => [field, item[field]]));
}

test("extended video immediate history item equals the refreshed history shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ima2-video-history-item-"));
  const filename = "child.mp4";
  const createdAt = 1_721_234_567_890;
  const video = {
    operation: "extend",
    mode: "image-to-video",
    sourceVideoId: "root.mp4",
    sourceFrame: "last",
    duration: 6,
    resolution: "720p",
    aspectRatio: "16:9",
    xaiVideoRequestId: "xai-video-1",
  };
  const videoLineage = {
    id: filename,
    parentId: "root.mp4",
    rootId: "root.mp4",
    seriesId: "root.mp4",
    sequenceIndex: 1,
  };
  const videoContinuity = {
    lineageId: "continuity-1",
    parentFilename: "root.mp4",
    sourceFrame: "last" as const,
    maxEntries: 4 as const,
    retention: "keep-start-plus-latest-3" as const,
    entries: [],
  };
  const metadata = {
    kind: "video",
    mediaType: "video",
    providerUrl: "https://provider.example/child.mp4",
    requestId: "vext_test",
    prompt: "server prompt",
    userPrompt: "server user prompt",
    revisedPrompt: "server revised prompt",
    provider: "grok-api" as const,
    model: "grok-imagine-video-1.5",
    createdAt,
    elapsed: 12.5,
    usage: { total_tokens: 42, video_tokens: 7 },
    webSearchCalls: 2,
    video,
    videoLineage,
    videoContinuity,
  };
  const done: VideoExtendDone = {
    ...metadata,
    filename,
    url: `/generated/${filename}`,
    mediaType: "video",
  };
  const actionImage: GenerateItem = {
    image: "/generated/root.mp4",
    url: "/generated/root.mp4",
    filename: "root.mp4",
    mediaType: "video",
    prompt: "stale source prompt",
    provider: "grok",
    model: "stale-source-model",
    usage: { total_tokens: 999 },
    createdAt: 1,
  };

  try {
    await writeFile(join(dir, filename), Buffer.from([0]));
    await writeFile(join(dir, `${filename}.json`), JSON.stringify(metadata));
    const row = (await listHistoryRows(dir)).find((item) => item.filename === filename);
    assert.ok(row, "persisted child must appear in refreshed history");

    const immediate = toVideoHistoryItem(done, actionImage);
    const refreshed: GenerateItem = {
      image: row.url,
      url: row.url,
      providerUrl: row.providerUrl ?? null,
      filename: row.filename,
      mediaType: row.mediaType,
      prompt: row.prompt ?? undefined,
      userPrompt: row.userPrompt ?? null,
      revisedPrompt: row.revisedPrompt ?? null,
      provider: row.provider,
      model: row.model ?? undefined,
      format: row.format,
      elapsed: row.elapsed ?? undefined,
      usage: row.usage ?? undefined,
      webSearchCalls: row.webSearchCalls,
      video: row.video ?? null,
      videoSeries: row.videoSeries ?? null,
      videoContinuity: row.videoContinuity ?? null,
      videoLineage: row.videoLineage ?? null,
      requestId: row.requestId ?? null,
      createdAt: row.createdAt,
      sessionId: row.sessionId ?? null,
    };
    assert.deepEqual(stableVideoShape(immediate), stableVideoShape(refreshed));
    assert.equal(immediate.prompt, "server prompt", "server prompt must override source metadata");
    assert.equal(immediate.createdAt, createdAt, "server createdAt must be preserved verbatim");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
