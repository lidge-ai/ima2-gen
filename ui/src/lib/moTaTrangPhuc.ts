import type { GraphEdge, GraphNode } from "../store/storeTypes";
import {
  CAU_HOI_MO_TA,
  thayMoTaTrongPrompt,
  timNodeCanDoiMoTa,
  timNodeDungThamChieu,
} from "../../../lib/moTaTrangPhuc.js";

/**
 * Doc mot anh flat lay trang phuc ra mot cau liet ke tung mon do, roi dien vao
 * prompt cua cac node dung anh do lam THAM CHIEU.
 *
 * Phan thuan tuy (khuon prompt bi thay, cau hoi doc anh, cach tim node tham
 * chieu) nam o lib/moTaTrangPhuc.ts, dung chung voi may chu: luot chay khuon goi
 * qua API cung phai doi loi ta y nhu khi nguoi dung bam "Doc bo do" tren giao
 * dien. Hai ban rieng se lech nhau.
 */
export {
  KHUON_MO_TA,
  O_TRANG_PHUC,
  moTaTrangPhucGanNhat,
  thayMoTaTrongPrompt,
  timNodeCanDoiMoTa,
  timNodeDungThamChieu,
} from "../../../lib/moTaTrangPhuc.js";

/** Hoi mo hinh liet ke tung mon do trong anh. */
export async function docMoTaTuAnh(imageUrl: string): Promise<string> {
  const anh = await fetch(imageUrl);
  if (!anh.ok) throw new Error(`khong tai duoc anh trang phuc (HTTP ${anh.status})`);
  const blob = await anh.blob();
  const dataUrl = await new Promise<string>((ok, loi) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => loi(new Error("khong doc duoc anh"));
    fr.readAsDataURL(blob);
  });

  const res = await fetch("/api/prompt-builder/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: CAU_HOI_MO_TA,
        attachments: [{ kind: "image", name: "outfit.png", mimeType: blob.type || "image/png", dataUrl }],
      }],
    }),
  });
  const kq = await res.json().catch(() => null);
  if (!res.ok) throw new Error(kq?.error?.message || `HTTP ${res.status}`);
  const chu = String(kq?.message?.content || "").trim();
  if (!chu) throw new Error("mo hinh khong tra ve mo ta nao");
  return chu;
}

export type KetQuaDienMoTa = { moTa: string; daDien: string[]; boQua: string[] };

/** Doc anh cua node roi dien mo ta vao moi node dung node do lam tham chieu. */
export async function dienMoTaTrangPhuc(
  nodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  datPrompt: (id: string, prompt: string) => void,
  dinhAnh?: (id: string, url: string) => void | Promise<void>,
): Promise<KetQuaDienMoTa> {
  const node = nodes.find((n) => n.id === nodeId);
  const imageUrl = node?.data?.imageUrl;
  if (!imageUrl) throw new Error("node chua co anh de doc");

  const moTa = await docMoTaTuAnh(imageUrl);
  const daDien: string[] = [];
  const boQua: string[] = [];
  // Doi loi ta o MOI node phia sau con mang khoi do, khong chi node tham chieu
  // truc tiep: node CANH lay anh nguoi da mac lam anh nen nen khong co canh nao
  // noi ve node trang phuc, ma no van mang cau ta bo do.
  for (const dich of timNodeCanDoiMoTa(nodeId, nodes, edges)) {
    const n = nodes.find((x) => x.id === dich);
    const moi = n ? thayMoTaTrongPrompt(n.data.prompt || "", moTa) : null;
    if (moi) { datPrompt(dich, moi); daDien.push(dich); } else boQua.push(dich);
  }
  // Dinh THEM anh trang phuc, chi vao nhung node tham chieu TRUC TIEP. Da do
  // bang thuc nghiem: anh vao qua canh ref thi yeu (hoa tiet in ra sai so luong
  // va cach sap), vao qua duong dinh kem thi bam sat ban goc - ma van giu duoc
  // mat nguoi mau, khac voi cach lay flat lay lam anh nen.
  if (dinhAnh) {
    for (const dich of timNodeDungThamChieu(nodeId, edges)) {
      await dinhAnh(dich, imageUrl);
    }
  }
  return { moTa, daDien, boQua };
}
