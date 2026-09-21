/**
 * Ghep nhieu tep media thanh MOT video.
 *
 * Nhan lan lon anh va video theo dung thu tu nguoi dung xep. Anh duoc keo dai
 * thanh mot doan clip ngan; video giu nguyen thoi luong.
 *
 * Vi sao phai chuan hoa truoc khi noi: cac clip co the khac do phan giai, khac
 * ti le va khac fps. Noi thang bang concat demuxer se hong hoac nhay hinh, nen
 * moi dau vao deu duoc scale + pad ve cung mot khung va cung mot fps roi moi noi
 * bang filter concat.
 *
 * Ban dau ra KHONG co tieng: tron audio giua cac clip co tieng va anh khong co
 * tieng can them nguon im lang va can chinh dong bo, de danh cho buoc sau.
 */
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";

const MERGE_TIMEOUT_MS = 10 * 60 * 1000;
const ANH_MAC_DINH_GIAY = 2;
const FPS_MAC_DINH = 24;
const KHUNG_MAC_DINH = { w: 720, h: 1280 };

export type MucGhep = {
  /** Duong dan tuyet doi toi tep nguon. */
  duongDan: string;
  /** "anh" duoc keo dai thanh clip; "video" giu nguyen. */
  loai: "anh" | "video";
  /** Rieng cho anh: so giay. Mac dinh 2. */
  giay?: number;
};

export type ThamSoGhep = {
  fps?: number;
  khung?: { w: number; h: number };
};

/** Doc kich thuoc khung hinh cua mot tep video. */
export async function docKhungHinh(duongDan: string): Promise<{ w: number; h: number } | null> {
  return new Promise((ok) => {
    execFile(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x", duongDan],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) return ok(null);
        const m = /^(\d+)x(\d+)/.exec(String(stdout).trim());
        ok(m ? { w: Number(m[1]), h: Number(m[2]) } : null);
      },
    );
  });
}

/**
 * Dung danh sach tham so cho ffmpeg.
 *
 * Moi dau vao: scale vua khung roi pad cho du kich thuoc (giu nguyen ti le, them
 * vien den) va ep ve cung fps. Sau do noi tat ca bang filter concat.
 */
export function dungThamSo(muc: MucGhep[], dauRa: string, ts: Required<ThamSoGhep>): string[] {
  const args: string[] = ["-y"];
  for (const m of muc) {
    if (m.loai === "anh") args.push("-loop", "1", "-t", String(m.giay ?? ANH_MAC_DINH_GIAY));
    args.push("-i", m.duongDan);
  }
  const { w, h } = ts.khung;
  const loc = muc
    .map((_, i) =>
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,`
      + `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,`
      + `setsar=1,fps=${ts.fps}[v${i}]`)
    .join(";");
  const noi = muc.map((_, i) => `[v${i}]`).join("") + `concat=n=${muc.length}:v=1:a=0[out]`;
  args.push(
    "-filter_complex", `${loc};${noi}`,
    "-map", "[out]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    dauRa,
  );
  return args;
}

/** Ghep danh sach media thanh mot video tai `dauRa`. */
export async function ghepMedia(
  muc: MucGhep[],
  dauRa: string,
  ts: ThamSoGhep = {},
): Promise<void> {
  if (!muc.length) throw new Error("khong co muc nao de ghep");
  for (const m of muc) {
    try { await stat(m.duongDan); }
    catch { throw new Error(`khong thay tep: ${m.duongDan}`); }
  }

  // Lay khung hinh tu VIDEO dau tien; toan anh thi dung khung mac dinh.
  let khung = ts.khung ?? null;
  if (!khung) {
    for (const m of muc) {
      if (m.loai !== "video") continue;
      khung = await docKhungHinh(m.duongDan);
      if (khung) break;
    }
  }
  const thamSo: Required<ThamSoGhep> = {
    fps: ts.fps ?? FPS_MAC_DINH,
    khung: khung ?? KHUNG_MAC_DINH,
  };

  const args = dungThamSo(muc, dauRa, thamSo);
  await new Promise<void>((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: MERGE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          reject(new Error("chua cai ffmpeg - can ffmpeg de ghep video"));
          return;
        }
        const duoi = String(stderr || "").split("\n").filter(Boolean).slice(-4).join(" | ");
        reject(new Error(`ffmpeg ghep that bai${duoi ? `: ${duoi}` : ""}`));
      });
  });
}
