import type { HistoryItem, Job } from "@ima2/studio-kit";

export function historyWorkflow(item: HistoryItem, jobs: Readonly<Record<string, Job>>): string | undefined {
  const job = jobs[item.jobId];
  return item.workflow ?? (job?.kind === "workflow" ? job.target : undefined);
}
