/**
 * Doc mot anh flat lay trang phuc ra mot cau liet ke tung mon do, roi thay vao
 * prompt cua cac node dung anh do lam THAM CHIEU.
 *
 * Vi sao can buoc nay: anh tham chieu giu duoc chi tiet (hoa tiet, tui, nep vai)
 * nhung KHONG quyet dinh duoc mac cai gi. Da thu hai kieu prompt chi tro vao anh
 * ma khong goi ten mon do - ca hai deu hong: mot lan mo hinh nhuom mau bo do cu
 * tren anh nen, mot lan giu nguyen do cu. Cai quyet dinh la chu.
 *
 * Nen khi doi anh trang phuc, phai doi ca loi ta o cac node phia sau; neu khong
 * thi anh ta mot dang, chu ta mot neo - dung cai bay da xay ra that: flat lay la
 * bo cardigan moi, con hai node sau van mang chu ta bo ao in nui cu.
 *
 * Module nay THUAN TUY va dung chung: giao dien goi khi nguoi dung bam "Doc bo
 * do", may chu goi trong luot chay khuon. Hai ban rieng se lech nhau.
 */

/**
 * O TRONG de bo do moi do vao: `{{TRANG_PHUC}}`.
 *
 * Day la duong CHINH. Buoc BOC DO doc flat lay ra mot cau roi dien vao o nay,
 * nen prompt viet the nao cung duoc - "He wears: {{TRANG_PHUC}}", "Outfit:
 * {{TRANG_PHUC}}", hay mot cau tieng Viet - deu an. Bat theo khoi chu
 * "She wears: ..." (xem KHUON_MO_TA duoi) chi con la duong DU PHONG cho prompt
 * viet truoc khi co o trong: no dong cung tieng Anh va gioi tinh, gap model nam
 * la khong khop, va khong khop thi IM LANG - ra dung bo do cu.
 */
export const O_TRANG_PHUC = "TRANG_PHUC";

/**
 * Duong du phong: doan prompt giua "She wears: " (hoac cach noi tuong duong) va
 * cau luat bat dau bang "Use the reference image".
 *
 * Giu lai nguyen chu dan dau da viet trong prompt - doi "He wears" thanh
 * "She wears" la tu tay doi gioi tinh cua nhan vat.
 */
export const KHUON_MO_TA =
  /(She wears|He wears|They wear|Wearing|Outfit): [\s\S]*?\. Use the reference image/;

export function thayMoTaTrongPrompt(prompt: string, moTa: string): string | null {
  const khop = KHUON_MO_TA.exec(prompt);
  if (!khop) return null;
  return prompt.replace(KHUON_MO_TA, `${khop[1]}: ${moTa}. Use the reference image`);
}

/**
 * Cau hoi doc anh ra mo ta.
 *
 * Siet vao dung nhung cho mot nguoi doc vo tam se bo qua - so luong va cach sap
 * hoa tiet, huong ke, xep ly hay tron - vi mo ta vo thuong lam mo hinh sinh ra
 * mot bo do "na na" thay vi dung bo do do.
 */
export const CAU_HOI_MO_TA =
  "This is a flat lay of ONE outfit. List every garment and accessory in ONE English sentence, "
  + "separated by commas. For each item give its colour, material, cut and length. Be exact about "
  + "anything a careless reader would get wrong: the NUMBER and ARRANGEMENT of printed motifs "
  + "(say 'six small bears scattered in two rows', not 'a bear print'), the ORIENTATION of a pattern "
  + "(diagonal/bias vs straight grid), whether a skirt is PLEATED or smooth, and any lettering exactly "
  + "as written. If an item is normally worn on the face or head, say it is carried in the hand, not "
  + "worn. Output only the list, no preamble, no numbering.";

