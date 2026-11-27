/**
 * Stand-in tile for a sound result: there is no picture to show, so the tile says what it is.
 * It takes the video placeholder's box so every list sizes it the same way, and renders no media element.
 */
export function AudioThumbPlaceholder({ className }: { className?: string }) {
  return <span className={["video-thumb-placeholder", "audio-thumb-placeholder", className].filter(Boolean).join(" ")} aria-hidden="true">♪</span>;
}
