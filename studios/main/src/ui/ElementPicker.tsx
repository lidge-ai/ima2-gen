import { useEffect, useRef, useState } from "react";
import type { Element } from "@ima2/studio-kit";
import { useT } from "../i18n.ts";
import { EM } from "../pages/assets/elementMessages.ts";
import { useElements } from "../studio/elements.ts";
import "../styles/assets.css";

/** A button that opens the saved elements; choosing one hands it to the form, which adds its images as inputs. */
export function ElementPicker({ onPick, disabled }: { onPick: (element: Element) => void; disabled?: boolean }) {
  const t = useT(EM);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { elements, error, loading, reload } = useElements(open);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <>
      <button type="button" className="chip element-pick" disabled={disabled} onClick={() => setOpen(true)}>{t("pick")}</button>
      <dialog ref={dialog} className="element-picker" aria-label={t("pickTitle")} onClose={() => setOpen(false)}>
        {open ? (
          <div className="element-picker-body">
            <header>
              <h2>{t("pickTitle")}</h2>
              <p>{t("pickLead")}</p>
            </header>
            {error ? <div role="alert">{t("failed", { error })} <button className="btn" type="button" onClick={reload}>{t("retry")}</button></div> : null}
            {loading ? <p role="status">{t("loading")}</p> : null}
            {elements && elements.length === 0 ? <p className="form-hint">{t("pickEmpty")} <a href="#/assets/elements">{t("openAssets")}</a></p> : null}
            <div className="element-picker-list">
              {(elements ?? []).map((element) => (
                <button key={element.id} type="button" className="element-picker-item" aria-label={t("use", { name: element.name })} onClick={() => { onPick(element); setOpen(false); }}>
                  <img src={element.images[0]!.url} alt="" loading="lazy" />
                  <span className="element-picker-name">{element.name}</span>
                  <span className="element-picker-kind">{t(element.kind)}{element.images.length > 1 ? " · " + t("images", { n: element.images.length }) : ""}</span>
                </button>
              ))}
            </div>
            <div className="element-picker-foot"><button type="button" className="btn" onClick={() => setOpen(false)}>{t("close")}</button></div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
