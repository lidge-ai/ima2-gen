/**
 * Providers spell the same size differently: "1K" and "1k", "480P" and "480p", "1080p-SR" and "1080p-sr".
 * A provider is always sent its own spelling. These helpers give the one readable label per size that
 * the catalog shows, and find a route's own spelling for whatever spelling a request used.
 *
 * No imports, so the UI's test fixtures can load this file as it is.
 */
const SIZE = /^(\d+(?:\.\d+)?)\s*([pk])(.*)$/i;

/** "1k" → "1K", "480P" → "480p", "1080p-SR" → "1080p-sr". A value that is not a size ("auto", "1024x1536") is returned as written. */
export function resolutionLabel(value: string): string {
  const text = value.trim();
  const size = SIZE.exec(text);
  if (!size) return text;
  return size[1]! + (size[2]!.toLowerCase() === "k" ? "K" : "p") + size[3]!.toLowerCase();
}

/** The same option in another spelling. */
export function sameResolution(a: string, b: string): boolean {
  return resolutionLabel(a).toLowerCase() === resolutionLabel(b).toLowerCase();
}

/** The route's own spelling of a requested resolution, or undefined when the route does not list it. */
export function specResolution(allowed: readonly string[] | undefined, value: string): string | undefined {
  return allowed?.find((candidate) => candidate === value) ?? allowed?.find((candidate) => sameResolution(candidate, value));
}

export interface ResolutionOption {
  /** What the provider is sent. */
  value: string;
  /** What a person reads. */
  label: string;
}

/** Each listed size once, in the route's order; when a route lists two spellings of one size the first is the one sent. */
export function resolutionOptions(values: readonly string[]): ResolutionOption[] {
  const options: ResolutionOption[] = [];
  for (const value of values) {
    if (!options.some((option) => sameResolution(option.value, value))) options.push({ value, label: resolutionLabel(value) });
  }
  return options;
}
