import { useCallback, useState } from "react";
import { useI18n } from "../../i18n";
import type { ImageNodeData } from "../../store/storeTypes";

/**
 * Cai dat rieng cua mot node VIDEO.
 *
 * Bang dieu khien ben phai la cai dat CHUNG cho ca phien. Mot khuon co the co
 * hai node video khac ti le nhau, va khi khuon chay qua API thi khong co ai
 * ngoi chon o bang do - luc do may chu dung mac dinh cua no (auto / 480p / 5s),
 * gan nhu khong bao gio la cai nguoi dung muon. Nen tung node phai tu mang
 * duoc cai dat cua no.
 *
 * O trong = "theo cai dat chung", chu khong phai mot gia tri an. Co nhu vay thi
 * nguoi dung moi bo duoc lua chon da dat ma khong phai doan xem mac dinh la gi.
 */

export type CaiDatVideo = NonNullable<ImageNodeData["caiDatVideo"]>;

/** Dung danh sach may chu nhan (VALID_VIDEO_ASPECT_RATIOS / VALID_VIDEO_RESOLUTIONS). */
const TI_LE = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
const PHAN_GIAI = ["480p", "720p", "1080p"];
const THOI_LUONG = [3, 5, 8, 10, 12, 15];

export interface NodeVideoSettingsProps {
  caiDat: ImageNodeData["caiDatVideo"];
  /** Node co anh nen di vao khong: khong co thi lua chon "anh nen" khong co gi de noi. */
  coAnhNen: boolean;
  doi(patch: Partial<CaiDatVideo>): void;
}

export function NodeVideoSettings({ caiDat, coAnhNen, doi }: NodeVideoSettingsProps) {
  const { t } = useI18n();
  const [mo, setMo] = useState(false);
  const cd = caiDat ?? {};
  const daDat = [cd.aspectRatio, cd.resolution, cd.duration, cd.anhNen].filter((v) => v !== undefined && v !== "").length;
  const bat = useCallback(() => setMo((v) => !v), []);

  return (
    <div className="image-node__vid-cd nodrag">
      <button
        type="button"
        className="image-node__vid-cd-mo"
        onClick={(e) => { e.stopPropagation(); bat(); }}
        aria-expanded={mo}
        title={t("node.videoSettingsTitle")}
      >
        {mo ? "▾" : "▸"} {t("node.videoSettings")}
        {daDat ? <span className="image-node__vid-cd-so">{daDat}</span> : null}
      </button>
      {mo ? (
        <div className="image-node__vid-cd-than">
          <label>
            <span>{t("node.videoAspect")}</span>
            <select
              value={cd.aspectRatio ?? ""}
              onChange={(e) => doi({ aspectRatio: e.target.value || undefined })}
            >
              <option value="">{t("node.videoInherit")}</option>
              {TI_LE.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>{t("node.videoResolution")}</span>
            <select
              value={cd.resolution ?? ""}
              onChange={(e) => doi({ resolution: e.target.value || undefined })}
            >
              <option value="">{t("node.videoInherit")}</option>
              {PHAN_GIAI.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label>
            <span>{t("node.videoDuration")}</span>
            <select
              value={cd.duration ?? ""}
              onChange={(e) => doi({ duration: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">{t("node.videoInherit")}</option>
              {THOI_LUONG.map((v) => <option key={v} value={String(v)}>{v}s</option>)}
            </select>
          </label>
          {coAnhNen ? (
            <label>
              <span>{t("node.videoBase")}</span>
              <select
                value={cd.anhNen ?? "khung-dau"}
                onChange={(e) => doi({ anhNen: e.target.value as CaiDatVideo["anhNen"] })}
              >
                {/* May chu chi lam MOT trong hai, nen day la mot lua chon that
                    chu khong phai hai o co the bat cung luc. */}
                <option value="khung-dau">{t("node.videoBaseFirstFrame")}</option>
                <option value="tham-chieu">{t("node.videoBaseReference")}</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
