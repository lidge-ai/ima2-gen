/**
 * So theo doi cac luot chay khuon goi qua API.
 *
 * Hai lop chong len nhau, moi lop giai mot viec khac han:
 *
 * - Bang `wf_runs` trong SQLite la LICH SU: con lai sau khi may chu tat, tra
 *   loi duoc cau "hom qua goi API do ra cai gi".
 * - Ban ghi trong bo nho la phan DANG SONG: loi hua de tuyen ?wait=1 doi, va
 *   AbortController de huy giua chung. Hai thu do khong the ghi xuong dia.
 *
 * Mot luot dang chay ma may chu tat giua chung thi tien trinh sinh anh cung
 * chet theo. Neu cu de nguyen trang thai "dang chay" trong bang thi lan sau mo
 * len se thay mot luot khong bao gio ket thuc, nen luc khoi dong phai danh dau
 * lai chung la hong.
 */
import { getDb } from "./db.js";

/** Tran so luot giu lai. Vuot qua thi don tu luot cu nhat. */
const GIU_TOI_DA = 500;

export type WfTrangThaiBuoc = "cho" | "dang-chay" | "xong" | "hong" | "bo-qua";

export type WfBuoc = {
  nodeId: string;
  vaiTro: string | null;
  nhan?: string | undefined;
  viec: string;
  trangThai: WfTrangThaiBuoc;
  url?: string | undefined;
  loai?: "anh" | "video" | undefined;
  batDauLuc?: number | undefined;
  xongLuc?: number | undefined;
  loi?: string | undefined;
};

export type WfKetQua = {
  /** Media cua nhung node noi thang vao node KET THUC. */
  media: { nodeId: string; url: string; loai: "anh" | "video"; nhan?: string | undefined }[];
  /** Media cua MOI node da chay, tra cuu theo id node. */
  nodes: Record<string, { url: string; loai: "anh" | "video" }>;
};

export type WfTrangThai = "dang-chay" | "xong" | "hong" | "da-huy";

export type WfLuotChay = {
  id: string;
  sessionId: string;
  startNodeId: string;
  trangThai: WfTrangThai;
  taoLuc: number;
  xongLuc?: number | undefined;
  inputs: Record<string, string>;
  buoc: WfBuoc[];
  ketQua?: WfKetQua | undefined;
  loi?: { code: string; message: string; nodeId?: string | undefined } | undefined;
};

type BanGhi = {
  luot: WfLuotChay;
  /** Giai quyet khi luot chay ket thuc - cho tuyen ?wait=1 doi. */
  xong: Promise<WfLuotChay>;
  baoXong: (l: WfLuotChay) => void;
  huy: AbortController;
};

/** Chi nhung luot DANG chay cua tien trinh nay. Xong la go khoi day. */
const dangSong = new Map<string, BanGhi>();

type Hang = {
  id: string;
  session_id: string;
  start_node_id: string;
  status: string;
  created_at: number;
  finished_at: number | null;
  inputs: string;
  steps: string;
  result: string | null;
  error: string | null;
};

function doc<T>(van: string | null, mac: T): T {
  if (!van) return mac;
  try { return JSON.parse(van) as T; } catch { return mac; }
}

function thanhLuot(h: Hang): WfLuotChay {
  return {
    id: h.id,
    sessionId: h.session_id,
    startNodeId: h.start_node_id,
    trangThai: h.status as WfTrangThai,
    taoLuc: h.created_at,
    ...(h.finished_at == null ? {} : { xongLuc: h.finished_at }),
    inputs: doc<Record<string, string>>(h.inputs, {}),
    buoc: doc<WfBuoc[]>(h.steps, []),
    ...(h.result ? { ketQua: doc<WfKetQua>(h.result, { media: [], nodes: {} }) } : {}),
    ...(h.error ? { loi: doc<WfLuotChay["loi"]>(h.error, undefined) } : {}),
  };
}

/* ---------------------------------------------------- khoi phuc sau khoi dong */

let daKhoiPhuc = false;

