/**
 * Chay ca mot khuon: BAT DAU -> ... -> KET THUC.
 *
 * Khac voi luot chay theo o danh dau (runNodeBatch), luot nay khong hoi nguoi
 * dung chon gi: hai node MOC da ve san duong di roi. Cho xong tung node moi
 * sang node sau, vi node sau an ANH cua node truoc.
 *
 * Gap loi thi DUNG HAN chu khong chay tiep: moi node phia sau deu an theo node
 * vua hong, chay tiep chi tao ra mot loat ket qua sai va ton tien that.
 */
import type { ClientNodeId } from "../lib/graph";
import { validateBatchDependencies } from "../lib/nodeBatch";
import { canhAnhVao, locCanhAnh } from "../lib/canhAnh";
import { dauVaoVideoCuaNode, timChuoiChay, viecCuaNode } from "../lib/chayWorkflow";
import { ghepThanhVideo, mucGopCuaNode } from "../lib/gopMedia";
import { t } from "../i18n";
import type { AppState } from "./storeTypes";

type StoreSet = (p: Partial<AppState>) => void;
type StoreGet = () => AppState;

/** Chay mot node theo dung vai tro cua no. Tra ve false khi that bai. */
async function chayMotNode(
  nodeId: string,
  viec: "anh" | "video" | "gop-video",
  chaThayThe: string | null,
  get: StoreGet,
): Promise<boolean> {
  if (viec === "anh") {
    const sid = await get().runGenerateNodeInPlace(nodeId as ClientNodeId, {
      parentServerNodeIdOverride: chaThayThe,
      suppressToast: true,
    });
    return Boolean(sid);
  }
  if (viec === "video") {
    const { ta } = dauVaoVideoCuaNode(nodeId, get().graphNodes, get().graphEdges);
    await get().runVideoGenerate(nodeId as ClientNodeId, ta);
    // runVideoGenerate khong tra ve gi, no ghi thang vao node - nen doc lai
    // trang thai node moi biet la xong hay hong.
    return get().graphNodes.find((n) => n.id === nodeId)?.data.status === "ready";
  }
  // GOP VIDEO khong goi mo hinh nao, nhung van mat vai giay ffmpeg: phai tu dat
  // trang thai cho, khong thi node dung im va nguoi dung tuong la treo.
  const node = get().graphNodes.find((n) => n.id === nodeId);
  if (!node) return false;
  const muc = mucGopCuaNode(nodeId, get().graphNodes, get().graphEdges, node.data);
  if (muc.length < 2) {
    get().showToast(t("node.wfMergeNeedTwo"), true);
    return false;
  }
  get().updateNodeData(nodeId as ClientNodeId, { status: "pending" });
  try {
    const url = await ghepThanhVideo(muc);
    get().updateNodeData(nodeId as ClientNodeId, { imageUrl: url, status: "ready" });
    return true;
  } catch (e) {
    get().updateNodeData(nodeId as ClientNodeId, {
      status: "error",
      error: String((e as Error).message || e),
    });
    return false;
  }
}

export async function chayWorkflowImpl(
  startId: ClientNodeId,
  set: StoreSet,
  get: StoreGet,
): Promise<void> {
  if (get().wfDangChay) return;
  const chuoi = timChuoiChay(startId, get().graphNodes, get().graphEdges);
  if (!chuoi.ok) {
    get().showToast(t(`node.wfErr.${chuoi.loi}`), true);
    return;
  }
  if (chuoi.soViec === 0) {
    get().showToast(t("node.wfEmpty"), true);
    return;
  }
  // Node an theo mot cha NAM NGOAI khuon ma cha do chua tung sinh ra gi thi ca
  // luot chay se ra rac - chan tu dau thay vi de no chay het roi moi hong.
  const thieuCha = validateBatchDependencies(
    [...get().graphNodes],
    locCanhAnh(get().graphEdges, get().graphNodes),
    chuoi.thuTu,
  );
  if (thieuCha.length > 0) {
    get().showToast(t("node.wfParentRequired", { count: thieuCha.length }), true);
    return;
  }

  set({ wfDangChay: startId, wfNodeHienTai: null, wfDungLai: false, wfDaXong: 0, wfTongViec: chuoi.soViec });
  const moiNhat = new Map<string, string>();
  let xong = 0;
  let hong: string | null = null;
  try {
    for (const id of chuoi.thuTu) {
      if (get().wfDungLai) break;
      const node = get().graphNodes.find((n) => n.id === id);
      if (!node) continue;
      const viec = viecCuaNode(node);
      if (viec === "moc" || viec === "bo-qua") continue;
      const canhVao = canhAnhVao(get().graphEdges, get().graphNodes, id)[0];
      const chaThayThe = canhVao
        ? moiNhat.get(canhVao.source) ?? node.data.parentServerNodeId ?? null
        : null;
      set({ wfNodeHienTai: id });
      const ok = await chayMotNode(id, viec, chaThayThe, get);
      if (!ok) { hong = id; break; }
      xong += 1;
      set({ wfDaXong: xong });
      const sid = get().graphNodes.find((n) => n.id === id)?.data.serverNodeId;
      if (sid) moiNhat.set(id, sid);
    }
    if (hong) {
      get().showToast(t("node.wfStopped", { node: hong, done: xong, total: chuoi.soViec }), true);
    } else if (get().wfDungLai) {
      get().showToast(t("node.wfCanceled", { done: xong, total: chuoi.soViec }), true);
    } else {
      get().showToast(t("node.wfDone", { done: xong, total: chuoi.soViec }));
    }
    get().scheduleGraphSave();
  } finally {
    set({ wfDangChay: null, wfNodeHienTai: null, wfDungLai: false });
  }
}

export function dungWorkflowImpl(set: StoreSet, get: StoreGet): void {
  if (!get().wfDangChay) return;
  set({ wfDungLai: true });
}
