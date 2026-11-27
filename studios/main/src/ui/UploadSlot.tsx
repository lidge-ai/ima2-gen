import { messages, tr, useT } from "../i18n.ts";
import { useRef, useState, type DragEvent } from "react";
import type { MediaInputRole, UploadedInput } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";

const M = messages({ failed: "Upload failed", remove: "Remove {label}", uploading: "Uploading", play: "Play {name}", pause: "Pause {name}" },
  { failed: "업로드에 실패했어요", remove: "{label} 삭제", uploading: "업로드 중", play: "{name} 재생", pause: "{name} 일시정지" });

const clock = (seconds: number) => Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");

/** An audio file in a slot: its name and length, and one button to hear it. Native controls do not fit a half-width slot. */
function AudioPreview({ value }: { value: SlotValue }) {
  const t = useT(M);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [length, setLength] = useState<number | null>(null);
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };
  return (
    <div className="slot-audio">
      <button type="button" className="slot-audio-play" aria-pressed={playing} aria-label={t(playing ? "pause" : "play", { name: value.name })} onClick={toggle}>
        <Icon name={playing ? "stop" : "play"} size={16} />
      </button>
      <span className="slot-audio-name">{value.name}</span>
      {length !== null ? <span className="slot-hint">{clock(length)}</span> : null}
      <audio
        ref={audio}
        src={value.upload.url}
        preload="metadata"
        onLoadedMetadata={(e) => setLength(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

export interface SlotValue {
  role: MediaInputRole;
  upload: UploadedInput;
  name: string;
}

interface Props {
  label: string;
  role: MediaInputRole;
  accept: string;
  value: SlotValue | null;
  onChange: (value: SlotValue | null) => void;
  hint?: string;
}

/** Uploads one file right away and reports busy and error state. */
function useSlotUpload(role: MediaInputRole, onChange: Props["onChange"]) {
  const studio = useStudioApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ role, upload: await studio.upload(file), name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : tr(M, "failed"));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, take };
}

function SlotPreview({ value, label, onRemove }: { value: SlotValue; label: string; onRemove: () => void }) {
  const t = useT(M);
  const isVideo = value.upload.mimeType.startsWith("video/");
  const isAudio = value.upload.mimeType.startsWith("audio/");
  return (
    <>
      {isAudio ? (
        <AudioPreview value={value} />
      ) : isVideo ? (
        <video className="slot-preview" src={value.upload.url} muted playsInline aria-label={value.name} />
      ) : (
        <img className="slot-preview" src={value.upload.url} alt={value.name} />
      )}
      <button type="button" className="slot-remove" aria-label={t("remove", { label })} onClick={onRemove}>
        <Icon name="close" size={14} />
      </button>
    </>
  );
}

function SlotEmpty({
  label,
  hint,
  busy,
  onPick,
}: {
  label: string;
  hint?: string | undefined;
  busy: boolean;
  onPick: () => void;
}) {
  const t = useT(M);
  return (
    <button type="button" className="slot-empty" onClick={onPick} disabled={busy}>
      <Icon name={busy ? "clock" : "upload"} />
      <span>{busy ? t("uploading") : label}</span>
      {hint ? <span className="slot-hint">{hint}</span> : null}
    </button>
  );
}

/** One drop zone for a single input file. Uploads immediately so submit only sends ids. */
export function UploadSlot({ label, role, accept, value, onChange, hint }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, take } = useSlotUpload(role, onChange);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    void take(event.dataTransfer.files[0]);
  };
  return (
    <div className={"slot" + (value ? " has-file" : "")} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {value ? (
        <SlotPreview value={value} label={label} onRemove={() => onChange(null)} />
      ) : (
        <SlotEmpty label={label} hint={hint} busy={busy} onPick={() => input.current?.click()} />
      )}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label={label}
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error ? (
        <p className="slot-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
