/**
 * So theo doi cac luot chay khuon goi qua API.
 *
 * Giu trong bo nho chu khong ghi xuong o cung: mot luot chay khong song qua noi
 * lan khoi dong lai may chu (tien trinh sinh anh cung chet theo), nen ghi xuong
 * chi tao ra nhung luot "dang chay" vinh vien khong bao gio ket thuc.
 *
 * Co chan tran so luot giu lai - khong thi mot he thong goi API deu deu se phinh
 * bo nho cho toi khi do.
 */

const TOI_DA = 100;

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

export type WfLuotChay = {
  id: string;
  sessionId: string;
  startNodeId: string;
  trangThai: "dang-chay" | "xong" | "hong" | "da-huy";
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

const so = new Map<string, BanGhi>();

function donBot(): void {
  if (so.size <= TOI_DA) return;
  // Chi don nhung luot DA ket thuc: don luot dang chay se lam mat duong theo doi
  // cua mot cong viec van con dang ton tien chay tiep.
  const xong = [...so.values()]
    .filter((b) => b.luot.trangThai !== "dang-chay")
    .sort((a, b) => (a.luot.xongLuc ?? a.luot.taoLuc) - (b.luot.xongLuc ?? b.luot.taoLuc));
  for (const b of xong) {
    if (so.size <= TOI_DA) break;
    so.delete(b.luot.id);
  }
}

export function taoLuotChay(luot: WfLuotChay): BanGhi {
  let baoXong: (l: WfLuotChay) => void = () => {};
  const xong = new Promise<WfLuotChay>((res) => { baoXong = res; });
  const ban: BanGhi = { luot, xong, baoXong, huy: new AbortController() };
  so.set(luot.id, ban);
  donBot();
  return ban;
}

export function layLuotChay(id: string): WfLuotChay | null {
  return so.get(id)?.luot ?? null;
}

export function doiLuotChay(id: string): Promise<WfLuotChay> | null {
  const ban = so.get(id);
  if (!ban) return null;
  return ban.luot.trangThai === "dang-chay" ? ban.xong : Promise.resolve(ban.luot);
}

export function tinHieuHuy(id: string): AbortSignal | null {
  return so.get(id)?.huy.signal ?? null;
}

/** Yeu cau dung mot luot dang chay. Node dang chay do van chay het roi moi dung. */
export function huyLuotChay(id: string): boolean {
  const ban = so.get(id);
  if (!ban || ban.luot.trangThai !== "dang-chay") return false;
  ban.huy.abort();
  return true;
}

export function ketThucLuotChay(id: string): void {
  const ban = so.get(id);
  if (!ban) return;
  ban.luot.xongLuc = Date.now();
  ban.baoXong(ban.luot);
}

export function danhSachLuotChay(gioiHan = 20): WfLuotChay[] {
  return [...so.values()]
    .map((b) => b.luot)
    .sort((a, b) => b.taoLuc - a.taoLuc)
    .slice(0, Math.max(1, gioiHan));
}

/** Chi dung trong kiem thu. */
export function xoaHetLuotChay(): void {
  so.clear();
}
