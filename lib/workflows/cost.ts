import type { MediaModelSpec } from "../providers/media/contract.js";
import type { CostUnits, PlanEnv, StepEstimate, WorkflowEstimate, WorkflowPlan } from "./types.js";

/**
 * Finds the published price for these units: the exact variant, then (for "<res>+audio" when the
 * model publishes no separate audio prices) the plain "<res>" price, then an all-variant price.
 * Never guesses.
 */
export function priceFor(spec: MediaModelSpec | undefined, units: CostUnits): Omit<StepEstimate, "stepId" | "model" | "units"> {
  if (!spec) return { usd: null, note: "model is not in the catalog" };
  const sameUnit = spec.pricing.filter((p) => p.unit === units.unit);
  const audioPriced = sameUnit.some((p) => p.variant?.includes("+audio"));
  const base = units.variant?.endsWith("+audio") && !audioPriced ? units.variant.slice(0, -"+audio".length) : undefined;
  const match = sameUnit.find((p) => units.variant !== undefined && p.variant === units.variant)
    ?? sameUnit.find((p) => base !== undefined && p.variant === base)
    ?? sameUnit.find((p) => p.variant === undefined);
  if (!match) return { usd: null, note: "no public price for " + units.unit + (units.variant ? " " + units.variant : "") };
  return { usd: round(match.usd * units.quantity), source: match.source, checkedAt: match.checkedAt };
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

export function estimatePlan(plan: WorkflowPlan, env: PlanEnv): WorkflowEstimate {
  const steps: StepEstimate[] = plan.steps.map((step) => {
    if (step.kind === "local") return { stepId: step.id, usd: 0, note: "runs locally" };
    if (step.kind === "text") return { stepId: step.id, usd: 0, note: "uses the configured text planner; not priced" };
    const price = priceFor(env.catalog(step.model), step.units);
    return { stepId: step.id, model: step.model, units: step.units, ...price };
  });
  const usd = round(steps.reduce((sum, s) => sum + (s.usd ?? 0), 0));
  return { usd, complete: steps.every((s) => s.usd !== null), steps };
}

