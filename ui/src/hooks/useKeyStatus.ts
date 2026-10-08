import { fetchApi } from "../lib/api-core";
import { useEffect, useState, useCallback, useRef } from "react";
import { getLanAuthEpoch, isLanSessionLocked, LAN_AUTH_REQUIRED_EVENT } from "../lib/lanSession";

interface KeyStatusEntry {
  configured: boolean;
  source: string;
  valid: boolean;
  maskedKey: string | null;
}

export type KeyStatus = Record<"openai" | "xai" | "gemini" | "atlascloud" | "api88-image" | "api88-video" | "minimax" | "nai" | "vertex", KeyStatusEntry> & {
  geminiAuthMode?: "apikey" | "vertex";
};

export function useKeyStatus() {
  const [data, setData] = useState<KeyStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const active = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!active.current || isLanSessionLocked()) return;
    const epoch = getLanAuthEpoch();
    try {
      const res = await fetchApi("/api/keys/status");
      const json: KeyStatus = await res.json();
      if (!active.current || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
      setData(json);
      setError(null);
    } catch (e) {
      if (!active.current || isLanSessionLocked() || epoch !== getLanAuthEpoch()) return;
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, []);

  useEffect(() => {
    if (isLanSessionLocked()) return;
    active.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      await fetchStatus();
      if (!cancelled) {
        timer = setInterval(fetchStatus, 30_000);
      }
    };

    const stop = () => {
      active.current = false;
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    };
    window.addEventListener(LAN_AUTH_REQUIRED_EVENT, stop);
    void poll();
    return stop;
  }, [fetchStatus]);

  return { data, error, mutate: fetchStatus };
}
