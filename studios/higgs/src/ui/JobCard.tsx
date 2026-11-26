import { messages, useT } from "../i18n.ts";
import { isTerminal, type Job, type JobError } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { href } from "../router.ts";
import { Icon } from "./Icon.tsx";
import { MediaView, downloadName } from "./MediaView.tsx";
import { timeAgo } from "./format.ts";
import { ModelName, ProviderName } from "./ModelName.tsx";

const M = messages(
  { queued: "Queued", running: "Generating", succeeded: "Done", failed: "Failed", canceled: "Canceled", auth: "The provider rejected the key. Check it on the API keys page.", quota: "The provider account is out of credit or quota.", rate: "The provider is rate limiting this key. Try again in a moment.", moderation: "The provider's safety filter blocked this request. Change the prompt or inputs.", invalid: "The provider did not accept these settings. Check the settings and try again.", timeout: "The provider took too long to answer. Try again.", upstream: "The provider had a server error. Try again.", unknown: "The job failed. Check the settings and try again.", keys: "Open API keys", steps: "Steps", progress: "Progress", via: "via", cancel: "Cancel", download: "Download" },
  { queued: "대기 중", running: "생성 중", succeeded: "완료", failed: "실패", canceled: "취소됨", auth: "제공업체가 키를 거부했어요. API 키 페이지에서 확인하세요.", quota: "제공업체 계정의 크레딧이나 할당량이 부족해요.", rate: "요청이 너무 많아요. 잠시 후 다시 시도하세요.", moderation: "제공업체의 안전 필터가 요청을 차단했어요. 프롬프트나 입력을 바꿔주세요.", invalid: "제공업체가 설정을 거부했어요. 설정을 확인하고 다시 시도하세요.", timeout: "제공업체 응답이 늦어요. 다시 시도하세요.", upstream: "제공업체에 오류가 생겼어요. 다시 시도하세요.", unknown: "작업에 실패했어요. 설정을 확인하고 다시 시도하세요.", keys: "API 키 열기", steps: "단계", progress: "진행률", via: "제공", cancel: "취소", download: "다운로드" },
);
const ERROR_KEY: Partial<Record<JobError["category"], keyof typeof M.en>> = {
  auth: "auth", quota: "quota", "rate-limit": "rate", moderation: "moderation",
  "invalid-request": "invalid", timeout: "timeout", upstream: "upstream",
};

function prompt(job: Job): string {
  const request = job.request as { prompt?: string };
  return request.prompt ?? job.target;
}

function ErrorBlock({ error }: { error: JobError }) {
  const t = useT(M);
  return (
    <div className="job-error" role="alert">
      <Icon name="alert" />
      <div>
        <p>{t(ERROR_KEY[error.category] ?? "unknown")}</p>
        <p className="job-error-detail">
          <code>{error.code}</code> {error.message}
        </p>
        {error.category === "auth" ? <a href={href("keys")}>{t("keys")}</a> : null}
      </div>
    </div>
  );
}

function Steps({ job }: { job: Job }) {
  const t = useT(M);
  if (!job.steps?.length) return null;
  return (
    <ol className="job-steps" aria-label={t("steps")}>
      {job.steps.map((step) => (
        <li key={step.id} className={"job-step is-" + step.status}>
          <span className="job-step-dot" aria-hidden />
          <span>
            {step.label}
            {step.model ? <ModelName id={step.model} /> : null}
            {step.provider ? <ProviderName id={step.provider} /> : null}
          </span>
          <span className="job-step-status">{t(step.status)}</span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ job }: { job: Job }) {
  const t = useT(M);
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <div
      className="job-progress"
      role="progressbar"
      aria-label={t("progress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={job.progress === undefined ? undefined : pct}
    >
      <div
        className={"job-progress-bar" + (job.progress === undefined ? " is-indeterminate" : "")}
        style={{ width: job.progress === undefined ? undefined : pct + "%" }}
      />
    </div>
  );
}

function JobHeader({ job }: { job: Job }) {
  const t = useT(M);
  return (
    <header className="job-head">
      <span className={"status-pill is-" + job.status}>{t(job.status)}</span>
      <span className="job-target">
        {job.kind === "media" ? <ModelName id={job.target} /> : <span>{job.target}</span>}
        {job.provider && job.provider !== "local" ? (
          <span className="job-via">
            {t("via")} <ProviderName id={job.provider} />
          </span>
        ) : null}
      </span>
      <time className="job-time" dateTime={job.createdAt}>
        {timeAgo(job.createdAt)}
      </time>
    </header>
  );
}

export function JobCard({ job }: { job: Job }) {
  const t = useT(M);
  const studio = useStudioApi();
  const active = !isTerminal(job);
  const text = prompt(job);
  return (
    <article className={"job-card is-" + job.status} aria-label={t(job.status) + ": " + text}>
      <JobHeader job={job} />
      <p className="job-prompt">{text}</p>
      <Steps job={job} />
      {active ? <Progress job={job} /> : null}
      {active ? (
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void studio.cancel(job.jobId);
          }}
        >
          <Icon name="stop" size={14} /> {t("cancel")}
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
                  <Icon name="download" size={14} /> {t("download")}
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </article>
  );
}
