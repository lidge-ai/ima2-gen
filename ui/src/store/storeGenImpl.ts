import type {
  GenerateItem,
  GenerateResponse,
  MultimodeGenerateResponse,
} from "../types";
import { isMultiResponse } from "../types";
import {
  postGenerateStream,
  postMultimodeGenerateStream,
} from "../lib/api";
import { handleError } from "../lib/errorHandler";
import { t } from "../i18n";
import {
  composePrompt,
  cloneInsertedPrompts,
  normalizeCount,
} from "./storePersistence";
import {
  type PersistedInFlight,
  stripDataUrlPrefix,
  saveInFlight,
  mergeMultimodeImages,
  isCanceledGenerationError,
  type MultimodeSequenceState,
} from "./storeHelpers";
import { addHistory } from "./storeGraphSave";
import type { AppState } from "./storeTypes";
import { naiPayloadFields } from "../lib/naiPayload";
import { clearFlightAbort, registerFlightAbort } from "./flightAbortRegistry";
import { compilePresets, type PresetProvider } from "../../../lib/presetCompiler.js";
import { getAllPresets } from "../lib/presets";
import { coreImageRequestModel } from "../lib/coreSelection";

type StoreSet = (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
type StoreGet = () => AppState;

function selectedElementIds(state: AppState): string[] {
  const ids = (state as AppState & { selectedElementIds?: unknown }).selectedElementIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function toPresetProvider(provider: AppState["provider"]): PresetProvider {
  if (provider === "grok" || provider === "grok-api") return "grok";
  if (provider === "gemini-api") return "gemini";
  return "gpt";
}

export async function generateMultimodeImpl(
  sizeOverride: string | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const s = get();
  if (s.uiMode !== "classic") return;
  const userPrompt = composePrompt(s.prompt, s.insertedPrompts);
  if (!userPrompt) return;
  const compiled = compilePresets({
    catalog: getAllPresets(),
    presetIds: s.selectedPresetIds,
    provider: toPresetProvider(s.provider),
    mode: "image",
  });
  const prompt = compiled.promptFragment
    ? `${compiled.promptFragment} ${userPrompt}`
    : userPrompt;
  const composerPrompt = s.prompt;
  const composerInsertedPrompts = cloneInsertedPrompts(s.insertedPrompts);
  const size = sizeOverride ?? s.getResolvedSize();
  const flightId = `mm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  registerFlightAbort(flightId, controller);
  const startedAt = Date.now();
  const autoSelectStartedAt = startedAt;
  const requested = normalizeCount(s.multimodeMaxImages);
  const nextInFlight: PersistedInFlight[] = [
    ...s.inFlight,
    {
      id: flightId,
      prompt,
      startedAt,
      kind: "multimode",
      composerPrompt,
      composerInsertedPrompts,
    },
  ];
  const initialSequence: MultimodeSequenceState = {
    sequenceId: flightId,
    requestId: flightId,
    requested,
    returned: 0,
    images: [],
    partials: [],
    status: "pending",
  };
  saveInFlight(nextInFlight);
  set({
    activeGenerations: s.activeGenerations + 1,
    inFlight: nextInFlight,
    activeFlightIds: new Set([...s.activeFlightIds, flightId]),
    multimodeSequences: { ...s.multimodeSequences, [flightId]: initialSequence },
    multimodePreviewFlightId: flightId,
  });
  get().startInFlightPolling();

  try {
    const payload = {
      prompt,
      quality: s.quality,
      size,
      format: s.format,
      moderation: s.moderation,
      provider: s.provider,
      maxImages: requested,
      model: coreImageRequestModel(s),
      ...(s.provider === "api" && s.imageToolModel ? { imageToolModel: s.imageToolModel } : {}),
      reasoningEffort: s.reasoningEffort,
      webSearchEnabled: s.webSearchEnabled,
      requestId: flightId,
      mode: s.promptMode,
      composerPrompt,
      composerInsertedPrompts,
      presetIds: compiled.appliedPresetIds,
      elementIds: selectedElementIds(s),
      ...naiPayloadFields(s),
      ...(s.providerUrlReference
        ? { providerUrl: s.providerUrlReference }
        : s.referenceImages.length
          ? { references: s.referenceImages.map(stripDataUrlPrefix) }
          : {}),
    };
    const res: MultimodeGenerateResponse = await postMultimodeGenerateStream(
      payload,
      {
        onPartial: (partial) => {
          set((state) => {
            const current = state.multimodeSequences[flightId];
            if (!current) return {};
            return {
              multimodeSequences: {
                ...state.multimodeSequences,
                [flightId]: {
                  ...current,
                  partials: [
                    ...current.partials,
                    { image: partial.image, index: partial.index ?? null },
                  ].slice(-requested),
                },
              },
            };
          });
        },
        onImage: (image) => {
          set((state) => {
            const current = state.multimodeSequences[flightId];
            if (!current) return {};
            const images = mergeMultimodeImages(current.images, [image]);
            if (images.length === current.images.length) return {};
            return {
              multimodeSequences: {
                ...state.multimodeSequences,
                [flightId]: {
                  ...current,
                  sequenceId: image.sequenceId ?? current.sequenceId,
                  returned: images.length,
                  images,
                  status: "partial",
                },
              },
            };
          });
        },
      },
      { signal: controller.signal },
    );

    const items = res.images.map((image) => ({
      ...image,
      prompt,
      elapsed: Number.parseFloat(res.elapsed),
      provider: res.provider,
      usage: res.usage,
      requestId: image.requestId ?? res.requestId ?? flightId,
      composerPrompt,
      composerInsertedPrompts,
      quality: res.quality,
      size: res.size,
      model: res.model ?? null,
      imageToolModel: res.imageToolModel ?? null,
    }));
    for (const item of items) {
      await addHistory(item, set, get, { autoSelectStartedAt });
    }
    set((state) => ({
      multimodeSequences: {
        ...state.multimodeSequences,
        [flightId]: (() => {
          const current = state.multimodeSequences[flightId];
          const images = mergeMultimodeImages(current?.images ?? [], items);
          return {
            sequenceId: res.sequenceId,
            requestId: flightId,
            requested: res.requested,
            returned: images.length,
            images,
            partials: [],
            status: res.status,
            elapsed: res.elapsed,
          };
        })(),
      },
    }));
    const toastKey = res.status === "complete" ? "multimode.complete" : "multimode.partial";
    get().showToast(t(toastKey, { returned: res.returned, requested: res.requested, elapsed: res.elapsed }));
  } catch (err) {
    if ((err as Error).name === "AbortError" || isCanceledGenerationError(err)) {
      set((state) => {
        const current = state.multimodeSequences[flightId];
        if (!current) return {};
        return {
          multimodeSequences: {
            ...state.multimodeSequences,
            [flightId]: {
              ...current,
              status: "canceled",
            },
          },
        };
      });
    } else {
      set((state) => {
        const current = state.multimodeSequences[flightId];
        if (!current) return {};
        return {
          multimodeSequences: {
            ...state.multimodeSequences,
            [flightId]: { ...current, status: "error", error: (err as Error).message },
          },
        };
      });
      handleError(err, get());
    }
  } finally {
    const remaining = get().inFlight.filter((f) => f.id !== flightId);
    saveInFlight(remaining);
    clearFlightAbort(flightId);
    set((state) => {
      const nextFlights = new Set(state.activeFlightIds);
      nextFlights.delete(flightId);
      let nextPreview = state.multimodePreviewFlightId;
      const finalStatus = state.multimodeSequences[flightId]?.status;
      const isCleanFinish = finalStatus === "complete" || finalStatus === "partial";
      if (nextPreview === flightId && !isCleanFinish) {
        const fallbackIds = [...nextFlights];
        nextPreview = fallbackIds.length > 0
          ? fallbackIds[fallbackIds.length - 1]
          : null;
      }
      const nextSequences = { ...state.multimodeSequences };
      if (isCleanFinish && nextPreview !== flightId) {
        delete nextSequences[flightId];
      }
      return {
        activeGenerations: Math.max(0, state.activeGenerations - 1),
        inFlight: remaining,
        activeFlightIds: nextFlights,
        multimodePreviewFlightId: nextPreview,
        multimodeSequences: nextSequences,
      };
    });
  }
}

export async function runGenerateImpl(
  sizeOverride: string | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const s = get();
  const userPrompt = composePrompt(s.prompt, s.insertedPrompts);
  if (!userPrompt) return;
  const compiled = compilePresets({
    catalog: getAllPresets(),
    presetIds: s.selectedPresetIds,
    provider: toPresetProvider(s.provider),
    mode: "image",
  });
  const prompt = compiled.promptFragment
    ? `${compiled.promptFragment} ${userPrompt}`
    : userPrompt;
  const composerPrompt = s.prompt;
  const composerInsertedPrompts = cloneInsertedPrompts(s.insertedPrompts);

  const size = sizeOverride ?? s.getResolvedSize();

  const flightId = `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const controller = new AbortController();
  registerFlightAbort(flightId, controller);
  const startedAt = Date.now();
  const autoSelectStartedAt = startedAt;
  const nextInFlight: PersistedInFlight[] = [
    ...s.inFlight,
    { id: flightId, prompt, startedAt, composerPrompt, composerInsertedPrompts },
  ];
  saveInFlight(nextInFlight);
  set({
    activeGenerations: s.activeGenerations + 1,
    inFlight: nextInFlight,
  });
  get().startInFlightPolling();

  try {
    const payload = {
      prompt,
      quality: s.quality,
      size,
      format: s.format,
      moderation: s.moderation,
      provider: s.provider,
      // NovelAI's Opus free tier covers one image per request, and the server
      // fans this out into n separate upstream calls. Forcing 1 is the behavior
      // that makes hiding CountPicker honest instead of cosmetic.
      n: s.provider === "nai" ? 1 : s.count,
      model: coreImageRequestModel(s),
      ...(s.provider === "api" && s.imageToolModel ? { imageToolModel: s.imageToolModel } : {}),
      reasoningEffort: s.reasoningEffort,
      storyboard: s.storyboardActive || undefined,
      webSearchEnabled: s.webSearchEnabled,
      requestId: flightId,
      mode: s.promptMode,
      composerPrompt,
      composerInsertedPrompts,
      presetIds: compiled.appliedPresetIds,
      elementIds: selectedElementIds(s),
      ...naiPayloadFields(s),
      ...(s.providerUrlReference
        ? { providerUrl: s.providerUrlReference }
        : s.referenceImages.length
          ? { references: s.referenceImages.map(stripDataUrlPrefix) }
          : {}),
    };

    const res: GenerateResponse = await postGenerateStream(payload, { signal: controller.signal });

    if (isMultiResponse(res) && res.images.length > 1) {
      for (const img of res.images) {
        const item: GenerateItem = {
          image: img.image,
          filename: img.filename,
          reasoningEffort: res.reasoningEffort,
          prompt,
          composerPrompt,
          composerInsertedPrompts,
          elapsed: res.elapsed,
          provider: res.provider,
          providerUrl: img.providerUrl ?? null,
          usage: res.usage,
          requestId: res.requestId ?? flightId,
          quality: res.quality,
          size: res.size,
          model: res.model ?? null,
          imageToolModel: res.imageToolModel ?? null,
          createdAt: img.createdAt ?? Date.now(),
        };
        await addHistory(item, set, get, { autoSelectStartedAt });
      }
      get().showToast(t("toast.generatedBatch", { count: res.images.length, elapsed: res.elapsed }));
    } else {
      let item: GenerateItem;
      if (isMultiResponse(res)) {
        const first = res.images[0];
        item = {
          image: first.image,
          filename: first.filename,
          reasoningEffort: res.reasoningEffort,
          prompt,
          composerPrompt,
          composerInsertedPrompts,
          elapsed: res.elapsed,
          provider: res.provider,
          providerUrl: first.providerUrl ?? null,
          usage: res.usage,
          requestId: res.requestId ?? flightId,
          quality: res.quality,
          size: res.size,
          model: res.model ?? null,
          imageToolModel: res.imageToolModel ?? null,
          createdAt: first.createdAt ?? Date.now(),
        };
      } else {
        item = {
          image: res.image,
          filename: res.filename,
          reasoningEffort: res.reasoningEffort,
          prompt,
          composerPrompt,
          composerInsertedPrompts,
          elapsed: res.elapsed,
          provider: res.provider,
          providerUrl: res.providerUrl ?? null,
          usage: res.usage,
          requestId: res.requestId ?? flightId,
          quality: res.quality,
          size: res.size,
          model: res.model ?? null,
          imageToolModel: res.imageToolModel ?? null,
          createdAt: res.createdAt ?? Date.now(),
        };
      }
      await addHistory(item, set, get, { autoSelectStartedAt });
      get().showToast(t("toast.generatedSingle", { elapsed: res.elapsed }));
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === "AbortError") && !isCanceledGenerationError(err)) handleError(err, get());
  } finally {
    const remaining = get().inFlight.filter((f) => f.id !== flightId);
    saveInFlight(remaining);
    clearFlightAbort(flightId);
    set({
      activeGenerations: Math.max(0, get().activeGenerations - 1),
      inFlight: remaining,
    });
  }
}
