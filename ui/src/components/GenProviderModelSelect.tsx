import { useEffect, useMemo, useState } from "react";
import type { Provider } from "../types";
import {
  getImageModelOptionsForProvider,
  VIDEO_MODEL_OPTIONS,
  resolveCoreModelValue,
  COMFY_VIDEO_VALUE_PREFIX,
  VIDEO_VALUE_PREFIX,
} from "../lib/imageModels";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "../lib/reasoning";
import { Select, type SelectGroup } from "./controls/Select";
import { getMcpModelCatalog, useMcpProviders, type McpModelCapabilities, type McpModelCatalog } from "../lib/mcpProviders";
import {
  encodeMcpModelValue,
  parseMcpModelValue,
  type McpMediaKind,
} from "../lib/mcpSelection";
import { useAppStore } from "../store/useAppStore";
import { useLaneCatalog } from "../hooks/useLaneCatalog";
import { getLaneCatalogSnapshot } from "../lib/laneCatalog";
import { comfyDisplayMessageKey, deriveComfyDisplay, isComfyModelAvailable } from "../lib/comfyDisplay";
import type { ComfyLaneModel } from "../lib/api-comfy";
import {
  hydrateMcpSelectionImpl,
  reconcileMcpPresetStateImpl,
  setMcpModelImpl,
  setMcpModelWithKindImpl,
  setMcpProviderImpl,
} from "../store/storeSettingsImpl";
import { useI18n } from "../i18n";

/**
 * Short display labels. This is a LABEL map, not the list of lanes that exist —
 * that comes from /api/models, so a lane the server grows cannot go missing
 * here. A lane with no entry falls back to its id and renders unselectable,
 * because `Provider` is a generated literal union and the store's coercion
 * branches only know these ids.
 */
const CORE_PROVIDER_OPTIONS: ReadonlyArray<{ value: Provider; label: string }> = [
  { value: "oauth", label: "GPT" },
  { value: "api", label: "GPT API" },
  { value: "grok", label: "Grok" },
  { value: "grok-api", label: "xAI API" },
  { value: "agy", label: "agy" },
  { value: "gemini-api", label: "Gem API" },
  { value: "atlascloud", label: "Atlas" },
  { value: "minimax", label: "MiniMax" },
  { value: "nai", label: "NovelAI" },
  { value: "comfy", label: "ComfyUI" },
];

const KNOWN_PROVIDER_LABELS = new Map<string, string>(
  CORE_PROVIDER_OPTIONS.map((option) => [option.value as string, option.label]),
);

/**
 * Lanes the MCP group already owns. They arrive in the same /api/models
 * response as core lanes but select through a different path (`mcp:` prefix,
 * setMcpProviderImpl), so listing them here too would show one lane twice with
 * two different meanings.
 */
const MCP_OWNED_LANES = new Set(["runway", "higgsfield"]);

const MCP_PREFIX = "mcp:";
const CORE_PREFIX = "core:";
const EFFORT_PREFIX = "effort:";
// Provider-hinted rows share one model id across lanes (nbp agy / nbp api):
// without the lane in the item value, Select's first-match lookup resolves the
// wrong row's label and picking either row does the same thing.
const LANE_PREFIX = "lane:";
// Re-exported from the resolver module so the option rows below and the
// selected-value computation can never drift onto two different encodings.
const VIDEO_PREFIX = VIDEO_VALUE_PREFIX;
const COMFY_VIDEO_PREFIX = COMFY_VIDEO_VALUE_PREFIX;

function applyMcpProvider(provider: string | null): void {
  setMcpProviderImpl(provider, useAppStore.setState, useAppStore.getState);
}

function applyMcpModel(model: string | null): void {
  setMcpModelImpl(model, useAppStore.setState, useAppStore.getState);
}

function applyMcpModelWithKind(model: string, kind: McpMediaKind, capabilities?: McpModelCapabilities): void {
  setMcpModelWithKindImpl(model, kind, useAppStore.setState, useAppStore.getState, capabilities);
}

