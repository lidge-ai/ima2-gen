import { memo, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { createPortal } from "react-dom";
import { dienMoTaTrangPhuc } from "../lib/moTaTrangPhuc";
import { khoaPrompt, laNodeMoc, laVaiTroGop, layVaiTro, VAI_TRO } from "../lib/vaiTroNode";
import { doiCho, ghepThanhVideo, mucGopCuaNode } from "../lib/gopMedia";
import { dauVaoVideoCuaNode, dienOTrong, laViecThat, oTrongCuaKhuon, timChuoiChay } from "../lib/chayWorkflow";
import { moTaTrangPhucGanNhat, O_TRANG_PHUC } from "../lib/moTaTrangPhuc";
import {
  SIZE_PRESETS_ROW1,
  SIZE_PRESETS_ROW2,
  SIZE_PRESETS_ROW3,
  SIZE_PRESETS_ROW4,
} from "../lib/size";
import { canhAnhVao } from "../lib/canhAnh";
import { huyLuotChayApi, lichSuLuotChay, type WfLuotApi } from "../lib/wfApi";
import { useAppStore, type ImageNodeData, type GraphNode } from "../store/useAppStore";
import { useI18n } from "../i18n";
import { getImageModelShortLabel } from "../lib/imageModels";
import { formatReasoningLabel } from "../lib/reasoning";
import { isVideoUrl } from "../lib/videoMedia";
import { AssetMediaLightbox } from "./assetgen/AssetMediaLightbox";
import { buildProvenanceView } from "../lib/provenance";
import { SavePromptPopover } from "./SavePromptPopover";
import { NodeVideoSettings } from "./node-canvas/NodeVideoSettings";
import { NodeApiPanel } from "./node-canvas/NodeApiPanel";

const MAX_NODE_REFS = 5;
/**
 * Cho giu cho anh trong vi du than request.
 *
 * Giu dung tien to that de nhin la biet dinh dang can dua vao; phan than de la
 * mot chuoi khong phai base64 de may chu tu choi ngay bang mot loi ro rang,
 * thay vi de mot chuoi rac di toi tan may sinh anh.
 */
const ANH_MAU = "data:image/png;base64,<base64 cua anh>";
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

/** Dung dung bang ti le cua bang dieu khien, khong bay ra mot bang rieng. */
const TI_LE_KHUON = [
  ...SIZE_PRESETS_ROW1,
  ...SIZE_PRESETS_ROW2,
  ...SIZE_PRESETS_ROW3,
  ...SIZE_PRESETS_ROW4,
];

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
  // Luot chay do MAY CHU dieu khien (co he thong khac goi API vao). Node phai
  // bay ra dung nhu luc bam tay, khong thi nguoi dung ngoi nhin mot canvas tu
  // nhien doi anh ma khong hieu vi sao.
  const wfApiChay = useAppStore((st) => st.wfApiChay);
  const luotApiCuaMoc = useMemo(
    () => Object.values(wfApiChay).find((r) => r.startNodeId === id) ?? null,
    [wfApiChay, id],
  );
  const nodeDangChayTuApi = useMemo(
    () => Object.values(wfApiChay).some((r) => r.nodeHienTai === id),
    [wfApiChay, id],
  );
  // Node dang duoc may chu sinh cung la node dang ban: khoa o nhap va bay lop
  // phu nhu moi lan sinh khac, khong thi nguoi dung sua vao mot node ma ket qua
  // sap bi ghi de.
  // Doc mo ta bo do tinh la node con ban: no chay ngay sau khi sinh xong va con
  // sua prompt cua cac node khac, nen bo lop phu ra qua som la bao "xong" trong
  // khi viec chua xong.
  const isBusy = d.status === "pending" || d.status === "reconciling"
    || coViecDangChay || nodeDangChayTuApi || dangDocDo;
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
  /**
   * Cau ta bo do dung cho node nay: cua node BOC DO gan nhat phia truoc.
   *
   * Co no thi `{{TRANG_PHUC}}` khong con la o trong chua dien - bam GEN duoc
   * ngay. Truoc day them mot node moi mang o trong nay la khong bam GEN duoc,
   * du ca khuon da co san cau ta.
   */
  const moTaBoDo = useMemo(
    () => moTaTrangPhucGanNhat(id, graphNodes, graphEdges),
    [id, graphNodes, graphEdges],
  );
  const oTrongChuaDien = useMemo(() => {
    const dayDu = dienOTrong(d.prompt || "", moTaBoDo ? { [O_TRANG_PHUC]: moTaBoDo } : {});
    return /\{\{[A-Z_]+\}\}/.exec(dayDu)?.[0] ?? null;
  }, [d.prompt, moTaBoDo]);
  /** O trong duy nhat con lai la TRANG_PHUC, va chua ai chay BOC DO. */
  const thieuMoTaBoDo = !moTaBoDo && (d.prompt || "").includes(`{{${O_TRANG_PHUC}}}`);
  const canhBaoOTrong = useCallback(() => {
    if (thieuMoTaBoDo) { showToast(t("node.outfitNotReadYet"), true); return true; }
    if (!oTrongChuaDien) return false;
    showToast(t("node.placeholderLeft", { slot: oTrongChuaDien, fallback: `Prompt con o trong ${oTrongChuaDien} chua dien` }), true);
    return true;
  }, [oTrongChuaDien, thieuMoTaBoDo, showToast, t]);

  // Node mang vai tro VIDEO thi GEN phai sinh VIDEO. Truoc day vai tro chi la
  // cai nhan: bam GEN tren node video van sinh ra anh, ghi de mat clip.
  const laNodeVideo = d.vaiTro === "video";
  const doiCaiDatVideo = useCallback((patch: Partial<NonNullable<typeof d.caiDatVideo>>) => {
    // Bo mot lua chon = xoa han khoi node, khong luu `undefined`: o trong phai
    // co nghia "theo cai dat chung", va mot truong undefined con lai trong graph
    // se khien lan doc sau khong phan biet duoc hai truong hop.
    const goc = { ...(d.caiDatVideo ?? {}), ...patch };
    const con = Object.fromEntries(Object.entries(goc).filter(([, v]) => v !== undefined && v !== ""));
    updateNodeData(id, { caiDatVideo: Object.keys(con).length ? con : null });
  }, [d.caiDatVideo, id, updateNodeData]);
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
  const [lichSu, setLichSu] = useState<WfLuotApi[] | null>(null);
  const [dangTaiLichSu, setDangTaiLichSu] = useState(false);
  const duongApi = activeSessionId && laMocDau
    ? `/api/wf/${activeSessionId}/${id}` : null;
  const oTrongKhuon = useMemo(
    // Truyen ca `graphEdges`: o trong `{{TRANG_PHUC}}` o node sau BOC DO duoc
    // chinh luot chay dien, khong phai thu doi nguoi goi API truyen.
    () => (chuoi?.ok ? oTrongCuaKhuon(graphNodes, chuoi.thuTu, graphEdges) : []),
    [chuoi, graphNodes, graphEdges],
  );
  // Tai lich su khi MO o API, va tai lai moi khi mot luot API vua ket thuc -
  // dung luc do danh sach vua co them mot dong.
  /**
   * Tai lai khi mot luot API vua ket thuc - dung luc danh sach co them mot dong.
   *
   * Dung ref chu khong dung `lichSu !== null`: lan tai dau tien lam gia tri do
   * doi tu false sang true, va effect chay lai ngay -> hoi may chu hai lan lien
   * cho cung mot viec.
   */
  const daMoLichSu = useRef(false);
  const taiLichSu = useCallback(async () => {
    if (!activeSessionId || !laMocDau) return;
    daMoLichSu.current = true;
    setDangTaiLichSu(true);
    try { setLichSu(await lichSuLuotChay(activeSessionId, id, 8)); }
    catch { setLichSu([]); }
    finally { setDangTaiLichSu(false); }
  }, [activeSessionId, laMocDau, id]);

  const dangChayApi = !!luotApiCuaMoc;
  useEffect(() => {
    if (!daMoLichSu.current) return;
    void taiLichSu();
  }, [dangChayApi, taiLichSu]);

  /**
   * Cac node se chay trong khuon, kem noi dung hien tai cua tung cai.
   *
   * Node BAT DAU la diem vao cua API, nhung noi dung thuc su nam o cac node
   * phia sau. Bay chung ra ngay day de khong phai bam tung node moi biet co gi
   * de truyen - va de chep mot than request da dien san.
   */
  const nodeTrongKhuon = useMemo(() => {
    if (!chuoi?.ok) return [];
    return chuoi.thuTu
      .map((nid) => graphNodes.find((n) => n.id === nid))
      .filter((n): n is GraphNode => !!n && laViecThat(n))
      .map((n) => ({
        id: n.id,
        vaiTro: layVaiTro(n.data.vaiTro)?.nhan ?? null,
        prompt: n.data.prompt ?? "",
        soAnh: (n.data.referenceImages ?? []).length,
        // Node GOP lay media tu cac canh vao chu khong nhan anh dinh kem, nen
        // dua no vao vi du se bay ra mot than request bi may chu tu choi.
        nhanAnh: n.data.vaiTro !== "gop-video" && n.data.vaiTro !== "gop-anh",
      }));
  }, [chuoi, graphNodes]);

  /**
   * Node nao nen co vi du ve anh dinh kem.
   *
   * Uu tien nhung node DANG co anh dinh san - do la cho nguoi dung thuc su dua
   * anh vao. Ca khuon chua node nao co anh thi van dua mot vi du o node dau
   * tien nhan duoc anh: thieu han phan nay thi khong ai doan ra cach truyen.
   */
  const nodeCoViDuAnh = useMemo(() => {
    const coSan = nodeTrongKhuon.filter((n) => n.nhanAnh && n.soAnh > 0);
    if (coSan.length) return coSan;
    const dau = nodeTrongKhuon.find((n) => n.nhanAnh);
    return dau ? [dau] : [];
  }, [nodeTrongKhuon]);

  /** Than request day du: o trong, anh dinh kem, va noi dung tung node. */
  const thanDayDu = useMemo(() => {
    const than: Record<string, unknown> = {};
    if (oTrongKhuon.length) {
      than.inputs = Object.fromEntries(oTrongKhuon.map((o) => [o, ""]));
    }
    if (nodeCoViDuAnh.length) {
      than.images = Object.fromEntries(nodeCoViDuAnh.map((n) => [n.id, [ANH_MAU]]));
    }
    if (nodeTrongKhuon.length) {
      than.nodes = Object.fromEntries(nodeTrongKhuon.map((n) => [n.id, { prompt: n.prompt }]));
    }
    return JSON.stringify(than, null, 2);
  }, [oTrongKhuon, nodeCoViDuAnh, nodeTrongKhuon]);

  /**
   * Cac cach goi khuon nay.
   *
   * Mot khuon co ba kieu goi va hai tuyen theo doi; de nguoi dung tu doan hay
   * di doc tai lieu thi ho chi biet duong mac dinh. Bay het ra day, moi dong mot
   * nut chep san lenh cua chinh dong do.
   */
  const cacTuyen = useMemo(() => {
    if (!duongApi) return [];
    const goc = window.location.origin;
    const dauJson = `-H 'Content-Type: application/json'`;
    const than = `-d '${thanDayDu}'`;
    return [
      {
        duong: `POST ${duongApi}`,
        ghiChu: t("node.wfApiWait"),
        lenh: `curl -X POST ${goc}${duongApi} \\
  ${dauJson} \\
  ${than}`,
      },
      {
        duong: `POST ${duongApi}?stream=1`,
        ghiChu: t("node.wfApiStream"),
        lenh: `curl -N -X POST '${goc}${duongApi}?stream=1' \\
  ${dauJson} \\
  ${than}`,
      },
      {
        duong: `POST ${duongApi}?async=1`,
        ghiChu: t("node.wfApiAsync"),
        lenh: `curl -X POST '${goc}${duongApi}?async=1' \\
  ${dauJson} \\
  ${than}`,
      },
      {
        duong: "GET /api/wf/runs/:runId",
        ghiChu: t("node.wfApiStatus"),
        lenh: `curl ${goc}/api/wf/runs/RUN_ID`,
      },
      {
        duong: "GET /api/wf/runs/:runId/stream",
        ghiChu: t("node.wfApiStreamRun"),
        lenh: `curl -N ${goc}/api/wf/runs/RUN_ID/stream`,
      },
    ];
  }, [duongApi, thanDayDu, t]);


  /** Than chi de ghi de MOT node - bam mot cai la co ngay lenh sua node do. */
  const thanMotNode = useCallback(
    (n: { id: string; prompt: string; nhanAnh: boolean; soAnh: number }) => JSON.stringify({
      ...(n.nhanAnh && n.soAnh > 0 ? { images: { [n.id]: [ANH_MAU] } } : {}),
      nodes: { [n.id]: { prompt: n.prompt } },
    }, null, 2),
    [],
  );

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


  /**
   * Doc flat lay ra mo ta roi dien vao cac node phia sau.
   *
   * Chay NGAY sau khi node BOC DO sinh xong, khong con la mot nut rieng: boc do
   * ma khong doc lai mo ta thi cac node sau van mang cau ta bo do truoc, va chu
   * moi la thu quyet dinh mac gi - bo do cu se quay lai. De nguoi dung phai nho
   * bam them mot nut la de san mot cai bay.
   *
   * Doc graph tu store thay vi tu closure: ham nay chay sau khi sinh xong, luc
   * do anh moi da vao store con ban trong closure thi con la anh cu.
   */
  const docBoDo = useCallback(async () => {
    const st = useAppStore.getState();
    setDangDocDo(true);
    try {
      const kq = await dienMoTaTrangPhuc(
        id, st.graphNodes, st.graphEdges, st.updateNodePrompt,
        (dichId, url) => st.addNodeReferenceFromUrl(dichId, url),
      );
      // Luu cau ta LEN NODE: bam GEN mot node le o giao dien thi khong co buoc
      // nao doc anh ca, no dien o trong `{{TRANG_PHUC}}` tu day.
      updateNodeData(id, { moTaTrangPhuc: kq.moTa });
      showToast(t("node.outfitFilled", { n: String(kq.daDien.length), fallback: `Da dien mo ta vao ${kq.daDien.length} node` }), false);
    } catch (e) {
      showToast(String((e as Error).message || e), true);
    } finally {
      setDangDocDo(false);
    }
  }, [id, showToast, t, updateNodeData]);

  /** Node BOC DO thi sinh xong la doc mo ta luon. */
  const laNodeBocDo = d.vaiTro === "trang-phuc";
  /**
   * Node BOC DO khong co anh nao vao thi no tu nghi ra mot bo do.
   *
   * Chi NHAC, khong chan: co nguoi co y khong dinh anh de mo hinh tu bia ra mot
   * bo. Chan lai la quyet dinh ho tra tien nhung khong duoc chon.
   *
   * Nhac o day vi hay quen nhat khi vua copy tu template: template KHONG mang
   * anh dinh theo (co y - de data URL khong vao co so du lieu), nen ban moi copy
   * ra la node trong tron va khong co gi noi cho biet.
   */
  const bocDoThieuAnh = laNodeBocDo
    && refs.length === 0
    && canhAnhVao(graphEdges, graphNodes, id).length === 0;
  const sauKhiSinh = useCallback(async () => {
    if (laNodeBocDo) await docBoDo();
  }, [laNodeBocDo, docBoDo]);

  const onGenerate = useCallback(() => {
    if (canhBaoOTrong()) return;
    // Node VIDEO phai di duong runVideoGenerate (biet node) chu khong phai
    // animateImage: duong kia chi nhan ten tep nen khong dat duoc trang thai
    // cho, va ket qua khong gan vao node nao.
    if (laNodeVideo) { void runVideoGenerate(id, dauVaoVideo.ta); return; }
    void generateNode(id).then(sauKhiSinh);
  }, [id, generateNode, canhBaoOTrong, laNodeVideo, runVideoGenerate, dauVaoVideo, sauKhiSinh]);

  const onRegenerateInPlace = useCallback(() => {
    if (canhBaoOTrong()) return;
    if (laNodeVideo) { void runVideoGenerate(id, dauVaoVideo.ta); return; }
    void generateNodeInPlace(id).then(sauKhiSinh);
  }, [id, generateNodeInPlace, canhBaoOTrong, laNodeVideo, runVideoGenerate, dauVaoVideo, sauKhiSinh]);

  const onNewVariation = useCallback(() => {
    void generateNodeVariation(id);
  }, [id, generateNodeVariation]);


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
      className={`image-node image-node--${coViecDangChay ? "pending" : d.status}${selected ? " image-node--selected" : ""}${laMoc ? " image-node--moc" : ""}${wfNodeHienTai === id || nodeDangChayTuApi ? " image-node--wf-hien-tai" : ""}`}
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
          node nao dang sai.
          Ma la CHU THUONG, khong phai nut: ca dai nay la cho de keo node di, va
          truoc day no la nut chep nen bam vao chi chep chu khong keo duoc. Viec
          chep chuyen sang mot icon rieng ben canh. */}
      <div className="image-node__id" title={d.label ? `${id} - ${d.label}` : id}>
        <span className="image-node__id-ma">{id}</span>
        <button
          type="button"
          className="image-node__id-copy nodrag"
          onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(id); }}
          title={t("node.copyId", { fallback: "Copy node id" })}
          aria-label={t("node.copyId", { fallback: "Copy node id" })}
        >
          <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
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
                {luotApiCuaMoc
                  ? t("node.wfApiRunning", { done: luotApiCuaMoc.daXong, total: luotApiCuaMoc.tong })
                  : khuonNayDangChay
                    ? t("node.wfRunning", { done: wfDaXong, total: wfTongViec })
                    : chuoi?.ok
                      ? t("node.wfSteps", { count: chuoi.soViec })
                      : t(`node.wfErr.${chuoi?.loi ?? "thieu-ket-thuc"}`)}
              </div>
              {luotApiCuaMoc ? (
                <button
                  type="button"
                  className="image-node__wf-nut image-node__wf-nut--dung"
                  onClick={(e) => {
                    e.stopPropagation();
                    void huyLuotChayApi(luotApiCuaMoc.runId).catch((err) =>
                      showToast(String((err as Error).message || err), true));
                  }}
                  title={t("node.wfApiStopTitle")}
                >
                  {t("node.wfStop")}
                </button>
              ) : khuonNayDangChay ? (
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
              {/* Ti le chung cua ca khuon. Dat o tung node thi them mot node
                  moi la quen, va node quen do roi ve mac dinh cua may chu -
                  cung mot luot chay ra may tam doc may tam vuong. */}
              <label className="image-node__khuon-size nodrag">
                <span>{t("node.wfSize")}</span>
                <select
                  value={typeof d.size === "string" ? d.size : ""}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateNodeData(id, { size: e.target.value || null })}
                >
                  <option value="">{t("node.wfSizeNone")}</option>
                  {TI_LE_KHUON.map((v) => (
                    <option key={v.value} value={v.value}>{v.label} · {v.sub}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="image-node__moc-so">{t("node.wfEndHint")}</div>
          )}
          {duongApi ? (
            <NodeApiPanel
              cacTuyen={cacTuyen}
              oTrongKhuon={oTrongKhuon}
              nodeTrongKhuon={nodeTrongKhuon}
              thanMotNode={thanMotNode}
              lichSu={lichSu}
              dangTaiLichSu={dangTaiLichSu}
              taiLichSu={() => void taiLichSu()}
            />
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
        {bocDoThieuAnh ? (
          <div className="image-node__thieu-anh">
            {t("node.bocDoNeedRef")}
          </div>
        ) : null}
        {/* Cai dat rieng cua node video: bang ben phai la cai dat chung ca
            phien, con mot khuon co the co hai node video khac ti le nhau - va
            khi chay qua API thi khong ai ngoi chon o bang do ca. */}
        {laNodeVideo ? (
          <NodeVideoSettings
            caiDat={d.caiDatVideo}
            coAnhNen={Boolean(dauVaoVideo.anh)}
            doi={doiCaiDatVideo}
          />
        ) : null}
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
