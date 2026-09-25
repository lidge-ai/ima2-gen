import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { useAppStore } from "../store/useAppStore";
import { composerUsesMultimode } from "../lib/coreGenerationMode";
import { useI18n } from "../i18n";
import { isVideoItem, extractLastFrame } from "../lib/videoMedia";
import type { VideoReferenceDragPayload } from "../lib/videoContinuity";
import { getPresetById } from "../lib/presets";
import { findMentionAtCaret, type MentionQuery } from "../lib/elementMention";
import { Chip, ChipRow } from "./controls";
import { ElementMentionMenu } from "./ElementMentionMenu";
import type { ElementMentionKind } from "./ElementMentionChip";
import { ReferenceTray } from "./composer/ReferenceTray";
import { ElementMentionChips } from "./composer/ElementMentionChips";
import { DeadTagMirror } from "./composer/DeadTagMirror";
import { PromptComposerToolbar } from "./composer/PromptComposerToolbar";
import { usePromptPaste } from "./composer/usePromptPaste";
import { composerAcceptAttr } from "../lib/droppedMedia"; import { useComposerDrop } from "./composer/useComposerDrop";
import { NegativePromptField } from "./NegativePromptField";
import { elementPreviewPath, loadAllElementAssets } from "../lib/elementMembership";
import type { AssetItem } from "../store/storeTypes"; import type { TrayItem } from "../lib/referenceTray";
import { addTrayElementImpl, syncElementCatalogImpl } from "../store/storeReferenceImpl";
import { findElementTrayItem } from "../lib/elementCatalog";
type PromptComposerProps = { variant?: "sidebar" | "bottom" };
type ElementSelectionState = {
  addElementId?: (id: string) => void; removeElementId?: (id: string) => void; elementCatalog?: AssetItem[] | null;
  missingElementIds?: string[]; addElementFromMention?: (asset: AssetItem) => TrayItem | null; syncElementCatalog?: (records: AssetItem[]) => void;
};
type InternalRefDragItem = VideoReferenceDragPayload;
const TRAY_MENTION_PREFIX = "tray:";
function mentionKey(mention: MentionQuery): string { return `${mention.start}:${mention.end}:${mention.query}`; }
function addElementFromMention(asset: AssetItem): TrayItem | null {
  const state = useAppStore.getState() as ReturnType<typeof useAppStore.getState> & ElementSelectionState;
  return state.addElementFromMention
    ? state.addElementFromMention(asset)
    : addTrayElementImpl(asset.id, useAppStore.setState, useAppStore.getState, asset);
}
function syncElementCatalog(records: AssetItem[]): void {
  const state = useAppStore.getState() as ReturnType<typeof useAppStore.getState> & ElementSelectionState;
  if (state.syncElementCatalog) state.syncElementCatalog(records);
  else syncElementCatalogImpl(records, useAppStore.setState, useAppStore.getState);
}
function parseCssPixelValue(value: string): number | null { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
export function PromptComposer({ variant = "sidebar" }: PromptComposerProps) {
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const provider = useAppStore((s) => s.provider);
  const insertedPrompts = useAppStore((s) => s.insertedPrompts);
  const removeInsertedPrompt = useAppStore((s) => s.removeInsertedPromptFromComposer);
  const moveInsertedPrompt = useAppStore((s) => s.moveInsertedPromptInComposer);
  const generate = useAppStore((s) => s.generate);
  const selectedPresetIds = useAppStore((s) => s.selectedPresetIds);
  const removePreset = useAppStore((s) => s.removePreset);
  const elementSelection = useAppStore((s) => s as typeof s & ElementSelectionState);
  const legacyAddElementId = elementSelection.addElementId;
  const elementCatalog = elementSelection.elementCatalog ?? null;
  const missingElementIds = elementSelection.missingElementIds ?? [];
  const [elements, setElements] = useState<AssetItem[]>([]);
  const addElementId = (id: string): TrayItem | null => {
    const asset = elements.find((candidate) => candidate.id === id);
    if (asset) return addElementFromMention(asset);
    legacyAddElementId?.(id);
    return null;
  };
  useEffect(() => {
    let cancelled = false;
    void loadAllElementAssets()
      .then((items) => {
        if (cancelled) return;
        setElements(items);
        syncElementCatalog(items);
      })
      .catch((error) => console.error("[ElementMention] load failed", error));
    return () => { cancelled = true; };
  }, []);
  const { t } = useI18n();
  const trayItems = useAppStore((s) => s.trayItems);
  const retiredTags = useAppStore((s) => s.retiredTags);
  const removeTrayItem = useAppStore((s) => s.removeTrayItem);
  const maxRefs = useAppStore((s) => s.activeReferenceLimit());
  const providerUrlReference = useAppStore((s) => s.providerUrlReference);
  const setProviderUrlReference = useAppStore((s) => s.setProviderUrlReference);
  const addReferences = useAppStore((s) => s.addReferences);
  const addReferenceDataUrl = useAppStore((s) => s.addReferenceDataUrl);
  const useImageAsReference = useAppStore((s) => s.useImageAsReference);
  const readDroppedImageMetadata = useAppStore((s) => s.readDroppedImageMetadata);
  const videoModelSelected = useAppStore((s) => s.videoModelSelected);
  const fileInput = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentCaretRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const composingRef = useRef(false);
  const compositionCommitRef = useRef<string | null>(null);
  const dismissedMentionKeyRef = useRef<string | null>(null);
  const promptMode = useAppStore((s) => s.promptMode);
  const multimode = useAppStore(composerUsesMultimode);
  const multimodeMaxImages = useAppStore((s) => s.multimodeMaxImages);
  const isDirectMode = promptMode === "direct";
  const isNai = provider === "nai";
  const beforePrompts = insertedPrompts.filter((item) => item.placement !== "after");
  const afterPrompts = insertedPrompts.filter((item) => item.placement === "after");
  const visualPromptIds = [...beforePrompts.map((item) => item.id), "__main_prompt__", ...afterPrompts.map((item) => item.id)];
  const canAddMore = trayItems.length < maxRefs;
  const placeholder = multimode
    ? trayItems.length > 0
      ? t("multimode.promptPlaceholderWithRefs")
      : t("multimode.promptPlaceholder")
    : trayItems.length > 0
      ? t("prompt.placeholderWithRefs")
      : t("prompt.placeholder");
  const submitPrompt = () => { if (missingElementIds.length > 0) return; void generate(); };

  const captureAttachmentCaret = (): number => {
    const textarea = textareaRef.current;
    return textarea?.selectionStart ?? useAppStore.getState().prompt.length;
  };

  const insertAttachmentTags = (knownTokenIds: ReadonlySet<string>, caret: number): number => {
    const added = useAppStore.getState().trayItems.filter(
      (item) => item.kind === "attachment" && !knownTokenIds.has(item.tokenId),
    );
    if (added.length === 0) return 0;
    const currentPrompt = useAppStore.getState().prompt;
    const insertionPoint = Math.max(0, Math.min(caret, currentPrompt.length));
    const mentionText = added.map((item) => `@${item.tag} `).join("");
    setPrompt(`${currentPrompt.slice(0, insertionPoint)}${mentionText}${currentPrompt.slice(insertionPoint)}`);
    const nextCaret = insertionPoint + mentionText.length;
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(nextCaret, nextCaret));
    return added.length;
  };

  const insertTagAtMention = (tag: string, mention: MentionQuery) => {
    const replacement = `@${tag} `;
    const currentPrompt = useAppStore.getState().prompt;
    const next = `${currentPrompt.slice(0, mention.start)}${replacement}${currentPrompt.slice(mention.end)}`;
    const caret = mention.start + replacement.length;
    setPrompt(next);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(caret, caret));
  };

  const updateMentionAtCaret = (value: string, caret: number) => {
    if (composingRef.current) return;
    const next = findMentionAtCaret(value, caret);
    setMentionQuery(next && mentionKey(next) !== dismissedMentionKeyRef.current ? next : null);
  };
  const addFilesAtCaret = async (files: File[], caret: number, inspectMetadata: boolean): Promise<number> => {
    if (files.length === 0) return 0;
    const knownTokenIds = new Set(useAppStore.getState().trayItems.map((item) => item.tokenId));
    try {
      if (inspectMetadata && files.length === 1) {
        const handled = await readDroppedImageMetadata(files[0]);
        if (handled) return 0;
      }
      await addReferences(files);
      return insertAttachmentTags(knownTokenIds, caret);
    } catch {
      return 0; // attachment errors surface through the existing store toasts
    }
  };

  const handleImageFiles = async (files: File[]) => {
    const caret = attachmentCaretRef.current ?? captureAttachmentCaret();
    attachmentCaretRef.current = null;
    await addFilesAtCaret(files, caret, true);
  };
  const handleDroppedFiles = useComposerDrop({ onImages: (f) => void handleImageFiles(f) });

  const openFilePicker = () => {
    if (!canAddMore) return;
    attachmentCaretRef.current = captureAttachmentCaret();
    fileInput.current?.click();
  };

  const attachInternalReference = async (item: InternalRefDragItem, caret: number): Promise<void> => {
    const knownTokenIds = new Set(useAppStore.getState().trayItems.map((trayItem) => trayItem.tokenId));
    try {
      const src = item.url || item.image;
      if (!src) return;
      const refItem = { image: src, url: item.url, filename: item.filename };
      if (isVideoItem(refItem)) {
        const frame = await extractLastFrame(src);
        if (frame) addReferenceDataUrl(frame);
      } else {
        await useImageAsReference(refItem as Parameters<typeof useImageAsReference>[0]); // eslint-disable-line react-hooks/rules-of-hooks -- store action named use*, not a hook
      }
      insertAttachmentTags(knownTokenIds, caret);
    } catch { /* non-fatal for drag-drop */ }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const refData = e.dataTransfer.getData("application/ima2-ref");
    if (refData) {
      try {
        const item = JSON.parse(refData) as InternalRefDragItem;
        void attachInternalReference(item, captureAttachmentCaret());
      } catch { /* ignore malformed */ }
      return;
    }
    handleDroppedFiles(Array.from(e.dataTransfer.files));
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (!dragOver) setDragOver(true); };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOver(false);
  };

  const onPaste = usePromptPaste({
    maxRefs,
    trayItemCount: trayItems.length,
    captureAttachmentCaret,
    addFilesAtCaret,
  });

  const maxHeightRef = useRef<number | null>(null);
  const lastVariantRef = useRef(variant);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (maxHeightRef.current === null || lastVariantRef.current !== variant) {
      maxHeightRef.current =
        parseCssPixelValue(window.getComputedStyle(el).maxHeight) ?? 0;
      lastVariantRef.current = variant;
    }
    el.style.height = "auto";
    const maxHeight = maxHeightRef.current;
    const nextHeight = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${nextHeight}px`;
  }, [prompt, variant]);

  const canMovePromptBlock = (id: string, direction: "up" | "down"): boolean => {
    const index = visualPromptIds.indexOf(id);
    if (index < 0) return false;
    return direction === "up" ? index > 0 : index < visualPromptIds.length - 1;
  };

  const renderPromptChip = (item: typeof insertedPrompts[number]) => (
    <div key={item.id} className="composer__prompt-chip" title={item.name}>
      <span className="composer__prompt-chip-plus" aria-hidden="true">
        +
      </span>
      <span className="composer__prompt-chip-title">{item.name}</span>
      <div className="composer__prompt-chip-actions">
        <button
          type="button"
          className="composer__prompt-chip-move"
          onClick={() => moveInsertedPrompt(item.id, "up")}
          disabled={!canMovePromptBlock(item.id, "up")}
          aria-label={t("prompt.moveBlockUp", { name: item.name })}
          title={t("prompt.moveBlockUp", { name: item.name })}
        >
          ^
        </button>
        <button
          type="button"
          className="composer__prompt-chip-move"
          onClick={() => moveInsertedPrompt(item.id, "down")}
          disabled={!canMovePromptBlock(item.id, "down")}
          aria-label={t("prompt.moveBlockDown", { name: item.name })}
          title={t("prompt.moveBlockDown", { name: item.name })}
        >
          v
        </button>
        <button
          type="button"
          className="composer__prompt-chip-remove"
          onClick={() => removeInsertedPrompt(item.id)}
          aria-label={t("promptLibrary.removeInserted", { name: item.name })}
        >
          x
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={`composer composer--${variant}${dragOver ? " composer--drag" : ""}${isDirectMode ? " composer--direct" : ""}${multimode ? " composer--multimode" : ""}${isDirectMode && multimode ? " composer--combined-modes" : ""}`}
      role="group"
      aria-label={multimode ? t("multimode.composerAriaLabel", { count: multimodeMaxImages }) : t("prompt.label")}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onPaste={onPaste}
    >
      <div className="composer__header">
        <span className="section-title composer__label">{t("prompt.label")}</span>
        <div className="composer__header-meta">
          {multimode && (
            <span className="composer__mode-badge">
              {t("multimode.composerBadge", { count: multimodeMaxImages })}
            </span>
          )}
          {isDirectMode && (
            <span className="composer__direct-badge">
              {t("prompt.directModeActive")}
            </span>
          )}
          {providerUrlReference && (
            <button
              type="button"
              className="composer__url-ref-badge"
              onClick={() => setProviderUrlReference(null)}
              title={t("prompt.urlRefActiveTitle")}
              aria-label={t("prompt.urlRefClear")}
            >
              <span className="composer__url-ref-dot" aria-hidden="true" />
              {t("prompt.urlRefActive")}
            </button>
          )}
          {trayItems.length > 0 && (
            <span className="composer__count">
              {t("prompt.refCount", { count: trayItems.length, max: maxRefs })}
            </span>
          )}
        </div>
      </div>

      <ReferenceTray
        items={trayItems}
        limit={maxRefs}
        onRemove={removeTrayItem}
        onAdd={openFilePicker}
      />

      {beforePrompts.length > 0 && (
        <div className="composer__prompt-chips">
          {beforePrompts.map(renderPromptChip)}
        </div>
      )}

      {selectedPresetIds.length > 0 && (
        <ChipRow ariaLabel={t("home.selectedPresets")}>
          {selectedPresetIds.map((id) => {
            const preset = getPresetById(id);
            if (!preset) return null;
            return (
              <Chip key={id} onRemove={() => removePreset(id)} removeLabel={t("common.removeNamed", { name: preset.name })}>
                {preset.name}
              </Chip>
            );
          })}
        </ChipRow>
      )}

      <ElementMentionChips
        items={trayItems}
        assets={elementCatalog}
        missingElementIds={missingElementIds}
        selectedLabel={t("element.selected")}
        unavailableLabel={t("common.elementUnavailable")}
        kindLabel={(kind) => t(`element.kind${kind[0].toUpperCase()}${kind.slice(1)}`)}
        mentionLabel={(name, kind, missing) => missing
          ? t("element.unavailableAria", { name })
          : t("element.mentionAria", { name, kind })}
        removeLabel={(name) => t("element.removeAria", { name })}
        onRemove={(elementId) => elementSelection.removeElementId?.(elementId)}
      />

      <div className={`composer__prompt-panes${isNai ? " composer__prompt-panes--dual" : ""}`}>
        <div className="composer__prompt-pane">
          {isNai ? <label className="composer__prompt-pane-label" htmlFor={`positive-prompt-${variant}`}>{t("nai.positivePrompt.label")}</label> : null}
          <div className="composer__prompt-stack">
            <DeadTagMirror prompt={prompt} retiredTags={retiredTags} textareaRef={textareaRef} />
            <textarea
              id={`positive-prompt-${variant}`}
              ref={textareaRef}
              className="prompt-area composer__textarea"
              value={prompt}
              placeholder={isNai ? t("nai.positivePrompt.placeholder") : placeholder}
              aria-describedby={isNai ? `positive-prompt-${variant}-hint` : undefined}
              onCompositionStart={() => {
                composingRef.current = true;
                setMentionQuery(null);
              }}
              onCompositionEnd={(e) => {
                composingRef.current = false;
                compositionCommitRef.current = e.currentTarget.value;
                queueMicrotask(() => { compositionCommitRef.current = null; });
                updateMentionAtCaret(e.currentTarget.value, e.currentTarget.selectionStart);
              }}
              onChange={(e) => {
                dismissedMentionKeyRef.current = null;
                setPrompt(e.target.value);
                if (compositionCommitRef.current === e.target.value) return;
                updateMentionAtCaret(e.target.value, e.target.selectionStart);
              }}
              onClick={(e) => updateMentionAtCaret(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                if (composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                if (e.key === "Escape" && mentionQuery) {
                  e.preventDefault();
                  dismissedMentionKeyRef.current = mentionKey(mentionQuery);
                  setMentionQuery(null);
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  if (e.defaultPrevented) return;
                  e.preventDefault();
                  submitPrompt();
                }
              }}
            />
          </div>
          {isNai ? <p id={`positive-prompt-${variant}-hint`} className="composer__prompt-hint">{t("nai.positivePrompt.hint", { count: prompt.length })}</p> : null}
        </div>
        <NegativePromptField variant="classic" onSubmit={submitPrompt} />
      </div>
      <ElementMentionMenu
        open={mentionQuery !== null}
        textareaRef={textareaRef}
        composingRef={composingRef}
        caret={mentionQuery?.end ?? 0}
        query={mentionQuery?.query ?? ""}
        elements={[
          ...trayItems
            .filter((item): item is Extract<typeof item, { kind: "attachment" }> => item.kind === "attachment")
            .map((item) => ({
              id: `${TRAY_MENTION_PREFIX}${item.tokenId}`,
              name: item.tag,
              kind: "reference" as ElementMentionKind,
              thumbnail: item.source.dataUrl,
            })),
          ...elements.map((asset) => {
            const previewPath = elementPreviewPath(asset);
            return {
              id: asset.id,
              name: asset.name,
              kind: (typeof asset.metadata?.elementKind === "string" ? asset.metadata.elementKind : "character") as ElementMentionKind,
              thumbnail: previewPath ? `/generated/${previewPath.split("/").map(encodeURIComponent).join("/")}` : undefined,
              tags: asset.tags,
            };
          }),
        ]}
        ariaLabel={t("common.elementSuggestions")}
        emptyLabel={t("common.noMatchingElements")}
        kindLabel={(kind) => t(`element.kind${kind[0].toUpperCase()}${kind.slice(1)}`)}
        onSelect={(element) => {
          const existing = findElementTrayItem(useAppStore.getState().trayItems, element.id);
          if (element.id.startsWith(TRAY_MENTION_PREFIX)) {
            const tokenId = element.id.slice(TRAY_MENTION_PREFIX.length);
            const trayItem = useAppStore.getState().trayItems.find((item) => item.tokenId === tokenId);
            if (trayItem && mentionQuery) {
              insertTagAtMention(trayItem.tag, mentionQuery);
            }
            setMentionQuery(null);
            return;
          }
          addElementId?.(element.id);
          if (existing) {
            requestAnimationFrame(() => document.querySelector<HTMLElement>(
              `[data-element-id="${CSS.escape(element.id)}"] .element-mention-chip__body`,
            )?.focus());
            setMentionQuery(null);
            return;
          }
          const trayElement = findElementTrayItem(useAppStore.getState().trayItems, element.id);
          if (!trayElement || !mentionQuery) return;
          insertTagAtMention(trayElement.tag, mentionQuery);
          setMentionQuery(null);
        }}
        onClose={(reason) => {
          if (reason === "escape" && mentionQuery) dismissedMentionKeyRef.current = mentionKey(mentionQuery);
          setMentionQuery(null);
        }}
      />
      {afterPrompts.length > 0 && (
        <div className="composer__prompt-chips composer__prompt-chips--after">
          <span className="composer__prompt-chips-label">{t("prompt.afterBlocks")}</span>
          {afterPrompts.map(renderPromptChip)}
        </div>
      )}
      <PromptComposerToolbar canAddMore={canAddMore} onAttach={openFilePicker} />
      {dragOver && (
        <div className="composer__dropzone" aria-hidden="true">
          {t("prompt.dropHere", { max: maxRefs })}
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={composerAcceptAttr({ videoModelSelected })}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) handleDroppedFiles(files);
          else attachmentCaretRef.current = null;
          e.target.value = "";
        }}
      />
    </div>
  );
}
