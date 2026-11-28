import { Fragment, useRef } from "react";
import type { HistoryItem, WorkflowDef } from "@ima2/studio-kit";
import { messages, tr, useT } from "../../i18n.ts";
import { useStudio } from "../../studio/context.tsx";
import { handOffFile } from "../../studio/handoff.ts";
import { historyWorkflow } from "../../studio/historyWorkflow.ts";
import { Feed } from "../../ui/Feed.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { WorkflowInput, WorkflowParams, WorkflowSteps, Generate } from "../workflow/WorkflowFields.tsx";
import { useWorkflow, type WorkflowForm } from "../workflow/useWorkflow.ts";
import { WorkflowsError } from "../workflow/WorkflowsError.tsx";
import { useWorkflows } from "../../studio/workflows.ts";
import { CameraMoveMenu } from "../../ui/CameraMoveMenu.tsx";
import { CutList } from "./CutList.tsx";
import "../../styles/director.css";

const M = messages(
  { noAttach: "{workflow} does not accept {kind} attachments", attachFailed: "Could not attach result", cast: "cast", location: "location", castLabel: "Cast", locationLabel: "Location", attach: "Attach {kind}: {name}", elements: "Your cast and locations", emptyElements: "Create cast or locations to reuse them here.", workflows: "Director workflows", workflow: "Director workflow", historyLabel: "Director history", history: "History", emptyHistory: "No director results yet", emptyHint: "Generate a result to see it here.", loadError: "Could not load workflows: {error}", none: "No director workflows available", loading: "Loading director workflows", cutMode: "How the clip is cut", oneScene: "One scene", cutList: "Cut list" },
  { noAttach: "{workflow}에는 {kind}을 추가할 수 없어요", attachFailed: "결과를 추가하지 못했어요", cast: "인물", location: "장소", castLabel: "인물", locationLabel: "장소", attach: "{kind} 추가: {name}", elements: "내 인물과 장소", emptyElements: "인물이나 장소를 생성하면 여기서 다시 쓸 수 있어요.", workflows: "디렉터 워크플로", workflow: "디렉터 워크플로", historyLabel: "디렉터 기록", history: "기록", emptyHistory: "아직 디렉터 결과가 없어요", emptyHint: "결과를 생성하면 여기에 표시돼요.", loadError: "워크플로를 불러오지 못했어요: {error}", none: "사용할 수 있는 디렉터 워크플로가 없어요", loading: "디렉터 워크플로를 불러오는 중이에요", cutMode: "컷 나누는 방식", oneScene: "장면 하나", cutList: "컷 목록" },
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
      form.setError(tr(M, "noAttach", { workflow: def.label, kind: tr(M, name) }));
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
            {item.label}
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
  const composer = useRef<HTMLDivElement>(null);
  // The scene prompt of the workflow that makes video takes camera moves; the stills workflows do not.
  const scene = def.id === "director-studio" ? def.inputs.find((input) => input.kind === "text" && input.name === "prompt") : undefined;
  return (
    <div className="director-layout">
      <DirectorSidebar def={def} workflows={workflows} form={form} />
      <main className="director-main">
        <div className="director-heading">
          <h1>{def.label}</h1>
          <p className="muted">{def.description}</p>
        </div>
        <form
          className="director-form"
          aria-label={t("workflow")}
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          {/* A cut list sets the length shot by shot, so the single length is not offered with it. */}
          <WorkflowParams def={form.cutting ? { ...def, params: def.params.filter((param) => param.name !== "duration") } : def} form={form} />
          <div className="director-composer" ref={composer}>
            {def.shots ? (
              <div className="cut-mode" role="group" aria-label={t("cutMode")}>
                <button type="button" className="chip" aria-pressed={!form.cutting} onClick={() => form.setCutting(false)}>{t("oneScene")}</button>
                <button type="button" className="chip" aria-pressed={form.cutting} onClick={() => form.setCutting(true)}>{t("cutList")}</button>
              </div>
            ) : null}
            {def.shots && form.cutting ? <CutList form={form} spec={def.shots} model={form.catalog?.models.find((m) => m.id === form.slotModel("render"))} /> : null}
            {def.inputs.map((input) => (
              <Fragment key={input.name}>
                <WorkflowInput input={{ ...input, required: form.needed(input) }} form={form} />
                {/* Right under the scene it writes into. */}
                {scene && input.name === scene.name ? (
                  <div className="director-moves">
                    <CameraMoveMenu
                      value={form.texts[scene.name] ?? ""}
                      onChange={(next) => form.setTexts((old) => ({ ...old, [scene.name]: next }))}
                      field={() => composer.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="' + scene.label + '"]') ?? null}
                    />
                  </div>
                ) : null}
              </Fragment>
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
  const all = useWorkflows();
  const loaded = useStudio((s) => s.workflowsLoaded);
  const error = useStudio((s) => s.workflowsError);
  const workflows = all
    .filter((item) => item.family === "director")
    .slice()
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const def = workflows.find((item) => item.id === workflow) ?? workflows[0];
  if (error) return <WorkflowsError error={error} />;
  if (!def)
    return (
      <div className="empty" role="status">
        {t(loaded ? "none" : "loading")}
      </div>
    );
  return <DirectorWorkspace key={def.id} def={def} workflows={workflows} />;
}
