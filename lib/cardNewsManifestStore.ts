import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireRuntimeContext, type RouteRuntimeContext } from "./runtimeContext.js";

import { errInfo, type CodedError, thrownFields } from "./errInfo.js";
import { assertSafeSetId, resolveCardNewsSetDir } from "./cardNewsPath.js";

interface CardNewsManifest {
  setId: string;
  title?: string;
  topic?: string;
  imageTemplateId?: string;
  roleTemplateId?: string;
  size?: string;
  generationStrategy?: string;
  cardCount?: number;
  createdAt?: number;
  sessionId?: string | null;
  cards?: ManifestCard[];
  [key: string]: unknown;
}

interface ManifestCard {
  cardId?: string;
  id?: string;
  cardOrder?: number;
  order?: number;
  role?: string;
  headline?: string;
  body?: string;
  visualPrompt?: string;
  textFields?: unknown;
  references?: unknown;
  locked?: boolean;
  status?: string;
  error?: string | { message?: string } | null;
  imageFilename?: string | null;
  url?: string;
  [key: string]: unknown;
}

export async function writeCardNewsManifest(generatedDir: string, manifest: CardNewsManifest) {
  const dir = resolveCardNewsSetDir(generatedDir, manifest.setId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifestFilename: "manifest.json" };
}

export async function writeCardSidecar(dir: string, filename: string, sidecar: unknown) {
  await writeFile(join(dir, filename), JSON.stringify(sidecar, null, 2));
}

function cardUrl(setId: string, imageFilename: string | null | undefined) {
  if (!imageFilename) return undefined;
  return `/generated/cardnews/${encodeURIComponent(setId)}/${encodeURIComponent(imageFilename)}`;
}

function manifestToPlan(manifest: CardNewsManifest) {
  return {
    setId: manifest.setId,
    title: manifest.title || "Untitled card news",
    topic: manifest.topic || manifest.title || "Untitled card news",
    imageTemplateId: manifest.imageTemplateId || "academy-lesson-square",
    roleTemplateId: manifest.roleTemplateId || "mid-5",
    size: manifest.size || "2048x2048",
    generationStrategy: manifest.generationStrategy || "parallel-template-i2i",
    cards: (manifest.cards || []).map((card, index) => ({
      id: card.cardId || card.id || `card_${index + 1}`,
      order: card.cardOrder || card.order || index + 1,
      role: card.role || "card",
      headline: card.headline || "",
      body: card.body || "",
      visualPrompt: card.visualPrompt || "",
      textFields: Array.isArray(card.textFields) ? card.textFields : [],
      references: card.references || [],
      locked: !!card.locked,
      status: card.status || "generated",
      error: (typeof card.error === "object" && card.error && "message" in card.error
        ? card.error.message
        : (typeof card.error === "string" ? card.error : undefined)),
      imageFilename: card.imageFilename || undefined,
      url: card.url || cardUrl(manifest.setId, card.imageFilename),
    })),
  };
}

export async function readCardNewsSetPlan(ctxIn: RouteRuntimeContext, setId: string) {
  return manifestToPlan(await readCardNewsManifest(ctxIn, setId));
}

export async function readCardNewsManifest(ctxIn: RouteRuntimeContext, setId: string): Promise<CardNewsManifest> {
  const ctx = requireRuntimeContext(ctxIn);
  const safeSetId = assertSafeSetId(setId, 404);
  try {
    const raw = await readFile(
      join(resolveCardNewsSetDir(ctx.config.storage.generatedDir, safeSetId, 404), "manifest.json"),
      "utf8",
    );
    return JSON.parse(raw) as CardNewsManifest;
  } catch (err: unknown) {
    const errFields = thrownFields(err);
    if (errFields.code === "CARD_NEWS_SET_NOT_FOUND") throw err;
    const notFound: CodedError = new Error("Card News set not found");
    notFound.status = 404;
    notFound.code = "CARD_NEWS_SET_NOT_FOUND";
    throw notFound;
  }
}

export async function listCardNewsSets(ctxIn: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxIn);
  const root = join(ctx.config.storage.generatedDir, "cardnews");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sets: Array<Record<string, unknown> & { createdAt: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const safeSetId = assertSafeSetId(entry.name, 404);
      const raw = await readFile(join(resolveCardNewsSetDir(ctx.config.storage.generatedDir, safeSetId, 404), "manifest.json"), "utf8");
      const manifest = JSON.parse(raw) as CardNewsManifest;
      const first = (manifest.cards || []).find((card) => card.imageFilename);
      sets.push({
        setId: manifest.setId || entry.name,
        title: manifest.title || "Untitled card news",
        cardCount: manifest.cardCount || manifest.cards?.length || 0,
        createdAt: manifest.createdAt || 0,
        sessionId: manifest.sessionId || null,
        manifestUrl: `/api/cardnews/sets/${encodeURIComponent(manifest.setId || entry.name)}/manifest`,
        folderLabel: `generated/cardnews/${manifest.setId || entry.name}`,
        url: cardUrl(manifest.setId || entry.name, first?.imageFilename),
        cards: (manifest.cards || []).map((card) => ({
          id: card.cardId,
          order: card.cardOrder,
          headline: card.headline,
          body: card.body,
          textFields: Array.isArray(card.textFields) ? card.textFields : [],
          imageFilename: card.imageFilename,
          status: card.status || "generated",
          url: cardUrl(manifest.setId || entry.name, card.imageFilename),
        })),
      });
    } catch (e) {
      const err = errInfo(e);
      console.warn("[card-news] set manifest read failed", entry.name, err.message);
    }
  }
  sets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return sets;
}
