import { useRef, useState } from "react";
import { ELEMENT_KINDS, type Element, type ElementKind, type UploadedInput } from "@ima2/studio-kit";
import { useT } from "../../i18n.ts";
import { useStudioApi } from "../../studio/context.tsx";
import { elementsChanged, useElements } from "../../studio/elements.ts";
import { EM } from "./elementMessages.ts";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One choice among the element kinds, as a row of pressed buttons. */
export function KindChoice({ value, onChange, all }: { value: ElementKind | ""; onChange: (kind: ElementKind | "") => void; all?: boolean }) {
  const t = useT(EM);
  return (
    <div className="chip-row" role="group" aria-label={t(all ? "kinds" : "kind")}>
      {(all ? ["" as const, ...ELEMENT_KINDS] : ELEMENT_KINDS).map((kind) => (
        <button key={kind || "all"} type="button" className="chip" aria-pressed={value === kind} onClick={() => onChange(kind)}>
          {t(kind || "allKinds")}
        </button>
      ))}
    </div>
  );
}

function NewElement() {
  const t = useT(EM);
  const studio = useStudioApi();
  const input = useRef<HTMLInputElement>(null);
  // The image is uploaded when chosen, as in the forms, and the preview is the server's copy.
  const [file, setFile] = useState<UploadedInput | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ElementKind>("character");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = !file ? t("needImage") : !name.trim() ? t("needName") : null;
  const choose = async (picked: File) => {
    setBusy(true);
    setError("");
    try {
      setFile(await studio.upload(picked));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!file || problem) return;
    setBusy(true);
    setError("");
    try {
      await studio.client.elements.fromUpload({ inputId: file.inputId, name: name.trim(), kind });
      setFile(null);
      setName("");
      elementsChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="element-new" aria-label={t("newTitle")} onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2>{t("newTitle")}</h2>
      <div className="element-new-row">
        <button type="button" className="element-new-image" onClick={() => input.current?.click()} aria-label={t(file ? "change" : "choose")}>
          {file ? <img src={file.url} alt="" /> : <span>{t("choose")}</span>}
        </button>
        <input
          ref={input} type="file" accept="image/*" hidden aria-label={t("image")}
          onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void choose(picked); e.target.value = ""; }}
        />
        <div className="element-new-fields">
          <label className="field">
            <span>{t("name")}</span>
            <input value={name} maxLength={80} placeholder={t("namePlaceholder")} onChange={(e) => setName(e.target.value)} />
          </label>
          <KindChoice value={kind} onChange={(next) => { if (next) setKind(next); }} />
          <div className="element-new-foot">
            <button type="submit" className="btn btn-primary" disabled={!!problem || busy} title={problem ?? undefined}>{t(busy ? "saving" : "save")}</button>
            {problem && (file || name) ? <span className="form-hint">{problem}</span> : null}
          </div>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">{t("actionFailed", { error })}</p> : null}
    </form>
  );
}

function ElementCard({ element }: { element: Element }) {
  const t = useT(EM);
  const studio = useStudioApi();
  const [mode, setMode] = useState<"view" | "edit" | "remove">("view");
  const [name, setName] = useState(element.name);
  const [kind, setKind] = useState<ElementKind>(element.kind);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      setMode("view");
      elementsChanged();
    } catch (err) {
      setError(message(err));
    }
  };
  return (
    <article className="element-card" aria-label={element.name}>
      <div className="element-card-image">
        <img src={element.images[0]!.url} alt="" loading="lazy" />
        {element.images.length > 1 ? <span className="element-card-count">{t("images", { n: element.images.length })}</span> : null}
      </div>
      {mode === "edit" ? (
        <form className="element-card-body" aria-label={t("editing", { name: element.name })} onSubmit={(e) => { e.preventDefault(); if (name.trim()) void run(() => studio.client.elements.update(element, { name: name.trim(), kind })); }}>
          <label className="field">
            <span>{t("name")}</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <KindChoice value={kind} onChange={(next) => { if (next) setKind(next); }} />
          <div className="element-card-actions">
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>{t("done")}</button>
            <button type="button" className="btn" onClick={() => { setName(element.name); setKind(element.kind); setMode("view"); }}>{t("cancel")}</button>
          </div>
        </form>
      ) : (
        <div className="element-card-body">
          <h3>{element.name}</h3>
          <p className="element-card-kind">{t(element.kind)}</p>
          {mode === "remove" ? (
            <div className="element-card-actions" role="group" aria-label={t("confirmRemove", { name: element.name })}>
              <span className="element-card-ask">{t("confirmRemove", { name: element.name })}</span>
              <button type="button" className="btn btn-danger" onClick={() => void run(() => studio.client.elements.remove(element.id))}>{t("confirm")}</button>
              <button type="button" className="btn" onClick={() => setMode("view")}>{t("keep")}</button>
            </div>
          ) : (
            <div className="element-card-actions">
              <button type="button" className="btn btn-ghost element-card-quiet" onClick={() => setMode("edit")}>{t("edit")}</button>
              <button type="button" className="btn btn-ghost element-card-quiet" onClick={() => setMode("remove")}>{t("remove")}</button>
            </div>
          )}
        </div>
      )}
      {error ? <p className="form-error" role="alert">{t("actionFailed", { error })}</p> : null}
    </article>
  );
}

/** The Elements tab of Assets: add one from an image, and rename, re-kind or delete the saved ones. */
export function ElementsPanel() {
  const t = useT(EM);
  const { elements, error, loading, reload } = useElements();
  const [kind, setKind] = useState<ElementKind | "">("");
  const shown = (elements ?? []).filter((element) => !kind || element.kind === kind);
  return (
    <div className="elements">
      <p className="elements-lead">{t("lead")}</p>
      <NewElement />
      <div className="elements-filter"><span>{t("show")}</span><KindChoice all value={kind} onChange={setKind} /></div>
      {error ? <div role="alert">{t("failed", { error })} <button className="btn" type="button" onClick={reload}>{t("retry")}</button></div> : null}
      {loading ? <p role="status">{t("loading")}</p> : null}
      {elements && elements.length === 0 ? (
        <div className="empty"><h2>{t("empty")}</h2><p>{t("emptyBody")}</p></div>
      ) : elements && shown.length === 0 ? <p className="form-hint">{t("emptyKind")}</p> : null}
      <section className="element-grid" aria-label={t("list")}>
        {shown.map((element) => <ElementCard key={element.id} element={element} />)}
      </section>
    </div>
  );
}
