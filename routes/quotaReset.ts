import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import type { RuntimeContext } from "../lib/runtimeContext.js";
import { getDb } from "../lib/db.js";
import { codexSessionStore } from "../lib/codexBackend/client.js";
import { fetchCodexUsage } from "../lib/quota/codexUsage.js";
import { Confirmations } from "../lib/reset/confirmations.js";
import { accountRefForLedgerKey, resetIdentity } from "../lib/reset/identity.js";
import { CodexResetClient } from "../lib/reset/codexResetClient.js";
import { codexResetTransport, type ResetTransport } from "../lib/reset/transport.js";
import { GrokResetClient } from "../lib/reset/grokResetClient.js";
import { grokIdentity } from "../lib/reset/grokIdentity.js";
import { discoverXaiOAuthEndpoints, getGrokAccessToken } from "../lib/xaiAuth.js";
import { grokResetTransport } from "../lib/reset/transport.js";
import { OperationLedger } from "../lib/reset/operationLedger.js";
import { creditSnapshot } from "../lib/reset/codexAutoRedeem.js";
import { attributedTarget } from "../lib/reset/fence.js";
export interface ResetDependencies {
  db: Database.Database; transport: ResetTransport;
  accountId(): string | Promise<string>; usage(): Promise<unknown>;
  grokSession?(): Promise<GrokSession>;
}
type GrokSession = { bearer: string; identity: { ledgerKey: string; email: string | null } | null; transport: ResetTransport };
async function productionGrokSession(): Promise<GrokSession> {
  const bearer = await getGrokAccessToken();
  const discovery = await discoverXaiOAuthEndpoints();
  const identity = await grokIdentity(discovery.userinfoEndpoint ? { userinfo_endpoint: discovery.userinfoEndpoint } : {}, bearer, fetch);
  return { bearer, identity, transport: grokResetTransport(bearer) };
}
async function requireGrok(deps: ResetDependencies): Promise<GrokSession & { identity: NonNullable<GrokSession["identity"]> }> {
  const session = await (deps.grokSession ?? productionGrokSession)();
  if (!session.identity) throw new Error("GROK_IDENTITY_UNAVAILABLE");
  return session as GrokSession & { identity: NonNullable<GrokSession["identity"]> };
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
  registerGrok(router, state);
  registerOperations(router, state);
  return router;
}

type RouterState = { deps: ResetDependencies; clientFor: (account: string) => CodexResetClient;
  confirmations: Confirmations; ledger: OperationLedger; owner: string };
