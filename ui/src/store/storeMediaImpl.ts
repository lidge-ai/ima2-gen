import type { Adjustment, MediaSelection } from "../lib/mediaSelection";
import { saveMediaSelection } from "../lib/mediaSelectionStore";
import { prepareMediaInputs, submitMediaJob } from "../lib/mediaGenerate";
import { buildMediaSubmitBody } from "../lib/mediaSubmitBody";
import { getHistory } from "../lib/api";
import { composePrompt } from "./storePersistence";
import { HISTORY_LIMIT, mapHistoryItem, saveInFlight, isCanceledGenerationError } from "./storeHelpers";
import { registerFlightAbort, clearFlightAbort } from "./flightAbortRegistry";
import { addHistory } from "./storeGraphSave";
import type { StoreGet, StoreSet } from "./storeTypes";

export function setMediaSelectionImpl(selection: MediaSelection | null, adjusted: Adjustment[] | undefined, set: StoreSet): void {
  saveMediaSelection(selection);
  set({ mediaSelection: selection, ...(adjusted || !selection ? { mediaAdjustments: adjusted ?? [] } : {}) });
}

export async function runMediaGenerateImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const state = get();
  const selection = state.mediaSelection;
  if (!selection) return;
  const prompt = composePrompt(state.prompt, state.insertedPrompts);
  if (!prompt) return;
  const id = `media_${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  registerFlightAbort(id, controller);
  const flight = { id, prompt, startedAt, kind: selection.kind, sessionId: state.activeSessionId };
  const next = [...state.inFlight, flight];
  saveInFlight(next);
  set({ inFlight: next, activeGenerations: next.length });
  try {
    const refs = [...state.referenceImages, ...(state.providerUrlReference ? [state.providerUrlReference] : [])];
    const { inputs, adapter } = await prepareMediaInputs(selection, refs, controller.signal);
    // The adapter is always sent, so what runs is the route the panel showed (automatic resolves here, once).
    const payload = buildMediaSubmitBody({ ...selection, adapter }, prompt, id, state.activeSessionId, inputs);
    const phase = (value: string) => set((current) => ({ inFlight: current.inFlight.map((item) =>
      item.id === id ? { ...item, phase: value } : item) }));
    const outputs = await submitMediaJob(payload, id, controller.signal, {
      onSubmitted: () => { phase("streaming"); get().startInFlightPolling(); },
      onProgress: (data) => {
        if (typeof data.status === "string") phase(data.status);
        if (selection.kind === "video") set({ videoProgress: typeof data.progress === "number" ? data.progress : null });
      },
    });
    const history = await getHistory({ limit: HISTORY_LIMIT });
    const items = outputs.map((output) => {
      const saved = history.items.find((item) => item.filename === output.filename);
      return saved ? mapHistoryItem(saved) : { image: output.url, url: output.url, filename: output.filename,
        mediaType: output.mediaType, prompt, requestId: id, sessionId: state.activeSessionId, createdAt: Date.now() };
    });
    for (const item of items) await addHistory(item, set, get, { autoSelectStartedAt: startedAt });
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError") && !isCanceledGenerationError(error)) {
      const code = (error as { code?: unknown })?.code;
      const message = error instanceof Error ? error.message : String(error);
      get().showToast(typeof code === "string" ? `${code}: ${message}` : message, true);
    }
  } finally {
    clearFlightAbort(id);
    const remaining = get().inFlight.filter((item) => item.id !== id);
    saveInFlight(remaining);
    set({ inFlight: remaining, activeGenerations: remaining.length, ...(selection.kind === "video" ? { videoProgress: null } : {}) });
    get().startInFlightPolling();
  }
}
