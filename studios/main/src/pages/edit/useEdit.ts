import { useEffect, useState } from "react";
import { StudioApiError, editRoutes, estimateCost, formatUsd, type Catalog, type CatalogModel, type EditTask } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { syncModelToUrl } from "../../studio/draft.ts";
import { spendBlock } from "../../studio/spend.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { mediaSeconds } from "../speak/useSpeak.ts";
import { availableTools, billedSeconds, defaultModel, emptyState, problem, resolve, toBody, withForm, type EditState } from "./editState.ts";

/** The tool a deep-linked model is for, else the first tool this catalog can run. */
function startTool(catalog: Catalog, requested: string | undefined): EditTask | undefined {
  const tools = availableTools(catalog);
  const asked = catalog.models.find((m) => m.id === requested);
  return tools.find((tool) => asked && editRoutes(asked, tool).length > 0) ?? tools[0];
}

/** Picks a model and route, and resets the settings that belong to the previous route. The video and prompt stay. */
function withModel(state: EditState, model: CatalogModel | undefined, provider = ""): EditState {
  const next = { ...state, model: model?.id, provider };
  return withForm(next, resolve(model, next).form);
}

export function useEdit(catalog: Catalog, requested: string | undefined) {
  const studio = useStudioApi();
  const webSpend = useStudio((s) => s.webSpend);
  const [state, setState] = useState<EditState>(() => {
    const tool = startTool(catalog, requested) ?? "video-to-video";
    return withModel(emptyState(tool), defaultModel(catalog, tool, requested));
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => syncModelToUrl("video", state.model), [state.model]);

  const model = catalog.models.find((m) => m.id === state.model);
  const { choice, form } = resolve(model, state);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const priced = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const billed = billedSeconds(form, state);
  const quote = priced && billed !== null
    ? estimateCost(priced.pricing, { durationSec: billed, ...(state.resolution ? { resolution: state.resolution } : {}) })
    : null;
  const missing = problem(model, form, state);
  // A shared web instance runs only what it can price, so an unmeasured length is named before sending.
  const blocked = missing ?? (route && webSpend && model ? spendBlock(webSpend, [{ label: model.label, usd: quote?.usd ?? null }], quote?.usd ?? null) : null);

  const setSource = (value: SlotValue | null) => {
    setState((s) => ({ ...s, source: value, sourceSec: undefined }));
    if (!value) return;
    void mediaSeconds(value.upload.url, "video").then((length) => {
      // Only for the file that is still in the slot.
      setState((s) => (s.source?.upload.inputId === value.upload.inputId ? { ...s, sourceSec: length } : s));
    });
  };
  const setTool = (tool: EditTask) => setState((s) => (s.tool === tool ? s : withModel({ ...s, tool }, defaultModel(catalog, tool))));
  const submit = async () => {
    if (!model || !form || !route || blocked) return;
    setSending(true);
    setError(null);
    try {
      await studio.submit(toBody(model, form, state, route.providerId));
    } catch (err) {
      setError(err instanceof StudioApiError ? err.message + " (" + err.code + ")" : String(err));
    } finally {
      setSending(false);
    }
  };
  return {
    state, model, form, choice, route, priced, billed, blocked, sending, error,
    cost: quote && quote.usd !== null ? formatUsd(quote) : null,
    canSend: !!route && !blocked && !sending,
    setTool,
    pickModel: (id: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === id))),
    pickRoute: (provider: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === s.model), provider)),
    set: (patch: Partial<Pick<EditState, "prompt" | "durationSec" | "resolution" | "aspectRatio" | "audio">>) => setState((s) => ({ ...s, ...patch })),
    setSource,
    submit,
  };
}
