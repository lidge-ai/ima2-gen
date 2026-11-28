import { useEffect, useRef, useState } from "react";
import { messages, useT } from "../../i18n.ts";

const M = messages(
  {
    title: "Paint the area to change", lead: "Paint over what the model should repaint. Everything else stays as it is.",
    canvas: "Image to paint on", size: "Brush size", clear: "Clear", cancel: "Cancel", done: "Use this area", empty: "Paint an area first.",
    failed: "Could not make the mask from this image. Try another file.",
  },
  {
    title: "바꿀 부분 칠하기", lead: "모델이 다시 그릴 부분을 칠해 주세요. 나머지는 그대로 남아요.",
    canvas: "칠할 이미지", size: "브러시 크기", clear: "지우기", cancel: "취소", done: "이 부분 사용", empty: "먼저 바꿀 부분을 칠해 주세요.",
    failed: "이 이미지로 마스크를 만들지 못했어요. 다른 파일로 시도해 주세요.",
  },
);

/**
 * The mask a brush made: a PNG the same pixel size as the image, white where the model repaints and black
 * where it keeps the image (the "repaint-white" convention; the server converts it for the provider).
 */
export async function maskPng(strokes: HTMLCanvasElement): Promise<Blob> {
  const out = document.createElement("canvas");
  out.width = strokes.width;
  out.height = strokes.height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(strokes, 0, 0);
  return new Promise((resolve, reject) => out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("no mask"))), "image/png"));
}

interface Props {
  /** The image being edited; null closes the dialog. */
  image: { url: string; name: string } | null;
  onCancel: () => void;
  onDone: (mask: Blob) => Promise<void> | void;
}

/** A dialog to paint, on the image, the area an edit should repaint. */
export function MaskBrush({ image, onCancel, onDone }: Props) {
  const t = useT(M);
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState(8);
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(null);
  const url = image?.url;
  // Opening on an image starts clean; the stage below is keyed by the image, so its canvas and size start over too.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (url && !el.open) el.showModal();
    if (!url && el.open) el.close();
    setPainted(false);
    setFailed(false);
  }, [url]);

  /** A pointer position in the image's own pixels. */
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * e.currentTarget.width, y: ((e.clientY - box.top) / box.height) * e.currentTarget.height };
  };
  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    // The brush is a share of the image's longer side, so it feels the same on a small and a large image.
    ctx.lineWidth = (Math.max(el.width, el.height) * size) / 100;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    setPainted(true);
  };
  const clear = () => {
    const el = canvas.current;
    el?.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    setPainted(false);
  };
  const done = async () => {
    if (!canvas.current || !painted) return;
    setBusy(true);
    setFailed(false);
    try {
      await onDone(await maskPng(canvas.current));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog ref={dialog} className="mask-brush" aria-label={t("title")} onClose={onCancel}>
      {image ? (
        <div className="mask-brush-body">
          <header>
            <h2>{t("title")}</h2>
            <p>{t("lead")}</p>
          </header>
          <div className="mask-brush-stage" key={image.url}>
            <img src={image.url} alt={image.name} onLoad={(e) => setNatural({ url: image.url, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
            {natural && natural.url === image.url ? (
              <canvas
                ref={canvas} width={natural.width} height={natural.height} aria-label={t("canvas")}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = at(e); stroke(last.current, last.current); }}
                onPointerMove={(e) => { if (!last.current) return; const next = at(e); stroke(last.current, next); last.current = next; }}
                onPointerUp={() => { last.current = null; }}
                onPointerCancel={() => { last.current = null; }}
              />
            ) : null}
          </div>
          <div className="mask-brush-tools">
            <label>
              <span>{t("size")}</span>
              <input type="range" min={2} max={30} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            </label>
            <button type="button" className="btn btn-ghost" onClick={clear} disabled={!painted}>{t("clear")}</button>
            <span className="mask-brush-spacer" />
            <button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button>
            <button type="button" className="btn btn-primary" onClick={() => void done()} disabled={!painted || busy} title={painted ? undefined : t("empty")}>{t("done")}</button>
          </div>
          {failed ? <p className="form-error" role="alert">{t("failed")}</p> : null}
        </div>
      ) : null}
    </dialog>
  );
}
