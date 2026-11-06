import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { GIF_FRAME_COUNT_RANGE, GIF_FRAME_DURATION_RANGE, isImage26ToolModel } from "../lib/imageModels";
import { t } from "../i18n";
import { OptionGroup } from "./OptionGroup";
import type { ImageOutputKind } from "../types";

/** Digits only; empty means "OpenAI default". Out-of-range drafts are kept local, never saved. */
function FrameInput({ label, value, range, onCommit }: {
  label: string;
  value: number | null;
  range: { min: number; max: number; default: number };
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => { setDraft(value === null ? "" : String(value)); }, [value]);
  const parsed = draft === "" ? null : Number(draft);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= range.min && parsed <= range.max);
  return (
    <label className="image-output__field">
      <span className="image-output__label">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="custom-size-input"
        aria-label={label}
        aria-invalid={!valid}
        value={draft}
        placeholder={String(range.default)}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
        onBlur={() => { if (valid) onCommit(parsed); }}
      />
      <span className="image-output__hint">{t("imageOutput.range", { min: range.min, max: range.max })}</span>
    </label>
  );
}

/** GIF/SVG output for Images 2.6 on the API lane. Renders nothing elsewhere. */
export function ImageOutputControls() {
  const provider = useAppStore((s) => s.provider);
  const imageToolModel = useAppStore((s) => s.imageToolModel);
  const kind = useAppStore((s) => s.imageOutputKind);
  const frameCount = useAppStore((s) => s.gifFrameCount);
  const frameDurationMs = useAppStore((s) => s.gifFrameDurationMs);
  const setImageOutput = useAppStore((s) => s.setImageOutput);
  if (provider !== "api" || !isImage26ToolModel(imageToolModel)) return null;
  const items: Array<{ value: ImageOutputKind; label: string; sub?: string }> = [
    { value: "still", label: t("imageOutput.still") },
    { value: "gif", label: t("imageOutput.gif") },
    { value: "svg", label: t("imageOutput.svg"), sub: t("imageOutput.svgSub") },
  ];
  return (
    <>
      <OptionGroup<ImageOutputKind>
        title={t("imageOutput.title")}
        items={items}
        value={kind}
        onChange={(next) => setImageOutput({ kind: next })}
      />
      {kind === "gif" ? (
        <div className="option-row image-output__frames">
          <FrameInput label={t("imageOutput.frames")} value={frameCount} range={GIF_FRAME_COUNT_RANGE}
            onCommit={(value) => setImageOutput({ gifFrameCount: value })} />
          <FrameInput label={t("imageOutput.frameMs")} value={frameDurationMs} range={GIF_FRAME_DURATION_RANGE}
            onCommit={(value) => setImageOutput({ gifFrameDurationMs: value })} />
        </div>
      ) : null}
      {kind !== "still" ? <p className="image-output__note">{t(kind === "gif" ? "imageOutput.gifNote" : "imageOutput.svgNote")}</p> : null}
    </>
  );
}
