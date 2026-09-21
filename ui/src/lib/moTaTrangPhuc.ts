import type { GraphEdge, GraphNode } from "../store/storeTypes";

/**
 * Doc mot anh flat lay trang phuc ra mot cau liet ke tung mon do, roi dien vao
 * prompt cua cac node dung anh do lam THAM CHIEU.
 *
 * Vi sao can buoc nay: anh tham chieu giu duoc chi tiet (hoa tiet, tui, nep vai)
 * nhung KHONG quyet dinh duoc mac cai gi. Da thu hai kieu prompt chi tro vao anh
 * ma khong goi ten mon do - ca hai deu hong: mot lan mo hinh nhuom mau bo do cu
 * tren anh nen, mot lan giu nguyen do cu. Cai quyet dinh la chu.
 *
 * Nen khi doi anh trang phuc, phai doi ca loi ta o cac node phia sau; neu khong
 * thi anh ta mot dang, chu ta mot neo.
 */

/** Doan prompt bi thay: giua "She wears: " va cau luat bat dau bang "Use the reference image". */
const KHUON_MO_TA = /She wears: [\s\S]*?\. Use the reference image/;

export function thayMoTaTrongPrompt(prompt: string, moTa: string): string | null {
  if (!KHUON_MO_TA.test(prompt)) return null;
  return prompt.replace(KHUON_MO_TA, `She wears: ${moTa}. Use the reference image`);
}

/**
 * Cac node dung `nodeId` lam anh THAM CHIEU.
 *
 * Canh vao DAU TIEN cua mot node la anh nen dem di sua, cac canh sau moi la
 * tham chieu. Node trang phuc luon o vai tro tham chieu, nen bo qua canh dau -
 * lay ca canh dau thi se dien nham vao node nhan no lam anh nen.
 */
export function timNodeDungThamChieu(nodeId: string, edges: readonly GraphEdge[]): string[] {
  const theoDich = new Map<string, string[]>();
  for (const e of edges) {
    const list = theoDich.get(e.target) ?? [];
    list.push(e.source);
    theoDich.set(e.target, list);
  }
  const ra: string[] = [];
  for (const [dich, nguon] of theoDich) {
    if (nguon.slice(1).includes(nodeId)) ra.push(dich);
  }
  return ra;
}

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
        content: "This is a flat lay of ONE outfit. List every garment and accessory in ONE English sentence, separated by commas. For each item give its colour, material, cut and length. Be exact about anything a careless reader would get wrong: the NUMBER and ARRANGEMENT of printed motifs (say 'six small bears scattered in two rows', not 'a bear print'), the ORIENTATION of a pattern (diagonal/bias vs straight grid), whether a skirt is PLEATED or smooth, and any lettering exactly as written. If an item is normally worn on the face or head, say it is carried in the hand, not worn. Output only the list, no preamble, no numbering.",
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
): Promise<KetQuaDienMoTa> {
  const node = nodes.find((n) => n.id === nodeId);
  const imageUrl = node?.data?.imageUrl;
  if (!imageUrl) throw new Error("node chua co anh de doc");

  const moTa = await docMoTaTuAnh(imageUrl);
  const daDien: string[] = [];
  const boQua: string[] = [];
  for (const dich of timNodeDungThamChieu(nodeId, edges)) {
    const n = nodes.find((x) => x.id === dich);
    const moi = n ? thayMoTaTrongPrompt(n.data.prompt || "", moTa) : null;
    if (moi) { datPrompt(dich, moi); daDien.push(dich); } else boQua.push(dich);
  }
  return { moTa, daDien, boQua };
}
