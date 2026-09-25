import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ulid } from "ulid";
import { generateViaResponses } from "./providers/adapters/openaiOperations.js";
import type { OAuthReferenceRef } from "./oauthProxy/references.js";
import type { GenerateOptions } from "./providers/adapters/openaiTypes.js";
import { readTemplateBaseB64 } from "./cardNewsTemplateStore.js";
import { writeCardNewsManifest, writeCardSidecar } from "./cardNewsManifestStore.js";
import { invalidateHistoryIndex } from "./historyIndex.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "./runtimeContext.js";

import { errInfo, type CodedError } from "./errInfo.js";
import { assertSafeSetId, resolveCardNewsSetDir } from "./cardNewsPath.js";

const MAX_CARDS = 30;
const MAX_CONCURRENCY = 4;
const MAX_TEXT_CHARS = 20_000;
const MAX_REFERENCES_PER_CARD = 8;
const MAX_REFERENCE_CHARS = 10 * 1024 * 1024;

function inputError(message: string, code: string): never {
  throw Object.assign(new Error(message), { status: 400, code });
}

function validateInput(input: GenerateCardSetInput, cards: CardInput[]): number {
  if (cards.length > MAX_CARDS) inputError(`cards must contain at most ${MAX_CARDS} items`, "CARD_NEWS_TOO_MANY_CARDS");
  const concurrency = input.concurrency === undefined ? 2 : Number(input.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    inputError(`concurrency must be an integer between 1 and ${MAX_CONCURRENCY}`, "CARD_NEWS_INVALID_CONCURRENCY");
  }
  for (const card of cards) {
    const text = [card.headline, card.body, card.visualPrompt, ...(Array.isArray(card.textFields) ? card.textFields.map((f) => f?.text) : [])]
      .filter((value): value is string => typeof value === "string").join("");
    if (text.length > MAX_TEXT_CHARS) inputError(`card text must not exceed ${MAX_TEXT_CHARS} characters`, "CARD_NEWS_TEXT_TOO_LARGE");
    const refs = Array.isArray(card.references) ? card.references : [];
    if (refs.length > MAX_REFERENCES_PER_CARD || refs.some((ref) => typeof ref !== "string" || ref.length > MAX_REFERENCE_CHARS)) {
      inputError("card references exceed the allowed size", "CARD_NEWS_REFERENCES_TOO_LARGE");
    }
  }
  return concurrency;
}

export function validateCardNewsInput(input: GenerateCardSetInput): void {
  if (input.setId !== undefined) assertSafeSetId(input.setId);
  validateInput(input, Array.isArray(input.cards) ? input.cards : []);
}

interface CardTextField {
  renderMode?: string;
  text?: string;
  kind?: string;
  placement?: string;
  slotId?: string;
  [key: string]: unknown;
}

interface CardInput {
  id?: string;
  cardOrder?: number;
  order?: number;
  role?: string;
  headline?: string;
  body?: string;
  visualPrompt?: string;
  textFields?: CardTextField[] | unknown;
  references?: unknown[];
  locked?: boolean;
  [key: string]: unknown;
}

interface CardTemplate {
  stylePrompt?: string;
  negativePrompt?: string;
  size?: string;
  [key: string]: unknown;
}

interface GenerateCardSetInput {
  setId?: string;
  cards?: CardInput[];
  imageTemplateId?: string;
  quality?: string;
  size?: string;
  moderation?: string;
  model?: string;
  concurrency?: number | string;
  requestId?: string;
  promptMode?: string;
  sessionId?: string | null;
  title?: string;
  roleTemplateId?: string;
  [key: string]: unknown;
}

export interface CardSidecar {
  kind: string;
  setId: string;
  sessionId: string | null;
  requestId: string;
  cardId: string;
  cardOrder: number;
  title: string;
  role: string;
  headline: string;
  body: string;
  textFields: CardTextField[] | unknown[];
  imageTemplateId: string;
  generationStrategy: string;
  templateBase: string;
  prompt: string;
  visualPrompt: string;
  imageFilename: string | null;
  sidecarFilename: string;
  locked: boolean;
  status: string;
  error: { code: string; message: string } | null;
  createdAt: number;
  generatedAt: number | null;
  revisedPrompt: string | null;
  [key: string]: unknown;
}

export interface CardStart {
  cardOrder: number;
  cardId: string;
  [key: string]: unknown;
}

interface GenerateCardSetOptions {
  generateFn?: (
    prompt: string,
    quality: string,
    size: string,
    moderation?: string,
    references?: OAuthReferenceRef[],
    requestId?: string | null,
    mode?: string,
    ctx?: RouteRuntimeContext,
    options?: GenerateOptions,
  ) => Promise<{ b64: string; revisedPrompt?: string | null; usage?: unknown; webSearchCalls?: number }>;
  onCardStart?: (card: CardStart) => void | Promise<void>;
  onCardDone?: (sidecar: CardSidecar) => void | Promise<void>;
}

function formatRenderedTextInstruction(textFields: CardTextField[] = []) {
  const visible = (Array.isArray(textFields) ? textFields : [])
    .filter((field: CardTextField) => field?.renderMode === "in-image" && field.text);
  if (!visible.length) {
    return [
      "Do not render readable text unless explicitly listed.",
      "If visible text is required, it must be listed explicitly in textFields[].text in the target language/script.",
      "Do not render role labels, schema keys, placeholder labels, or untranslated summaries.",
    ].join("\n");
  }
  return [
    "Render only the following readable text items exactly as written:",
    ...visible.map((field: CardTextField) => {
      const slot = field.slotId ? ` in slot ${field.slotId}` : "";
      return `- ${field.kind} at ${field.placement}${slot}: "${field.text}"`;
    }),
    "Preserve the language and spelling of every listed text item.",
    "Do not translate, romanize, summarize, substitute, or add unlisted readable text.",
    "Do not render role labels, schema keys, placeholder labels, or extra text.",
  ].join("\n");
}

