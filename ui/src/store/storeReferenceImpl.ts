import type { EmbeddedGenerationMetadata, GenerateItem } from "../types";
import { readImageMetadata } from "../lib/api";
import { readFileAsDataURL } from "../lib/image";
import { compressToBase64, isHeic, hasAlphaChannel } from "../lib/compress";
import { parseRequestedCustomSide } from "../lib/size";
import { isImageModel, isImageToolModel, normalizeImageQuality } from "../lib/imageModels";
import { t } from "../i18n";
import {
  saveImageModel,
  isQuality,
  isFormat,
  isModeration,
  parseMetadataSize,
  saveGenerationDefaultsPatch,
} from "./storePersistence";
import { compressReferenceSource } from "./storeHelpers";
import type { AppState, StoreSet, StoreGet } from "./storeTypes";
import type { ClientNodeId } from "../lib/graph";
import {
  allocateAttachmentTag,
  hasTrayCapacity,
  retireTrayTags,
  reviveTrayTag,
  selectAttachmentItems,
  type AttachmentInput,
  type AttachmentMimeType,
  type AttachmentOrigin,
  type AttachmentTrayItem,
  type TrayItem,
} from "../lib/referenceTray";
import { mutateTrayImpl, type TrayMutation, type TrayMutationOutcome, type TrayMutationPatch } from "../lib/elementCatalog";
export { addTrayElementImpl, syncElementCatalogImpl } from "../lib/elementCatalog";

function applyMetadataToState(
  state: AppState,
  metadata: EmbeddedGenerationMetadata,
): Partial<AppState> {
  const patch: Partial<AppState> = {};
  const prompt = metadata.userPrompt || metadata.prompt;
  if (typeof prompt === "string") patch.prompt = prompt;
  patch.imageToolModel = state.provider === "api" && isImageToolModel(metadata.imageToolModel) ? metadata.imageToolModel : null;
  patch.quality = normalizeImageQuality(state.provider, patch.imageToolModel,
    isQuality(metadata.quality) ? metadata.quality : state.quality);
  if (isFormat(metadata.format)) patch.format = metadata.format;
  if (isModeration(metadata.moderation)) patch.moderation = metadata.moderation;
  if (metadata.promptMode === "auto" || metadata.promptMode === "direct") {
    patch.promptMode = metadata.promptMode;
  }
  if (metadata.model && isImageModel(metadata.model)) {
    patch.imageModel = metadata.model;
  }
  const size = parseMetadataSize(metadata.size);
  if (size.preset) patch.sizePreset = size.preset;
  if (size.preset === "custom" && size.w && size.h) {
    patch.customW = parseRequestedCustomSide(size.w, state.customW);
    patch.customH = parseRequestedCustomSide(size.h, state.customH);
  }
  return patch;
}

function mutateTray<Result>(set: StoreSet, mutation: TrayMutation<Result>): Result {
  // materializeLegacyFields(trayItems) remains centralized in mutateTrayImpl.
  return mutateTrayImpl(set, mutation);
}
function inferAttachmentMimeType(dataUrl: string): AttachmentMimeType | null {
  const mimeType = /^data:(image\/(?:png|jpeg|webp));/i.exec(dataUrl)?.[1]?.toLowerCase();
  if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp") {
    return mimeType;
  }
  return null;
}
function createAttachmentItem(input: AttachmentInput, tag: string): AttachmentTrayItem {
  return {
    kind: "attachment",
    tokenId: crypto.randomUUID(),
    tag,
    insertedAt: Date.now(),
    source: input,
        };
}
function addPreparedAttachments(inputs: AttachmentInput[], set: StoreSet): TrayItem[] {
  return mutateTray(set, (state, activeLimit) => {
    const trayItems = [...state.trayItems];
    let retiredTags = state.retiredTags;
    const usedTags = new Set(trayItems.map((item) => item.tag));
    const added: TrayItem[] = [];
    let nextAttachmentOrdinal = state.nextAttachmentOrdinal;

    for (const input of inputs) {
      if (!hasTrayCapacity(trayItems, activeLimit)) break;
      const allocation = allocateAttachmentTag(nextAttachmentOrdinal, usedTags);
      const item = createAttachmentItem(input, allocation.tag);
      trayItems.push(item);
      added.push(item);
      usedTags.add(item.tag);
      retiredTags = reviveTrayTag(retiredTags, item.tag);
      nextAttachmentOrdinal = allocation.nextAttachmentOrdinal;
    }

    return added.length === 0
      ? { result: added }
      : {
          result: added,
          patch: {
            trayItems,
            nextAttachmentOrdinal,
            retiredTags,
            providerUrlReference: null,
          },
        };
  });
}
export function addTrayAttachmentsImpl(inputs: AttachmentInput[], set: StoreSet, _get: StoreGet): TrayItem[] {
  return addPreparedAttachments(inputs, set);
}

