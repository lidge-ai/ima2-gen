/**
 * Chay mot khuon (BAT DAU -> KET THUC) o MAY CHU, khong can mo trinh duyet.
 *
 * Vi sao goi vong qua HTTP cua chinh minh thay vi goi thang ham sinh anh: cac
 * tuyen /api/node/generate, /api/video/generate va /api/media/merge deu la ham
 * Express dai, moi buoc kiem tra deu tra loi bang res.status(...).json(...).
 * Boc mot loi "thuan tuy" ra khoi chung la viet lai toan bo duong sinh anh -
 * dung noi bo qua vong lap thi luot chay qua API di DUNG mot duong voi nut GEN
 * tren giao dien, khong the lech hanh vi. Mot vong soket noi bo la khong dang ke
 * ben canh mot lan sinh anh vai chuc giay.
 *
 * Ket qua ghi nguoc vao graph cua phien sau MOI node, nen mo giao dien len la
 * thay ngay. Moi lan ghi deu doc lai phien ban moi nhat roi mai dap phan cua
 * rieng node vua chay - nho vay mot tab dang mo sua node khac khong bi xoa mat.
 */
import { getSession, saveGraph } from "./sessionStore.js";
import { refCuaNode } from "./nodeRefStore.js";
import { loadAssetB64 } from "./nodeStore.js";
import { publish, subscribe } from "./eventBus.js";
import { logError, logEvent } from "./logger.js";
import { errInfo } from "./errInfo.js";
import type { RuntimeContext } from "./runtimeContext.js";
import {
  canhAnhVao,
  dauVaoVideoCuaNode,
  dienOTrong,
  laUrlVideo,
  kichThuocCuaKhuon,
  kichThuocKeThua,
  laViecThat,
  nodeSauBocDo,
  mucGopCuaNode,
  oTrongTrongVanBan,
  timChuoiChay,
  viecCuaNode,
  type WfEdge,
  type WfNode,
} from "./wfChain.js";
import {
  ketThucLuotChay,
  luuLuotChay,
  tinHieuHuy,
  type WfBuoc,
  type WfKetQua,
  type WfLuotChay,
} from "./wfRunStore.js";
import { WF_KENH, WF_SU_KIEN } from "./wfEvents.js";
import {
  CAU_HOI_MO_TA,
  thayMoTaTrongPrompt,
  O_TRANG_PHUC,
  timNodeCanDoiMoTa,
  timNodeDungThamChieu,
} from "./moTaTrangPhuc.js";

/** Mot node video co the chay rat lau; qua nguong nay thi coi nhu hong. */
const HAN_MOT_NODE_MS = 15 * 60 * 1000;

export type WfLoiChay = { code: string; message: string; nodeId?: string | undefined };

export class LoiKhuon extends Error {
  readonly code: string;
  readonly nodeId: string | undefined;
  readonly chiTiet: Record<string, unknown>;
  constructor(code: string, message: string, nodeId?: string, chiTiet: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.nodeId = nodeId;
    this.chiTiet = chiTiet;
  }
}

type GraphNodeMay = { id: string; x?: number; y?: number; data?: Record<string, unknown> };

/* ------------------------------------------------------------- goi noi bo */

function goc(ctx: RuntimeContext): string {
  const port = ctx.serverActualPort ?? ctx.serverConfiguredPort ?? ctx.config.server.port;
  return `http://127.0.0.1:${port}`;
}

function tieuDe(ctx: RuntimeContext): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    // Bat buoc: /api/node/generate tra ve SSE khi khach hang ngo y nhan SSE.
    // O day can mot cuc JSON goi la xong.
    Accept: "application/json",
  };
  // Chay che do LAN thi chinh may chu cung phai xuat trinh the. Che do noi bo
  // thi lop bao ve bo qua tieu de nay, gui kem cung khong sao.
  const token = ctx.config.server.lanToken;
  if (token) h["X-Ima2-Token"] = token;
  return h;
}

