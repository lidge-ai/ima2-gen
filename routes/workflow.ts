/**
 * API kich hoat mot khuon tu ben ngoai.
 *
 * Node BAT DAU la DIEM VAO: dia chi cua no la /api/wf/:sessionId/:startNodeId.
 * Goi vao do thi may chu tu chay het khuon, va node KET THUC quyet dinh cai gi
 * duoc tra ve - media cua nhung node noi thang vao no.
 *
 * Cac tuyen nay nam duoi /api nen an theo dung lop bao ve san co: chay noi bo
 * thi mo, chay LAN thi phai co x-ima2-token. Khong dat them mot lop the rieng,
 * vi hai lop the song song la hai cho de quen khoa.
 */
import type { Express, Request, Response } from "express";
import { ulid } from "ulid";
import {
  chayKhuon, kiemTruocKhiChay, LoiKhuon, maHttpCuaLoi, moTaKhuon,
  type GhiDeNode,
} from "../lib/wfEngine.js";
import {
  danhSachLuotChay,
  demLuotChay,
  doiLuotChay,
  huyLuotChay,
  layLuotChay,
  taoLuotChay,
  xoaLuotChay,
  type WfLuotChay,
} from "../lib/wfRunStore.js";
import { getSession, listSessions } from "../lib/sessionStore.js";
import { timChuoiChay, VAI_TRO_MOC_DAU, type WfEdge, type WfNode } from "../lib/wfChain.js";
import { subscribe } from "../lib/eventBus.js";
import { WF_KENH, WF_SU_KIEN } from "../lib/wfEvents.js";
import { errInfo } from "../lib/errInfo.js";
import { logError, logEvent } from "../lib/logger.js";
import {
  requireRuntimeContext,
  type RouteRuntimeContext,
  type RuntimeContext,
} from "../lib/runtimeContext.js";

/** Cho lau nhat trong mot request giu ket noi; qua han thi chuyen sang hoi sau. */
const HAN_CHO_MS = 10 * 60 * 1000;
const SO_PHIEN_QUET = 60;
const INPUT_TOI_DA = 64;
const INPUT_DAI_TOI_DA = 4000;
const ANH_MOI_NODE_TOI_DA = 8;
const PROMPT_DAI_TOI_DA = 20000;
const NODE_GHI_DE_TOI_DA = 64;

type Params = { sessionId: string; startNodeId: string };

function batLoi(res: Response, e: unknown): void {
  if (e instanceof LoiKhuon) {
    res.status(maHttpCuaLoi(e.code)).json({ error: { code: e.code, message: e.message, ...e.chiTiet } });
    return;
  }
  const err = errInfo(e);
  logError("wf", "route_error", err.raw);
  res.status(err.status || 500).json({
    error: { code: err.code || "WF_FAILED", message: err.message },
  });
}

/** Chi nhan chuoi ngan: dau vao di thang vao prompt nen phai co tran ro rang. */
function docInputs(tho: unknown): Record<string, string> {
  if (tho == null) return {};
  if (typeof tho !== "object" || Array.isArray(tho)) {
    throw new LoiKhuon("WF_INPUT_INVALID", "inputs phai la mot doi tuong ten -> chuoi");
  }
  const ra: Record<string, string> = {};
  for (const [ten, gt] of Object.entries(tho as Record<string, unknown>)) {
    if (Object.keys(ra).length >= INPUT_TOI_DA) {
      throw new LoiKhuon("WF_INPUT_INVALID", `toi da ${INPUT_TOI_DA} dau vao`);
    }
    if (!/^[A-Z0-9_]+$/.test(ten)) {
      throw new LoiKhuon("WF_INPUT_INVALID", `ten dau vao khong hop le: ${ten.slice(0, 40)}`);
    }
    if (typeof gt !== "string" && typeof gt !== "number") {
      throw new LoiKhuon("WF_INPUT_INVALID", `gia tri cua ${ten} phai la chuoi hoac so`);
    }
    const van = String(gt);
    if (van.length > INPUT_DAI_TOI_DA) {
      throw new LoiKhuon("WF_INPUT_INVALID", `gia tri cua ${ten} dai qua ${INPUT_DAI_TOI_DA} ky tu`);
    }
    ra[ten] = van;
  }
  return ra;
}

