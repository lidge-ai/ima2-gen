import { err } from "../output.js";
import type { Dict } from "./common.js";

export function createProgress(id: string): (event: string, data: Dict) => void {
  let last = "";
  return (event, data) => {
    let text = "";
    if (event === "submitted") text = `submitted via ${String(data.adapter ?? "unknown")}`;
    else if (event === "progress" || event === "queued" || event === "running") {
      const state = String(data.status ?? event);
      const n = typeof data.progress === "number" ? data.progress : undefined;
      text = `${state}${n === undefined ? "" : ` ${Math.round(n <= 1 ? n * 100 : n)}%`}`;
    } else if (event === "step") text = `step ${String(data.stepId)} ${String(data.status)}`;
    else if (event === "done" && typeof data.elapsed === "number") text = `done in ${data.elapsed}s`;
    if (text && text !== last) { last = text; err(`[${id}] ${text}`); }
  };
}
