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
import { publish, subscribe } from "./eventBus.js";
import { logError, logEvent } from "./logger.js";
import { errInfo } from "./errInfo.js";
import type { RuntimeContext } from "./runtimeContext.js";
import {
  canhAnhVao,
  dauVaoVideoCuaNode,
  dienOTrong,
  laUrlVideo,
  laViecThat,
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

/* ----------------------------------------------------------------- chay */

export type ThamSoChay = {
  sessionId: string;
  startNodeId: string;
  inputs: Record<string, string>;
  /** Anh dinh them theo node: { "<nodeId>": ["data:image/png;base64,..."] } */
  images: Record<string, string[]>;
};

/** Mo ta mot khuon ma khong chay: dung cho tuyen GET va cho o API tren node. */
export function moTaKhuon(sessionId: string, startNodeId: string) {
  const { nodes, edges } = docGraph(sessionId);
  const chuoi = timChuoiChay(startNodeId, nodes, edges);
  if (!chuoi.ok) throw new LoiKhuon(`WF_CHAIN_${chuoi.loi.toUpperCase().replace(/-/g, "_")}`, chuoi.loi);
  const oTrong = new Set<string>();
  const buoc = chuoi.thuTu
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is WfNode => !!n && laViecThat(n))
    .map((n) => {
      for (const ten of oTrongTrongVanBan(n.data?.prompt)) oTrong.add(ten);
      return {
        nodeId: n.id,
        vaiTro: n.data?.vaiTro ?? null,
        nhan: n.data?.label,
        viec: viecCuaNode(n),
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
): void {
  const thieu = new Set<string>();
  for (const id of thuTu) {
    const n = nodes.find((x) => x.id === id);
    if (!n || !laViecThat(n)) continue;
    for (const ten of oTrongTrongVanBan(dienOTrong(n.data?.prompt, inputs))) thieu.add(ten);
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
  for (const id of Object.keys(ts.images)) {
    if (!nodes.some((n) => n.id === id)) {
      throw new LoiKhuon("WF_IMAGE_NODE_UNKNOWN", `khong co node ${id} de dinh anh`, id);
    }
  }
  kiemDauVao(nodes, chuoi.thuTu, ts.inputs);
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
  if (code.startsWith("WF_CHAIN_") || code.startsWith("WF_INPUT") || code.startsWith("WF_IMAGE")) return 400;
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

    // Anh dinh kem phai ve dung node CO THAT, khong thi nguoi goi tuong da dinh
    // duoc ma thuc te no roi vao hu khong.
    for (const id of Object.keys(ts.images)) {
      if (!nodes.some((n) => n.id === id)) {
        throw new LoiKhuon("WF_IMAGE_NODE_UNKNOWN", `khong co node ${id} de dinh anh`, id);
      }
    }

    kiemDauVao(nodes, chuoi.thuTu, ts.inputs);

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

    // Anh dinh kem ghi vao graph truoc khi chay: cac buoc sau doc graph moi nhat
    // nen phai thay duoc chung, va nguoi dung mo giao dien cung thay dung thu da
    // dua vao.
    for (const [id, ds] of Object.entries(ts.images)) {
      ghiNode(ts.sessionId, id, { referenceImages: ds });
    }

    const raNode: Record<string, { url: string; loai: "anh" | "video" }> = {};
    for (const buoc of luot.buoc) {
      if (huy.aborted) {
        luot.trangThai = "da-huy";
        break;
      }
      buoc.trangThai = "dang-chay";
      buoc.batDauLuc = Date.now();
      capNhat(luot, WF_SU_KIEN.buoc, { nodeId: buoc.nodeId, trangThai: buoc.trangThai });
      try {
        const url = await chayMotNode(ctx, ts, buoc.nodeId, huy);
        buoc.url = url;
        buoc.loai = laUrlVideo(url) ? "video" : "anh";
        buoc.trangThai = "xong";
        buoc.xongLuc = Date.now();
        raNode[buoc.nodeId] = { url, loai: buoc.loai };
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
    const { ta } = dauVaoVideoCuaNode(nodeId, nodes, edges);
    const loiTa = dienOTrong(ta, ts.inputs).trim();
    if (!loiTa) throw new LoiKhuon("WF_PROMPT_EMPTY", "node video khong co loi ta nao", nodeId);
    const cho = doiViec(requestId, huy);
    await goiNoiBo(ctx, "/api/video/generate", {
      async: true,
      requestId,
      provider: "grok",
      prompt: loiTa,
      sessionId: ts.sessionId,
      clientNodeId: nodeId,
      ...(chaServerId ? { parentNodeId: chaServerId } : {}),
      ...(thamChieuCuaNode(node).length ? { referenceImages: thamChieuCuaNode(node) } : {}),
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
  const prompt = dienOTrong(node.data?.prompt, ts.inputs).trim();
  if (!prompt) throw new LoiKhuon("WF_PROMPT_EMPTY", "node khong co prompt", nodeId);
  const refs = canhAnhVao(edges, nodes, nodeId)
    .slice(1)
    .map((e) => nodes.find((n) => n.id === e.source)?.data?.serverNodeId)
    .filter((id): id is string => !!id && id !== chaServerId);
  const kq = await goiNoiBo(ctx, "/api/node/generate", {
    requestId,
    prompt,
    ...(chaServerId ? { parentNodeId: chaServerId } : {}),
    ...(refs.length ? { extraParentNodeIds: refs } : {}),
    ...(node.data?.size ? { size: node.data.size } : {}),
    ...(node.data?.model ? { model: node.data.model } : {}),
    sessionId: ts.sessionId,
    clientNodeId: nodeId,
    contextMode: "parent-plus-refs",
    ...(thamChieuCuaNode(node).length ? { references: thamChieuCuaNode(node) } : {}),
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

/** Anh nguoi dung dinh thang len node, dua ve base64 tran nhu giao dien gui. */
function thamChieuCuaNode(node: WfNode): string[] {
  return (node.data?.referenceImages ?? [])
    .filter((s) => typeof s === "string" && s.startsWith("data:"))
    .map(boTienToDataUrl);
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