/**
 * Anh dinh kem phai la data URL.
 *
 * Khong nhan duong dan tep hay dia chi ngoai: mot cai thi cho phep nguoi goi doc
 * tep bat ky tren may, cai kia bien may chu thanh cong cu tai ho noi dung la.
 */
function docImages(tho: unknown): Record<string, string[]> {
  if (tho == null) return {};
  if (typeof tho !== "object" || Array.isArray(tho)) {
    throw new LoiKhuon("WF_IMAGE_INVALID", "images phai la mot doi tuong nodeId -> danh sach anh");
  }
  const ra: Record<string, string[]> = {};
  for (const [nodeId, gt] of Object.entries(tho as Record<string, unknown>)) {
    const ds = Array.isArray(gt) ? gt : [gt];
    if (ds.length > ANH_MOI_NODE_TOI_DA) {
      throw new LoiKhuon("WF_IMAGE_INVALID", `toi da ${ANH_MOI_NODE_TOI_DA} anh cho mot node`);
    }
    const sach: string[] = [];
    for (const item of ds) {
      if (typeof item !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(item)) {
        throw new LoiKhuon("WF_IMAGE_INVALID", `anh cho ${nodeId} phai la data URL anh`, nodeId);
      }
      // Kiem luon phan base64. Khong kiem thi mot cho giu cho nhu "...base64,..."
      // di thang toi may sinh anh va hong o do, voi mot loi cua nha cung cap
      // khong noi len duoc rang dau vao moi la cho sai.
      const than = item.slice(item.indexOf(",") + 1);
      if (!than || !/^[A-Za-z0-9+/\s]+={0,2}$/.test(than)) {
        throw new LoiKhuon("WF_IMAGE_INVALID", `anh cho ${nodeId} khong phai base64 hop le`, nodeId);
      }
      sach.push(item);
    }
    ra[nodeId] = sach;
  }
  return ra;
}

/**
 * Noi dung thay the theo node, chi cho luot chay nay.
 *
 * Danh sach truong la DONG: prompt / size / model. Cho phep doi vaiTro hay canh
 * noi thi mot lan goi API se ve lai ca khuon, trong khi hinh dang khuon la thu
 * nguoi dung dung tay ve ra tren canvas.
 */
function docNodes(tho: unknown): Record<string, GhiDeNode> {
  if (tho == null) return {};
  if (typeof tho !== "object" || Array.isArray(tho)) {
    throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", "nodes phai la mot doi tuong nodeId -> noi dung");
  }
  const vao = Object.entries(tho as Record<string, unknown>);
  if (vao.length > NODE_GHI_DE_TOI_DA) {
    throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", `toi da ${NODE_GHI_DE_TOI_DA} node`);
  }
  const ra: Record<string, GhiDeNode> = {};
  for (const [nodeId, gt] of vao) {
    if (gt == null || typeof gt !== "object" || Array.isArray(gt)) {
      throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", `noi dung cua ${nodeId} phai la mot doi tuong`, nodeId);
    }
    const than = gt as Record<string, unknown>;
    const la = Object.keys(than).filter((k) => !["prompt", "size", "model"].includes(k));
    if (la.length) {
      throw new LoiKhuon(
        "WF_NODE_OVERRIDE_INVALID",
        `${nodeId}: chi ghi de duoc prompt, size, model - khong nhan ${la.join(", ")}`,
        nodeId,
      );
    }
    const mot: GhiDeNode = {};
    if (than.prompt !== undefined) {
      if (typeof than.prompt !== "string" || than.prompt.length > PROMPT_DAI_TOI_DA) {
        throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", `${nodeId}: prompt phai la chuoi ngan hon ${PROMPT_DAI_TOI_DA} ky tu`, nodeId);
      }
      mot.prompt = than.prompt;
    }
    if (than.size !== undefined) {
      if (typeof than.size !== "string" || !/^\d{2,5}x\d{2,5}$/.test(than.size)) {
        throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", `${nodeId}: size phai co dang 1024x1024`, nodeId);
      }
      mot.size = than.size;
    }
    if (than.model !== undefined) {
      if (typeof than.model !== "string" || !than.model || than.model.length > 100) {
        throw new LoiKhuon("WF_NODE_OVERRIDE_INVALID", `${nodeId}: model phai la chuoi ngan`, nodeId);
      }
      mot.model = than.model;
    }
    ra[nodeId] = mot;
  }
  return ra;
}

