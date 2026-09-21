import { memo, useCallback, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createPortal } from "react-dom";
import { dienMoTaTrangPhuc, timNodeDungThamChieu } from "../lib/moTaTrangPhuc";
import { khoaPrompt, layVaiTro } from "../lib/vaiTroNode";
import { useAppStore, type ImageNodeData, type GraphNode } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { getImageModelShortLabel } from "../lib/imageModels";
import { formatReasoningLabel } from "../lib/reasoning";
import { isVideoUrl } from "../lib/videoMedia";
import { AssetMediaLightbox } from "./assetgen/AssetMediaLightbox";
import { buildProvenanceView } from "../lib/provenance";
import { SavePromptPopover } from "./SavePromptPopover";

const MAX_NODE_REFS = 5;
const NODE_PREVIEW_HEIGHT = 240;
const NODE_PREVIEW_MIN_WIDTH = 180;
const NODE_PREVIEW_MAX_WIDTH = 420;
const NODE_HANDLE_POSITIONS = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

/**
 * The node status line already carries elapsed time, video params and the model, so
 * provenance contributes just the derivation kind rather than a separate chip.
 */
function derivationOf(
  d: ImageNodeData,
  t: (key: string) => string,
): string | null {
  const view = buildProvenanceView({
    model: d.model,
    provider: d.provider,
    mediaType: isVideoUrl(d.imageUrl) ? "video" : "image",
    videoContinuity: d.videoContinuity,
  });
  return view.derivation ? t(`provenance.${view.derivation}`) : null;
}

function getPreviewWidth(size?: string | null): number {
  const match = /^(\d+)x(\d+)$/.exec(size ?? "");
  if (!match) return NODE_PREVIEW_HEIGHT;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return NODE_PREVIEW_HEIGHT;
  }
  const scaledWidth = NODE_PREVIEW_HEIGHT * (width / height);
  return Math.round(
    Math.min(NODE_PREVIEW_MAX_WIDTH, Math.max(NODE_PREVIEW_MIN_WIDTH, scaledWidth)),
  );
}