async function goiNoiBo(
  ctx: RuntimeContext,
  duong: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${goc(ctx)}${duong}`, {
    method: "POST",
    headers: tieuDe(ctx),
    body: JSON.stringify(body),
    signal,
  });
  const van = await res.text();
  let du: Record<string, unknown> = {};
  try { du = van ? JSON.parse(van) as Record<string, unknown> : {}; }
  catch { du = { error: { code: "WF_BAD_RESPONSE", message: van.slice(0, 200) } }; }
  if (!res.ok) {
    const loi = (du.error ?? {}) as { code?: string; message?: string };
    const ma = typeof loi.code === "string" ? loi.code
      : typeof du.code === "string" ? du.code : `HTTP_${res.status}`;
    const loiVan = typeof loi.message === "string" ? loi.message
      : typeof du.error === "string" ? du.error : `HTTP ${res.status}`;
    throw new LoiKhuon(ma, loiVan);
  }
  return du;
}

/**
 * Doi mot cong viec bat dong bo (video) ket thuc.
 *
 * Bam vao bus su kien NGAY TRONG tien trinh thay vi mo mot duong SSE khac: cung
 * mot nguon su kien ma giao dien dung, nhung khong ton them ket noi va khong
 * phai tu phan tich dinh dang SSE.
 */
function doiViec(requestId: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((ok, hong) => {
    let xong = false;
    const ket = (fn: () => void) => {
      if (xong) return;
      xong = true;
      clearTimeout(dongHo);
      thoi();
      signal.removeEventListener("abort", khiHuy);
      fn();
    };
    const khiHuy = () => ket(() => hong(new LoiKhuon("WF_CANCELED", "luot chay da bi huy")));
    const dongHo = setTimeout(
      () => ket(() => hong(new LoiKhuon("WF_NODE_TIMEOUT", "node chay qua lau"))),
      HAN_MOT_NODE_MS,
    );
    const thoi = subscribe((ev) => {
      if (ev.jobId !== requestId) return;
      if (ev.event === "done") ket(() => ok(ev.data));
      else if (ev.event === "error") {
        const d = ev.data as { code?: string; error?: string; message?: string };
        ket(() => hong(new LoiKhuon(
          d.code || "WF_NODE_FAILED",
          d.error || d.message || "sinh video that bai",
        )));
      }
    });
    signal.addEventListener("abort", khiHuy, { once: true });
  });
}

/* ------------------------------------------------------------- bao tien do */

function daXong(luot: WfLuotChay): number {
  return luot.buoc.filter((b) => b.trangThai === "xong").length;
}

/**
 * Ghi xuong bang VA bao len kenh su kien trong mot nhip.
 *
 * Hai viec nay luon di cung nhau: ghi ma khong bao thi giao dien dang mo khong
 * thay gi cho toi luc tai lai; bao ma khong ghi thi tat may chu la mat.
 */
function capNhat(luot: WfLuotChay, suKien: string, them: Record<string, unknown> = {}): void {
  luuLuotChay(luot);
  publish(WF_KENH, suKien, {
    jobId: WF_KENH,
    runId: luot.id,
    sessionId: luot.sessionId,
    startNodeId: luot.startNodeId,
    daXong: daXong(luot),
    tong: luot.buoc.length,
    ...them,
  });
}

/* ------------------------------------------------------------------ graph */

function docGraph(sessionId: string): {
  nodes: WfNode[];
  edges: WfEdge[];
  tho: GraphNodeMay[];
  thoEdges: unknown[];
  version: number;
} {
  const phien = getSession(sessionId);
  if (!phien) throw new LoiKhuon("WF_SESSION_NOT_FOUND", `khong co phien ${sessionId}`);
  const tho = phien.nodes as GraphNodeMay[];
  return {
    nodes: tho as WfNode[],
    edges: phien.edges as unknown as WfEdge[],
    tho,
    thoEdges: phien.edges,
    version: phien.graphVersion ?? 0,
  };
}

/**
 * Ghi ket qua cua MOT node vao graph cua phien.
 *
 * Doc lai ngay truoc khi ghi va chi dap phan cua node do: mot tab dang mo co the
 * vua keo node khac, ghi de ca graph cu se xoa mat viec do. Va chinh cho nay
 * giai thich vi sao khong giu mot ban graph trong bo nho suot luot chay.
 */
function ghiNode(sessionId: string, nodeId: string, vaLai: Record<string, unknown>): void {
  for (let lan = 0; lan < 3; lan++) {
    const { tho, thoEdges, version } = docGraph(sessionId);
    const moi = tho.map((n) => (n.id === nodeId ? { ...n, data: { ...(n.data ?? {}), ...vaLai } } : n));
    try {
      saveGraph(sessionId, { nodes: moi, edges: thoEdges as [], expectedVersion: version });
      return;
    } catch (e) {
      // Chi thu lai khi dung la va cham phien ban - loi khac ma thu lai thi chi
      // lap lai dung loi do.
      if ((e as { code?: string }).code !== "GRAPH_VERSION_CONFLICT") throw e;
    }
  }
  logError("wf", "graph_save_conflict", new Error(`khong ghi duoc node ${nodeId} sau 3 lan thu`));
}

/* ------------------------------------------------------- tham chieu dau vao */

/** Tham chieu gui len may sinh anh la base64 tran, khong co tien to data URL. */
function boTienToDataUrl(s: string): string {
  return s.replace(/^data:[^;]+;base64,/, "");
}

/**
 * Ten tep trong thu muc generated, lay tu mot url `/generated/<ten>`.
 *
 * May chu nhan anh nen theo TEN TEP. Bat dung tien to `/generated/` chu khong
 * cat bua: mot url ngoai (hoac mot url video) di vao duong nay se thanh mot ten
 * tep khong co that, va loi do chi hien ra o clip da tra tien.
 */
/**
 * Ten clip trong thu muc generated. Chi `.mp4` - do la dung dinh dang may chu
 * nhan cho duong noi tiep (`safeGeneratedVideoFilename`).
 */
function laTenClipGenerated(url: string | null | undefined): string | null {
  return laTenGenerated(url ?? null, /\.mp4$/i);
}

function laTenGenerated(url: string | null, duoi = /\.(png|jpe?g|webp)$/i): string | null {
  if (!url || !url.startsWith("/generated/")) return null;
  const ten = url.slice("/generated/".length).split(/[?#]/)[0] ?? "";
  if (ten.includes("..") || !/^[A-Za-z0-9._-]+$/.test(ten)) return null;
  // Loc theo duoi tep: gui ten .mp4 vao o anh nen thi may chu doc no nhu mot
  // anh, con nguoc lai thi buoc trich khung khong co gi de trich.
  return duoi.test(ten) ? ten : null;
}

/* ----------------------------------------------------------------- chay */

/**
 * Ghi de noi dung mot node cho DUNG mot luot chay.
 *
 * Khong ghi vao graph: khuon mau phai giu nguyen de goi mot tram lan voi mot
 * tram noi dung khac nhau ma van la cung mot khuon. Ghi vao graph thi lan goi
 * truoc lang le doi khuon cho lan goi sau.
 */
export type GhiDeNode = {
  prompt?: string | undefined;
  size?: string | undefined;
  model?: string | undefined;
};

export type ThamSoChay = {
  sessionId: string;
  startNodeId: string;
  inputs: Record<string, string>;
  /** Anh dinh them theo node: { "<nodeId>": ["data:image/png;base64,..."] } */
  images: Record<string, string[]>;
  /** Noi dung thay the theo node, chi cho luot chay nay. */
  nodes: Record<string, GhiDeNode>;
};

/**
 * Ca danh sach node sau khi da ap ghi de cua luot chay.
 *
 * Node VIDEO ke thua LOI TA cua node canh, nen tinh dau vao cho no phai doc
 * prompt hieu luc cua CHA nua, khong chi cua chinh no. Chi ap cho rieng no thi
 * video lay prompt cha thang tu graph - tuc cau ta bo do CU - va ra dung bo do
 * cu du ba buoc truoc da dung. Dung loi da xay ra.
 */
export function nodesHieuLuc(
  nodes: readonly WfNode[],
  ts: Pick<ThamSoChay, "nodes">,
): WfNode[] {
  return nodes.map((n) => {
    const de = ts.nodes[n.id];
    if (!de || (de.prompt === undefined && de.size === undefined)) return n;
    return {
      ...n,
      data: {
        ...(n.data ?? {}),
        ...(de.prompt === undefined ? {} : { prompt: de.prompt }),
        // Ke ca `size`: node phia sau ke thua kich thuoc cua anh nen, nen mot
        // ghi de kich thuoc o node cha phai keo theo ca chuoi.
        ...(de.size === undefined ? {} : { size: de.size }),
      },
    };
  });
}

/** Noi dung node sau khi da ap ghi de cua luot chay. */
export function noiDungNode(node: WfNode, ts: Pick<ThamSoChay, "nodes">): GhiDeNode {
  const de = ts.nodes[node.id] ?? {};
  return {
    prompt: de.prompt ?? node.data?.prompt ?? "",
    size: de.size ?? node.data?.size ?? undefined,
    model: de.model ?? node.data?.model ?? undefined,
  };
}

/** Mo ta mot khuon ma khong chay: dung cho tuyen GET va cho o API tren node. */
export function moTaKhuon(sessionId: string, startNodeId: string) {
  const { nodes, edges } = docGraph(sessionId);
  const chuoi = timChuoiChay(startNodeId, nodes, edges);
  if (!chuoi.ok) throw new LoiKhuon(`WF_CHAIN_${chuoi.loi.toUpperCase().replace(/-/g, "_")}`, chuoi.loi);
  // `{{TRANG_PHUC}}` sau BOC DO khong ke vao `inputs`: bao la bat buoc thi
  // nguoi goi phai truyen mot gia tri ma chinh luot chay ghi de ngay sau do.
  const tuDien = nodeSauBocDo(nodes, edges);
  const oTrong = new Set<string>();
  const buoc = chuoi.thuTu
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is WfNode => !!n && laViecThat(n))
    .map((n) => {
      for (const ten of oTrongTrongVanBan(n.data?.prompt)) {
        if (ten === O_TRANG_PHUC && tuDien.has(n.id)) continue;
        oTrong.add(ten);
      }
      // Kem ca prompt: nguoi goi phai doc duoc noi dung hien tai cua tung node
      // thi moi dung duoc than request de ghi de no.
      return {
        nodeId: n.id,
        vaiTro: n.data?.vaiTro ?? null,
        nhan: n.data?.label,
        viec: viecCuaNode(n),
        prompt: n.data?.prompt ?? "",
        ...(n.data?.size ? { size: n.data.size } : {}),
        ...(n.data?.model ? { model: n.data.model } : {}),
      };
    });
  return {
    sessionId,
    startNodeId,
    ketThuc: chuoi.ketThuc,
    soViec: chuoi.soViec,
    inputs: [...oTrong].sort(),
    buoc,
  };
}

/**
 * O trong chua dien thi chan tu dau: chuoi {{...}} di thang vao prompt se sinh
 * ra ket qua vo nghia ma van tinh tien. Tuyen goi ham nay TRUOC khi mo luot
 * chay, de mot request thieu dau vao la loi cua nguoi goi chu khong de lai mot
 * luot "hong" trong so.
 */
export function kiemDauVao(
  nodes: readonly WfNode[],
  thuTu: readonly string[],
  inputs: Record<string, string>,
  ghiDe: Record<string, GhiDeNode> = {},
  edges: readonly WfEdge[] = [],
): void {
  // `{{TRANG_PHUC}}` o node nam sau BOC DO khong phai dau vao cua nguoi goi:
  // buoc BOC DO doc flat lay ra mot cau roi dien ho ngay trong luot chay. Doi
  // bat buoc mot gia tri se bi ghi de ngay sau do la bat truyen cho co.
  const tuDien = nodeSauBocDo(nodes, edges);
  const thieu = new Set<string>();
  for (const id of thuTu) {
    const n = nodes.find((x) => x.id === id);
    if (!n || !laViecThat(n)) continue;
    // Phai doc prompt HIEU LUC chu khong phai prompt trong graph: ghi de co the
    // vua bo mot o trong di, hoac vua them mot o trong moi vao.
    const prompt = noiDungNode(n, { nodes: ghiDe }).prompt;
    for (const ten of oTrongTrongVanBan(dienOTrong(prompt, inputs))) {
      if (ten === O_TRANG_PHUC && tuDien.has(id)) continue;
      thieu.add(ten);
    }
  }
  if (thieu.size > 0) {
    throw new LoiKhuon(
      "WF_INPUT_MISSING",
      `thieu dau vao: ${[...thieu].sort().join(", ")}`,
      undefined,
      { missing: [...thieu].sort() },
    );
  }
}

/** Kiem moi thu co the kiem TRUOC khi ton mot dong nao: chuoi, dau vao, anh dinh kem. */
export function kiemTruocKhiChay(ts: ThamSoChay): void {
  const { nodes, edges } = docGraph(ts.sessionId);
  const chuoi = timChuoiChay(ts.startNodeId, nodes, edges);
  if (!chuoi.ok) {
    throw new LoiKhuon(
      `WF_CHAIN_${chuoi.loi.toUpperCase().replace(/-/g, "_")}`,
      chuoi.loi === "thieu-ket-thuc"
        ? "khuon chua noi toi node KET THUC"
        : chuoi.loi === "vong-lap"
          ? "khuon co vong lap"
          : "node nay khong phai moc BAT DAU",
    );
  }
  // Node BOC DO khong co anh nao vao thi no BIA ra mot bo do.
  //
  // Prompt cua vai tro nay la "doc anh tham chieu roi boc tung mon do ra" -
  // khong anh thi mo hinh tu nghi ra mot bo, va ca khuon phia sau mac bo do
  // tuong tuong day. Chan tu dau: loi nay hien ra o buoc dau, con de chay thi
  // no hien ra o tam anh cuoi cung, sau khi da tra tien cho tat ca.
  //
  // Hay xay ra khi copy tu template: template khong mang anh dinh theo (co y -
  // de data URL khong vao co so du lieu), nen ban moi copy ra la node trong.
  for (const id of chuoi.thuTu) {
    const n = nodes.find((x) => x.id === id);
    if (!n || n.data?.vaiTro !== "trang-phuc") continue;
    const coAnhVao = canhAnhVao(edges, nodes, id).length > 0
      || (ts.images[id]?.length ?? 0) > 0
      || refCuaNode(ts.sessionId, id).length > 0;
    if (!coAnhVao) {
      throw new LoiKhuon(
        "WF_REF_MISSING",
        `node BOC DO ${id} chua co anh nao: dinh anh that cua bo do vao node nay`,
        id,
      );
    }
  }

  const trongKhuon = new Set(chuoi.thuTu);
  for (const id of Object.keys(ts.images)) {
    const n = nodes.find((x) => x.id === id);
    // Anh nham vao node ngoai khuon thi khong co tac dung gi ca. Bao ra con hon
    // de nguoi goi tuong da dinh duoc.
    if (!n || !trongKhuon.has(id) || !laViecThat(n)) {
      throw new LoiKhuon("WF_IMAGE_NODE_UNKNOWN", `khong co node ${id} de dinh anh trong khuon nay`, id);
    }
    // Node GOP nhan DANH SACH MEDIA da sinh ra, khong phai anh tham chieu.
    if (viecCuaNode(n) === "gop-video") {
      throw new LoiKhuon(
        "WF_IMAGE_NODE_UNKNOWN",
        `node ${id} la node GOP, no lay media tu cac canh vao chu khong nhan anh dinh kem`,
        id,
      );
    }
  }
  // Ghi de phai nham vao mot node NAM TRONG khuon nay. Nham node khac thi no
  // khong co tac dung gi ca, ma nguoi goi lai tuong da sua duoc.
  for (const id of Object.keys(ts.nodes)) {
    if (!trongKhuon.has(id)) {
      throw new LoiKhuon("WF_NODE_OVERRIDE_UNKNOWN", `node ${id} khong nam trong khuon nay`, id);
    }
    const n = nodes.find((x) => x.id === id);
    if (n && !laViecThat(n)) {
      throw new LoiKhuon(
        "WF_NODE_OVERRIDE_UNKNOWN",
        `node ${id} khong sinh gi nen khong co gi de ghi de`,
        id,
      );
    }
  }
  kiemDauVao(nodes, chuoi.thuTu, ts.inputs, ts.nodes, edges);
}

/**
 * Ma HTTP hop voi mot ma loi khuon.
 *
 * Dung chung cho ca loi nem ra truoc khi chay lan loi ghi trong luot chay -
 * "thieu dau vao" phai la 400 du no lo ra o duong nao.
 */
export function maHttpCuaLoi(code: string | undefined): number {
  if (!code) return 500;
  if (code === "WF_SESSION_NOT_FOUND" || code === "WF_RUN_NOT_FOUND") return 404;
  if (code === "WF_CANCELED") return 409;
  // WF_REF_MISSING: khuon con thieu anh dinh, nguoi goi sua duoc - loi cua ben
  // goi chu khong phai may chu hong.
  if (code.startsWith("WF_CHAIN_") || code.startsWith("WF_INPUT")
    || code.startsWith("WF_IMAGE") || code === "WF_REF_MISSING"
    || code.startsWith("WF_NODE_OVERRIDE")) return 400;
  return 500;
}

/**
 * Chay ca khuon. Nem LoiKhuon khi khong the bat dau; loi giua chung thi ghi vao
 * `luot` va dung han - moi node phia sau deu an theo node vua hong, chay tiep
 * chi ton tien de ra mot loat ket qua sai.
 */
export async function chayKhuon(
  ctx: RuntimeContext,
  ts: ThamSoChay,
  luot: WfLuotChay,
): Promise<WfLuotChay> {
  const huy = tinHieuHuy(luot.id) ?? new AbortController().signal;
  try {
    // Kiem LAI bang dung mot ham ma tuyen da goi truoc do: graph co the vua doi
    // giua luc nhan yeu cau va luc chay. Hai ban kiem rieng se lech nhau - da
    // lech mot lan, ban trong luot chay khong nhan `nodes` nen mot ghi de hop le
    // van bi bao thieu dau vao.
    kiemTruocKhiChay(ts);
    const { nodes, edges } = docGraph(ts.sessionId);
    const chuoi = timChuoiChay(ts.startNodeId, nodes, edges) as Extract<
      ReturnType<typeof timChuoiChay>, { ok: true }
    >;

    luot.buoc = chuoi.thuTu
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is WfNode => !!n && laViecThat(n))
      .map((n): WfBuoc => ({
        nodeId: n.id,
        vaiTro: n.data?.vaiTro ?? null,
        nhan: n.data?.label,
        viec: viecCuaNode(n),
        trangThai: "cho",
      }));

    capNhat(luot, WF_SU_KIEN.batDau, {
      buoc: luot.buoc.map((b) => ({ nodeId: b.nodeId, viec: b.viec })),
    });

    const raNode: Record<string, { url: string; loai: "anh" | "video" }> = {};
    // Ghi de va anh dinh THEM cua rieng luot chay nay. Buoc BOC DO se viet vao
    // day sau khi no sinh ra flat lay moi, nen cac buoc sau doc duoc - va graph
    // van khong he bi sua.
    const tsChay: ThamSoChay = { ...ts, nodes: { ...ts.nodes }, inputs: { ...ts.inputs } };
    const anhThem: Record<string, string[]> = {};
    for (const buoc of luot.buoc) {
      if (huy.aborted) {
        luot.trangThai = "da-huy";
        break;
      }
      buoc.trangThai = "dang-chay";
      buoc.batDauLuc = Date.now();
      capNhat(luot, WF_SU_KIEN.buoc, { nodeId: buoc.nodeId, trangThai: buoc.trangThai });
      try {
        const url = await chayMotNode(ctx, tsChay, buoc.nodeId, anhThem, huy);
        buoc.url = url;
        buoc.loai = laUrlVideo(url) ? "video" : "anh";
        buoc.trangThai = "xong";
        buoc.xongLuc = Date.now();
        raNode[buoc.nodeId] = { url, loai: buoc.loai };
        // Node BOC DO vua cho ra mot flat lay MOI. Loi ta o cac node sau van la
        // loi ta cua bo do cu, va chinh chu moi quyet dinh mac gi - nen phai doc
        // lai ngay bay gio, khong thi anh ta mot dang chu ta mot neo.
        if (buoc.vaiTro === "trang-phuc") {
          await doiLoiTaTrangPhuc(ctx, tsChay, anhThem, buoc.nodeId, url, huy);
        }
        capNhat(luot, WF_SU_KIEN.buoc, {
          nodeId: buoc.nodeId, trangThai: buoc.trangThai, url, loai: buoc.loai,
        });
      } catch (e) {
        // Huy giua chung lam cai fetch noi bo nem AbortError. Bao nguyen van
        // "This operation was aborted" thi nguoi goi tuong node hong that, trong
        // khi chinh ho vua bam huy.
        const err = huy.aborted
          ? new LoiKhuon("WF_CANCELED", "luot chay da bi huy", buoc.nodeId)
          : e instanceof LoiKhuon ? e : new LoiKhuon("WF_NODE_FAILED", errInfo(e).message);
        buoc.trangThai = huy.aborted ? "bo-qua" : "hong";
        buoc.xongLuc = Date.now();
        buoc.loi = err.message;
        luot.trangThai = huy.aborted ? "da-huy" : "hong";
        luot.loi = { code: err.code, message: err.message, nodeId: buoc.nodeId };
        if (!huy.aborted) {
          logError("wf", "node_failed", err, { runId: luot.id, nodeId: buoc.nodeId, code: err.code });
        }
        capNhat(luot, WF_SU_KIEN.buoc, {
          nodeId: buoc.nodeId, trangThai: buoc.trangThai, loi: err.message,
        });
        return luot;
      }
    }

    if (luot.trangThai === "da-huy") {
      luot.loi = { code: "WF_CANCELED", message: "luot chay da bi huy" };
      return luot;
    }

    luot.ketQua = thuKetQua(ts.sessionId, chuoi.ketThuc, raNode);
    luot.trangThai = "xong";
    logEvent("wf", "run_done", {
      runId: luot.id,
      sessionId: ts.sessionId,
      steps: luot.buoc.length,
      media: luot.ketQua.media.length,
    });
    return luot;
  } catch (e) {
    // Loi o phan chuan bi (graph doi giua luc kiem va luc chay) phai duoc ghi
    // vao chinh luot chay truoc khi finally dong so lai - khong thi lich su luu
    // mot luot "dang chay" vinh vien.
    const err = e instanceof LoiKhuon ? e : new LoiKhuon("WF_FAILED", errInfo(e).message);
    luot.trangThai = "hong";
    luot.loi = { code: err.code, message: err.message, ...(err.nodeId ? { nodeId: err.nodeId } : {}) };
    throw e;
  } finally {
    ketThucLuotChay(luot.id);
    publish(WF_KENH, WF_SU_KIEN.ketThuc, {
      jobId: WF_KENH,
      runId: luot.id,
      sessionId: luot.sessionId,
      startNodeId: luot.startNodeId,
      trangThai: luot.trangThai,
      daXong: daXong(luot),
      tong: luot.buoc.length,
      ...(luot.loi ? { loi: luot.loi } : {}),
    });
  }
}

/**
 * Doc flat lay vua sinh ra roi doi loi ta o cac node dung no lam THAM CHIEU.
 *
 * Day la buoc nguoi dung van bam tay bang nut "Doc bo do" tren giao dien. Khuon
 * chay qua API khong co ai bam, nen no phai tu lam - khong thi doi anh trang
 * phuc xong goi API se ra dung bo do cu, vi hai node sau con mang nguyen cau
 * "She wears: ..." cua bo do truoc.
 *
 * Chi ghi vao ban ghi de cua luot chay, KHONG sua graph: khuon mau phai giu
 * nguyen de lan goi sau lai doc lai tu dau.
 */
async function doiLoiTaTrangPhuc(
  ctx: RuntimeContext,
  ts: ThamSoChay,
  anhThem: Record<string, string[]>,
  nodeId: string,
  flatLayUrl: string,
  huy: AbortSignal,
): Promise<void> {
  const { nodes, edges } = docGraph(ts.sessionId);
  const chayDuoc = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return !!n && laViecThat(n);
  };
  // Dinh flat lay: chi nhung node tham chieu TRUC TIEP. Node CANH lay anh nguoi
  // da mac lam anh nen, dinh them flat lay vao do khong giup gi ma chi lam loang
  // dau vao.
  const dinhVao = timNodeDungThamChieu(nodeId, edges).filter(chayDuoc);
  // Doi loi ta: MOI node phia sau con mang khoi do. Khoi nay duoc chep xuoi theo
  // chuoi, nen chi doi o node tham chieu truc tiep la bo sot cac node CANH.
  const doiTa = timNodeCanDoiMoTa(nodeId, nodes, edges).filter(chayDuoc);
  if (dinhVao.length === 0 && doiTa.length === 0) return;

  // Dinh THEM flat lay truoc da. Viec nay khong can goi mo hinh nao, va no la
  // thu giu duoc chi tiet bo do: da do bang thuc nghiem, anh vao qua canh ref
  // thi yeu (hoa tiet in ra sai so luong va cach sap), vao qua duong dinh kem
  // thi bam sat ban goc. Nen no khong duoc phu thuoc vao viec doc mo ta co
  // thanh cong hay khong.
  for (const id of dinhVao) (anhThem[id] ??= []).push(flatLayUrl);

  let moTa: string;
  try {
    moTa = await docMoTaAnh(ctx, flatLayUrl, huy);
  } catch (e) {
    // Doc mo ta that bai thi van chay tiep voi loi ta cu: thieu mot cau ta con
    // hon dung ca luot chay da ton tien o nhung buoc truoc.
    logError("wf", "outfit_describe_failed", e, { nodeId });
    return;
  }

  // Ben goi API co truyen TRANG_PHUC thi gia tri cua HO thang, o ca hai duong:
  // ho noi ro muon mac gi, ghi de len la bo qua lenh cua ho trong im lang.
  const tuApi = Object.prototype.hasOwnProperty.call(ts.inputs, O_TRANG_PHUC)
    ? String(ts.inputs[O_TRANG_PHUC])
    : null;
  const moTaDung = tuApi ?? moTa;
  // Duong CHINH: dien vao o trong `{{TRANG_PHUC}}`. Prompt viet the nao cung
  // an - "He wears: {{TRANG_PHUC}}", "Outfit: {{TRANG_PHUC}}", hay mot cau
  // tieng Viet.
  if (tuApi === null) (ts.inputs as Record<string, string>)[O_TRANG_PHUC] = moTa;

  const daDoi: string[] = [];
  for (const id of doiTa) {
    const n = nodes.find((x) => x.id === id)!;
    const cu = noiDungNode(n, ts).prompt ?? "";
    const moi = thayMoTaTrongPrompt(cu, moTaDung);
    if (!moi) continue;
    ts.nodes[id] = { ...(ts.nodes[id] ?? {}), prompt: moi };
    daDoi.push(id);
  }
  logEvent("wf", "outfit_described", { nodeId, nodes: daDoi, chars: moTaDung.length, tuApi: tuApi !== null });
}

/** Hoi mo hinh liet ke tung mon do trong anh. */
async function docMoTaAnh(
  ctx: RuntimeContext,
  url: string,
  huy: AbortSignal,
): Promise<string> {
  const b64 = await docB64(ctx, url);
  const duoi = url.split(".").pop()?.toLowerCase();
  const mime = duoi === "jpg" || duoi === "jpeg" ? "image/jpeg"
    : duoi === "webp" ? "image/webp" : "image/png";
  const kq = await goiNoiBo(ctx, "/api/prompt-builder/chat", {
    messages: [{
      role: "user",
      content: CAU_HOI_MO_TA,
      attachments: [{
        kind: "image",
        name: "outfit.png",
        mimeType: mime,
        dataUrl: `data:${mime};base64,${b64}`,
      }],
    }],
  }, huy);
  const chu = String((kq.message as { content?: unknown } | undefined)?.content ?? "").trim();
  if (!chu) throw new Error("mo hinh khong tra ve mo ta nao");
  return chu;
}

/** Ket qua tra ve cho nguoi goi: media cua nhung node noi thang vao KET THUC. */
function thuKetQua(
  sessionId: string,
  ketThucId: string,
  raNode: Record<string, { url: string; loai: "anh" | "video" }>,
): WfKetQua {
  const { nodes, edges } = docGraph(sessionId);
  const media = canhAnhVao(edges, nodes, ketThucId)
    .map((e) => {
      const n = nodes.find((x) => x.id === e.source);
      const url = raNode[e.source]?.url ?? n?.data?.imageUrl ?? null;
      if (!url) return null;
      return {
        nodeId: e.source,
        url,
        loai: laUrlVideo(url) ? ("video" as const) : ("anh" as const),
        nhan: n?.data?.label,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return { media, nodes: raNode };
}

/** Chay dung mot node va tra ve url media no sinh ra. */
async function chayMotNode(
  ctx: RuntimeContext,
  ts: ThamSoChay,
  nodeId: string,
  anhThem: Record<string, string[]>,
  huy: AbortSignal,
): Promise<string> {
  // Doc lai graph o moi buoc: node truoc vua ghi ket qua vao, node nay phai
  // thay ban moi nhat chu khong phai ban chup luc bat dau.
  const { nodes, edges } = docGraph(ts.sessionId);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) throw new LoiKhuon("WF_NODE_GONE", `node ${nodeId} khong con trong graph`, nodeId);
  const viec = viecCuaNode(node);
  const requestId = `wf_${luotNgan()}`;

  if (viec === "gop-video") return ghepVideo(ctx, ts, nodeId, nodes, edges, huy);

  const chaDau = canhAnhVao(edges, nodes, nodeId)[0];
  const cha = chaDau ? nodes.find((n) => n.id === chaDau.source) : null;
  const chaServerId = cha?.data?.serverNodeId ?? null;
  if (chaDau && !chaServerId) {
    throw new LoiKhuon("WF_PARENT_EMPTY", `node cha ${chaDau.source} chua co anh`, nodeId);
  }

  if (viec === "video") {
    // Ap ghi de cho CA danh sach, khong chi cho node video. Node video ke thua
    // loi ta cua node canh, nen prompt cua CHA cung phai la ban da ghi de -
    // lay thang tu graph thi no mang cau ta bo do cu. Ghi de rieng cua node
    // video van chi la phan GHI THEM, dauVaoVideoCuaNode noi hai phan lai.
    const { ta, anh } = dauVaoVideoCuaNode(nodeId, nodesHieuLuc(nodes, ts), edges);
    const loiTa = dienOTrong(ta, ts.inputs).trim();
    if (!loiTa) throw new LoiKhuon("WF_PROMPT_EMPTY", "node video khong co loi ta nao", nodeId);
    const refs2 = await thamChieuHieuLuc(ctx, node, ts, anhThem[nodeId] ?? []);
    // Anh nen phai di theo ten TEP.
    //
    // Truoc day cho nay gui `parentNodeId`, nhung /api/video/generate khong
    // doc truong do (chi /api/node/generate doc) - nen anh nen bien mat trong
    // im lang: sidecar cua mot clip that ghi mode="reference-to-video",
    // sourceImageFilename=null, trong khi prompt van noi "keep the exact same
    // face as the base image". Ket qua la mot nguoi mau khac va anh sang khac.
    // Chuoi VIDEO -> VIDEO: dau vao khong phai mot anh ma la khung CUOI cua
    // clip cha. Gui `continueFromVideo` de may chu tu trich khung do (ffmpeg
    // chon duoc mot khung that; khong co no thi node nay roi ve cai anh tinh cu
    // trong graph va doan hai bi dut). Sidecar cua clip cha cung la noi may chu
    // doc ra lineage, nen khong phai tu dung o day.
    const clipCha = laTenClipGenerated(cha?.data?.imageUrl);
    const tenNen = clipCha ? null : laTenGenerated(anh);
    // May chu chi lam MOT trong hai: mot khung dau (image-to-video) hoac mot
    // danh sach tham chieu (reference-to-video). Co anh nen thi anh nen thang:
    // no la dung canh nguoi dung muon lam dong, con anh dinh o node video chi
    // la goi y - de ca hai vao thi khung dau bi bo va nguoi mau doi.
    // Cai dat rieng cua node: khi khuon chay qua API thi khong co ai ngoi chon
    // o bang dieu khien ca, va mac dinh cua may chu (auto / 480p / 5s) gan nhu
    // khong bao gio la ti le nguoi dung muon. Chi gui truong nguoi dung da dat;
    // bo trong thi may chu giu mac dinh cua no nhu truoc.
    const cd = node.data?.caiDatVideo ?? null;
    const caiDat: Record<string, unknown> = {};
    if (cd?.aspectRatio) caiDat.aspectRatio = cd.aspectRatio;
    if (cd?.resolution) caiDat.resolution = cd.resolution;
    if (typeof cd?.duration === "number") caiDat.duration = cd.duration;
    // "tham-chieu": nguoi dung muon anh nen chi la goi y chu khong khoa khung
    // dau - vi du canh dung yen ma clip can mot goc may khac. Luc do anh nen di
    // o o tham chieu, va anh dinh o node duoc di kem.
    const nenThamChieu = !clipCha && !!tenNen && cd?.anhNen === "tham-chieu";
    const anhVao = clipCha
      ? { continueFromVideo: clipCha }
      : nenThamChieu
        ? {
            referenceFilenames: [tenNen],
            ...(refs2.length ? { referenceImages: refs2 } : {}),
          }
        : tenNen
          ? { sourceFilename: tenNen }
          : refs2.length ? { referenceImages: refs2 } : {};
    const cho = doiViec(requestId, huy);
    await goiNoiBo(ctx, "/api/video/generate", {
      async: true,
      requestId,
      provider: "grok",
      prompt: loiTa,
      sessionId: ts.sessionId,
      clientNodeId: nodeId,
      ...caiDat,
      ...anhVao,
    }, huy);
    const kq = await cho;
    const url = typeof kq.url === "string" ? kq.url : "";
    const filename = typeof kq.filename === "string" ? kq.filename : "";
    if (!url) throw new LoiKhuon("WF_NODE_FAILED", "may chu khong tra ve video nao", nodeId);
    ghiNode(ts.sessionId, nodeId, {
      serverNodeId: filename.replace(/\.[^.]+$/, ""),
      videoSourceUrl: node.data?.videoSourceUrl ?? node.data?.imageUrl ?? null,
      imageUrl: url,
      status: "ready",
      error: undefined,
      errorInfo: null,
    });
    return url;
  }

  // Sinh ANH.
  const noiDung = noiDungNode(node, ts);
  const prompt = dienOTrong(noiDung.prompt, ts.inputs).trim();
  if (!prompt) throw new LoiKhuon("WF_PROMPT_EMPTY", "node khong co prompt", nodeId);
  const refs = canhAnhVao(edges, nodes, nodeId)
    .slice(1)
    .map((e) => nodes.find((n) => n.id === e.source)?.data?.serverNodeId)
    .filter((id): id is string => !!id && id !== chaServerId);
  const refsAnh = await thamChieuHieuLuc(ctx, node, ts, anhThem[nodeId] ?? []);
  // Node khong tu dat kich thuoc thi lay kich thuoc cua ANH NEN. Khong ke thua
  // thi no roi ve mac dinh cua may chu (1024x1024 - vuong), va cung mot luot
  // chay ra may tam doc may tam vuong du tat ca sua tu cung mot anh nen doc.
  const nodesHl = nodesHieuLuc(nodes, ts);
  const kichThuoc = noiDung.size
    ?? kichThuocKeThua(nodeId, nodesHl, edges)
    ?? kichThuocCuaKhuon(nodeId, nodesHl, edges);
  const kq = await goiNoiBo(ctx, "/api/node/generate", {
    requestId,
    prompt,
    ...(chaServerId ? { parentNodeId: chaServerId } : {}),
    ...(refs.length ? { extraParentNodeIds: refs } : {}),
    ...(kichThuoc ? { size: kichThuoc } : {}),
    ...(noiDung.model ? { model: noiDung.model } : {}),
    sessionId: ts.sessionId,
    clientNodeId: nodeId,
    contextMode: "parent-plus-refs",
    ...(refsAnh.length ? { references: refsAnh } : {}),
  }, huy);
  const url = typeof kq.url === "string" ? kq.url : "";
  const serverNodeId = typeof kq.nodeId === "string" ? kq.nodeId : null;
  if (!url || !serverNodeId) throw new LoiKhuon("WF_NODE_FAILED", "may chu khong tra ve anh nao", nodeId);
  ghiNode(ts.sessionId, nodeId, {
    serverNodeId,
    parentServerNodeId: chaServerId,
    imageUrl: url,
    status: "ready",
    error: undefined,
    errorInfo: null,
    videoSourceUrl: null,
  });
  return url;
}

/**
 * Anh tham chieu HIEU LUC cua mot node, dua ve base64 tran nhu giao dien gui.
 *
 * Hai nguon, theo dung thu tu nay:
 *  1. Anh gui kem trong luot chay - THAY THE anh dinh san, va chi cho luot do.
 *  2. Khong gui gi thi lay anh nguoi dung da dinh o giao dien, doc tu bang
 *     node_refs. Chinh cho nay truoc day bi hong: anh dinh nam o localStorage
 *     nen may chu khong he thay, doi anh tren giao dien xong goi API van ra do cu.
 */
async function thamChieuHieuLuc(
  ctx: RuntimeContext,
  node: WfNode,
  ts: Pick<ThamSoChay, "images" | "sessionId">,
  themVao: readonly string[] = [],
): Promise<string[]> {
  const tuApi = ts.images[node.id];
  const ra: string[] = tuApi?.length
    ? tuApi.filter((s) => typeof s === "string" && s.startsWith("data:")).map(boTienToDataUrl)
    : [];
  if (!tuApi?.length) {
    for (const url of refCuaNode(ts.sessionId, node.id)) {
      try { ra.push(await docB64(ctx, url)); }
      catch { logEvent("wf", "ref_missing", { nodeId: node.id, url }); }
    }
  }
  for (const url of themVao) {
    try { ra.push(await docB64(ctx, url)); }
    catch { logEvent("wf", "ref_missing", { nodeId: node.id, url }); }
  }
  return ra;
}

function docB64(ctx: RuntimeContext, url: string): Promise<string> {
  return loadAssetB64(
    ctx.rootDir,
    url.replace(/^\/generated\//, ""),
    ctx.config.storage.generatedDir,
  );
}

async function ghepVideo(
  ctx: RuntimeContext,
  ts: ThamSoChay,
  nodeId: string,
  nodes: readonly WfNode[],
  edges: readonly WfEdge[],
  huy: AbortSignal,
): Promise<string> {
  const node = nodes.find((n) => n.id === nodeId)!;
  const muc = mucGopCuaNode(nodeId, nodes, edges, node.data ?? {});
  if (muc.length < 2) {
    throw new LoiKhuon("WF_MERGE_NEED_TWO", "node gop video can it nhat hai muc", nodeId);
  }
  const kq = await goiNoiBo(ctx, "/api/media/merge", {
    items: muc.map((m) => ({ filename: m.url.replace(/^\/generated\//, "") })),
  }, huy);
  const url = typeof kq.url === "string" ? kq.url : "";
  if (!url) throw new LoiKhuon("WF_NODE_FAILED", "ghep video khong tra ve gi", nodeId);
  ghiNode(ts.sessionId, nodeId, { imageUrl: url, status: "ready", error: undefined, errorInfo: null });
  return url;
}

function luotNgan(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
