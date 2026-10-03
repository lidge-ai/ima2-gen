import { fetchApi } from "../lib/api-core";
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { OptionGroup } from "./OptionGroup";
import { Chip, ChipRow, Select } from "./controls";
import { DurationSlider } from "./controls/DurationSlider";
import { VoicePicker } from "./VoicePicker";
import { SoundIntentPicker } from "./SoundIntentPicker";
import { deriveVideoModeUI, GROK_VIDEO_MODEL_15, GROK_VIDEO_MODEL_BASE, maxVideoDurationUI, supportsVideoResolutionUI } from "../lib/imageModels";
import { ACTIVE_VIDEO_PROMPT_GUIDANCE, continuitySummary } from "../lib/videoContinuity";
import { getPresetById } from "../lib/presets";
import type { VideoResolutionUI } from "../types";

interface PlannerConfig { model: string; options: string[]; }

const RES_ITEMS = [
  { value: "480p" as const, label: "480p" },
  { value: "720p" as const, label: "720p" },
  { value: "1080p" as const, label: "1080p", sub: "1.5 HD" },
];
const ASPECT_ITEMS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].map((v) => ({ value: v, label: v }));
const DURATIONS = [3, 5, 8, 10, 12, 15];

const VIDEO_MODELS: Array<{ value: string; label: string; sub: string }> = [
  { value: GROK_VIDEO_MODEL_BASE, label: "Grok V", sub: "Fast" },
  { value: GROK_VIDEO_MODEL_15, label: "Grok V1.5", sub: "HD" },
];

