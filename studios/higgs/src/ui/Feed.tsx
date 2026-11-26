import { useState, type ReactNode } from "react";
import { isTerminal, type HistoryItem, type Job, type MediaKind } from "@ima2/studio-kit";
import { useStudio, useStudioApi } from "../studio/context.tsx";
import { JobCard } from "./JobCard.tsx";
import { Lightbox } from "./Lightbox.tsx";
import { MediaView } from "./MediaView.tsx";

interface Props {
  kind?: MediaKind;
  /** Only jobs and results of these workflow families or ids. */
  workflow?: (id: string) => boolean;
  empty: ReactNode;
  density?: "comfortable" | "compact";
}

function jobMatches(job: Job, kind: MediaKind | undefined, kindOf: (model: string) => MediaKind | undefined, workflow?: Props["workflow"]): boolean {
  if (workflow) return job.kind === "workflow" && workflow(job.target);
  if (job.kind === "workflow") return false;
  return !kind || kindOf(job.target) === kind;
}

export function Tile({ item, onOpen }: { item: HistoryItem; onOpen: (item: HistoryItem) => void }) {
  return (
    <button type="button" className={"tile tile-" + item.kind} onClick={() => onOpen(item)} aria-label={"Open " + (item.prompt ?? item.model)}>
      <MediaView kind={item.kind} url={item.thumbUrl ?? item.url} alt={item.prompt ?? item.model} variant="tile" />
      <span className="tile-caption">{item.model}</span>
    </button>
  );
}

/** Live jobs on top, then saved results. Finished jobs show up as results. */
export function Feed({ kind, workflow, empty, density = "comfortable" }: Props) {
  const studio = useStudioApi();
  const jobOrder = useStudio((s) => s.jobOrder);
  const jobsById = useStudio((s) => s.jobs);
  const jobs = jobOrder.map((id) => jobsById[id]).filter((j): j is Job => !!j);
  const catalog = useStudio((s) => s.catalog);
  const history = useStudio((s) => s.history);
  const cursor = useStudio((s) => s.historyCursor);
  const loaded = useStudio((s) => s.historyLoaded);
  const [open, setOpen] = useState<HistoryItem | null>(null);
  const kindOf = (model: string) => catalog?.models.find((m) => m.id === model)?.kind;
  const visibleJobs = jobs.filter((job) => jobMatches(job, kind, kindOf, workflow) && (!isTerminal(job) || job.status !== "succeeded"));
  const items = history.filter((item) => (workflow ? !!item.workflow && workflow(item.workflow) : (!kind || item.kind === kind) && !item.workflow));
  if (loaded && visibleJobs.length === 0 && items.length === 0) return <>{empty}</>;
  return (
    <div className="feed">
      {visibleJobs.length > 0 ? (
        <section className="job-list" aria-label="In progress and recent">
          {visibleJobs.slice(0, 12).map((job) => <JobCard key={job.jobId} job={job} />)}
        </section>
      ) : null}
      <section className={"grid grid-" + density} aria-label="Results">
        {items.map((item) => <Tile key={item.historyId} item={item} onOpen={setOpen} />)}
      </section>
      {cursor ? <button type="button" className="btn load-more" onClick={() => { void studio.loadHistory(); }}>Load more</button> : null}
      <Lightbox item={open} onClose={() => setOpen(null)} />
    </div>
  );
}
