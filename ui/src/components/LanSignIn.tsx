import { useEffect, useState, type FormEvent } from "react";
import en from "../i18n/en.json";
import ko from "../i18n/ko.json";
import zhHans from "../i18n/zh-Hans.json";
import zhHant from "../i18n/zh-Hant.json";
import { loadLocale } from "../i18n/locale";
import { createLanSession, endLanSession, getLanSessionState } from "../lib/lanSession";
import { BrandMark } from "./BrandMark";
import "../styles/lan-sign-in.css";

const dictionaries = { en, ko, "zh-Hans": zhHans, "zh-Hant": zhHant };
type Copy = typeof en.lan;

function errorMessage(error: unknown, copy: Copy): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "LAN_TOKEN_REQUIRED") return copy.sessionExpired;
  if (code === "LAN_RATE_LIMITED") return copy.rateLimited;
  if (code === "LAN_SESSION_CAPACITY") return copy.capacity;
  if (code === "LOCAL_HOST_REJECTED" || code === "LOCAL_ORIGIN_REJECTED") return copy.originRejected;
  if (code === "LAN_COOKIE_REQUIRED") return copy.cookieRequired;
  if (code === "LAN_TOKEN_DUPLICATE") return copy.duplicateToken;
  return copy.unavailable;
}

export function LanConnecting() {
  const copy = dictionaries[loadLocale()].lan;
  return <main className="lan-sign-in" aria-busy="true"><p role="status">{copy.connecting}</p></main>;
}

export function LanSignIn({ error: initialError, onConnected, onRetry }: {
  error?: unknown;
  onConnected(): Promise<void>;
  onRetry(): Promise<void>;
}) {
  const copy = dictionaries[loadLocale()].lan;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(initialError);
  const [retryUntil, setRetryUntil] = useState(0);
  const cooling = retryUntil > Date.now();
  useEffect(() => {
    if (!retryUntil) return;
    const timer = setTimeout(() => setRetryUntil(0), Math.max(0, retryUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [retryUntil]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy || cooling) return;
    let submitted = token;
    setToken(""); setBusy(true); setError(undefined);
    try { await createLanSession(submitted); await onConnected(); }
    catch (next) {
      setError(next);
      const seconds = (next as { retryAfter?: number } | null)?.retryAfter;
      if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) setRetryUntil(Date.now() + seconds * 1000);
    } finally { submitted = ""; setBusy(false); }
  };
  const retry = async () => {
    setBusy(true); setError(undefined);
    try { await onRetry(); } catch (next) { setError(next); }
    finally { setBusy(false); }
  };

  return (
    <main className="lan-sign-in" aria-labelledby="lan-sign-in-title">
      <form className="lan-sign-in__panel" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <p className="lan-sign-in__brand"><BrandMark className="lan-sign-in__mark" />{copy.brand}</p>
        <h1 id="lan-sign-in-title">{copy.title}</h1>
        <p id="lan-sign-in-help">{copy.body}</p>
        <label htmlFor="lan-token">{copy.token}</label>
        <input id="lan-token" name="lan-token" type="password" value={token}
          onChange={(event) => setToken(event.target.value)} autoComplete="off" autoFocus
          maxLength={4096} spellCheck={false} autoCapitalize="none" disabled={busy}
          aria-describedby={error ? "lan-sign-in-help lan-sign-in-error" : "lan-sign-in-help"} />
        {error ? <p id="lan-sign-in-error" className="lan-sign-in__error" role="alert">{errorMessage(error, copy)}</p> : null}
        <button className="lan-sign-in__submit" type="submit" disabled={!token || busy || cooling}>
          {busy ? copy.connecting : copy.connect}
        </button>
        <button className="lan-sign-in__retry" type="button" disabled={busy || cooling} onClick={() => void retry()}>{copy.retry}</button>
      </form>
    </main>
  );
}

export function LanSessionControls() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const copy = dictionaries[loadLocale()].lan;
  if (getLanSessionState()?.mode !== "lan") return null;
  const signOut = async () => {
    setBusy(true); setError(undefined);
    try { await endLanSession(); } catch (next) { setError(next); }
    finally { setBusy(false); }
  };
  return <article className="settings-row">
    <div className="settings-row__copy">
      <h4>{copy.sessionTitle}</h4><p>{copy.signOutBody}</p>
      {error ? <p role="alert">{errorMessage(error, copy)}</p> : null}
    </div>
    <div className="settings-row__control">
      <button type="button" className="settings-action-btn" disabled={busy} onClick={() => void signOut()}>
        {busy ? copy.signingOut : copy.signOut}
      </button>
    </div>
  </article>;
}
