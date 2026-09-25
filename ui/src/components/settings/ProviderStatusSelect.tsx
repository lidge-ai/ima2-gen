// 060 — Variant D provider selector: one grouped dropdown (CORE + MCP)
// replaces the 3-column provider grid and the 8-dot status strip
// (devlog/_fin/260716_mcp-model-surface-ui/060). Status is information
// (dot + text), selection is the action; color is never the only signal.
import { useState } from "react";
import { CORE_PROVIDER_IDS, isCoreProviderId } from "../../generated/providers";
import { useLaneCatalog } from "../../hooks/useLaneCatalog";
import { deriveComfyDisplay, comfyDisplayMessageKey } from "../../lib/comfyDisplay";
import { useAppStore } from "../../store/useAppStore";
import { setMcpProviderImpl } from "../../store/storeSettingsImpl";
import { useProviderAvailability } from "../../hooks/useProviderAvailability";
import { Select, type SelectGroup } from "../controls/Select";
import { ApiDisabledModal } from "../ApiDisabledModal";
import type { McpProviderRecord } from "../../lib/mcpProviders";
import type { Provider } from "../../types";
import { useI18n } from "../../i18n";

const CORE_PREFIX = "core:";
const MCP_PREFIX = "mcp:";

type CoreEntry = { value: Provider; provider: string; method: string };

const CORE_ENTRY_BY_ID: Record<Provider, CoreEntry> = {
  oauth: { value: "oauth", provider: "GPT", method: "OAuth" },
  api: { value: "api", provider: "GPT", method: "API" },
  grok: { value: "grok", provider: "Grok", method: "OAuth" },
  "grok-api": { value: "grok-api", provider: "Grok", method: "API" },
  agy: { value: "agy", provider: "Gemini", method: "agy" },
  "gemini-api": { value: "gemini-api", provider: "Gemini", method: "API" },
  atlascloud: { value: "atlascloud", provider: "Atlas Cloud", method: "API" },
  minimax: { value: "minimax", provider: "MiniMax", method: "API" },
  nai: { value: "nai", provider: "NovelAI", method: "API" },
  comfy: { value: "comfy", provider: "ComfyUI", method: "local" },
};
const CORE_ENTRIES: ReadonlyArray<CoreEntry> = CORE_PROVIDER_IDS.map((value) => CORE_ENTRY_BY_ID[value]);

