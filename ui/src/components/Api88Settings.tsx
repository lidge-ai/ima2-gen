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

function UrlField({ config, value, setValue, save, busy, error }: {
  config: Config | null; value: string; setValue: (value: string) => void;
  save: () => Promise<void>; busy: boolean; error: string | null;
}) {
  const { t } = useI18n();
  return <div className="settings-row">
    <div className="settings-row__copy"><h4>{t("settings.api88.baseUrl")}</h4>
      <p>{t("settings.api88.baseUrlHelp")}</p>
      <p>{config?.source === "env" ? t("settings.api88.sourceEnv") : config?.source === "config"
        ? t("settings.api88.sourceConfig") : t("settings.api88.sourceDefault")}</p>
    </div>
    <div className="settings-row__control">
      <label htmlFor="api88-base-url">{t("settings.api88.baseUrl")}</label>
      <input id="api88-base-url" type="url" value={value} disabled={!config || config.source === "env" || busy}
        onChange={(event) => setValue(event.target.value)} />
      <button type="button" className="settings-action-btn" disabled={!config || config.source === "env" || busy || value === config.baseUrl}
        onClick={() => void save()}>{t("settings.apiKeys.save")}</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </div>;
}

export function Api88Settings(props: Props) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchApi("/api/config/88api").then(async (response) => {
      if (!response.ok) throw new Error("config unavailable");
      const dto = await response.json() as Config;
      if (active) { setConfig(dto); setValue(dto.baseUrl); }
    }).catch(() => { if (active) setError(t("settings.api88.loadFailed")); });
    return () => { active = false; };
  }, [t]);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetchApi("/api/config/88api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: value }) });
      const dto = await response.json() as Config & { code?: string };
      if (!response.ok) { setError(dto.code === "API88_BASE_URL_ENV_LOCKED" ? t("settings.api88.sourceEnv") : t("settings.api88.saveFailed")); return; }
      setConfig(dto); setValue(dto.baseUrl); props.onSaved();
    } catch { setError(t("settings.apiKeys.networkError")); }
    finally { setBusy(false); }
  };
  return <section aria-label="88API">
    <Api88Keys {...props} />
    <UrlField config={config} value={value} setValue={setValue} save={save} busy={busy} error={error} />
  </section>;
}
