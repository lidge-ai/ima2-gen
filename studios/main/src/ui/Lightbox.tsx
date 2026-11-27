import { messages, useT } from "../i18n.ts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HistoryItem } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { MediaView, downloadName } from "./MediaView.tsx";
import { handOff } from "../studio/handoff.ts";
import { restoreDraft } from "../studio/draft.ts";
import { navigate } from "../router.ts";
import { timeAgo } from "./format.ts";
import { ModelName, ProviderName } from "./ModelName.tsx";
import { ComfyGraphButton } from "./ComfyGraphButton.tsx";

const M = messages(
  { animate: "Animate", edit: "Edit", remix: "Remix", download: "Download", saved: "Saved", save: "Save", delete: "Delete", actionFailed: "Action failed: {error}", model: "Model", provider: "Ran through", workflow: "Workflow", created: "Created", size: "Size", length: "Length", result: "Result", close: "Close", noPrompt: "No prompt", again: "Same prompt and model", copy: "Copy prompt", copied: "Prompt copied" },
  { animate: "영상 만들기", edit: "편집", remix: "리믹스", download: "다운로드", saved: "저장됨", save: "저장", delete: "삭제", actionFailed: "작업에 실패했어요: {error}", model: "모델", provider: "제공업체", workflow: "워크플로", created: "생성 시각", size: "크기", length: "길이", result: "결과", close: "닫기", noPrompt: "프롬프트 없음", again: "같은 프롬프트와 모델로", copy: "프롬프트 복사", copied: "프롬프트를 복사했어요" },
);

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
}

type Target = "video" | "remix" | "image";

const REUSE: Record<HistoryItem["kind"], readonly { target: Target; label: keyof typeof M.en; icon: IconName }[]> = {
  image: [
    { target: "video", label: "animate", icon: "video" },
    { target: "image", label: "edit", icon: "image" },
  ],
  video: [{ target: "remix", label: "remix", icon: "remix" }],
  audio: [],
};

/** Save and delete with a visible failure message. */
function useItemActions(item: HistoryItem, onClose: () => void) {
  const studio = useStudioApi();
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return {
    error,
    save: () => run(() => studio.toggleFavorite(item)),
    remove: () =>
      run(async () => {
        await studio.removeHistory(item.historyId);
        onClose();
      }),
  };
}

function LightboxActions({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const t = useT(M);
  const actions = useItemActions(item, onClose);
  const [copied, setCopied] = useState(false);
  const reuse = (target: Target) => {
    const taken = handOff({ url: item.url, mimeType: item.mimeType, name: downloadName(item.url, item.historyId), target });
    onClose();
    // The target screen may already be open behind this dialog; it took the result itself.
    if (!taken) navigate(target);
  };
  // Same prompt and model on the screen that made it: filled in place when that screen is open
  // behind this dialog, otherwise the screen opens with them as its draft.
  const again = item.kind === "image" || item.kind === "video" ? item.kind : null;
  const runAgain = () => {
    if (!again) return;
    const filled = restoreDraft(again, item.prompt ?? "", item.model);
    onClose();
    if (!filled) navigate(again, { model: item.model });
  };
  const copy = async () => {
    await navigator.clipboard.writeText(item.prompt ?? "");
    setCopied(true);
  };
  return (
    <div className="lightbox-actions">
      <a className="btn" href={item.url} download={downloadName(item.url, item.historyId)}>
        <Icon name="download" size={15} /> {t("download")}
      </a>
      {again && item.prompt ? (
        <button type="button" className="btn" onClick={runAgain}>
          <Icon name="sparkle" size={15} /> {t("again")}
        </button>
      ) : null}
      {item.prompt ? (
        <button type="button" className="btn" onClick={() => void copy().catch(() => setCopied(false))}>
          {t("copy")}
        </button>
      ) : null}
      <button type="button" className="btn" aria-pressed={!!item.favorite} onClick={() => void actions.save()}>
        <Icon name="heart" size={15} /> {item.favorite ? t("saved") : t("save")}
      </button>
      {REUSE[item.kind].map((r) => (
        <button key={r.target} type="button" className="btn" onClick={() => reuse(r.target)}>
          <Icon name={r.icon} size={15} /> {t(r.label)}
        </button>
      ))}
      <ComfyGraphButton key={item.historyId} item={item} />
      <button type="button" className="btn btn-danger" onClick={() => void actions.remove()}>
        <Icon name="trash" size={15} /> {t("delete")}
      </button>
      {actions.error ? <p role="alert">{t("actionFailed", { error: actions.error })}</p> : null}
      {copied ? <p role="status">{t("copied")}</p> : null}
    </div>
  );
}

function Meta({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

function MetaList({ item }: { item: HistoryItem }) {
  const t = useT(M);
  return (
    <dl className="meta-list">
      <Meta term={t("model")}>
        <ModelName id={item.model} />
      </Meta>
      {item.provider ? (
        <Meta term={t("provider")}>
          <ProviderName id={item.provider} />
        </Meta>
      ) : null}
      {item.workflow ? <Meta term={t("workflow")}>{item.workflow}</Meta> : null}
      <Meta term={t("created")}>
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </Meta>
      {item.width && item.height ? <Meta term={t("size")}>{item.width + " x " + item.height}</Meta> : null}
      {item.durationSec ? <Meta term={t("length")}>{item.durationSec + "s"}</Meta> : null}
    </dl>
  );
}

/** Full view of one result with the actions a person takes next. */
export function Lightbox({ item, onClose }: Props) {
  const t = useT(M);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);
  return (
    <dialog ref={ref} className="lightbox" onClose={onClose} aria-label={t("result")}>
      {item ? (
        <div className="lightbox-body">
          <div className="lightbox-media">
            <MediaView kind={item.kind} url={item.url} mimeType={item.mimeType} alt={item.prompt ?? item.model} />
          </div>
          <aside className="lightbox-side">
            <button type="button" className="btn btn-ghost lightbox-close" onClick={onClose} aria-label={t("close")}>
              <Icon name="close" />
            </button>
            <p className="lightbox-prompt">{item.prompt ?? t("noPrompt")}</p>
            <MetaList item={item} />
            <LightboxActions item={item} onClose={onClose} />
          </aside>
        </div>
      ) : null}
    </dialog>
  );
}
