import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { VideoControlsPanel } from "../../src/components/VideoControlsPanel";
import { PromptComposer } from "../../src/components/PromptComposer";
import { GenerateButton } from "../../src/components/GenerateButton";
import { Toast } from "../../src/components/Toast";
import { useAppStore } from "../../src/store/useAppStore";
import { composePrompt } from "../../src/store/storePersistence";
import { abortFlight } from "../../src/store/flightAbortRegistry";
import { stopInFlightPollingImpl } from "../../src/store/storeInflightImpl";
import { IN_FLIGHT_STORAGE_KEY } from "../../src/store/persistenceRegistry";
import type { Locale } from "../../src/i18n";
import type { VideoGenerateRequest, postVideoGenerateStream } from "../../src/lib/api-generation";
import type { readImageMetadata } from "../../src/lib/api-canvas";

export type SoundSeed = { locale: Locale; prompt: string; chips: boolean };
const requests: VideoGenerateRequest[] = [];
const metadata: Array<{ filename: string; dataUrl: string }> = [];
const pending = new Map<string, () => void>();
const signals = new Map<string, AbortSignal>();
const work = new Set<Promise<void>>();
const controllerChecks: boolean[] = [];
let pollingCalls = 0;
let root: Root | undefined;
const originalGenerate = useAppStore.getState().generate;
const lineage = { lineageId: "wp3", parentFilename: null, sourceFrame: null,
  maxEntries: 4, retention: "keep-start-plus-latest-3", entries: [] } as const;

const videoBoundary: typeof postVideoGenerateStream = (payload, _handlers, options) => {
  requests.push(structuredClone(payload));
  if (!payload.requestId || !options?.signal) throw new Error("WP3 missing flight identity");
  signals.set(payload.requestId, options.signal);
  return new Promise((_resolve, reject) => {
    pending.set(payload.requestId!, () => {
      pending.delete(payload.requestId!);
      reject(Object.assign(new Error("WP3 controlled cancellation"), { code: "GENERATION_CANCELED", status: 499 }));
    });
  });
};
const metadataBoundary: typeof readImageMetadata = async (input) => {
  metadata.push(structuredClone(input));
  return { ok: true, metadata: null, source: null };
};

function trackedGenerate(): Promise<void> {
  const task = originalGenerate();
  work.add(task);
  void task.finally(() => work.delete(task));
  return task;
}

function seedInitial(seed: SoundSeed) {
  const state = useAppStore.getState();
  state.selectVideoModel("grok-imagine-video-1.5");
  state.setPrompt(seed.prompt);
  state.clearInsertedPrompts();
  if (!seed.chips) return;
  state.insertPromptToComposer({ id: "ordinary-before", name: "Before", text: "BEFORE", placement: "before" });
  state.insertPromptToComposer({ id: "video-continuity:wp3", name: "Continuity", text: "CONTINUITY", placement: "before" });
  state.insertPromptToComposer({ id: "ordinary-after", name: "After", text: "AFTER", placement: "after" });
  useAppStore.setState({ videoContinuityLineage: { ...lineage, entries: [] } });
}

function Surface() {
  const isVideo = useAppStore((state) => !!state.videoModelSelected);
  return <>
    {isVideo ? <VideoControlsPanel /> : null}
    <PromptComposer variant="sidebar" />
    <GenerateButton />
    <Toast />
  </>;
}

function mount(seed: SoundSeed, fresh: boolean) {
  if (root) throw new Error("WP3 already mounted");
  useAppStore.setState({ activeSessionId: null, uiMode: "classic", selectedPresetIds: [],
    multimode: false, promptMode: "direct", startInFlightPolling: () => { pollingCalls += 1; },
    generate: trackedGenerate });
  if (fresh) seedInitial(seed);
  // The network fixture resets locale on navigation. This is NOT locale persistence.
  useAppStore.getState().setLocale(seed.locale);
  const host = document.getElementById("root");
  if (!host) throw new Error("WP3 missing root");
  root = createRoot(host);
  flushSync(() => root!.render(<Surface />));
  document.documentElement.dataset.soundReady = "true";
}

function snapshot() {
  const s = useAppStore.getState();
  const timer = (window as Window & { __ima2InflightTimer?: number }).__ima2InflightTimer;
  return { uiMode: s.uiMode, prompt: s.prompt, chips: s.insertedPrompts, lineage: s.videoContinuityLineage,
    composed: composePrompt(s.prompt, s.insertedPrompts), model: s.videoModelSelected, locale: s.locale,
    tray: s.trayItems, references: s.referenceImages, toasts: s.toastLog, requests: [...requests],
    metadata: metadata.map((m) => ({ filename: m.filename, png: m.dataUrl.startsWith("data:image/png;base64,") })),
    inFlight: s.inFlight, activeGenerations: s.activeGenerations, videoProgress: s.videoProgress,
    storedFlights: JSON.parse(localStorage.getItem(IN_FLIGHT_STORAGE_KEY) ?? "[]") as unknown[],
    pollingCalls, timerAbsent: timer === undefined, pending: pending.size, work: work.size,
    controllerChecks: [...controllerChecks] };
}

async function settle() {
  for (const reject of [...pending.values()]) reject();
  await Promise.all([...work]);
  for (const [id, signal] of signals) {
    if (signal.aborted) throw new Error("WP3 signal unexpectedly aborted before cleanup probe");
    abortFlight(id);
    controllerChecks.push(!signal.aborted);
  }
  signals.clear();
  return snapshot();
}

async function unmount() {
  const state = await settle();
  if (state.pending || state.work || state.inFlight.length || state.activeGenerations
    || !state.timerAbsent || state.storedFlights.length || state.controllerChecks.some((ok) => !ok)) {
    throw new Error("WP3 leaked generation resources");
  }
  stopInFlightPollingImpl(); // Defensive only; the assertion above must pass first.
  flushSync(() => root?.unmount());
  root = undefined;
  document.documentElement.dataset.soundReady = "false";
  return state;
}

function uiMode(mode: "node" | "classic") { useAppStore.getState().setUIMode(mode); }
function imageMode() { useAppStore.getState().setImageModel("gpt-5.6-luna"); }
function videoMode() { useAppStore.getState().selectVideoModel("grok-imagine-video-1.5"); }
export type SoundController = { mount: typeof mount; snapshot: typeof snapshot; settle: typeof settle;
  unmount: typeof unmount; uiMode: typeof uiMode; imageMode: typeof imageMode; videoMode: typeof videoMode };
declare global {
  interface Window {
    wp3Sound: SoundController;
    wp3VideoBoundary: typeof postVideoGenerateStream;
    wp3MetadataBoundary: typeof readImageMetadata;
  }
}
window.wp3Sound = { mount, snapshot, settle, unmount, uiMode, imageMode, videoMode };
window.wp3VideoBoundary = videoBoundary;
window.wp3MetadataBoundary = metadataBoundary;
