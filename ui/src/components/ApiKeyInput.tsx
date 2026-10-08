import { fetchApi } from "../lib/api-core";
import { useState, useCallback } from "react";
import { useI18n } from "../i18n";

type ApiKeyInputProps = {
  provider: "openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai";
  label: string;
  placeholder: string;
  maskedKey: string | null;
  source: string;
  configured: boolean;
  onSaved: () => void;
};

export function ApiKeyInput({ provider, label, placeholder, maskedKey, source, configured, onSaved }: ApiKeyInputProps) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const isEnv = source === "env";
  const dirty = key.trim().length > 0;
  const showMasked = configured && !editing && !dirty;

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetchApi(`/api/keys/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || t("settings.apiKeys.saveFailed"));
      } else {
        setKey("");
        setEditing(false);
        setSuccess(true);
        onSaved();
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "LAN_TOKEN_REQUIRED") return;
      setError(t("settings.apiKeys.networkError"));
    } finally {
      setSaving(false);
    }
  }, [key, provider, dirty, onSaved, t]);

  const handleDelete = useCallback(async () => {
    try {
      const res = await fetchApi(`/api/keys/${provider}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("settings.apiKeys.removeFailed"));
        return;
      }
      setKey("");
      setEditing(false);
      onSaved();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "LAN_TOKEN_REQUIRED") return;
      setError(t("settings.apiKeys.networkError"));
    }
  }, [provider, onSaved, t]);

  const handleFocus = useCallback(() => {
    if (configured) {
      setEditing(true);
    }
  }, [configured]);

  const handleBlur = useCallback(() => {
    if (!dirty) {
      setEditing(false);
    }
  }, [dirty]);

  return (
    <article className="settings-row">
      <div className="settings-row__copy">
        <p className="settings-eyebrow">{isEnv ? t("settings.apiKeys.envSource") : t("settings.apiKeys.configSource")}</p>
        <h4>{label}</h4>
        <div className="api-key-input-group">
          {showMasked ? (
            <input
              type="text"
              className="api-key-input is-masked"
              value={maskedKey || "●●●●●●"}
              readOnly
              onFocus={handleFocus}
              onClick={handleFocus}
            />
          ) : (
            <input
              type="password"
              className={`api-key-input${error ? " is-invalid" : ""}`}
              placeholder={placeholder}
              value={key}
              onChange={(e) => { setKey(e.target.value); setError(null); }}
              onBlur={handleBlur}
              readOnly={false}
              autoComplete="off"
              autoFocus={editing}
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
            />
          )}
          <div className="api-key-actions">
            <button
              type="button"
              className="settings-action-btn"
              onClick={handleSave}
              disabled={!dirty || saving}
            >
              {saving ? t("settings.apiKeys.saving") : success ? t("settings.apiKeys.saved") : t("settings.apiKeys.save")}
            </button>
            {configured && !isEnv && (
              <button
                type="button"
                className="settings-action-btn settings-action-btn--danger"
                onClick={handleDelete}
              >
                {t("settings.apiKeys.remove")}
              </button>
            )}
          </div>
        </div>
        {error && <p className="api-key-error">{error}</p>}
      </div>
      <div className={`settings-status${configured ? " is-ok" : ""}`}>
        <span aria-hidden="true" />
        {configured ? t("settings.apiKeys.status.valid") : t("settings.apiKeys.status.notConfigured")}
      </div>
    </article>
  );
}