export function VideoControlsPanel() {
  const { t } = useI18n();
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const refCount = useAppStore((s) => s.activeVideoRefCount());
  const singleRefMode = useAppStore((s) => s.videoSingleRefMode);
  const setSingleRefMode = useAppStore((s) => s.setVideoSingleRefMode);
  const duration = useAppStore((s) => s.videoDuration);
  const setDuration = useAppStore((s) => s.setVideoDuration);
  const resolution = useAppStore((s) => s.videoResolution);
  const setResolution = useAppStore((s) => s.setVideoResolution);
  const aspect = useAppStore((s) => s.videoAspectRatio);
  const setAspect = useAppStore((s) => s.setVideoAspectRatio);
  const videoTopic = useAppStore((s) => s.videoTopic);
  const setVideoTopic = useAppStore((s) => s.setVideoTopic);
  const showToast = useAppStore((s) => s.showToast);
  const continuity = useAppStore((s) => s.videoContinuityLineage);
  const selectedPresetIds = useAppStore((s) => s.selectedPresetIds);
  const removePreset = useAppStore((s) => s.removePreset);
  const cameraPresets = selectedPresetIds
    .map((id) => getPresetById(id))
    .filter((preset): preset is NonNullable<typeof preset> => preset?.category === "camera-motion");
  const mode = deriveVideoModeUI(refCount, singleRefMode);
  // reference-to-video is capped at 10s on the base model and 15s on 1.5. Offering a
  // value the server refuses turns the user's choice into a 400 they cannot act on.
  const maxDuration = maxVideoDurationUI(videoModelSelected, mode);
  const summary = continuitySummary(continuity);
  const canUse1080pWithSelectedModel = supportsVideoResolutionUI(videoModelSelected, "1080p", mode);
  const canUse1080pIfModelSelected = supportsVideoResolutionUI(GROK_VIDEO_MODEL_15, "1080p", mode);
  const resolutionItems = RES_ITEMS.map((item) => (
    item.value === "1080p" ? { ...item, disabled: !canUse1080pIfModelSelected } : item
  ));

  useEffect(() => {
    if (!supportsVideoResolutionUI(videoModelSelected, resolution, mode)) {
      setResolution("720p");
    }
  }, [mode, resolution, setResolution, videoModelSelected]);

  // Clamp only. The toast lives in the model handler below: an effect runs twice under
  // StrictMode, and a duplicated "we shortened your clip" notice reads like two edits.
  useEffect(() => {
    if (duration !== null && duration > maxDuration) setDuration(maxDuration);
  }, [duration, maxDuration, setDuration]);

  const handleVideoModelChange = (next: string) => {
    // The clamp is announced rather than silent: the user picked a duration and is
    // about to lose it, and the reason lives in the model they just chose. The earlier
    // value is not restored on switching back — reviving 15s after the user has since
    // chosen 10 would be indistinguishable from ignoring them.
    const nextMax = maxVideoDurationUI(next, mode);
    if (duration !== null && duration > nextMax) {
      showToast(t("video.durationClampedToModel", { seconds: nextMax }));
    }
    selectVideoModel(next);
  };

  const handleResolutionChange = (next: VideoResolutionUI) => {
    if (next === "1080p") {
      if (!canUse1080pIfModelSelected) return;
      if (!canUse1080pWithSelectedModel) {
        selectVideoModel(GROK_VIDEO_MODEL_15);
      }
    }
    setResolution(next);
  };

  const [plannerConfig, setPlannerConfig] = useState<PlannerConfig | null>(null);
  useEffect(() => {
    fetchApi("/api/config/grok-planner")
      .then((r) => r.json() as Promise<PlannerConfig>)
      .then(setPlannerConfig)
      .catch(() => {});
  }, []);
  const onPlannerChange = async (model: string) => {
    const previousModel = plannerConfig?.model;
    setPlannerConfig((prev) => prev ? { ...prev, model } : null);
    try {
      const response = await fetchApi("/api/config/grok-planner", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      setPlannerConfig((prev) => prev && previousModel ? { ...prev, model: previousModel } : prev);
      if ((error as { code?: string } | null)?.code === "LAN_TOKEN_REQUIRED") return;
      showToast(t("video.plannerUpdateFailed"), true);
    }
  };

  return (
    <div className="right-panel-settings video-controls">
      <div className="option-group">
        <div className="section-title">{t("quality.grokModelTitle") ?? "Model"}</div>
        <div className="option-row">
          {VIDEO_MODELS.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`option-btn${videoModelSelected === m.value ? " active" : ""}`}
              onClick={() => handleVideoModelChange(m.value)}
            >
              {m.label}
              <br />
              <span className="option-sub">{m.sub}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="provider-compat-note" role="note">
        <strong>{t("video.modeLabel")}</strong>
        <span>{t(`video.mode.${mode}`, { n: refCount })}</span>
      </div>
      {summary ? (
        <div className="provider-compat-note" role="note">
          <strong>{t("common.continuity")}</strong>
          <span>{summary}</span>
        </div>
      ) : null}
      <VoicePicker />
      <SoundIntentPicker />
      {cameraPresets.length > 0 && (
        <ChipRow ariaLabel={t("video.selectedCameraPresets")}>
          {cameraPresets.map((preset) => (
            <Chip key={preset.id} onRemove={() => removePreset(preset.id)} removeLabel={t("common.removeNamed", { name: preset.name })}>
              {preset.name}
            </Chip>
          ))}
        </ChipRow>
      )}
      <div className="option-group">
        <div className="section-title">{t("video.seriesTopicTitle") ?? "시리즈 주제"}</div>
        <input
          type="text"
          className="video-topic-input"
          placeholder={t("video.seriesTopicPlaceholder") ?? "예: 한국 여행 브이로그"}
          value={videoTopic}
          onChange={(e) => setVideoTopic(e.target.value)}
        />
      </div>
      <div className="option-group">
        <div className="section-title">{t("video.durationTitle")}</div>
        <DurationSlider
          values={DURATIONS.filter((d) => d <= maxDuration)}
          value={duration}
          ariaLabel={t("video.durationTitle")}
          onChange={(next) => setDuration(next ?? DURATIONS[0])}
        />
      </div>
      {refCount === 1 && (
        <OptionGroup<"image-to-video" | "reference-to-video">
          title={t("video.singleRefTitle")}
          help={t("video.singleRefHelp")}
          items={[
            { value: "image-to-video", label: t("video.singleRef.source") },
            { value: "reference-to-video", label: t("video.singleRef.reference") },
          ]}
          value={singleRefMode}
          onChange={setSingleRefMode}
        />
      )}
      <OptionGroup<VideoResolutionUI>
        title={t("video.resolutionTitle")}
        help={!canUse1080pIfModelSelected ? t("video.resolution1080Help") : undefined}
        items={resolutionItems}
        value={resolution}
        onChange={handleResolutionChange}
      />
      <OptionGroup<string>
        title={t("video.aspectTitle")}
        items={ASPECT_ITEMS}
        value={aspect}
        onChange={setAspect}
      />
      {plannerConfig && (
        <div className="video-controls__pills">
          <Select
            className="video-controls__pill"
            items={plannerConfig.options.map((model) => ({ value: model, label: model }))}
            value={plannerConfig.model}
            onChange={(model) => void onPlannerChange(model)}
            ariaLabel={t("video.plannerModelTitle")}
          />
        </div>
      )}
      <details className="provider-compat-details" style={{ marginTop: 8 }}>
        <summary>{t("common.activePrompt")}</summary>
        <p>{ACTIVE_VIDEO_PROMPT_GUIDANCE}</p>
      </details>
    </div>
  );
}
