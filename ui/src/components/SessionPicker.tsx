import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { EditIcon } from "./controls";

export function SessionPicker() {
  const { t } = useI18n();
  const sessions = useAppStore((s) => s.sessions);
  const activeId = useAppStore((s) => s.activeSessionId);
  const switchSession = useAppStore((s) => s.switchSession);
  const createSession = useAppStore((s) => s.createAndSwitchSession);
  const renameSession = useAppStore((s) => s.renameCurrentSession);
  const deleteSession = useAppStore((s) => s.deleteSessionById);
  const [open, setOpen] = useState(false);

  const active = sessions.find((s) => s.id === activeId);

  const handleRename = () => {
    const next = window.prompt(t("session.renamePrompt"), active?.title ?? t("session.newSession"));
    if (next && next.trim()) void renameSession(next.trim());
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(t("session.deleteConfirm", { title }))) return;
    void deleteSession(id);
  };

  return (
    <div className="session-picker">
      <div className="session-picker-row">
        <button
          type="button"
          className="session-current"
          onClick={() => setOpen((v) => !v)}
          title={t("session.switchTitle")}
        >
          <span className="session-title">{active?.title ?? t("session.loading")}</span>
          <span className="session-caret">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          className="session-btn"
          onClick={() => void createSession(t("session.newSession"))}
          title={t("session.newSessionTitle")}
        >
          +
        </button>
        <button
          type="button"
          className="session-btn"
          onClick={handleRename}
          title={t("session.renameTitle")}
          disabled={!active}
        >
          <EditIcon />
        </button>
      </div>
      {open && (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id} className={s.id === activeId ? "is-active" : ""}>
              <button
                type="button"
                className="session-item"
                onClick={() => {
                  setOpen(false);
                  void switchSession(s.id);
                }}
              >
                <span className="session-item-title">{s.title}</span>
                <span className="session-item-count">{s.nodeCount}</span>
              </button>
              <button
                type="button"
                className="session-del"
                onClick={() => handleDelete(s.id, s.title)}
                title={t("session.deleteTitle")}
              >
                ×
              </button>
            </li>
          ))}
          {sessions.length === 0 && (
            <li className="session-empty">{t("session.empty")}</li>
          )}
        </ul>
      )}
    </div>
  );
}
