import { messages, tr, useT } from "../i18n.ts";
import { useRef, useState, type DragEvent } from "react";
import type { MediaInputRole, UploadedInput } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";

const M = messages({ failed: "Upload failed", remove: "Remove {label}", uploading: "Uploading" },
  { failed: "업로드에 실패했어요", remove: "{label} 삭제", uploading: "업로드 중" });

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
  return (
    <>
      {isVideo ? (
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