/**
 * Goc dia chi dung cho lan tra loi NAY, lay tu chinh yeu cau.
 *
 * Goi tu LAN thi phai nhan link LAN, goi tu may minh thi nhan link localhost -
 * mot goc co dinh se tra ve dia chi ma nguoi goi khong voi tới duoc.
 *
 * Tieu de Host da duoc lop bao ve kiem TRUOC khi vao day (policy.resolveOrigin
 * tu choi moi Host khong nam trong danh sach dia chi phuc vu), nen dung lai no
 * o day la an toan; khong co Host thi lui ve dia chi may chu tu biet.
 */
function gocTuYeuCau(req: Request, ctx: RuntimeContext): string {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : ctx.serverUrl;
}

/**
 * Ghep duong media thanh dia chi day du NGAY LUC TRA LOI.
 *
 * Khong luu dia chi day du xuong co so du lieu: host la thuoc tinh cua lan goi,
 * khong phai cua tep. Luu vao thi doi cong hay doi may la ca lich su tro sai.
 */
function tuyetDoi(goc: string, u: string): string {
  return u.startsWith("/") ? `${goc}${u}` : u;
}

function luotTuyetDoi(luot: WfLuotChay, goc: string): WfLuotChay {
  const kq = luot.ketQua;
  return {
    ...luot,
    buoc: luot.buoc.map((b) => (b.url ? { ...b, url: tuyetDoi(goc, b.url) } : b)),
    ...(kq ? {
      ketQua: {
        media: kq.media.map((m) => ({ ...m, url: tuyetDoi(goc, m.url) })),
        nodes: Object.fromEntries(
          Object.entries(kq.nodes).map(([id, v]) => [id, { ...v, url: tuyetDoi(goc, v.url) }]),
        ),
      },
    } : {}),
  };
}

/** Dia chi dan len node BAT DAU, de o chi dan API tren giao dien chi mot cho. */
export function duongDanKhuon(sessionId: string, startNodeId: string): string {
  return `/api/wf/${encodeURIComponent(sessionId)}/${encodeURIComponent(startNodeId)}`;
}

function traLuot(res: Response, luotTho: WfLuotChay, goc: string): void {
  const luot = luotTuyetDoi(luotTho, goc);
  if (luot.trangThai === "xong") {
    res.json({ ok: true, run: luot, result: luot.ketQua });
    return;
  }
  if (luot.trangThai === "da-huy") {
    res.status(409).json({ ok: false, run: luot, error: luot.loi });
    return;
  }
  if (luot.trangThai === "hong") {
    // Cung mot bang ma voi loi nem truoc khi chay: "thieu dau vao" la 400 du no
    // lo ra o duong nao, khong thi nguoi goi phai doan.
    res.status(maHttpCuaLoi(luot.loi?.code)).json({ ok: false, run: luot, error: luot.loi });
    return;
  }
  // Van dang chay: nguoi goi cho het han, chuyen sang hoi sau.
  res.status(202).json({
    ok: true,
    run: luot,
    statusUrl: `${goc}/api/wf/runs/${luot.id}`,
    streamUrl: `${goc}/api/wf/runs/${luot.id}/stream`,
  });
}

/** Nhip tho giu duong SSE khoi bi proxy cat giua hai buoc dai. */
const NHIP_THO_MS = 15_000;

/**
 * Phat tien do cua mot luot chay ra duong SSE.
 *
 * Xong buoc nao tra buoc do, thay vi bat nguoi goi hoi lai lien tuc. Dung dung
 * ten su kien voi bus noi bo (wf_start / wf_step / wf_end) de chi co mot bo tu
 * vung; rieng wf_end kem ca ban ghi luot va ket qua, de nguoi goi khong phai goi
 * them mot lan nua chi de lay media.
 *
 * Tra ve ham thoi nghe: nguoi goi PHAI dang ky truoc khi khoi dong luot chay,
 * khong thi su kien dau tien da bay qua truoc luc nghe.
 */
