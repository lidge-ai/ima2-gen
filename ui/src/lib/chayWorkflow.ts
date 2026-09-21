/**
 * Chuoi chay cua mot khuon: tu node BAT DAU den node KET THUC.
 *
 * Node MOC khong sinh gi ca - chung chi noi cho may biet dau la mot khuon hoan
 * chinh. Bam chay tren MOC DAU thi moi node nam sau no duoc chay LAN LUOT theo
 * dung thu tu phu thuoc, cho xong node truoc roi moi sang node sau. Phai cho
 * that su: node sau an anh cua node truoc, chay song song thi node sau lay
 * nham anh cu.
 */
import {
  collectDownstream,
  findCycleNodeIds,
  topologicalSortSelected,
} from "./nodeBatch";
import { canhAnhVao } from "./canhAnh";
import { isVideoUrl } from "./videoMedia";
import type { GraphEdge, GraphNode } from "../store/storeTypes";

/** Viec mot node phai lam trong luot chay. */
export type LoaiViec = "moc" | "bo-qua" | "anh" | "video" | "gop-video";

export function viecCuaNode(node: GraphNode): LoaiViec {
  // Node tham chieu nguyen lieu la DAU VAO, khong bao gio la dich sinh ra.
  if (node.type === "elementReferenceNode") return "bo-qua";
  const v = node.data?.vaiTro;
  if (v === "bat-dau" || v === "ket-thuc") return "moc";
  // GOP ANH chi bay ra danh sach anh cua cac canh vao, khong co gi de chay.
  if (v === "gop-anh") return "bo-qua";
  if (v === "gop-video") return "gop-video";
  if (v === "video") return "video";
  return "anh";
}

/** Node cha theo canh ANH vao DAU TIEN - canh do la anh nen, cac canh sau la ref. */
export function nodeChaDau(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphNode | null {
  const canh = canhAnhVao(edges, nodes, nodeId)[0];
  return canh ? nodes.find((n) => n.id === canh.source) ?? null : null;
}

/**
 * Anh va loi ta mot node VIDEO dung lam dau vao.
 *
 * Node CANH chi sinh anh, node VIDEO chi sinh video. Node video noi vao mot node
 * canh thi dung ANH va LOI TA cua canh do; prompt rieng cua node video la phan
 * GHI THEM chu khong thay the. Khong noi vao dau thi dung anh nguoi dung tu dinh.
 */
export function dauVaoVideoCuaNode(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { anh: string | null; ta: string } {
  const node = nodes.find((n) => n.id === nodeId);
  const cha = nodeChaDau(nodeId, nodes, edges);
  const laAnh = (u?: string | null) => !!u && !isVideoUrl(u);
  const anh =
    (laAnh(cha?.data?.imageUrl) ? cha!.data.imageUrl! : null)
    ?? (laAnh(node?.data?.imageUrl) ? node!.data.imageUrl! : null)
    ?? node?.data?.videoSourceUrl
    ?? null;
  const taCha = (cha?.data?.prompt || "").trim();
  const taRieng = (node?.data?.prompt || "").trim();
  const ta = taRieng ? (taCha ? `${taCha} ${taRieng}` : taRieng) : taCha;
  return { anh, ta };
}

export type LoiChuoi = "khong-phai-moc-dau" | "thieu-ket-thuc" | "vong-lap";

export type KetQuaChuoi =
  | { ok: true; thuTu: string[]; ketThuc: string; soViec: number }
  | { ok: false; loi: LoiChuoi };

/**
 * Chuoi chay bat dau tu `startId`.
 *
 * Lay MOI node nam sau moc dau, khong chi nhung node nam tren duong di toi moc
 * cuoi: mot nhanh re ra ma khong noi vao moc cuoi van la viec nguoi dung da dung
 * y ve, bo qua no trong im lang thi ho khong hieu vi sao node do khong chay.
 * Moc cuoi chi la dieu kien de goi la mot khuon HOAN CHINH.
 */
export function timChuoiChay(
  startId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): KetQuaChuoi {
  const start = nodes.find((n) => n.id === startId);
  if (!start || start.data?.vaiTro !== "bat-dau") return { ok: false, loi: "khong-phai-moc-dau" };

  const batNode = [...nodes];
  const batEdge = [...edges];
  const phiaSau = collectDownstream(batEdge, startId);
  const tap = [startId, ...phiaSau];
  const ketThuc = phiaSau.find((id) => nodes.find((n) => n.id === id)?.data?.vaiTro === "ket-thuc");
  if (!ketThuc) return { ok: false, loi: "thieu-ket-thuc" };
  if (findCycleNodeIds(batNode, batEdge, tap).length > 0) return { ok: false, loi: "vong-lap" };

  const thuTu = topologicalSortSelected(batNode, batEdge, tap);
  const soViec = thuTu.filter((id) => {
    const n = nodes.find((x) => x.id === id);
    return n ? viecCuaNode(n) !== "moc" && viecCuaNode(n) !== "bo-qua" : false;
  }).length;
  return { ok: true, thuTu, ketThuc, soViec };
}
