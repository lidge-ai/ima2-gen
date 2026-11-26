import { useRef, useState, type DragEvent } from "react";
import type { MediaInputRole, UploadedInput } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";

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

/** One drop zone for a single input file. Uploads immediately so submit only sends ids. */
export function UploadSlot({ label, role, accept, value, onChange, hint }: Props) {
  const studio = useStudioApi();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange({ role, upload: await studio.upload(file), name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    void take(event.dataTransfer.files[0]);
  };
  const isVideo = value?.upload.mimeType.startsWith("video/");
  return (
    <div className={"slot" + (value ? " has-file" : "")} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {value ? (
        <>
          {isVideo ? (
            <video className="slot-preview" src={value.upload.url} muted playsInline aria-label={value.name} />
          ) : (
            <img className="slot-preview" src={value.upload.url} alt={value.name} />
          )}
          <button type="button" className="slot-remove" aria-label={"Remove " + label} onClick={() => onChange(null)}>
            <Icon name="close" size={14} />
          </button>
        </>
      ) : (
        <button type="button" className="slot-empty" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name={busy ? "clock" : "upload"} />
          <span>{busy ? "Uploading" : label}</span>
          {hint ? <span className="slot-hint">{hint}</span> : null}
        </button>
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
