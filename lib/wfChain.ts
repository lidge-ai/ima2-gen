/**
 * Logic chuoi chay cua mot khuon - DUNG CHUNG cho giao dien va may chu.
 *
 * Bam CHAY tren node va goi API vao node BAT DAU phai ra dung mot thu tu, dung
 * mot cach hieu ve canh nao mang anh. De moi ben tu viet lai thi hai duong se
 * lech nhau va khong ai biet ben nao dung.
 *
 * Module nay THUAN TUY: khong doc tep, khong goi mang, khong dung bien toan cuc.
 * Nho vay may chu goi duoc ma trinh duyet cung nap duoc.
 */

/** Hinh dang toi thieu cua mot node do ca hai ben deu co. */
export type WfNodeData = {
  vaiTro?: string | undefined;
  prompt?: string | undefined;
  imageUrl?: string | null | undefined;
  videoSourceUrl?: string | null | undefined;
  serverNodeId?: string | null | undefined;
  parentServerNodeId?: string | null | undefined;
  referenceImages?: readonly string[] | undefined;
  thuTuGop?: readonly string[] | undefined;
  label?: string | undefined;
  /** Kich thuoc va mo hinh rieng cua node, neu nguoi dung da chon. */
  size?: string | null | undefined;
  model?: string | null | undefined;
};

export type WfNode = {
  id: string;
  type?: string | undefined;
  data?: WfNodeData | undefined;
};

export type WfEdge = { source: string; target: string };

/** Hai vai tro MOC: khong sinh gi, chi dinh hinh hai dau cua mot khuon. */
export const VAI_TRO_MOC_DAU = "bat-dau";
export const VAI_TRO_MOC_CUOI = "ket-thuc";

export function laVaiTroMoc(v: unknown): boolean {
  return v === VAI_TRO_MOC_DAU || v === VAI_TRO_MOC_CUOI;
}

/* ------------------------------------------------------------------ canh */

/**
 * Canh di ra tu mot node MOC la CANH THU TU: no chi noi len "chay cai nay
 * truoc", khong dua anh nao sang node sau. Khong tach ra thi node dau khuon bi
 * coi la co cha chua sinh anh va se khong bao gio chay duoc.
 */
function tapMoc(nodes: readonly WfNode[]): Set<string> {
  const ra = new Set<string>();
  for (const n of nodes) if (laVaiTroMoc(n.data?.vaiTro)) ra.add(n.id);
  return ra;
}

export function laCanhThuTu(edge: WfEdge, nodes: readonly WfNode[]): boolean {
  return tapMoc(nodes).has(edge.source);
}

/** Bo moi canh thu tu, chi giu nhung canh thuc su dua anh di. */
export function locCanhAnh<E extends WfEdge>(
  edges: readonly E[],
  nodes: readonly WfNode[],
): E[] {
  const moc = tapMoc(nodes);
  return moc.size === 0 ? [...edges] : edges.filter((e) => !moc.has(e.source));
}

/**
 * Canh ANH di vao mot node, giu nguyen thu tu goc: canh dau la anh nen, cac
 * canh sau la tham chieu.
 */
export function canhAnhVao<E extends WfEdge>(
  edges: readonly E[],
  nodes: readonly WfNode[],
  targetId: string,
): E[] {
  const moc = tapMoc(nodes);
  return edges.filter((e) => e.target === targetId && !moc.has(e.source));
}

/* ------------------------------------------------------------- thu tu chay */

/** Viec mot node phai lam trong luot chay. */
export type LoaiViec = "moc" | "bo-qua" | "anh" | "video" | "gop-video";

export function viecCuaNode(node: WfNode): LoaiViec {
  // Node tham chieu nguyen lieu la DAU VAO, khong bao gio la dich sinh ra.
  if (node.type === "elementReferenceNode") return "bo-qua";
  const v = node.data?.vaiTro;
  if (laVaiTroMoc(v)) return "moc";
  // GOP ANH chi bay ra danh sach anh cua cac canh vao, khong co gi de chay.
  if (v === "gop-anh") return "bo-qua";
  if (v === "gop-video") return "gop-video";
  if (v === "video") return "video";
  return "anh";
}

export function laViecThat(node: WfNode): boolean {
  const v = viecCuaNode(node);
  return v !== "moc" && v !== "bo-qua";
}

/** Moi node nam phia sau `rootId`, di theo MOI canh ke ca canh thu tu. */
export function phiaSauCua(edges: readonly WfEdge[], rootId: string): string[] {
  const con = new Map<string, string[]>();
  for (const e of edges) {
    const ds = con.get(e.source) ?? [];
    ds.push(e.target);
    con.set(e.source, ds);
  }
  const ra = new Set<string>();
  const hang = [rootId];
  for (let i = 0; i < hang.length; i++) {
    for (const c of con.get(hang[i]!) ?? []) {
      if (ra.has(c) || c === rootId) continue;
      ra.add(c);
      hang.push(c);
    }
  }
  return [...ra];
}

