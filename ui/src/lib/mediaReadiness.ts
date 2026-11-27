import type { MediaRoute } from "./mediaCatalog";
import type { ResolvedRoute } from "./mediaRoutes";
import { inputProblem, type InputProblem } from "./mediaTasks";

/** Why Generate cannot run the selected media model yet. The key comes first: nothing else matters until one exists. */
export type GenerateBlocker = { code: "key"; route: MediaRoute } | { code: "input"; problem: InputProblem };

export function generateBlocker(resolved: ResolvedRoute | undefined, task: string, referenceCount: number): GenerateBlocker | null {
  if (!resolved) return null;
  if (resolved.state === "needs-key") return { code: "key", route: resolved.route };
  const problem = inputProblem(task, resolved.route, referenceCount);
  return problem ? { code: "input", problem } : null;
}
