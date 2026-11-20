import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Toggle } from "../controls";
import type { QuotaTranslate } from "./CodexCredits";
import { quotaDetails, useQuotaDetails } from "./QuotaDetails";

export interface ResetOperation {
  operationId?: string; operation_id?: string; state: string; unknownOrigin?: string; unknown_origin?: string | null;
}
export interface ResetList {
  accountRef: string;
  credits: Array<{ id?: string; title?: string | null; status?: string | null; expiresAt?: string | null }>;
  availableCount?: number | null;
  complete?: boolean;
}
export interface ResetCreditsTransport {
  getOperations(): Promise<ResetOperation[]>;
  list?(): Promise<ResetList>;
  redeem(accountRef: string): Promise<void | { result?: { outcome?: string }; outcome?: string }>;
  acknowledge?(id: string): Promise<unknown>;
  getSettings?(): Promise<ResetSettings>;
  saveSettings?(settings: ResetSettings): Promise<ResetSettings>;
  getFence?(): Promise<{ accountRef: string; fence: ResetFence }>;
  releaseFence?(id: string, accountRef: string): Promise<unknown>;
}
export type ResetFence = { fenced: false } | { fenced: true; operation_id: string; outcome: string; settled_at: number; cause: string };
export interface ResetSettings { enabled: boolean; leadMinutes: number; accountRef: string | null }
const unresolved = (op: ResetOperation) => ["claimed", "sending", "unknown"].includes(op.state);
const operationId = (op: ResetOperation) => op.operationId ?? op.operation_id ?? "";
const shortRef = (value: string) => value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
const outcomeKeys: Record<string, string> = { reset: "success", nothing_to_reset: "nothingToReset",
  no_credit: "noCredit", already_redeemed: "alreadyRedeemed", unknown: "unknown", IDENTITY_CHANGED: "identityChanged" };

export function trapKey(event: KeyboardEvent<HTMLDivElement>, close: () => void) {
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
  if (list && list.credits.length === 0) return <p className="settings-row__microcopy">{t("settings.quota.resetCredits.empty")}</p>;
  return list && <ul>{list.credits.map((credit, index) => <li key={credit.id ?? index}>
    {credit.title ?? credit.status ?? "—"} {credit.expiresAt && t("settings.quota.resetCredits.expires", { date: credit.expiresAt })}
  </li>)}</ul>;
}

type PanelProps = {
  transport: ResetCreditsTransport; t?: QuotaTranslate; onRefresh?: () => void;
  accountRef?: string; accountEmail?: string | null;
  availableCount?: number | null; applicableAvailableCount?: number | null;
  fencePoller?: FencePoller;
};
/** Starts periodic refreshes and returns a stop function. */
export type FencePoller = (refresh: () => void) => () => void;
const FENCE_POLL_MS = 30_000;
const intervalFencePoller: FencePoller = (refresh) => {
  if (typeof setInterval !== "function") return () => {};
  const timer = setInterval(refresh, FENCE_POLL_MS);
  return () => clearInterval(timer);
};
type SetMessage = (message: string) => void;
type AccountRef = { current: string | undefined };
const errorCode = (error: unknown) => (error as { code?: string }).code;

function useOperations(transport: ResetCreditsTransport, setMessage: SetMessage) {
  const [ops, setOps] = useState<ResetOperation[]>([]);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const refreshOps = () => transport.getOperations().then((data) => { setOps(data); setOpsLoaded(true); })
    .catch(() => { setOpsLoaded(false); setMessage("loadError"); });
  useEffect(() => { void refreshOps(); }, [transport]);
  return { ops, opsLoaded, refreshOps };
}

