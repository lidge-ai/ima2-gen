/**
 * Anh tham chieu dinh len tung node - luu o MAY CHU.
 *
 * Truoc day chung nam o localStorage. Hai cai gia phai tra: mot khuon chay o
 * may chu (goi qua API) khong he thay chung, nen doi anh dinh tren giao dien
 * xong goi API van ra ket qua cu; va doi may hay xoa du lieu trang la mat sach.
 *
 * Cac cho goi trong store deu la ham DONG BO, nen o day giu mot ban trong bo
 * nho de doc ngay, con viec ghi thi day len may chu o phia sau. Ban trong bo nho
 * duoc nap mot lan moi khi mo phien, truoc luc dung graph.
 */

const KHOA_CU = "ima2.nodeRefs.v1";

type BanGhi = Record<string, string[]>;

/** Ban trong bo nho, theo phien. */
const boNho = new Map<string, BanGhi>();
/** Phien nao da nap xong tu may chu. */
const daNap = new Set<string>();

function doiUrl(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/* --------------------------------------------------------- localStorage cu */

function docKhoCu(): Record<string, BanGhi> {
  try {
    const raw = localStorage.getItem(KHOA_CU);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, BanGhi> : {};
  } catch {
    return {};
  }
}

function xoaKhoCu(sessionId: string): void {
  try {
    const all = docKhoCu();
    if (!(sessionId in all)) return;
    delete all[sessionId];
    localStorage.setItem(KHOA_CU, JSON.stringify(all));
  } catch { /* trinh duyet chan localStorage thi thoi */ }
}

/* ------------------------------------------------------------------- nap */

/**
 * Nap anh cua mot phien tu may chu, va chuyen not nhung gi con o localStorage.
 *
 * Chuyen mot lan: nguoi dung da dinh anh truoc khi co bang nay, mat chung di la
 * mat cong ho da bo ra. Chi day len nhung node may chu CHUA co, de khong ghi de
 * thu moi hon bang thu cu.
 */
export async function napRefCuaPhien(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  let tuMay: BanGhi = {};
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/node-refs`);
    if (res.ok) {
      const kq = await doiUrl(res);
      const refs = kq.refs;
      if (refs && typeof refs === "object") tuMay = refs as BanGhi;
    }
  } catch { /* mat mang thi chay voi ban rong, ghi se thu lai sau */ }

  const cu = docKhoCu()[sessionId] ?? {};
  const canDay = Object.entries(cu).filter(([nodeId, refs]) =>
    Array.isArray(refs) && refs.length > 0 && !(tuMay[nodeId]?.length));
  for (const [nodeId, refs] of canDay) {
    const len = await dayLenMayChu(sessionId, nodeId, refs);
    if (len) tuMay[nodeId] = len;
  }
  if (canDay.length > 0) xoaKhoCu(sessionId);

  boNho.set(sessionId, tuMay);
  daNap.add(sessionId);
}

async function dayLenMayChu(
  sessionId: string,
  nodeId: string,
  refs: string[],
): Promise<string[] | null> {
  try {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(sessionId)}/node-refs/${encodeURIComponent(nodeId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refs }),
      },
    );
    if (!res.ok) {
      console.warn("[nodeRefs] khong luu duoc anh cua node", nodeId, res.status);
      return null;
    }
    const kq = await doiUrl(res);
    return Array.isArray(kq.refs) ? kq.refs as string[] : null;
  } catch (e) {
    console.warn("[nodeRefs] khong luu duoc anh cua node", nodeId, e);
    return null;
  }
}

/* ------------------------------------------------------------------ doc ghi */

export function loadNodeRefs(sessionId: string | null, clientId: string): string[] {
  if (!sessionId) return [];
  const refs = boNho.get(sessionId)?.[clientId];
  return Array.isArray(refs) ? refs.filter((r) => typeof r === "string") : [];
}

export function daNapRef(sessionId: string | null): boolean {
  return !!sessionId && daNap.has(sessionId);
}

/**
 * Ghi danh sach anh moi cua mot node.
 *
 * Ban trong bo nho doi ngay de giao dien khong nhay; may chu doi o phia sau.
 * May chu tra ve duong /generated/... thay cho data URL, nen cap nhat lai ban
 * trong bo nho - nho vay lan luu graph sau khong cong theo ca cuc base64.
 */
export function saveNodeRefs(
  sessionId: string | null,
  clientId: string,
  refs: string[],
): void {
  if (!sessionId) return;
  const ban = { ...(boNho.get(sessionId) ?? {}) };
  if (refs.length === 0) delete ban[clientId];
  else ban[clientId] = refs;
  boNho.set(sessionId, ban);
  void dayLenMayChu(sessionId, clientId, refs).then((len) => {
    if (!len) return;
    const hienTai = { ...(boNho.get(sessionId) ?? {}) };
    // Chi thay khi danh sach chua bi doi tiep trong luc cho may chu tra loi.
    if ((hienTai[clientId] ?? []).length !== refs.length) return;
    if (len.length === 0) delete hienTai[clientId];
    else hienTai[clientId] = len;
    boNho.set(sessionId, hienTai);
  });
}

export function clearNodeRefs(sessionId: string | null, clientId: string): void {
  saveNodeRefs(sessionId, clientId, []);
}

/** Don anh cua nhung node khong con trong graph. */
export function pruneNodeRefs(sessionId: string | null, liveClientIds: string[]): void {
  if (!sessionId) return;
  const ban = boNho.get(sessionId);
  if (!ban) return;
  const live = new Set(liveClientIds);
  const chet = Object.keys(ban).filter((id) => !live.has(id));
  if (chet.length === 0) return;
  const moi = { ...ban };
  for (const id of chet) delete moi[id];
  boNho.set(sessionId, moi);
  void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/node-refs/prune`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodeIds: liveClientIds }),
  }).catch(() => { /* lan luu sau se don lai */ });
}

/** Chi dung trong kiem thu. */
export function datRefTrongBoNho(sessionId: string, ban: BanGhi): void {
  boNho.set(sessionId, ban);
  daNap.add(sessionId);
}
