import { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n";
import { jsonFetch } from "../../lib/api-core";
import { logoPlate, logoUrl } from "../../lib/mediaCatalog";
import { extraFieldStatus, type MediaKeyAdapter, type MediaKeyStatus, type MediaVocabulary } from "../../lib/mediaKeys";

interface Snapshot {
  vocabularies: MediaVocabulary[];
  statuses: Record<string, MediaKeyStatus>;
  adapters: MediaKeyAdapter[];
}

async function loadKeys(): Promise<Snapshot> {
  const [vocabulary, statuses, catalog] = await Promise.all([
    jsonFetch<{ vocabularies: MediaVocabulary[] }>("/api/keys/vocabulary"),
    jsonFetch<Record<string, MediaKeyStatus>>("/api/keys/status"),
    jsonFetch<{ adapters: MediaKeyAdapter[] }>("/api/media/catalog"),
  ]);
  return { vocabularies: vocabulary.vocabularies, statuses, adapters: catalog.adapters };
}

export function MediaProviderKeys() {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(false);
  const refresh = useCallback(async () => {
    try { setSnapshot(await loadKeys()); setError(""); }
    catch { setError("load"); }
  }, []);
  // Loaded on request so opening Settings keeps its previous requests.
  useEffect(() => { if (shown) void refresh(); }, [shown, refresh]);
  const entries = snapshot?.vocabularies.filter((v) => !v.legacy || v.extraFields.length > 0) ?? [];
  if (!shown) {
    return <article className="media-provider-keys">
      <h4>{t("media.keysTitle")}</h4>
      <button type="button" className="option-btn" onClick={() => setShown(true)}>{t("media.keysShow")}</button>
    </article>;
  }
  return <article className="media-provider-keys">
    <h4>{t("media.keysTitle")}</h4>
    {error && <div className="api-key-error" role="alert">{t("media.loadError")} <button type="button" className="media-link" onClick={() => void refresh()}>{t("mediaPicker.retry")}</button></div>}
    {!snapshot && !error && <p role="status">{t("media.loading")}</p>}
    {snapshot && entries.length === 0 && <p>{t("media.noProviders")}</p>}
    {snapshot && entries.map((v) => <MediaKeyForm key={v.vocabulary} vocabulary={v}
      status={snapshot.statuses[v.vocabulary]} adapters={snapshot.adapters} refresh={refresh} />)}
  </article>;
}

function MediaKeyForm({ vocabulary: v, status, adapters, refresh }: {
  vocabulary: MediaVocabulary; status?: MediaKeyStatus; adapters: MediaKeyAdapter[]; refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [key, setKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = extraFieldStatus(v, status, adapters);
  const logo = logoUrl(v.logo);
  const save = async (method: "PUT" | "DELETE") => {
    setBusy(true); setError("");
    try {
      const suffix = v.legacy && method === "PUT" ? "/extra" : "";
      await jsonFetch(`/api/keys/${encodeURIComponent(v.vocabulary)}${suffix}`, {
        method, headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify(v.legacy ? { extra } : { apiKey: key, extra }) } : {}),
      });
      setKey(""); setExtra({}); await refresh();
    } catch { setError(method === "PUT" ? "save" : "remove"); }
    finally { setBusy(false); }
  };
  return <section className="settings-row media-provider-keys__provider">
    <div className="settings-row__copy">
      <h4 className="media-provider-keys__heading">{logo && <span className={`media-logo media-logo--${logoPlate(v.logo)}`}><img src={logo} alt="" /></span>}{v.label}</h4>
      {status?.configured && <p>{status.source === "env" ? t("settings.apiKeys.envSource") : t("settings.apiKeys.configSource")}</p>}
      {!v.legacy && <>
        <label htmlFor={`${id}-key`}>{t("media.apiKey")}</label>
        <div className="api-key-input-group">
          <input id={`${id}-key`} className="api-key-input" type="password" autoComplete="off"
            placeholder={status?.maskedKey || v.keyPrefix || ""} value={key} onChange={(e) => setKey(e.target.value)} />
          <div className="api-key-actions">
            <button type="button" className="settings-action-btn" disabled={busy || !key.trim()} onClick={() => void save("PUT")}>{t("settings.apiKeys.save")}</button>
            {status?.source === "config" && <button type="button" className="settings-action-btn settings-action-btn--danger" disabled={busy} onClick={() => void save("DELETE")}>{t("settings.apiKeys.remove")}</button>}
          </div>
        </div>
        {v.consoleUrl && <p><a href={v.consoleUrl} target="_blank" rel="noopener noreferrer">{t("media.getKey")}</a></p>}
        {status?.source === "env" && <p>{t("media.envImmutable")}</p>}
      </>}
      {fields.map((field, index) => <div className="media-provider-keys__field" key={field.name}>
        <label htmlFor={`${id}-field-${index}`}>{field.name}{field.required ? " *" : ""}</label>
        <span>{field.configured ? t("media.configured") : t("media.notConfigured")}{field.source && ` · ${field.source}`} {field.secret ? "" : field.value ?? ""}</span>
        <div className="api-key-input-group"><input id={`${id}-field-${index}`} className="api-key-input" type={field.secret ? "password" : "text"} autoComplete="off"
          value={extra[field.name] ?? ""} onChange={(e) => setExtra({ ...extra, [field.name]: e.target.value })} />
          <button type="button" className="settings-action-btn" disabled={busy || !extra[field.name]?.trim() || (!v.legacy && !key.trim())} onClick={() => void save("PUT")}>{t("settings.apiKeys.save")}</button></div>
      </div>)}
      {error && <p className="api-key-error" role="alert">{t(error === "save" ? "media.saveError" : "media.removeError")}</p>}
    </div>
    <div className={`settings-status${status?.configured ? " is-ok" : ""}`}><span aria-hidden="true" />{status?.configured ? t("media.configured") : t("media.notConfigured")}</div>
  </section>;
}
