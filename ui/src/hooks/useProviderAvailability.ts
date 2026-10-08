// 060 — provider availability hook, extracted verbatim from the retired
// ProviderSelect grid so readiness surfaces share one source of truth
// (devlog/_fin/260716_mcp-model-surface-ui/060).
import { useOAuthStatus } from "./useOAuthStatus";
import { useBilling } from "./useBilling";
import { useGrokStatus } from "./useGrokStatus";
import { useKeyStatus } from "./useKeyStatus";
import type { Provider } from "../types";
import { useI18n } from "../i18n";
import { useLaneCatalog } from "./useLaneCatalog";
import { deriveComfyDisplay, comfyDisplayMessageKey } from "../lib/comfyDisplay";
import { useAppStore } from "../store/useAppStore";

export type ProviderAvailability = {
  ok: boolean;
  reason: string;
  hint?: string;
  selectable?: boolean;
};

export function useProviderAvailability(): Record<Provider, ProviderAvailability> {
  const { t } = useI18n();
  const oauth = useOAuthStatus();
  const { data } = useBilling();
  const grok = useGrokStatus();
  const { data: keyStatus } = useKeyStatus();

  const oauthReady = oauth?.status === "ready";
  let oauthReason = t("provider.oauthNotReady");
  let oauthHint: string | undefined;
  if (oauth?.status === "auth_required") {
    oauthReason = t("provider.codexLoginRequired");
    oauthHint = t("provider.codexLoginHint");
  } else if (oauth?.status === "starting") {
    oauthReason = t("provider.oauthStarting");
  } else if (!oauth) {
    oauthReason = t("provider.serverUnreachable");
  }

  const apiOk = data?.apiKeyValid === true;

  const grokReady = grok?.status === "ready";
  const grokReason = !grok
    ? t("provider.grokNotReady")
    : grok.status === "offline"
      ? t("provider.grokOffline")
      : grok.status === "no_image_model"
        ? t("provider.grokNoImageModel")
        : grok.status === "error"
          ? t("provider.grokNotReady")
          : "";

  const xaiKeyOk = keyStatus?.xai?.valid === true;
  const geminiKeyOk = keyStatus?.gemini?.valid === true || keyStatus?.vertex?.valid === true;
  const atlasCloudKeyOk = keyStatus?.atlascloud?.valid === true;
  const api88ImageOk = keyStatus?.["api88-image"]?.valid === true;
  const api88VideoOk = keyStatus?.["api88-video"]?.valid === true;
  const selectedVideo = useAppStore((state) => state.videoModelSelected);
  const selectedProvider = useAppStore((state) => state.provider);
  const api88VideoSelected = selectedProvider === "88api" && Boolean(selectedVideo);
  const api88Ok = api88VideoSelected ? api88VideoOk : api88ImageOk;
  const minimaxKeyOk = keyStatus?.minimax?.valid === true;
  const naiKeyOk = keyStatus?.nai?.valid === true;
  const laneCatalog = useLaneCatalog();
  const comfyDisplay = deriveComfyDisplay(laneCatalog, null);

  return {
    oauth: { ok: oauthReady, reason: oauthReason, hint: oauthHint },
    api: {
      ok: apiOk,
      reason: apiOk ? "" : t("provider.apiInvalid"),
    },
    grok: {
      ok: grokReady,
      reason: grokReason,
      hint: grokReady ? undefined : t("provider.grokOfflineHint"),
    },
    "grok-api": {
      ok: xaiKeyOk,
      reason: xaiKeyOk ? "" : t("provider.xaiApiKeyRequired"),
    },
    agy: {
      ok: true,
      reason: "",
    },
    "gemini-api": {
      ok: geminiKeyOk,
      reason: geminiKeyOk ? "" : t("provider.geminiApiKeyRequired"),
    },
    atlascloud: {
      ok: atlasCloudKeyOk,
      reason: atlasCloudKeyOk ? "" : t("provider.atlasCloudApiKeyRequired"),
    },
    "88api": {
      ok: api88Ok,
      selectable: api88ImageOk || api88VideoOk,
      reason: api88Ok ? "" : api88VideoSelected ? t("provider.api88VideoKeyRequired") : t("provider.api88ImageKeyRequired"),
    },
    minimax: {
      ok: minimaxKeyOk,
      reason: minimaxKeyOk ? "" : t("provider.minimaxApiKeyRequired"),
    },
    nai: {
      ok: naiKeyOk,
      reason: naiKeyOk ? "" : t("provider.naiApiKeyRequired"),
    },
    comfy: {
      ok: comfyDisplay.laneAvailable,
      reason: t(comfyDisplay.laneAvailable ? "comfy.display.available" : comfyDisplayMessageKey(comfyDisplay, laneCatalog)),
      hint: t("comfy.display.chooseWorkflow"),
    },
  };
}
