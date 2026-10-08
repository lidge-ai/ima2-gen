import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { useLaneCatalog } from "../hooks/useLaneCatalog";
import { useI18n } from "../i18n";
import { api88UiVideoSpec, api88VideoAxes, api88VideoOptions, API88_DEFAULT_VIDEO_MODEL } from "../lib/api88Video";
import { Select } from "./controls";
import { DurationSlider } from "./controls/DurationSlider";
import { OptionGroup } from "./OptionGroup";
import type { VideoResolutionUI } from "../types";

function Api88ModelControl() {
  const { t } = useI18n();
  const selected = useAppStore((s) => s.videoModelSelected);
  const select = useAppStore((s) => s.selectVideoModel);
  const snapshot = useLaneCatalog();
  const rows = snapshot.catalog?.["88api"]?.models.video;
  const items = api88VideoOptions()
    .filter((option) => snapshot.phase !== "ready" || rows?.some((row) => row.id === option.value))
    .map((option) => {
      const row = rows?.find((entry) => entry.id === option.value);
      return { value: option.value, label: option.shortLabel,
        disabled: snapshot.phase !== "ready" || row?.executable === false,
        ...(row?.lockReason ? { title: row.lockReason } : {}) };
    });
  return <Select value={selected || API88_DEFAULT_VIDEO_MODEL} items={items}
    onChange={select} ariaLabel={t("mcp.videoModels")} />;
}

function useApi88VideoAxes() {
  const state = useAppStore();
  const refs = state.activeVideoRefCount();
  const axes = api88VideoAxes(state, refs > 0);
  const { setVideoDuration, setVideoResolution, setVideoAspectRatio } = state;
  const imageMode = api88UiVideoSpec(state.videoModelSelected)?.imageMode;
  useEffect(() => {
    if (state.videoDuration !== axes.duration) setVideoDuration(axes.duration);
    if (state.videoResolution !== axes.resolution) setVideoResolution(axes.resolution);
    if (state.videoAspectRatio !== axes.aspectRatio) setVideoAspectRatio(axes.aspectRatio);
    if (imageMode === "source" && state.videoSingleRefMode !== "image-to-video") state.setVideoSingleRefMode("image-to-video");
    if (imageMode === "reference" && state.videoSingleRefMode !== "reference-to-video") state.setVideoSingleRefMode("reference-to-video");
  }, [state.videoDuration, state.videoResolution, state.videoAspectRatio, axes.duration,
    axes.resolution, axes.aspectRatio, setVideoDuration, setVideoResolution, setVideoAspectRatio,
    imageMode, state.videoSingleRefMode, state.setVideoSingleRefMode]);
  return { state, refs, axes };
}

export function Api88VideoControls() {
  const { t } = useI18n();
  const { state, refs, axes } = useApi88VideoAxes();
  const spec = api88UiVideoSpec(state.videoModelSelected) ?? api88UiVideoSpec(API88_DEFAULT_VIDEO_MODEL)!;
  const durations = spec.veoBase64 && refs > 0 ? [8] : [...spec.durations];
  return <div className="right-panel-settings video-controls">
    <Api88ModelControl />
    <div className="option-group">
      <div className="section-title">{t("video.durationTitle")}</div>
      <DurationSlider values={durations} value={axes.duration} ariaLabel={t("video.durationTitle")}
        onChange={(value) => state.setVideoDuration(value ?? spec.defaultDuration)} />
    </div>
    <OptionGroup<VideoResolutionUI> title={t("video.resolutionTitle")}
      items={spec.resolutions.map((value) => ({ value, label: value }))}
      value={axes.resolution} onChange={state.setVideoResolution} />
    <OptionGroup<string> title={t("video.aspectTitle")}
      items={spec.ratios.map((value) => ({ value, label: value }))}
      value={axes.aspectRatio} onChange={state.setVideoAspectRatio} />
    {refs === 1 && spec.imageMode === "both" && <OptionGroup<"image-to-video" | "reference-to-video">
      title={t("video.singleRefTitle")} help={t("video.singleRefHelp")}
      items={[{ value: "image-to-video", label: t("video.singleRef.source") },
        { value: "reference-to-video", label: t("video.singleRef.reference") }]}
      value={state.videoSingleRefMode} onChange={state.setVideoSingleRefMode} />}
  </div>;
}