export function addTrayAttachmentDataUrlImpl(
  dataUrl: string,
  origin: AttachmentOrigin,
  set: StoreSet,
  _get: StoreGet,
): TrayItem | null {
  const mimeType = inferAttachmentMimeType(dataUrl);
  if (!mimeType) return null;
  return addPreparedAttachments([{ dataUrl, mimeType, origin }], set)[0] ?? null;
}

export function addReferenceDataUrlImpl(dataUrl: string, set: StoreSet, get: StoreGet): void {
  addTrayAttachmentDataUrlImpl(dataUrl, "gallery", set, get);
}
export async function addReferencesImpl(
  files: File[],
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const maxReferences = get().activeReferenceLimit();
  const allowed = Math.max(0, maxReferences - get().trayItems.length);
  const candidates = files.slice(0, allowed);
  const heicSkipped = candidates.filter(isHeic);
  const usable = candidates.filter((f) => !isHeic(f));
  const results = await Promise.all(
    usable.map(async (f): Promise<AttachmentInput | null> => {
      try {
        const dataUrl = await compressToBase64(f, {
          preserveTransparency: hasAlphaChannel(f),
        });
        const mimeType = inferAttachmentMimeType(dataUrl);
        return mimeType
          ? { dataUrl, mimeType, originalName: f.name, byteSize: f.size, origin: "file" as const }
          : null;
      } catch (err) {
        console.warn("[addReferences] compress failed", err);
        return null;
      }
    }),
  );
  const valid = results.filter((input): input is AttachmentInput => input !== null);
  const added = addPreparedAttachments(valid, set);
  if (heicSkipped.length > 0) get().showToast(t("toast.refHeicUnsupported"), true);
  if (usable.length - valid.length > 0) get().showToast(t("toast.refTooLarge"), true);
  if (files.length > allowed || valid.length > added.length) {
    get().showToast(t("toast.refLimitExceeded"), true);
  }
}

export async function readDroppedImageMetadataImpl(
  file: File,
  targetNodeId: ClientNodeId | null,
  set: StoreSet,
  get: StoreGet,
): Promise<boolean> {
  if (!file.type.startsWith("image/")) return false;
  let dataUrl = "";
  try {
    dataUrl = await readFileAsDataURL(file);
    const result = await readImageMetadata({ filename: file.name, dataUrl });
    if (!result.metadata) return false;
    set({
      metadataRestore: {
        filename: file.name,
        image: dataUrl,
        metadata: result.metadata,
        source: result.source ?? "xmp",
        targetNodeId,
      },
    });
    return true;
  } catch {
    get().showToast(t("metadata.readFailed"), true);
    return false;
  }
}

