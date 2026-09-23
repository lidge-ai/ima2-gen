import { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { AssetMediaLightbox } from "../assetgen/AssetMediaLightbox";

type Props = {
  imageUrl: string;
  prompt: string;
};

/**
 * A ready node image with a zoom button that opens the shared lightbox.
 * The lightbox is portalled to document.body: the node sits inside React Flow's
 * scaled viewport, where the panel's percentage width would resolve against the
 * node (~300px) instead of the window.
 */
export function NodeImagePreview({ imageUrl, prompt }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <img src={imageUrl} alt={t("node.nodeImageAlt")} />
      <button
        type="button"
        className="image-node__zoom nodrag"
        title={t("node.zoomImage")}
        aria-label={t("node.zoomImage")}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      {open ? createPortal(
        <AssetMediaLightbox
            item={{
              image: imageUrl,
              url: imageUrl,
              prompt,
              filename: imageUrl.replace(/^\/generated\//, ""),
              mediaType: "image",
            }}
            onClose={() => setOpen(false)}
          />,
        document.body,
      ) : null}
    </>
  );
}
