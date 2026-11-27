import { useEffect, useRef } from "react";

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
  handled: boolean;
}

/**
 * Puts a prompt and model back into the open Image or Video form. Returns false when that form is
 * not on screen; the caller then opens it, and the draft written here fills it on arrival.
 */
export function restoreDraft(kind: Kind, prompt: string, model: string): boolean {
  writeDraft(kind, prompt);
  const detail: Restore = { kind, prompt, model, handled: false };
  window.dispatchEvent(new CustomEvent<Restore>("ima2-restore", { detail }));
  return detail.handled;
}

export function useRestore(kind: Kind, apply: (prompt: string, model: string) => void): void {
  const ref = useRef(apply);
  ref.current = apply;
  useEffect(() => {
    const on = (event: Event) => {
      const detail = (event as CustomEvent<Restore>).detail;
      if (detail.kind !== kind) return;
      detail.handled = true;
      ref.current(detail.prompt, detail.model);
    };
    window.addEventListener("ima2-restore", on);
    return () => window.removeEventListener("ima2-restore", on);
  }, [kind]);
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
