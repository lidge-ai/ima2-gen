import { formatUsd, type WorkflowCredit, type WorkflowDef, type WorkflowInputSpec } from "@ima2/studio-kit";
import { useState } from "react";
import { messages, tr, useT } from "../../i18n.ts";
import { KeyNotice } from "../../ui/KeyNotice.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { SettingTile } from "../../ui/SettingTile.tsx";
import { UploadSlot } from "../../ui/UploadSlot.tsx";
import { VendorLogo } from "../../ui/VendorLogo.tsx";
import { lengthLimit } from "../../ui/format.ts";
import type { WorkflowForm } from "./useWorkflow.ts";

/** The server's cross-field rules (lib/workflows/definitions/remix*.ts check), said as the next step. */
const NEXT_STEP = messages(
  {
    "choose a style or add a style reference": "Choose a style or add a style reference to see the cost.",
    "choose a style or describe the look": "Choose a style or describe the look to see the cost.",
    "choose a style, a style reference or describe the look": "Choose a style, add a style reference or describe the look to see the cost.",
    other: "To see the cost: {reason}.",
  },
  {
    "choose a style or add a style reference": "스타일을 고르거나 스타일 참조를 넣으면 비용이 나와요.",
    "choose a style or describe the look": "스타일을 고르거나 원하는 느낌을 적으면 비용이 나와요.",
    "choose a style, a style reference or describe the look": "스타일을 고르거나, 스타일 참조를 넣거나, 원하는 느낌을 적으면 비용이 나와요.",
    other: "비용을 보려면 이 입력이 더 필요해요: “{reason}”",
  },
);

function useNextStep(form: WorkflowForm): string | null {
  const t = useT(NEXT_STEP);
  const reason = form.inputNeeded;
  if (reason === null) return null;
  const known = reason !== "other" && Object.hasOwn(NEXT_STEP.en, reason);
  return known ? t(reason as keyof typeof NEXT_STEP.en) : t("other", { reason });
}

const M = messages(
  { prompt: "Prompt", required: "Required", optional: "Optional", steps: "Steps and estimated cost", noRoute: "No route", unavailable: "Model unavailable for {step}", addInputs: "Add required inputs to estimate", afterInputs: "Step costs appear once the inputs are complete.", estimateUnavailable: "Estimate unavailable", estimating: "Estimating", breakdown: "Cost breakdown", unpublished: "Price not published", requiredList: "Required: {fields}", priceFailed: "Price estimate failed: {error}", sending: "Sending", generate: "Generate", addPrice: "Add inputs for price", priceUnavailable: "Price unavailable", auto: "Auto", typeValue: "Type to set", on: "On", off: "Off", credits: "Sources ({n})", addAnother: "Add another: {label}", count: "{n} of {max}" },
  { prompt: "프롬프트", required: "필수", optional: "선택", steps: "단계 및 예상 비용", noRoute: "경로 없음", unavailable: "{step}에 사용할 모델이 없어요", addInputs: "예상 비용을 보려면 필수 항목을 추가해 주세요", afterInputs: "입력을 마치면 단계별 비용이 나와요.", estimateUnavailable: "예상 비용을 볼 수 없어요", estimating: "예상 비용 계산 중", breakdown: "비용 내역", unpublished: "공개된 가격 없음", requiredList: "필수: {fields}", priceFailed: "예상 비용 계산 실패: {error}", sending: "요청 중", generate: "생성", addPrice: "비용을 보려면 입력 추가", priceUnavailable: "가격 확인 불가", auto: "자동", typeValue: "입력해서 지정", on: "켜짐", off: "꺼짐", credits: "출처 ({n})", addAnother: "하나 더 추가: {label}", count: "{max}개 중 {n}개" },
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
          {input.label}
          {input.required ? ` · ${t("required")}` : null}
          <textarea
            aria-label={input.label}
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
  const label = input.label;
  const values = form.files[input.name] ?? [];
  const max = input.maxCount ?? 1;
  return (
    <div className="workflow-input">
      <span className="workflow-label">
        {label}
        {` · ${t(input.required ? "required" : "optional")}`}
        {max > 1 && values.length > 0 ? ` · ${t("count", { n: values.length, max })}` : null}
      </span>
      <div className="workflow-slots">
        {Array.from({ length: Math.min(max, values.length + 1) }, (_, index) => (
          <UploadSlot
            key={index}
            // Filled slots are numbered when there can be several; the empty one after them adds another.
            label={index >= values.length && index > 0 ? t("addAnother", { label }) : max > 1 && values.length > 1 ? `${label} ${index + 1}` : label}
            role={input.role ?? "reference-image"}
            accept={input.accept ?? `${input.kind}/*`}
            value={values[index] ?? null}
            hint={input.description ?? lengthLimit(input.durationSec)}
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
        const caption = param.label;
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
              <span className="workflow-switch-text">
                <span className="setting-caption">{caption}</span>
                <span className="setting-value" aria-hidden="true">
                  {t(value ? "on" : "off")}
                </span>
              </span>
              <input type="checkbox" aria-label={caption} checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />
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
        // Show what will run: the person's pick, else the model the server's estimate planned.
        const current = form.slotModel(step.id, step.model);
        const ids = step.modelChoices?.length ? [...step.modelChoices, ...(current && !step.modelChoices.includes(current) ? [current] : [])] : [];
        return (
          <div className="workflow-step" key={step.id}>
            {ids.length ? (
              <SettingTile
                caption={step.label}
                value={current ?? ""}
                options={ids.map((id) => ({
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
                {current ? <ModelName id={current} /> : null}
              </span>
            )}
            {step.description ? (
              <p className="form-hint step-description" title={step.description}>
                {step.description}
              </p>
            ) : null}
          </div>
        );
      })}
      <WorkflowCosts form={form} />
      <WorkflowCredits def={def} />
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

/** Every project the workflow's steps follow, once each, in one collapsed place. */
function WorkflowCredits({ def }: { def: WorkflowDef }) {
  const t = useT(M);
  const seen = new Map<string, WorkflowCredit>();
  for (const step of def.steps) for (const credit of step.credits ?? []) if (!seen.has(credit.name)) seen.set(credit.name, credit);
  if (!seen.size) return null;
  return (
    <details className="workflow-credits">
      <summary>{t("credits", { n: seen.size })}</summary>
      <ul>
        {[...seen.values()].map((credit) => (
          <li key={credit.name}>
            {credit.url ? (
              <a href={credit.url} target="_blank" rel="noreferrer">
                {credit.name}
              </a>
            ) : (
              credit.name
            )}
            {credit.license ? <span className="muted"> · {credit.license}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function WorkflowCosts({ form }: { form: WorkflowForm }) {
  const t = useT(M);
  if (!form.estimate)
    return (
      <p className="form-hint">
        {form.missing.length
          ? t("addInputs")
          : form.inputNeeded !== null
            ? t("afterInputs")
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
  const nextStep = useNextStep(form);
  return (
    <div className="workflow-generate">
      {form.missing.length ? (
        <p className="form-hint">{t("requiredList", { fields: form.missing.map((item) => item.label).join(", ") })}</p>
      ) : nextStep ? (
        <p className="form-hint">{nextStep}</p>
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
            : form.missing.length || nextStep
              ? t("addPrice")
              : form.estimateError
                ? t("priceUnavailable")
                : t("estimating")}
        </span>
      </button>
    </div>
  );
}
