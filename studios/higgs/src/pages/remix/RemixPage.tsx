import { useEffect, useState } from "react";
import type { WorkflowDef } from "@ima2/studio-kit";
import { PRESETS, type Preset } from "../../data/presets.ts";
import { useStudio } from "../../studio/context.tsx";
import { handOffFile, takeHandOff } from "../../studio/handoff.ts";
import { Feed } from "../../ui/Feed.tsx";
import { WorkflowInput, WorkflowParams, WorkflowSteps, Generate } from "../workflow/WorkflowFields.tsx";
import { useWorkflow, type WorkflowForm } from "../workflow/useWorkflow.ts";
import "../../styles/remix.css";

function MotionLibrary({ form }: { form: WorkflowForm }) {
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState("");
  const [broken, setBroken] = useState<string[]>([]);
  const clips = PRESETS.filter((item) => item.sampleKind === "video");
  const categories = ["All", ...new Set(clips.map((item) => item.category))];
  const pick = async (item: Preset) => {
    try {
      form.setError(null);
      const response = await fetch(new URL(item.sample, document.baseURI));
      if (!response.ok || !response.headers.get("content-type")?.startsWith("video/"))
        throw new Error("Sample clip is unavailable");
      const file = new File([await response.blob()], item.id + ".mp4", {
        type: "video/mp4",
      });
      const upload = await form.studio.upload(file);
      form.setFiles((old) => ({
        ...old,
        source: [{ role: "source-video", upload, name: item.label }],
      }));
      setSelected(item.id);
    } catch (err) {
      form.setError(err instanceof Error ? err.message : "Could not load sample clip");
    }
  };
  return (
    <div className="gallery">
      <div className="remix-intro">
        <h1>Motion library</h1>
        <p className="muted">Choose a clip to use as your source video.</p>
      </div>
      <div className="chip-row" aria-label="Motion categories">
        {categories.map((name) => (
          <button
            type="button"
            key={name}
            className="chip"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="remix-grid">
        {clips
          .filter((item) => category === "All" || item.category === category)
          .map((item) => (
            <button
              className="remix-clip"
              type="button"
              aria-pressed={selected === item.id}
              key={item.id}
              onClick={() => {
                void pick(item);
              }}
            >
              {broken.includes(item.id) ? (
                <span className="remix-unavailable">Preview unavailable</span>
              ) : (
                <video src={item.sample} muted playsInline onError={() => setBroken((old) => [...old, item.id])} />
              )}
              <span className="remix-clip-label">{item.label}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function RemixWorkspace({ def, workflows }: { def: WorkflowDef; workflows: readonly WorkflowDef[] }) {
  const form = useWorkflow(def);
  const [view, setView] = useState<"library" | "history">("library");
  useEffect(() => {
    const handoff = takeHandOff("remix");
    if (!handoff) return;
    void handOffFile(handoff)
      .then((file) => form.studio.upload(file))
      .then((upload) => {
        form.setFiles((old) => ({
          ...old,
          source: [{ role: "source-video", upload, name: handoff.name }],
        }));
      })
      .catch((err: unknown) => form.setError(err instanceof Error ? err.message : "Could not load video"));
  }, [form.studio, form.setFiles, form.setError]);
  return (
    <div className="workspace remix-workspace">
      <form
        className="panel"
        aria-label="Remix workflow"
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
          setView("history");
        }}
      >
        <div className="panel-tabs">
          <strong>Remix</strong>
        </div>
        <div className="panel-body">
          <div className="workflow-card">
            <h2>{def.label}</h2>
            <p className="muted">{def.description}</p>
          </div>
          <nav className="remix-modes" aria-label="Remix workflow">
            {workflows.map((item) => (
              <a key={item.id} href={`#/remix/${item.id}`} aria-current={item.id === def.id ? "page" : undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          {def.inputs.map((input) => (
            <WorkflowInput
              key={input.name}
              input={input}
              form={form}
              optionalSwitch={input.kind === "text" && !input.required}
            />
          ))}
          <WorkflowParams def={def} form={form} />
          <WorkflowSteps def={def} form={form} />
        </div>
        <div className="panel-foot">
          <Generate form={form} />
        </div>
      </form>
      <main className="stage">
        <div className="stage-head">
          <div className="tabs" role="tablist" aria-label="Remix views">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={view === "library"}
              onClick={() => setView("library")}
            >
              Motion library
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={view === "history"}
              onClick={() => setView("history")}
            >
              History
            </button>
          </div>
        </div>
        <div className="stage-body">
          {view === "library" ? (
            <MotionLibrary form={form} />
          ) : (
            <Feed
              workflow={(id) => id.startsWith("remix-")}
              empty={<div className="empty">No remix results yet</div>}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export function RemixPage({ workflow }: { workflow?: string }) {
  const all = useStudio((s) => s.workflows);
  const loaded = useStudio((s) => s.workflowsLoaded);
  const error = useStudio((s) => s.workflowsError);
  const workflows = all.filter((item) => item.family === "remix");
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
        {loaded ? "No remix workflows available" : "Loading remix workflows"}
      </div>
    );
  return <RemixWorkspace key={def.id} def={def} workflows={workflows} />;
}
