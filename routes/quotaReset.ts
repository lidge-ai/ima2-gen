import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { Confirmations } from "../lib/reset/confirmations.js";
import { resetIdentity } from "../lib/reset/identity.js";
import { CodexResetClient } from "../lib/reset/codexResetClient.js";
import type { ResetTransport } from "../lib/reset/transport.js";
import { OperationLedger } from "../lib/reset/operationLedger.js";

// Deliberately naive failing-first baseline; production has no transport configured.
export interface ResetDependencies {
  db: Database.Database;
  transport: ResetTransport;
  accountId(): string;
  usage(): Promise<unknown>;
}
export function quotaResetRouter(ctx: RuntimeContext): Router {
  const router = Router();
  const deps = (ctx as RuntimeContext & { resetDependencies?: ResetDependencies }).resetDependencies;
  if (!deps) return router;
  const confirmations = new Confirmations();
  const client = new CodexResetClient(deps.transport);
  const ledger = new OperationLedger(deps.db);
  router.get("/api/quota/codex/reset-credits", async (_req, res) => { res.json(await client.list()); });
  router.post("/api/quota/reset-confirmations", (req, res) => {
    const identity = resetIdentity("codex", deps.accountId());
    const token = confirmations.issue({ provider: "codex", ledgerKey: identity.ledgerKey,
      operationId: String(req.body.operationId), principalId: String(res.locals.accessPrincipal.principalId) });
    res.json({ token });
  });
  router.post("/api/quota/codex/reset-credits/redeem", async (req: Request, res: Response) => {
    const confirmation = confirmations.take(String(req.body.token));
    if (!confirmation) { res.status(400).json({ error: "INVALID_CONFIRMATION" }); return; }
    const operationId = String(req.body.operationId);
    ledger.claim({ operationId, provider: "codex", ledgerKey: confirmation.ledgerKey, ownerId: "baseline" });
    const result = await client.consume(operationId);
    ledger.settle(operationId, JSON.stringify(result));
    res.json({ operationId, result, usage: await deps.usage() });
  });
  router.get("/api/quota/reset-operations", (_req, res) => {
    res.json({ operations: deps.db.prepare("SELECT * FROM reset_operations").all() });
  });
  router.post("/api/quota/reset-operations/:operationId/acknowledge", (req, res) => {
    deps.db.prepare("UPDATE reset_operations SET state='acknowledged' WHERE operation_id=?").run(req.params.operationId);
    res.json({ acknowledged: true });
  });
  return router;
}
