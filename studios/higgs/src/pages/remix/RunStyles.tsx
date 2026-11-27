import { useId } from "react";
import type { WorkflowDef } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import { useStudio } from "../../studio/context.tsx";

/**
 * How a remix runs. The server offers up to three variants of each remix: one video model call on
 * the person's keys, the same idea on ChatGPT and Grok sign-ins, and the staged pipeline that
 * prepares the first frame before rendering. People choose by what differs, not by route names.
 */
export type RunStyle = "oneshot" | "subscription" | "staged";
export const RUN_STYLES: readonly RunStyle[] = ["oneshot", "subscription", "staged"];
const SUFFIX: Record<RunStyle, string> = { oneshot: "", subscription: "-subscription", staged: "-open" };

export function styleOf(id: string): RunStyle {
  return id.endsWith("-subscription") ? "subscription" : id.endsWith("-open") ? "staged" : "oneshot";
}
export function baseOf(id: string): string {
  return id.replace(/-(subscription|open)$/, "");
}
export function variantId(base: string, style: RunStyle): string {
  return base + SUFFIX[style];
}

const M = messages(
  {
    runOn: "How to run",
    oneshot: "In one go",
    subscription: "With your subscriptions",
    staged: "Step by step",
    oneshotHelp: "One video model does it with your keys. Fewest steps, quickest.",
    subscriptionHelp: "Runs on your ChatGPT and Grok sign-ins; no API keys needed.",
    stagedHelp: "Prepares the first frame, then renders; you can pick each step's model. Most steps, takes longest.",
    steps: "{n} steps",
    keys: "your keys, provider prices",
    plans: "subscription usage",
  },
  {
    runOn: "실행 방식",
    oneshot: "한 번에",
    subscription: "구독으로",
    staged: "단계별로",
    oneshotHelp: "영상 모델 하나가 내 키로 한 번에 처리해요. 단계가 가장 적고 가장 빨라요.",
    subscriptionHelp: "ChatGPT·Grok 로그인으로 실행해요. API 키가 없어도 돼요.",
    stagedHelp: "첫 프레임을 먼저 만들고 영상을 렌더해요. 단계마다 모델을 고를 수 있고, 가장 오래 걸려요.",
    steps: "{n}단계",
    keys: "내 키, 제공업체 가격",
    plans: "구독 사용량",
  },
);

/** The model a step runs on this server before any input: the default if it can run here, else the first that can. */
function stepModel(step: WorkflowDef["steps"][number]): string | undefined {
  if (!step.model) return undefined;
  if (!step.runnable || step.runnable[step.model]) return step.model;
  return (step.modelChoices ?? []).find((m) => step.runnable?.[m]) ?? step.model;
}

function StyleOption({ def, current }: { def: WorkflowDef; current: boolean }) {
  const t = useT(M);
  const id = useId();
  const style = styleOf(def.id);
  const catalog = useStudio((s) => s.catalog);
  const label = (model: string) => catalog?.models.find((m) => m.id === model)?.label ?? model;
  const models = def.steps.map(stepModel).filter((m): m is string => !!m).map(label);
  const facts = [
    models.join(" → "),
    t("steps", { n: def.steps.length }),
    t(style === "subscription" ? "plans" : "keys"),
  ].filter(Boolean);
  const losses = def.preset?.losses.map((l) => l.detail) ?? [];
  return (
    <li className="run-style" aria-current={current ? "true" : undefined}>
      <a href={"#/remix/" + def.id} aria-current={current ? "page" : undefined} aria-describedby={id}>
        {t(style)}
      </a>
      <div id={id} className="run-style-text">
        <p>{t((style + "Help") as "oneshotHelp")}</p>
        <p className="run-style-facts">{facts.join(" · ")}</p>
        {losses.length ? (
          <ul className="run-style-losses">
            {losses.map((loss) => (
              <li key={loss}>{loss}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** One card per run style the server offers for this remix; hidden when there is only one. */
export function RunStyles({ def, workflows }: { def: WorkflowDef; workflows: readonly WorkflowDef[] }) {
  const t = useT(M);
  const base = baseOf(def.id);
  const options = RUN_STYLES.map((style) => workflows.find((w) => w.id === variantId(base, style))).filter((w): w is WorkflowDef => !!w);
  if (options.length < 2) return null;
  return (
    <nav aria-label={t("runOn")}>
      <span className="workflow-label">{t("runOn")}</span>
      <ul className="run-styles">
        {options.map((option) => (
          <StyleOption key={option.id} def={option} current={option.id === def.id} />
        ))}
      </ul>
    </nav>
  );
}
