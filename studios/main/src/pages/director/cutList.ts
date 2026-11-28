import type { CatalogModel } from "@ima2/studio-kit";

/** One row of the cut list on screen; id keeps a row's fields with it while rows move. */
export interface Cut {
  id: number;
  prompt: string;
  durationSec: number;
}

/** Shortest shot of a model that lists no lengths (lib/workflows/definitions/directorShots.ts MIN_SHOT_SEC). */
export const MIN_SHOT_SEC = 4;
const START_SEC = 5;

let serial = 0;
export const newCut = (durationSec = START_SEC): Cut => ({ id: ++serial, prompt: "", durationSec });

/** The lengths one shot can have with a model: its listed lengths in order, or null when it lists none. */
export function shotLengths(model: CatalogModel | undefined): readonly number[] | null {
  const listed = model?.params.durationsSec;
  return listed && listed.length > 0 ? [...listed].sort((a, b) => a - b) : null;
}

/** The nearest length the model makes at or above the one asked for, else its longest; the server rounds the same way. */
export function fitLength(seconds: number, listed: readonly number[] | null): number {
  if (!listed) return Math.max(MIN_SHOT_SEC, Math.round(seconds) || MIN_SHOT_SEC);
  return listed.find((d) => d >= seconds) ?? listed[listed.length - 1] ?? seconds;
}

export const totalSec = (cuts: readonly Cut[]): number => cuts.reduce((sum, cut) => sum + cut.durationSec, 0);

export function moved(cuts: readonly Cut[], index: number, by: -1 | 1): Cut[] {
  const next = [...cuts];
  const to = index + by;
  if (to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
