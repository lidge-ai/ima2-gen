import { useEffect, useState } from "react";
import { formatUsd, type MediaEstimateResult, type MediaPrice, type MediaSubmitBody } from "@ima2/studio-kit";
import { messages, tr } from "../i18n.ts";
import { useStudioApi } from "../studio/context.tsx";

const M = messages(
  {
    "estimate": "Estimated {cost}",
    "from": "From {cost}",
    "range": "{min} to {max}",
    "usage": "Billed per {unit}",
    "unpriced": "Price not published",
    "unknown": "No price for these settings",
    "pending": "Working it out…",
    "failed": "Price unavailable",
    "free": "No charge",
    "freeTime": "No charge · about {time}",
    "mayBill": "A paid node may charge",
    "mayBillTitle": "Runs on this computer, but this workflow has paid ComfyUI nodes. ima2 cannot price them.",
    "sec": "{n} s",
    "min": "{n} min",
    "u_second": "second", "u_minute": "minute", "u_character": "character", "u_image": "image", "u_request": "request", "u_megapixel": "megapixel", "u_1k-tokens": "1K tokens",
    "rangeTitle": "Several published prices still apply; the charge depends on a setting this screen does not choose.",
  },
  {
    "estimate": "예상 {cost}",
    "from": "{cost}부터",
    "range": "{min}~{max}",
    "usage": "{unit}당 과금",
    "unpriced": "공개 가격 없음",
    "unknown": "이 설정의 가격 없음",
    "pending": "계산 중…",
    "failed": "가격을 불러오지 못했어요",
    "free": "요금 없음",
    "freeTime": "요금 없음 · 약 {time}",
    "mayBill": "유료 노드 요금 발생 가능",
    "mayBillTitle": "이 컴퓨터에서 실행하지만 워크플로에 유료 ComfyUI 노드가 있어요. ima2가 그 가격은 알 수 없어요.",
    "sec": "{n}초",
    "min": "{n}분",
    "u_second": "초", "u_minute": "분", "u_character": "글자", "u_image": "장", "u_request": "요청", "u_megapixel": "메가픽셀", "u_1k-tokens": "1천 토큰",
    "rangeTitle": "공개 가격이 여러 개 해당돼요. 이 화면에서 고르지 않는 설정에 따라 요금이 달라져요.",
  },
);

/**
 * What Generate says about cost. The figure is always the server's (POST /api/media/estimate, the rule in
 * lib/providers/media/priceQuote.ts), so this screen never shows a price the server would not.
 * kind tells a form whether there is a figure or why not; usd is what a shared server's spend limit compares.
 */
export interface CostText {
  text: string;
  title: string;
  kind: "figure" | "local" | "usage" | "unpriced" | "unknown" | "pending" | "failed";
  usd: number | null;
}

export interface QuoteState {
  pending: boolean;
  failed: boolean;
  result: MediaEstimateResult | null;
}

/**
 * Asks the server for the estimate of the request a form would send, a moment after its settings stop
 * changing. The prompt and request id are not sent. A form priced by its text (speech) asks again when the
 * text's length changes; other forms do not ask again while the prompt is typed.
 */
export function useServerQuote(body: MediaSubmitBody | null, options: { pricedByText?: boolean } = {}): QuoteState {
  const studio = useStudioApi();
  // Pending from the first render, so nothing (a spend limit, a figure) reads an empty answer as "no price".
  const [state, setState] = useState<QuoteState>(() => ({ pending: body !== null, failed: false, result: null }));
  const key = body
    ? JSON.stringify({
        ...body, prompt: undefined, negativePrompt: undefined, clientRequestId: undefined, inputs: body.inputs.map((i) => i.role),
        characters: options.pricedByText ? (body.prompt?.length ?? 0) : undefined,
      })
    : "";
  useEffect(() => {
    if (!body) {
      setState({ pending: false, failed: false, result: null });
      return;
    }
    setState((s) => ({ ...s, pending: true, failed: false }));
    let live = true;
    const timer = setTimeout(() => {
      studio.client.media.estimate(body).then(
        (result) => live && setState({ pending: false, failed: false, result }),
        () => live && setState({ pending: false, failed: true, result: null }),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Keyed on the settings that can change a price, not on the object identity.
  }, [key]);
  return state;
}

const UNITS = ["second", "minute", "character", "image", "request", "megapixel", "1k-tokens"] as const;

function unitLabel(unit: string): string {
  return (UNITS as readonly string[]).includes(unit) ? tr(M, ("u_" + unit) as `u_${(typeof UNITS)[number]}`) : unit;
}

const money = (usd: number) => formatUsd({ usd, basis: "" });

function localText(result: MediaEstimateResult): CostText {
  const local = result.local;
  if (local?.mayBill) return { text: tr(M, "mayBill"), title: tr(M, "mayBillTitle"), kind: "local", usd: null };
  const sec = local?.expectedSec;
  if (!sec) return { text: tr(M, "free"), title: local?.basis ?? "", kind: "local", usd: 0 };
  const time = sec < 90 ? tr(M, "sec", { n: Math.round(sec) }) : tr(M, "min", { n: Math.round(sec / 60) });
  return { text: tr(M, "freeTime", { time }), title: local?.basis ?? "", kind: "local", usd: 0 };
}

export function quoteText(state: QuoteState): CostText {
  if (state.pending) return { text: tr(M, "pending"), title: "", kind: "pending", usd: null };
  if (state.failed) return { text: tr(M, "failed"), title: "", kind: "failed", usd: null };
  const result = state.result;
  if (!result) return { text: "-", title: "", kind: "unknown", usd: null };
  const quote = result.quote;
  const basis = (q: { quantity: number; unit: string; price?: MediaPrice }) =>
    q.quantity + " " + unitLabel(q.unit) + (q.price ? " × " + money(q.price.usd) + (q.price.variant ? " (" + q.price.variant + ")" : "") : "");
  switch (quote.state) {
    case "exact":
      return { text: tr(M, "estimate", { cost: money(quote.usd) }), title: basis(quote), kind: "figure", usd: quote.usd };
    case "from":
      return { text: tr(M, "from", { cost: money(quote.usd) }), title: basis(quote), kind: "figure", usd: quote.usd };
    case "range":
      return { text: tr(M, "range", { min: money(quote.min), max: money(quote.max) }), title: tr(M, "rangeTitle"), kind: "figure", usd: quote.max };
    case "usage":
      // The server has no amount to count yet (no length, no text): say what the price is counted in.
      return { text: tr(M, "usage", { unit: unitLabel(quote.unit) }), title: result.note ?? "", kind: "usage", usd: null };
    case "local":
      return localText(result);
    case "unpriced":
      return { text: tr(M, "unpriced"), title: result.note ?? "", kind: "unpriced", usd: null };
    default:
      return { text: tr(M, "unknown"), title: result.note ?? "", kind: "unknown", usd: null };
  }
}