function displayProviderId(id: string): string {
  return id.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

type DotTone = "ok" | "warn" | "bad";

function Dot({ tone }: { tone: DotTone }) {
  return (
    <span
      className={`status-dot status-dot--${tone === "ok" ? "ok" : tone === "warn" ? "warn" : "bad"}`}
      aria-hidden="true"
    />
  );
}

function mcpTone(record: McpProviderRecord): DotTone {
  if (!record.enabled) return "bad";
  // Execution lock comes from the server record, not a provider-id hardcode (260723).
  if (record.status.state === "connected") return record.executable === false ? "warn" : "ok";
  if (record.status.state === "connecting" || record.status.state === "auth_required") return "warn";
  return "bad";
}

export function ProviderStatusSelect({ mcpProviders }: { mcpProviders: McpProviderRecord[] }) {
  const { t } = useI18n();
  const provider = useAppStore((s) => s.provider);
  const mcpProvider = useAppStore((s) => s.mcpProvider ?? null);
  const setProvider = useAppStore((s) => s.setProvider);
  const availability = useProviderAvailability();
  const snapshot = useLaneCatalog();
  const comfyWorkflow = useAppStore((s) => s.comfyWorkflow);
  const comfyVideoWorkflow = useAppStore((s) => s.comfyVideoWorkflow);
  const comfyDisplay = deriveComfyDisplay(snapshot, { comfyWorkflow, comfyVideoWorkflow });
  const activeComfy = provider === "comfy" && !mcpProvider;
  const comfyTone: DotTone = comfyDisplay.selectedAvailable ? "ok"
    : ["error", "disconnected", "selected-offline"].includes(comfyDisplay.code) ? "bad" : "warn";
  const [blocked, setBlocked] = useState<{ label: string; reason: string; hint?: string } | null>(null);

  const coreStatusText = (entry: CoreEntry): string => {
    const state = availability[entry.value];
    if (entry.value === "comfy") return activeComfy ? t(comfyDisplayMessageKey(comfyDisplay, snapshot)) : state.reason;
    return state.ok ? t("provider.statusReady") : state.reason;
  };

  const mcpStatusText = (record: McpProviderRecord): string => {
    if (!record.enabled) return t("mcp.disabledProvider");
    if (record.status.state === "connected") {
      return record.executable === false ? `${t("provider.statusConnected")} · ${t("mcp.locked")}` : t("provider.statusConnected");
    }
    if (record.status.state === "connecting") return t("mcp.connecting");
    if (record.status.state === "auth_required") return t("provider.statusAuthRequired");
    if (record.status.state === "offline" || record.status.state === "error") {
      return t(`mcp.status.${record.status.state}`);
    }
    return t("provider.statusDisconnected");
  };

  const groups: SelectGroup<string>[] = [
    {
      label: t("mcp.coreProviders"),
      items: CORE_ENTRIES.map((entry) => {
        const state = availability[entry.value];
        return {
          value: `${CORE_PREFIX}${entry.value}`,
          searchText: `${entry.provider} ${entry.value === "comfy" ? t("comfy.display.localMethod") : entry.method}`,
          label: (
            <span className="provider-option">
              <Dot tone={entry.value === "comfy" && activeComfy ? comfyTone : state.ok ? "ok" : "bad"} />
              <span>{entry.provider} {entry.value === "comfy" ? t("comfy.display.localMethod") : entry.method}</span>
            </span>
          ),
          sub: coreStatusText(entry),
        };
      }),
    },
  ];
  const mcpItems = mcpProviders.filter((record) => record.enabled).map((record) => ({
    value: `${MCP_PREFIX}${record.id}`,
    searchText: displayProviderId(record.id),
    label: (
      <span className="provider-option">
        <Dot tone={mcpTone(record)} />
        <span>{displayProviderId(record.id)}</span>
      </span>
    ),
    sub: mcpStatusText(record),
  }));
  if (mcpItems.length > 0) groups.push({ label: "MCP", items: mcpItems });

  const selectedValue = mcpProvider ? `${MCP_PREFIX}${mcpProvider}` : `${CORE_PREFIX}${provider}`;
  const selectedCore = mcpProvider ? null : CORE_ENTRIES.find((entry) => entry.value === provider) ?? null;
  const selectedRecord = mcpProvider
    ? mcpProviders.find((record) => record.id === mcpProvider) ?? null
    : null;

  const isLocalComfy = selectedCore?.value === "comfy";
  const statusText = isLocalComfy
    ? t(comfyDisplayMessageKey(comfyDisplay, snapshot))
    : selectedCore
    ? coreStatusText(selectedCore)
    : selectedRecord
      ? mcpStatusText(selectedRecord)
      : t("provider.statusDisconnected");
  const statusTone: DotTone = isLocalComfy
    ? comfyTone
    : selectedCore
    ? (availability[selectedCore.value].ok ? "ok" : "bad")
    : selectedRecord
      ? mcpTone(selectedRecord)
      : "bad";
  const authText = selectedCore
    ? selectedCore.value === "comfy" ? t("comfy.display.localMethod") : selectedCore.method
    : "MCP";

  const onChange = (value: string) => {
    if (value.startsWith(CORE_PREFIX)) {
      const next = value.slice(CORE_PREFIX.length);
      if (!isCoreProviderId(next)) return;
      const entry = CORE_ENTRIES.find((candidate) => candidate.value === next);
      const state = availability[next];
      // ComfyUI has no credential gate: selecting it must remain possible so
      // the user can reach the existing workflow manager and configure it.
      if (next === "comfy") {
        setProvider(next);
        return;
      }
      if (!state.ok) {
        setBlocked({ label: entry ? `${entry.provider} ${entry.method}` : next, reason: state.reason, hint: state.hint });
        return;
      }
      setProvider(next);
      return;
    }
    const id = value.slice(MCP_PREFIX.length);
    const record = mcpProviders.find((candidate) => candidate.id === id);
    // MCP entry invariant matches the sidebar selector: enabled && connected
    // (060 audit A3). Higgsfield stays browseable; generation lock is separate.
    if (!record || !record.enabled || record.status.state !== "connected") {
      setBlocked({
        label: displayProviderId(id),
        reason: !record || !record.enabled ? t("mcp.disabledProvider") : t("mcp.disconnectedSelection"),
      });
      return;
    }
    setMcpProviderImpl(id, useAppStore.setState, useAppStore.getState);
  };

  return (
    <div className="option-group provider-status-select" data-testid="provider-status-select">
      <div className="section-title">{t("provider.authTitle")}</div>
      <Select
        groups={groups}
        value={selectedValue}
        onChange={onChange}
        triggerSub={isLocalComfy ? "" : undefined}
        portal
        ariaLabel={t("provider.authTitle")}
        className="provider-status-select__select"
      />
      <div className="provider-status-line" data-tone={statusTone} role="status" aria-live="polite">
        <Dot tone={statusTone} />
        <span className="provider-status-line__key">{t("provider.statusLineTitle")}:</span>
        <span className="provider-status-line__value">{statusText}</span>
      </div>
      {isLocalComfy && snapshot.observedAt !== null ? <p className="provider-helper">{t("comfy.display.lastChecked", { time: new Date(snapshot.observedAt).toLocaleTimeString() })}</p> : null}
      {isLocalComfy && comfyDisplay.code === "selected-missing" && snapshot.catalog?.comfy?.status === "disconnected"
        ? <p className="provider-helper">{t("comfy.statusOffline")}</p> : null}
      <div className="provider-auth-chip" title={t(isLocalComfy ? "comfy.display.localMethod" : "provider.authMethodTitle")}>
        <span>{authText}</span>
        {statusTone !== "bad" && !isLocalComfy
          ? <span className="provider-auth-chip__state">{t("provider.authActive")}</span>
          : null}
      </div>
      <ApiDisabledModal
        open={!!blocked}
        providerLabel={blocked?.label ?? ""}
        reason={blocked?.reason ?? ""}
        hint={blocked?.hint}
        onClose={() => setBlocked(null)}
      />
    </div>
  );
}
