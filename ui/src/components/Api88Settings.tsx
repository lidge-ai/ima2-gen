import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { KeyStatus } from "../hooks/useKeyStatus";
import { fetchApi } from "../lib/api-core";
import { ApiKeyInput } from "./ApiKeyInput";

type Config = { baseUrl: string; source: "env" | "config" | "default" };
type Props = { keyStatus: KeyStatus; onSaved: () => void };

function Api88Keys({ keyStatus, onSaved }: Props) {
  const { t } = useI18n();
  return <>
    <ApiKeyInput provider="api88-image" label={t("settings.api88.imageKey")}
      placeholder={t("settings.api88.keyPlaceholder")}
      maskedKey={keyStatus["api88-image"]?.maskedKey ?? null}
      source={keyStatus["api88-image"]?.source ?? "none"}
      configured={keyStatus["api88-image"]?.configured ?? false} onSaved={onSaved} />
    <ApiKeyInput provider="api88-video" label={t("settings.api88.videoKey")}
      placeholder={t("settings.api88.keyPlaceholder")}
      maskedKey={keyStatus["api88-video"]?.maskedKey ?? null}
      source={keyStatus["api88-video"]?.source ?? "none"}
      configured={keyStatus["api88-video"]?.configured ?? false} onSaved={onSaved} />
  </>;
}

type ErrorKey = "load" | "save" | "env" | "network";

function errorText(t: ReturnType<typeof useI18n>["t"], key: ErrorKey): string {
  if (key === "load") return t("settings.api88.loadFailed");
  if (key === "save") return t("settings.api88.saveFailed");
  if (key === "env") return t("settings.api88.sourceEnv");
  return t("settings.apiKeys.networkError");
}

function UrlField({ config, value, setValue, save, busy, errorKey }: {
  config: Config | null; value: string; setValue: (value: string) => void;
  save: () => Promise<void>; busy: boolean; errorKey: ErrorKey | null;
}) {
  const { t } = useI18n();
  const error = errorKey ? errorText(t, errorKey) : null;
  const locked = !config || config.source === "env" || busy;
  const sourceLabel = config?.source === "env" ? t("settings.api88.sourceEnv")
    : config?.source === "config" ? t("settings.api88.sourceConfig") : t("settings.api88.sourceDefault");
  // Mirrors ApiKeyInput's row so the base URL sits in the same visual system as the two keys.
  return <article className="settings-row">
    <div className="settings-row__copy">
      <p className="settings-eyebrow">{sourceLabel}</p>
      <h4><label htmlFor="api88-base-url">{t("settings.api88.baseUrl")}</label></h4>
      <div className="api-key-input-group">
        <input id="api88-base-url" type="url" className={`api-key-input${error ? " is-invalid" : ""}`}
          value={value} disabled={locked} spellCheck={false} autoComplete="off"
          onChange={(event) => setValue(event.target.value)} />
        <div className="api-key-actions">
          <button type="button" className="settings-action-btn" disabled={locked || value === config?.baseUrl}
            onClick={() => void save()}>{t("settings.apiKeys.save")}</button>
        </div>
      </div>
      {error ? <p className="api-key-error" role="alert">{error}</p> : null}
      <p>{t("settings.api88.baseUrlHelp")}</p>
    </div>
  </article>;
}

export function Api88Settings(props: Props) {
  const [config, setConfig] = useState<Config | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setError] = useState<ErrorKey | null>(null);
  useEffect(() => {
    let active = true;
    void fetchApi("/api/config/88api").then(async (response) => {
      if (!response.ok) throw new Error("config unavailable");
      const dto = await response.json() as Config;
      if (active) { setConfig(dto); setValue(dto.baseUrl); setError(null); }
    }).catch(() => { if (active) setError("load"); });
    return () => { active = false; };
    // Load once per mount: keying this on the translator re-ran it on every render and
    // looped GET /api/config/88api into the server's rate limit.
  }, []);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetchApi("/api/config/88api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: value }) });
      const dto = await response.json() as Config & { code?: string };
      if (!response.ok) { setError(dto.code === "API88_BASE_URL_ENV_LOCKED" ? "env" : "save"); return; }
      setConfig(dto); setValue(dto.baseUrl); props.onSaved();
    } catch { setError("network"); }
    finally { setBusy(false); }
  };
  return <section aria-label="88API">
    <Api88Keys {...props} />
    <UrlField config={config} value={value} setValue={setValue} save={save} busy={busy} errorKey={errorKey} />
  </section>;
}
