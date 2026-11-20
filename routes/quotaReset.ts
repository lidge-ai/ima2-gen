import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { getDb } from "../lib/db.js";
import { codexSessionStore } from "../lib/codexBackend/client.js";
import { fetchCodexUsage } from "../lib/quota/codexUsage.js";
import { Confirmations } from "../lib/reset/confirmations.js";
import { resetIdentity } from "../lib/reset/identity.js";
import { CodexResetClient } from "../lib/reset/codexResetClient.js";
import { codexResetTransport, type ResetTransport } from "../lib/reset/transport.js";
import { OperationLedger } from "../lib/reset/operationLedger.js";
export interface ResetDependencies {
  db: Database.Database; transport: ResetTransport;
  accountId(): string | Promise<string>; usage(): Promise<unknown>;
}
type Row = { operation_id: string; provider: string; ledger_key: string; state: string; owner_id: string; unknown_origin: string | null };
const principal = (res: Response): string => `${res.locals.accessPrincipal.mode}:${res.locals.accessPrincipal.principalId}`;
const error = (res: Response, status: number, code: string) => res.status(status).json({ error: { code } });
function ownerAlive(db: Database.Database, id: string): boolean {
  const owner = db.prepare("SELECT pid FROM reset_owners WHERE owner_id=?").get(id) as { pid: number } | undefined;
  if (!owner) return true;
  try { process.kill(owner.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function productionDeps(): ResetDependencies {
  return { db: getDb(), accountId: async () => (await codexSessionStore().get()).accountId,
    transport: codexResetTransport(() => ""), usage: async () => fetchCodexUsage(await codexSessionStore().get()) };
}
export function quotaResetRouter(ctx: RuntimeContext, onDispose?: (dispose: () => void) => void): Router {
  const router = Router();
  const injected = (ctx as RuntimeContext & { resetDependencies?: ResetDependencies }).resetDependencies;
  const deps = injected ?? productionDeps();
  const clientFor = (account: string) => new CodexResetClient(injected ? deps.transport : codexResetTransport(() => account));
  const confirmations = new Confirmations(), ledger = new OperationLedger(deps.db);
  const owner = randomUUID();
  const beat = () => { try { deps.db.prepare("INSERT OR REPLACE INTO reset_owners VALUES (?, ?, ?)").run(owner, process.pid, Date.now()); ledger.recover(Date.now()); } catch { /* db can close during shutdown */ } };
  beat(); const timer = setInterval(beat, 5000); timer.unref();
  onDispose?.(() => clearInterval(timer));
  const state = { deps, clientFor, confirmations, ledger, owner };
  registerConfirmations(router, state);
  registerRedeem(router, state);
  registerOperations(router, state);
  return router;
}

type RouterState = { deps: ResetDependencies; clientFor: (account: string) => CodexResetClient;
  confirmations: Confirmations; ledger: OperationLedger; owner: string };
function registerConfirmations(router: Router, state: RouterState): void {
  const { deps, clientFor, confirmations } = state;
  router.get("/api/quota/codex/reset-credits", async (_req, res) => {
    try { const account = await deps.accountId(); res.json(await clientFor(account).list()); } catch { error(res, 502, "RESET_LIST_FAILED"); }
  });
  router.post("/api/quota/reset-confirmations", async (req, res) => {
    try {
      if (req.body?.provider !== "codex" || typeof req.body.operationId !== "string" || !req.body.operationId.trim() || req.body.target != null) return error(res, 400, "INVALID_REQUEST");
      const identity = resetIdentity("codex", await deps.accountId());
      const token = confirmations.issue({ provider: "codex", ledgerKey: identity.ledgerKey,
        operationId: req.body.operationId, target: null, principalId: principal(res) });
      return res.json({ token });
    } catch { return error(res, 401, "ACCOUNT_ID_REQUIRED"); }
  });
}
function registerRedeem(router: Router, state: RouterState): void {
  const { deps, clientFor, confirmations, ledger, owner } = state;
  router.post("/api/quota/codex/reset-credits/redeem", async (req: Request, res: Response) => {
    try {
      const id = req.body?.operationId;
      if (typeof id !== "string" || !id.trim()) return error(res, 400, "INVALID_REQUEST");
      const identity = resetIdentity("codex", await deps.accountId());
      const existing = ledger.get(id) as Row | undefined;
      if (existing) return existing.ledger_key === identity.ledgerKey && existing.provider === "codex"
        ? res.json({ operationId: id, state: existing.state }) : error(res, 409, "IDENTITY_CHANGED");
      const confirmation = confirmations.take(String(req.body?.token ?? ""));
      if (!confirmation || confirmation.operationId !== id || confirmation.provider !== "codex" || req.body?.target != null) return error(res, 400, "INVALID_CONFIRMATION");
      if (confirmation.principalId !== principal(res)) return error(res, 403, "PRINCIPAL_CHANGED");
      if (confirmation.ledgerKey !== identity.ledgerKey) return error(res, 409, "IDENTITY_CHANGED");
      ledger.claim({ operationId: id, provider: "codex", ledgerKey: identity.ledgerKey, ownerId: owner });
      if (resetIdentity("codex", await deps.accountId()).ledgerKey !== identity.ledgerKey) {
        ledger.abandon(id, owner); return error(res, 409, "IDENTITY_CHANGED");
      }
      if (!ledger.sending(id, owner)) return error(res, 409, "OPERATION_FENCED");
      let result: Awaited<ReturnType<CodexResetClient["consume"]>>;
      try { result = await clientFor(identity.ledgerKey.slice("codex:".length)).consume(id); } catch { ledger.unknown(id); return error(res, 503, "DISPATCH_FAILED"); }
      if (result.outcome === "unknown") ledger.unknown(id); else ledger.settle(id, JSON.stringify(result));
      if (resetIdentity("codex", await deps.accountId()).ledgerKey !== identity.ledgerKey) return error(res, 409, "IDENTITY_CHANGED");
      return res.json({ operationId: id, result, usage: await deps.usage() });
    } catch { return error(res, 409, "RESET_CONFLICT"); }
  });
}
function registerOperations(router: Router, state: RouterState): void {
  const { deps, ledger } = state;
  router.get("/api/quota/reset-operations", async (req, res) => {
    try {
      if (req.query.provider !== "codex") return error(res, 400, "INVALID_PROVIDER");
      const identity = resetIdentity("codex", await deps.accountId());
      return res.json({ operations: deps.db.prepare("SELECT operation_id, provider, target, state, unknown_origin, outcome, acknowledged_at, note, created_at, updated_at FROM reset_operations WHERE provider=? AND ledger_key=? ORDER BY created_at DESC LIMIT 100").all("codex", identity.ledgerKey) });
    } catch { return error(res, 401, "ACCOUNT_ID_REQUIRED"); }
  });
  router.post("/api/quota/reset-operations/:operationId/acknowledge", async (req, res) => {
    try {
      const identity = resetIdentity("codex", await deps.accountId());
      const row = ledger.get(req.params.operationId) as Row | undefined;
      if (!row || row.ledger_key !== identity.ledgerKey || row.provider !== "codex") return error(res, 404, "NOT_FOUND");
      if (row.state !== "unknown" || (row.unknown_origin === "recovered" && ownerAlive(deps.db, row.owner_id))) return error(res, 409, "OWNER_MAY_BE_RUNNING");
      const changed = deps.db.prepare("UPDATE reset_operations SET state='acknowledged', acknowledged_at=?, acknowledged_by=?, note=?, updated_at=? WHERE operation_id=? AND state='unknown'")
        .run(Date.now(), principal(res), typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null, Date.now(), row.operation_id);
      return changed.changes ? res.json({ acknowledged: true }) : error(res, 409, "RESET_CONFLICT");
    } catch { return error(res, 409, "RESET_CONFLICT"); }
  });
}
