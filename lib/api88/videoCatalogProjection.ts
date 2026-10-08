import type { RuntimeContext } from "../runtimeContext.js";
import { API88_VIDEO_SPECS } from "./videoSpecs.js";
export function api88VideoModelsForContext(ctx: Pick<RuntimeContext, "api88VideoKey">, live: ReadonlySet<string> | null) {
  const key = ctx.api88VideoKey?.trim();
  return Object.keys(API88_VIDEO_SPECS).filter((id) => live === null || live.has(id)).map((id) => ({
    id, label: id, executable: Boolean(key),
    ...(!key ? { lockReason: "API88_VIDEO_KEY_MISSING" } : {}),
  }));
}