function useFence(transport: ResetCreditsTransport, accountRef: string | undefined, displayedRef: AccountRef,
  inFlight: { current: boolean }, fencePoller: FencePoller, setMessage: SetMessage) {
  const [fence, setFence] = useState<ResetFence>({ fenced: false });
  const refreshFence = async () => {
    if (!transport.getFence) return;
    const data = await transport.getFence();
    if (data.accountRef === displayedRef.current) setFence(data.fence);
  };
  useEffect(() => { setFence({ fenced: false }); void refreshFence().catch(() => setMessage("loadError")); }, [transport, accountRef]);
  // Background auto-redeem can create a fence while this panel stays open.
  useEffect(() => fencePoller(() => { if (!inFlight.current) void refreshFence().catch(() => {}); }), [transport, accountRef, fencePoller]);
  return { fence, refreshFence };
}

function useResetSettings(transport: ResetCreditsTransport, displayedRef: AccountRef, accountChanged: () => void, setMessage: SetMessage) {
  const [settings, setSettings] = useState<ResetSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  useEffect(() => { if (transport.getSettings) void transport.getSettings().then(setSettings).catch(() => setMessage("loadError")); }, [transport]);
  const saveSettings = async (next: ResetSettings) => {
    if (!transport.saveSettings || !displayedRef.current || settingsBusy || !Number.isInteger(next.leadMinutes) || next.leadMinutes < 1 || next.leadMinutes > 60) return;
    setSettingsBusy(true);
    try { setSettings(await transport.saveSettings({ ...next, accountRef: displayedRef.current })); }
    catch (error) { if (errorCode(error) === "IDENTITY_CHANGED") accountChanged(); else setMessage("loadError"); }
    finally { setSettingsBusy(false); }
  };
  return { settings, settingsBusy, saveSettings };
}

function earliestExpiry(credits: ResetList["credits"]): string | null {
  const times = credits.map(credit => Date.parse(credit.expiresAt ?? "")).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toLocaleDateString() : null;
}

/** Read-only list for the folded summary; ignored if it belongs to another account. */
function useEarliestExpiry(transport: ResetCreditsTransport, accountRef: string | undefined, displayedRef: AccountRef) {
  const [earliest, setEarliest] = useState<string | null>(null);
  useEffect(() => {
    setEarliest(null);
    if (!transport.list || !accountRef) return;
    void transport.list().then(data => { if (data.accountRef === displayedRef.current) setEarliest(earliestExpiry(data.credits)); }).catch(() => {});
  }, [transport, accountRef, displayedRef]);
  return earliest;
}

function resetSummary(t: QuotaTranslate, count: number | null | undefined, earliest: string | null, attention: boolean) {
  const shown = count ?? t("settings.quota.resetCredits.unknown");
  const line = earliest ? t("settings.quota.resetCredits.summaryExpiry", { count: shown, date: earliest }) : t("settings.quota.resetCredits.summary", { count: shown });
  return attention ? `${line} · ${t("settings.quota.details.attention")}` : line;
}

interface Flow {
  transport: ResetCreditsTransport; displayedRef: AccountRef; inFlight: { current: boolean };
  trigger: { current: HTMLButtonElement | null }; dialog: string | null; busy: boolean; onRefresh?: () => void;
  setBusy(value: boolean): void; setMessage: SetMessage; setDialog(value: string | null): void;
  setList(value: ResetList | null): void; setListError(value: boolean): void;
  accountChanged(): void; refreshOps(): Promise<unknown>; refreshFence(): Promise<void>;
}

function openRedeem(flow: Flow) {
  if (!flow.transport.list) return;
  const clickedRef = flow.displayedRef.current;
  flow.setBusy(true);
  void flow.transport.list().then(data => {
    if (!clickedRef || data.accountRef !== clickedRef || flow.displayedRef.current !== clickedRef) { flow.accountChanged(); return; }
    flow.setList(data); flow.setMessage(""); flow.setDialog(data.accountRef);
  }).catch(() => flow.setListError(true)).finally(() => flow.setBusy(false));
}

function listCredits(flow: Flow) {
  flow.setList(null); flow.setListError(false);
  if (flow.transport.list) void flow.transport.list().then(flow.setList).catch(() => flow.setListError(true));
}

