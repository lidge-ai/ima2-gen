import { useState } from "react";
import { StudioApiError, type Catalog } from "@ima2/studio-kit";
import { useStudioApi } from "../../studio/context.tsx";
import { estimateLabel } from "../../ui/format.ts";
import { defaultsFor, problem, routeFor, toBody, type CreateForm } from "./form.ts";

/** Shared submit logic for the panel and the dock: route choice, cost, blocking problem, send. */
export function useCreate(catalog: Catalog, form: CreateForm, set: (patch: Partial<CreateForm>) => void) {
  const studio = useStudioApi();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = catalog.models.find((m) => m.id === form.model);
  const choice = routeFor(model, form);
  const route = choice.kind === "chosen" || choice.kind === "default" ? choice.route : undefined;
  const priced = route ?? (choice.kind === "needs-key" ? choice.route : undefined);
  const blocked = problem(model, form);
  const cost = estimateLabel(priced, form);
  const pickModel = (id: string) => {
    const next = catalog.models.find((m) => m.id === id);
    set({ model: id, provider: "", ...defaultsFor(next, form) });
  };
  const submit = async () => {
    if (!model || blocked || !route) return;
    setSending(true);
    setError(null);
    try {
      await studio.submit(toBody(model, form, form.provider || undefined));
    } catch (err) {
      setError(err instanceof StudioApiError ? err.message + " (" + err.code + ")" : String(err));
    } finally {
      setSending(false);
    }
  };
  return {
    model,
    choice,
    route,
    blocked,
    cost,
    sending,
    error,
    pickModel,
    submit,
    canSend: !!model && !blocked && !!route && !sending,
  };
}
