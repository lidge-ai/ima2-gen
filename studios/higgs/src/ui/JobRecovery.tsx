import type { Job, JobError } from "@ima2/studio-kit";
import { messages, useT } from "../i18n.ts";
import { href, navigate } from "../router.ts";
import { useStudio } from "../studio/context.tsx";
import { restoreDraft } from "../studio/draft.ts";
import { Icon } from "./Icon.tsx";

const M = messages(
  {
    keys: "Check the key",
    topUp: "Add credit at {provider}",
    newTab: "(new tab)",
    retry: "Try again",
    edit: "Edit the prompt",
  },
  {
    keys: "키 확인하기",
    topUp: "{provider}에서 크레딧 충전",
    newTab: "(새 탭)",
    retry: "다시 시도",
    edit: "프롬프트 고치기",
  },
);

type Kind = "image" | "video";

/** What the failure needs next, by category: one action, never a dead end. */
function actionFor(category: JobError["category"]): "keys" | "topUp" | "retry" | "edit" {
  if (category === "auth") return "keys";
  if (category === "quota") return "topUp";
  if (category === "rate-limit" || category === "timeout" || category === "upstream") return "retry";
  return "edit";
}

/**
 * Puts the prompt and model back into the form that made the job. Nothing is sent from here: a
 * retry focuses Generate, where the price shows, and the person presses it.
 */
function backToForm(kind: Kind, prompt: string, model: string, focus: "prompt" | "generate"): void {
  if (!restoreDraft(kind, prompt, model)) {
    navigate(kind, { model });
    return;
  }
  requestAnimationFrame(() => {
    const field = document.getElementById(kind + "-prompt");
    if (!(field instanceof HTMLTextAreaElement)) return;
    const generate = field.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (focus === "generate" && generate && !generate.disabled) generate.focus();
    else field.focus();
  });
}

export function JobRecovery({ job, error }: { job: Job; error: JobError }) {
  const t = useT(M);
  const provider = useStudio((s) => s.catalog?.providers.find((p) => p.id === job.provider));
  const kind = useStudio((s) => s.catalog?.models.find((m) => m.id === job.target)?.kind);
  const action = actionFor(error.category);
  if (action === "keys")
    return (
      <a className="btn" href={href("keys", { focus: provider?.keyVocabulary })}>
        <Icon name="key" size={14} /> {t("keys")}
      </a>
    );
  if (action === "topUp" && provider?.consoleUrl)
    return (
      <a className="btn" href={provider.consoleUrl} target="_blank" rel="noreferrer">
        {t("topUp", { provider: provider.label })} <Icon name="external" size={12} /> <span className="visually-hidden">{t("newTab")}</span>
      </a>
    );
  if (job.kind !== "media" || (kind !== "image" && kind !== "video")) return null;
  const prompt = (job.request as { prompt?: string }).prompt ?? "";
  const focus = action === "retry" ? "generate" : "prompt";
  return (
    <button type="button" className="btn" onClick={() => backToForm(kind, prompt, job.target, focus)}>
      {t(action === "retry" ? "retry" : "edit")}
    </button>
  );
}