function phatTienDo(res: Response, runId: string, goc: string): () => void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let dong = false;
  const gui = (suKien: string, du: unknown) => {
    if (dong || res.writableEnded) return;
    res.write(`event: ${suKien}\ndata: ${JSON.stringify(du)}\n\n`);
  };
  const nhip = setInterval(() => {
    if (!dong && !res.writableEnded) res.write(": ping\n\n");
  }, NHIP_THO_MS);
  if (typeof nhip.unref === "function") nhip.unref();

  const ketThuc = () => {
    if (dong) return;
    dong = true;
    clearInterval(nhip);
    thoi();
    if (!res.writableEnded) res.end();
  };

  const thoi = subscribe((ev) => {
    if (ev.jobId !== WF_KENH || ev.data.runId !== runId) return;
    if (ev.event !== WF_SU_KIEN.ketThuc) {
      // Khung buoc mang url media: ghep thanh dia chi day du theo nguon goi.
      const u = ev.data.url;
      gui(ev.event, typeof u === "string" ? { ...ev.data, url: tuyetDoi(goc, u) } : ev.data);
      return;
    }
    // Ket thuc: kem ca luot va ket qua roi dong duong lai.
    const luotTho = layLuotChay(runId);
    const luot = luotTho ? luotTuyetDoi(luotTho, goc) : null;
    gui(WF_SU_KIEN.ketThuc, {
      ...ev.data,
      ok: luot?.trangThai === "xong",
      run: luot,
      ...(luot?.ketQua ? { result: luot.ketQua } : {}),
    });
    ketThuc();
  });

  // Khach hang ngat giua chung thi luot chay VAN chay tiep - giong che do tra
  // ngay. Huy mot lan sinh anh dang do van mat tien ma khong co ket qua nao.
  //
  // Phai nghe tren RES, khong phai tren REQ. Voi mot POST, req phat "close" ngay
  // khi than yeu cau doc xong - express.json() da doc no truoc khi vao day - nen
  // nghe tren req la tu ngat chinh minh sau frame dau tien, roi duong treo mai
  // vi co `dong` da bat nen khong ai dong res nua. Dung loi da xay ra.
  res.on("close", () => {
    if (dong) return;
    dong = true;
    clearInterval(nhip);
    thoi();
  });

  // Tran thoi gian: mot duong treo vo han la mot duong khong ai doc duoc nua.
  const han = setTimeout(() => {
    gui("wf_timeout", { runId, statusUrl: `/api/wf/runs/${runId}` });
    ketThuc();
  }, HAN_CHO_MS);
  if (typeof han.unref === "function") han.unref();

  return () => { clearTimeout(han); ketThuc(); };
}