type CanhCoNguon = { source: string; target: string };
type NodeCoPrompt = { id: string; data?: { prompt?: string | undefined } | undefined };
type NodeCoMoTa = {
  id: string;
  data?: {
    vaiTro?: string | undefined;
    /** Cau ta bo do doc duoc tu flat lay cua CHINH node BOC DO nay. */
    moTaTrangPhuc?: string | null | undefined;
  } | undefined;
};

/**
 * Cau ta bo do dung cho mot node: cua node BOC DO gan nhat PHIA TRUOC no.
 *
 * Luot chay o may chu doc lai flat lay moi lan, nhung giao dien thi khong: bam
 * GEN mot node le thi khong co buoc nao doc anh ca. Nen node BOC DO luu lai cau
 * ta da doc, va node phia sau dien o trong `{{TRANG_PHUC}}` tu day.
 *
 * Luu NGOAI prompt chu khong viet thang vao prompt: viet vao la prompt trong
 * graph mang mot bo do cu thi, doi anh trang phuc xong van ra do cu - dung cai
 * bay da phai sua mot lan.
 */
export function moTaTrangPhucGanNhat(
  nodeId: string,
  nodes: readonly NodeCoMoTa[],
  edges: readonly CanhCoNguon[],
): string | null {
  const cha = new Map<string, string[]>();
  for (const e of edges) {
    const ds = cha.get(e.target) ?? [];
    ds.push(e.source);
    cha.set(e.target, ds);
  }
  const daQua = new Set<string>([nodeId]);
  const hang = [nodeId];
  for (let i = 0; i < hang.length; i++) {
    for (const c of cha.get(hang[i]!) ?? []) {
      if (daQua.has(c)) continue;
      daQua.add(c);
      const n = nodes.find((x) => x.id === c);
      const moTa = n?.data?.moTaTrangPhuc;
      if (n?.data?.vaiTro === "trang-phuc" && typeof moTa === "string" && moTa.trim()) {
        return moTa.trim();
      }
      hang.push(c);
    }
  }
  return null;
}

/**
 * Moi node PHIA SAU `nodeId` con mang khoi "She wears: ...".
 *
 * Khong dung duoc "node co canh ref truc tiep" o day. Khoi mo ta duoc chep
 * xuoi theo chuoi: node MAC DO lay flat lay lam tham chieu, con node CANH chi
 * lay anh nguoi da mac lam anh nen - no khong co canh nao noi ve node trang
 * phuc. Chi doi loi ta o nhung node tham chieu truc tiep thi node CANH giu
 * nguyen cau ta bo do cu, va no mac lai dung bo do cu du anh nen da dung.
 * Dung loi da xay ra: mac-hong ra ao moi, canh-hong-1 ra ao cu.
 */
export function timNodeCanDoiMoTa(
  nodeId: string,
  nodes: readonly NodeCoPrompt[],
  edges: readonly CanhCoNguon[],
): string[] {
  const con = new Map<string, string[]>();
  for (const e of edges) {
    const ds = con.get(e.source) ?? [];
    ds.push(e.target);
    con.set(e.source, ds);
  }
  const phiaSau = new Set<string>();
  const hang = [nodeId];
  for (let i = 0; i < hang.length; i++) {
    for (const c of con.get(hang[i]!) ?? []) {
      if (phiaSau.has(c) || c === nodeId) continue;
      phiaSau.add(c);
      hang.push(c);
    }
  }
  return nodes
    .filter((n) => phiaSau.has(n.id) && KHUON_MO_TA.test(n.data?.prompt ?? ""))
    .map((n) => n.id);
}

/**
 * Cac node dung `nodeId` lam anh THAM CHIEU.
 *
 * Canh vao DAU TIEN cua mot node la anh nen dem di sua, cac canh sau moi la
 * tham chieu. Node trang phuc luon o vai tro tham chieu, nen bo qua canh dau -
 * lay ca canh dau thi se dien nham vao node nhan no lam anh nen.
 */
export function timNodeDungThamChieu(
  nodeId: string,
  edges: readonly CanhCoNguon[],
): string[] {
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
