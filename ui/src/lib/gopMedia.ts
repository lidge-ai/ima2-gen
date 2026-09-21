/**
 * Thu gom media cho hai vai tro GOP.
 *
 * Node GOP khong goi mo hinh nao - no chi gom lai nhung gi cac canh vao mang
 * toi, cong voi nhung gi nguoi dung tu dinh vao chinh no. Nho vay bam GOP
 * khong ton tien va chay trong vai giay.
 *
 * Phan thu gom va sap xep nam o lib/wfChain.ts, dung chung voi may chu: node
 * bay ra danh sach nao thi luot chay khuon phai ghep dung danh sach do.
 */
export {
  doiCho,
  gomTuCanhVao,
  mucGopCuaNode,
  xepTheoThuTu,
  type MucGop,
} from "../../../lib/wfChain.js";
import type { MucGop as MucGopKieu } from "../../../lib/wfChain.js";

/** Goi may chu ghep danh sach thanh MOT video. */
export async function ghepThanhVideo(muc: MucGopKieu[], giayMoiAnh = 2): Promise<string> {
  if (muc.length < 2) throw new Error("can it nhat hai muc de ghep");
  const res = await fetch("/api/media/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: muc.map((m) => ({ filename: m.url.replace(/^\/generated\//, "") })),
      imageSec: giayMoiAnh,
    }),
  });
  const kq = await res.json().catch(() => null);
  if (!res.ok) throw new Error(kq?.error?.message || `HTTP ${res.status}`);
  const url = String(kq?.url || "");
  if (!url) throw new Error("may chu khong tra ve video nao");
  return url;
}
