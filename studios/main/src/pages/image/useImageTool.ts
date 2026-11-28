import { useEffect, useState } from "react";
import { StudioApiError, imageRoutes, type Catalog, type CatalogModel, type ImageTask } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import { syncModelToUrl } from "../../studio/draft.ts";
import { spendBlock } from "../../studio/spend.ts";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { quoteText, useServerQuote } from "../../ui/quote.ts";
import { defaultModel, emptyState, problem, resolve, toBody, withForm, type ToolState } from "./imageState.ts";

/** Picks a model and route, and resets the settings that belong to the previous route. The images and prompt stay. */
function withModel(state: ToolState, model: CatalogModel | undefined, provider = ""): ToolState {
  const next = { ...state, model: model?.id, provider };
  return withForm(next, resolve(model, next).form);
}

/** active: the tool is the form on screen; only then does its model go to the address. */
export function useImageTool(catalog: Catalog, tool: ImageTask, requested: string | undefined, active: boolean) {
  const studio = useStudioApi();
  const webSpend = useStudio((s) => s.webSpend);
  const [state, setState] = useState<ToolState>(() => withModel(emptyState(tool), defaultModel(catalog, tool, requested)));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The page owns which tool is open; images and the prompt carry over, the model and its settings follow the tool.
  useEffect(() => {
    setState((s) => (s.tool === tool ? s : withModel({ ...s, tool }, defaultModel(catalog, tool, requested))));
  }, [catalog, tool, requested]);
  useEffect(() => { if (active) syncModelToUrl("image", state.model); }, [state.model, active]);

  const model = catalog.models.find((m) => m.id === state.model);
  const { choice, form } = resolve(model, state);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const priced = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const missing = problem(model, form, state);
  // The server prices the request this tool would send (also the route a key would use, before it is added).
  const quote = useServerQuote(model && form && priced && state.images.length <= form.max ? toBody(model, form, state, priced.providerId) : null);
  const cost = quoteText(quote);
  const blocked = missing ?? (route && webSpend && model && !quote.pending ? spendBlock(webSpend, [{ label: model.label, usd: cost.usd }], cost.usd) : null);

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
    state, model, form, choice, route, blocked, sending, error, cost,
    routes: model ? imageRoutes(model, state.tool) : [],
    canSend: !!route && !blocked && !sending && !(webSpend && quote.pending),
    pickModel: (id: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === id))),
    pickRoute: (provider: string) => setState((s) => withModel(s, catalog.models.find((m) => m.id === s.model), provider)),
    set: (patch: Partial<Pick<ToolState, "prompt" | "resolution" | "aspectRatio" | "quality" | "count">>) => setState((s) => ({ ...s, ...patch })),
    addImages: (values: readonly SlotValue[]) => setState((s) => ({ ...s, images: [...s.images, ...values] })),
    // The mask was painted on the first image; it goes when that image does.
    removeImage: (inputId: string) => setState((s) => ({
      ...s, images: s.images.filter((image) => image.upload.inputId !== inputId),
      mask: s.images[0]?.upload.inputId === inputId ? null : s.mask,
    })),
    setMask: (mask: SlotValue | null) => setState((s) => ({ ...s, mask })),
    submit,
  };
}
