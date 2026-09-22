import { Select } from "./controls/Select";
import { API_IMAGE_TOOL_MODEL_OPTIONS } from "../lib/imageModels";
import type { ImageToolModel } from "../types";
import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { OptionGroup } from "./OptionGroup";
import { SizePicker } from "./SizePicker";
import { CountPicker } from "./CountPicker";
import { CostEstimate } from "./CostEstimate";
import { ProviderStatusSelect } from "./settings/ProviderStatusSelect";
import { GrokSizePicker } from "./GrokSizePicker";
import { GrokModelPicker } from "./GrokModelPicker";
import { VideoControlsPanel } from "./VideoControlsPanel";
import { NaiControlsPanel } from "./settings/NaiControlsPanel";
import { McpGenerationControls } from "./settings/McpGenerationControls";
import { ComfyGenerationControls } from "./settings/ComfyGenerationControls";
import { useMcpProviders } from "../lib/mcpProviders";
import type { Format, GeminiImageModel, Moderation, Quality } from "../types";

const FORMAT_ITEMS = [
  { value: "png" as const, label: "PNG" },
  { value: "jpeg" as const, label: "JPEG" },
  { value: "webp" as const, label: "WebP" },
];

const GEMINI_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "3:4", label: "3:4" },
  { value: "4:3", label: "4:3" },
  { value: "4:5", label: "4:5" },
  { value: "5:4", label: "5:4" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
];

