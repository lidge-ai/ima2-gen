import { useRef, useState } from "react";
import { CAMERA_MOVES, MOVE_GROUPS, insertPhrase, moveGroupLabel, searchMoves, type CameraMove } from "../data/cameraMoves.ts";
import { messages, useT } from "../i18n.ts";
import { Icon } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

export const MM = messages(
  { button: "Camera move", title: "Camera moves", search: "Search camera moves", none: "No camera move matches.", lead: "Adds a sentence to your prompt. How closely it is followed depends on the model.", added: "Added to the prompt: {name}" },
  { button: "카메라 무브", title: "카메라 무브", search: "카메라 무브 검색", none: "맞는 카메라 무브가 없어요.", lead: "프롬프트에 문장을 하나 더해요. 얼마나 따르는지는 모델마다 달라요.", added: "프롬프트에 추가했어요: {name}" },
);

interface Props {
  /** The prompt as it is now. */
  value: string;
  onChange: (next: string) => void;
  /** The prompt's textarea, for the caret: the phrase goes where the person was typing. */
  field: () => HTMLTextAreaElement | null;
}

/**
 * A button that opens the camera moves. Choosing one inserts its phrase into the prompt at the caret, or at the
 * end when the prompt was not being edited; nothing already written is removed.
 */
export function CameraMoveMenu({ value, onChange, field }: Props) {
  const t = useT(MM);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  // The caret is read when the menu opens: opening it moves focus away from the prompt.
  const caret = useRef<{ start: number; end: number } | null>(null);
  const show = () => {
    const el = field();
    caret.current = el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    setQuery("");
    setAdded("");
    setOpen(true);
  };
  const pick = (move: CameraMove) => {
    const next = insertPhrase(value, move.phrase, caret.current?.start, caret.current?.end);
    onChange(next.text);
    setAdded(t("added", { name: move.label }));
    setOpen(false);
    // After the new text is in the field, the caret sits right after the inserted sentence.
    requestAnimationFrame(() => {
      const el = field();
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };
  const found = searchMoves(query);
  return (
    <>
      <button ref={trigger} type="button" className="chip" aria-haspopup="dialog" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : show())}>
        <Icon name="video" size={13} /> {t("button")}
      </button>
      {added ? <span className="visually-hidden" role="status">{added}</span> : null}
      {/* Beside the button where there is room, so the prompt stays readable while choosing. */}
      <Popover open={open} onClose={() => setOpen(false)} label={t("title")} className="menu-popover move-popover" anchor={trigger} placement="right">
        <p className="menu-title">{t("title")}</p>
        <label className="popover-search">
          <Icon name="search" size={15} />
          <input type="search" value={query} placeholder={t("search")} aria-label={t("search")} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <p className="move-lead">{t("lead")}</p>
        {found.length === 0 ? <p className="empty-line" role="status">{t("none")}</p> : null}
        <div className="move-list">
          {MOVE_GROUPS.filter((group) => found.some((move) => move.group === group)).map((group) => (
            <div key={group} role="group" aria-label={moveGroupLabel(group)} className="move-group">
              <p className="move-group-title">{moveGroupLabel(group)}</p>
              {found.filter((move) => move.group === group).map((move) => (
                <button key={move.id} type="button" className="menu-item move-item" title={move.phrase} onClick={() => pick(move)}>
                  <span className="menu-label">{move.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

export const MOVE_COUNT = CAMERA_MOVES.length;
