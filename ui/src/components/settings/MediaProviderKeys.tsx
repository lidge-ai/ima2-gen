import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { jsonFetch } from "../../lib/api-core";
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
  const refresh = useCallback(async () => {
    try { setSnapshot(await loadKeys()); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const entries = snapshot?.vocabularies.filter((v) => !v.legacy || v.extraFields.length > 0) ?? [];
  return <article className="media-provider-keys">
    <h4>{t("media.keysTitle")}</h4>
    {error && <p className="api-key-error" role="alert">{error}</p>}
    {snapshot && entries.length === 0 && <p>{t("media.noProviders")}</p>}
    {snapshot && entries.map((v) => <MediaKeyForm key={v.vocabulary} vocabulary={v}
      status={snapshot.statuses[v.vocabulary]} adapters={snapshot.adapters} refresh={refresh} />)}
  </article>;
}

function MediaKeyForm({ vocabulary: v, status, adapters, refresh }: {
  vocabulary: MediaVocabulary; status?: MediaKeyStatus; adapters: MediaKeyAdapter[]; refresh: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = extraFieldStatus(v, status, adapters);
  const logo = v.logo?.urls.mark ?? v.logo?.urls.primary ?? v.logo?.urls.dark ?? v.logo?.urls.light;
  const save = async (method: "PUT" | "DELETE") => {
    setBusy(true); setError("");
    try {
      const suffix = v.legacy && method === "PUT" ? "/extra" : "";
      await jsonFetch(`/api/keys/${encodeURIComponent(v.vocabulary)}${suffix}`, {
        method, headers: { "Content-Type": "application/json" },
        ...(method === "PUT" ? { body: JSON.stringify(v.legacy ? { extra } : { apiKey: key, extra }) } : {}),
      });
      setKey(""); setExtra({}); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <section className="media-provider-keys__provider">
    <h4>{logo && <img src={logo} alt="" width={24} height={24} style={{ objectFit: "contain", verticalAlign: "middle", marginRight: 8 }} />}{v.label}</h4>
    {!v.legacy && <>
      <p>{status?.configured ? t("media.configured") : t("media.notConfigured")} · {status?.source ?? "none"} {status?.maskedKey}</p>
      <label>{t("media.apiKey")} <input className="api-key-input" type="password" autoComplete="off"
        placeholder={v.keyPrefix ?? ""} value={key} onChange={(e) => setKey(e.target.value)} /></label>
      {v.consoleUrl && <p><a href={v.consoleUrl} target="_blank" rel="noopener noreferrer">{t("media.getKey")}</a></p>}
    </>}
    {fields.map((field) => <label key={field.name} style={{ display: "block" }}>
      {field.name}{field.required ? " *" : ""} · {field.configured ? t("media.configured") : t("media.notConfigured")}
      {field.source && ` · ${field.source}`} {field.secret ? "" : field.value ?? ""}
      <input className="api-key-input" type={field.secret ? "password" : "text"} autoComplete="off"
        value={extra[field.name] ?? ""} onChange={(e) => setExtra({ ...extra, [field.name]: e.target.value })} />
    </label>)}
    <div className="api-key-actions">
      <button type="button" className="settings-action-btn" disabled={busy || (v.legacy ? !Object.values(extra).some(Boolean) : !key.trim())} onClick={() => void save("PUT")}>{t("settings.apiKeys.save")}</button>
      {!v.legacy && status?.source === "env" && <span>{t("media.envImmutable")}</span>}
      {!v.legacy && status?.source === "config" && <button type="button" className="settings-action-btn settings-action-btn--danger" disabled={busy} onClick={() => void save("DELETE")}>{t("settings.apiKeys.remove")}</button>}
    </div>
    {error && <p className="api-key-error" role="alert">{error}</p>}
  </section>;
}
