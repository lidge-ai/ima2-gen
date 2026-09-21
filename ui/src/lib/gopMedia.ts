import type { GraphEdge, GraphNode } from "../store/storeTypes";
import { isVideoUrl } from "./videoMedia";

/**
 * Thu gom media cho hai vai tro GOP.
 *
 * Node GOP khong goi mo hinh nao - no chi gom lai nhung gi cac canh vao mang
 * toi, cong voi nhung gi nguoi dung tu dinh vao chinh no. Nho vay bam GOP
 * khong ton tien va chay trong vai giay.
 */

export type MucGop = {
  /** Duong dan /generated/... */
  url: string;
  loai: "anh" | "video";
  /** Node mang no toi, hoac null neu nguoi dung tu dinh. */
  tuNode: string | null;
};

/** Danh sach media mac dinh cua mot node GOP: theo dung thu tu canh vao. */
export function gomTuCanhVao(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): MucGop[] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((e) => {
      const n = nodes.find((x) => x.id === e.source);
      const url = n?.data?.imageUrl;
      if (!url) return null;
      return { url, loai: isVideoUrl(url) ? "video" : "anh", tuNode: e.source } as MucGop;
    })
    .filter((x): x is MucGop => !!x);
}

/**
 * Toan bo media cua MOT node GOP, da xep dung thu tu.
 *
 * Gom hai nguon: cac canh noi vao va nhung tep nguoi dung tu dinh len chinh
 * node. Node ve ra danh sach nay, va luot chay khuon ghep cung danh sach nay -
 * de moi ben tu tinh lai thi hai ben se lech nhau luc them bot canh.
 */
export function mucGopCuaNode(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  data: { referenceImages?: readonly string[]; thuTuGop?: readonly string[] },
): MucGop[] {
  const tuCanh = gomTuCanhVao(nodeId, nodes, edges);
  const tuTay = (data.referenceImages ?? []).map((url) => ({
    url, loai: isVideoUrl(url) ? ("video" as const) : ("anh" as const), tuNode: null,
  }));
  return xepTheoThuTu([...tuCanh, ...tuTay], data.thuTuGop);
}

/**
 * Thu tu cuoi cung cua node GOP.
 *
 * `thuTu` la danh sach url nguoi dung da sap xep, luu trong data cua node. Cai
 * gi co trong thu tu thi giu dung cho; cai moi noi vao ma chua co trong thu tu
 * thi xep tiep phia sau - nho vay noi them mot canh khong lam mat thu tu cu.
 */
export function xepTheoThuTu(muc: MucGop[], thuTu: readonly string[] | undefined): MucGop[] {
  if (!thuTu?.length) return muc;
  const con = [...muc];
  const ra: MucGop[] = [];
  for (const url of thuTu) {
    const i = con.findIndex((m) => m.url === url);
    if (i >= 0) ra.push(...con.splice(i, 1));
  }
  return [...ra, ...con];
}

/** Doi cho hai muc canh nhau; tra ve danh sach url de luu lai. */
export function doiCho(muc: MucGop[], tuViTri: number, den: number): string[] {
  const ds = muc.map((m) => m.url);
  if (den < 0 || den >= ds.length) return ds;
  const [x] = ds.splice(tuViTri, 1);
  ds.splice(den, 0, x!);
  return ds;
}

/** Goi may chu ghep danh sach thanh MOT video. */
export async function ghepThanhVideo(muc: MucGop[], giayMoiAnh = 2): Promise<string> {
  if (muc.length < 2) throw new Error("can it nhat hai muc de ghep");
  const res = await fetch("/api/media/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: muc.map((m) => ({ filename: m.url.replace(/^\/generated\//, "") })),
      imageSec: giayMoiAnh,
    }),
  });
  const kq = await res.json().catch(() => null);
  if (!res.ok) throw new Error(kq?.error?.message || `HTTP ${res.status}`);
  const url = String(kq?.url || "");
  if (!url) throw new Error("may chu khong tra ve video nao");
  return url;
}
