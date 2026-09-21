import { memo, useCallback, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createPortal } from "react-dom";
import { dienMoTaTrangPhuc, timNodeDungThamChieu } from "../lib/moTaTrangPhuc";
import { khoaPrompt, laNodeMoc, laVaiTroGop, layVaiTro, VAI_TRO } from "../lib/vaiTroNode";
import { doiCho, ghepThanhVideo, mucGopCuaNode } from "../lib/gopMedia";
import { dauVaoVideoCuaNode, oTrongCuaKhuon, timChuoiChay } from "../lib/chayWorkflow";
import { canhAnhVao } from "../lib/canhAnh";
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
  const datVaiTroNode = useAppStore((st) => st.datVaiTroNode);
  const updateNodeData = useAppStore((st) => st.updateNodeData);
  const runVideoGenerate = useAppStore((st) => st.runVideoGenerate);
  const graphNodes = useAppStore((st) => st.graphNodes);
  const [dangDocDo, setDangDocDo] = useState(false);
  const vaiTro = layVaiTro(d.vaiTro);
  const laNodeGop = laVaiTroGop(d.vaiTro);
  const [dangGhep, setDangGhep] = useState(false);
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
  // Viec sinh video chay bat dong bo: POST tra ve ngay nen trang thai node bi
  // go rat som, trong khi may chu con chay tiep ca chuc giay. Bam them vao danh
  // sach viec dang chay - con job nao mang clientNodeId cua node thi node con ban.
  const inFlight = useAppStore((st) => st.inFlight);
  const coViecDangChay = inFlight.some((j) => j.clientNodeId === id);
  const isBusy = d.status === "pending" || d.status === "reconciling" || coViecDangChay;
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

  // Node mang vai tro VIDEO thi GEN phai sinh VIDEO. Truoc day vai tro chi la
  // cai nhan: bam GEN tren node video van sinh ra anh, ghi de mat clip.
  const laNodeVideo = d.vaiTro === "video";
  const onAnimateRef = useRef<(() => void) | null>(null);

  // Node MOC (BAT DAU / KET THUC) khong sinh gi ca: no chi danh dau hai dau cua
  // mot khuon. Noi du hai moc thi bam CHAY tren moc dau se chay het khuon.
  const laMoc = laNodeMoc(d.vaiTro);
  const laMocDau = d.vaiTro === "bat-dau";
  const wfDangChay = useAppStore((st) => st.wfDangChay);
  const wfNodeHienTai = useAppStore((st) => st.wfNodeHienTai);
  const wfDungLai = useAppStore((st) => st.wfDungLai);
  const wfDaXong = useAppStore((st) => st.wfDaXong);
  const wfTongViec = useAppStore((st) => st.wfTongViec);
  const chayWorkflow = useAppStore((st) => st.chayWorkflow);
  const dungWorkflow = useAppStore((st) => st.dungWorkflow);
  // Tinh ngay tren node de nguoi dung thay truoc so buoc se chay - va thay ngay
  // loi "chua noi toi KET THUC" thay vi bam chay roi moi biet.
  const chuoi = useMemo(
    () => (laMocDau ? timChuoiChay(id, graphNodes, graphEdges) : null),
    [laMocDau, id, graphNodes, graphEdges],
  );
  const khuonNayDangChay = wfDangChay === id;

  // Diem vao API cua khuon. Node BAT DAU la dia chi goi tu ben ngoai, nen chi
  // dan phai nam ngay tren no - de trong tai lieu thi khong ai gap.
  const activeSessionId = useAppStore((st) => st.activeSessionId);
  const [hienApi, setHienApi] = useState(false);
  const duongApi = activeSessionId && laMocDau
    ? `/api/wf/${activeSessionId}/${id}` : null;
  const oTrongKhuon = useMemo(
    () => (chuoi?.ok ? oTrongCuaKhuon(graphNodes, chuoi.thuTu) : []),
    [chuoi, graphNodes],
  );
  const lenhCurl = useMemo(() => {
    if (!duongApi) return "";
    const than = oTrongKhuon.length
      ? `{"inputs":{${oTrongKhuon.map((o) => `"${o}":""`).join(",")}}}`
      : "{}";
    return `curl -X POST ${window.location.origin}${duongApi} \
  -H 'Content-Type: application/json' \
  -d '${than}'`;
  }, [duongApi, oTrongKhuon]);

  /**
   * Anh KE THUA tu cac canh vao: canh dau la ANH NEN, cac canh sau la THAM CHIEU.
   * Hien ra duoi node de nhin mot cai la biet node nay dang an theo anh nao -
   * truoc day chi thay anh nguoi dung tu dinh, con phan ke thua thi vo hinh.
   */
  const anhKeThua = useMemo(() => {
    const nguon = canhAnhVao(graphEdges, graphNodes, id).map((e) => e.source);
    return nguon
      .map((src, i) => {
        const n = graphNodes.find((x) => x.id === src);
        const url = n?.data?.imageUrl;
        return url ? { id: src, url, vai: i === 0 ? "base" : "ref" } : null;
      })
      .filter((x): x is { id: string; url: string; vai: string } => !!x);
  }, [id, graphEdges, graphNodes]);

  /** Media cua node GOP: canh vao + anh nguoi dung tu dinh, theo thu tu da luu.
      Dung chung ham voi luot chay khuon, khong thi hai ben lech nhau. */
  const mucGop = useMemo(
    () => (laNodeGop ? mucGopCuaNode(id, graphNodes, graphEdges, d) : []),
    [laNodeGop, id, graphNodes, graphEdges, d],
  );

  const dayLen = useCallback((i: number) => {
    updateNodeData(id, { thuTuGop: doiCho(mucGop, i, i - 1) });
  }, [id, mucGop, updateNodeData]);
  const dayXuong = useCallback((i: number) => {
    updateNodeData(id, { thuTuGop: doiCho(mucGop, i, i + 1) });
  }, [id, mucGop, updateNodeData]);

  const onGhepVideo = useCallback(async () => {
    setDangGhep(true);
    try {
      const url = await ghepThanhVideo(mucGop);
      updateNodeData(id, { imageUrl: url, status: "ready" });
      showToast(t("node.mergeDone", { fallback: "Da ghep xong" }), false);
    } catch (e) {
      showToast(String((e as Error).message || e), true);
    } finally {
      setDangGhep(false);
    }
  }, [id, mucGop, updateNodeData, showToast, t]);

  // Dung chung ham voi luot chay khuon: bam GEN tay va chay ca khuon phai cho ra
  // dung mot dau vao, khong thi ket qua hai duong khac nhau ma khong ro vi sao.
  const dauVaoVideo = useMemo(
    () => dauVaoVideoCuaNode(id, graphNodes, graphEdges),
    [id, graphNodes, graphEdges],
  );


  const onGenerate = useCallback(() => {
    if (canhBaoOTrong()) return;
    // Node VIDEO phai di duong runVideoGenerate (biet node) chu khong phai
    // animateImage: duong kia chi nhan ten tep nen khong dat duoc trang thai
    // cho, va ket qua khong gan vao node nao.
    if (laNodeVideo) { void runVideoGenerate(id, dauVaoVideo.ta); return; }
    void generateNode(id);
  }, [id, generateNode, canhBaoOTrong, laNodeVideo, runVideoGenerate, dauVaoVideo]);

  const onRegenerateInPlace = useCallback(() => {
    if (canhBaoOTrong()) return;
    if (laNodeVideo) { void runVideoGenerate(id, dauVaoVideo.ta); return; }
    void generateNodeInPlace(id);
  }, [id, generateNodeInPlace, canhBaoOTrong, laNodeVideo, runVideoGenerate, dauVaoVideo]);

  const onNewVariation = useCallback(() => {
    void generateNodeVariation(id);
  }, [id, generateNodeVariation]);

  // Node nay co ai dung lam ANH THAM CHIEU khong - chi node trang phuc moi co.
  const coNodeDungThamChieu = timNodeDungThamChieu(id, graphEdges).length > 0;

  const onDocBoDo = useCallback(async () => {
    setDangDocDo(true);
    try {
      const kq = await dienMoTaTrangPhuc(
        id, graphNodes, graphEdges, updateNodePrompt,
        (dichId, url) => addNodeReferenceFromUrl(dichId, url),
      );
      showToast(t("node.outfitFilled", { n: String(kq.daDien.length), fallback: `Da dien mo ta vao ${kq.daDien.length} node` }), false);
    } catch (e) {
      showToast(String((e as Error).message || e), true);
    } finally {
      setDangDocDo(false);
    }
  }, [id, graphNodes, graphEdges, updateNodePrompt, addNodeReferenceFromUrl, showToast, t]);

  const onBranch = useCallback(() => {
    if (d.status !== "ready") return;
    addChildNode(id);
  }, [id, d.status, addChildNode]);

  // Anh dung lam dau vao cho video: neu node da bi video thay cho thi lay anh
  // nguon da giu lai, nho vay sinh lai video duoc thay vi cut duong.
  const anhNguonVideo = isVideoUrl(d.imageUrl) ? (d.videoSourceUrl ?? null) : d.imageUrl;

  const onAnimate = useCallback(() => {
    // Nhan ca "stale": node lo thoi van co san mot ANH de lam video, chan lai
    // chi khien bam GEN tren node video khong xay ra gi ma cung khong bao gi.
    // Node VIDEO lay anh tu node CANH, nen trang thai cua CHINH no khong noi len
    // dieu gi: node video moi tao luon la "idle" va van phai sinh duoc. Chi chan
    // theo trang thai voi node thuong, la node tu dung anh cua minh.
    if (!laNodeVideo && d.status !== "ready" && d.status !== "stale") return;
    const nguon = laNodeVideo ? dauVaoVideo.anh : anhNguonVideo;
    const ta = laNodeVideo ? dauVaoVideo.ta : d.prompt;
    if (!nguon) {
      showToast(t("node.needImageForVideo", { fallback: "Node chua co anh de lam video" }), true);
      return;
    }
    const filename = nguon.replace(/^\/generated\//, "");
    void animateImage(filename, ta);
  }, [d.status, d.prompt, anhNguonVideo, laNodeVideo, dauVaoVideo, animateImage, showToast, t]);

  // Gan sau khi onAnimate da khai bao: onGenerate goi qua ref nen khong tao
  // phu thuoc vong giua hai useCallback.
  onAnimateRef.current = onAnimate;

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
  // Moc khong co anh nen dong trang thai thuong se bao "chua co anh" - dung
  // nghia den ma vo nghia voi nguoi doc. Noi thang no la moc gi.
  const statusLabel = laMoc
    ? (laMocDau ? t("node.wfStartHint") : t("node.wfEndHint"))
    : computeStatusLabel();
  const errorAction = d.status === "error" && d.errorInfo?.code !== "JOB_TRACKING_TIMEOUT"
    ? d.errorInfo?.action ?? "retry" : null;

  return (
    <div
      // Viec chay bat dong bo (video) khong doi status cua node, nen phai them
      // lop --pending theo danh sach viec dang chay, khong thi node dang chay
      // ma vien van bao "ready".
      className={`image-node image-node--${coViecDangChay ? "pending" : d.status}${selected ? " image-node--selected" : ""}${laMoc ? " image-node--moc" : ""}${wfNodeHienTai === id ? " image-node--wf-hien-tai" : ""}`}
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
        {/* Chon vai tro ngay tren node: node moi them chua co vai tro, chon o
            day la xong - vai tro co prompt co dinh se tu dien prompt vao. */}
        <select
          className="image-node__role nodrag"
          style={vaiTro ? { background: vaiTro.mau } : undefined}
          value={typeof d.vaiTro === "string" ? d.vaiTro : ""}
          onChange={(e) => datVaiTroNode(id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          title={t("node.rolePick", { fallback: "Vai tro node" })}
          aria-label={t("node.rolePick", { fallback: "Vai tro node" })}
        >
          <option value="">{t("node.roleNone", { fallback: "— vai tro —" })}</option>
          {Object.entries(VAI_TRO).map(([ma, v]) => (
            <option key={ma} value={ma}>{v.nhan}</option>
          ))}
        </select>
        {d.label ? <span className="image-node__id-label">{d.label}</span> : null}
      </div>
      {laMoc ? (
        <div className="image-node__moc-than">
          <div className="image-node__moc-nhan" style={vaiTro ? { color: vaiTro.mau } : undefined}>
            {vaiTro?.nhan}
          </div>
          {laMocDau ? (
            <>
              <div className="image-node__moc-so">
                {khuonNayDangChay
                  ? t("node.wfRunning", { done: wfDaXong, total: wfTongViec })
                  : chuoi?.ok
                    ? t("node.wfSteps", { count: chuoi.soViec })
                    : t(`node.wfErr.${chuoi?.loi ?? "thieu-ket-thuc"}`)}
              </div>
              {khuonNayDangChay ? (
                <button
                  type="button"
                  className="image-node__wf-nut image-node__wf-nut--dung"
                  onClick={dungWorkflow}
                  disabled={wfDungLai}
                >
                  {wfDungLai ? t("node.wfStopping") : t("node.wfStop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="image-node__wf-nut"
                  onClick={() => void chayWorkflow(id)}
                  disabled={!chuoi?.ok || !!wfDangChay}
                  title={t("node.wfRunTitle")}
                >
                  {t("node.wfRun")}
                </button>
              )}
            </>
          ) : (
            <div className="image-node__moc-so">{t("node.wfEndHint")}</div>
          )}
          {duongApi ? (
            <div className="image-node__api nodrag">
              <button
                type="button"
                className="image-node__api-mo"
                onClick={(e) => { e.stopPropagation(); setHienApi((v) => !v); }}
                aria-expanded={hienApi}
                title={t("node.wfApiTitle")}
              >
                {hienApi ? "▾ API" : "▸ API"}
              </button>
              {hienApi ? (
                <div className="image-node__api-than">
                  <code className="image-node__api-duong">POST {duongApi}</code>
                  {oTrongKhuon.length ? (
                    <div className="image-node__api-o">
                      {t("node.wfApiInputs", { names: oTrongKhuon.join(", ") })}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="image-node__api-chep"
                    onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(lenhCurl); }}
                  >
                    {t("node.wfApiCopy")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
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
        {/* Lop phu bao dang chay. Can thiet vi khung xuong chi hien khi node
            CHUA co gi: sinh lai tren node da co anh/video thi truoc day khong
            co phan hoi nao het. */}
        {isBusy ? (
          <div className="image-node__busy">
            {t("node.working", { fallback: "Dang chay..." })}
            {d.pendingPhase ? ` · ${d.pendingPhase}` : ""}
          </div>
        ) : null}
      </div>
      )}
      {laMoc ? null : (
      <div
        className={`image-node__composer nodrag${isDraggingRef ? " is-dragging" : ""}`}
        onDrop={onDropRefs}
        onDragOver={onDragOverRefs}
        onDragLeave={onDragLeaveRefs}
        onPaste={onPasteRefs}
      >
        {refs.length > 0 || anhKeThua.length > 0 ? (
          <div className="image-node__refs">
            {anhKeThua.map((k) => (
              <div
                key={`ke-thua-${k.id}`}
                className="image-node__ref-chip image-node__ref-chip--ke-thua"
                title={`${k.vai}: ${k.id}`}
              >
                <img src={k.url} alt={`${k.vai}: ${k.id}`} />
                <span className="image-node__ref-vai">{k.vai}</span>
              </div>
            ))}
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
        {laNodeGop ? (
          <div className="image-node__gop nodrag">
            {mucGop.length === 0 ? (
              <div className="image-node__gop-trong">{t("node.mergeEmpty", { fallback: "Noi canh vao hoac dinh tep" })}</div>
            ) : (
              mucGop.map((m, i) => (
                <div key={m.url} className="image-node__gop-muc" title={m.url}>
                  <span className="image-node__gop-so">{i + 1}</span>
                  {m.loai === "video"
                    ? <video src={m.url} muted playsInline preload="metadata" />
                    : <img src={m.url} alt="" />}
                  <span className="image-node__gop-loai">{m.loai === "video" ? "MP4" : "IMG"}</span>
                  <span className="image-node__gop-nut">
                    <button type="button" onClick={() => dayLen(i)} disabled={i === 0} aria-label={t("node.mergeUp", { fallback: "Len" })}>↑</button>
                    <button type="button" onClick={() => dayXuong(i)} disabled={i === mucGop.length - 1} aria-label={t("node.mergeDown", { fallback: "Xuong" })}>↓</button>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
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
        )}
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
      )}
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
          {laMoc ? null : (
            <>
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
          {d.vaiTro === "gop-video" ? (
            <button
              type="button"
              onClick={() => void onGhepVideo()}
              disabled={dangGhep || mucGop.length < 2}
              title={t("node.mergeTitle", { fallback: "Ghep thanh mot video" })}
            >
              {dangGhep ? "..." : t("node.merge", { fallback: "Ghep video" })}
            </button>
          ) : null}
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
              {/* Chi node VIDEO moi sinh video. Node boc do / mac do / canh
                  deu la buoc lam ANH, bay nut video o do chi to gay bam nham. */}
              {anhNguonVideo && (!d.vaiTro || d.vaiTro === "video") && (
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
            </>
          )}
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
