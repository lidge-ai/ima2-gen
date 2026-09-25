import { fetchApi } from "../lib/api-core";
import { useEffect, useState } from "react";
import { getLanAuthEpoch, isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT } from "../lib/lanSession";
import { OAUTH_CHANGED_EVENT } from "./useOAuthStatus";

export interface GrokStatus {
  status: "ready" | "no_image_model" | "error" | "offline";
  models?: string[];
  reason?: string;
}

export function useGrokStatus(): GrokStatus | null {
  const [status, setStatus] = useState<GrokStatus | null>(null);

  useEffect(() => {
    if (isLanSessionLocked()) return;
    const epoch = getLanAuthEpoch();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      if (cancelled || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
      try {
        const res = await fetchApi("/api/grok/status");
        if (cancelled) return;
        const data: GrokStatus = await res.json();
        if (cancelled || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
        setStatus(data);
        if (data.status !== "ready") {
          timer = setTimeout(poll, 10_000);
        }
      } catch {
        if (cancelled) return;
        setStatus({ status: "offline" });
        // One dropped request is not a verdict: keep polling like any other non-ready
        // status so the chip recovers when the server does.
        timer = setTimeout(poll, 10_000);
      }
    };

    const onChanged = () => { void poll(); };
    const stop = () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
      window.removeEventListener(OAUTH_CHANGED_EVENT, onChanged);
    };
    window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    window.addEventListener(OAUTH_CHANGED_EVENT, onChanged);
    void poll();
    return stop;
  }, []);

  return status;
}
