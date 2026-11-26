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
