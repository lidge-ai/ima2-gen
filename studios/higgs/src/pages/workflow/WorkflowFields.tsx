import { formatUsd, type WorkflowDef, type WorkflowInputSpec } from "@ima2/studio-kit";
import { useState } from "react";
import { messages, tr, useT } from "../../i18n.ts";
import { fieldLabel } from "./workflowLabels.ts";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import type { WorkflowForm } from "./useWorkflow.ts";

const M = messages(
  { prompt: "Prompt", required: "Required", optional: "Optional", steps: "Steps and estimated cost", noRoute: "No route", unavailable: "Model unavailable for {step}", addInputs: "Add required inputs to estimate", estimateUnavailable: "Estimate unavailable", estimating: "Estimating", breakdown: "Cost breakdown", unpublished: "Price not published", requiredList: "Required: {fields}", priceFailed: "Price estimate failed: {error}", sending: "Sending", generate: "Generate", addPrice: "Add inputs for price", priceUnavailable: "Price unavailable", auto: "Auto", typeValue: "Type to set" },
  { prompt: "프롬프트", required: "필수", optional: "선택", steps: "단계 및 예상 비용", noRoute: "경로 없음", unavailable: "{step}에 사용할 모델이 없어요", addInputs: "예상 비용을 보려면 필수 항목을 추가해 주세요", estimateUnavailable: "예상 비용을 볼 수 없어요", estimating: "예상 비용 계산 중", breakdown: "비용 내역", unpublished: "공개된 가격 없음", requiredList: "필수: {fields}", priceFailed: "예상 비용 계산 실패: {error}", sending: "요청 중", generate: "생성", addPrice: "비용을 보려면 입력 추가", priceUnavailable: "가격 확인 불가", auto: "자동", typeValue: "입력해서 지정" },
);

function TextWorkflowInput({
  input,
  form,
  optionalSwitch,
}: {
  input: WorkflowInputSpec;
  form: WorkflowForm;
  optionalSwitch: boolean;
}) {
  const t = useT(M);
  const [enabled, setEnabled] = useState(!optionalSwitch);
  return (
    <div className="workflow-input">
      {optionalSwitch ? (
        <label className="workflow-switch">
          <span>{t("prompt")}</span>
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
          {fieldLabel(form.def.id, input.name, input.label)}
          {input.required ? ` · ${t("required")}` : null}
          <textarea
            aria-label={fieldLabel(form.def.id, input.name, input.label)}
            required={input.required}
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
  const t = useT(M);
  const label = fieldLabel(form.def.id, input.name, input.label);
  const values = form.files[input.name] ?? [];
  const max = input.maxCount ?? 1;
  return (
    <div className="workflow-input">
      <span className="workflow-label">
        {label}
        {` · ${t(input.required ? "required" : "optional")}`}
      </span>
      <div className="workflow-slots">
        {Array.from({ length: Math.min(max, values.length + 1) }, (_, index) => (
          <UploadSlot
            key={index}
            label={index > 0 ? `${label} ${index + 1}` : label}
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

/**
 * Every setting shows its name and value. A select without a server default starts on "Auto" and
 * can go back to it, which leaves the value out of the request so the workflow decides.
 */
export function WorkflowParams({ def, form, chip = false }: { def: WorkflowDef; form: WorkflowForm; chip?: boolean }) {
  const t = useT(M);
  return (
    <div className="workflow-params">
      {def.params.map((param) => {
        const value = form.params[param.name] ?? param.default ?? "";
        const update = (next: string | number | boolean) =>
          form.setParams((old) => {
            if (next !== "") return { ...old, [param.name]: next };
            const { [param.name]: _cleared, ...rest } = old;
            return rest;
          });
        const caption = fieldLabel(def.id, param.name, param.label);
        if (param.type === "select") {
          const options = param.default === undefined ? [{ value: "", label: t("auto") }, ...(param.options ?? [])] : (param.options ?? []);
          return (
            <SettingTile
              key={param.name}
              caption={caption}
              variant={chip ? "chip" : "tile"}
              value={String(value)}
              options={options}
              onChange={update}
              {...(chip ? { chipText: (label: string) => caption + ": " + label } : {})}
            />
          );
        }
        if (param.type === "boolean")
          return (
            <label className="workflow-switch" key={param.name}>
              {caption}
              <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />
            </label>
          );
        return (
          <label className="field" key={param.name}>
            {caption}
            <input
              type={param.type}
              value={String(value)}
              min={param.min}
              max={param.max}
              step={param.step}
              placeholder={param.type === "text" ? t("typeValue") : undefined}
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
  const t = useT(M);
  return (
    <div className="workflow-steps">
      <h3>{t("steps")}</h3>
      {def.steps.map((step) => {
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
                  disabled: step.available?.[id] === false,
                  meta: step.available?.[id] === false ? t("noRoute") : undefined,
                }))}
                onChange={(model) => form.setSteps((old) => ({ ...old, [step.id]: { model } }))}
              />
            ) : (
              <span>
                {step.label}
                {step.model ? <ModelName id={step.model} /> : null}
              </span>
            )}
            {step.rationale ? <p className="form-hint">{step.rationale}</p> : null}
          </div>
        );
      })}
      <WorkflowCosts form={form} />
      {form.choices.map(({ step, choice, available }) =>
        available !== true && choice?.kind === "needs-key" && form.catalog ? (
          <KeyNotice key={step.id} routes={choice.candidates} providers={form.catalog.providers} />
        ) : available === false || (available === undefined && (choice?.kind === "unavailable" || !choice)) ? (
          <p role="alert" key={step.id}>
            {t("unavailable", { step: step.label })}
          </p>
        ) : null,
      )}
    </div>
  );
}

function WorkflowCosts({ form }: { form: WorkflowForm }) {
  const t = useT(M);
  if (!form.estimate)
    return (
      <p className="form-hint">
        {form.missing.length
          ? t("addInputs")
          : form.estimateError
            ? t("estimateUnavailable")
            : t("estimating")}
      </p>
    );
  return (
    <div className="workflow-steps" aria-label={t("breakdown")}>
      {form.estimate.steps.map((step) => (
        <div className="workflow-step" key={step.id}>
          <span>{step.label ?? step.id}</span>
          {step.model ? <ModelName id={step.model} /> : null}
          <span className="muted">{price(step.estimate)}</span>
        </div>
      ))}
    </div>
  );
}

export function price(value: { usd: number | null; basis: string }): string {
  return value.usd === null ? tr(M, "unpublished") : formatUsd(value);
}

export function Generate({ form }: { form: WorkflowForm }) {
  const t = useT(M);
  return (
    <div className="workflow-generate">
      {form.missing.length ? (
        <p className="form-hint">{t("requiredList", { fields: form.missing.map((item) => fieldLabel(form.def.id, item.name, item.label)).join(", ") })}</p>
      ) : null}
      {form.spendReason ? <p className="form-hint spend-reason">{form.spendReason}</p> : null}
      {form.error ? (
        <p role="alert" className="form-error">
          {form.error}
        </p>
      ) : null}
      {form.estimateError ? (
        <p role="alert" className="form-error">
          {t("priceFailed", { error: form.estimateError })}
        </p>
      ) : null}
      <button
        className="btn btn-primary btn-generate"
        type="submit"
        disabled={form.sending || form.blocked || form.missing.length > 0}
      >
        {t(form.sending ? "sending" : "generate")}{" "}
        <span>
          {form.estimate
            ? price(form.estimate.total)
            : form.missing.length
              ? t("addPrice")
              : form.estimateError
                ? t("priceUnavailable")
                : t("estimating")}
        </span>
      </button>
    </div>
  );
}