const GEMINI_RESOLUTIONS = [
  { value: "512", label: "512px" },
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GEMINI_RATIO_TO_SIZE: Record<string, Record<string, string>> = {
  "1:1":  { "512": "512x512",  "1K": "1024x1024", "2K": "2048x2048", "4K": "4096x4096" },
  "2:3":  { "512": "424x632",  "1K": "848x1264",  "2K": "1696x2528", "4K": "3392x5056" },
  "3:2":  { "512": "632x424",  "1K": "1264x848",  "2K": "2528x1696", "4K": "5056x3392" },
  "3:4":  { "512": "448x600",  "1K": "896x1200",  "2K": "1792x2400", "4K": "3584x4800" },
  "4:3":  { "512": "600x448",  "1K": "1200x896",  "2K": "2400x1792", "4K": "4800x3584" },
  "4:5":  { "512": "464x576",  "1K": "928x1152",  "2K": "1856x2304", "4K": "3712x4608" },
  "5:4":  { "512": "576x464",  "1K": "1152x928",  "2K": "2304x1856", "4K": "4608x3712" },
  "9:16": { "512": "384x688",  "1K": "768x1376",  "2K": "1536x2752", "4K": "3072x5504" },
  "16:9": { "512": "688x384",  "1K": "1376x768",  "2K": "2752x1536", "4K": "5504x3072" },
  "21:9": { "512": "792x168",  "1K": "1584x672",  "2K": "3168x1344", "4K": "6336x2688" },
};

function parseCurrentGeminiSettings(size: string): { ratio: string; res: string } | null {
  for (const [ratio, resMap] of Object.entries(GEMINI_RATIO_TO_SIZE)) {
    for (const [res, sizeStr] of Object.entries(resMap)) {
      if (sizeStr === size) return { ratio, res };
    }
  }
  return null;
}

// Mirrors the server-side nearest-ratio mapping in lib/geminiApiImageAdapter.ts
// so the custom-size preview shows what the API will actually receive.
function nearestGeminiParams(w: number, h: number): { ratio: string; res: string } {
  const ratio = w / h;
  let bestLabel = "1:1";
  let bestDist = Infinity;
  // Extended ratios match the server map in lib/geminiApiImageAdapter.ts,
  // which accepts more than the 10 grid presets.
  const labels = [...Object.keys(GEMINI_RATIO_TO_SIZE), "1:8", "8:1", "1:4", "4:1"];
  for (const label of labels) {
    const [rw, rh] = label.split(":").map(Number);
    const dist = Math.abs(ratio - rw / rh);
    if (dist < bestDist) { bestDist = dist; bestLabel = label; }
  }
  const maxDim = Math.max(w, h);
  const res = maxDim <= 512 ? "512" : maxDim <= 1024 ? "1K" : maxDim <= 2048 ? "2K" : "4K";
  return { ratio: bestLabel, res };
}

export function GenerationControlsPanel() {
  const { t } = useI18n();
  const provider = useAppStore((s) => s.provider);
  const imageToolModel = useAppStore((s) => s.imageToolModel);
  const setImageToolModel = useAppStore((s) => s.setImageToolModel);
  const quality = useAppStore((s) => s.quality);
  const setQuality = useAppStore((s) => s.setQuality);
  const format = useAppStore((s) => s.format);
  const setFormat = useAppStore((s) => s.setFormat);
  const moderation = useAppStore((s) => s.moderation);
  const setModeration = useAppStore((s) => s.setModeration);
  const multimode = useAppStore((s) => s.multimode);
  const setMultimode = useAppStore((s) => s.setMultimode);
  const imageModel = useAppStore((s) => s.imageModel);
  const setImageModel = useAppStore((s) => s.setImageModel);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const sizePreset = useAppStore((s) => s.sizePreset);
  const customW = useAppStore((s) => s.customW);
  const customH = useAppStore((s) => s.customH);
  const setSizePreset = useAppStore((s) => s.setSizePreset);
  const setCustomSize = useAppStore((s) => s.setCustomSize);
  const uiMode = useAppStore((s) => s.uiMode);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const mcpProvider = useAppStore((s) => s.mcpProvider ?? null);
  const { providers: mcpProviders } = useMcpProviders();
  const showMultimodeControls = uiMode === "classic";
  const isGrok = provider === "grok" || provider === "grok-api";
  const isAgyOnly = provider === "agy";
  const isGeminiApi = provider === "gemini-api";
  const isAnyGemini = isAgyOnly || isGeminiApi;
  const isNai = provider === "nai";
  const isComfy = provider === "comfy";
  // NovelAI always returns PNG and reads none of the GPT-shaped controls, so
  // format and moderation would be inert switches.
  const hideFormatControls = isGrok || isAnyGemini || isNai;

  const currentSize = sizePreset === "custom" ? `${customW}x${customH}` : "1024x1024";
  const isGeminiAuto = isGeminiApi && sizePreset === "auto";
  const geminiMatched = isGeminiApi && !isGeminiAuto ? parseCurrentGeminiSettings(currentSize) : null;
  const geminiSettings = geminiMatched ?? { ratio: "", res: "" };
  const isGeminiCustomSize = isGeminiApi && !isGeminiAuto && sizePreset === "custom" && !geminiMatched;
  const geminiImageModel: GeminiImageModel = imageModel === "nano-banana-pro" ? "nano-banana-pro" : "nano-banana-2";

  const [geminiCustomOpen, setGeminiCustomOpen] = useState(false);
  const [geminiDraftW, setGeminiDraftW] = useState(String(customW));
  const [geminiDraftH, setGeminiDraftH] = useState(String(customH));

  const setGeminiSize = (ratio: string, res: string) => {
    const sizeStr = GEMINI_RATIO_TO_SIZE[ratio || "1:1"]?.[res || "1K"] || "1024x1024";
    const [w, h] = sizeStr.split("x").map(Number);
    setGeminiCustomOpen(false);
    setSizePreset("custom");
    setCustomSize(w, h);
  };

  const applyGeminiCustomSize = () => {
    const w = Number(geminiDraftW);
    const h = Number(geminiDraftH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
    setSizePreset("custom");
    setCustomSize(w, h);
    setGeminiCustomOpen(false);
  };

  const qualityItems = [
    { value: "low" as const, label: t("quality.lowLabel"), sub: t("quality.lowSub") },
    { value: "medium" as const, label: t("quality.mediumLabel"), sub: t("quality.mediumSub") },
    { value: "high" as const, label: t("quality.highLabel"), sub: t("quality.highSub") },
    ...(provider === "api" && imageToolModel ? [
      { value: "xhigh" as const, label: t("quality.xhighLabel") },
      { value: "max" as const, label: t("quality.maxLabel") },
    ] : []),
  ];
  const moderationItems = [
    { value: "auto" as const, label: t("moderation.autoLabel"), sub: t("moderation.autoSub") },
    {
      value: "low" as const,
      label: t("moderation.lowLabel"),
      sub: t("moderation.lowSub"),
      color: "var(--amber)",
    },
  ];
  const geminiModelItems = [
    { value: "nano-banana-2" as const, label: "Nano", sub: "Banana 2" },
    { value: "nano-banana-pro" as const, label: "Nano", sub: "Banana Pro" },
  ];
  const providerCompat = isGrok
    ? { title: t("provider.grokCompatTitle"), body: t("provider.grokCompatBody") }
    : isAgyOnly
      ? { title: t("provider.agyCompatTitle"), body: t("provider.agyCompatBody") }
      : isGeminiApi
        ? { title: t("provider.geminiApiCompatTitle"), body: t("provider.geminiApiCompatBody") }
        : isNai
          ? { title: t("nai.compatTitle"), body: t("nai.compatBody") }
          : { title: t("provider.gptCompatTitle"), body: t("provider.gptCompatBody") };

  const handleModeSwitch = (mode: "image" | "video") => {
    if (mode === "video") {
      selectVideoModel("grok-imagine-video");
    } else {
      setImageModel(imageModel);
    }
  };

  if (mcpProvider) {
    return (
      <div className="right-panel-settings" role="tabpanel">
        <ProviderStatusSelect mcpProviders={mcpProviders} />
        <McpGenerationControls
          record={mcpProviders.find((entry) => entry.id === mcpProvider) ?? null}
        />
      </div>
    );
  }

  if (isComfy) {
    return (
      <div className="right-panel-settings" role="tabpanel">
        <ProviderStatusSelect mcpProviders={mcpProviders} />
        <ComfyGenerationControls />
      </div>
    );
  }

  return (
    <div className="right-panel-settings" role="tabpanel">
      <ProviderStatusSelect mcpProviders={mcpProviders} />
      <details className="provider-compat-details">
        <summary>{providerCompat.title}</summary>
        <p>{providerCompat.body}</p>
      </details>
      {isGrok && (
        <div className="option-group grok-mode-toggle">
          <div className="option-row">
            <button
              type="button"
              className={`option-btn${!videoModelSelected ? " active" : ""}`}
              onClick={() => handleModeSwitch("image")}
            >
              {t("grokMode.image")}
            </button>
            <button
              type="button"
              className={`option-btn${videoModelSelected ? " active" : ""}`}
              onClick={() => handleModeSwitch("video")}
            >
              {t("grokMode.video")}
            </button>
          </div>
        </div>
      )}
      {videoModelSelected ? (
        <VideoControlsPanel />
      ) : (
      <>
      {isAgyOnly ? null : isGrok ? (
        <>
        <GrokModelPicker />
        <GrokSizePicker />
        </>
      ) : isNai ? (
        <NaiControlsPanel />
      ) : isGeminiApi ? (
        <>
        <OptionGroup<GeminiImageModel>
          title={t("quality.grokModelTitle")}
          items={geminiModelItems}
          value={geminiImageModel}
          onChange={setImageModel}
        />
        <div className="option-group">
          <div className="section-title">{t("size.grokAspectTitle") || "Aspect Ratio"}</div>
          {[
            GEMINI_ASPECT_RATIOS.slice(0, 3),
            GEMINI_ASPECT_RATIOS.slice(3, 6),
            GEMINI_ASPECT_RATIOS.slice(6, 8),
            GEMINI_ASPECT_RATIOS.slice(8),
          ].map((row, ri) => (
            <div key={ri} className="option-row">
              {row.map((ar) => (
                <button
                  key={ar.value}
                  type="button"
                  className={`option-btn${geminiSettings.ratio === ar.value ? " active" : ""}`}
                  onClick={() => setGeminiSize(ar.value, geminiSettings.res)}
                >
                  {ar.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="option-group">
          <div className="section-title">{t("size.grokResolutionTitle") || "Resolution"}</div>
          <div className="gemini-resolution-grid">
            {GEMINI_RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`option-btn${geminiSettings.res === r.value ? " active" : ""}`}
                onClick={() => setGeminiSize(geminiSettings.ratio, r.value)}
              >
                <span>{r.label}</span><br /><small>{GEMINI_RATIO_TO_SIZE[geminiSettings.ratio]?.[r.value]?.replace("x", "×") || ""}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="option-group">
          <div className="option-row">
            <button
              type="button"
              className={`option-btn${isGeminiAuto ? " active" : ""}`}
              onClick={() => { setGeminiCustomOpen(false); setSizePreset("auto"); }}
            >
              {t("size.autoLabel")}
              <br />
              <span className="option-sub">{t("size.autoSub")}</span>
            </button>
            <button
              type="button"
              className={`option-btn${isGeminiCustomSize || geminiCustomOpen ? " active" : ""}`}
              onClick={() => setGeminiCustomOpen((v) => !v)}
            >
              {t("size.customPlus")}
              <br />
              <span className="option-sub">{t("size.customSub")}</span>
            </button>
          </div>
          {geminiCustomOpen ? (
            <>
              <div className="option-row size-picker__custom-row">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="custom-size-input"
                  value={geminiDraftW}
                  onChange={(e) => setGeminiDraftW(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("size.width")}
                />
                <span className="size-picker__dimension-separator" aria-hidden="true">×</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="custom-size-input"
                  value={geminiDraftH}
                  onChange={(e) => setGeminiDraftH(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("size.height")}
                />
              </div>
              {Number(geminiDraftW) > 0 && Number(geminiDraftH) > 0 ? (
                <div className="size-picker__preview">
                  <span>{t("size.normalizedPreview")}</span>
                  <strong>
                    {(() => {
                      const near = nearestGeminiParams(Number(geminiDraftW), Number(geminiDraftH));
                      return `${near.ratio} · ${near.res}`;
                    })()}
                  </strong>
                </div>
              ) : null}
              <button type="button" className="size-picker__save" onClick={applyGeminiCustomSize}>
                {t("settings.apiKeys.save")}
              </button>
            </>
          ) : null}
        </div>
        </>
      ) : (
        <>
        {provider === "api" && (
          <div className="option-group">
            <div className="section-title">{t("imageToolModel.title")}</div>
            <Select<ImageToolModel | "">
              ariaLabel={t("imageToolModel.title")}
              items={[{ value: "", label: t("imageToolModel.default") }, ...API_IMAGE_TOOL_MODEL_OPTIONS]}
              value={imageToolModel ?? ""}
              onChange={(value) => setImageToolModel(value || null)}
              portal
            />
          </div>
        )}
        <OptionGroup<Quality>
          className={qualityItems.length > 3 ? "quality-options-expanded" : ""}
          title={t("quality.title")}
          items={qualityItems}
          value={quality}
          onChange={setQuality}
        />
        <SizePicker />
        </>
      )}
      {hideFormatControls ? null : (
        <>
          <OptionGroup<Format>
            title={t("format.title")}
            items={FORMAT_ITEMS}
            value={format}
            onChange={setFormat}
          />
          <OptionGroup<Moderation>
            title={t("moderation.title")}
            items={moderationItems}
            value={moderation}
            onChange={setModeration}
          />
          <p className="option-help">
            {t("moderation.explain")}
          </p>
        </>
      )}
      {showMultimodeControls && !isAnyGemini && !isNai && (
        <div className="option-group multimode-toggle">
          <button
            type="button"
            className={`multimode-toggle__button${multimode ? " active" : ""}`}
            aria-pressed={multimode}
            title={t("multimode.tooltip")}
            onClick={() => setMultimode(!multimode)}
          >
            <span>{t("multimode.label")}</span>
            <span>{t("multimode.shortHint")}</span>
          </button>
        </div>
      )}
      {/* Both are hidden because the behavior is already forced: the payload
          sends n:1 for nai and generation bypasses multimode, and the cost
          model is priced for OpenAI rather than Anlas. */}
      {isAnyGemini || isNai ? null : <CountPicker />}
      {isNai ? null : <CostEstimate />}
      </>
      )}
    </div>
  );
}
