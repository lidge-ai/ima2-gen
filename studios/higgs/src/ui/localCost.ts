import { useEffect, useState } from "react";
import type { CatalogModel, CatalogRoute, LocalRunEstimate, MediaSubmitBody } from "@ima2/studio-kit";
import { messages, tr } from "../i18n.ts";
import { useStudioApi } from "../studio/context.tsx";

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
 * A local route (a ComfyUI workflow on this computer) has no published price. Every form asks the
 * server instead: no charge and the time earlier runs took, or that a paid node may still charge.
 * Null when the route is not local, so the form shows its usual price.
 */
export function useLocalCost(model: CatalogModel | undefined, route: CatalogRoute | undefined, body: () => MediaSubmitBody | null): CostText | null {
  const studio = useStudioApi();
  const [estimate, setEstimate] = useState<LocalRunEstimate | null>(null);
  const local = route?.route === "local" && model ? model : undefined;
  // Run time depends on the workflow, not on each keystroke: keyed on model and route only.
  const key = local && route ? local.id + "|" + route.providerId : "";
  useEffect(() => {
    setEstimate(null);
    const request = key ? body() : null;
    if (!request) return;
    let live = true;
    studio.client.media
      .estimate(request)
      .then((answer) => {
        if (live) setEstimate(answer.local ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key]);
  return local ? localCost(estimate) : null;
}
