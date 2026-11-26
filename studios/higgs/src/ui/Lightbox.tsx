import { useEffect, useRef, useState } from "react";
import type { HistoryItem } from "@ima2/studio-kit";
import { useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";
import { MediaView, downloadName } from "./MediaView.tsx";
import { handOff } from "../studio/handoff.ts";
import { navigate } from "../router.ts";
import { timeAgo } from "./format.ts";
import { ModelName, ProviderName } from "./ModelName.tsx";

interface Props {
  item: HistoryItem | null;
  onClose: () => void;
}

function LightboxActions({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const studio = useStudioApi();
  const [error, setError] = useState("");
  const perform = async (action: "save" | "delete") => {
    setError("");
    try {
      if (action === "save") await studio.toggleFavorite(item);
      else {
        await studio.removeHistory(item.historyId);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const reuse = (target: "video" | "remix" | "image") => {
    handOff({ url: item.url, mimeType: item.mimeType, name: downloadName(item.url, item.historyId), target });
    onClose();
    navigate(target);
  };
  return (
    <div className="lightbox-actions">
      <a className="btn" href={item.url} download={downloadName(item.url, item.historyId)}>
        <Icon name="download" size={15} /> Download
      </a>
      <button
        type="button"
        className="btn"
        aria-pressed={!!item.favorite}
        onClick={() => {
          void perform("save");
        }}
      >
        <Icon name="heart" size={15} /> {item.favorite ? "Saved" : "Save"}
      </button>
      {item.kind === "image" ? (
        <button type="button" className="btn" onClick={() => reuse("video")}>
          <Icon name="video" size={15} /> Animate
        </button>
      ) : null}
      {item.kind === "image" ? (
        <button type="button" className="btn" onClick={() => reuse("image")}>
          <Icon name="image" size={15} /> Edit
        </button>
      ) : null}
      {item.kind === "video" ? (
        <button type="button" className="btn" onClick={() => reuse("remix")}>
          <Icon name="remix" size={15} /> Remix
        </button>
      ) : null}
      <button
        type="button"
        className="btn btn-danger"
        onClick={() => {
          void perform("delete");
        }}
      >
        <Icon name="trash" size={15} /> Delete
      </button>
      {error ? <p role="alert">Action failed: {error}</p> : null}
    </div>
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
            <dl className="meta-list">
              <dt>Model</dt>
              <dd>
                <ModelName id={item.model} />
              </dd>
              {item.provider ? (
                <>
                  <dt>Ran through</dt>
                  <dd>
                    <ProviderName id={item.provider} />
                  </dd>
                </>
              ) : null}
              {item.workflow ? (
                <>
                  <dt>Workflow</dt>
                  <dd>{item.workflow}</dd>
                </>
              ) : null}
              <dt>Created</dt>
              <dd>
                <time dateTime={item.createdAt}>{timeAgo(item.createdAt)}</time>
              </dd>
              {item.width && item.height ? (
                <>
                  <dt>Size</dt>
                  <dd>
                    {item.width} x {item.height}
                  </dd>
                </>
              ) : null}
              {item.durationSec ? (
                <>
                  <dt>Length</dt>
                  <dd>{item.durationSec}s</dd>
                </>
              ) : null}
            </dl>
            <LightboxActions item={item} onClose={onClose} />
          </aside>
        </div>
      ) : null}
    </dialog>
  );
}
