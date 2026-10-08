import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { PromptComposer } from "../../src/components/PromptComposer";
import { HomePromptComposer } from "../../src/components/home/HomePromptComposer";
import { useAppStore } from "../../src/store/useAppStore";
import type { AssetItem } from "../../src/store/storeTypes";
import type { Provider } from "../../src/types";
import type { ProviderAvailability } from "../../src/hooks/useProviderAvailability";

export type ComposerSurface = "sidebar" | "bottom" | "home";
export type ComposerSeed = { surface: ComposerSurface; prompt?: string; busy?: boolean };
export type ComposerObservation = ReturnType<typeof snapshot>;
export type { TransportAttempt } from "./isolatedComponentTransport";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
const calls: Array<{ prompt: string; negativePrompt: string; activeGenerations: number }> = [];
const selections: string[] = [];
const keys: Array<{ key: string; ctrl: boolean; meta: boolean; composing: boolean;
  keyCode: number; prevented: boolean; calls: number }> = [];
const modes: string[] = [];
let root: Root | undefined;
let unsubscribe: (() => void) | undefined;
const originalSelect = useAppStore.getState().addElementFromMention;
const originalMode = useAppStore.getState().setUIMode;

function snapshot() {
  const state = useAppStore.getState();
  return { calls: [...calls], selections: [...selections], keys: [...keys], modes: [...modes],
    prompt: state.prompt, negativePrompt: state.negativePrompt, uiMode: state.uiMode, provider: state.provider,
    tray: state.trayItems.map(({ tokenId, tag, kind }) => ({ tokenId, tag, kind })),
    retiredTags: { ...state.retiredTags }, missingElementIds: [...state.missingElementIds] };
}

function recordKey(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  // document bubbling happens after the target native menu and React root handlers.
  keys.push({ key: event.key, ctrl: event.ctrlKey, meta: event.metaKey,
    composing: event.isComposing, keyCode: event.keyCode,
    prevented: event.defaultPrevented, calls: calls.length });
}

function prepareStore(seed: ComposerSeed) {
  useAppStore.setState({ provider: "nai", imageModel: "nai-diffusion-5-full", locale: "en",
    prompt: seed.prompt ?? "A quiet Korean garden", negativePrompt: "unwanted blur",
    activeGenerations: seed.busy ? 1 : 0, uiMode: seed.surface === "home" ? "home" : "classic",
    multimode: false, videoModelSelected: false, promptMode: "direct",
    selectedPresetIds: [], insertedPrompts: [], trayItems: [], retiredTags: {},
    nextAttachmentOrdinal: 1, elementCatalog: null, missingElementIds: [],
    generate: async () => {
      try {
        const { prompt, negativePrompt, activeGenerations } = useAppStore.getState();
        calls.push({ prompt, negativePrompt, activeGenerations });
      } catch (error) { throw new Error("WP08 callback counter failed", { cause: error }); }
    },
    addElementFromMention: (asset) => { selections.push(asset.id); return originalSelect(asset); },
    setUIMode: (mode) => { modes.push(mode); originalMode(mode); },
  });
  unsubscribe = useAppStore.subscribe((state) => {
    if (state.elementCatalog !== null) document.documentElement.dataset.catalogReady = "true";
  });
}

function availability(): Record<Provider, ProviderAvailability> {
  const ready = { ok: true, reason: "Synthetic component fixture" };
  return { oauth: ready, api: ready, grok: ready, "grok-api": ready, agy: ready,
    "gemini-api": ready, atlascloud: ready, "88api": ready, minimax: ready, nai: ready, comfy: ready };
}

function mount(seed: ComposerSeed) {
  if (root) throw new Error("WP08 component already mounted");
  prepareStore(seed); // Every external generation callback is replaced BEFORE render.
  document.addEventListener("keydown", recordKey);
  const host = document.getElementById("root");
  if (!host) throw new Error("WP08 root missing");
  root = createRoot(host);
  flushSync(() => root!.render(seed.surface === "home"
    ? <HomePromptComposer providerAvailability={availability()} />
    : <PromptComposer variant={seed.surface} />));
  document.documentElement.dataset.componentReady = "true";
}

function retireAttachment() {
  const state = useAppStore.getState();
  // NAI intentionally has no reference admission. Use the public supported lane,
  // then restore NAI so the actual dual input/mirror contract is exercised.
  state.setProvider("oauth");
  state.addReferenceDataUrl(PNG);
  const item = useAppStore.getState().trayItems.find((entry) => entry.kind === "attachment");
  if (!item) throw new Error("WP08 public attachment admission failed");
  const text = Array.from({ length: 50 }, (_, i) =>
    `Line ${i}: cedar garden and a long winding stone path @${item.tag} after rain.`).join("\n");
  state.setPrompt(text);
  state.removeTrayItem(item.tokenId);
  state.setProvider(state.provider);
  return { tokenId: item.tokenId, tag: item.tag, text, admissionProvider: "oauth" };
}

function makeMissingElement() {
  const state = useAppStore.getState();
  const asset: AssetItem | undefined = state.elementCatalog?.[0];
  if (!asset) throw new Error("WP08 catalog not ready");
  state.setProvider("oauth");
  state.addTrayElement(asset.id);
  state.setProvider(state.provider);
  state.syncElementCatalog([]); // Public catalog refresh retires availability, not the tag.
}

function enableReferenceLane() { useAppStore.getState().setProvider("oauth"); }

function unmount() {
  flushSync(() => root?.unmount());
  root = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  document.removeEventListener("keydown", recordKey);
  // The disposable context keeps the counting generate boundary through close.
  // Restoring a live generation action during teardown would reopen transport.
  useAppStore.setState({ addElementFromMention: originalSelect, setUIMode: originalMode });
  document.documentElement.dataset.componentReady = "false";
}

export type ComposerController = {
  mount: typeof mount; snapshot: typeof snapshot; retireAttachment: typeof retireAttachment;
  makeMissingElement: typeof makeMissingElement; enableReferenceLane: typeof enableReferenceLane; unmount: typeof unmount;
};
declare global {
  interface Window {
    wp08?: ComposerController;
  }
}
window.wp08 = { mount, snapshot, retireAttachment, makeMissingElement, enableReferenceLane, unmount };
