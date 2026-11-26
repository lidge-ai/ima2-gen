import type { Adjustment, MediaSelection } from "../lib/mediaSelection";
import { readStoredMediaFailure, saveMediaSelection, writeStoredMediaFailure } from "../lib/mediaSelectionStore";
import { buildMediaFailure, parseMediaFailure, type MediaFailure } from "../lib/mediaFailure";
import { prepareMediaInputs, submitMediaJob } from "../lib/mediaGenerate";
import { buildMediaSubmitBody } from "../lib/mediaSubmitBody";
import { getHistory } from "../lib/api";
import { composePrompt } from "./storePersistence";
import { HISTORY_LIMIT, mapHistoryItem, saveInFlight, isCanceledGenerationError } from "./storeHelpers";
import { registerFlightAbort, clearFlightAbort } from "./flightAbortRegistry";
import { addHistory } from "./storeGraphSave";
import type { StoreGet, StoreSet } from "./storeTypes";
import type { GenerateItem } from "../types";
import { getMediaCatalog, loadMediaCatalog } from "../lib/mediaCatalogStore";
import { remakePlan } from "../lib/mediaResult";
import { t } from "../i18n";

export function setMediaSelectionImpl(selection: MediaSelection | null, adjusted: Adjustment[] | undefined, set: StoreSet): void {
  saveMediaSelection(selection);
  set({ mediaSelection: selection, ...(adjusted || !selection ? { mediaAdjustments: adjusted ?? [] } : {}) });
}

export function loadMediaFailure(): MediaFailure | null {
  return parseMediaFailure(readStoredMediaFailure());
}

export function setMediaFailureImpl(failure: MediaFailure | null, set: StoreSet): void {
  writeStoredMediaFailure(failure);
  set({ mediaFailure: failure, ...(failure ? {} : { mediaKeyPrompt: null }) });
}

/** Puts the failed job's model back (its key is what needs replacing) and opens the key entry for that lane. */
export function promptMediaKeyImpl(failure: MediaFailure, set: StoreSet, get: StoreGet): void {
  if (failure.selection) get().setMediaSelection({ ...failure.selection, adapter: failure.adapter || failure.selection.adapter, routeMode: "pinned" });
  set({ mediaKeyPrompt: failure.adapter || null });
}

export async function retryMediaFailureImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const failure = get().mediaFailure;
  if (!failure?.selection) return;
  get().setMediaSelection(failure.selection);
  // The prompt that failed is shown again in the composer, so what runs is what the person sees.
  if (failure.prompt && !composePrompt(get().prompt, get().insertedPrompts)) get().setPrompt(failure.prompt);
  setMediaFailureImpl(null, set);
  await get().generate();
}

/** A job that failed while the page was away: the terminal record has the code and, once the server sends them, the category and retryable flag. */
export function recordTerminalMediaFailure(error: unknown, get: StoreGet): boolean {
  const media = (error as { media?: { requestId: string; adapter: string; model?: string; prompt?: string } } | null)?.media;
  if (!media || isCanceledGenerationError(error)) return false;
  const current = get().mediaSelection;
  const selection = current && current.model === media.model ? current : null;
  const { code, status, category, retryable } = error as { code?: unknown; status?: unknown; category?: unknown; retryable?: unknown };
  get().setMediaFailure(buildMediaFailure({ code, status, category, retryable }, { requestId: media.requestId, prompt: media.prompt ?? "", selection, adapter: media.adapter }));
  return true;
}

/**
 * Sets the composer up to make a result again: its model, the route it ran on, its settings and its
 * prompt. It stops there. The estimate is shown and Generate is one more press, because the run is paid.
 */
export async function remakeMediaResultImpl(item: GenerateItem, get: StoreGet): Promise<void> {
  await loadMediaCatalog();
  const catalog = getMediaCatalog();
  if (catalog.status !== "ready") { get().showToast(t("mediaPicker.loadError"), true); return; }
  const plan = remakePlan(item, catalog.models);
  if (!plan.ok) { get().showToast(t("result.remakeModelGone"), true); return; }
  if (get().uiMode !== "classic") get().setUIMode("classic");
  get().setMediaSelection(plan.selection, plan.adjusted);
  const prompt = item.userPrompt ?? item.prompt;
  if (prompt) { get().clearInsertedPrompts(); get().setPrompt(prompt); }
  get().showToast(t(plan.inputsDropped ? "result.remakeNeedsImages" : "result.remakeReady"));
}

/** Server job states to the phases the in-flight list has words for. */
function phaseOf(status: string): string {
  return status === "running" ? "streaming" : status;
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
  const flight = { id, prompt, startedAt, kind: selection.kind, sessionId: state.activeSessionId, model: selection.label ?? selection.model };
  const next = [...state.inFlight, flight];
  saveInFlight(next);
  set({ inFlight: next, activeGenerations: next.length });
  let adapter = selection.adapter;
  try {
    const refs = [...state.referenceImages, ...(state.providerUrlReference ? [state.providerUrlReference] : [])];
    const prepared = await prepareMediaInputs(selection, refs, controller.signal);
    adapter = prepared.adapter;
    // The adapter is always sent, so what runs is the route the panel showed (automatic resolves here, once).
    const payload = buildMediaSubmitBody({ ...selection, adapter }, prompt, id, state.activeSessionId, prepared.inputs);
    const phase = (value: string) => set((current) => ({ inFlight: current.inFlight.map((item) =>
      item.id === id ? { ...item, phase: value } : item) }));
    const outputs = await submitMediaJob(payload, id, controller.signal, {
      onSubmitted: () => { phase("streaming"); get().startInFlightPolling(); },
      onProgress: (data) => {
        if (typeof data.status === "string") phase(phaseOf(data.status));
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
    // A finished job answers the last failure; the card has nothing left to say.
    if (get().mediaFailure) setMediaFailureImpl(null, set);
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError") && !isCanceledGenerationError(error)) {
      const code = (error as { code?: unknown })?.code;
      const message = error instanceof Error ? error.message : String(error);
      // A job the server answered for is told once, by the failure card. A local refusal has no card and gets the toast.
      if (typeof code === "string") setMediaFailureImpl(buildMediaFailure(error, { requestId: id, prompt, selection: { ...selection, adapter }, adapter }), set);
      else get().showToast(message, true);
    }
  } finally {
    clearFlightAbort(id);
    const remaining = get().inFlight.filter((item) => item.id !== id);
    saveInFlight(remaining);
    set({ inFlight: remaining, activeGenerations: remaining.length, ...(selection.kind === "video" ? { videoProgress: null } : {}) });
    get().startInFlightPolling();
  }
}
