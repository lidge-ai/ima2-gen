import { useEffect, useMemo, useState } from "react";
import { chooseRoute, StudioApiError, type WorkflowDef, type WorkflowEstimate, type WorkflowRunBody } from "@ima2/studio-kit";
import { messages, tr } from "../../i18n.ts";
import { useStudio, useStudioApi } from "../../studio/context.tsx";
import type { SlotValue } from "../../ui/UploadSlot.tsx";
import { spendBlock } from "../../studio/spend.ts";
import { newCut, totalSec, type Cut } from "../director/cutList.ts";

const M = messages({ estimate: "Could not estimate price", start: "Could not start workflow", shot: "Shot {n}" }, { estimate: "예상 비용을 계산하지 못했어요", start: "워크플로를 시작하지 못했어요", shot: "샷 {n}" });

/** The single length a cut list replaces; the server refuses both together. */
const LENGTH = "duration";

function useWorkflowForm(def: WorkflowDef) {
  const [files, setFiles] = useState<Record<string, SlotValue[]>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [params, setParams] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries(def.params.filter((p) => p.default !== undefined).map((p) => [p.name, p.default!])),
  );
  const [steps, setSteps] = useState<Record<string, { model: string }>>({});
  // The cut list is kept while it is switched off, so going back to it loses nothing.
  const [cutting, setCutting] = useState(false);
  const [cuts, setCuts] = useState<Cut[]>(() => [newCut(), newCut()]);
  const useCuts = !!def.shots && cutting;
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
      params: useCuts ? Object.fromEntries(Object.entries(params).filter(([name]) => name !== LENGTH)) : params,
      steps,
      ...(useCuts ? { shots: cuts.map((cut) => ({ prompt: cut.prompt, durationSec: cut.durationSec })) } : {}),
    }),
    [def, files, texts, params, steps, useCuts, cuts],
  );
  // "Required unless X": X is the cut list, or another input that is still empty.
  const given = (name: string) => (name === def.shots?.name ? useCuts : !!texts[name]?.trim() || !!files[name]?.length);
  const needed = (input: WorkflowDef["inputs"][number]) => input.required || (!!input.requiredUnless && !given(input.requiredUnless));
  const missing: { name: string; label: string }[] = [
    ...def.inputs.filter((input) => needed(input) && (input.kind === "text" ? !texts[input.name]?.trim() : !files[input.name]?.length)),
    ...(useCuts ? cuts.flatMap((cut, i) => (cut.prompt.trim() ? [] : [{ name: "shot-" + cut.id, label: tr(M, "shot", { n: i + 1 }) }])) : []),
  ];
  const cutsOver = useCuts && !!def.shots && totalSec(cuts) > def.shots.maxTotalSec;
  return { files, setFiles, texts, setTexts, params, setParams, steps, setSteps, body, missing, needed, cutting: useCuts, setCutting, cuts, setCuts, cutsOver };
}

/**
 * The server refuses an estimate with WORKFLOW_INPUT_INVALID and no field when a rule across fields is
 * not met yet (restyle: a style or a style reference). That is the next thing to fill in, not a failure.
 */
function needsMoreInput(err: unknown): string | null {
  if (!(err instanceof StudioApiError) || err.status !== 400 || err.code !== "WORKFLOW_INPUT_INVALID") return null;
  const field = (err.details as { field?: unknown } | undefined)?.field;
  // A cut list the chosen model cannot make (a shot too long for it) is also something to change, not a failure.
  if (field === "shots") return err.message.replace(/^shots: /, "");
  return field === undefined ? err.message : null;
}

function useWorkflowEstimate(def: WorkflowDef, body: WorkflowRunBody, ready: boolean) {
  const studio = useStudioApi();
  const [estimate, setEstimate] = useState<WorkflowEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [inputNeeded, setInputNeeded] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setEstimate(null);
    setEstimateError(null);
    setInputNeeded(null);
    if (!ready) return;
    const timer = setTimeout(() => {
      void studio.client.workflows.estimate(def.id, body).then(
        (value) => {
          if (current) setEstimate(value);
        },
        (err: unknown) => {
          if (!current) return;
          const reason = needsMoreInput(err);
          if (reason !== null) setInputNeeded(reason);
          else setEstimateError(err instanceof Error ? err.message : tr(M, "estimate"));
        },
      );
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [studio, def, body, ready]);
  return { estimate, estimateError, inputNeeded };
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
      setError(err instanceof Error ? err.message : tr(M, "start"));
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
  const estimate = useWorkflowEstimate(def, form.body, form.missing.length === 0 && !form.cutsOver);
  const run = useWorkflowRun(def, form.body);
  // What the server planned for a slot: steps name their slot; older servers only by id ("subject-first").
  const planned = (slot: string) =>
    estimate.estimate?.steps.find((s) => s.model && (s.slot ? s.slot === slot : s.id === slot || s.id.startsWith(slot + "-")))?.model;
  // Before an estimate exists (inputs missing), the server already says which models can run here.
  const runnable = (slot: string) => {
    const step = def.steps.find((s) => s.id === slot);
    if (!step?.runnable || !step.model) return undefined;
    if (step.runnable[step.model]) return step.model;
    return (step.modelChoices ?? []).find((m) => step.runnable?.[m]);
  };
  /** The model a slot runs: the person's choice, else the server's plan, else what can run here, else the default. */
  const slotModel = (slot: string, fallback?: string) => form.steps[slot]?.model ?? planned(slot) ?? runnable(slot) ?? fallback;
  const choices = def.steps.flatMap((step) => {
    const id = slotModel(step.id, step.model);
    if (!id) return [];
    const model = catalog?.models.find((item) => item.id === id);
    return [{ step, model, choice: model ? chooseRoute(model) : null, available: step.available?.[id] }];
  });
  const webSpend = useStudio((s) => s.webSpend);
  const quote = estimate.estimate;
  // A shared web instance refuses unpriced or over-limit runs; say so before Generate is pressed.
  const spendReason = quote
    ? spendBlock(
        webSpend,
        quote.steps.map((s) => ({ label: def.steps.find((d) => d.id === s.id)?.label ?? s.label ?? s.id, usd: s.estimate.usd })),
        quote.total.usd,
      )
    : null;
  const blocked =
    !catalog ||
    !!spendReason ||
    form.cutsOver ||
    estimate.inputNeeded !== null ||
    choices.some(
      (item) =>
        item.available === false ||
        (item.available === undefined &&
          (!item.choice || item.choice.kind === "needs-key" || item.choice.kind === "unavailable")),
    );
  return { def, studio, catalog, ...form, ...estimate, ...run, blocked, choices, spendReason, slotModel };
}
export type WorkflowForm = ReturnType<typeof useWorkflow>;
