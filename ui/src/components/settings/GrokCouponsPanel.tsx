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
type CouponList = Awaited<ReturnType<GrokCouponsTransport["list"]>>;
type Target = { id: string; accountRef: string; accountLabel: string | null; validityEnd: number | null };
const unresolved = (op: ResetOperation) => ["claimed", "sending", "unknown"].includes(op.state);
const idOf = (op: ResetOperation) => op.operationId ?? op.operation_id ?? "";
const shortRef = (value: string) => value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
const expiry = (t: QuotaTranslate, validityEnd: number) => t("settings.quota.grokCoupons.expires", { date: new Date(validityEnd * 1000).toLocaleString() });
type Props = { transport: GrokCouponsTransport; t?: QuotaTranslate; onRefresh?: () => void };

interface CouponFlow {
  transport: GrokCouponsTransport; inFlight: { current: boolean };
  setBusy(value: boolean): void; setMessage(value: string): void; setList(value: CouponList): void;
  setTarget(value: Target | null): void; accountChanged(): void;
}

async function openCoupon(flow: CouponFlow, id: string, accountRef: string) {
  if (flow.inFlight.current) return;
  flow.inFlight.current = true; flow.setBusy(true);
  try {
    const latest = await flow.transport.list();
    if (!accountRef || latest.accountRef !== accountRef) { flow.setList(latest); flow.accountChanged(); return; }
    const coupon = latest.coupons.find(item => item.tokenId === id);
    if (!coupon) { flow.setList(latest); flow.setMessage("unavailable"); return; }
    flow.setMessage(""); flow.setTarget({ id, accountRef, accountLabel: latest.accountLabel, validityEnd: coupon.validityEnd });
  } catch { flow.setMessage("unavailable"); }
  finally { flow.setBusy(false); flow.inFlight.current = false; }
}

function couponRows(list: CouponList, disabled: boolean, t: QuotaTranslate, open: (button: HTMLButtonElement, id: string) => void) {
  return <><p>{t("settings.quota.grokCoupons.account")}: {list.accountLabel ?? "—"}</p>
    {list.coupons.length === 0 && <p>{t("settings.quota.grokCoupons.empty")}</p>}
    <ul>{list.coupons.map(coupon => <li key={coupon.tokenId}>
      {coupon.validityEnd !== null && expiry(t, coupon.validityEnd)}{" "}
      <button type="button" className="settings-action-btn" data-coupon={coupon.tokenId} disabled={disabled}
        onClick={(event) => open(event.currentTarget, coupon.tokenId)}>{t("settings.quota.redeem.action")}</button>
    </li>)}</ul></>;
}

function operationRows(ops: ResetOperation[] | null, busy: boolean, t: QuotaTranslate, acknowledge: (id: string) => void) {
  return ops?.filter(unresolved).map(op => <div key={idOf(op)}><p>{idOf(op)} · {op.state}</p>
    {op.state === "unknown" && <><p>{t("settings.quota.acknowledge.explanation")}</p>
      {(op.unknownOrigin ?? op.unknown_origin) === "recovered" && <p>{t("settings.quota.acknowledge.blocked")}</p>}
      <button type="button" disabled={busy} onClick={() => acknowledge(idOf(op))}>{t("settings.quota.acknowledge.action")}</button></>}
  </div>);
}

function confirmDialog(target: Target, busy: boolean, t: QuotaTranslate, close: () => void, confirm: () => void) {
  return <div className="quota-reset__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="grok-confirm-title" className="quota-reset__dialog"
    onKeyDown={event => trapKey(event, () => { if (!busy) close(); })}>
    <p id="grok-confirm-title">{t("settings.quota.grokCoupons.confirm")}</p>
    <p>{t("settings.quota.grokCoupons.account")}: {target.accountLabel && <>{target.accountLabel} · </>}{shortRef(target.accountRef)}</p>
    <p>{t("settings.quota.grokCoupons.title")}: {shortRef(target.id)} · {target.validityEnd === null ? "—" : expiry(t, target.validityEnd)}</p>
    <button type="button" disabled={busy} ref={node => { node?.focus(); }} onClick={close}>{t("settings.quota.redeem.cancel")}</button>
    <button type="button" disabled={busy} onClick={confirm}>{t("settings.quota.redeem.action")}</button>
  </div></div>;
}

const statusKey = (message: string) => message === "ackBlocked" ? "settings.quota.acknowledge.blocked"
  : message === "unavailable" ? "settings.quota.grokCoupons.unavailable" : `settings.quota.redeem.${message}`;

export function GrokCouponsPanel({ transport, t = (key) => key, onRefresh }: Props) {
  const [list, setList] = useState<CouponList | null>(null);
  const [ops, setOps] = useState<ResetOperation[] | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refresh = useCallback(async (reportUnavailable = true) => {
    try { const [coupons, operations] = await Promise.all([transport.list(), transport.getOperations()]); setList(coupons); setOps(operations); }
    catch { setList(null); setOps(null); if (reportUnavailable) setMessage("unavailable"); }
  }, [transport]);
  useEffect(() => { void refresh(); }, [refresh]);
  const accountChanged = () => { setTarget(null); setMessage("identityChanged"); onRefresh?.(); };
  const flow: CouponFlow = { transport, inFlight, setBusy, setMessage, setList, setTarget, accountChanged };
  const close = () => { setTarget(null); trigger.current?.focus(); };
  const confirm = async () => {
    if (!target || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("redeeming");
    try {
      const latest = await transport.list();
      if (!target.accountRef || latest.accountRef !== target.accountRef) { setList(latest); accountChanged(); return; }
      const response = await transport.redeem(target.id, target.accountRef);
      setMessage(response.result?.outcome === "success" ? "success" : "unknown");
      onRefresh?.();
    } catch (error) { if ((error as { code?: string }).code === "IDENTITY_CHANGED") accountChanged(); else setMessage("unknown"); }
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
    {list && couponRows(list, busy || !ops || ops.some(unresolved), t, (button, id) => { trigger.current = button; void openCoupon(flow, id, list.accountRef); })}
    {operationRows(ops, busy, t, (id) => { void acknowledge(id); })}
    <div role="status" aria-live="polite">{message && t(statusKey(message))}</div>
    {target && confirmDialog(target, busy, t, close, () => { void confirm(); })}
  </div>;
}
