import type { MediaRoute } from "./mediaCatalog";
import { formProblem, type FormProblem, type FormValues } from "./mediaForm";
import type { ResolvedRoute } from "./mediaRoutes";
import { inputProblem, type InputProblem } from "./mediaTasks";

/** Why Generate cannot run the selected media model yet. The key comes first: nothing else matters until one exists. */
export type GenerateBlocker = { code: "key"; route: MediaRoute } | { code: "input"; problem: InputProblem } | { code: "form"; problem: FormProblem };

export function generateBlocker(resolved: ResolvedRoute | undefined, task: string, referenceCount: number, values?: Omit<FormValues, "task">): GenerateBlocker | null {
  if (!resolved) return null;
  if (resolved.state === "needs-key") return { code: "key", route: resolved.route };
  const problem = inputProblem(task, resolved.route, referenceCount);
  if (problem) return { code: "input", problem };
  const form = values ? formProblem(resolved.route, { ...values, task }) : null;
  return form ? { code: "form", problem: form } : null;
}
