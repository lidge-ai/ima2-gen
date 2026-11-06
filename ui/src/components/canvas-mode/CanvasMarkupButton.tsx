import { useI18n } from "../../i18n";

export function CanvasMarkupButton({ onClick, enabled, busy, disabled }: {
  onClick: () => void; enabled: boolean; busy: boolean; disabled: boolean;
}) {
  const { t } = useI18n();
  const label = t(enabled ? "canvas.toolbar.editMarkup" : "canvas.toolbar.editMarkupDisabled");
  return (
    <button type="button" onClick={onClick} disabled={!enabled || busy || disabled}
      className={`canvas-toolbar__button canvas-toolbar__button--primary${busy ? " canvas-toolbar__button--busy" : ""}`}
      aria-label={label} title={label}>
      {busy ? <span className="canvas-toolbar__spinner" aria-hidden="true" /> : (
        <svg className="canvas-toolbar__icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="m7 16 3-4 2 2 4-6M14 8h2v2" />
        </svg>
      )}
    </button>
  );
}
