import type { MediaModelSpec } from "../providers/media/contract.js";
import type { CostUnits, PlanEnv, StepEstimate, WorkflowEstimate, WorkflowPlan, WorkflowStep } from "./types.js";

/**
 * Finds the published price for these units: the exact variant, a listed variant that starts with
 * it ("720p" matches "720p 16:9, no video input ..."), then (for "<res>+audio" when the model
 * publishes no separate audio prices) the plain "<res>" price, then an all-variant price. Units
 * without a variant on a model that only lists variants take the highest listed price of that unit,
 * marked approximate. A unit the model does not list is never guessed.
 */
export function priceFor(spec: MediaModelSpec | undefined, units: CostUnits): Omit<StepEstimate, "stepId" | "model" | "units"> {
  if (!spec) return { usd: null, note: "model is not in the catalog" };
  const sameUnit = spec.pricing.filter((p) => p.unit === units.unit);
  const audioPriced = sameUnit.some((p) => p.variant?.includes("+audio"));
  const base = units.variant?.endsWith("+audio") && !audioPriced ? units.variant.slice(0, -"+audio".length) : undefined;
  const named = (variant: string | undefined) => variant === undefined ? undefined
    : sameUnit.find((p) => p.variant === variant) ?? sameUnit.find((p) => p.variant?.startsWith(variant + " "));
  const match = named(units.variant) ?? named(base) ?? sameUnit.find((p) => p.variant === undefined);
  if (match) return { usd: round(match.usd * units.quantity), source: match.source, checkedAt: match.checkedAt };
  if (units.variant === undefined && sameUnit.length > 0) {
    const top = sameUnit.reduce((a, b) => (b.usd > a.usd ? b : a));
    return { usd: round(top.usd * units.quantity), source: top.source, checkedAt: top.checkedAt, approximate: true, note: "approximate: highest listed " + units.unit + " price (" + (top.variant ?? "all") + ")" };
  }
  return { usd: null, note: "no public price for " + units.unit + (units.variant ? " " + units.variant : "") };
}

function round(usd: number): number {
  return Math.round(usd * 10_000) / 10_000;
}

function stepEstimate(step: WorkflowStep, env: PlanEnv): StepEstimate {
  if (step.kind === "local") return { stepId: step.id, usd: 0, note: "runs locally" };
  if (step.kind === "text") return { stepId: step.id, usd: 0, note: "uses the configured text planner; not priced" };
  const subscription = step.route ? env.subscription?.(step.route) : undefined;
  if (subscription) return { stepId: step.id, model: step.model, units: step.units, usd: 0, note: "included in the " + subscription };
  const price = priceFor(env.catalog(step.model), step.units);
  const approximate = price.approximate === true || step.unitsApproximate !== undefined;
  const note = [step.unitsApproximate, price.note].filter(Boolean).join("; ");
  return { stepId: step.id, model: step.model, units: step.units, ...price, ...(approximate ? { approximate: true } : {}), ...(note ? { note } : {}) };
}

export function estimatePlan(plan: WorkflowPlan, env: PlanEnv): WorkflowEstimate {
  const steps = plan.steps.map((step) => stepEstimate(step, env));
  const usd = round(steps.reduce((sum, s) => sum + (s.usd ?? 0), 0));
  const approximate = steps.some((s) => s.approximate === true);
  return { usd, complete: steps.every((s) => s.usd !== null), ...(approximate ? { approximate: true } : {}), steps };
}