/** Sap xep topo trong mot tap con; tra ve [] khi tap do co vong lap. */
export function xepTopo(
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
  tap: Iterable<string>,
): string[] {
  const trong = new Set(tap);
  const coThat = new Set(nodes.map((n) => n.id));
  const bac = new Map<string, number>();
  const ra = new Map<string, string[]>();
  for (const id of trong) {
    if (!coThat.has(id)) continue;
    bac.set(id, 0);
    ra.set(id, []);
  }
  for (const e of edges) {
    if (!bac.has(e.source) || !bac.has(e.target)) continue;
    ra.get(e.source)!.push(e.target);
    bac.set(e.target, bac.get(e.target)! + 1);
  }
  const thuTuGoc = nodes.map((n) => n.id).filter((id) => bac.has(id));
  const hang = thuTuGoc.filter((id) => bac.get(id) === 0);
  const out: string[] = [];
  for (let i = 0; i < hang.length; i++) {
    const id = hang[i]!;
    out.push(id);
    for (const tiep of ra.get(id) ?? []) {
      bac.set(tiep, bac.get(tiep)! - 1);
      if (bac.get(tiep) === 0) hang.push(tiep);
    }
  }
  return out.length === bac.size ? out : [];
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
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
): KetQuaChuoi {
  const start = nodes.find((n) => n.id === startId);
  if (!start || start.data?.vaiTro !== VAI_TRO_MOC_DAU) {
    return { ok: false, loi: "khong-phai-moc-dau" };
  }
  const phiaSau = phiaSauCua(edges, startId);
  const ketThuc = phiaSau.find(
    (id) => nodes.find((n) => n.id === id)?.data?.vaiTro === VAI_TRO_MOC_CUOI,
  );
  if (!ketThuc) return { ok: false, loi: "thieu-ket-thuc" };

  const thuTu = xepTopo(nodes, edges, [startId, ...phiaSau]);
  if (thuTu.length === 0) return { ok: false, loi: "vong-lap" };

  const soViec = thuTu.filter((id) => {
    const n = nodes.find((x) => x.id === id);
    return n ? laViecThat(n) : false;
  }).length;
  return { ok: true, thuTu, ketThuc, soViec };
}

/* --------------------------------------------------------------- dau vao */

const DUOI_VIDEO = /\.(mp4|webm|mov|m4v)(\?|$)/i;

export function laUrlVideo(src: string | null | undefined): boolean {
  if (!src || src.startsWith("data:image/")) return false;
  return DUOI_VIDEO.test(src.split("?")[0] ?? "") || src.startsWith("data:video/");
}

/** Node cha theo canh ANH vao DAU TIEN - canh do la anh nen, cac canh sau la ref. */
export function nodeChaDau(
  nodeId: string,
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
): WfNode | null {
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
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
): { anh: string | null; ta: string } {
  const node = nodes.find((n) => n.id === nodeId);
  const cha = nodeChaDau(nodeId, nodes, edges);
  const laAnh = (u?: string | null) => !!u && !laUrlVideo(u);
  const anh =
    (laAnh(cha?.data?.imageUrl) ? cha!.data!.imageUrl! : null)
    ?? (laAnh(node?.data?.imageUrl) ? node!.data!.imageUrl! : null)
    ?? node?.data?.videoSourceUrl
    ?? null;
  const taCha = (cha?.data?.prompt || "").trim();
  const taRieng = (node?.data?.prompt || "").trim();
  const ta = taRieng ? (taCha ? `${taCha} ${taRieng}` : taRieng) : taCha;
  return { anh, ta };
}

/* ------------------------------------------------------------------- gop */

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
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
): MucGop[] {
  return edges
    .filter((e) => e.target === nodeId)
    .map((e) => {
      const n = nodes.find((x) => x.id === e.source);
      const url = n?.data?.imageUrl;
      if (!url) return null;
      return { url, loai: laUrlVideo(url) ? "video" : "anh", tuNode: e.source } as MucGop;
    })
    .filter((x): x is MucGop => !!x);
}

/**
 * Thu tu cuoi cung cua mot node GOP.
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

/**
 * Toan bo media cua MOT node GOP, da xep dung thu tu: cac canh vao cong nhung
 * tep nguoi dung tu dinh len chinh node.
 */
export function mucGopCuaNode(
  nodeId: string,
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
  data: { referenceImages?: readonly string[] | undefined; thuTuGop?: readonly string[] | undefined },
): MucGop[] {
  const tuCanh = gomTuCanhVao(nodeId, nodes, edges);
  const tuTay = (data.referenceImages ?? []).map((url) => ({
    url, loai: laUrlVideo(url) ? ("video" as const) : ("anh" as const), tuNode: null,
  }));
  return xepTheoThuTu([...tuCanh, ...tuTay], data.thuTuGop);
}

/* ------------------------------------------------------------------ o trong */

/**
 * O trong trong prompt, dang {{TEN}}.
 *
 * Khuon mau de san o trong roi moi lan goi API dien mot gia tri khac - nho vay
 * mot khuon dung duoc cho nhieu bo do ma khong phai sua graph. Ten chi gom chu
 * HOA, so va gach duoi, de khong an nham cu phap nao khac trong prompt.
 */
export const MAU_O_TRONG = /\{\{([A-Z0-9_]+)\}\}/g;

/** Moi ten o trong con trong mot doan van ban. */
export function oTrongTrongVanBan(text: string | undefined | null): string[] {
  if (!text) return [];
  return [...text.matchAll(MAU_O_TRONG)].map((m) => m[1]!);
}

/** Dien o trong; ten khong co trong `gt` thi GIU NGUYEN de con bao thieu. */
export function dienOTrong(
  text: string | undefined | null,
  gt: Readonly<Record<string, string>>,
): string {
  if (!text) return "";
  return text.replace(MAU_O_TRONG, (nguyen, ten: string) =>
    Object.prototype.hasOwnProperty.call(gt, ten) ? String(gt[ten]) : nguyen);
}

/** Moi o trong ca khuon can, sap xep va khong trung - dung cho tuyen mo ta. */
export function oTrongCuaKhuon(
  nodes: readonly WfNode[],
  thuTu: readonly string[],
): string[] {
  const ra = new Set<string>();
  for (const id of thuTu) {
    const n = nodes.find((x) => x.id === id);
    if (!n || !laViecThat(n)) continue;
    for (const ten of oTrongTrongVanBan(n.data?.prompt)) ra.add(ten);
  }
  return [...ra].sort();
}
