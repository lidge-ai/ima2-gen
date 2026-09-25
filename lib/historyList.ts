import { mkdir, readFile, readdir, stat } from "fs/promises";
import { dirname, join } from "path";
import { config } from "../config.js";
import { readEmbeddedImageMetadataFromFile } from "./imageMetadataStore.js";
import { thumbPathForVideo, thumbUrlForVideo } from "./videoThumb.js";
import { thumbPathForImage, thumbUrlForImage } from "./imageThumb.js";

import { errInfo } from "./errInfo.js";
async function listImageFiles(baseDir: string) {
  const out: Array<{ full: string; rel: string; name: string }> = [];

  async function walk(dir: string, depth: number) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === config.storage.trashDirName) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory() && depth > 0) {
        await walk(full, depth - 1);
      } else if (entry.isFile() && /\.(png|jpe?g|webp|mp4)$/i.test(entry.name) && !entry.name.endsWith(".thumb.jpg")) {
        out.push({ full, rel: full.slice(baseDir.length + 1), name: entry.name });
      }
    }
  }

  await walk(baseDir, 2);
  return out;
}

export async function listHistoryRows(baseDir = config.storage.generatedDir) {
  await mkdir(baseDir, { recursive: true });
  const imgs = await listImageFiles(baseDir);
  const setRows = await listCardNewsSetRows(baseDir);
  const rows = await Promise.all(imgs.map(async ({ full, rel, name }) => {
    const st = await stat(full).catch(() => null);
    const meta = await readImageMetadata(full, rel);
    const isVideo = /\.mp4$/i.test(name);
    const encodedUrl = `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`;
    let thumb: string | null = null;
    if (isVideo) {
      const thumbExists = await stat(thumbPathForVideo(full)).then(() => true, () => false);
      if (thumbExists) thumb = thumbUrlForVideo(encodedUrl);
    } else {
      const imgThumbExists = await stat(thumbPathForImage(full)).then(() => true, () => false);
      if (imgThumbExists) thumb = thumbUrlForImage(encodedUrl);
    }
    return {
      filename: rel,
      url: `/generated/${rel.split("/").map(encodeURIComponent).join("/")}`,
      thumb,
      mediaType: meta?.mediaType || (isVideo ? "video" : "image"),
      video: meta?.video || null,
      videoSeries: meta?.videoSeries || null,
      videoContinuity: meta?.videoContinuity || null,
      videoLineage: meta?.videoLineage || null,
      createdAt: meta?.createdAt || st?.mtimeMs || 0,
      prompt: meta?.prompt || null,
      userPrompt: meta?.userPrompt || meta?.prompt || null,
      revisedPrompt: meta?.revisedPrompt || null,
      promptMode: meta?.promptMode || null,
      composerPrompt: meta?.composerPrompt ?? null,
      composerInsertedPrompts: meta?.composerInsertedPrompts ?? null,
      quality: meta?.quality || null,
      size: meta?.size || null,
      format: meta?.format || name.split(".").pop(),
      model: meta?.model || null,
      ...(meta?.provider === "api" && meta?.imageToolModel ? { imageToolModel: meta.imageToolModel } : {}),
      reasoningEffort: meta?.reasoningEffort ?? null,
      elapsed: meta?.elapsed ?? null,
      provider: meta?.provider || "oauth",
      providerUrl: meta?.providerUrl || null,
      usage: meta?.usage || null,
      webSearchCalls: meta?.webSearchCalls || 0,
      sessionId: meta?.sessionId || null,
      nodeId: meta?.nodeId || null,
      parentNodeId: meta?.parentNodeId || null,
      clientNodeId: meta?.clientNodeId || null,
      requestId: meta?.requestId || null,
      kind: meta?.kind || null,
      canvasVersion: Boolean(meta?.canvasVersion),
      canvasSourceFilename: meta?.canvasSourceFilename || null,
      canvasEditableFilename: meta?.canvasEditableFilename || null,
      canvasMergedAt: Number.isFinite(meta?.canvasMergedAt) ? meta.canvasMergedAt : null,
      annotationsBaked: Boolean(meta?.annotationsBaked),
      annotationSnapshot: meta?.annotationSnapshot ?? null,
      annotationOnly: Boolean(meta?.annotationOnly),
      setId: meta?.setId || null,
      cardId: meta?.cardId || null,
      cardOrder: Number.isFinite(meta?.cardOrder) ? meta.cardOrder : null,
      headline: meta?.headline || null,
      body: meta?.body || null,
      cards: meta?.cards || null,
      refsCount: Number.isFinite(meta?.refsCount) ? meta.refsCount : 0,
      sequenceId: meta?.sequenceId || null,
      sequenceIndex: Number.isFinite(meta?.sequenceIndex) ? meta.sequenceIndex : null,
      sequenceTotalRequested: Number.isFinite(meta?.sequenceTotalRequested) ? meta.sequenceTotalRequested : null,
      sequenceTotalReturned: Number.isFinite(meta?.sequenceTotalReturned) ? meta.sequenceTotalReturned : null,
      sequenceStatus: meta?.sequenceStatus || null,
    };
  }));

  type FileRow = (typeof rows)[number];
  type SetRow = (typeof setRows)[number];
  const allRows: Array<FileRow | (SetRow & Partial<Omit<FileRow, keyof SetRow>>)> = [...rows, ...setRows];
  allRows.sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return b.filename < a.filename ? -1 : b.filename > a.filename ? 1 : 0;
  });

  return allRows;
}

