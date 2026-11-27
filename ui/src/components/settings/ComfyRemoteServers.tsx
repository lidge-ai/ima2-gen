import { useCallback, useState } from "react";
import { deleteComfyRemote, listComfyRemotes, putComfyRemote, type ComfyRemote } from "../../lib/api-comfy";
import { useI18n } from "../../i18n";

/**
 * ComfyUI servers beyond this computer. Closed by default and read only when opened: most people run
 * ComfyUI here and never need it. The token is write-only, so the list says only whether one is saved.
 */
export function ComfyRemoteServers() {
  const { t } = useI18n();
  const [remotes, setRemotes] = useState<ComfyRemote[] | null>(null);
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRemotes((await listComfyRemotes()).remotes);
    } catch (cause) {
      setRemotes([]);
      setError(cause instanceof Error ? cause.message : t("comfy.remoteFailed"));
    }
  }, [t]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("comfy.remoteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const add = () => run(async () => {
    await putComfyRemote(origin.trim(), token);
    setOrigin("");
    setToken("");
    return null;
  });

  const remove = (target: string) => run(async () => {
    const result = await deleteComfyRemote(target);
    return result.strandedWorkflows.length > 0 ? t("comfy.remoteStranded", { ids: result.strandedWorkflows.join(", ") }) : null;
  });

  return (
    <details className="comfy-remotes" onToggle={(event) => { if (event.currentTarget.open && remotes === null) void load(); }}>
      <summary>{t("comfy.remotesTitle")}</summary>
      <p className="muted">{t("comfy.remotesHint")}</p>
      <p className="muted">{t("comfy.remotesTrust")}</p>
      {remotes === null ? <div className="muted">{t("comfy.loading")}</div> : null}
      {remotes !== null && remotes.length === 0 ? <div className="muted">{t("comfy.remotesEmpty")}</div> : null}
      {remotes && remotes.length > 0 ? (
        <ul className="comfy-remote-list">
          {remotes.map((remote) => (
            <li key={remote.origin}>
              <div className="comfy-remote-list__main">
                <span className="mono">{remote.origin}</span>
                <span className="muted">{remote.hasToken ? t("comfy.remoteHasToken") : t("comfy.remoteNoToken")}</span>
                {remote.insecure ? <span className="status-warn">{t("comfy.remoteInsecure")}</span> : null}
              </div>
              <button type="button" onClick={() => void remove(remote.origin)} disabled={busy} aria-label={t("comfy.remoteRemoveAria", { origin: remote.origin })}>
                {t("comfy.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="comfy-field">
        <label htmlFor="comfy-remote-origin">{t("comfy.remoteOrigin")}</label>
        <input id="comfy-remote-origin" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://comfy.example.com" spellCheck={false} autoComplete="off" />
      </div>
      <div className="comfy-field">
        <label htmlFor="comfy-remote-token">{t("comfy.remoteToken")}</label>
        <input id="comfy-remote-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" aria-describedby="comfy-remote-token-hint" />
        <div className="muted" id="comfy-remote-token-hint">{t("comfy.remoteTokenHint")}</div>
      </div>
      <button type="button" onClick={() => void add()} disabled={busy || !origin.trim()}>{t("comfy.remoteAdd")}</button>
      {notice ? <div className="status-warn" role="status">{notice}</div> : null}
      {error ? <div className="status-err" role="alert">{error}</div> : null}
    </details>
  );
}

