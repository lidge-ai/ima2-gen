import { useEffect, useState } from "react";
import { StudioApiError, estimateCost, type Catalog, type CatalogModel, type CatalogRoute, type LocalRunEstimate } from "@ima2/studio-kit";
import { messages, tr } from "../../i18n.ts";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { spendBlock } from "../../studio/spend.ts";
import { estimateLabel } from "../../ui/format.ts";
import { defaultsFor, problem, routeFor, toBody, type CreateForm } from "./form.ts";

const M = messages(
  {
    "free": "No charge",
    "freeTime": "No charge · about {time}",
    "mayBill": "A paid node may charge",
    "mayBillTitle": "Runs on this computer, but this workflow has paid ComfyUI nodes. ima2 cannot price them.",
    "sec": "{n} s",
    "min": "{n} min",
  },
  {
    "free": "요금 없음",
    "freeTime": "요금 없음 · 약 {time}",
    "mayBill": "유료 노드 요금 발생 가능",
    "mayBillTitle": "이 컴퓨터에서 실행하지만 워크플로에 유료 ComfyUI 노드가 있어요. ima2가 그 가격은 알 수 없어요.",
    "sec": "{n}초",
    "min": "{n}분",
  },
);

/** Shown on Generate in place of a price; plain means no "Estimated" prefix. */
export interface CostText {
  text: string;
  title: string;
  plain?: boolean;
}

function localCost(estimate: LocalRunEstimate | null): CostText {
  if (estimate?.mayBill) return { text: tr(M, "mayBill"), title: tr(M, "mayBillTitle"), plain: true };
  const sec = estimate?.expectedSec;
  if (!sec) return { text: tr(M, "free"), title: estimate?.basis ?? "", plain: true };
  const time = sec < 90 ? tr(M, "sec", { n: Math.round(sec) }) : tr(M, "min", { n: Math.round(sec / 60) });
  return { text: tr(M, "freeTime", { time }), title: estimate.basis, plain: true };
}

/**
 * A local route (a ComfyUI workflow) has no published price. The server answers with the time
 * earlier runs took, and whether a paid node in the graph may still charge.
 */
function useLocalEstimate(model: CatalogModel | undefined, route: CatalogRoute | undefined, form: CreateForm) {
  const studio = useStudioApi();
  const [estimate, setEstimate] = useState<LocalRunEstimate | null>(null);
  const local = route?.route === "local" && model ? model : undefined;
  const key = local ? local.id + "|" + route!.providerId : "";
  useEffect(() => {
    setEstimate(null);
    if (!local || !route) return;
    let live = true;
    studio.client.media
      .estimate(toBody(local, form, route.providerId))
      .then((answer) => {
        if (live) setEstimate(answer.local ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Run time depends on the workflow, not on each keystroke in the prompt: keyed on model and route only.
  }, [key]);
  return local ? localCost(estimate) : null;
}

/** Shared submit logic for the panel and the dock: route choice, cost, blocking problem, send. */
export function useCreate(catalog: Catalog, form: CreateForm, set: (patch: Partial<CreateForm>) => void) {
  const studio = useStudioApi();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = catalog.models.find((m) => m.id === form.model);
  const choice = routeFor(model, form);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const priced = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const webSpend = useStudio((s) => s.webSpend);
  const quote = route && webSpend ? estimateCost(route.pricing, form) : null;
  // A shared web instance refuses an unpriced or over-limit job; name the reason before sending.
  const blocked =
    problem(model, form) ?? (quote && model ? spendBlock(webSpend, [{ label: model.label, usd: quote.usd }], quote.usd) : null);
  const localCostText = useLocalEstimate(model, route, form);
  const cost: CostText = localCostText ?? estimateLabel(priced, form);
  const pickModel = (id: string) => {
    const next = catalog.models.find((m) => m.id === id);
    set({ model: id, provider: "", ...defaultsFor(next, form) });
  };
  const submit = async () => {
    if (!model || blocked || !route) return;
    setSending(true);
    setError(null);
    try {
      await studio.submit(toBody(model, form, form.provider || undefined));
    } catch (err) {
      setError(err instanceof StudioApiError ? err.message + " (" + err.code + ")" : String(err));
    } finally {
      setSending(false);
    }
  };
  return {
    model,
    choice,
    route,
    blocked,
    cost,
    sending,
    error,
    pickModel,
    submit,
    canSend: !!model && !blocked && !!route && !sending,
  };
}
