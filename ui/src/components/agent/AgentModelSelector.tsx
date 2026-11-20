import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { AGENT_LLM_MODEL_OPTIONS, agentModelProvider, getAgentLlmModelOption } from "../../lib/agentModelOptions";
import { REASONING_EFFORT_OPTIONS } from "../../lib/reasoning";
import type { AgentGenerationSettings } from "./agentTypes";
import { ChevronRightIcon } from "./AgentIcons";

type Props = {
  settings: AgentGenerationSettings;
  onChange: (patch: Partial<AgentGenerationSettings>) => void;
  onOpenModelTab?: () => void;
};

export function AgentModelSelector({ settings, onChange, onOpenModelTab }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentModel = getAgentLlmModelOption(settings);
  const currentReasoning = REASONING_EFFORT_OPTIONS.find((option) => option.value === settings.reasoningEffort) ?? REASONING_EFFORT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="image-model-select image-model-select--sidebar agent-model-select">
      <button
        type="button"
        className="image-model-select__trigger image-model-select__trigger--pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("sidebar.quickSettingsAria", {
          model: currentModel.shortLabel,
          effort: currentReasoning.shortLabel,
        })}
        onClick={() => setOpen((next) => !next)}
      >
        <span className="image-model-select__trigger-top">
          <span className="image-model-select__trigger-model">{currentModel.shortLabel}</span>
          <span className="image-model-select__trigger-chevron" aria-hidden="true">▾</span>
        </span>
        <span className="image-model-select__trigger-effort">{currentReasoning.shortLabel}</span>
      </button>
      {onOpenModelTab ? (
        <button type="button" className="agent-model-select__open-tab" onClick={onOpenModelTab} aria-label={t("agent.modelTabView")} title={t("agent.modelTabView")}>
          <ChevronRightIcon size={13} />
        </button>
      ) : null}
      {open ? (
        <div className="image-model-select__menu agent-model-select__menu" role="menu" aria-label={t("sidebar.quickSettingsMenu")}>
          <div className="image-model-select__section" role="group" aria-label={t("agent.model")}>
            <div className="image-model-select__section-title">{t("agent.model")}</div>
            {AGENT_LLM_MODEL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`image-model-select__item${option.value === currentModel.value ? " is-active" : ""}`}
                role="menuitemradio"
                aria-checked={option.value === currentModel.value}
                onClick={() => {
                  onChange({ model: option.value, provider: agentModelProvider(option, settings.provider) });
                  setOpen(false);
                }}
              >
                <span>{option.shortLabel}</span>
                <small>{option.fullLabel}</small>
              </button>
            ))}
          </div>
          <div className="image-model-select__section" role="group" aria-label={t("sidebar.reasoningLabel")}>
            <div className="image-model-select__section-title">{t("sidebar.reasoningLabel")}</div>
            {REASONING_EFFORT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`image-model-select__item${option.value === settings.reasoningEffort ? " is-active" : ""}`}
                role="menuitemradio"
                aria-checked={option.value === settings.reasoningEffort}
                onClick={() => {
                  onChange({ reasoningEffort: option.value as AgentGenerationSettings["reasoningEffort"] });
                  setOpen(false);
                }}
              >
                <span>{option.shortLabel}</span>
                <small>{t(option.fullLabelKey)}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