async function confirmRedeem(flow: Flow) {
  const { dialog } = flow;
  if (flow.inFlight.current || !dialog) return;
  flow.inFlight.current = true;
  flow.setBusy(true); flow.setMessage("redeeming");
  try {
    if (!flow.transport.list) throw new Error("RESET_LIST_UNAVAILABLE");
    const latest = await flow.transport.list();
    if (!flow.displayedRef.current || latest.accountRef !== dialog || dialog !== flow.displayedRef.current) { flow.accountChanged(); return; }
    const result = await flow.transport.redeem(dialog);
    flow.setMessage(outcomeKeys[result?.result?.outcome ?? result?.outcome ?? "unknown"] ?? "unknown");
    flow.onRefresh?.();
  } catch (error) {
    if (errorCode(error) === "IDENTITY_CHANGED") flow.accountChanged(); else flow.setMessage("unknown");
  } finally {
    flow.inFlight.current = false; flow.setBusy(false); flow.setDialog(null);
    void flow.refreshOps(); void flow.refreshFence().catch(() => flow.setMessage("loadError")); flow.trigger.current?.focus();
  }
}

async function acknowledgeOperation(flow: Flow, id: string) {
  if (!flow.transport.acknowledge || flow.busy) return;
  flow.setBusy(true);
  try { await flow.transport.acknowledge(id); await flow.refreshOps(); await flow.refreshFence(); }
  catch { flow.setMessage("ackBlocked"); } finally { flow.setBusy(false); }
}

async function releaseFence(flow: Flow, fence: ResetFence) {
  if (!fence.fenced || !flow.transport.releaseFence || !flow.displayedRef.current || flow.busy) return;
  const ref = flow.displayedRef.current;
  flow.setBusy(true);
  try { await flow.transport.releaseFence(fence.operation_id, ref); await flow.refreshFence(); }
  catch (error) { if (errorCode(error) === "IDENTITY_CHANGED") flow.accountChanged(); else flow.setMessage("loadError"); }
  finally { flow.setBusy(false); }
}

function fenceNotice(fence: ResetFence, disabled: boolean, t: QuotaTranslate, release: () => void) {
  if (!fence.fenced) return null;
  return <div role="status"><p>{t("settings.quota.autoRedeem.paused")}</p>
    <p>{t("settings.quota.autoRedeem.resumeExplanation")}</p>
    <button type="button" disabled={disabled || !["reset", "already_redeemed", "unknown-acknowledged"].includes(fence.outcome)} onClick={release}>{t("settings.quota.autoRedeem.resume")}</button></div>;
}

function settingsSection(settings: ResetSettings, settingsBusy: boolean, accountRef: string | undefined, t: QuotaTranslate, save: (next: ResetSettings) => void) {
  const saveLead = (input: HTMLInputElement) => {
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 1 && value <= 60) save({ ...settings, enabled: settings.enabled && settings.accountRef === accountRef, leadMinutes: value });
    else input.value = String(settings.leadMinutes);
  };
  return <fieldset disabled={settingsBusy}><legend>{t("settings.quota.autoRedeem.title")}</legend>
    <article className="settings-row">
      <div className="settings-row__copy"><h4>{t("settings.quota.autoRedeem.enable")}</h4>
        <p className="settings-row__microcopy">{t("settings.quota.autoRedeem.warning")}</p>
        <p className="settings-row__microcopy">{t("settings.quota.autoRedeem.account", { account: settings.accountRef ?? "—" })}</p></div>
      <div className="settings-row__control"><Toggle checked={settings.enabled && !!accountRef && settings.accountRef === accountRef} disabled={settingsBusy || !accountRef}
        ariaLabel={t("settings.quota.autoRedeem.enable")} onChange={enabled => save({ ...settings, enabled })} /></div>
    </article>
    <article className="settings-row">
      <div className="settings-row__copy"><label htmlFor="reset-lead-minutes">{t("settings.quota.autoRedeem.lead")}</label></div>
      <div className="settings-row__control"><input id="reset-lead-minutes" className="custom-size-input" type="number" min={1} max={60} disabled={!accountRef || (settings.enabled && settings.accountRef !== accountRef)} defaultValue={settings.leadMinutes} key={settings.leadMinutes}
        onBlur={event => saveLead(event.target)} /></div>
    </article>
  </fieldset>;
}

