import type { Express } from "express";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";
import type { QuotaResult } from "../lib/quota/types.js";
import { readCodexSession, fetchCodexUsage } from "../lib/quota/codexUsage.js";
import { fetchGrokBilling } from "../lib/quota/grokBilling.js";
import { fetchNaiQuota } from "../lib/quota/naiQuota.js";

export type { QuotaWindow, QuotaResult } from "../lib/quota/types.js";
export { fetchGrokBilling, inspectGrokWeeklyEligibility, parseGrokCreditsResponse } from "../lib/quota/grokBilling.js";
export { fetchNaiQuota } from "../lib/quota/naiQuota.js";

export function registerQuotaRoutes(app: Express, ctx: RouteRuntimeContext) {
  app.get("/api/quota", async (_req, res) => {
    try {
      const read = await readCodexSession();
      const codexResult = typeof read === "object"
        ? fetchCodexUsage(read.session)
        : Promise.resolve<QuotaResult>({
          provider: "codex",
          ...(read === "error" ? { error: true } : { authenticated: false }),
          windows: [],
        });
      const [codex, grok, nai] = await Promise.all([
        codexResult,
        fetchGrokBilling(),
        fetchNaiQuota(ctx),
      ]);
      res.json({ codex, grok, nai });
    } catch {
      res.status(500).json({ error: "Failed to fetch quota" });
    }
  });
}