export function registerWorkflowRoutes(app: Express, ctxRaw: RouteRuntimeContext): void {
  const ctx = requireRuntimeContext(ctxRaw);

  // Cac tuyen "runs" phai dang ky TRUOC /:sessionId/:startNodeId, khong thi
  // "runs" bi hieu thanh mot ma phien.
  app.get("/api/wf/runs", (req: Request, res: Response) => {
    const so = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const chuoi = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const loc = {
      gioiHan: so(req.query.limit),
      sessionId: chuoi(req.query.sessionId),
      startNodeId: chuoi(req.query.startNodeId),
      trangThai: chuoi(req.query.status),
      truoc: so(req.query.before),
    };
    const goc = gocTuYeuCau(req, ctx);
    const runs = danhSachLuotChay(loc).map((l) => luotTuyetDoi(l, goc));
    res.json({
      runs,
      total: demLuotChay({
        ...(loc.sessionId ? { sessionId: loc.sessionId } : {}),
        ...(loc.trangThai ? { trangThai: loc.trangThai } : {}),
      }),
      // Moc de lat sang trang cu hon: ?before=<nextBefore>.
      nextBefore: runs.length ? runs[runs.length - 1]!.taoLuc : null,
    });
  });

  app.delete("/api/wf/runs/:runId", (req: Request<{ runId: string }>, res: Response) => {
    // Luot dang chay thi khong cho xoa: xoa so trong khi cong viec van dang chay
    // tiep chi lam mat duong theo doi mot thu van dang ton tien.
    const da = xoaLuotChay(req.params.runId);
    if (!da) {
      return res.status(409).json({
        error: {
          code: "WF_RUN_BUSY_OR_MISSING",
          message: "luot chay dang chay hoac khong ton tai",
        },
      });
    }
    res.json({ ok: true });
  });

  app.get("/api/wf/runs/:runId", async (req: Request<{ runId: string }>, res: Response) => {
    const luot = layLuotChay(req.params.runId);
    if (!luot) {
      return res.status(404).json({ error: { code: "WF_RUN_NOT_FOUND", message: "khong co luot chay nay" } });
    }
    if (req.query.wait === "1" && luot.trangThai === "dang-chay") {
      const cho = doiLuotChay(req.params.runId);
      if (cho) await Promise.race([cho, khoangCho(HAN_CHO_MS)]);
    }
    traLuot(res, layLuotChay(req.params.runId) ?? luot, gocTuYeuCau(req, ctx));
  });

  /** Bam vao mot luot dang chay de nhan tiep cac buoc con lai. */
  app.get("/api/wf/runs/:runId/stream", (req: Request<{ runId: string }>, res: Response) => {
    const luot = layLuotChay(req.params.runId);
    if (!luot) {
      return res.status(404).json({ error: { code: "WF_RUN_NOT_FOUND", message: "khong co luot chay nay" } });
    }
    const goc = gocTuYeuCau(req, ctx);
    const ngung = phatTienDo(res, req.params.runId, goc);
    // Luot da xong roi thi khong con su kien nao toi nua: tra ket qua ngay va
    // dong, thay vi de nguoi goi treo cho mot thu da ket thuc.
    if (luot.trangThai !== "dang-chay") {
      const day = luotTuyetDoi(luot, goc);
      res.write(`event: ${WF_SU_KIEN.ketThuc}\ndata: ${JSON.stringify({
        runId: day.id,
        sessionId: day.sessionId,
        startNodeId: day.startNodeId,
        trangThai: day.trangThai,
        ok: day.trangThai === "xong",
        run: day,
        ...(day.ketQua ? { result: day.ketQua } : {}),
      })}\n\n`);
      ngung();
    }
  });

  app.post("/api/wf/runs/:runId/cancel", (req: Request<{ runId: string }>, res: Response) => {
    const luot = layLuotChay(req.params.runId);
    if (!luot) {
      return res.status(404).json({ error: { code: "WF_RUN_NOT_FOUND", message: "khong co luot chay nay" } });
    }
    // Node dang chay van chay het roi moi dung: huy giua chung mot lan sinh anh
    // van mat tien ma khong co ket qua nao.
    const da = huyLuotChay(req.params.runId);
    const sau = layLuotChay(req.params.runId);
    res.json({ ok: da, run: sau ? luotTuyetDoi(sau, gocTuYeuCau(req, ctx)) : null });
  });

  /** Moi khuon dang co: phien nao co node BAT DAU noi duoc toi KET THUC. */
  app.get("/api/wf", (req: Request, res: Response) => {
    const goc = gocTuYeuCau(req, ctx);
    const ra: unknown[] = [];
    for (const phien of listSessions().slice(0, SO_PHIEN_QUET)) {
      const day = getSession((phien as { id: string }).id);
      if (!day) continue;
      const nodes = day.nodes as unknown as WfNode[];
      const edges = day.edges as unknown as WfEdge[];
      for (const n of nodes) {
        if (n.data?.vaiTro !== VAI_TRO_MOC_DAU) continue;
        const chuoi = timChuoiChay(n.id, nodes, edges);
        ra.push({
          sessionId: day.id,
          title: day.title,
          startNodeId: n.id,
          label: n.data?.label ?? null,
          path: duongDanKhuon(day.id, n.id),
          // Them `url` ben canh `path`: nguoi goi co ngay dia chi day du theo
          // dung nguon minh goi, ma `path` cu van con cho ai da dung no.
          url: `${goc}${duongDanKhuon(day.id, n.id)}`,
          ready: chuoi.ok,
          ...(chuoi.ok ? { steps: chuoi.soViec } : { reason: chuoi.loi }),
        });
      }
    }
    res.json({ workflows: ra });
  });

  app.get("/api/wf/:sessionId/:startNodeId", (req: Request<Params>, res: Response) => {
    try {
      const mo = moTaKhuon(req.params.sessionId, req.params.startNodeId);
      const duong = duongDanKhuon(req.params.sessionId, req.params.startNodeId);
      res.json({ ...mo, path: duong, url: `${gocTuYeuCau(req, ctx)}${duong}` });
    } catch (e) { batLoi(res, e); }
  });

  app.post("/api/wf/:sessionId/:startNodeId", async (req: Request<Params>, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        inputs?: unknown; images?: unknown; nodes?: unknown;
        async?: unknown; stream?: unknown;
      };
      const inputs = docInputs(body.inputs);
      const images = docImages(body.images);
      const nodes = docNodes(body.nodes);
      // Mac dinh la CHO: goi mot lan roi nhan ket qua la cach dung thang nhat.
      // ?async=1 (hoac async: true) cho ai khong muon giu ket noi vai phut.
      const traNgay = req.query.async === "1" || body.async === true;
      // ?stream=1 phat tung buoc ra ngay khi no xong, thay vi doi ca luot.
      const phat = req.query.stream === "1" || body.stream === true;

      // Kiem truoc khi ghi so: sai duong dan, thieu dau vao hay dinh anh vao mot
      // node khong co thi khong nen de lai mot luot chay "hong" trong danh sach.
      kiemTruocKhiChay({
        sessionId: req.params.sessionId,
        startNodeId: req.params.startNodeId,
        inputs,
        images,
        nodes,
      });

      const luot: WfLuotChay = {
        id: `wfr_${ulid()}`,
        sessionId: req.params.sessionId,
        startNodeId: req.params.startNodeId,
        trangThai: "dang-chay",
        taoLuc: Date.now(),
        inputs,
        buoc: [],
      };
      taoLuotChay(luot);
      logEvent("wf", "run_start", {
        runId: luot.id,
        sessionId: luot.sessionId,
        startNodeId: luot.startNodeId,
        inputs: Object.keys(inputs),
        images: Object.keys(images),
        nodes: Object.keys(nodes),
        wait: !traNgay,
      });

      // Dang ky nghe TRUOC khi khoi dong: su kien dau tien bay ra ngay khi bo
      // chay giai xong chuoi, dang ky sau la mat no.
      const ngung = phat ? phatTienDo(res, luot.id, gocTuYeuCau(req, ctx)) : null;

      const dangChay = chayKhuon(ctx, {
        sessionId: req.params.sessionId,
        startNodeId: req.params.startNodeId,
        inputs,
        images,
        nodes,
      }, luot).catch((e) => {
        // Bo chay da ghi loi vao chinh luot va dong so lai; o day chi ghi nhat ky
        // va nuot loi, vi luot chay da la cau tra loi day du cho nguoi goi.
        const err = e instanceof LoiKhuon ? e : new LoiKhuon("WF_FAILED", errInfo(e).message);
        logError("wf", "run_failed", err, { runId: luot.id });
        return layLuotChay(luot.id) ?? luot;
      });

      if (ngung) {
        // Duong SSE tu dong lai khi nhan wf_end; cho o day chi de khong bo roi
        // loi hua, va de don dong ho neu luot chay ket thuc ma khong co su kien.
        await dangChay;
        ngung();
        return;
      }
      if (traNgay) {
        const goc = gocTuYeuCau(req, ctx);
        return res.status(202).json({
          ok: true,
          runId: luot.id,
          statusUrl: `${goc}/api/wf/runs/${luot.id}`,
          streamUrl: `${goc}/api/wf/runs/${luot.id}/stream`,
          run: luotTuyetDoi(luot, goc),
        });
      }
      await Promise.race([dangChay, khoangCho(HAN_CHO_MS)]);
      traLuot(res, layLuotChay(luot.id) ?? luot, gocTuYeuCau(req, ctx));
    } catch (e) { batLoi(res, e); }
  });
}

function khoangCho(ms: number): Promise<void> {
  return new Promise((ok) => {
    const t = setTimeout(ok, ms);
    // Mot bo dem 10 phut khong duoc giu tien trinh song khi may chu dong lai.
    if (typeof t.unref === "function") t.unref();
  });
}
