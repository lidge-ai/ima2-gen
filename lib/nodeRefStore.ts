/**
 * Anh tham chieu nguoi dung dinh len tung node cua mot khuon.
 *
 * Truoc day chung nam o localStorage cua trinh duyet. Hai cai gia phai tra:
 * mot khuon chay o may chu (goi qua API) khong he thay chung, nen doi anh dinh
 * tren giao dien xong goi API van ra ket qua cu; va doi may hay xoa du lieu
 * trang la mat sach. Nen chung phai nam trong co so du lieu.
 *
 * Bang chi giu URL tep, khong giu data URL. Byte anh nam trong thu muc generated
 * nhu moi anh khac cua du an - nho vay bang khong phinh, va may chu doc duoc tep
 * de gui len ben sinh anh.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "./db.js";
import { detectImageMimeFromB64 } from "./refs.js";

/** Cung tran voi mot node tren giao dien (MAX_NODE_REFS). */
export const NODE_REF_TOI_DA = 5;
const BYTE_TOI_DA = 20 * 1024 * 1024;

const TIEN_TO = /^data:(image\/(?:png|jpeg|webp));base64,/i;
const DUOI: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type Hang = { node_id: string; idx: number; url: string };

export function loiRef(code: string, message: string): Error & { code: string; status: number } {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = 400;
  return e;
}

/* ------------------------------------------------------------------ doc */

/** Moi node co anh dinh trong mot phien, tra cuu theo id node. */
export function refCuaPhien(sessionId: string): Record<string, string[]> {
  const hang = getDb()
    .prepare("SELECT node_id, idx, url FROM node_refs WHERE session_id = ? ORDER BY node_id, idx")
    .all(sessionId) as Hang[];
  const ra: Record<string, string[]> = {};
  for (const h of hang) (ra[h.node_id] ??= []).push(h.url);
  return ra;
}

export function refCuaNode(sessionId: string, nodeId: string): string[] {
  return (getDb()
    .prepare("SELECT url FROM node_refs WHERE session_id = ? AND node_id = ? ORDER BY idx")
    .all(sessionId, nodeId) as { url: string }[])
    .map((h) => h.url);
}

/* ------------------------------------------------------------------ ghi */

/** Thay toan bo danh sach anh cua mot node. Danh sach rong la xoa het. */
export function datRefCuaNode(sessionId: string, nodeId: string, urls: readonly string[]): void {
  const db = getDb();
  const xoa = db.prepare("DELETE FROM node_refs WHERE session_id = ? AND node_id = ?");
  const them = db.prepare(
    "INSERT INTO node_refs (session_id, node_id, idx, url, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const luc = Date.now();
  db.transaction(() => {
    xoa.run(sessionId, nodeId);
    urls.forEach((url, i) => them.run(sessionId, nodeId, i, url, luc));
  })();
}

/**
 * Don anh cua nhung node khong con trong graph.
 *
 * Xoa node thi anh dinh cua no thanh rac khong ai doc nua. Tep trong generated
 * thi de nguyen - o day cung nhu moi cho khac trong du an, tep anh khong bi
 * don theo mot ban ghi.
 */
export function donRefMoCoi(sessionId: string, nodeIdConLai: readonly string[]): number {
  const db = getDb();
  const co = new Set(nodeIdConLai);
  const hang = db
    .prepare("SELECT DISTINCT node_id FROM node_refs WHERE session_id = ?")
    .all(sessionId) as { node_id: string }[];
  const xoa = db.prepare("DELETE FROM node_refs WHERE session_id = ? AND node_id = ?");
  let n = 0;
  db.transaction(() => {
    for (const h of hang) {
      if (co.has(h.node_id)) continue;
      xoa.run(sessionId, h.node_id);
      n += 1;
    }
  })();
  return n;
}

/* ------------------------------------------------------------- data URL */

/**
 * Ghi mot data URL thanh tep trong thu muc generated, tra ve duong /generated/...
 *
 * Kiem ca MIME khai bao lan byte that: mot tep khai la PNG nhung ben trong la
 * thu khac se hong o tan ben sinh anh, voi mot loi khong noi len duoc rang dau
 * vao moi la cho sai.
 */
export async function ghiDataUrl(generatedDir: string, dataUrl: string): Promise<string> {
  const khop = TIEN_TO.exec(dataUrl);
  if (!khop) throw loiRef("NODE_REF_MIME", "anh phai la data URL PNG, JPEG hoac WebP");
  const mime = khop[1]!.toLowerCase();
  const b64 = dataUrl.slice(khop[0].length).replace(/\s+/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    throw loiRef("NODE_REF_DATA", "anh khong phai base64 hop le");
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0 || buf.length > BYTE_TOI_DA) {
    throw loiRef("NODE_REF_SIZE", "anh phai nho hon 20MB");
  }
  if (buf.length < 12 || detectImageMimeFromB64(b64) !== mime) {
    throw loiRef("NODE_REF_FORMAT", "MIME khai bao khong khop voi byte anh");
  }
  const ten = `ref_${Date.now().toString(36)}${randomBytes(4).toString("hex")}.${DUOI[mime]}`;
  await mkdir(generatedDir, { recursive: true });
  await writeFile(join(generatedDir, ten), buf);
  return `/generated/${ten}`;
}

/**
 * Chuan hoa danh sach anh nguoi dung gui len: data URL thi ghi thanh tep, con
 * duong /generated/... san thi giu nguyen (nguoi dung keo mot anh da co tu thu
 * vien vao, khong can nhan ban).
 */
export async function chuanHoaRef(
  generatedDir: string,
  tho: readonly unknown[],
): Promise<string[]> {
  if (tho.length > NODE_REF_TOI_DA) {
    throw loiRef("NODE_REF_TOO_MANY", `toi da ${NODE_REF_TOI_DA} anh cho mot node`);
  }
  const ra: string[] = [];
  for (const item of tho) {
    if (typeof item !== "string" || !item) {
      throw loiRef("NODE_REF_INVALID", "moi anh phai la mot chuoi");
    }
    if (item.startsWith("data:")) {
      ra.push(await ghiDataUrl(generatedDir, item));
      continue;
    }
    // Chi nhan duong dan trong thu muc generated. Nhan dia chi ngoai thi bien
    // may chu thanh cong cu tai ho, nhan duong dan tuy y thi doc duoc tep bat ky.
    if (!/^\/generated\/[A-Za-z0-9._-]+$/.test(item)) {
      throw loiRef("NODE_REF_INVALID", `khong nhan duong dan nay: ${item.slice(0, 80)}`);
    }
    ra.push(item);
  }
  return ra;
}
