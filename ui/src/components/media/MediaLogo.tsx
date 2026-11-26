import { useEffect, useState } from "react";
import { logoPlate, logoUrl, type MediaLogo as Logo } from "../../lib/mediaCatalog";

/** A vendor or provider logo file shown unaltered on a matching plate; the name when no file loads. */
export function MediaLogo({ logo, label, size = "md" }: { logo: Logo | null | undefined; label: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const url = logoUrl(logo);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <span className={`media-logo media-logo--${size} media-logo--${logoPlate(logo)}`}><img src={url} alt="" onError={() => setFailed(true)} /></span>;
  }
  return <span className={`media-logo media-logo--${size} media-logo__fallback`} aria-hidden="true">{(logo?.name || label).slice(0, 12)}</span>;
}
