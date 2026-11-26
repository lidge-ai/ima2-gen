import { useSyncExternalStore } from "react";
import type { MediaKind } from "@ima2/studio-kit";

interface Props {
  kind: MediaKind;
  url: string;
  mimeType?: string;
  alt: string;
  /** Feed tiles autoplay muted and loop; detail views get controls. */
  variant?: "tile" | "detail";
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
function reducedMotion() { return window.matchMedia(motionQuery).matches; }
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => true);
}

export function MediaView({ kind, url, alt, variant = "detail" }: Props) {
  const reduce = useReducedMotion();
  if (kind === "image") return <img className="media" src={url} alt={alt} loading="lazy" decoding="async" />;
  if (kind === "audio") {
    return (
      <div className="media media-audio">
        <span className="media-audio-label">{alt}</span>
        <audio src={url} controls preload="metadata" aria-label={alt} />
      </div>
    );
  }
  if (variant === "tile") {
    return <video key={String(reduce)} className="media" src={url} muted loop={!reduce} autoPlay={!reduce} playsInline preload="metadata" aria-label={alt} />;
  }
  return <video className="media" src={url} controls playsInline preload="metadata" aria-label={alt} />;
}

export function downloadName(url: string, fallback: string): string {
  const last = url.split("?")[0]?.split("/").pop();
  return last && last.includes(".") ? last : fallback;
}
