// Drop handling for the composer, extracted so PromptComposer stays inside its 500-line
// budget and so the "every dropped file gets an outcome" rule has one owner rather than
// one copy per surface.
//
// devlog/_plan/260908_xai_imagine_spec_resync/030_wp35_gui_inputs.md
import { useI18n } from "../../i18n";
import { useAppStore } from "../../store/useAppStore";
import { sortDroppedByKind, type DropRejection } from "../../lib/droppedMedia";

type DropHandlers = {
  onImages: (files: File[]) => void;
};

/**
 * Returns the message for a rejection reason.
 *
 * A switch rather than a lookup table: the repo's i18n guard requires every t() call to
 * name a literal key so it can prove the key exists, and an exhaustive switch gives the
 * compiler the same guarantee a typed map would.
 */
function rejectionMessage(reason: DropRejection, t: (key: string) => string): string {
  switch (reason) {
    case "audio-upload-unsupported": return t("prompt.rejectAudioUploadUnsupported");
    case "video-needs-base": return t("prompt.rejectVideoNeedsBase");
    case "video-single-only": return t("prompt.rejectVideoSingleOnly");
    case "not-media": return t("prompt.rejectNotMedia");
  }
}

export function useComposerDrop({ onImages }: DropHandlers) {
  const { t } = useI18n();
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const showToast = useAppStore((s) => s.showToast);

  return (files: File[]): void => {
    if (files.length === 0) return;
    const sorted = sortDroppedByKind(files, { videoModelSelected });
    if (sorted.images.length > 0) onImages(sorted.images);
    if (sorted.videos.length > 0) {
      // Editing and extending exist as routes but have no composer entry point yet.
      showToast(t("prompt.videoUseCliForEdit"), true);
    }
    // One message per reason, not per file: six unsupported files should not stack six
    // identical toasts.
    for (const reason of new Set(sorted.rejected.map((entry) => entry.reason))) {
      showToast(rejectionMessage(reason, t), true);
    }
  };
}

