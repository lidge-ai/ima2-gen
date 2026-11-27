import { useId, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import type { MediaAdapter } from "../../lib/mediaCatalog";
import { loadMediaCatalog } from "../../lib/mediaCatalogStore";
import { extraFieldLabelKey, keyDraftProblem, keyEntrySupported, keySaveProblem, saveMediaKey, type KeySaveProblem } from "../../lib/mediaKeyEntry";
import { useAppStore } from "../../store/useAppStore";

/**
 * A provider key, entered where it is needed. The key is checked with the provider before it is
 * stored; the prompt, the images and the model settings are not touched, and once the key is in the
 * catalog reloads so the route becomes runnable in place.
 */
export function MediaKeyEntry({ adapter, replacing = false, onDone }: { adapter: MediaAdapter; replacing?: boolean; onDone?: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const showToast = useAppStore((s) => s.showToast);
  const openSettings = useAppStore((s) => s.openSettings);
  const setSelection = useAppStore((s) => s.setMediaSelection);
  const [apiKey, setApiKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: KeySaveProblem; raw: string } | null>(null);
  const provider = adapter.label;
  if (!keyEntrySupported(adapter)) {
    return (
      <section className="media-key" aria-labelledby={id + "-title"}>
        <h4 className="media-key__title" id={id + "-title"}>{t("mediaPicker.key.title", { provider })}</h4>
        <p>{t("mediaPicker.key.fileOnly")}</p>
        <button type="button" className="option-btn media-picker__open" onClick={() => openSettings("providers")}>{t("mediaPicker.settings")}</button>
      </section>
    );
  }
  const problem = keyDraftProblem(adapter, { apiKey, extra });
  const save = async () => {
    if (problem || busy) return;
    setBusy(true); setError(null);
    try {
      await saveMediaKey(adapter, { apiKey, extra });
      setApiKey(""); setExtra({});
      await loadMediaCatalog(true);
      showToast(t("mediaPicker.key.saved", { provider }));
      onDone?.();
    } catch (failure) {
      setError({ kind: keySaveProblem(failure), raw: failure instanceof Error ? failure.message : String(failure) });
    } finally { setBusy(false); }
  };
  // Enter saves the key and goes no further: this sits beside the composer, not inside a form of its own.
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); void save(); } };
  const hint = apiKey.trim() === "" ? null : problem === "short" ? t("mediaPicker.key.short")
    : problem === "prefix" ? t("mediaPicker.key.prefix", { prefix: adapter.keyPrefix ?? "" }) : problem === "extra" ? t("mediaPicker.key.extra") : null;
  const fieldLabel = (name: string) => (extraFieldLabelKey(name) ? t(`mediaPicker.key.field.${name}`) : name);
  return (
    <section className="media-key" aria-labelledby={id + "-title"}>
      <h4 className="media-key__title" id={id + "-title"}>{t(replacing ? "mediaPicker.key.replaceTitle" : "mediaPicker.key.title", { provider })}</h4>
      <p>{t("mediaPicker.key.body", { provider })}</p>
      {adapter.consoleUrl ? (
        <a className="media-link" href={adapter.consoleUrl} target="_blank" rel="noreferrer">{t("mediaPicker.key.get", { provider })}<span className="sr-only"> {t("mediaPicker.key.newTab")}</span></a>
      ) : null}
      <label className="media-key__label" htmlFor={id + "-key"}>{t("media.apiKey")}</label>
      <div className="media-key__row">
        <input id={id + "-key"} className="api-key-input" type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder={adapter.keyPrefix ?? ""}
          value={apiKey} aria-describedby={id + "-state"} onChange={(event) => { setApiKey(event.target.value); setError(null); }} onKeyDown={onEnter} />
        <button type="button" className="option-btn media-key__show" aria-pressed={shown} onClick={() => setShown(!shown)}>{t(shown ? "mediaPicker.key.hide" : "mediaPicker.key.show")}</button>
      </div>
      {adapter.extraFields.map((field) => (
        <label key={field.name} className="media-key__label">{fieldLabel(field.name)}{field.required && !field.configured ? " " + t("mediaPicker.key.required") : ""}
          <input className="api-key-input" type={field.secret ? "password" : "text"} autoComplete="off" spellCheck={false}
            placeholder={field.secret ? "" : field.value ?? ""} value={extra[field.name] ?? ""}
            onChange={(event) => setExtra({ ...extra, [field.name]: event.target.value })} onKeyDown={onEnter} />
        </label>
      ))}
      <div className="media-key__actions">
        <button type="button" className="modal__btn" disabled={problem !== null || busy} onClick={() => void save()}>
          {busy ? t("mediaPicker.key.checking", { provider }) : t("mediaPicker.key.save")}
        </button>
        {replacing && onDone ? <button type="button" className="modal__btn modal__btn--secondary" disabled={busy} onClick={onDone}>{t("common.cancel")}</button> : null}
      </div>
      {error ? (
        <div className="media-key__state" id={id + "-state"} role="alert">
          <p>{error.kind === "rejected" ? t("mediaPicker.key.rejected", { provider }) : error.kind === "unverified" ? t("mediaPicker.key.unverified", { provider })
            : error.kind === "format" ? t("mediaPicker.key.formatWrong") : error.kind === "extra" ? t("mediaPicker.key.extra") : t("mediaPicker.key.failed")}</p>
          <details className="media-details"><summary>{t("mediaPicker.details")}</summary><p className="media-error-detail">{error.raw}</p></details>
        </div>
      ) : <p className="media-key__state" id={id + "-state"} role="status">{hint}</p>}
      {replacing ? null : (
        <p className="media-key__aside">{t("mediaPicker.key.subscription")}{" "}
          <button type="button" className="media-link" onClick={() => setSelection(null)}>{t("mediaPicker.useBuiltin")}</button></p>
      )}
    </section>
  );
}
