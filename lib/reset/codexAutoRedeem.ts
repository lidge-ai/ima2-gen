import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { OperationLedger } from "./operationLedger.js";
import { readResetSettings } from "./settings.js";
import { resetIdentity } from "./identity.js";
import { CodexResetClient } from "./codexResetClient.js";
import { logWarn } from "../logger.js";

export interface AutoDependencies {
  accountId(): Promise<string>;
  client(account: string): CodexResetClient;
  now?(): number;
}
type Credit = { grantedAt?: unknown; expiresAt?: unknown; status?: unknown };
export const targetOf = (credit: Credit) => `${String(credit.grantedAt)}|${String(credit.expiresAt)}`;
export const creditSnapshot = (credits: Credit[]) => [...new Set(credits.map(targetOf))];
function time(value: unknown): number {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return typeof value === "string" ? Date.parse(value) : NaN;
}
function selectCredit(credits: Credit[], now: number, lead: number): Credit | undefined {
  return credits.filter(c => {
    const grant = time(c.grantedAt), expiry = time(c.expiresAt);
    return Number.isFinite(grant) && grant <= now && Number.isFinite(expiry) && expiry > now
      && expiry - now <= lead * 60_000 && (c.status == null || c.status === "available");
  }).sort((a, b) => time(a.expiresAt) - time(b.expiresAt) || time(a.grantedAt) - time(b.grantedAt))[0];
}
export class CodexAutoRedeem {
  private readonly ledger: OperationLedger;
  private readonly owner = randomUUID();
  private busy = false;
  private reconfigurePending = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(private readonly db: Database.Database, private readonly deps: AutoDependencies | (() => Promise<void>),
    private readonly schedule?: (callback: () => void) => void) { this.ledger = new OperationLedger(db); }
  start(): void {
    if (this.schedule) { this.schedule(() => { void this.tick(); }); return; }
    this.timer = setInterval(() => { void this.tick(); }, 60_000); this.timer.unref();
    void this.tick();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  reconfigure(): void {
    if (this.busy) { this.reconfigurePending = true; return; }
    void this.tick();
  }
  async tick(): Promise<void> {
    if (this.busy || !readResetSettings(this.db).enabled) return;
    this.busy = true;
    try {
      if (typeof this.deps === "function") await this.deps();
      else await this.run(this.deps);
    } catch (error) {
      logWarn("reset", "auto_redeem_failed", { errorName: error instanceof Error ? error.name : typeof error });
    } finally {
      this.busy = false;
      if (this.reconfigurePending) { this.reconfigurePending = false; void this.tick(); }
    }
  }
  private async run(deps: AutoDependencies): Promise<void> {
    const account = await deps.accountId(); const key = resetIdentity("codex", account).ledgerKey;
    if (readResetSettings(this.db).ledgerKey !== key) return;
    const now = deps.now?.() ?? Date.now();
    this.db.prepare("INSERT OR REPLACE INTO reset_owners VALUES (?, ?, ?)").run(this.owner, process.pid, now);
    this.ledger.recover(now);
    this.db.prepare("INSERT OR IGNORE INTO reset_accounts VALUES ('codex', ?, 0)").run(key);
    const revision = (this.db.prepare("SELECT revision FROM reset_accounts WHERE provider='codex' AND ledger_key=?").get(key) as { revision: number }).revision;
    const list = await deps.client(account).list();
    if (!list.complete) return;
    if (this.hasFence(key)) return;
    const reserved = new Set((this.db.prepare("SELECT target_key FROM reset_targets WHERE provider='codex' AND ledger_key=?").all(key) as Array<{ target_key: string }>).map(row => row.target_key));
    if (list.credits.some(item => reserved.has(targetOf(item)))) return;
    const credit = selectCredit(list.credits, deps.now?.() ?? Date.now(), readResetSettings(this.db).leadMinutes);
    if (!credit) return;
    const id = randomUUID();
    try { this.ledger.claim({ operationId: id, provider: "codex", ledgerKey: key, ownerId: this.owner,
      expectedRevision: revision, auto: true, target: targetOf(credit), creditSnapshot: creditSnapshot(list.credits) }); }
    catch (error) {
      if (error instanceof Error && error.message === "STALE_REVISION") await this.retryInspection(deps);
      return;
    }
    try {
      if (resetIdentity("codex", await deps.accountId()).ledgerKey !== key) { this.ledger.abandon(id, this.owner); return; }
    } catch { this.ledger.abandon(id, this.owner); return; }
    let fresh: Awaited<ReturnType<CodexResetClient["list"]>>;
    try { fresh = await deps.client(account).list(); }
    catch { this.ledger.abandon(id, this.owner); return; }
    if (!fresh.complete) { this.ledger.abandon(id, this.owner); return; }
    if (!selectCredit(fresh.credits.filter(item => targetOf(item) === targetOf(credit)), deps.now?.() ?? Date.now(), readResetSettings(this.db).leadMinutes)) {
      this.ledger.abandon(id, this.owner); await this.retryInspection(deps); return;
    }
    try { if (resetIdentity("codex", await deps.accountId()).ledgerKey !== key) { this.ledger.abandon(id, this.owner); return; } }
    catch { this.ledger.abandon(id, this.owner); return; }
    let client: CodexResetClient;
    try { client = await deps.client(account).prepare(); }
    catch { this.ledger.abandon(id, this.owner); return; }
    if (!this.ledger.sending(id, this.owner, true, creditSnapshot(fresh.credits),
      { expiresAt: time(credit.expiresAt), now: () => deps.now?.() ?? Date.now() })) return;
    try {
      const result = await client.consume(id);
      if (result.outcome === "unknown") this.ledger.unknown(id);
      else this.ledger.settle(id, JSON.stringify(result), result.outcome === "nothing_to_reset" || result.outcome === "no_credit");
    } catch { this.ledger.unknown(id); }
  }
  // Consume is untargeted upstream, so no credit list proves which credit a reset used.
  // Every redemption with a real outcome pauses automatic reset until the account owner
  // releases it through the confirmed release-fence route (which clears credit_snapshot).
  private hasFence(key: string): boolean {
    const rows = this.db.prepare(`SELECT state, outcome FROM reset_operations
      WHERE provider='codex' AND ledger_key=? AND credit_snapshot IS NOT NULL
      AND state IN ('claimed','sending','unknown','acknowledged','settled')`)
      .all(key) as Array<{ state: string; outcome: string | null }>;
    return rows.some(row => {
      if (row.state !== 'settled') return true;
      try {
        const outcome = (JSON.parse(row.outcome ?? '') as { outcome?: string }).outcome;
        return outcome !== 'nothing_to_reset' && outcome !== 'no_credit';
      } catch { return true; }
    });
  }
  private async retryInspection(deps: AutoDependencies): Promise<void> {
    // A later tick re-inspects without allowing unbounded recursive retries.
    if (this.schedule) this.schedule(() => { void this.tick(); });
    else setImmediate(() => { void this.tick(); });
    void deps;
  }
}
