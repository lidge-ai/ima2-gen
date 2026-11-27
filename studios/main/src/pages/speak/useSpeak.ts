import { useEffect, useState } from "react";
import { StudioApiError, estimateCost, formatUsd, type Catalog, type CatalogModel, type MediaInputRole, type TalkingTask } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { syncModelToUrl } from "../../studio/draft.ts";
import { spendBlock } from "../../studio/spend.ts";
import { useLocalCost } from "../../ui/localCost.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { availableTasks, defaultModel, defaultOptions, emptyState, problem, resolve, seconds, toBody, type SpeakState } from "./speakForm.ts";

/** Length of an uploaded audio or video file as the browser reads it; null when it cannot. */
export function mediaSeconds(url: string, kind: "audio" | "video"): Promise<number | null> {
  return new Promise((done) => {
    const element = document.createElement(kind);
    element.preload = "metadata";
    element.onloadedmetadata = () => done(Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null);
    element.onerror = () => done(null);
    element.src = url;
  });
}

/** The task a deep-linked model is for, else the first tool this catalog can run. */
function startTask(catalog: Catalog, requested: string | undefined): TalkingTask | undefined {
  const tasks = availableTasks(catalog);
  const asked = catalog.models.find((m) => m.id === requested);
  return tasks.find((task) => asked?.tasks.includes(task)) ?? tasks[0];
}

/** Picks a model and resets what belongs to the previous route: its resolution and options. Files stay. */
function withModel(state: SpeakState, model: CatalogModel | undefined, provider = ""): SpeakState {
  const next = { ...state, model: model?.id, provider };
  const { form } = resolve(model, next);
  return { ...next, resolution: form?.resolutions[0], options: form ? defaultOptions(form) : {} };
}

export function useSpeak(catalog: Catalog, requested: string | undefined) {
  const studio = useStudioApi();
  const webSpend = useStudio((s) => s.webSpend);
  const [state, setState] = useState<SpeakState>(() => {
    const task = startTask(catalog, requested) ?? "lipsync";
    return withModel(emptyState(task), defaultModel(catalog, task, requested));
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => syncModelToUrl("video", state.model), [state.model]);

  const model = catalog.models.find((m) => m.id === state.model);
  const { choice, form } = resolve(model, state);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const priced = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const billed = seconds(form, state);
  const quote = priced && billed !== null
    ? estimateCost(priced.pricing, { durationSec: billed, ...(state.resolution ? { resolution: state.resolution } : {}) })
    : null;
  // A ComfyUI workflow on this computer: run time instead of a price.
  const local = useLocalCost(model, route, () => (model && form && route ? toBody(model, form, state, route.providerId) : null));
  const missing = problem(model, form, state);
  // A shared web instance runs only what it can price, so an unmeasured length is named before sending.
  const blocked = missing ?? (route && webSpend && model ? spendBlock(webSpend, [{ label: model.label, usd: quote?.usd ?? null }], quote?.usd ?? null) : null);

  const setFile = (role: MediaInputRole, value: SlotValue | null) => {
    setState((s) => {
      const { [role]: _file, ...files } = s.files;
      const { [role]: _length, ...lengths } = s.lengths;
      return { ...s, files: value ? { ...files, [role]: value } : files, lengths };
    });
    const kind = value?.upload.mimeType.startsWith("audio/") ? "audio" : value?.upload.mimeType.startsWith("video/") ? "video" : null;
    if (!value || !kind) return;
    void mediaSeconds(value.upload.url, kind).then((length) => {
      // Only for the file that is still in the slot.
      setState((s) => (s.files[role]?.upload.inputId === value.upload.inputId ? { ...s, lengths: { ...s.lengths, [role]: length } } : s));
    });
  };
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
    state, model, form, choice, route, priced, billed, blocked, sending, error, local,
    cost: quote ? formatUsd(quote) : null,
    canSend: !!route && !blocked && !sending,
    setTask: (task: TalkingTask) => setState((s) => withModel({ ...s, task }, defaultModel(catalog, task))),
    pickModel: (id: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === id))),
    pickRoute: (provider: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === s.model), provider)),
    setResolution: (resolution: string) => setState((s) => ({ ...s, resolution })),
    setOption: (name: string, value: string | boolean) => setState((s) => ({ ...s, options: { ...s.options, [name]: value } })),
    setFile,
    submit,
  };
}
