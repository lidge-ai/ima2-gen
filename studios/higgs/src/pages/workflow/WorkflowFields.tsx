import { formatUsd, type WorkflowDef, type WorkflowInputSpec } from "@ima2/studio-kit";
import { useState } from "react";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { WorkflowForm } from "./useWorkflow.ts";

function TextWorkflowInput({
  input,
  form,
  optionalSwitch,
}: {
  input: WorkflowInputSpec;
  form: WorkflowForm;
  optionalSwitch: boolean;
}) {
  const [enabled, setEnabled] = useState(!optionalSwitch);
  return (
    <div className="workflow-input">
      {optionalSwitch ? (
        <label className="workflow-switch">
          <span>Prompt</span>
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              if (!e.target.checked) form.setTexts((old) => ({ ...old, [input.name]: "" }));
            }}
          />
        </label>
      ) : null}
      {enabled ? (
        <label className="field">
          {input.label}
          <textarea
            rows={4}
            value={form.texts[input.name] ?? ""}
            placeholder={input.description}
            onChange={(e) =>
              form.setTexts((old) => ({
                ...old,
                [input.name]: e.target.value,
              }))
            }
          />
        </label>
      ) : null}
    </div>
  );
}

function FileWorkflowInput({ input, form }: { input: WorkflowInputSpec; form: WorkflowForm }) {
  const values = form.files[input.name] ?? [];
  const max = input.maxCount ?? 1;
  return (
    <div className="workflow-input">
      <span className="workflow-label">
        {input.label}
        {input.required ? " · Required" : " · Optional"}
      </span>
      <div className="workflow-slots">
        {Array.from({ length: Math.min(max, values.length + 1) }, (_, index) => (
          <UploadSlot
            key={index}
            label={max > 1 ? `${input.label} ${index + 1}` : input.label}
            role={input.role ?? "reference-image"}
            accept={input.accept ?? `${input.kind}/*`}
            value={values[index] ?? null}
            hint={input.description}
            onChange={(value) =>
              form.setFiles((old) => {
                const next = [...(old[input.name] ?? [])];
                if (value) next[index] = value;
                else next.splice(index, 1);
                return { ...old, [input.name]: next };
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

export function WorkflowInput({
  input,
  form,
  optionalSwitch = false,
}: {
  input: WorkflowInputSpec;
  form: WorkflowForm;
  optionalSwitch?: boolean;
}) {
  return input.kind === "text" ? (
    <TextWorkflowInput input={input} form={form} optionalSwitch={optionalSwitch} />
  ) : (
    <FileWorkflowInput input={input} form={form} />
  );
}

export function WorkflowParams({ def, form, chip = false }: { def: WorkflowDef; form: WorkflowForm; chip?: boolean }) {
  return (
    <div className="workflow-params">
      {def.params.map((param) => {
        const value = form.params[param.name] ?? param.default ?? "";
        const update = (next: string | number | boolean) => form.setParams((old) => ({ ...old, [param.name]: next }));
        if (param.type === "select")
          return (
            <SettingTile
              key={param.name}
              caption={param.label}
              variant={chip ? "chip" : "tile"}
              value={String(value)}
              options={param.options ?? []}
              onChange={update}
            />
          );
        if (param.type === "boolean")
          return (
            <label className="workflow-switch" key={param.name}>
              {param.label}
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />
            </label>
          );
        return (
          <label className="field" key={param.name}>
            {param.label}
            <input
              type={param.type}
              value={String(value)}
              min={param.min}
              max={param.max}
              step={param.step}
              onChange={(e) => update(param.type === "number" ? Number(e.target.value) : e.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}

function StepModelIcon({ id, form }: { id: string; form: WorkflowForm }) {
  return (
    <span aria-hidden="true">
      <VendorLogo id={form.catalog?.models.find((m) => m.id === id)?.vendor ?? id.split("/")[0]} />
    </span>
  );
}

export function WorkflowSteps({ def, form }: { def: WorkflowDef; form: WorkflowForm }) {
  return (
    <div className="workflow-steps">
      <h3>Steps and estimated cost</h3>
      {def.steps.map((step) => {
        const estimate = form.estimate?.steps.find((item) => item.id === step.id)?.estimate;
        return (
          <div className="workflow-step" key={step.id}>
            {step.modelChoices?.length ? (
              <SettingTile
                caption={step.label}
                value={form.steps[step.id]?.model ?? step.model ?? ""}
                options={step.modelChoices.map((id) => ({
                  value: id,
                  label: form.catalog?.models.find((m) => m.id === id)?.label ?? id,
                  icon: <StepModelIcon id={id} form={form} />,
                }))}
                onChange={(model) => form.setSteps((old) => ({ ...old, [step.id]: { model } }))}
              />
            ) : (
              <span>
                {step.label}
                {step.model ? <ModelName id={step.model} /> : null}
              </span>
            )}
            <span className="muted">
              {estimate
                ? price(estimate)
                : form.missing.length
                  ? "Add required inputs to estimate"
                  : form.estimateError
                    ? "Estimate unavailable"
                    : "Estimating"}
            </span>
          </div>
        );
      })}
      {form.choices.map(({ step, choice }) =>
        choice?.kind === "needs-key" && form.catalog ? (
          <KeyNotice key={step.id} routes={choice.candidates} providers={form.catalog.providers} />
        ) : choice?.kind === "unavailable" || !choice ? (
          <p role="alert" key={step.id}>
            Model unavailable for {step.label}
          </p>
        ) : null,
      )}
    </div>
  );
}

export function price(value: { usd: number | null; basis: string }): string {
  return value.usd === null ? "Price not published" : formatUsd(value);
}

export function Generate({ form }: { form: WorkflowForm }) {
  return (
    <div className="workflow-generate">
      {form.missing.length ? (
        <p className="form-hint">Required: {form.missing.map((item) => item.label).join(", ")}</p>
      ) : null}
      {form.error ? (
        <p role="alert" className="form-error">
          {form.error}
        </p>
      ) : null}
      {form.estimateError ? (
        <p role="alert" className="form-error">
          Price estimate failed: {form.estimateError}
        </p>
      ) : null}
      <button
        className="btn btn-primary btn-generate"
        type="submit"
        disabled={form.sending || form.blocked || form.missing.length > 0}
      >
        {form.sending ? "Sending" : "Generate"}{" "}
        <span>
          {form.estimate
            ? price(form.estimate.total)
            : form.missing.length
              ? "Add inputs for price"
              : form.estimateError
                ? "Price unavailable"
                : "Estimating"}
        </span>
      </button>
    </div>
  );
}
