import { jobProgressPercent } from "../lib/jobProgress";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import type { PersistedInFlight } from "../store/storeTypes";

type InFlightListProps =
  | { variant?: "compact" }
  | { variant: "popup" | "inline"; panelId: string };
type Translator = (key: string, vars?: Record<string, string | number>) => string;
type CancelAction = (requestId: string) => Promise<void>;
type PhaseLabels = Record<string, string>;

function truncate(s: string, max = 28) {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export function InFlightList(props: InFlightListProps = {}) {
  const inFlight = useAppStore((s) => s.inFlight);
  const cancelInFlightJob = useAppStore((s) => s.cancelInFlightJob);
  const videoProgress = useAppStore((s) => s.videoProgress);
  const { t } = useI18n();
  const phaseLabels: PhaseLabels = {
    queued: t("inflight.queued"),
    planning: t("inflight.planning"),
    streaming: t("inflight.streaming"),
    decoding: t("inflight.decoding"),
    canceling: t("inflight.canceling"),
  };

  if (inFlight.length === 0) return null;
  if (!("panelId" in props)) {
    return <CompactList jobs={inFlight} phaseLabels={phaseLabels} videoProgress={videoProgress} cancelInFlightJob={cancelInFlightJob} t={t} />;
  }
  return <RichList jobs={inFlight} phaseLabels={phaseLabels} videoProgress={videoProgress} cancelInFlightJob={cancelInFlightJob} t={t} variant={props.variant} panelId={props.panelId} />;
}

type SharedListProps = {
  jobs: PersistedInFlight[];
  phaseLabels: PhaseLabels;
  videoProgress: number | null;
  cancelInFlightJob: CancelAction;
  t: Translator;
};

function CompactList(props: SharedListProps) {
  return (
    <ul className="in-flight-list">
      {props.jobs.map((f) => <CompactRow key={f.id} f={f} {...props} />)}
    </ul>
  );
}

function CompactRow({ f, phaseLabels, videoProgress, cancelInFlightJob, t }: SharedListProps & { f: PersistedInFlight }) {
  const phaseLabel = f.phase ? phaseLabels[f.phase] ?? f.phase : t("inflight.queued");
  const fullPrompt = f.prompt.trim().replace(/\s+/g, " ");
  const promptLabel = fullPrompt || t("inflight.noPrompt");
  return (
    <li
      className="in-flight-item"
      data-phase={f.phase ?? "queued"}
      title={promptLabel}
      aria-label={`${phaseLabel}: ${promptLabel}`}
    >
      <span className="in-flight-prompt">{truncate(f.prompt)}</span>
      <span className="in-flight-phase">
        {f.kind === "video" && videoProgress != null && videoProgress > 0
          ? `${Math.round(videoProgress * 100)}%`
          : jobProgressPercent(f.progress) != null ? `${String(jobProgressPercent(f.progress))}%` : phaseLabel}
      </span>
      <button
        type="button"
        className="in-flight-cancel"
        onClick={() => void cancelInFlightJob(f.id)}
        disabled={f.phase === "canceling"}
        aria-label={t("inflight.cancelAria", { prompt: promptLabel })}
        title={t("common.cancel")}
      >
        ×
      </button>
      <span className="in-flight-spinner" aria-hidden="true" data-motion-essential />
    </li>
  );
}

function RichList(props: SharedListProps & { variant: "popup" | "inline"; panelId: string }) {
  const videoJobs = props.jobs.filter((f) => f.kind === "video" || f.kind === "mcp-video");
  const determinateVideoId = videoJobs.length === 1 ? videoJobs[0]?.id : null;
  const validVideoProgress =
    props.videoProgress != null && props.videoProgress >= 0 && props.videoProgress <= 1
      ? props.videoProgress
      : null;
  return (
    <ul id={props.panelId} className={`in-flight-list in-flight-list--${props.variant}`}>
      {props.jobs.map((f) => (
        <RichRow key={f.id} f={f} determinateVideoId={determinateVideoId} validVideoProgress={validVideoProgress} {...props} />
      ))}
    </ul>
  );
}

function RichRow({ f, determinateVideoId, validVideoProgress, phaseLabels, cancelInFlightJob, t }: SharedListProps & {
  f: PersistedInFlight;
  determinateVideoId: string | null | undefined;
  validVideoProgress: number | null;
}) {
  const phaseLabel = f.phase ? phaseLabels[f.phase] ?? f.phase : t("inflight.queued");
  const fullPrompt = f.prompt.trim().replace(/\s+/g, " ");
  const promptLabel = fullPrompt || t("inflight.noPrompt");
  const isVideo = f.kind === "video" || f.kind === "mcp-video";
  const modelLabel = readJobModel(f) ?? kindLabel(f.kind, t);
  const progressPercent =
    f.id === determinateVideoId && validVideoProgress != null
      ? Math.round(validVideoProgress * 100)
      : jobProgressPercent(f.progress);
  return (
    <li className="in-flight-rich-item" data-phase={f.phase ?? "queued"} title={promptLabel} aria-label={`${modelLabel}, ${phaseLabel}: ${promptLabel}`}>
      <span className={`in-flight-placeholder${isVideo ? " in-flight-placeholder--video" : ""}`} aria-hidden="true">
        <PlaceholderIcon video={isVideo} />
      </span>
      <span className="in-flight-rich-copy">
        <span className="in-flight-rich-title">{modelLabel}</span>
        <span className="in-flight-rich-prompt" title={promptLabel}>{truncate(f.prompt, 54)}</span>
        <span className="in-flight-rich-status">
          <span className="in-flight-phase">{progressPercent == null ? phaseLabel : `${phaseLabel} · ${progressPercent}%`}{f.progressDetail ? ` · ${f.progressDetail}` : ""}</span>
          <ProgressTrack progressPercent={progressPercent} phaseLabel={phaseLabel} t={t} />
        </span>
      </span>
      <button type="button" className="in-flight-cancel" onClick={() => void cancelInFlightJob(f.id)} disabled={f.phase === "canceling"} aria-label={t("inflight.cancelAria", { prompt: promptLabel })} title={t("common.cancel")}>
        ×
      </button>
    </li>
  );
}

function ProgressTrack({ progressPercent, phaseLabel, t }: {
  progressPercent: number | null;
  phaseLabel: string;
  t: Translator;
}) {
  return (
    <span
      className={`in-flight-progress${progressPercent == null ? " in-flight-progress--indeterminate" : ""}`}
      role="progressbar"
      data-motion-essential
      aria-label={progressPercent == null ? phaseLabel : t("inflight.progressAria", { n: progressPercent })}
      aria-valuemin={progressPercent == null ? undefined : 0}
      aria-valuemax={progressPercent == null ? undefined : 100}
      aria-valuenow={progressPercent ?? undefined}
    >
      <span style={progressPercent == null ? undefined : { width: `${progressPercent}%` }} />
    </span>
  );
}

function readJobModel(job: object): string | null {
  if (!("model" in job) || typeof job.model !== "string") return null;
  const model = job.model.trim();
  return model || null;
}

function kindLabel(kind: string | undefined, t: Translator): string {
  if (kind?.startsWith("mcp-")) return t("inflight.kindMcp");
  if (kind === "video") return t("inflight.kindVideo");
  if (kind === "audio") return t("inflight.kindAudio");
  if (kind === "node") return t("inflight.kindNode");
  return t("inflight.kindImage");
}

function PlaceholderIcon({ video }: { video: boolean }) {
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      {video ? <path d="m10 9 5 3-5 3Z" /> : <><circle cx="9" cy="9" r="1.5" /><path d="m5.5 17 4.2-4 2.7 2.4 2.2-2 3.9 3.6" /></>}
    </svg>
  );
}
