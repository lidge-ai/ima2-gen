import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../store/useAppStore";
import { useModalFocus } from "../hooks/useModalFocus";
import { BrandMark } from "./BrandMark";
import {
  dismissStarPrompt,
  fetchStarCount,
  fetchStarStatus,
  isSessionImage,
  shouldOpenStarPrompt,
  starRepo,
  type StarStatus,
} from "../lib/githubStar";

type Phase = "ask" | "starring" | "thanks" | "failed";
const THANKS_CLOSE_MS = 1800;

// One-time GitHub star request, shown after the first image of a session.
export function StarPrompt() {
  const { t } = useI18n();
  const head = useAppStore((s) => s.history[0] ?? null);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const readinessOpen = useAppStore((s) => s.readinessPopupOpen);
  const mountedAt = useRef(Date.now());
  const statusRequested = useRef(false);
  const [status, setStatus] = useState<StarStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");
  const [count, setCount] = useState<number | null>(null);
  const headInput = head ? { createdAt: head.createdAt, mediaType: head.mediaType } : null;
  const sessionImage = isSessionImage(headInput, mountedAt.current);

  // Ask the server only after this session has produced an image: sessions that never
  // generate (and fixture transports that allow-list API reads) never see the request.
  useEffect(() => {
    if (statusRequested.current || !sessionImage) return;
    statusRequested.current = true;
    fetchStarStatus().then(setStatus).catch(() => { /* stay closed */ });
  }, [sessionImage]);

  useEffect(() => {
    if (open) return;
    const shouldOpen = shouldOpenStarPrompt({
      status,
      head: headInput,
      mountedAt: mountedAt.current,
      settingsOpen,
      readinessOpen,
    });
    if (!shouldOpen) return;
    setOpen(true);
    void fetchStarCount().then(setCount);
  }, [status, head, settingsOpen, readinessOpen, open]);

  useEffect(() => {
    if (phase !== "thanks") return;
    const timer = setTimeout(() => setOpen(false), THANKS_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const finish = () => {
    setOpen(false);
    setStatus((prev) => (prev ? { ...prev, prompted: true } : prev));
  };
  const dismiss = () => {
    finish();
    if (phase !== "thanks") void dismissStarPrompt().catch(() => { /* next launch asks again */ });
  };
  const modalRef = useModalFocus<HTMLDivElement>(open, dismiss);

  if (!open || !status) return null;

  const signedIn = status.state !== "unauthenticated";
  const star = async () => {
    setPhase("starring");
    const ok = await starRepo().catch(() => false);
    setPhase(ok ? "thanks" : "failed");
    if (ok) setStatus({ ...status, state: "starred", prompted: true });
  };
  const openRepo = () => {
    window.open(status.url, "_blank", "noopener");
    dismiss();
  };

  return (
    <div className="modal-backdrop star-prompt-backdrop" role="presentation">
      <div
        ref={modalRef}
        className="modal star-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="star-prompt-title"
        tabIndex={-1}
      >
        <BrandMark className="star-prompt__mark" />
        <div id="star-prompt-title" className="modal__title star-prompt__title">
          {phase === "thanks" ? t("starPrompt.thanks") : t("starPrompt.title")}
        </div>
        <div className="modal__body">
          <p>{t("starPrompt.body")}</p>
        </div>
        <div className="star-prompt__repo">
          <span>{status.repo}</span>
          {count !== null ? <span className="star-prompt__count">{t("starPrompt.count", { count })}</span> : null}
        </div>
        {phase === "failed" ? <p className="star-prompt__note" role="alert">{t("starPrompt.failed")}</p> : null}
        <div className="modal__actions star-prompt__actions">
          {signedIn && phase !== "failed" ? (
            <button
              type="button"
              className="modal__btn"
              onClick={() => void star()}
              disabled={phase !== "ask"}
              data-modal-initial-focus
            >
              {phase === "starring" ? t("starPrompt.starring") : t("starPrompt.star")}
            </button>
          ) : (
            <button type="button" className="modal__btn" onClick={openRepo} data-modal-initial-focus>
              {t("starPrompt.open")}
            </button>
          )}
          <button type="button" className="modal__btn modal__btn--secondary" onClick={dismiss}>
            {t("starPrompt.notNow")}
          </button>
        </div>
        <p className="star-prompt__note">{signedIn ? t("starPrompt.noteGh") : t("starPrompt.noteSignIn")}</p>
      </div>
    </div>
  );
}
