import { fetchApi } from "./api-core";
/**
 * Phase 040 — Shared chaining actions for gallery tiles, history strip,
 * result viewer, and any future surface. Each action takes a GenerateItem
 * and performs a context-move using existing store/lib paths (no new server API).
 */
import type { GenerateItem } from "../types";
import { isVideoItem } from "./videoMedia";
import { isAudioItem } from "./audioMedia";

/* ── Action definitions ── */

export type ChainingActionId = "animate" | "edit" | "useAsRef" | "rebake" | "saveToAssets" | "saveAsElement";

export interface ChainingAction {
  id: ChainingActionId;
  labelKey: string;
  /** Return false to hide the action for this item. */
  available: (item: GenerateItem) => boolean;
}

export const CHAINING_ACTIONS: ChainingAction[] = [
  {
    id: "animate",
    labelKey: "chain.animate",
    available: (item) => Boolean(item.filename) && !isVideoItem(item) && !isAudioItem(item),
  },
  {
    id: "edit",
    labelKey: "chain.edit",
    available: (item) => Boolean(item.filename) && !isVideoItem(item) && !isAudioItem(item),
  },
  {
    id: "useAsRef",
    labelKey: "chain.useAsRef",
    available: (item) => Boolean(item.image || item.url) && !isAudioItem(item),
  },
  {
    id: "rebake",
    labelKey: "chain.rebake",
    available: (item) => Boolean(item.prompt || item.filename),
  },
  {
    id: "saveToAssets",
    labelKey: "chain.saveToAssets",
    available: (item) => Boolean(item.filename) && !isAudioItem(item),
  },
  {
    id: "saveAsElement",
    labelKey: "chain.saveAsElement",
    available: (item) => Boolean(item.filename) && !isVideoItem(item) && !isAudioItem(item),
  },
];

/* ── Execution (calls into the Zustand store) ── */

export type ChainingTranslate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * Execute a chaining action. Reads the store at call time via getState()
 * to avoid subscribing tiles to the entire store.
 */
export async function executeChaining(
  actionId: ChainingActionId,
  item: GenerateItem,
  getStore: () => {
    animateImage: (filename: string, prompt?: string) => Promise<boolean>;
    openCanvas: () => void;
    selectHistory: (item: GenerateItem) => void;
    addReferences: (files: File[]) => Promise<void>;
    showToast: (message: string, isError?: boolean) => void;
    saveToAssets: (item: GenerateItem) => Promise<boolean>;
    saveAsElement?: (item: GenerateItem) => Promise<boolean>;
  },
  t: ChainingTranslate,
): Promise<void> {
  const store = getStore();
  switch (actionId) {
    case "animate": {
      if (!item.filename) return;
      try {
        const started = await store.animateImage(item.filename, item.prompt ?? undefined);
        if (started) store.showToast(t("toast.animateDone"));
      } catch (error) {
        store.showToast(
          error instanceof Error ? error.message : t("toast.animateFailed"),
          true,
        );
      }
      break;
    }
    case "edit": {
      store.selectHistory(item);
      store.openCanvas();
      break;
    }
    case "useAsRef": {
      const src = item.url || item.image;
      if (!src) return;
      try {
        const response = await fetchApi(src);
        const blob = await response.blob();
        const file = new File([blob], item.filename || "reference.png", { type: blob.type });
        await store.addReferences([file]);
        store.showToast(t("chain.refAdded"));
      } catch (error) {
        if ((error as { code?: string } | null)?.code === "LAN_TOKEN_REQUIRED") return;
        store.showToast(t("chain.refFailed"), true);
      }
      break;
    }
    case "rebake": {
      try {
        const { continueFromItem } = await import("./continueFromItem");
        const result = await continueFromItem(item);
        store.showToast(t(result.hasPrompt ? "toast.forkStarted" : "toast.forkStartedNoPrompt"));
      } catch {
        store.showToast(t("toast.forkFailed"), true);
      }
      // Focus the prompt composer
      const promptEl = document.querySelector<HTMLTextAreaElement>(
        'textarea[name="prompt"], textarea#prompt, .sidebar textarea',
      );
      if (promptEl) {
        promptEl.focus();
        promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
      }
      break;
    }
    case "saveToAssets": {
      try {
        const ok = await store.saveToAssets(item);
        store.showToast(t(ok ? "chain.savedToAssets" : "chain.saveToAssetsFailed"), !ok);
      } catch {
        store.showToast(t("chain.saveToAssetsFailed"), true);
      }
      break;
    }
    case "saveAsElement": {
      try {
        const ok = await store.saveAsElement?.(item);
        store.showToast(t(ok ? "chain.savedToAssets" : "chain.saveToAssetsFailed"), !ok);
      } catch {
        store.showToast(t("chain.saveToAssetsFailed"), true);
      }
      break;
    }
  }
}
