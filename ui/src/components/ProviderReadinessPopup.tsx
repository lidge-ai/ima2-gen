import { useI18n } from "../i18n";
import { getImageModelOptionsForProvider } from "../lib/imageModels";
import { useAppStore } from "../store/useAppStore";
import { useProviderAvailability } from "../hooks/useProviderAvailability";
import { useModalFocus } from "../hooks/useModalFocus";
import { useLaneCatalog } from "../hooks/useLaneCatalog";
import { deriveComfyDisplay, comfyDisplayMessageKey } from "../lib/comfyDisplay";
import { McpReadinessDetails } from "./McpReadinessDetails";

/**
 * Short readiness-facts label per lane. Kept exhaustive rather than a ternary
 * chain so a newly registered lane (nai) never silently renders "GPT API".
 */
const PROVIDER_READINESS_LABELS: Record<string, string> = {
  oauth: "GPT OAuth",
  api: "GPT API",
  grok: "Grok OAuth",
  "grok-api": "Grok API",
  agy: "Gemini",
  "gemini-api": "Gemini API",
  atlascloud: "Atlas Cloud",
  "88api": "88API",
  minimax: "MiniMax",
  nai: "NovelAI",
  comfy: "ComfyUI",
};

export function ProviderReadinessPopup() {
  const { t } = useI18n();
  const open = useAppStore((s) => s.readinessPopupOpen);
  const close = useAppStore((s) => s.closeReadinessPopup);
  const openSettings = useAppStore((s) => s.openSettings);
  const provider = useAppStore((s) => s.provider);
  const mcpProvider = useAppStore((s) => s.mcpProvider ?? null);
  const imageModel = useAppStore((s) => s.imageModel);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const webSearchEnabled = useAppStore((s) => s.webSearchEnabled);
  const comfyWorkflow = useAppStore((s) => s.comfyWorkflow);
  const comfyVideoWorkflow = useAppStore((s) => s.comfyVideoWorkflow);
  const availability = useProviderAvailability();
  const laneCatalog = useLaneCatalog();
  const isGrok = provider === "grok";
  const imageModelOption = getImageModelOptionsForProvider(provider).find((option) => option.value === imageModel);
  const modalRef = useModalFocus<HTMLDivElement>(open, close);

  if (!open) return null;
  const current = availability[provider];
  const comfyDisplay = deriveComfyDisplay(laneCatalog, { comfyWorkflow, comfyVideoWorkflow });
  const isComfy = provider === "comfy" && !mcpProvider;
  const ready = isComfy ? comfyDisplay.selectedAvailable : current.ok;

  const goAccount = () => {
    close();
    openSettings("providers");
  };

  return (
    <div className="modal-backdrop provider-readiness-backdrop" onClick={close} role="presentation">
      <div
        ref={modalRef}
        className="modal provider-readiness"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-readiness-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div id="provider-readiness-title" className="modal__title">
          {t("readiness.title")}
        </div>
        <div className="modal__body provider-readiness__body">
          {mcpProvider ? <McpReadinessDetails /> : null}
          {!mcpProvider && <>
          <div className={`provider-readiness__status${ready ? " is-ok" : " is-blocked"}`}>
            <span aria-hidden="true" />
            <strong>{isComfy ? t(comfyDisplayMessageKey(comfyDisplay, laneCatalog)) : ready ? t("readiness.ready") : t("readiness.blocked")}</strong>
            <small>{isComfy ? t("comfy.display.controlsHelp") : ready ? t("readiness.readyBody") : current.reason}</small>
          </div>
          {!isComfy && current.hint ? <p className="modal__hint">{current.hint}</p> : null}
          {isComfy ? (
            <dl className="provider-readiness__facts">
              <div><dt>{t("readiness.provider")}</dt><dd>{PROVIDER_READINESS_LABELS.comfy}</dd></div>
              <div><dt>{t("comfy.workflowsTitle")}</dt><dd>{comfyDisplay.selected?.label ?? t("comfy.display.chooseWorkflow")}</dd></div>
              {comfyDisplay.selected ? <>
                <div><dt>{t("comfy.colId")}</dt><dd>{comfyDisplay.selected.id}</dd></div>
                <div><dt>{t("comfy.colKind")}</dt><dd>{t(comfyDisplay.selected.kind === "video" ? "comfy.kindVideo" : "comfy.kindImage")}</dd></div>
              </> : null}
              {laneCatalog.observedAt !== null ? <div><dt>{t("comfy.colStatus")}</dt><dd>{t("comfy.display.lastChecked", { time: new Date(laneCatalog.observedAt).toLocaleTimeString() })}</dd></div> : null}
            </dl>
          ) : <dl className="provider-readiness__facts">
            <div>
              <dt>{t("readiness.provider")}</dt>
              <dd>{PROVIDER_READINESS_LABELS[provider] ?? "GPT API"}</dd>
            </div>
            <div>
              <dt>{t("readiness.model")}</dt>
              <dd>{imageModelOption ? t(imageModelOption.fullLabelKey) : imageModel}</dd>
            </div>
            {isGrok ? (
              <div>
                <dt>{t("readiness.grokApi")}</dt>
                <dd>{t("readiness.grokApiBody")}</dd>
              </div>
            ) : provider === "88api" ? (
              <div><dt>{t("settings.api88.title")}</dt><dd>{t("settings.api88.compatibility")}</dd></div>
            ) : (
              <>
                <div>
                  <dt>{t("readiness.reasoning")}</dt>
                  <dd>{reasoningEffort}</dd>
                </div>
                <div>
                  <dt>{t("readiness.webSearch")}</dt>
                  <dd>{webSearchEnabled ? t("settings.webSearch.on") : t("settings.webSearch.off")}</dd>
                </div>
              </>
            )}
          </dl>}
          </>}
        </div>
        <div className="modal__actions">
          <button type="button" className="modal__btn modal__btn--secondary" onClick={close} data-modal-initial-focus>
            {t("common.close")}
          </button>
          <button type="button" className="modal__btn" onClick={goAccount}>
            {t(isComfy ? "comfy.display.manage" : "readiness.openAccount")}
          </button>
        </div>
      </div>
    </div>
  );
}
