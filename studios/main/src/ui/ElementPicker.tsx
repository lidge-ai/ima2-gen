import { useEffect, useRef, useState } from "react";
import { elementInputs, type Element, type MediaInputRole } from "@ima2/studio-kit";
import { useT } from "../i18n.ts";
import { EM } from "../pages/assets/elementMessages.ts";
import { useElements } from "../studio/elements.ts";
import type { SlotValue } from "./UploadSlot.tsx";
import "../styles/assets.css";

interface Props {
  /** The role the form gives the element's images. */
  role: MediaInputRole;
  /** What the form already holds, and how many more it takes. */
  held: readonly SlotValue[];
  max: number;
  onAdd: (inputs: SlotValue[]) => void;
  /** Where the images go in this form: its references, or its image list. */
  into: "references" | "images";
}

/**
 * A button that opens the saved elements. Choosing one adds its images to the form, as many as still fit;
 * when some did not fit, or all were already there, a line next to the button says so.
 */
export function ElementPicker({ role, held, max, onAdd, into }: Props) {
  const t = useT(EM);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { elements, error, loading, reload } = useElements(open);
  const room = Math.max(0, max - held.length);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  const pick = (element: Element) => {
    const fresh = elementInputs(element, role, element.images.length).filter((input) => !held.some((value) => value.upload.inputId === input.upload.inputId));
    const added = fresh.slice(0, room);
    const total = element.images.length;
    setNote(fresh.length === 0 ? t("alreadyIn") : added.length < fresh.length ? t("trimmed", { n: added.length, total, room }) : "");
    if (added.length > 0) onAdd(added);
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="chip element-pick" disabled={room === 0} onClick={() => { setNote(""); setOpen(true); }}>{t("pick")}</button>
      {note ? <span className="form-hint element-pick-note" role="status">{note}</span> : null}
      <dialog ref={dialog} className="element-picker" aria-label={t("pickTitle")} onClose={() => setOpen(false)}>
        {open ? (
          <div className="element-picker-body">
            <header>
              <h2>{t("pickTitle")}</h2>
              <p>{t(into === "references" ? "pickLead" : "pickLeadImages")}</p>
            </header>
            {error ? <div role="alert">{t("failed", { error })} <button className="btn" type="button" onClick={reload}>{t("retry")}</button></div> : null}
            {loading ? <p role="status">{t("loading")}</p> : null}
            {elements && elements.length === 0 ? <p className="form-hint">{t("pickEmpty")}</p> : null}
            <div className="element-picker-list">
              {(elements ?? []).map((element) => (
                <button key={element.id} type="button" className="element-picker-item" aria-label={t("use", { name: element.name })} onClick={() => pick(element)}>
                  <img src={element.images[0]!.url} alt="" loading="lazy" />
                  <span className="element-picker-name">{element.name}</span>
                  <span className="element-picker-kind">{t(element.kind)}{element.images.length > 1 ? " · " + t("images", { n: element.images.length }) : ""}</span>
                </button>
              ))}
            </div>
            <div className="element-picker-foot">
              {/* A new tab, so what is already in this form stays as it is. */}
              <a className="btn" href="#/assets/elements" target="_blank" rel="noreferrer">{t("openAssets")}</a>
              <button type="button" className="btn" onClick={() => setOpen(false)}>{t("close")}</button>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