const EMPTY_CATALOG: McpModelCatalog = { image: [], video: [] };
function displayProviderId(id: string): string {
  return id.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

/**
 * Short badge for a lane that cannot run right now.
 *
 * Ready lanes get nothing: labelling the normal case is noise on a dense
 * surface, and the exception is the only thing worth a second line. A ready
 * lane that still carries a reason keeps it on the row title.
 */
function laneStatusBadge(status: string, translate: (key: string) => string): string | null {
  if (status === "key-missing") return translate("mcp.lane.keyMissing");
  if (status === "disconnected") return translate("mcp.lane.offline");
  if (status === "locked") return translate("mcp.lane.locked");
  return null;
}

export function GenProviderModelSelect({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const provider = useAppStore((state) => state.provider);
  const imageModel = useAppStore((state) => state.imageModel);
  const videoModel = useAppStore((state) => state.videoModelSelected);
  const mcpProvider = useAppStore((state) => state.mcpProvider ?? null);
  const mcpModel = useAppStore((state) => state.mcpModel ?? null);
  const mcpMediaKind = useAppStore((state) => state.mcpMediaKind ?? "image");
  const setProvider = useAppStore((state) => state.setProvider);
  const setImageModel = useAppStore((state) => state.setImageModel);
  const selectVideoModel = useAppStore((state) => state.selectVideoModel);
  const setComfyWorkflow = useAppStore((state) => state.setComfyWorkflow);
  const comfyWorkflow = useAppStore((state) => state.comfyWorkflow);
  const setComfyVideoWorkflow = useAppStore((state) => state.setComfyVideoWorkflow);
  const comfyVideoWorkflow = useAppStore((state) => state.comfyVideoWorkflow);
  const setReasoningEffort = useAppStore((state) => state.setReasoningEffort);
  const reasoningEffort = useAppStore((state) => state.reasoningEffort);
  const { providers, loading, error } = useMcpProviders();
  const [mcpCatalog, setMcpCatalog] = useState<McpModelCatalog>(EMPTY_CATALOG);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRetryToken, setCatalogRetryToken] = useState(0);
  const [modelsLoading, setModelsLoading] = useState(false);
  const laneSnapshot = useLaneCatalog();
  const laneCatalog = laneSnapshot.catalog ?? {};
  const comfyLane = laneCatalog.comfy?.models ?? { image: [], video: [] };

  useEffect(() => {
    hydrateMcpSelectionImpl(useAppStore.setState, useAppStore.getState);
  }, []);

  const selectedMcpRecord = mcpProvider
    ? providers.find((entry) => entry.id === mcpProvider) ?? null
    : null;
  const mcpSelectionAvailable = Boolean(
    selectedMcpRecord?.enabled &&
    selectedMcpRecord.status.state === "connected",
  );

  useEffect(() => {
    if (!mcpProvider || !mcpSelectionAvailable) {
      setMcpCatalog(EMPTY_CATALOG);
      setCatalogError(false);
      return;
    }
    const controller = new AbortController();
    setModelsLoading(true);
    setCatalogError(false);
    void getMcpModelCatalog(mcpProvider, controller.signal)
      .then((catalog) => {
        if (controller.signal.aborted) return;
        setMcpCatalog(catalog);
        const state = useAppStore.getState();
        const entries = state.mcpMediaKind === "video" ? catalog.video : catalog.image;
        const selected = entries.find((entry) => entry.id === state.mcpModel);
        if (selected) reconcileMcpPresetStateImpl(selected.capabilities, useAppStore.setState, useAppStore.getState);
      })
      .catch((cause) => {
        if ((cause as { name?: string }).name === "AbortError") return;
        if (!controller.signal.aborted) {
          setMcpCatalog(EMPTY_CATALOG);
          setCatalogError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setModelsLoading(false);
      });
    return () => controller.abort();
  }, [mcpProvider, mcpSelectionAvailable, catalogRetryToken]);

  const connectedMcpProviders = useMemo(
    () => providers.filter((entry) => entry.enabled && entry.status.state === "connected"),
    [providers],
  );
  const providerValue = mcpProvider ? `${MCP_PREFIX}${mcpProvider}` : `${CORE_PREFIX}${provider}`;
  const coreModels = getImageModelOptionsForProvider(provider);
  // An offline workflow stays listed but unselectable: removing it reads as
  // "my workflow disappeared", while leaving it live would start a generation
  // that is guaranteed to fail.
  const comfyImageWorkflows = provider === "comfy"
    ? comfyLane.image.map((entry: ComfyLaneModel) => ({
      id: entry.id,
      label: entry.description?.endsWith("(offline)") ? `${entry.label} — ${t("comfy.statusOffline")}` : entry.label,
      disabled: laneSnapshot.phase !== "ready"
        || laneCatalog.comfy?.status !== "ready"
        || !isComfyModelAvailable(entry),
      reason: entry.lockReason,
    }))
    : [];
  const comfyVideoWorkflows = provider === "comfy"
    ? comfyLane.video.map((entry: ComfyLaneModel) => ({
      id: entry.id,
      label: entry.description?.endsWith("(offline)") ? `${entry.label} — ${t("comfy.statusOffline")}` : entry.label,
      // No invented reason: if the server does not lock the row, there is
      // nothing to explain. Offline is a separate, real condition below.
      reason: entry.lockReason,
      disabled: laneSnapshot.phase !== "ready"
        || laneCatalog.comfy?.status !== "ready"
        || !isComfyModelAvailable(entry),
    }))
    : [];
  // Lane-gated: a value the current lane does not list would render the trigger
  // with no label at all (Select falls back to ""), which is what a leftover
  // comfy video workflow used to do under GPT.
  const coreModelValue = resolveCoreModelValue({
    provider,
    imageModel,
    videoModel,
    comfyWorkflow,
    comfyVideoWorkflow,
  });
  // The trigger must carry the lane too (see LANE_PREFIX): coreModelValue is
  // the bare model id on image lanes, which would match the first hinted row
  // regardless of the current lane.
  const modelValue = mcpProvider
    ? (mcpModel ? encodeMcpModelValue(mcpMediaKind, mcpModel) : "")
    : coreModelValue === imageModel && coreModels.some((option) => option.value === imageModel && "providerHint" in option && option.providerHint === provider)
      ? `${LANE_PREFIX}${provider}:${imageModel}`
      : coreModelValue;
  const isGptFamily = !mcpProvider && (provider === "oauth" || provider === "api") && !videoModel;
  const mcpModelKnown = Boolean(
    mcpModel && (
      mcpCatalog.image.some((entry) => entry.id === mcpModel) ||
      mcpCatalog.video.some((entry) => entry.id === mcpModel)
    ),
  );

  // Execution lock comes from the server record, not a provider-id hardcode (260723).
  const lockedNotice = selectedMcpRecord?.executable === false
    ? (selectedMcpRecord.lockReason ?? t("mcp.higgsfieldLocked"))
    : null;
  const unavailableReason = !mcpProvider
    ? null
    : !selectedMcpRecord
      ? t("mcp.unknownProvider", { provider: mcpProvider })
      : selectedMcpRecord.status.state !== "connected"
        ? t("mcp.disconnectedSelection")
        : !selectedMcpRecord.enabled
          ? t("mcp.disabledProvider")
          : null;

  const onProviderChange = (value: string) => {
    if (value.startsWith(CORE_PREFIX)) {
      const laneId = value.slice(CORE_PREFIX.length);
      // Guard the cast: Provider is a generated literal union, and an id the
      // label map does not know is one setProviderImpl cannot route either.
      if (!KNOWN_PROVIDER_LABELS.has(laneId)) return;
      setProvider(laneId as Provider);
      return;
    }
    const next = value.slice(MCP_PREFIX.length);
    const record = providers.find((entry) => entry.id === next);
    if (!record || record.status.state !== "connected") return;
    applyMcpProvider(next);
  };

  const onModelChange = (value: string) => {
    const current = useAppStore.getState();
    if (current.provider !== provider || (current.mcpProvider ?? null) !== mcpProvider) return;
    const currentSnapshot = getLaneCatalogSnapshot();
    if (current.mcpProvider) {
      if (value.startsWith(COMFY_VIDEO_PREFIX)) return;
      const parsed = parseMcpModelValue(value);
      if (parsed) {
        const entries = parsed.kind === "video" ? mcpCatalog.video : mcpCatalog.image;
        const entry = entries.find((candidate) => candidate.id === parsed.model);
        applyMcpModelWithKind(parsed.model, parsed.kind, entry?.capabilities);
      }
      else applyMcpModel(value || null);
      return;
    }
    if (current.provider === "comfy") {
      const video = value.startsWith(COMFY_VIDEO_PREFIX);
      const id = video ? value.slice(COMFY_VIDEO_PREFIX.length) : value;
      const display = deriveComfyDisplay(currentSnapshot, video
        ? { comfyVideoWorkflow: id }
        : { comfyWorkflow: id });
      if (!display.selectedAvailable) return;
      if (video) setComfyVideoWorkflow(id);
      else setComfyWorkflow(id || null);
      return;
    }
    if (value.startsWith(COMFY_VIDEO_PREFIX)) return;
    if (value.startsWith(EFFORT_PREFIX)) {
      setReasoningEffort(value.slice(EFFORT_PREFIX.length) as ReasoningEffort);
      return;
    }
    if (value.startsWith(VIDEO_PREFIX)) {
      selectVideoModel(value.slice(VIDEO_PREFIX.length));
      return;
    }
    if (value.startsWith(LANE_PREFIX)) {
      const sep = value.indexOf(":", LANE_PREFIX.length);
      if (sep > LANE_PREFIX.length) {
        const lane = value.slice(LANE_PREFIX.length, sep);
        if (!KNOWN_PROVIDER_LABELS.has(lane)) return;
        // Same routing as the settings dropdown: switch lane first so the
        // provider change cannot coerce the model to a lane default.
        setProvider(lane as Provider);
        setImageModel(value.slice(sep + 1) as Parameters<typeof setImageModel>[0]);
      }
      return;
    }
    setImageModel(value as Parameters<typeof setImageModel>[0]);
  };

  const catalogLaneIds = Object.keys(laneCatalog).filter((id) => !MCP_OWNED_LANES.has(id));
  const coreLaneIds = catalogLaneIds.length > 0
    ? catalogLaneIds
    : CORE_PROVIDER_OPTIONS.map((option) => option.value as string);
  if (!coreLaneIds.includes("comfy")) coreLaneIds.push("comfy");
  const providerGroups: SelectGroup<string>[] = [
    {
      label: t("mcp.coreProviders"),
      items: coreLaneIds.map((laneId) => {
        const lane = laneCatalog[laneId];
        const known = KNOWN_PROVIDER_LABELS.get(laneId);
        const badge = lane ? laneStatusBadge(lane.status, t) : null;
        return {
          value: `${CORE_PREFIX}${laneId}`,
          label: known ?? displayProviderId(laneId),
          ...(badge ? { sub: badge } : {}),
          ...(lane?.reason ? { title: lane.reason } : {}),
          // A lane the client has no label for is also a lane the store cannot
          // route: Provider is a generated union and setProviderImpl has no
          // branch for it. Showing it disabled beats hiding it (the user can
          // see their server grew a lane) and beats enabling it (which would
          // pin a GPT model to it and revert on reload).
          ...(known ? {} : { disabled: true }),
        };
      }),
    },
  ];
  if (connectedMcpProviders.length > 0) {
    providerGroups.push({
      label: t("mcp.connectedProviders"),
      items: connectedMcpProviders.map((entry) => ({
        value: `${MCP_PREFIX}${entry.id}`,
        label: displayProviderId(entry.id),
        sub: entry.executable === false ? t("mcp.locked") : undefined,
      })),
    });
  }
  if (mcpProvider && !connectedMcpProviders.some((entry) => entry.id === mcpProvider)) {
    providerGroups.push({
      items: [{
        value: `${MCP_PREFIX}${mcpProvider}`,
        label: displayProviderId(mcpProvider),
        sub: t("mcp.unavailable"),
        disabled: true,
      }],
    });
  }

  const modelGroups: SelectGroup<string>[] = [];
  if (mcpProvider) {
    if (mcpModel && !mcpModelKnown) {
      modelGroups.push({
        items: [{ value: encodeMcpModelValue(mcpMediaKind, mcpModel), label: mcpModel }],
      });
    }
    modelGroups.push({
      label: t("mcp.imageModels"),
      items: mcpCatalog.image.map((entry) => ({
        value: encodeMcpModelValue("image", entry.id),
        label: entry.label,
      })),
    });
    modelGroups.push({
      label: t("mcp.videoModels"),
      items: mcpCatalog.video.map((entry) => ({
        value: encodeMcpModelValue("video", entry.id),
        label: entry.label,
      })),
    });
  } else {
    // Whether this lane does video is the catalog's answer, not a hardcoded
    // list. The Grok rows below stay gated to the Grok lanes on purpose: they
    // route through selectVideoModel, which normalizes to a Grok id, so
    // offering them under another lane would silently switch the provider.
    // Comfy has its own group and its own prefix for exactly that reason.
    const laneVideoCount = laneCatalog[provider]?.models.video.length ?? 0;
    const providerSupportsVideo = (provider === "grok" || provider === "grok-api") && laneVideoCount > 0;
    modelGroups.push({
      label: t("mcp.imageModels"),
      // Comfy models are registered workflows, so they come from the live
      // /api/models catalog rather than the generated static list — the same
      // runtime-catalog path the MCP lanes above already use. getImageModel
      // OptionsForProvider returns [] for comfy precisely so this branch is
      // the only source, instead of GPT rows leaking in under a ComfyUI
      // selection.
      items: provider === "comfy"
        ? comfyImageWorkflows.map((entry) => ({
          value: entry.id,
          label: entry.label,
          sub: entry.reason,
          ...(entry.disabled ? { disabled: true } : {}),
        }))
        : coreModels.map((option) => ({
          value: "providerHint" in option && option.providerHint ? `${LANE_PREFIX}${option.providerHint}:${option.value}` : option.value,
          label: option.shortLabel,
        })),
    });
    if (provider === "comfy" && comfyVideoWorkflows.length > 0) {
      modelGroups.push({
        label: t("mcp.videoModels"),
        items: comfyVideoWorkflows.map((entry) => ({
          value: `${COMFY_VIDEO_PREFIX}${entry.id}`,
          label: entry.label,
          // Stacked regardless of the reason line: workflow names are
          // user-chosen and routinely outrun the 300px portal, and this is what
          // lets the label wrap instead of truncating mid-word.
          stacked: true,
          ...(entry.reason ? { sub: t("comfy.videoCatalogShort"), title: entry.reason } : {}),
          ...(entry.disabled ? { disabled: true } : {}),
        })),
      });
    }
    if (providerSupportsVideo || videoModel) {
      modelGroups.push({
        label: t("mcp.videoModels"),
        items: VIDEO_MODEL_OPTIONS.map((option) => ({
          value: `${VIDEO_PREFIX}${option.value}`,
          label: option.shortLabel,
        })),
      });
    }
    if (isGptFamily) {
      modelGroups.push({
        label: t("sidebar.reasoningLabel"),
        items: REASONING_EFFORT_OPTIONS.map((option) => ({
          value: `${EFFORT_PREFIX}${option.value}`,
          label: option.shortLabel,
          sub: option.value === reasoningEffort ? "●" : undefined,
        })),
      });
    }
    const listedValues = new Set(modelGroups.flatMap((group) => group.items.map((item) => item.value)));
    if (coreModelValue && !listedValues.has(coreModelValue)) {
      modelGroups.unshift({
        items: [{
          value: coreModelValue,
          label: coreModelValue.includes(":") ? coreModelValue.split(":").slice(1).join(":") : coreModelValue,
          title: t("mcp.unavailable"),
          ...(provider === "comfy" ? { disabled: true } : {}),
        }],
      });
    }
  }

  const currentEffort = REASONING_EFFORT_OPTIONS.find((option) => option.value === reasoningEffort);
  const comfyDisplay = provider === "comfy" && !mcpProvider
    ? deriveComfyDisplay(laneSnapshot, { comfyWorkflow, comfyVideoWorkflow })
    : null;
  const comfyCatalogMessage = comfyDisplay
    ? t(comfyDisplayMessageKey(comfyDisplay, laneSnapshot))
    : null;

  return (
    <div
      className={`image-model-select image-model-select--sidebar gen-provider-model${compact ? " is-compact" : ""}`}
    >
      <Select
        id="sidebar-generation-provider"
        className="gen-provider-model__select gen-provider-model__select--provider"
        groups={providerGroups}
        value={providerValue}
        onChange={onProviderChange}
        ariaLabel={t("mcp.providerLabel")}
        title={unavailableReason ?? t("mcp.providerLabel")}
        // The closed control says which lane is selected, not why another one
        // cannot run. State belongs in the open list, where it informs the
        // choice; on the trigger it would just crowd a control that is already
        // narrow enough to truncate.
        triggerSub=""
        portal
      />

      <Select
        id="sidebar-generation-model"
        className="gen-provider-model__select gen-provider-model__select--model"
        groups={modelGroups}
        value={modelValue}
        onChange={onModelChange}
        ariaLabel={t("mcp.modelLabel")}
        title={unavailableReason ?? t("mcp.modelLabel")}
        disabled={Boolean(unavailableReason)}
        placeholder={mcpProvider
          ? (modelsLoading ? t("mcp.loadingModels") : t("mcp.chooseModel"))
          : provider === "comfy" ? t("mcp.chooseModel") : undefined}
        triggerSub={isGptFamily && currentEffort ? currentEffort.shortLabel : undefined}
        portal
      />

      {(unavailableReason || lockedNotice || error || catalogError || comfyCatalogMessage) ? (
        <span className={comfyDisplay ? "gen-provider-model__catalog-state" : "image-model-select__trigger-effort"} role="status">
          {comfyDisplay && comfyCatalogMessage ? (
            <>
              <span>{comfyCatalogMessage}</span>
              {laneSnapshot.phase === "error" ? <button type="button" className="image-model-select__retry" onClick={() => void laneSnapshot.refresh()}>{t("comfy.display.refresh")}</button> : null}
            </>
          ) : (unavailableReason
            ?? lockedNotice
            ?? (catalogError ? (
              <button
                type="button"
                className="image-model-select__retry"
                onClick={() => setCatalogRetryToken((token) => token + 1)}
              >
                {t("mcp.modelsLoadFailed")}
              </button>
            ) : (loading ? t("mcp.loadingProviders") : t("mcp.providersLoadFailed"))))}
        </span>
      ) : null}
    </div>
  );
}
