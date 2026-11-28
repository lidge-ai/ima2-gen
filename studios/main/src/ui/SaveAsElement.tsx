import { useState } from "react";
import type { ElementKind, HistoryItem } from "@ima2/studio-kit";
import { useT } from "../i18n.ts";
import { EM } from "../pages/assets/elementMessages.ts";
import { KindChoice } from "../pages/assets/ElementsPanel.tsx";
import { useStudioApi } from "../studio/context.tsx";
import { elementsChanged } from "../studio/elements.ts";
import "../styles/assets.css";

/** "Save as element" on an image result: a name and a kind, then the result becomes an element's reference image. */
export function SaveAsElement({ item }: { item: HistoryItem }) {
  const t = useT(EM);
  const studio = useStudioApi();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // No kind is chosen for the person: a lighthouse is not filed as a character by default.
  const [kind, setKind] = useState<ElementKind | "">("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim() || !kind) return;
    setState("saving");
    setError("");
    try {
      await studio.client.elements.fromResults({ paths: [item.historyId], name: name.trim(), kind });
      elementsChanged();
      setState("saved");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  };
  if (state === "saved") return <p role="status" className="save-element-done">{t("saved")} <a href="#/assets/elements">{t("seeAll")}</a></p>;
  if (!open) return <button type="button" className="btn" onClick={() => setOpen(true)}>{t("saveAs")}</button>;
  return (
    <form className="save-element" aria-label={t("saveAs")} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="field">
        <span>{t("name")}</span>
        <input autoFocus value={name} maxLength={80} placeholder={t("namePlaceholder")} onChange={(e) => setName(e.target.value)} />
      </label>
      <KindChoice value={kind} onChange={setKind} />
      <div className="save-element-actions">
        <button type="submit" className="btn btn-primary" disabled={!name.trim() || !kind || state === "saving"}>{t(state === "saving" ? "saving" : "save")}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>{t("cancel")}</button>
        {name.trim() && !kind ? <span className="form-hint">{t("needKind")}</span> : null}
      </div>
      {error ? <p className="form-error" role="alert">{t("actionFailed", { error })}</p> : null}
    </form>
  );
}