function ImageNodeImpl({ id, data, selected }: NodeProps<GraphNode>) {
  const { t } = useI18n();
  // Anh trong node be, nen cho phong to xem trong lightbox dung chung cua du an.
  const [xemTo, setXemTo] = useState(false);
  const d = data as ImageNodeData;
  const updateNodePrompt = useAppStore((s) => s.updateNodePrompt);
  const addNodeReferences = useAppStore((s) => s.addNodeReferences);
  const addNodeReferenceFromUrl = useAppStore((s) => s.addNodeReferenceFromUrl);
  const readDroppedImageMetadata = useAppStore((s) => s.readDroppedImageMetadata);
  const removeNodeReference = useAppStore((s) => s.removeNodeReference);
  const generateNode = useAppStore((s) => s.generateNode);
  const showToast = useAppStore((st) => st.showToast);
  const graphEdges = useAppStore((st) => st.graphEdges);
  const graphNodes = useAppStore((st) => st.graphNodes);
  const [dangDocDo, setDangDocDo] = useState(false);
  const vaiTro = layVaiTro(d.vaiTro);
  // Vai tro co prompt co dinh thi khoa o nhap: prompt do da dung, sua chi lam hong.
  const promptBiKhoa = khoaPrompt(d.vaiTro);
  const generateNodeInPlace = useAppStore((s) => s.generateNodeInPlace);
  const generateNodeVariation = useAppStore((s) => s.generateNodeVariation);
  const animateImage = useAppStore((s) => s.animateImage);
  const addChildNode = useAppStore((s) => s.addChildNode);
  const duplicateBranchRoot = useAppStore((s) => s.duplicateBranchRoot);
  const deleteNode = useAppStore((s) => s.deleteNode);
  const fileInput = useRef<HTMLInputElement>(null);
  const [isDraggingRef, setIsDraggingRef] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const refs = d.referenceImages ?? [];
  const isBusy = d.status === "pending" || d.status === "reconciling";
  const canAttachRefs = !isBusy && refs.length < MAX_NODE_REFS;
  const nodeStyle = {
    "--node-preview-w": `${getPreviewWidth(d.size)}px`,
    "--node-preview-h": `${NODE_PREVIEW_HEIGHT}px`,
  } as CSSProperties;

  const onPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => updateNodePrompt(id, e.target.value),
    [id, updateNodePrompt],
  );

  // Prompt khuon co the con o trong dang {{...}} chua dien. Sinh luc do thi
  // chuoi {{...}} di thang vao prompt va ra ket qua vo nghia - chan tu dau
  // thay vi de nguoi dung dot mot luot sinh moi biet.
  const oTrongChuaDien = /\{\{[A-Z_]+\}\}/.exec(d.prompt || "")?.[0] ?? null;
  const canhBaoOTrong = useCallback(() => {
    if (!oTrongChuaDien) return false;
    showToast(t("node.placeholderLeft", { slot: oTrongChuaDien, fallback: `Prompt con o trong ${oTrongChuaDien} chua dien` }), true);
    return true;
  }, [oTrongChuaDien, showToast, t]);

  const onGenerate = useCallback(() => {
    if (canhBaoOTrong()) return;
    void generateNode(id);
  }, [id, generateNode, canhBaoOTrong]);

  const onRegenerateInPlace = useCallback(() => {
    if (canhBaoOTrong()) return;
    void generateNodeInPlace(id);
  }, [id, generateNodeInPlace, canhBaoOTrong]);

  const onNewVariation = useCallback(() => {
    void generateNodeVariation(id);
  }, [id, generateNodeVariation]);

  // Node nay co ai dung lam ANH THAM CHIEU khong - chi node trang phuc moi co.
  const coNodeDungThamChieu = timNodeDungThamChieu(id, graphEdges).length > 0;

  const onDocBoDo = useCallback(async () => {
    setDangDocDo(true);
    try {
      const kq = await dienMoTaTrangPhuc(id, graphNodes, graphEdges, updateNodePrompt);
      showToast(t("node.outfitFilled", { n: String(kq.daDien.length), fallback: `Da dien mo ta vao ${kq.daDien.length} node` }), false);
    } catch (e) {
      showToast(String((e as Error).message || e), true);
    } finally {
      setDangDocDo(false);
    }
  }, [id, graphNodes, graphEdges, updateNodePrompt, showToast, t]);

  const onBranch = useCallback(() => {
    if (d.status !== "ready") return;
    addChildNode(id);
  }, [id, d.status, addChildNode]);

  // Anh dung lam dau vao cho video: neu node da bi video thay cho thi lay anh
  // nguon da giu lai, nho vay sinh lai video duoc thay vi cut duong.
  const anhNguonVideo = isVideoUrl(d.imageUrl) ? (d.videoSourceUrl ?? null) : d.imageUrl;

  const onAnimate = useCallback(() => {
    if (d.status !== "ready" || !anhNguonVideo) return;
    const filename = anhNguonVideo.replace(/^\/generated\//, "");
    void animateImage(filename, d.prompt);
  }, [d.status, anhNguonVideo, d.prompt, animateImage]);

  const onDuplicateBranch = useCallback(() => {
    duplicateBranchRoot(id);
  }, [id, duplicateBranchRoot]);

  const onDelete = useCallback(() => deleteNode(id), [id, deleteNode]);

  const extractClipboardImages = (items: DataTransferItemList | null): File[] => {
    if (!items) return [];
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind !== "file") continue;
      if (!it.type.startsWith("image/")) continue;
      const f = it.getAsFile();
      if (f) files.push(f);
    }
    return files;
  };

  const handleNodeImageFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      const handled = await readDroppedImageMetadata(files[0], id);
      if (handled) return;
    }
    await addNodeReferences(id, files);
  };

  const onDropRefs = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingRef(false);
    // Internal gallery/history drag — payload is a URL, not a File
    const refData = e.dataTransfer.getData("application/ima2-ref");
    if (refData) {
      if (!canAttachRefs) return;
      try {
        const item = JSON.parse(refData) as { image?: string; url?: string; filename?: string };
        const src = item.url || item.image;
        if (src) void addNodeReferenceFromUrl(id, src, item.filename);
      } catch { /* ignore malformed */ }
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 1) {
      const handled = await readDroppedImageMetadata(files[0], id);
      if (handled) return;
    }
    if (!canAttachRefs) return;
    if (files.length > 0) void addNodeReferences(id, files);
  };

  const onDragOverRefs = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (canAttachRefs && !isDraggingRef) setIsDraggingRef(true);
  };

  const onDragLeaveRefs = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDraggingRef(false);
  };

  const onPasteRefs = (e: ClipboardEvent<HTMLDivElement>) => {
    const files = extractClipboardImages(e.clipboardData?.items ?? null);
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!canAttachRefs) return;
    const room = MAX_NODE_REFS - refs.length;
    void addNodeReferences(id, files.slice(0, room));
  };

  const computeStatusLabel = (): string => {
    switch (d.status) {
      case "empty":
        return t("node.empty");
      case "pending":
        return t("node.pending");
      case "reconciling":
        return d.pendingPhase
          ? t("node.reconcilingPhase", { phase: d.pendingPhase })
          : t("node.reconciling");
      case "ready":
        return [
          d.webSearchCalls
            ? t("node.readyWithSearch", {
              elapsed: d.elapsed ?? "?",
              searches: d.webSearchCalls,
            })
            : t("node.ready", { elapsed: d.elapsed ?? "?" }),
          d.video?.duration ? `${d.video.duration}s` : null,
          d.video?.resolution ?? null,
          d.video?.aspectRatio ?? null,
          formatReasoningLabel(d.reasoningEffort),
          // `provider` is a declared field on ImageNodeData, so the old escape-hatch
          // cast here was hiding a type that already existed.
          getImageModelShortLabel(d.model, d.provider),
          // How this node was derived (i2v / v2v / ...). The model label above only
          // works again because the video path stopped writing `model: null`.
          derivationOf(d, t),
        ].filter(Boolean).join(" · ");
      case "stale":
        return d.error
          ? t("node.staleWithError", { error: d.error })
          : t("node.stale");
      case "asset-missing":
        return d.error
          ? t("node.assetMissingWithError", { error: d.error })
          : t("node.assetMissing");
      case "error":
        return t("node.error", { error: d.errorInfo?.message ?? d.error ?? t("node.errorUnknown") });
      default:
        return "";
    }
  };
  const statusLabel = computeStatusLabel();
  const errorAction = d.status === "error" && d.errorInfo?.code !== "JOB_TRACKING_TIMEOUT"
    ? d.errorInfo?.action ?? "retry" : null;

  return (
    <div
      className={`image-node image-node--${d.status}${selected ? " image-node--selected" : ""}`}
      style={nodeStyle}
    >
      {NODE_HANDLE_POSITIONS.map(({ id: handleId, position }) => (
        <Handle
          key={`target-${handleId}`}
          type="target"
          id={`target-${handleId}`}
          position={position}
          className={`image-node__handle image-node__handle--target image-node__handle--${handleId}`}
        />
      ))}
      {/* Ma node + nhan: khong co ma thi nguoi dung khong co cach nao chi ra
          node nao dang sai. Bam vao la chep ma vao bo nho tam. */}
      <div className="image-node__id nodrag" title={d.label ? `${id} - ${d.label}` : id}>
        <button
          type="button"
          className="image-node__id-copy"
          onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(id); }}
          title={t("node.copyId", { fallback: "Copy node id" })}
          aria-label={t("node.copyId", { fallback: "Copy node id" })}
        >
          {id}
        </button>
        {vaiTro ? (
          <span className="image-node__role" style={{ background: vaiTro.mau }}>{vaiTro.nhan}</span>
        ) : null}
        {d.label ? <span className="image-node__id-label">{d.label}</span> : null}
      </div>
      <div className="image-node__preview">
        {d.imageUrl && d.status !== "asset-missing" ? (
          <>
            {isVideoUrl(d.imageUrl) ? (
              <video src={d.imageUrl} controls loop playsInline muted className="image-node__video nodrag" />
            ) : (
              <img src={d.imageUrl} alt={t("node.nodeImageAlt")} />
            )}
            {/* Nut nay dung cho CA anh lan video: lightbox tu phat video khi
                media la video, nen xem to clip ngay trong do duoc. */}
              <button
                type="button"
                className="image-node__zoom nodrag"
                title={t("node.zoomImage")}
                aria-label={t("node.zoomImage")}
                onClick={(e) => { e.stopPropagation(); setXemTo(true); }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </button>
          </>
        ) : isBusy && d.partialImageUrl ? (
          <img
            className="image-node__partial"
            src={d.partialImageUrl}
            alt={t("node.partialImageAlt")}
          />
        ) : isBusy ? (
          <div className="image-node__skeleton" />
        ) : d.status === "asset-missing" ? (
          <div className="image-node__placeholder">{t("node.noAsset")}</div>
        ) : d.status === "stale" ? (
          <div className="image-node__placeholder">{t("node.stateStale")}</div>
        ) : (
          <div className="image-node__placeholder">{t("node.noImage")}</div>
        )}
      </div>
      <div
        className={`image-node__composer nodrag${isDraggingRef ? " is-dragging" : ""}`}
        onDrop={onDropRefs}
        onDragOver={onDragOverRefs}
        onDragLeave={onDragLeaveRefs}
        onPaste={onPasteRefs}
      >
        {refs.length > 0 ? (
          <div className="image-node__refs">
            {refs.map((src, i) => (
              <div
                key={i}
                className="image-node__ref-chip"
                title={t("node.refAlt", { n: i + 1 })}
              >
                <img src={src} alt={t("node.refAlt", { n: i + 1 })} />
                <button
                  type="button"
                  className="image-node__ref-remove"
                  onClick={() => removeNodeReference(id, i)}
                  disabled={isBusy}
                  aria-label={t("node.removeRef", { n: i + 1 })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          className="image-node__prompt"
          value={d.prompt}
          onChange={onPromptChange}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={d.parentServerNodeId ? t("node.editPromptPlaceholder") : t("node.promptPlaceholder")}
          rows={2}
          disabled={isBusy}
          readOnly={promptBiKhoa}
          title={promptBiKhoa ? t("node.promptLocked", { fallback: "Prompt co dinh cho vai tro nay" }) : undefined}
        />
        <div className="image-node__composer-bar">
          <button
            type="button"
            className="image-node__attach"
            onClick={() => canAttachRefs && fileInput.current?.click()}
            disabled={!canAttachRefs}
            title={d.parentServerNodeId ? t("node.nodeRefsUsedWithParent") : t("node.attachRefTitle")}
          >
            {t("node.attachRef")}
          </button>
          {isDraggingRef ? (
            <span className="image-node__drop-hint">{t("node.dropRefs")}</span>
          ) : refs.length > 0 ? (
            <span className="image-node__ref-count">{refs.length}/{MAX_NODE_REFS}</span>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void handleNodeImageFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="image-node__footer nodrag">
        <span
          className="image-node__status"
          title={d.errorInfo?.code ? `${statusLabel} [${d.errorInfo.code}]` : statusLabel}
        >
          {statusLabel}
        </span>
        {errorAction === "retry" ? (
          <button
            type="button"
            className="image-node__retry"
            onClick={onRegenerateInPlace}
            disabled={isBusy}
            title={t("node.retryTitle")}
          >
            {t("node.retry")}
          </button>
        ) : errorAction === "auth" ? (
          <span className="image-node__error-cta">{t("node.errorAuthCta")}</span>
        ) : errorAction === "fix-input" ? (
          <span className="image-node__error-cta">{t("node.errorFixCta")}</span>
        ) : null}
        <div className="image-node__actions">
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setSaveOpen((v) => !v)}
              disabled={!d.prompt?.trim()}
              title={t("promptLibrary.saveTitle")}
              aria-label={t("promptLibrary.saveTitle")}
              aria-haspopup="dialog"
              aria-expanded={saveOpen}
            >
              {/* Bookmark, not a star: this opens the save-prompt popover. A favorite
                  star here would claim an action the button does not perform. */}
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="15" height="15">
                <path
                  d="M6.5 3.75h11a.75.75 0 0 1 .75.75v15.03a.5.5 0 0 1-.77.42L12 16.4l-5.48 3.55a.5.5 0 0 1-.77-.42V4.5a.75.75 0 0 1 .75-.75Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {saveOpen && (
              <SavePromptPopover
                text={d.prompt || ""}
                onClose={() => setSaveOpen(false)}
              />
            )}
          </div>
          {d.status === "ready" ? (
            <>
              <button type="button" onClick={onRegenerateInPlace} disabled={isBusy} title={t("node.regenerateTitle")} aria-label={t("node.regenerateTitle")}>
                ↻
              </button>
              <button type="button" onClick={onNewVariation} disabled={isBusy} title={t("node.newVariationTitle")} aria-label={t("node.newVariationTitle")}>
                {t("node.newVariation")}
              </button>
              {coNodeDungThamChieu && !isVideoUrl(d.imageUrl) && (
                <button
                  type="button"
                  onClick={() => void onDocBoDo()}
                  disabled={isBusy || dangDocDo}
                  title={t("node.readOutfitTitle", { fallback: "Read this outfit into the prompts that reference it" })}
                  aria-label={t("node.readOutfitTitle", { fallback: "Read this outfit into the prompts that reference it" })}
                >
                  {dangDocDo ? "..." : t("node.readOutfit", { fallback: "Doc bo do" })}
                </button>
              )}
              {anhNguonVideo && (
                <button type="button" onClick={onAnimate} disabled={isBusy} title={t(isVideoUrl(d.imageUrl) ? "result.animateAgainTitle" : "result.animateTitle", { fallback: "Animate" })} aria-label={t(isVideoUrl(d.imageUrl) ? "result.animateAgainTitle" : "result.animateTitle", { fallback: "Animate" })}>
                  {/* Cuon phim, KHONG phai tam giac phat: nut nay goi Grok sinh
                      video (ton thoi gian va tien), chu khong phat gi ca. Dung
                      hinh tam giac thi ai cung tuong la nut play. */}
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <rect x="3" y="5.5" width="18" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M7.5 5.5v13M16.5 5.5v13M3 12h18" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="image-node__generate"
              onClick={onGenerate}
              disabled={isBusy}
              title={t("node.generateTitle")}
              aria-label={t("node.generateTitle")}
            >
              {t("node.generate")}
            </button>
          )}
          {d.status === "ready" ? (
            <>
              <button
                type="button"
                onClick={onBranch}
                title={t("node.addChildTitle")}
                aria-label={t("node.addChildTitle")}
              >
                {t("node.addChild")}
              </button>
              <button
                type="button"
                onClick={onDuplicateBranch}
                title={t("node.duplicateBranchTitle")}
                aria-label={t("node.duplicateBranchTitle")}
              >
                {t("node.duplicateBranch")}
              </button>
            </>
          ) : null}
          <button type="button" onClick={onDelete} className="image-node__del" title={t("node.deleteTitle")} aria-label={t("node.deleteTitle")}>×</button>
        </div>
      </div>
      {NODE_HANDLE_POSITIONS.map(({ id: handleId, position }) => (
        <Handle
          key={`source-${handleId}`}
          type="source"
          id={`source-${handleId}`}
          position={position}
          className={`image-node__handle image-node__handle--source image-node__handle--${handleId}`}
        />
      ))}
      {/* Phai dua ra ngoai document.body: node nam trong canvas React Flow co
          transform: scale(), va panel cua lightbox rong "min(1100px, 100%)" -
          100% se tinh theo be rong cua NODE (~300px) chu khong phai man hinh,
          nen lightbox bi co thanh mot dai hep. */}
      {xemTo && d.imageUrl ? createPortal(
        <AssetMediaLightbox
          item={{
            image: d.imageUrl,
            url: d.imageUrl,
            prompt: d.prompt || "",
            filename: d.imageUrl.replace(/^\/generated\//, ""),
            mediaType: isVideoUrl(d.imageUrl) ? "video" : "image",
          }}
          onClose={() => setXemTo(false)}
        />,
        document.body,
      ) : null}
    </div>
  );
}

export const ImageNode = memo(ImageNodeImpl);
