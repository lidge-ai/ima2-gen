import { useEffect, useState } from "react";
import { StudioApiError, estimateCost, formatUsd, type Catalog, type CatalogModel, type MediaVoice } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { spendBlock } from "../../studio/spend.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { mediaSeconds } from "../speak/useSpeak.ts";
import {
  availableTools, chooseToolRoute, defaultModel, emptyState, lengthRange, priced, problem, startSeconds, toBody, toolRoutes,
  type AudioState, type AudioTool,
} from "./audioForm.ts";

/** The tool a deep-linked model belongs to, else the first one this catalog can run. */
function startTool(catalog: Catalog, requested: string | undefined, wanted: string | undefined): AudioTool {
  const tools = availableTools(catalog);
  const asked = catalog.models.find((m) => m.id === requested);
  return tools.find((tool) => tool === wanted) ?? tools.find((tool) => asked && toolRoutes(asked, tool).length > 0) ?? tools[0] ?? "speech";
}

/** Picks a model and resets what belongs to the previous route: its voice, length and switches. The text stays. */
function withModel(state: AudioState, model: CatalogModel | undefined, provider = ""): AudioState {
  const next: AudioState = { ...state, model: model?.id, provider, voice: null, switches: {} };
  const choice = chooseToolRoute(model, next);
  const route = choice.kind === "unavailable" ? undefined : choice.route;
  return { ...next, seconds: model && route ? startSeconds(lengthRange(model, route.providerId, next.tool)) : "" };
}

function syncAddress(tool: AudioTool, model: string | undefined): void {
  const [path = ""] = location.hash.replace(/^#\/?/, "").split("?");
  if (path.split("/")[0] !== "audio") return;
  const params = new URLSearchParams({ tool, ...(model ? { model } : {}) });
  history.replaceState(history.state, "", "#/audio?" + params.toString());
}

export function useAudio(catalog: Catalog, requested: { tool?: string; model?: string }) {
  const studio = useStudioApi();
  const webSpend = useStudio((s) => s.webSpend);
  const [state, setState] = useState<AudioState>(() => {
    const tool = startTool(catalog, requested.model, requested.tool);
    return withModel(emptyState(tool), defaultModel(catalog, tool, requested.model));
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => syncAddress(state.tool, state.model), [state.tool, state.model]);

  const model = catalog.models.find((m) => m.id === state.model);
  const choice = chooseToolRoute(model, state);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const shown = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const amount = model && shown ? priced(model, shown, state) : {};
  const quote = shown ? estimateCost(shown.pricing, amount) : null;
  const missing = problem(model, shown, state);
  // A shared web instance runs only what it can price, so the reason is given before sending.
  const blocked = missing ?? (route && webSpend && model ? spendBlock(webSpend, [{ label: model.label, usd: quote?.usd ?? null }], quote?.usd ?? null) : null);

  const setVideo = (video: SlotValue | null) => {
    setState((s) => ({ ...s, video, videoSeconds: undefined }));
    if (!video) return;
    void mediaSeconds(video.upload.url, "video").then((length) => {
      setState((s) => (s.video?.upload.inputId === video.upload.inputId ? { ...s, videoSeconds: length } : s));
    });
  };
  const submit = async () => {
    if (!model || !route || blocked) return;
    setSending(true);
    setError(null);
    try {
      await studio.submit(toBody(model, route, state));
    } catch (err) {
      setError(err instanceof StudioApiError ? err.message + " (" + err.code + ")" : String(err));
    } finally {
      setSending(false);
    }
  };
  return {
    state, model, choice, route, shown, blocked, sending, error,
    cost: quote && quote.usd !== null ? formatUsd(quote) : null,
    canSend: !!route && !blocked && !sending,
    setTool: (tool: AudioTool) => setState((s) => withModel({ ...s, tool }, defaultModel(catalog, tool))),
    pickModel: (id: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === id))),
    pickRoute: (provider: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === s.model), provider)),
    setText: (text: string) => setState((s) => ({ ...s, text })),
    setVoice: (voice: MediaVoice) => setState((s) => ({ ...s, voice })),
    setSeconds: (seconds: string) => setState((s) => ({ ...s, seconds: seconds.replace(/[^0-9.]/g, "") })),
    toggle: (name: string) => setState((s) => ({ ...s, switches: { ...s.switches, [name]: !s.switches[name] } })),
    setVideo,
    submit,
  };
}
