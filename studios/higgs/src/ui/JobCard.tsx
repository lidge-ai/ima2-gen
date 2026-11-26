import { isTerminal, type Job, type JobError } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { href } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { MediaView, downloadName } from "./MediaView.tsx";
import { timeAgo } from "./format.ts";
import { ModelName, ProviderName } from "./ModelName.tsx";

const STATUS_TEXT: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Generating",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

const ERROR_HINT: Partial<Record<JobError["category"], string>> = {
  auth: "The provider rejected the key. Check it on the API keys page.",
  quota: "The provider account is out of credit or quota.",
  "rate-limit": "The provider is rate limiting this key. Try again in a moment.",
  moderation: "The provider's safety filter blocked this request. Change the prompt or inputs.",
  "invalid-request": "The provider did not accept these settings.",
  timeout: "The provider took too long to answer.",
  upstream: "The provider had a server error.",
};

function prompt(job: Job): string {
  const request = job.request as { prompt?: string };
  return request.prompt ?? job.target;
}

function ErrorBlock({ error }: { error: JobError }) {
  return (
    <div className="job-error" role="alert">
      <Icon name="alert" />
      <div>
        <p>{ERROR_HINT[error.category] ?? "The job failed."}</p>
        <p className="job-error-detail"><code>{error.code}</code> {error.message}</p>
        {error.category === "auth" ? <a href={href("keys")}>Open API keys</a> : null}
      </div>
    </div>
  );
}

function Steps({ job }: { job: Job }) {
  if (!job.steps?.length) return null;
  return (
    <ol className="job-steps" aria-label="Steps">
      {job.steps.map((step) => (
        <li key={step.id} className={"job-step is-" + step.status}>
          <span className="job-step-dot" aria-hidden />
          <span>{step.label}</span>
          <span className="job-step-status">{STATUS_TEXT[step.status]}</span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ job }: { job: Job }) {
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <div className="job-progress" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress === undefined ? undefined : pct}>
      <div className={"job-progress-bar" + (job.progress === undefined ? " is-indeterminate" : "")} style={{ width: job.progress === undefined ? undefined : pct + "%" }} />
    </div>
  );
}

export function JobCard({ job }: { job: Job }) {
  const studio = useStudioApi();
  const active = !isTerminal(job);
  const text = prompt(job);
  return (
    <article className={"job-card is-" + job.status} aria-label={STATUS_TEXT[job.status] + ": " + text}>
      <header className="job-head">
        <span className={"status-pill is-" + job.status}>{STATUS_TEXT[job.status]}</span>
        <span className="job-target">
          {job.kind === "media" ? <ModelName id={job.target} /> : <span>{job.target}</span>}
          {job.provider && job.provider !== "local" ? <span className="job-via">via <ProviderName id={job.provider} /></span> : null}
        </span>
        <time className="job-time" dateTime={job.createdAt}>{timeAgo(job.createdAt)}</time>
      </header>
      <p className="job-prompt">{text}</p>
      <Steps job={job} />
      {active ? <Progress job={job} /> : null}
      {active ? (
        <button type="button" className="btn btn-ghost" onClick={() => { void studio.cancel(job.jobId); }}>
          <Icon name="stop" size={14} /> Cancel
        </button>
      ) : null}
      {job.status === "failed" && job.error ? <ErrorBlock error={job.error} /> : null}
      {job.outputs.length > 0 ? (
        <div className="job-outputs">
          {job.outputs.map((output) => (
            <figure key={output.url} className="job-output">
              <MediaView kind={output.kind} url={output.url} mimeType={output.mimeType} alt={text} />
              <figcaption>
                <a className="btn btn-ghost" href={output.url} download={downloadName(output.url, job.jobId)}>
                  <Icon name="download" size={14} /> Download
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </article>
  );
}
