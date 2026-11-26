import { useEffect, useMemo, useState } from "react";
import { chooseRoute, type WorkflowDef, type WorkflowEstimate, type WorkflowRunBody } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import type { SlotValue } from "../../ui/UploadSlot.tsx";

function useWorkflowForm(def: WorkflowDef) {
  const [files, setFiles] = useState<Record<string, SlotValue[]>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [params, setParams] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(def.params.filter((p) => p.default !== undefined).map((p) => [p.name, p.default!])),
  );
  const [steps, setSteps] = useState<Record<string, { model: string }>>({});
  const body = useMemo<WorkflowRunBody>(
    () => ({
      inputs: Object.fromEntries(
        def.inputs.map((input) => [
          input.name,
          input.kind === "text"
            ? (texts[input.name] ?? "")
            : (files[input.name] ?? []).map((file) => ({
                role: file.role,
                inputId: file.upload.inputId,
              })),
        ]),
      ),
      params,
      steps,
    }),
    [def, files, texts, params, steps],
  );
  const missing = def.inputs.filter(
    (input) => input.required && (input.kind === "text" ? !texts[input.name]?.trim() : !files[input.name]?.length),
  );
  return { files, setFiles, texts, setTexts, params, setParams, steps, setSteps, body, missing };
}

function useWorkflowEstimate(def: WorkflowDef, body: WorkflowRunBody) {
  const studio = useStudioApi();
  const [estimate, setEstimate] = useState<WorkflowEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setEstimate(null);
    setEstimateError(null);
    if (def.inputs.some((input) => input.required && !body.inputs[input.name]?.length)) return;
    const timer = setTimeout(() => {
      void studio.client.workflows.estimate(def.id, body).then(
        (value) => {
          if (current) setEstimate(value);
        },
        (err: unknown) => {
          if (current) setEstimateError(err instanceof Error ? err.message : "Could not estimate price");
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [studio, def, body]);
  return { estimate, estimateError };
}

function useWorkflowRun(def: WorkflowDef, body: WorkflowRunBody) {
  const studio = useStudioApi();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const submit = async () => {
    setError(null);
    setSending(true);
    try {
      await studio.runWorkflow(def.id, { ...body, clientRequestId: crypto.randomUUID() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start workflow");
    } finally {
      setSending(false);
    }
  };
  return { error, setError, sending, submit };
}

export function useWorkflow(def: WorkflowDef) {
  const studio = useStudioApi();
  const catalog = useStudio((s) => s.catalog);
  const form = useWorkflowForm(def);
  const estimate = useWorkflowEstimate(def, form.body);
  const run = useWorkflowRun(def, form.body);
  const choices = def.steps.flatMap((step) => {
    const id = form.steps[step.id]?.model ?? step.model;
    if (!id) return [];
    const model = catalog?.models.find((item) => item.id === id);
    return [{ step, model, choice: model ? chooseRoute(model) : null }];
  });
  const blocked =
    !catalog ||
    choices.some((item) => !item.choice || item.choice.kind === "needs-key" || item.choice.kind === "unavailable");
  return { studio, catalog, ...form, ...estimate, ...run, blocked, choices };
}
export type WorkflowForm = ReturnType<typeof useWorkflow>;
