/**
 * Moves a result from one screen into another screen's input slot ("Animate",
 * "Remix"). Session storage keeps it across the hash navigation; a screen that is already open
 * takes it at once through an event, since no navigation will remount it.
 */
export interface HandOff {
  url: string;
  mimeType: string;
  name: string;
  target: "video" | "video-edit" | "remix" | "image";
  /** Only this workflow's form takes it (a showcase example opens its own workflow). */
  workflow?: string;
  /** Field values to prefill on the target screen (prompt, target, style...). */
  values?: Record<string, string | number | boolean>;
  /** The result's path in the server's saved files: the target uses the file where it is instead of uploading it again. */
  path?: string;
}

const KEY = "ima2-studio-handoff";
const EVENT = "ima2-handoff";

interface Delivery {
  handled: boolean;
}

/** Stores the hand-off. True when the target screen is already open and took it. */
export function handOff(value: HandOff): boolean {
  sessionStorage.setItem(KEY, JSON.stringify(value));
  const detail: Delivery = { handled: false };
  window.dispatchEvent(new CustomEvent<Delivery>(EVENT, { detail }));
  return detail.handled;
}

export function takeHandOff(target: HandOff["target"], workflow?: string): HandOff | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as HandOff;
  if (value.target !== target) return null;
  if (value.workflow && workflow && value.workflow !== workflow) return null;
  sessionStorage.removeItem(KEY);
  return value;
}

/**
 * Runs take now (the screen just opened) and again whenever a hand-off is sent while the screen
 * stays open. take returns true when it took one. Returns the cleanup for an effect.
 */
export function watchHandOff(take: () => boolean): () => void {
  take();
  const on = (event: Event) => {
    if (take()) (event as CustomEvent<Delivery>).detail.handled = true;
  };
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}

/** Fetches the same-origin file and returns it as a File ready for upload. */
export async function handOffFile(value: HandOff): Promise<File> {
  const response = await fetch(value.url);
  if (!response.ok) throw new Error("Could not load " + value.name);
  return new File([await response.blob()], value.name, { type: value.mimeType });
}