function registerConfirmations(router: Router, state: RouterState): void {
  const { deps, clientFor, confirmations } = state;
  router.get("/api/quota/codex/reset-credits", async (_req, res) => {
    try { const account = await deps.accountId(); res.json({ ...await clientFor(account).list(), accountRef: resetIdentity("codex", account).accountRef }); } catch { error(res, 502, "RESET_LIST_FAILED"); }
  });
  router.post("/api/quota/reset-confirmations", async (req, res) => {
    try {
      if (typeof req.body?.accountRef !== "string" || !req.body.accountRef) return error(res, 400, "INVALID_REQUEST");
      if (req.body?.provider === "grok") {
        if (typeof req.body.operationId !== "string" || !req.body.operationId.trim() || typeof req.body.target !== "string" || !req.body.target.trim()) return error(res, 400, "INVALID_REQUEST");
        const session = await requireGrok(deps);
        if (req.body.accountRef !== resetIdentity("grok", session.identity.ledgerKey).accountRef) return error(res, 409, "IDENTITY_CHANGED");
        const token = confirmations.issue({ provider: "grok", ledgerKey: session.identity.ledgerKey, operationId: req.body.operationId, target: req.body.target, principalId: principal(res) });
        return res.json({ token });
      }
      if (req.body?.provider !== "codex" || typeof req.body.operationId !== "string" || !req.body.operationId.trim() || req.body.target != null) return error(res, 400, "INVALID_REQUEST");
      if (req.body.purpose != null && req.body.purpose !== "release-fence") return error(res, 400, "INVALID_REQUEST");
      const identity = resetIdentity("codex", await deps.accountId());
      if (req.body.accountRef !== identity.accountRef) return error(res, 409, "IDENTITY_CHANGED");
      const token = confirmations.issue({ provider: "codex", ledgerKey: identity.ledgerKey,
        operationId: req.body.operationId, target: null, principalId: principal(res), purpose: req.body.purpose });
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
      const confirmation = confirmations.take(String(req.body?.confirmationToken ?? ""));
      if (!confirmation || confirmation.purpose || confirmation.operationId !== id || confirmation.provider !== "codex" || req.body?.target != null) return error(res, 400, "INVALID_CONFIRMATION");
      if (confirmation.principalId !== principal(res)) return error(res, 403, "PRINCIPAL_CHANGED");
      if (confirmation.ledgerKey !== identity.ledgerKey) return error(res, 409, "IDENTITY_CHANGED");
      let snapshot: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const row = deps.db.prepare("SELECT revision FROM reset_accounts WHERE provider='codex' AND ledger_key=?")
          .get(identity.ledgerKey) as { revision: number } | undefined;
        const credits = await clientFor(identity.ledgerKey.slice("codex:".length)).list();
        if (!credits.complete) return error(res, 409, "RESET_LIST_PARTIAL");
        snapshot = creditSnapshot(credits.credits);
        try {
          ledger.claim({ operationId: id, provider: "codex", ledgerKey: identity.ledgerKey, ownerId: owner,
            expectedRevision: row?.revision ?? 0, creditSnapshot: snapshot });
          break;
        } catch (claimError) {
          if (!(claimError instanceof Error) || claimError.message !== "STALE_REVISION") throw claimError;
          if (attempt === 1) return error(res, 409, "RESET_BUSY");
        }
      }
      if (resetIdentity("codex", await deps.accountId()).ledgerKey !== identity.ledgerKey) {
        ledger.abandon(id, owner); return error(res, 409, "IDENTITY_CHANGED");
      }
      let client: CodexResetClient;
      try { client = await clientFor(identity.ledgerKey.slice("codex:".length)).prepare(); }
      catch { ledger.abandon(id, owner); return error(res, 503, "DISPATCH_FAILED"); }
      if (!ledger.sending(id, owner, false, snapshot, undefined, attributedTarget(snapshot, Date.now()))) return error(res, 409, "OPERATION_FENCED");
      let result: Awaited<ReturnType<CodexResetClient["consume"]>>;
      try { result = await client.consume(id); } catch { ledger.unknown(id); return error(res, 503, "DISPATCH_FAILED"); }
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
      const provider = req.query.provider;
      if (provider !== "codex" && provider !== "grok") return error(res, 400, "INVALID_PROVIDER");
      const identity = provider === "grok" ? (await requireGrok(deps)).identity : resetIdentity("codex", await deps.accountId());
      const operations = deps.db.prepare("SELECT operation_id, provider, target, state, unknown_origin, outcome, acknowledged_at, note, created_at, updated_at FROM reset_operations WHERE provider=? AND ledger_key=? ORDER BY created_at DESC LIMIT 100").all(provider, identity.ledgerKey);
      return res.json({ operations, ...(provider === "codex" ? { fence: fenceFor(deps.db, identity.ledgerKey), accountRef: accountRefForLedgerKey(identity.ledgerKey) } : {}) });
    } catch { return error(res, 401, "ACCOUNT_ID_REQUIRED"); }
  });
  router.post("/api/quota/reset-operations/:operationId/release-fence", async (req, res) => {
    try {
      const identity = resetIdentity("codex", await deps.accountId());
      if (req.body?.accountRef !== identity.accountRef) return error(res, 409, "IDENTITY_CHANGED");
      const confirmation = state.confirmations.take(String(req.body?.confirmationToken ?? ""));
      if (!confirmation || confirmation.purpose !== "release-fence" || confirmation.provider !== "codex" || confirmation.operationId !== req.params.operationId) return error(res, 400, "INVALID_CONFIRMATION");
      if (confirmation.principalId !== principal(res)) return error(res, 403, "PRINCIPAL_CHANGED");
      if (confirmation.ledgerKey !== identity.ledgerKey) return error(res, 409, "IDENTITY_CHANGED");
      const released = deps.db.transaction(() => {
        const fence = fenceFor(deps.db, identity.ledgerKey);
        if (!fence.fenced || fence.operation_id !== req.params.operationId || !["reset", "already_redeemed", "unknown-acknowledged"].includes(fence.outcome)) return false;
        const changed = deps.db.prepare("UPDATE reset_operations SET credit_snapshot=NULL, fence_released_at=?, fence_released_by=? WHERE operation_id=? AND provider='codex' AND ledger_key=? AND state IN ('settled','acknowledged') AND credit_snapshot IS NOT NULL")
          .run(Date.now(), principal(res), req.params.operationId, identity.ledgerKey).changes;
        if (!changed) return false;
        deps.db.prepare("DELETE FROM reset_targets WHERE operation_id=?").run(req.params.operationId);
        deps.db.prepare("UPDATE reset_accounts SET revision=revision+1 WHERE provider='codex' AND ledger_key=?").run(identity.ledgerKey);
        return true;
      }).immediate();
      return released ? res.json({ released: true }) : error(res, 409, "FENCE_NOT_RELEASABLE");
    } catch { return error(res, 409, "RESET_CONFLICT"); }
  });
  router.post("/api/quota/reset-operations/:operationId/acknowledge", async (req, res) => {
    try {
      const row = ledger.get(req.params.operationId) as Row | undefined;
      if (!row || (row.provider !== "codex" && row.provider !== "grok")) return error(res, 404, "NOT_FOUND");
      const identity = row.provider === "grok" ? (await requireGrok(deps)).identity : resetIdentity("codex", await deps.accountId());
      if (row.ledger_key !== identity.ledgerKey) return error(res, 404, "NOT_FOUND");
      if (row.state !== "unknown" || (row.unknown_origin === "recovered" && ownerAlive(deps.db, row.owner_id))) return error(res, 409, "OWNER_MAY_BE_RUNNING");
      const changed = deps.db.prepare("UPDATE reset_operations SET state='acknowledged', acknowledged_at=?, acknowledged_by=?, note=?, updated_at=? WHERE operation_id=? AND state='unknown'")
        .run(Date.now(), principal(res), typeof req.body?.note === "string" ? req.body.note.slice(0, 1000) : null, Date.now(), row.operation_id);
      return changed.changes ? res.json({ acknowledged: true }) : error(res, 409, "RESET_CONFLICT");
    } catch { return error(res, 409, "RESET_CONFLICT"); }
  });
}

