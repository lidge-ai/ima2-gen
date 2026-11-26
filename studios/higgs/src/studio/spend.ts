import { formatUsd, type WebSpend } from "@ima2/studio-kit";
import { messages, tr } from "../i18n.ts";

const M = messages(
  {
    unpriced: "This shared server runs only priced steps. No published price: {steps}.",
    overRequest: "This run is estimated at {usd}, above this server's {cap} limit per run. Lower the length, resolution or quality.",
    overDaily: "Today's shared budget has {left} left and this run needs {usd}. It resets at midnight.",
  },
  {
    unpriced: "이 공유 서버는 가격이 공개된 단계만 실행해요. 공개 가격이 없는 단계: {steps}.",
    overRequest: "이 서버는 한 번에 {cap}까지만 실행해요. 이 실행의 예상 비용: {usd}. 길이, 해상도나 품질을 낮춰 주세요.",
    overDaily: "오늘 남은 공유 예산: {left}. 이 실행의 예상 비용: {usd}. 예산은 자정에 다시 채워져요.",
  },
);

const usd = (value: number) => formatUsd({ usd: value, basis: "exact" });

/**
 * Why a shared web instance would refuse this run, worded before the person presses Generate;
 * null on a local server or when the estimate fits. Mirrors lib/webAccess/spendGuard.ts admit().
 */
export function spendBlock(spend: WebSpend | null, steps: readonly { label: string; usd: number | null }[], total: number | null): string | null {
  if (!spend) return null;
  const unpriced = steps.filter((s) => s.usd === null).map((s) => s.label);
  if (unpriced.length || total === null) return tr(M, "unpriced", { steps: unpriced.join(", ") || "-" });
  if (total > spend.requestCapUsd) return tr(M, "overRequest", { usd: usd(total), cap: usd(spend.requestCapUsd) });
  if (spend.spentUsd + total > spend.dailyCapUsd) return tr(M, "overDaily", { left: usd(Math.max(0, spend.dailyCapUsd - spend.spentUsd)), usd: usd(total) });
  return null;
}
