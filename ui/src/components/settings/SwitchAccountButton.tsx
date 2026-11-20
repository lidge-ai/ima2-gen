import { useState, type RefObject } from "react";
import { useI18n } from "../../i18n";
import { useAccountSwitch } from "./useAccountSwitch";
import type { SwitchState } from "./quotaTypes";

type WaitingProps = { state: SwitchState; switching: RefObject<boolean>; startSwitch: (flow?: "browser" | "device") => Promise<void>; copied: boolean; setCopied: (copied: boolean) => void };

function WaitingCode({ state }: { state: SwitchState }) {
  const { t } = useI18n();
  return (
    <>
        {state.userCode ? (
          <>
            <div style={{ textAlign: "center", marginBottom: "4px" }}>
              {t("settings.quota.enterCode")}
            </div>
            <div style={{ textAlign: "center", fontSize: "18px", fontWeight: 700, fontFamily: "monospace", letterSpacing: "2px", margin: "6px 0" }}>
              {state.userCode}
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", marginBottom: "4px" }}>
            {t("settings.quota.completeInBrowser")}
          </div>
        )}
    </>
  );
}

function WaitingActions({ state, switching, startSwitch, copied, setCopied }: WaitingProps) {
  const { t } = useI18n();
  return (
    <>
        {state.verificationUrl && (
          <div style={{ display: "flex", gap: "4px", margin: "6px 0" }}>
            <button
              type="button"
              className="settings-action-btn"
              style={{ flex: 1, fontSize: "11px" }}
              onClick={() => { switching.current = false; void startSwitch(state.flow); }}
            >
              {t("settings.quota.retry")}
            </button>
            <button
              type="button"
              className="settings-action-btn"
              style={{ flex: 1, fontSize: "11px" }}
              onClick={() => {
                void navigator.clipboard?.writeText(state.verificationUrl!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              {copied ? t("settings.quota.copied") : t("settings.quota.copyLink")}
            </button>
          </div>
        )}
    </>
  );
}

function WaitingSwitch({ provider, state, switching, startSwitch, copied, setCopied }: WaitingProps & { provider: "grok" | "codex" }) {
  const { t } = useI18n();
  return (
      <div style={{ marginTop: "6px", padding: "8px", background: "var(--surface, #f5f5f5)", borderRadius: "var(--r-sm)", fontSize: "12px" }}>
        <WaitingCode state={state} />
        <WaitingActions state={state} switching={switching} startSwitch={startSwitch} copied={copied} setCopied={setCopied} />
        <div style={{ textAlign: "center", color: "var(--text-dim, #888)", fontSize: "11px" }}>
          {t("settings.quota.waitingApproval")}
        </div>
        {provider === "codex" && state.flow === "browser" && (
          <button
            type="button"
            className="settings-action-btn"
            style={{ width: "100%", fontSize: "11px", marginTop: "6px" }}
            onClick={() => { switching.current = false; void startSwitch("device"); }}
          >
            {t("settings.quota.useDeviceCode")}
          </button>
        )}
      </div>
    );
}

function SwitchError({ state, switching, setState }: Pick<ReturnType<typeof useAccountSwitch>, "state" | "switching" | "setState">) {
  const { t } = useI18n();
    return (
      <div style={{ marginTop: "6px" }}>
        <div className="quota-card__hint" style={{ color: "var(--red)", marginBottom: "4px" }}>
          {state.error || t("settings.quota.switchFailed")}
        </div>
        <button
          type="button"
          className="settings-action-btn"
          style={{ width: "100%", fontSize: "11px" }}
          onClick={() => { switching.current = false; setState({ phase: "idle" }); }}
        >
          {t("settings.quota.tryAgain")}
        </button>
      </div>
    );
}

export function SwitchAccountButton({ provider, onComplete }: { provider: "grok" | "codex"; onComplete: () => void }) {
  const { t } = useI18n();
  const { state, setState, switching, startSwitch } = useAccountSwitch(provider, onComplete);
  const [copied, setCopied] = useState(false);

  if (state.phase === "idle") {
    return (
      <button
        type="button"
        className="settings-action-btn"
        style={{ width: "100%", marginTop: "6px" }}
        onClick={() => { void startSwitch(); }}
      >
        {t("settings.quota.switchAccount", { provider: provider === "grok" ? "Grok" : "Codex" })}
      </button>
    );
  }

  if (state.phase === "starting") {
    return (
      <div className="quota-card__hint" style={{ textAlign: "center", marginTop: "6px" }}>
        {t("settings.quota.startingLogin")}
      </div>
    );
  }

  if (state.phase === "waiting") {
    return <WaitingSwitch provider={provider} state={state} switching={switching} startSwitch={startSwitch} copied={copied} setCopied={setCopied} />;
  }

  if (state.phase === "complete") {
    return (
      <div className="quota-card__hint" style={{ textAlign: "center", marginTop: "6px", color: "var(--green)" }}>
        {t("settings.quota.switchComplete")}
      </div>
    );
  }

  if (state.phase === "error") return <SwitchError state={state} switching={switching} setState={setState} />;

  return null;
}