export function assemblePrompt(template: CardTemplate, card: CardInput) {
  return [
    template.stylePrompt,
    card.visualPrompt,
    formatRenderedTextInstruction(Array.isArray(card.textFields) ? card.textFields as CardTextField[] : []),
    template.negativePrompt ? `Avoid: ${template.negativePrompt}` : "",
  ].filter(Boolean).join("\n");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function generateCardNewsSet(ctxIn: RouteRuntimeContext, input: GenerateCardSetInput, options: GenerateCardSetOptions = {}) {
  const ctx = requireRuntimeContext(ctxIn);
  const setId = assertSafeSetId(input.setId || `cs_${ulid()}`);
  const cards = Array.isArray(input.cards) ? input.cards : [];
  const concurrency = validateInput(input, cards);
  const cardsToGenerate = cards.filter((card) => !card.locked);
  if (cardsToGenerate.length === 0) {
    const err: CodedError = new Error("cards are required");
    err.status = 400;
    err.code = "CARD_NEWS_CARDS_REQUIRED";
    throw err;
  }

  const imageTemplateId = input.imageTemplateId || "academy-lesson-square";
  const { template, templateBase, b64: templateB64 } = await readTemplateBaseB64(ctx, imageTemplateId);
  const dir = resolveCardNewsSetDir(ctx.config.storage.generatedDir, setId);
  await mkdir(dir, { recursive: true });

  const quality = input.quality || "medium";
  const size = input.size || template.size || "2048x2048";
  const moderation = input.moderation || "low";
  const model = input.model || ctx.config.imageModels.default;
  // GPT OAuth lane (lib/oauthImages.ts): the template image rides along as the edit source.
  const generateFn = options.generateFn || ((...args: Parameters<typeof generateViaResponses> extends [unknown, ...infer Rest] ? Rest : never) =>
    generateViaResponses("oauth", ...args));

  const generatedCards = await mapLimit(cardsToGenerate, concurrency, async (card: CardInput, index: number) => {
    const cardOrder = Number(card.cardOrder || card.order || index + 1);
    const baseFilename = `card-${String(cardOrder).padStart(2, "0")}`;
    const imageFilename = `${baseFilename}.png`;
    const sidecarFilename = `${baseFilename}.json`;
    const requestId = input.requestId || `${setId}_${baseFilename}`;
    const prompt = assemblePrompt(template, card);
    let result: { b64?: string; revisedPrompt?: string | null } | null = null;
    let error: { code: string; message: string } | null = null;
    if (typeof options.onCardStart === "function") {
      await options.onCardStart({ ...card, cardOrder, cardId: card.id || `card_${cardOrder}` });
    }
    try {
      result = await generateFn(
        prompt,
        quality,
        size,
        moderation,
        [templateB64, ...(Array.isArray(card.references) ? (card.references as string[]) : [])],
        requestId,
        input.promptMode || "direct",
        ctx,
        { model },
      );
      if (!result?.b64) {
        error = { code: "CARD_NEWS_EMPTY_IMAGE", message: "No image data returned" };
      } else {
        await writeFile(join(dir, imageFilename), Buffer.from(result.b64, "base64"));
        invalidateHistoryIndex();
      }
    } catch (e) {
      const err = errInfo(e);
      error = { code: err.code || "CARD_NEWS_CARD_FAILED", message: err.message || "Card generation failed" };
    }
    const sidecar = {
      kind: "card-news-card",
      setId,
      sessionId: input.sessionId || null,
      requestId,
      cardId: card.id || `card_${cardOrder}`,
      cardOrder,
      title: input.title || "Untitled card news",
      role: card.role || "card",
      headline: card.headline || "",
      body: card.body || "",
      textFields: Array.isArray(card.textFields) ? card.textFields : [],
      imageTemplateId,
      generationStrategy: "parallel-template-i2i",
      templateBase,
      prompt,
      visualPrompt: card.visualPrompt || "",
      imageFilename: error ? null : imageFilename,
      sidecarFilename,
      locked: !!card.locked,
      status: error ? "error" : "generated",
      error,
      createdAt: Date.now(),
      generatedAt: error ? null : Date.now(),
      revisedPrompt: result?.revisedPrompt || null,
    };
    await writeCardSidecar(dir, sidecarFilename, sidecar);
    invalidateHistoryIndex();
    if (typeof options.onCardDone === "function") await options.onCardDone(sidecar);
    return sidecar;
  });

  const manifest = {
    kind: "card-news-set",
    setId,
    sessionId: input.sessionId || null,
    requestId: input.requestId || null,
    title: input.title || "Untitled card news",
    imageTemplateId,
    roleTemplateId: input.roleTemplateId || "mid-5",
    generationStrategy: "parallel-template-i2i",
    size,
    cardCount: generatedCards.length,
    createdAt: Date.now(),
    cards: generatedCards,
  };
  await writeCardNewsManifest(ctx.config.storage.generatedDir, manifest);
  invalidateHistoryIndex();
  return {
    setId,
    manifest,
    cards: generatedCards.map((card) => ({
      ...card,
      id: card.cardId,
      order: card.cardOrder,
      url: card.imageFilename
        ? `/generated/cardnews/${encodeURIComponent(setId)}/${encodeURIComponent(card.imageFilename)}`
        : undefined,
    })),
  };
}
