import { useEffect, useRef } from "react";
import type { ResultSettings } from "@ima2/studio-kit";

/**
 * The prompt being written on Image and Video survives a reload or a trip to another screen
 * (session storage, this tab only), and the chosen model stays in the address so a reload or a
 * shared link opens the same model.
 */
type Kind = "image" | "video";
const key = (kind: Kind) => "ima2-studio-draft-" + kind;

export function readDraft(kind: Kind): string {
  try {
    return sessionStorage.getItem(key(kind)) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(kind: Kind, prompt: string): void {
  try {
    if (prompt) sessionStorage.setItem(key(kind), prompt);
    else sessionStorage.removeItem(key(kind));
  } catch {
    /* storage disabled */
  }
}

interface Restore {
  kind: Kind;
  prompt: string;
  model: string;
  settings?: ResultSettings | undefined;
  handled: boolean;
}

const pendingKey = (kind: Kind) => "ima2-studio-restore-" + kind;

/**
 * Puts a prompt and model, and the settings a result was made with, back into the open Image or Video form.
 * Returns false when that form is not on screen; the caller then opens it, and what is written here fills it
 * on arrival.
 */
export function restoreDraft(kind: Kind, prompt: string, model: string, settings?: ResultSettings): boolean {
  writeDraft(kind, prompt);
  const detail: Restore = { kind, prompt, model, settings, handled: false };
  window.dispatchEvent(new CustomEvent<Restore>("ima2-restore", { detail }));
  if (!detail.handled && settings) {
    try {
      sessionStorage.setItem(pendingKey(kind), JSON.stringify({ prompt, model, settings }));
    } catch {
      /* storage disabled: the form opens with the prompt and model only */
    }
  }
  return detail.handled;
}

function takePending(kind: Kind): { prompt: string; model: string; settings: ResultSettings } | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(kind));
    if (!raw) return null;
    sessionStorage.removeItem(pendingKey(kind));
    return JSON.parse(raw) as { prompt: string; model: string; settings: ResultSettings };
  } catch {
    return null;
  }
}

/** ready: the form can take a model now (its catalog has loaded). What was waiting for this form is applied then. */
export function useRestore(kind: Kind, apply: (prompt: string, model: string, settings?: ResultSettings) => void, ready = true): void {
  const ref = useRef(apply);
  ref.current = apply;
  useEffect(() => {
    if (!ready) return;
    const waiting = takePending(kind);
    if (waiting) ref.current(waiting.prompt, waiting.model, waiting.settings);
    const on = (event: Event) => {
      const detail = (event as CustomEvent<Restore>).detail;
      if (detail.kind !== kind) return;
      detail.handled = true;
      ref.current(detail.prompt, detail.model, detail.settings);
    };
    window.addEventListener("ima2-restore", on);
    return () => window.removeEventListener("ima2-restore", on);
  }, [kind, ready]);
}

/** Keep #/<kind>?model=... in the address without a navigation (no hashchange, no reload). */
export function syncModelToUrl(kind: Kind, model: string | undefined): void {
  if (!model || typeof history === "undefined") return;
  const [path = "", query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  if (path.split("/")[0] !== kind) return;
  const params = new URLSearchParams(query);
  if (params.get("model") === model) return;
  params.set("model", model);
  params.delete("preset");
  history.replaceState(history.state, "", "#/" + path + "?" + params.toString());
}