/**
 * Danh dau lai nhung luot con treo tu lan chay truoc.
 *
 * Chay MOT lan, va chi dung toi nhung luot KHONG nam trong bo nho cua tien
 * trinh nay - nho vay du co goi muon the nao thi no cung khong the giet mot
 * luot dang that su chay.
 */
function khoiPhuc(): void {
  if (daKhoiPhuc) return;
  daKhoiPhuc = true;
  const db = getDb();
  const treo = db
    .prepare("SELECT id, steps FROM wf_runs WHERE status = 'dang-chay'")
    .all() as { id: string; steps: string }[];
  const cap = db.prepare(
    "UPDATE wf_runs SET status = 'hong', finished_at = ?, steps = ?, error = ? WHERE id = ?",
  );
  const loi = JSON.stringify({
    code: "WF_SERVER_RESTARTED",
    message: "may chu khoi dong lai khi luot chay chua xong",
  });
  for (const h of treo) {
    if (dangSong.has(h.id)) continue;
    // Buoc nao con do dang cung phai dong lai, khong thi danh sach buoc mai
    // hien "dang chay" trong khi ca luot da hong.
    const buoc = doc<WfBuoc[]>(h.steps, []).map((b) =>
      b.trangThai === "dang-chay" || b.trangThai === "cho"
        ? { ...b, trangThai: "bo-qua" as const }
        : b);
    cap.run(Date.now(), JSON.stringify(buoc), loi, h.id);
  }
}

/* ------------------------------------------------------------------- ghi doc */

function donBot(): void {
  const db = getDb();
  const du = db
    .prepare("SELECT COUNT(*) AS n FROM wf_runs")
    .get() as { n: number };
  if (du.n <= GIU_TOI_DA) return;
  // Don tu cu nhat, va khong bao gio dung toi mot luot dang chay.
  db.prepare(`
    DELETE FROM wf_runs WHERE id IN (
      SELECT id FROM wf_runs WHERE status != 'dang-chay'
      ORDER BY created_at ASC LIMIT ?
    )
  `).run(du.n - GIU_TOI_DA);
}

/** Ghi (hoac ghi de) mot luot xuong bang. Goi sau MOI thay doi dang ke. */
export function luuLuotChay(luot: WfLuotChay): void {
  khoiPhuc();
  getDb().prepare(`
    INSERT INTO wf_runs (id, session_id, start_node_id, status, created_at, finished_at, inputs, steps, result, error)
    VALUES (@id, @session_id, @start_node_id, @status, @created_at, @finished_at, @inputs, @steps, @result, @error)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      finished_at = excluded.finished_at,
      steps = excluded.steps,
      result = excluded.result,
      error = excluded.error
  `).run({
    id: luot.id,
    session_id: luot.sessionId,
    start_node_id: luot.startNodeId,
    status: luot.trangThai,
    created_at: luot.taoLuc,
    finished_at: luot.xongLuc ?? null,
    inputs: JSON.stringify(luot.inputs ?? {}),
    steps: JSON.stringify(luot.buoc ?? []),
    result: luot.ketQua ? JSON.stringify(luot.ketQua) : null,
    error: luot.loi ? JSON.stringify(luot.loi) : null,
  });
}

export function taoLuotChay(luot: WfLuotChay): BanGhi {
  khoiPhuc();
  let baoXong: (l: WfLuotChay) => void = () => {};
  const xong = new Promise<WfLuotChay>((res) => { baoXong = res; });
  const ban: BanGhi = { luot, xong, baoXong, huy: new AbortController() };
  dangSong.set(luot.id, ban);
  luuLuotChay(luot);
  donBot();
  return ban;
}

/** Luot dang chay lay tu bo nho (moi nhat tung giay); con lai lay tu bang. */
export function layLuotChay(id: string): WfLuotChay | null {
  const song = dangSong.get(id);
  if (song) return song.luot;
  khoiPhuc();
  const h = getDb().prepare("SELECT * FROM wf_runs WHERE id = ?").get(id) as Hang | undefined;
  return h ? thanhLuot(h) : null;
}

