import { useCallback, useEffect, useRef, useState } from "react";
import type { QuotaTranslate } from "./CodexCredits";
import { trapKey } from "./ResetCreditsPanel";
import type { ResetOperation } from "./ResetCreditsPanel";

interface Coupon { tokenId: string; validityEnd: number | null }
export interface GrokCouponsTransport {
  list(): Promise<{ accountLabel: string | null; accountRef: string; coupons: Coupon[] }>;
  getOperations(): Promise<ResetOperation[]>;
  redeem(target: string, accountRef: string): Promise<{ result?: { outcome?: string }; state?: string }>;
  acknowledge?(id: string): Promise<unknown>;
}
const unresolved = (op: ResetOperation) => ["claimed", "sending", "unknown"].includes(op.state);
const idOf = (op: ResetOperation) => op.operationId ?? op.operation_id ?? "";
type Props = { transport: GrokCouponsTransport; t?: QuotaTranslate; onRefresh?: () => void };
export function GrokCouponsPanel({ transport, t = (key) => key, onRefresh }: Props) {
  const [list, setList] = useState<Awaited<ReturnType<GrokCouponsTransport["list"]>> | null>(null);
  const [ops, setOps] = useState<ResetOperation[] | null>(null);
  const [target, setTarget] = useState<{ id: string; accountRef: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refresh = useCallback(async (reportUnavailable = true) => {
    try { const [coupons, operations] = await Promise.all([transport.list(), transport.getOperations()]); setList(coupons); setOps(operations); }
    catch { setList(null); setOps(null); if (reportUnavailable) setMessage("unavailable"); }
  }, [transport]);
  useEffect(() => { void refresh(); }, [refresh]);
  const confirm = async () => {
    if (!target || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("redeeming");
    try {
      const response = await transport.redeem(target.id, target.accountRef);
      setMessage(response.result?.outcome === "success" ? "success" : "unknown");
      onRefresh?.();
    } catch (error) { setMessage((error as { code?: string }).code === "IDENTITY_CHANGED" ? "identityChanged" : "unknown"); }
    finally { setTarget(null); await refresh(false); setBusy(false); inFlight.current = false; trigger.current?.focus(); }
  };
  const acknowledge = async (id: string) => {
    if (!transport.acknowledge || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await transport.acknowledge(id); await refresh(); }
    catch { setMessage("ackBlocked"); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <div className="quota-reset">
    <p>{t("settings.quota.grokCoupons.title")}</p>
    {list && <><p>{t("settings.quota.grokCoupons.account")}: {list.accountLabel ?? "—"}</p>
      {list.coupons.length === 0 && <p>{t("settings.quota.grokCoupons.empty")}</p>}
      <ul>{list.coupons.map(coupon => <li key={coupon.tokenId}>
        {coupon.validityEnd !== null && t("settings.quota.grokCoupons.expires", { date: new Date(coupon.validityEnd * 1000).toLocaleString() })}{" "}
        <button type="button" className="settings-action-btn" data-coupon={coupon.tokenId} disabled={busy || !ops || ops.some(unresolved)}
          onClick={(event) => { trigger.current = event.currentTarget; setTarget({ id: coupon.tokenId, accountRef: list.accountRef }); }}>{t("settings.quota.redeem.action")}</button>
      </li>)}</ul></>}
    {ops?.filter(unresolved).map(op => <div key={idOf(op)}><p>{idOf(op)} · {op.state}</p>
      {op.state === "unknown" && <><p>{t("settings.quota.acknowledge.explanation")}</p>
        {(op.unknownOrigin ?? op.unknown_origin) === "recovered" && <p>{t("settings.quota.acknowledge.blocked")}</p>}
        <button type="button" disabled={busy} onClick={() => { void acknowledge(idOf(op)); }}>{t("settings.quota.acknowledge.action")}</button></>}
    </div>)}
    <div role="status" aria-live="polite">{message && t(message === "ackBlocked" ? "settings.quota.acknowledge.blocked" : message === "unavailable" ? "settings.quota.grokCoupons.unavailable" : `settings.quota.redeem.${message}`)}</div>
    {target && <div className="quota-reset__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="grok-confirm-title" className="quota-reset__dialog"
      onKeyDown={event => trapKey(event, () => { if (!busy) { setTarget(null); trigger.current?.focus(); } })}>
      <p id="grok-confirm-title">{t("settings.quota.grokCoupons.confirm")}</p>
      <button type="button" disabled={busy} ref={node => { node?.focus(); }} onClick={() => { setTarget(null); trigger.current?.focus(); }}>{t("settings.quota.redeem.cancel")}</button>
      <button type="button" disabled={busy} onClick={() => { void confirm(); }}>{t("settings.quota.redeem.action")}</button>
    </div></div>}
  </div>;
}