export function applyMetadataRestoreImpl(set: StoreSet, get: StoreGet): void {
  const pending = get().metadataRestore;
  if (!pending) return;
  const patch = applyMetadataToState(get(), pending.metadata);
  saveGenerationDefaultsPatch({ imageToolModel: patch.imageToolModel, quality: patch.quality });
  if (patch.imageModel) saveImageModel(patch.imageModel);
  if (pending.targetNodeId && typeof patch.prompt === "string") {
    const prompt = patch.prompt;
    set({
      ...patch,
      metadataRestore: null,
      graphNodes: get().graphNodes.map((n) =>
        n.id === pending.targetNodeId
          ? { ...n, data: { ...n.data, prompt } }
          : n,
      ),
    });
    get().scheduleGraphSave();
  } else {
    set({ ...patch, metadataRestore: null });
  }
  get().showToast(t("metadata.applied"));
}

function withoutContinuityPrompts(state: AppState): AppState["insertedPrompts"] {
  return state.insertedPrompts.filter((prompt) => !prompt.id.startsWith("video-continuity:"));
}

function persistContinuityPromptChange(before: AppState["insertedPrompts"], after: AppState["insertedPrompts"]): void {
  if (after.length !== before.length) saveGenerationDefaultsPatch({ insertedPrompts: after });
}

export function removeTrayItemImpl(tokenId: string, set: StoreSet, get: StoreGet): void {
  const beforePrompts = get().insertedPrompts;
  mutateTray(set, (state) => {
    const removed = state.trayItems.find((item) => item.tokenId === tokenId);
    if (!removed) return { result: undefined };
    const trayItems = state.trayItems.filter((item) => item.tokenId !== tokenId);
    const patch: TrayMutationPatch = {
      trayItems,
      retiredTags: retireTrayTags(state.retiredTags, [removed]),
    };
    if (removed.kind === "attachment") {
      const clearContinuity = selectAttachmentItems({ trayItems }).length === 0;
      patch.canvasReferenceImage = removed.source.dataUrl === state.canvasReferenceImage
        ? null
        : state.canvasReferenceImage;
      if (clearContinuity) {
        patch.insertedPrompts = withoutContinuityPrompts(state);
        patch.videoContinuityLineage = null;
      }
    }
    return { result: undefined, patch };
  });
  persistContinuityPromptChange(beforePrompts, get().insertedPrompts);
}

export { removeTrayElementImpl } from "../lib/elementCatalog";

export function removeReferenceImpl(index: number, set: StoreSet, get: StoreGet): void {
  const item = selectAttachmentItems(get())[index];
  if (item) removeTrayItemImpl(item.tokenId, set, get);
}

export function clearReferencesImpl(set: StoreSet, get: StoreGet): void {
  const beforePrompts = get().insertedPrompts;
  mutateTray(set, (state) => {
    const removed = selectAttachmentItems(state);
    const trayItems = state.trayItems.filter((item) => item.kind !== "attachment");
    return {
      result: undefined,
      patch: {
        trayItems,
        retiredTags: retireTrayTags(state.retiredTags, removed),
        canvasReferenceImage: null,
        videoContinuityLineage: null,
        insertedPrompts: withoutContinuityPrompts(state),
        providerUrlReference: null,
      },
    };
  });
  persistContinuityPromptChange(beforePrompts, get().insertedPrompts);
}

export function clearTrayImpl(set: StoreSet, get: StoreGet): void {
  const beforePrompts = get().insertedPrompts;
  mutateTray(set, (state) => ({
    result: undefined,
    patch: {
      trayItems: [],
      retiredTags: {},
      canvasReferenceImage: null,
      videoContinuityLineage: null,
      insertedPrompts: withoutContinuityPrompts(state),
      providerUrlReference: null,
    },
  }));
  persistContinuityPromptChange(beforePrompts, get().insertedPrompts);
}

