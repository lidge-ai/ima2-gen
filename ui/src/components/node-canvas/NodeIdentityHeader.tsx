import { useCallback } from "react";
import { useI18n } from "../../i18n";
import { copyTextToClipboard } from "../../lib/clipboard";
import { useAppStore } from "../../store/useAppStore";

type Props = {
  nodeId: string;
};

/**
 * The node's id above its preview. The id text is plain and stays draggable,
 * because this strip is where users grab the node; copying lives on its own
 * nodrag icon so dragging from the icon never moves the node. Long generated
 * ids are truncated; the full id stays in the tooltip and in what is copied.
 */
export function NodeIdentityHeader({ nodeId }: Props) {
  const { t } = useI18n();
  const showToast = useAppStore((s) => s.showToast);
  const copyId = useCallback(async () => {
    try {
      await copyTextToClipboard(nodeId);
      showToast(t("toast.metadataCopied"));
    } catch {
      showToast(t("toast.copyFailed"), true);
    }
  }, [nodeId, showToast, t]);
  return (
    <div className="image-node__id" title={nodeId}>
      <span className="image-node__id-text">{nodeId}</span>
      <button
        type="button"
        className="image-node__id-copy nodrag"
        onClick={(event) => { event.stopPropagation(); void copyId(); }}
        title={t("node.copyId")}
        aria-label={t("node.copyId")}
      >
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