async function readImageSidecar(full: string, rel: string) {
  const sibling = full.replace(/\.(png|jpe?g|webp)$/i, ".json");
  const candidates = new Set([`${full}.json`]);
  if (sibling !== full) candidates.add(sibling);
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf-8"));
    } catch (e) {
      const err = errInfo(e);
      if (err.code !== "ENOENT") console.warn("[history] sidecar parse fail:", rel, err.message);
    }
  }
  return null;
}

async function readImageMetadata(full: string, rel: string) {
  const sidecar = await readImageSidecar(full, rel);
  if (sidecar) return sidecar;
  if (/\.mp4$/i.test(full)) return null;
  try {
    const embedded = await readEmbeddedImageMetadataFromFile(full);
    return embedded.metadata;
  } catch (e) {
    const err = errInfo(e);
    if (err.code !== "ENOENT") console.warn("[history] embedded metadata read fail:", rel, err.message);
    return null;
  }
}

interface CardNewsSetManifestFile {
  setId?: string;
  title?: string;
  size?: string;
  createdAt?: number;
  sessionId?: string | null;
  requestId?: string | null;
  cards?: Array<{
    imageFilename?: string;
    headline?: unknown;
    body?: unknown;
    cardOrder?: unknown;
    status?: string;
  }>;
}

function cardNewsSetRow(entryName: string, manifestPath: string, manifest: CardNewsSetManifestFile) {
  const first = (manifest.cards || []).find((card) => card.imageFilename);
  const filename = `cardnews/${entryName}/manifest.json`;
  return {
    filename,
    url: first?.imageFilename
      ? `/generated/cardnews/${encodeURIComponent(entryName)}/${encodeURIComponent(first.imageFilename)}`
      : "",
    createdAt: manifest.createdAt || 0,
    prompt: null,
    userPrompt: null,
    revisedPrompt: null,
    promptMode: null,
    composerPrompt: null,
    composerInsertedPrompts: null,
    quality: null,
    size: manifest.size || null,
    format: "card-news-set",
    model: null,
    provider: "oauth",
    usage: null,
    webSearchCalls: 0,
    sessionId: manifest.sessionId || null,
    nodeId: null,
    parentNodeId: null,
    clientNodeId: null,
    requestId: manifest.requestId || null,
    kind: "card-news-set",
    setId: manifest.setId || entryName,
    cardId: null,
    cardOrder: null,
    title: manifest.title || "Untitled card news",
    headline: manifest.title || "Untitled card news",
    body: null,
    cards: (manifest.cards || []).map((card) => ({
      url: card.imageFilename
        ? `/generated/cardnews/${encodeURIComponent(entryName)}/${encodeURIComponent(card.imageFilename)}`
        : "",
      headline: card.headline,
      body: card.body,
      cardOrder: card.cardOrder,
      imageFilename: card.imageFilename,
      status: card.status || "generated",
    })),
    refsCount: 0,
    dir: dirname(manifestPath),
  };
}

async function listCardNewsSetRows(baseDir: string) {
  const root = join(baseDir, "cardnews");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const rows: Array<ReturnType<typeof cardNewsSetRow>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifestPath = join(root, entry.name, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CardNewsSetManifestFile;
      rows.push(cardNewsSetRow(entry.name, manifestPath, manifest));
    } catch (e) {
      const err = errInfo(e);
      if (err.code !== "ENOENT") console.warn("[history] card-news manifest parse fail:", entry.name, err.message);
    }
  }
  return rows;
}