function replaceCanvasAttachment(
  state: AppState,
  activeLimit: number,
  input: AttachmentInput,
): TrayMutationOutcome<boolean> {
  const removed = selectAttachmentItems(state).filter(
    (candidate) => candidate.source.dataUrl === input.dataUrl
      || candidate.source.dataUrl === state.canvasReferenceImage,
  );
  const removedIds = new Set(removed.map((candidate) => candidate.tokenId));
  const trayItems = state.trayItems.filter((candidate) => !removedIds.has(candidate.tokenId));
  if (!hasTrayCapacity(trayItems, activeLimit)) return { result: false };
  const allocation = allocateAttachmentTag(
    state.nextAttachmentOrdinal,
    trayItems.map((candidate) => candidate.tag),
  );
  const attachment = createAttachmentItem(input, allocation.tag);
  const retiredTags = reviveTrayTag(
    retireTrayTags(state.retiredTags, removed),
    attachment.tag,
  );
  return {
    result: true,
    patch: {
      trayItems: [attachment, ...trayItems],
      nextAttachmentOrdinal: allocation.nextAttachmentOrdinal,
      retiredTags,
      canvasReferenceImage: input.dataUrl,
      providerUrlReference: null,
    },
  };
}

export async function attachCanvasVersionReferenceImpl(
  item: GenerateItem,
  set: StoreSet,
  get: StoreGet,
  overrideSource?: string,
): Promise<void> {
  let dataUrl: string;
  try {
    dataUrl = await compressReferenceSource(
      overrideSource ?? item.image,
      item.filename || "canvas-version-reference.png",
    );
  } catch {
    get().showToast(t("toast.currentImageLoadFailed"), true);
    throw new Error("canvas_reference_attach_failed");
  }
  const mimeType = inferAttachmentMimeType(dataUrl);
  if (!mimeType) {
    get().showToast(t("toast.currentImageLoadFailed"), true);
    return;
  }
  const added = mutateTray(
    set,
    (state, activeLimit) => replaceCanvasAttachment(state, activeLimit, {
      dataUrl,
      mimeType,
      originalName: item.filename || "canvas-version-reference.png",
      origin: "canvas",
    }),
  );
  if (!added) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  get().showToast(t("canvas.version.usingAsReference"));
}

// Canvas versions carry burned-in annotation pixels for UI display. Model
// payloads must use the clean source instead (policy from #96): resolve a
// canvas-version item to its original file before attaching it as a reference.
function resolveModelReferenceSrc(item: GenerateItem): string {
  if (item.canvasVersion && item.canvasSourceFilename) {
    return `/generated/${encodeURIComponent(item.canvasSourceFilename)}`;
  }
  return item.image;
}
export async function useCurrentAsReferenceImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const cur = get().currentImage;
  if (!cur) {
    get().showToast(t("toast.noCurrentImageForRef"), true);
    return;
  }
  if (get().trayItems.length >= get().activeReferenceLimit()) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  let dataUrl: string;
  try {
    dataUrl = await compressReferenceSource(
      resolveModelReferenceSrc(cur),
      cur.canvasSourceFilename || cur.filename || "current-reference.png",
    );
  } catch {
    get().showToast(t("toast.currentImageLoadFailed"), true);
    return;
  }
  const added = addTrayAttachmentDataUrlImpl(dataUrl, "gallery", set, get);
  if (!added) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  get().showToast(t("toast.addedCurrentAsRef"));
}

export async function useImageAsReferenceImpl(
  item: GenerateItem,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (get().trayItems.length >= get().activeReferenceLimit()) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  let dataUrl: string;
  try {
    dataUrl = await compressReferenceSource(
      resolveModelReferenceSrc(item),
      item.canvasSourceFilename || item.filename || "canvas-reference.png",
    );
  } catch {
    get().showToast(t("toast.currentImageLoadFailed"), true);
    return;
  }
  const added = addTrayAttachmentDataUrlImpl(dataUrl, "gallery", set, get);
  if (!added) {
    get().showToast(t("toast.refSlotFull"), true);
    return;
  }
  get().showToast(t("toast.addedCurrentAsRef"));
}
