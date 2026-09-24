import { useEffect, useState } from "react";
import { getOAuthStatus } from "../lib/api";
import type { OAuthStatus } from "../types";

/** Fired by the Switch Account card when a login completes, so status updates without a reload. */
export const OAUTH_CHANGED_EVENT = "ima2:oauth-changed";

const STARTING_POLL_MS = 3000;
const NOT_READY_POLL_MS = 15000;

export function useOAuthStatus(): OAuthStatus | null {
  const [status, setStatus] = useState<OAuthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        const data = await getOAuthStatus();
        if (cancelled) return;
        setStatus(data);
        // A login from the CLI or another tab also has to show up here, so a not-ready
        // proxy keeps being checked, just slower than a starting one.
        if (data.status === "starting") timer = setTimeout(poll, STARTING_POLL_MS);
        else if (data.status !== "ready") timer = setTimeout(poll, NOT_READY_POLL_MS);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };

    const onChanged = () => { void poll(); };
    window.addEventListener(OAUTH_CHANGED_EVENT, onChanged);
    void poll();
    return () => {
      cancelled = true;
      window.removeEventListener(OAUTH_CHANGED_EVENT, onChanged);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return status;
}
