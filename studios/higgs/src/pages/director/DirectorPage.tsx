import type { HistoryItem, WorkflowDef } from "@ima2/studio-kit";
import { useStudio } from "../../studio/context.tsx";
import { handOffFile } from "../../studio/handoff.ts";
import { Feed } from "../../ui/Feed.tsx";
import { ModelName } from "../../ui/ModelName.tsx";
import { WorkflowInput, WorkflowParams, WorkflowSteps, Generate } from "../workflow/WorkflowFields.tsx";
import { useWorkflow, type WorkflowForm } from "../workflow/useWorkflow.ts";
import "../../styles/director.css";

const order = ["director-studio", "director-cinema", "director-cast", "director-locations"];

function useAttachElement(def: WorkflowDef, form: WorkflowForm) {
  return async (item: HistoryItem) => {
    const name = item.workflow === "director-cast" ? "cast" : "location";
    const input = def.inputs.find((entry) => entry.name === name && entry.kind !== "text");
    if (!input) {
      form.setError(`${def.label} does not accept ${name} attachments`);
      return;
    }
    if ((form.files[name]?.length ?? 0) >= (input.maxCount ?? 1)) {
      form.setError(`${input.label} is full`);
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
        [name]: [...(old[name] ?? []), { role: input.role ?? "reference-image", upload, name: file.name }],
      }));
    } catch (err) {
      form.setError(err instanceof Error ? err.message : "Could not attach result");
    }
  };
}

function DirectorElements({ def, form }: { def: WorkflowDef; form: WorkflowForm }) {
  const history = useStudio((s) => s.history);
  const jobs = useStudio((s) => s.jobs);
  const elements = history.filter(
    (item) => item.workflow === "director-cast" || item.workflow === "director-locations",
  );
  const attach = useAttachElement(def, form);
  return (
    <div className="director-elements">
      <h3>Your cast and locations</h3>
      {elements.length ? (
        elements.map((item) => (
          <button
            type="button"
            key={item.historyId}
            aria-label={`Attach ${item.workflow === "director-cast" ? "cast" : "location"}: ${item.prompt || item.model}`}
            onClick={() => {
              void attach(item);
            }}
          >
            Attach {item.workflow === "director-cast" ? "cast" : "location"}:{" "}
            {item.prompt || (item.workflow === "director-cast" ? "Cast" : "Location")}
            {jobs[item.jobId]?.steps?.find((step) => step.model)?.model ? (
              <ModelName id={jobs[item.jobId]!.steps!.find((step) => step.model)!.model!} />
            ) : null}
          </button>
        ))
      ) : (
        <p className="muted">Create cast or locations to reuse them here.</p>
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
  return (
    <aside className="director-sidebar">
      <nav aria-label="Director workflows">
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
  const form = useWorkflow(def);
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
          aria-label="Director workflow"
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
        <section className="director-feed" aria-label="Director history">
          <h2>History</h2>
          <Feed
            workflow={(id) => id.startsWith("director-")}
            empty={<p className="muted">No director results yet</p>}
          />
        </section>
      </main>
    </div>
  );
}

export function DirectorPage({ workflow }: { workflow?: string }) {
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
        Could not load workflows: {error}
      </div>
    );
  if (!def)
    return (
      <div className="empty" role="status">
        {loaded ? "No director workflows available" : "Loading director workflows"}
      </div>
    );
  return <DirectorWorkspace key={def.id} def={def} workflows={workflows} />;
}