function fenceFor(db: Database.Database, key: string): { fenced: false } | { fenced: true; operation_id: string; outcome: string; settled_at: number; cause: string } {
  const rows = db.prepare("SELECT operation_id, state, outcome, updated_at, acknowledged_at FROM reset_operations WHERE provider='codex' AND ledger_key=? AND credit_snapshot IS NOT NULL AND state IN ('claimed','sending','unknown','acknowledged','settled') ORDER BY rowid").all(key) as Array<{ operation_id: string; state: string; outcome: string | null; updated_at: number; acknowledged_at: number | null }>;
  for (const row of rows) {
    let outcome = row.state === "acknowledged" ? "unknown-acknowledged" : row.state;
    if (row.state === "settled") {
      try { outcome = (JSON.parse(row.outcome ?? "") as { outcome?: string }).outcome ?? "unknown"; } catch { outcome = "unknown"; }
      if (outcome === "nothing_to_reset" || outcome === "no_credit") continue;
    }
    return { fenced: true, operation_id: row.operation_id, outcome, settled_at: row.acknowledged_at ?? row.updated_at, cause: "credit list has not confirmed the earlier reset" };
  }
  return { fenced: false };
}

function registerGrok(router: Router, state: RouterState): void {
  const { deps, confirmations, ledger, owner } = state;
  router.get("/api/quota/grok/reset-coupons", async (_req, res) => {
    try {
      const session = await requireGrok(deps);
      const coupons = await new GrokResetClient(session.transport).list();
      return res.json({ accountLabel: session.identity.email, accountRef: resetIdentity("grok", session.identity.ledgerKey).accountRef, coupons });
    } catch { return error(res, 502, "GROK_COUPONS_UNAVAILABLE"); }
  });
  router.post("/api/quota/grok/reset-coupons/redeem", async (req, res) => {
    try {
      const id = req.body?.operationId, target = req.body?.target;
      if (typeof id !== "string" || !id.trim() || typeof target !== "string" || !target.trim()) return error(res, 400, "INVALID_REQUEST");
      const session = await requireGrok(deps), identity = session.identity.ledgerKey;
      const existing = ledger.get(id) as Row | undefined;
      if (existing) return existing.provider === "grok" && existing.ledger_key === identity
        ? res.json({ operationId: id, state: existing.state }) : error(res, 409, "IDENTITY_CHANGED");
      const confirmation = confirmations.take(String(req.body?.confirmationToken ?? ""));
      if (!confirmation || confirmation.provider !== "grok" || confirmation.operationId !== id || confirmation.target !== target) return error(res, 400, "INVALID_CONFIRMATION");
      if (confirmation.principalId !== principal(res)) return error(res, 403, "PRINCIPAL_CHANGED");
      if (confirmation.ledgerKey !== identity) return error(res, 409, "IDENTITY_CHANGED");
      ledger.claim({ operationId: id, provider: "grok", ledgerKey: identity, target, ownerId: owner });
      let current: Awaited<ReturnType<typeof requireGrok>>;
      try { current = await requireGrok(deps); } catch { ledger.abandon(id, owner); return error(res, 502, "GROK_COUPONS_UNAVAILABLE"); }
      if (current.identity.ledgerKey !== identity) { ledger.abandon(id, owner); return error(res, 409, "IDENTITY_CHANGED"); }
      if (!ledger.sending(id, owner)) return error(res, 409, "OPERATION_FENCED");
      let result: { outcome: string };
      try { result = await new GrokResetClient(current.transport).redeem(target); } catch { ledger.unknown(id); return error(res, 503, "DISPATCH_FAILED"); }
      if (result.outcome === "unknown") ledger.unknown(id); else ledger.settle(id, JSON.stringify(result));
      try {
        if ((await requireGrok(deps)).identity.ledgerKey !== identity) return error(res, 409, "IDENTITY_CHANGED");
      } catch { return error(res, 502, "GROK_COUPONS_UNAVAILABLE"); }
      return res.json({ operationId: id, result });
    } catch { return error(res, 409, "RESET_CONFLICT"); }
  });
}
