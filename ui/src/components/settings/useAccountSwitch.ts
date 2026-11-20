import { useCallback, useEffect, useRef, useState } from "react";
import { fetchApi } from "../../lib/api-core";
import { useI18n } from "../../i18n";
import { getLanAuthEpoch, isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT } from "../../lib/lanSession";
import { OAUTH_CHANGED_EVENT } from "../../hooks/useOAuthStatus";
import type { SwitchState } from "./quotaTypes";

/**
 * The ChatGPT browser login calls back to localhost:1455 on the server machine, so it only
 * works when this browser runs there. Anywhere else (LAN), the device code is the only path.
 */
function defaultCodexFlow(): "browser" | "device" {
  const host = window.location.hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" ? "browser" : "device";
}

function useSwitchPolling(state: SwitchState, setState: React.Dispatch<React.SetStateAction<SwitchState>>, onComplete: () => void) {
  useEffect(() => {
    if (state.phase !== "waiting" || !state.sessionId || isLanSessionLocked()) return;
    const epoch = getLanAuthEpoch();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const stop = () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    };
    const poll = async () => {
      if (cancelled || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
      try {
        const res = await fetchApi(`/api/auth/switch/${state.sessionId}`);
        const data = await res.json() as { status: string; error?: string };
        if (cancelled || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
        if (data.status === "complete") {
          setState({ phase: "complete" });
          window.dispatchEvent(new Event(OAUTH_CHANGED_EVENT));
          return;
        }
        if (data.status === "error" || data.status === "expired") {
          setState({ phase: "error", error: data.error || data.status });
          return;
        }
      } catch { /* retry */ }
      if (!cancelled && !isLanSessionLocked() && epoch === getLanAuthEpoch()) timer = setTimeout(poll, 3000);
    };
    window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    timer = setTimeout(poll, 3000);
    return stop;
  }, [state.phase, state.sessionId, onComplete]);

}

function useSwitchCompletion(state: SwitchState, onComplete: () => void) {
  useEffect(() => {
    if (state.phase !== "complete" || isLanSessionLocked()) return;
    const timer = setTimeout(() => { stop(); onComplete(); }, 1000);
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    };
    window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    return stop;
  }, [state.phase, onComplete]);

}

export function useAccountSwitch(provider: "grok" | "codex", onComplete: () => void) {
  const { t } = useI18n();
  const [state, setState] = useState<SwitchState>({ phase: "idle" });
  const switching = useRef(false);

  const startSwitch = useCallback(async (flowOverride?: "browser" | "device") => {
    if (switching.current || isLanSessionLocked()) return;
    const flow = provider === "codex" ? (flowOverride ?? defaultCodexFlow()) : "device";
    const epoch = getLanAuthEpoch();
    switching.current = true;
    setState({ phase: "starting" });
    try {
      const res = await fetchApi("/api/auth/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, flow }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: t("settings.quota.switchFailed") })) as { error?: string };
        setState({ phase: "error", error: err.error || `HTTP ${res.status}` });
        return;
      }
      const data = await res.json() as { sessionId: string; userCode: string; verificationUrl: string; flow?: "browser" | "device" };
      if (isLanSessionLocked() || epoch !== getLanAuthEpoch()) {
        // The login died with the LAN session; don't leave the card stuck on "starting".
        switching.current = false;
        setState({ phase: "idle" });
        return;
      }
      setState({ phase: "waiting", ...data, flow: data.flow ?? flow });
      window.open(data.verificationUrl, "_blank");
    } catch (e) {
      switching.current = false;
      if ((e as { code?: string } | null)?.code === "LAN_TOKEN_REQUIRED") return;
      setState({ phase: "error", error: (e as Error).message });
    }
  }, [provider]);

  useSwitchPolling(state, setState, onComplete);
  useSwitchCompletion(state, onComplete);
  return { state, setState, switching, startSwitch };
}
