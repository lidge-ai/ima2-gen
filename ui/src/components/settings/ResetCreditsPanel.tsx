import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { QuotaTranslate } from "./CodexCredits";

export interface ResetOperation {
  operationId?: string; operation_id?: string; state: string; unknownOrigin?: string; unknown_origin?: string | null;
}
export interface ResetList {
  credits: Array<{ id?: string; title?: string | null; status?: string | null; expiresAt?: string | null }>;
  availableCount?: number | null;
}
export interface ResetCreditsTransport {
  getOperations(): Promise<ResetOperation[]>;
  list?(): Promise<ResetList>;
  redeem(): Promise<void | { result?: { outcome?: string }; outcome?: string }>;
  acknowledge?(id: string): Promise<unknown>;
}
const unresolved = (op: ResetOperation) => ["claimed", "sending", "unknown"].includes(op.state);
const operationId = (op: ResetOperation) => op.operationId ?? op.operation_id ?? "";
const outcomeKeys: Record<string, string> = { reset: "success", nothing_to_reset: "nothingToReset",
  no_credit: "noCredit", already_redeemed: "alreadyRedeemed", unknown: "unknown", IDENTITY_CHANGED: "identityChanged" };

function trapKey(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
  if (event.key === "Escape") { event.preventDefault(); close(); return; }
  if (event.key !== "Tab") return;
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
  if (!buttons.length) { event.preventDefault(); return; }
  const first = buttons[0]!; const last = buttons[buttons.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function operationRows(ops: ResetOperation[], busy: boolean, t: QuotaTranslate, acknowledge: (id: string) => void) {
  return ops.filter(unresolved).map((op) => <div key={operationId(op)}>
    <p>{operationId(op)} · {op.state}</p>
    {op.state === "unknown" && <><p>{t("settings.quota.acknowledge.explanation")}</p>
      {(op.unknownOrigin ?? op.unknown_origin) === "recovered" && <p>{t("settings.quota.acknowledge.blocked")}</p>}
      <button type="button" disabled={busy} onClick={() => acknowledge(operationId(op))}>
        {t("settings.quota.acknowledge.action")}</button></>}
  </div>);
}

function creditRows(list: ResetList | null, t: QuotaTranslate) {
  return list && <ul>{list.credits.map((credit, index) => <li key={credit.id ?? index}>
    {credit.title ?? credit.status ?? "—"} {credit.expiresAt && t("settings.quota.resetCredits.expires", { date: credit.expiresAt })}
  </li>)}</ul>;
}

type PanelProps = {
  transport: ResetCreditsTransport; t?: QuotaTranslate; onRefresh?: () => void;
};
export function ResetCreditsPanel({ transport, t = (key) => key, onRefresh }: PanelProps) {
  const [ops, setOps] = useState<ResetOperation[]>([]);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [list, setList] = useState<ResetList | null>(null);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refreshOps = () => transport.getOperations().then((data) => { setOps(data); setOpsLoaded(true); })
    .catch(() => { setOpsLoaded(false); setMessage("loadError"); });
  useEffect(() => { void transport.getOperations().then((data) => { setOps(data); setOpsLoaded(true); })
    .catch(() => { setOpsLoaded(false); setMessage("loadError"); }); }, [transport]);
  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("redeeming");
    try {
      const result = await transport.redeem();
      setMessage(outcomeKeys[result?.result?.outcome ?? result?.outcome ?? "unknown"] ?? "unknown");
      onRefresh?.();
    } catch (error) {
      setMessage((error as { code?: string }).code === "IDENTITY_CHANGED" ? "identityChanged" : "unknown");
    } finally { inFlight.current = false; setBusy(false); setDialog(false); void refreshOps(); trigger.current?.focus(); }
  };
  const acknowledge = async (id: string) => {
    if (!transport.acknowledge || busy) return;
    setBusy(true);
    try { await transport.acknowledge(id); await refreshOps(); }
    catch { setMessage("ackBlocked"); } finally { setBusy(false); }
  };
  return <div className="quota-reset">
    <button type="button" className="settings-action-btn" ref={trigger} disabled={busy || !opsLoaded || ops.some(unresolved)} onClick={() => setDialog(true)}>
      {t("settings.quota.redeem.action")}</button>
    <button type="button" className="settings-action-btn" onClick={() => {
      if (transport.list) void transport.list().then(setList).catch(() => setMessage("loadError"));
    }}>{t("settings.quota.resetCredits.list")}</button>
    {creditRows(list, t)}
    {operationRows(ops, busy, t, (id) => { void acknowledge(id); })}
    <div role="status" aria-live="polite">{message && t(message === "ackBlocked" ? "settings.quota.acknowledge.blocked" : `settings.quota.redeem.${message}`)}</div>
    {dialog && <div className="quota-reset__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="reset-confirm-title"
      className="quota-reset__dialog" onKeyDown={(event) => trapKey(event, () => { if (!busy) { setDialog(false); trigger.current?.focus(); } })}>
      <p id="reset-confirm-title">{t("settings.quota.redeem.confirm")}</p>
      <button type="button" disabled={busy} ref={(node) => { node?.focus(); }} onClick={() => { setDialog(false); trigger.current?.focus(); }}>{t("settings.quota.redeem.cancel")}</button>
      <button type="button" disabled={busy} onClick={() => { void confirm(); }}>{t("settings.quota.redeem.action")}</button>
    </div></div>}
  </div>;
}
