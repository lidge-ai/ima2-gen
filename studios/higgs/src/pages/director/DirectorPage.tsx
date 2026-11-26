import type { HistoryItem, WorkflowDef } from "@ima2/studio-kit";
import { messages, tr, useT } from "../../i18n.ts";
import { workflowText } from "../workflow/workflowLabels.ts";
import { useStudio } from "../../studio/context.tsx";
import { handOffFile } from "../../studio/handoff.ts";
import { historyWorkflow } from "../../studio/historyWorkflow.ts";
import { Feed } from "../../ui/Feed.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { WorkflowInput, WorkflowParams, WorkflowSteps, Generate } from "../workflow/WorkflowFields.tsx";
import { useWorkflow, type WorkflowForm } from "../workflow/useWorkflow.ts";
import "../../styles/director.css";

const M = messages(
  { noAttach: "{workflow} does not accept {kind} attachments", attachFailed: "Could not attach result", cast: "cast", location: "location", castLabel: "Cast", locationLabel: "Location", attach: "Attach {kind}: {name}", elements: "Your cast and locations", emptyElements: "Create cast or locations to reuse them here.", workflows: "Director workflows", workflow: "Director workflow", historyLabel: "Director history", history: "History", emptyHistory: "No director results yet", emptyHint: "Generate a result to see it here.", loadError: "Could not load workflows: {error}", none: "No director workflows available", loading: "Loading director workflows" },
  { noAttach: "{workflow}에는 {kind}을 추가할 수 없어요", attachFailed: "결과를 추가하지 못했어요", cast: "인물", location: "장소", castLabel: "인물", locationLabel: "장소", attach: "{kind} 추가: {name}", elements: "내 인물과 장소", emptyElements: "인물이나 장소를 생성하면 여기서 다시 쓸 수 있어요.", workflows: "Director 워크플로", workflow: "Director 워크플로", historyLabel: "Director 기록", history: "기록", emptyHistory: "아직 Director 결과가 없어요", emptyHint: "결과를 생성하면 여기에 표시돼요.", loadError: "워크플로를 불러오지 못했어요: {error}", none: "사용할 수 있는 Director 워크플로가 없어요", loading: "Director 워크플로를 불러오는 중이에요" },
);

const order = ["director-studio", "director-cinema", "director-cast", "director-locations"];

function useAttachElement(def: WorkflowDef, form: WorkflowForm) {
  return async (item: HistoryItem) => {
    const name = historyWorkflow(item, form.studio.getState().jobs) === "director-cast" ? "cast" : "location";
    const pattern = name === "cast" ? /cast|character|subject|person|actor/i : /location|place|background|scene/i;
    const candidates = def.inputs.filter(
      (entry) => entry.kind === "image" && (form.files[entry.name]?.length ?? 0) < (entry.maxCount ?? 1),
    );
    const input = candidates.find((entry) => pattern.test(entry.name) || pattern.test(entry.label)) ?? candidates[0];
    if (!input) {
      form.setError(tr(M, "noAttach", { workflow: workflowText(def.id, "label", def.label), kind: tr(M, name) }));
      return;
    }
    try {
      form.setError(null);
      const file = await handOffFile({
        url: item.url,
        mimeType: item.mimeType,
        name: item.prompt || name,
        target: "image",
      });
      const upload = await form.studio.upload(file);
      form.setFiles((old) => ({
        ...old,
        [input.name]: [...(old[input.name] ?? []), { role: input.role ?? "reference-image", upload, name: file.name }],
      }));
    } catch (err) {
      form.setError(err instanceof Error ? err.message : tr(M, "attachFailed"));
    }
  };
}

function DirectorElements({ def, form }: { def: WorkflowDef; form: WorkflowForm }) {
  const t = useT(M);
  const history = useStudio((s) => s.history);
  const jobs = useStudio((s) => s.jobs);
  const elements = history.filter((item) =>
    ["director-cast", "director-locations"].includes(historyWorkflow(item, jobs) ?? ""),
  );
  const attach = useAttachElement(def, form);
  return (
    <div className="director-elements">
      <h3>{t("elements")}</h3>
      {elements.length ? (
        elements.map((item) => (
          <button
            type="button"
            key={item.historyId}
            aria-label={t("attach", { kind: t(historyWorkflow(item, jobs) === "director-cast" ? "cast" : "location"), name: item.prompt || item.model })}
            onClick={() => {
              void attach(item);
            }}
          >
            {t("attach", { kind: t(historyWorkflow(item, jobs) === "director-cast" ? "cast" : "location"), name: item.prompt || t(historyWorkflow(item, jobs) === "director-cast" ? "castLabel" : "locationLabel") })}
            {jobs[item.jobId]?.steps?.find((step) => step.model)?.model ? (
              <ModelName id={jobs[item.jobId]!.steps!.find((step) => step.model)!.model!} />
            ) : null}
          </button>
        ))
      ) : (
        <p className="muted">{t("emptyElements")}</p>
      )}
    </div>
  );
}

function DirectorSidebar({
  def,
  workflows,
  form,
}: {
  def: WorkflowDef;
  workflows: readonly WorkflowDef[];
  form: WorkflowForm;
}) {
  const t = useT(M);
  return (
    <aside className="director-sidebar">
      <nav aria-label={t("workflows")}>
        {workflows.map((item) => (
          <a key={item.id} href={`#/director/${item.id}`} aria-current={def.id === item.id ? "page" : undefined}>
            {workflowText(item.id, "label", item.label)}
          </a>
        ))}
      </nav>
      <DirectorElements def={def} form={form} />
    </aside>
  );
}

function DirectorWorkspace({ def, workflows }: { def: WorkflowDef; workflows: readonly WorkflowDef[] }) {
  const t = useT(M);
  const form = useWorkflow(def);
  return (
    <div className="director-layout">
      <DirectorSidebar def={def} workflows={workflows} form={form} />
      <main className="director-main">
        <div className="director-heading">
          <h1>{workflowText(def.id, "label", def.label)}</h1>
          <p className="muted">{workflowText(def.id, "description", def.description)}</p>
        </div>
        <form
          className="director-form"
          aria-label={t("workflow")}
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <WorkflowParams def={def} form={form} chip />
          <div className="director-composer">
            {def.inputs.map((input) => (
              <WorkflowInput key={input.name} input={input} form={form} />
            ))}
            <Generate form={form} />
          </div>
          <WorkflowSteps def={def} form={form} />
        </form>
        <section className="director-feed" aria-label={t("historyLabel")}>
          <h2>{t("history")}</h2>
          <Feed
            workflow={(id) => id.startsWith("director-")}
            empty={<div className="muted"><p>{t("emptyHistory")}</p><p>{t("emptyHint")}</p></div>}
          />
        </section>
      </main>
    </div>
  );
}

export function DirectorPage({ workflow }: { workflow?: string }) {
  const t = useT(M);
  const all = useStudio((s) => s.workflows);
  const loaded = useStudio((s) => s.workflowsLoaded);
  const error = useStudio((s) => s.workflowsError);
  const workflows = all
    .filter((item) => item.family === "director")
    .slice()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const def = workflows.find((item) => item.id === workflow) ?? workflows[0];
  if (error)
    return (
      <div className="empty" role="alert">
        {t("loadError", { error })}
      </div>
    );
  if (!def)
    return (
      <div className="empty" role="status">
        {t(loaded ? "none" : "loading")}
      </div>
    );
  return <DirectorWorkspace key={def.id} def={def} workflows={workflows} />;
}
