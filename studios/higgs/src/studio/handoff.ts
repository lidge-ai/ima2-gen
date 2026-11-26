/**
 * Moves a result from one screen into another screen's input slot ("Animate",
 * "Remix"). Session storage keeps it across the hash navigation only.
 */
export interface HandOff {
  url: string;
  mimeType: string;
  name: string;
  target: "video" | "remix" | "image";
}

const KEY = "ima2-studio-handoff";

export function handOff(value: HandOff): void {
  sessionStorage.setItem(KEY, JSON.stringify(value));
}

export function takeHandOff(target: HandOff["target"]): HandOff | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as HandOff;
  if (value.target !== target) return null;
  sessionStorage.removeItem(KEY);
  return value;
}

/** Fetches the same-origin file and returns it as a File ready for upload. */
export async function handOffFile(value: HandOff): Promise<File> {
  const response = await fetch(value.url);
  if (!response.ok) throw new Error("Could not load " + value.name);
  return new File([await response.blob()], value.name, { type: value.mimeType });
}
