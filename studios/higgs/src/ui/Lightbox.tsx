import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HistoryItem } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { MediaView, downloadName } from "./MediaView.tsx";
import { handOff } from "../studio/handoff.ts";
import { navigate } from "../router.ts";
import { timeAgo } from "./format.ts";
import { ModelName, ProviderName } from "./ModelName.tsx";

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
}

type Target = "video" | "remix" | "image";

const REUSE: Record<HistoryItem["kind"], readonly { target: Target; label: string; icon: IconName }[]> = {
  image: [
    { target: "video", label: "Animate", icon: "video" },
    { target: "image", label: "Edit", icon: "image" },
  ],
  video: [{ target: "remix", label: "Remix", icon: "remix" }],
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
  const actions = useItemActions(item, onClose);
  const reuse = (target: Target) => {
    handOff({ url: item.url, mimeType: item.mimeType, name: downloadName(item.url, item.historyId), target });
    onClose();
    navigate(target);
  };
  return (
    <div className="lightbox-actions">
      <a className="btn" href={item.url} download={downloadName(item.url, item.historyId)}>
        <Icon name="download" size={15} /> Download
      </a>
      <button type="button" className="btn" aria-pressed={!!item.favorite} onClick={() => void actions.save()}>
        <Icon name="heart" size={15} /> {item.favorite ? "Saved" : "Save"}
      </button>
      {REUSE[item.kind].map((r) => (
        <button key={r.target} type="button" className="btn" onClick={() => reuse(r.target)}>
          <Icon name={r.icon} size={15} /> {r.label}
        </button>
      ))}
      <button type="button" className="btn btn-danger" onClick={() => void actions.remove()}>
        <Icon name="trash" size={15} /> Delete
      </button>
      {actions.error ? <p role="alert">Action failed: {actions.error}</p> : null}
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
  return (
    <dl className="meta-list">
      <Meta term="Model">
        <ModelName id={item.model} />
      </Meta>
      {item.provider ? (
        <Meta term="Ran through">
          <ProviderName id={item.provider} />
        </Meta>
      ) : null}
      {item.workflow ? <Meta term="Workflow">{item.workflow}</Meta> : null}
      <Meta term="Created">
        <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
      </Meta>
      {item.width && item.height ? <Meta term="Size">{item.width + " x " + item.height}</Meta> : null}
      {item.durationSec ? <Meta term="Length">{item.durationSec + "s"}</Meta> : null}
    </dl>
  );
}

/** Full view of one result with the actions a person takes next. */
export function Lightbox({ item, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);
  return (
    <dialog ref={ref} className="lightbox" onClose={onClose} aria-label="Result">
      {item ? (
        <div className="lightbox-body">
          <div className="lightbox-media">
            <MediaView kind={item.kind} url={item.url} mimeType={item.mimeType} alt={item.prompt ?? item.model} />
          </div>
          <aside className="lightbox-side">
            <button type="button" className="btn btn-ghost lightbox-close" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
            <p className="lightbox-prompt">{item.prompt ?? "No prompt"}</p>
            <MetaList item={item} />
            <LightboxActions item={item} onClose={onClose} />
          </aside>
        </div>
      ) : null}
    </dialog>
  );
}
