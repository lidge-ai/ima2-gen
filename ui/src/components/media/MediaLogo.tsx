import { useEffect, useState } from "react";
import type { MediaLogo as Logo } from "../../lib/mediaCatalog";

/** The first letter or digit of a name, for makers that publish no square symbol. */
export function monogram(name: string): string {
  return (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase();
}

/**
 * A maker or provider in one fixed square. The slot shows the official square symbol when the catalog
 * has one, unaltered on a light tile; otherwise a monogram. Wordmarks are never squeezed into it, so
 * every row starts with the same shape at the same size.
 */
export function MediaLogo({ logo, label, size = "md" }: { logo: Logo | null | undefined; label: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const mark = logo?.urls.mark;
  useEffect(() => setFailed(false), [mark]);
  if (mark && !failed) {
    return <span className={"media-mark media-mark--" + size} aria-hidden="true"><img src={mark} alt="" onError={() => setFailed(true)} /></span>;
  }
  return <span className={"media-mark media-mark--" + size + " media-mark--monogram"} aria-hidden="true">{monogram(logo?.name || label)}</span>;
}
