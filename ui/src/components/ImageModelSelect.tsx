import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IMAGE_MODEL_OPTIONS, OPENAI_IMAGE_MODEL_OPTIONS, GROK_IMAGE_MODEL_OPTIONS, GEMINI_IMAGE_MODEL_OPTIONS, UNSUPPORTED_IMAGE_MODELS, VIDEO_MODEL_OPTIONS, isGeminiImageModel } from "../lib/imageModels";
import { REASONING_EFFORT_OPTIONS, type ReasoningEffort } from "../lib/reasoning";
import { useAppStore } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { Select } from "./controls/Select";

type ImageModelSelectProps = {
  variant: "settings" | "sidebar";
};

export function ImageModelSelect({ variant }: ImageModelSelectProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 12,
    width: 280,
    maxHeight: 480,
  });
  const imageModel = useAppStore((s) => s.imageModel);
  const provider = useAppStore((s) => s.provider);
  const setImageModel = useAppStore((s) => s.setImageModel);
  const setProvider = useAppStore((s) => s.setProvider);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const selectVideoModel = useAppStore((s) => s.selectVideoModel);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);
  const id = variant === "settings" ? "settings-image-model" : "sidebar-image-model";
  const modelOptions = IMAGE_MODEL_OPTIONS;
  const current = modelOptions.find((option) => option.value === imageModel && (!option.providerHint || option.providerHint === provider))
    ?? modelOptions.find((option) => option.value === imageModel)
    ?? modelOptions[0];
  const currentReasoning = REASONING_EFFORT_OPTIONS.find((option) => option.value === reasoningEffort)
    ?? REASONING_EFFORT_OPTIONS[0];


  const getMenuItems = () => menuItemRefs.current.filter(
    (item): item is HTMLButtonElement => item !== null,
  );

  const focusMenuItem = (index: number) => {
    const items = getMenuItems();
    if (items.length === 0) return;
    const normalizedIndex = (index + items.length) % items.length;
    items[normalizedIndex]?.focus();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const lastIndex = items.length - 1;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusMenuItem(currentIndex >= 0 ? currentIndex + 1 : 0);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusMenuItem(currentIndex >= 0 ? currentIndex - 1 : lastIndex);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusMenuItem(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusMenuItem(lastIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  useEffect(() => {
    if (variant !== "sidebar" || !open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, variant]);

  // Portal the sidebar menu to document.body to escape the sidebar's overflow clipping.
  // Position it under the trigger; close on scroll/resize so the fixed menu never detaches
  // from the (independently scrollable) sidebar trigger.
  useLayoutEffect(() => {
    if (variant !== "sidebar" || !open) return;
    const measure = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const gutter = 12;
        const width = Math.min(280, Math.max(218, window.innerWidth - gutter * 2));
        const preferredLeft = rect.right - width;
        const maxLeft = window.innerWidth - width - gutter;
        const left = Math.max(gutter, Math.min(preferredLeft, maxLeft));
        const top = rect.bottom + 7;
        const maxHeight = Math.max(160, window.innerHeight - top - gutter);
        setMenuPos({ top, left, width, maxHeight });
      }
    };
    measure();
    const close = (event?: Event) => {
      // Scrolling inside the menu itself must not dismiss it — only outside
      // scrolls (sidebar/page) detach the fixed menu from its trigger.
      if (event && menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const scroller = document.querySelector(".sidebar__scroll");
    scroller?.addEventListener("scroll", close, { passive: true });
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      scroller?.removeEventListener("scroll", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, variant]);

  useEffect(() => {
    if (variant !== "sidebar" || !open) return;

    const activeIndex = modelOptions.findIndex((option) => option.value === imageModel);
    const frame = requestAnimationFrame(() => {
      focusMenuItem(activeIndex >= 0 ? activeIndex : 0);
    });

    return () => cancelAnimationFrame(frame);
  }, [imageModel, modelOptions, open, variant]);

  if (variant === "sidebar") {
    const triggerModel = videoModelSelected
      ? (VIDEO_MODEL_OPTIONS.find((o) => o.value === videoModelSelected)?.shortLabel ?? VIDEO_MODEL_OPTIONS[0].shortLabel)
      : current.shortLabel.split(" ")[0];
    const triggerEffort = isGeminiImageModel(imageModel)
      ? current.shortLabel.split(" ")[1] || ""
      : currentReasoning.shortLabel;

    return (
      <div ref={rootRef} className="image-model-select image-model-select--sidebar">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className="image-model-select__trigger image-model-select__trigger--pill"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("sidebar.quickSettingsAria", {
            model: triggerModel,
            effort: triggerEffort,
          })}
          onClick={() => setOpen((next) => !next)}
        >
          <span className="image-model-select__trigger-top">
            <span className="image-model-select__trigger-model">{triggerModel}</span>
            <span className="image-model-select__trigger-chevron" aria-hidden="true">▾</span>
          </span>
          <span className="image-model-select__trigger-effort">{triggerEffort}</span>
        </button>
        {open ? createPortal(
          <div
            ref={menuRef}
            className="image-model-select__menu"
            role="menu"
            aria-label={t("sidebar.quickSettingsMenu")}
            onKeyDown={handleMenuKeyDown}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
              overflowY: "auto",
              zIndex: 160,
            }}
          >
            <div className="image-model-select__section" role="group" aria-label={t("sidebar.imageSectionLabel")}>
              <div className="image-model-select__section-title">{t("sidebar.imageSectionLabel")}</div>
              <div className="image-model-select__subsection-title">{t("sidebar.gptImageSubLabel")}</div>
              {OPENAI_IMAGE_MODEL_OPTIONS.map((option, index) => (
                <button
                  key={option.value}
                  ref={(node) => {
                    menuItemRefs.current[index] = node;
                  }}
                  type="button"
                  className={`image-model-select__item${option.value === imageModel && !videoModelSelected ? " is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={option.value === imageModel && !videoModelSelected}
                  tabIndex={-1}
                  onClick={() => {
                    setImageModel(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.shortLabel}</span>
                  <small>{t(option.fullLabelKey)}</small>
                </button>
              ))}
              <div className="image-model-select__subsection-title">{t("sidebar.grokImageSubLabel")}</div>
              {GROK_IMAGE_MODEL_OPTIONS.map((option, index) => (
                <button
                  key={option.value}
                  ref={(node) => {
                    menuItemRefs.current[OPENAI_IMAGE_MODEL_OPTIONS.length + index] = node;
                  }}
                  type="button"
                  className={`image-model-select__item${option.value === imageModel && !videoModelSelected ? " is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={option.value === imageModel && !videoModelSelected}
                  tabIndex={-1}
                  onClick={() => {
                    setImageModel(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.shortLabel}</span>
                  <small>{t(option.fullLabelKey)}</small>
                </button>
              ))}
              <div className="image-model-select__subsection-title">{t("sidebar.geminiImageSubLabel")}</div>
              {GEMINI_IMAGE_MODEL_OPTIONS.map((option, index) => {
                const hint = option.providerHint;
                const isActive = option.value === imageModel && hint === provider && !videoModelSelected;
                return (
                  <button
                    key={`${option.value}-${hint || index}`}
                    ref={(node) => {
                      menuItemRefs.current[OPENAI_IMAGE_MODEL_OPTIONS.length + GROK_IMAGE_MODEL_OPTIONS.length + index] = node;
                    }}
                    type="button"
                    className={`image-model-select__item${isActive ? " is-active" : ""}`}
                    role="menuitemradio"
                    aria-checked={isActive}
                    tabIndex={-1}
                    onClick={() => {
                      if (hint) setProvider(hint);
                      setImageModel(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>{option.shortLabel}</span>
                    <small>{t(option.fullLabelKey)}</small>
                  </button>
                );
              })}
            </div>
            <div className="image-model-select__section" role="group" aria-label={t("sidebar.videoSectionLabel")}>
              <div className="image-model-select__section-title">{t("sidebar.videoSectionLabel")}</div>
              {VIDEO_MODEL_OPTIONS.map((option, index) => (
                <button
                  key={option.value}
                  ref={(node) => {
                    menuItemRefs.current[modelOptions.length + index] = node;
                  }}
                  type="button"
                  className={`image-model-select__item${videoModelSelected === option.value ? " is-active" : ""}`}
                  role="menuitemradio"
                  aria-checked={videoModelSelected === option.value}
                  tabIndex={-1}
                  onClick={() => {
                    selectVideoModel(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.shortLabel}</span>
                  <small>{t(option.fullLabelKey)}</small>
                </button>
              ))}
            </div>
            {!isGeminiImageModel(imageModel) && (
              <details className="image-model-select__section image-model-select__collapsible">
                <summary className="image-model-select__section-title image-model-select__section-title--toggle">
                  {t("sidebar.reasoningLabel")}
                  <span className="image-model-select__chevron" aria-hidden="true">▸</span>
                </summary>
                <div role="group" aria-label={t("sidebar.reasoningLabel")}>
                  {REASONING_EFFORT_OPTIONS.map((option, index) => (
                    <button
                      key={option.value}
                      ref={(node) => {
                        menuItemRefs.current[modelOptions.length + VIDEO_MODEL_OPTIONS.length + index] = node;
                      }}
                      type="button"
                      className={`image-model-select__item${option.value === reasoningEffort ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={option.value === reasoningEffort}
                      tabIndex={-1}
                      onClick={() => {
                        setReasoningEffort(option.value as ReasoningEffort);
                        setOpen(false);
                      }}
                    >
                      <span>{option.shortLabel}</span>
                      <small>{t(option.fullLabelKey)}</small>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>,
          document.body,
        ) : null}
      </div>
    );
  }

  // Settings lists every option across lanes, so a model value alone cannot say
  // which lane's row was picked (nano-banana-2 exists on agy and gemini-api).
  // The item value carries the hint so each row selects what its label advertises.
  const optionItemValue = (option: (typeof modelOptions)[number]) =>
    option.providerHint ? `${option.providerHint}:${option.value}` : option.value;

  return (
    <div className="image-model-select image-model-select--settings">
      <Select
        id={id}
        value={optionItemValue(current)}
        onChange={(value) => {
          const option = modelOptions.find((candidate) => optionItemValue(candidate) === value);
          if (!option) return;
          if (option.providerHint) setProvider(option.providerHint);
          setImageModel(option.value);
        }}
        items={[
          ...modelOptions.map((option) => ({
            value: optionItemValue(option),
            label: t(option.fullLabelKey),
            ...(option.providerHint ? { sub: option.providerHint } : {}),
          })),
          ...UNSUPPORTED_IMAGE_MODELS.map((option) => ({
            value: option.value,
            label: t(option.fullLabelKey),
            disabled: true,
          })),
        ]}
      />
    </div>
  );
}
