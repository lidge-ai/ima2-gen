import { useRef } from "react";
import { getAllPresets } from "../../lib/presets";
import type { TrayItem } from "../../lib/referenceTray";
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import type { Provider } from "../../types";
import type { ProviderAvailability } from "../../hooks/useProviderAvailability";
import { Chip, ChipRow } from "../controls";
import { Select, type SelectItem } from "../controls/Select";
import { NegativePromptField } from "../NegativePromptField";

const PROVIDER_LABELS: Record<Provider, string> = {
  oauth: "GPT OAuth",
  api: "GPT API",
  grok: "Grok OAuth",
  "grok-api": "Grok API",
  agy: "Antigravity",
  "gemini-api": "Gemini API",
  atlascloud: "Atlas Cloud",
  "88api": "88API",
  minimax: "MiniMax",
  nai: "NovelAI",
  comfy: "ComfyUI",
};

function homeReferenceThumbnail(item: TrayItem): string | undefined {
  if (item.kind === "attachment") return item.source.dataUrl;
  if (item.source.thumbnailUrl) return item.source.thumbnailUrl;
  const filename = item.source.referenceFilenames[0];
  if (!filename) return undefined;
  if (filename.startsWith("/generated/")) return filename;
  return `/generated/${filename.split("/").map(encodeURIComponent).join("/")}`;
}

type HomePromptComposerProps = {
  providerAvailability: Record<Provider, ProviderAvailability>;
};

export function HomePromptComposer({ providerAvailability }: HomePromptComposerProps) {
  const prompt = useAppStore((state) => state.prompt);
  const setPrompt = useAppStore((state) => state.setPrompt);
  const provider = useAppStore((state) => state.provider);
  const setProvider = useAppStore((state) => state.setProvider);
  const selectedPresetIds = useAppStore((state) => state.selectedPresetIds);
  const removePreset = useAppStore((state) => state.removePreset);
  const generate = useAppStore((state) => state.generate);
  const activeGenerations = useAppStore((state) => state.activeGenerations);
  const trayItems = useAppStore((state) => state.trayItems);
  const composingRef = useRef(false);
  const { t } = useI18n();
  const selectedIdSet = new Set(selectedPresetIds);
  const selectedPresets = getAllPresets().filter((preset) => selectedIdSet.has(preset.id));
  const isGenerating = activeGenerations > 0;
  const isNai = provider === "nai";
  const submitPrompt = () => {
    if (isGenerating || prompt.trim().length === 0) return;
    void generate();
    useAppStore.getState().setUIMode("classic");
  };
  const providerItems = Object.entries(PROVIDER_LABELS).map(([value, label]) => {
    const providerValue = value as Provider;
    const availability = providerAvailability[providerValue];
    return {
      value: providerValue,
      label,
      sub: providerValue === "comfy" ? availability.reason : availability.ok ? t("readiness.ready") : availability.reason,
      // ComfyUI is selectable even before a workflow is observed so the user
      // can reach its existing Settings manager and configure the local lane.
      disabled: !(availability.selectable ?? availability.ok) && providerValue !== "comfy",
    } satisfies SelectItem<Provider>;
  });

  return (
    <div className="home-prompt">
      {selectedPresets.length > 0 ? (
        <ChipRow className="home-prompt__chips" ariaLabel={t("home.selectedPresets")}>
          {selectedPresets.map((preset) => (
            <Chip
              key={preset.id}
              selected
              onRemove={() => removePreset(preset.id)}
              removeLabel={t("common.removeNamed", { name: preset.name })}
              title={preset.category}
            >
              {preset.name}
            </Chip>
          ))}
        </ChipRow>
      ) : null}

      {trayItems.length > 0 ? (
        <div
          className="home-prompt__reference-strip"
          role="group"
          aria-label={t("home.referenceTrayAria", { count: trayItems.length })}
        >
          <span className="home-prompt__reference-thumbs" aria-hidden="true">
            {trayItems.map((item) => {
              const thumbnail = homeReferenceThumbnail(item);
              return (
                <span key={item.tokenId} className="home-prompt__reference-thumb">
                  {thumbnail ? <img src={thumbnail} alt="" loading="lazy" decoding="async" /> : "@"}
                </span>
              );
            })}
          </span>
          <span className="home-prompt__reference-count">
            {t("home.referenceTrayCount", { count: trayItems.length })}
          </span>
        </div>
      ) : null}

      <div className={`home-prompt__panes${isNai ? " home-prompt__panes--dual" : ""}`}>
        <div className="home-prompt__pane">
          <label className="home-prompt__label" htmlFor="home-prompt-input">
            {isNai ? t("nai.positivePrompt.label") : t("prompt.label")}
          </label>
          <textarea
            id="home-prompt-input"
            className="home-prompt__textarea"
            rows={5}
            value={prompt}
            placeholder={isNai ? t("nai.positivePrompt.placeholder") : t("prompt.placeholder")}
            aria-describedby={isNai ? "home-prompt-hint" : undefined}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
              if (event.defaultPrevented || composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              event.preventDefault();
              submitPrompt();
            }}
          />
          {isNai ? <p id="home-prompt-hint" className="home-prompt__hint">{t("nai.positivePrompt.hint", { count: prompt.length })}</p> : null}
        </div>
        <NegativePromptField variant="home" onSubmit={submitPrompt} />
      </div>

      <div className="home-prompt__footer">
        <Select
          className="home-prompt__provider"
          items={providerItems}
          value={provider}
          onChange={setProvider}
          ariaLabel={t("readiness.provider")}
        />
        <button
          type="button"
          className="home-prompt__generate"
          disabled={isGenerating || prompt.trim().length === 0}
          onClick={submitPrompt}
        >
          {isGenerating
            ? t("generate.buttonLoading", { n: activeGenerations })
            : t("generate.button")}
        </button>
      </div>
    </div>
  );
}
