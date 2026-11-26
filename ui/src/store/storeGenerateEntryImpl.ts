import type { ClientNodeId } from "../lib/graph";
import { effectiveCoreGenerationMode } from "../lib/coreGenerationMode";
import { t } from "../i18n";
import { composePrompt, formatSize } from "./storePersistence";
import { getCustomSizeConfirmation } from "./storeHelpers";
import { abortFlight } from "./flightAbortRegistry";
import type { StoreSet, StoreGet } from "./storeTypes";
import { runMediaGenerateImpl } from "./storeMediaImpl";

export async function generateImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const s = get();
  const prompt = composePrompt(s.prompt, s.insertedPrompts);
  if (!prompt) return;
  if (missingElementsBlock(get)) return;
  if (s.mediaSelection && s.uiMode === "classic") return runMediaGenerateImpl(set, get);
  const mode = effectiveCoreGenerationMode(s);
  if (mode === "video") return get().runVideoGenerate();
  // NovelAI never takes the multimode path: the persisted preference is left
  // untouched so other lanes keep it, but a hidden toggle must not steer this
  // one (devlog 004 B4).
  const useMultimode = mode === "multimode";
  const pending = getCustomSizeConfirmation(s, { kind: useMultimode ? "multimode" : "classic" });
  if (pending) {
    set({ customSizeConfirm: pending });
    return;
  }
  if (useMultimode) {
    await get().generateMultimode();
    return;
  }
  await get().runGenerate();
}

export function cancelMultimodeImpl(set: StoreSet, get: StoreGet): void {
  const flightId = get().multimodePreviewFlightId;
  if (!flightId) return;
  abortFlight(flightId);
  void get().cancelInFlightJob(flightId);
  set((state) => {
    const current = state.multimodeSequences[flightId];
    if (!current) return {};
    return {
      multimodeSequences: {
        ...state.multimodeSequences,
        [flightId]: { ...current, status: "canceled" },
      },
    };
  });
}

/** Missing element selections block every generation entry (higgsfield 110
 * EM-09). Returns true when blocked (and toasts). Checked at generateImpl,
 * custom-size approval, and animate — the check must also run AFTER any
 * modal, since catalog state can change while it is open. */
export function missingElementsBlock(get: StoreGet): boolean {
  if ((get().missingElementIds ?? []).length > 0) {
    get().showToast(t("toast.missingElements"), true);
    return true;
  }
  return false;
}

export async function confirmCustomSizeAdjustmentImpl(set: StoreSet, get: StoreGet): Promise<void> {
  const pending = get().customSizeConfirm;
  if (!pending) return;
  // Recheck missing only for classic/multimode continuations — node
  // continuations (node, node-in-place, node-variation) never send global
  // elementIds and are out of scope (110, Euler round 3).
  if ((pending.continuation.kind === "classic" || pending.continuation.kind === "multimode") && missingElementsBlock(get)) return;
  const adjustedSize = formatSize(pending.adjustedW, pending.adjustedH);
  set({
    customW: pending.adjustedW,
    customH: pending.adjustedH,
    customSizeConfirm: null,
  });
  if (pending.continuation.kind === "classic") {
    await get().runGenerate(adjustedSize);
    return;
  }
  if (pending.continuation.kind === "multimode") {
    await get().generateMultimode(adjustedSize);
    return;
  }
  if (pending.continuation.kind === "node-in-place") {
    await get().runGenerateNodeInPlace(pending.continuation.clientId, {
      sizeOverride: adjustedSize,
    });
    return;
  }
  if (pending.continuation.kind === "node-variation") {
    await get().generateNodeVariation(pending.continuation.clientId, adjustedSize);
    return;
  }
  await get().runGenerateNode(pending.continuation.clientId, adjustedSize);
}

export async function generateNodeImpl(
  clientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const node = get().graphNodes.find((n) => n.id === clientId);
  if (!node) return;
  const { prompt } = node.data;
  if (!prompt.trim()) {
    get().showToast(t("toast.promptRequired"), true);
    return;
  }
  if (get().videoModelSelected) return get().runVideoGenerate(clientId);
  const pending = getCustomSizeConfirmation(get(), { kind: "node", clientId });
  if (pending) {
    set({ customSizeConfirm: pending });
    return;
  }
  await get().runGenerateNode(clientId);
}

export async function generateNodeInPlaceImpl(
  clientId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const node = get().graphNodes.find((n) => n.id === clientId);
  if (!node) return;
  if (!node.data.prompt.trim()) {
    get().showToast(t("toast.promptRequired"), true);
    return;
  }
  if (get().videoModelSelected) return get().runVideoGenerate(clientId);
  const pending = getCustomSizeConfirmation(get(), { kind: "node-in-place", clientId });
  if (pending) {
    set({ customSizeConfirm: pending });
    return;
  }
  await get().runGenerateNodeInPlace(clientId);
}

export async function generateNodeVariationImpl(
  clientId: ClientNodeId,
  sizeOverride: string | undefined,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const source = get().graphNodes.find((n) => n.id === clientId);
  if (!source) return;
  if (!source.data.prompt.trim()) {
    get().showToast(t("toast.promptRequired"), true);
    return;
  }
  if (get().videoModelSelected) {
    const targetClientId = get().addSiblingNode(clientId);
    return get().runVideoGenerate(targetClientId);
  }
  if (!sizeOverride) {
    const pending = getCustomSizeConfirmation(get(), { kind: "node-variation", clientId });
    if (pending) {
      set({ customSizeConfirm: pending });
      return;
    }
  }
  const targetClientId = get().addSiblingNode(clientId);
  await get().runGenerateNodeInPlace(targetClientId, { sizeOverride });
}

export async function runGenerateNodeImpl(
  clientId: ClientNodeId,
  sizeOverride: string | undefined,
  _set: StoreSet,
  get: StoreGet,
): Promise<void> {
  const requestedNode = get().graphNodes.find((n) => n.id === clientId);
  const targetClientId = requestedNode?.data.status === "ready"
    ? get().addSiblingNode(clientId)
    : clientId;
  await get().runGenerateNodeInPlace(targetClientId, { sizeOverride });
}