function confirmDialog(flow: Flow, dialog: string, accountEmail: string | null | undefined, t: QuotaTranslate) {
  const close = () => { flow.setDialog(null); flow.trigger.current?.focus(); };
  return <div className="quota-reset__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="reset-confirm-title"
    className="quota-reset__dialog" onKeyDown={(event) => trapKey(event, () => { if (!flow.busy) close(); })}>
    <p id="reset-confirm-title">{t("settings.quota.redeem.confirm")}</p>
    <p>{accountEmail && <>{accountEmail} · </>}{shortRef(dialog)}</p>
    <button type="button" disabled={flow.busy} ref={(node) => { node?.focus(); }} onClick={close}>{t("settings.quota.redeem.cancel")}</button>
    <button type="button" disabled={flow.busy} onClick={() => { void confirmRedeem(flow); }}>{t("settings.quota.redeem.action")}</button>
  </div></div>;
}

export function ResetCreditsPanel({ transport, t = (key) => key, onRefresh, accountRef, accountEmail, availableCount, applicableAvailableCount, fencePoller = intervalFencePoller }: PanelProps) {
  const [dialog, setDialog] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [list, setList] = useState<ResetList | null>(null);
  const [listError, setListError] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const displayedRef = useRef(accountRef); displayedRef.current = accountRef;
  const accountChanged = () => { setDialog(null); setMessage("identityChanged"); onRefresh?.(); };
  const { ops, opsLoaded, refreshOps } = useOperations(transport, setMessage);
  const { fence, refreshFence } = useFence(transport, accountRef, displayedRef, inFlight, fencePoller, setMessage);
  const { settings, settingsBusy, saveSettings } = useResetSettings(transport, displayedRef, accountChanged, setMessage);
  const details = useQuotaDetails();
  const earliest = useEarliestExpiry(transport, accountRef, displayedRef);
  const flow: Flow = { transport, displayedRef, inFlight, trigger, dialog, busy, onRefresh, setBusy, setMessage, setDialog,
    setList, setListError, accountChanged, refreshOps, refreshFence };
  const usableCount = applicableAvailableCount === undefined ? availableCount : applicableAvailableCount;
  const noUsableCredits = usableCount == null || usableCount <= 0;
  const summary = resetSummary(t, availableCount, earliest, fence.fenced || ops.some(unresolved));
  return <div className="quota-reset">
    {quotaDetails("quota-codex-reset-credits", details, t("settings.quota.resetCredits.count"), summary, <>
    <button type="button" className="settings-action-btn" ref={trigger} disabled={busy || !opsLoaded || ops.some(unresolved) || noUsableCredits} onClick={() => openRedeem(flow)}>
      {t("settings.quota.redeem.action")}</button>
    {noUsableCredits && <p className="settings-row__microcopy">{t(usableCount == null ? "settings.quota.redeem.creditUnknown" : "settings.quota.redeem.noCredit")}</p>}
    <button type="button" className="settings-action-btn" onClick={() => listCredits(flow)}>{t("settings.quota.resetCredits.list")}</button>
    {listError && <p role="alert" className="settings-row__microcopy">{t("settings.quota.resetCredits.loadError")}</p>}
    {list?.complete === false && <p role="status" className="settings-row__microcopy">{t("settings.quota.resetCredits.partial")}</p>}
    {creditRows(list, t)}
    {fenceNotice(fence, busy || !accountRef, t, () => { void releaseFence(flow, fence); })}
    {settings && settingsSection(settings, settingsBusy, accountRef, t, (next) => { void saveSettings(next); })}
    {operationRows(ops, busy, t, (id) => { void acknowledgeOperation(flow, id); })}
    </>)}
    <div role="status" aria-live="polite">{message && t(message === "ackBlocked" ? "settings.quota.acknowledge.blocked" : `settings.quota.redeem.${message}`)}</div>
    {dialog && confirmDialog(flow, dialog, accountEmail, t)}
  </div>;
}