export function doiLuotChay(id: string): Promise<WfLuotChay> | null {
  const ban = dangSong.get(id);
  if (ban) return ban.xong;
  const luot = layLuotChay(id);
  return luot ? Promise.resolve(luot) : null;
}

export function tinHieuHuy(id: string): AbortSignal | null {
  return dangSong.get(id)?.huy.signal ?? null;
}

/** Yeu cau dung mot luot dang chay. Node dang chay do van chay het roi moi dung. */
export function huyLuotChay(id: string): boolean {
  const ban = dangSong.get(id);
  if (!ban || ban.luot.trangThai !== "dang-chay") return false;
  ban.huy.abort();
  return true;
}

export function ketThucLuotChay(id: string): void {
  const ban = dangSong.get(id);
  if (!ban) return;
  ban.luot.xongLuc = Date.now();
  luuLuotChay(ban.luot);
  // Go khoi bo nho NGAY khi xong: tu day tro di lich su doc tu bang, nen bo nho
  // khong phinh theo so luot da chay.
  dangSong.delete(id);
  ban.baoXong(ban.luot);
}

export type LocLuotChay = {
  gioiHan?: number | undefined;
  sessionId?: string | undefined;
  startNodeId?: string | undefined;
  trangThai?: string | undefined;
  /** Chi lay nhung luot tao TRUOC moc nay - dung de lat trang. */
  truoc?: number | undefined;
};

export function danhSachLuotChay(loc: LocLuotChay = {}): WfLuotChay[] {
  khoiPhuc();
  const dk: string[] = [];
  const ts: unknown[] = [];
  if (loc.sessionId) { dk.push("session_id = ?"); ts.push(loc.sessionId); }
  if (loc.startNodeId) { dk.push("start_node_id = ?"); ts.push(loc.startNodeId); }
  if (loc.trangThai) { dk.push("status = ?"); ts.push(loc.trangThai); }
  if (typeof loc.truoc === "number" && Number.isFinite(loc.truoc)) {
    dk.push("created_at < ?"); ts.push(loc.truoc);
  }
  const gioiHan = Math.min(Math.max(1, Math.trunc(loc.gioiHan ?? 20)), 200);
  const hang = getDb().prepare(`
    SELECT * FROM wf_runs
    ${dk.length ? `WHERE ${dk.join(" AND ")}` : ""}
    ORDER BY created_at DESC LIMIT ?
  `).all(...ts, gioiHan) as Hang[];
  // Luot dang chay trong tien trinh nay moi hon ban da ghi, nen uu tien no.
  return hang.map((h) => dangSong.get(h.id)?.luot ?? thanhLuot(h));
}

export function demLuotChay(loc: Pick<LocLuotChay, "sessionId" | "trangThai"> = {}): number {
  khoiPhuc();
  const dk: string[] = [];
  const ts: unknown[] = [];
  if (loc.sessionId) { dk.push("session_id = ?"); ts.push(loc.sessionId); }
  if (loc.trangThai) { dk.push("status = ?"); ts.push(loc.trangThai); }
  const h = getDb().prepare(
    `SELECT COUNT(*) AS n FROM wf_runs ${dk.length ? `WHERE ${dk.join(" AND ")}` : ""}`,
  ).get(...ts) as { n: number };
  return h.n;
}

/** Xoa mot luot khoi lich su. Luot dang chay thi khong cho xoa. */
export function xoaLuotChay(id: string): boolean {
  khoiPhuc();
  if (dangSong.has(id)) return false;
  return getDb().prepare("DELETE FROM wf_runs WHERE id = ?").run(id).changes > 0;
}

/** Chi dung trong kiem thu. */
export function xoaHetLuotChay(): void {
  dangSong.clear();
  getDb().prepare("DELETE FROM wf_runs").run();
}

/**
 * Chi dung trong kiem thu: dat lai co khoi phuc de lan doc sau chay lai buoc
 * "dong nhung luot con treo", dung nhu mot lan khoi dong may chu moi.
 */
export function moPhongKhoiDongLai(): void {
  dangSong.clear();
  daKhoiPhuc = false;
}
