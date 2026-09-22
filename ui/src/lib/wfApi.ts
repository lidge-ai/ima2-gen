/**
 * Goi cac tuyen /api/wf tu giao dien.
 *
 * Giao dien khong tu chay khuon qua duong nay - no van chay tai cho khi nguoi
 * dung bam. Nhung mot he thong khac co the goi vao bat cu luc nao, nen node BAT
 * DAU can doc duoc lich su va dung duoc mot luot dang chay do noi khac khoi dong.
 */

export type WfBuocApi = {
  nodeId: string;
  vaiTro: string | null;
  viec: string;
  trangThai: string;
  url?: string;
  loai?: "anh" | "video";
  batDauLuc?: number;
  xongLuc?: number;
  loi?: string;
};

export type WfLuotApi = {
  id: string;
  sessionId: string;
  startNodeId: string;
  trangThai: "dang-chay" | "xong" | "hong" | "da-huy";
  taoLuc: number;
  xongLuc?: number;
  inputs: Record<string, string>;
  buoc: WfBuocApi[];
  ketQua?: { media: { nodeId: string; url: string; loai: "anh" | "video" }[] };
  loi?: { code: string; message: string; nodeId?: string };
};

async function docJson(res: Response): Promise<Record<string, unknown>> {
  const kq = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok) {
    const loi = (kq?.error ?? {}) as { message?: string };
    throw new Error(loi.message || `HTTP ${res.status}`);
  }
  return kq ?? {};
}

/** Lich su cac luot chay cua MOT node BAT DAU, moi nhat truoc. */
export async function lichSuLuotChay(
  sessionId: string,
  startNodeId: string,
  gioiHan = 10,
): Promise<WfLuotApi[]> {
  const q = new URLSearchParams({ sessionId, startNodeId, limit: String(gioiHan) });
  const kq = await docJson(await fetch(`/api/wf/runs?${q}`));
  return Array.isArray(kq.runs) ? kq.runs as WfLuotApi[] : [];
}

export async function huyLuotChayApi(runId: string): Promise<void> {
  await docJson(await fetch(`/api/wf/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }));
}

export type WfKhuonApi = {
  sessionId: string;
  title?: string;
  startNodeId: string;
  label: string | null;
  path: string;
  /** Dia chi day du theo dung nguon goi - may chu ghep san. */
  url: string;
  ready: boolean;
  steps?: number;
  reason?: string;
};

/** Moi khuon dang co tren may chu, ke ca nhung khuon chua noi xong. */
export async function danhSachKhuon(): Promise<WfKhuonApi[]> {
  const kq = await docJson(await fetch("/api/wf"));
  return Array.isArray(kq.workflows) ? kq.workflows as WfKhuonApi[] : [];
}

/** Lich su chung, khong gioi han o mot node BAT DAU nao. */
export async function lichSuChung(
  loc: { sessionId?: string; startNodeId?: string; gioiHan?: number } = {},
): Promise<WfLuotApi[]> {
  const q = new URLSearchParams({ limit: String(loc.gioiHan ?? 30) });
  if (loc.sessionId) q.set("sessionId", loc.sessionId);
  if (loc.startNodeId) q.set("startNodeId", loc.startNodeId);
  const kq = await docJson(await fetch(`/api/wf/runs?${q}`));
  return Array.isArray(kq.runs) ? kq.runs as WfLuotApi[] : [];
}
