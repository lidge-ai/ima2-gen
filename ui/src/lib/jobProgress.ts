/** A job's own progress report as a whole percentage, or null when it gave none that makes sense. */
export function jobProgressPercent(progress: unknown): number | null {
  return typeof progress === "number" && progress >= 0 && progress <= 1 ? Math.round(progress * 100) : null;
}
