import { useCallback, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import type { WfLuotApi } from "../../lib/wfApi";

/**
 * O chi dan API tren node BAT DAU.
 *
 * Chia thanh tung muc gap rieng thay vi mot khoi duy nhat: gop het vao mot cho
 * thi mo ra la mot cot dai hon ca canvas, va phan nguoi dung dang can bi day
 * xuong duoi tam nhin. Moi muc dong san, mo cai nao thi chi cai do dai ra.
 */

export type TuyenApi = { duong: string; ghiChu: string; lenh: string };

export type NodeTrongKhuon = {
  id: string;
  vaiTro: string | null;
  prompt: string;
  soAnh: number;
  nhanAnh: boolean;
};

export interface NodeApiPanelProps {
  cacTuyen: TuyenApi[];
  oTrongKhuon: string[];
  nodeTrongKhuon: NodeTrongKhuon[];
  thanMotNode(n: NodeTrongKhuon): string;
  lichSu: WfLuotApi[] | null;
  dangTaiLichSu: boolean;
  taiLichSu(): void;
}

function chep(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function Muc({ nhan, moSan, khiMo, children }: {
  nhan: string;
  moSan?: boolean;
  khiMo?: () => void;
  children: ReactNode;
}) {
  const [mo, setMo] = useState(!!moSan);
  const bat = useCallback(() => {
    setMo((v) => {
      // Goi khi VUA mo: muc lich su chi hoi may chu luc nguoi dung thuc su xem,
      // khong phai moi lan node ve lai.
      if (!v) khiMo?.();
      return !v;
    });
  }, [khiMo]);
  return (
    <div className="image-node__api-muc">
      <button
        type="button"
        className="image-node__api-mo"
        onClick={(e) => { e.stopPropagation(); bat(); }}
        aria-expanded={mo}
      >
        {mo ? "▾" : "▸"} {nhan}
      </button>
      {mo ? <div className="image-node__api-than">{children}</div> : null}
    </div>
  );
}

export function NodeApiPanel({
  cacTuyen,
  oTrongKhuon,
  nodeTrongKhuon,
  thanMotNode,
  lichSu,
  dangTaiLichSu,
  taiLichSu,
}: NodeApiPanelProps) {
  const { t } = useI18n();
  return (
    <div className="image-node__api nodrag">
      <Muc nhan={t("node.wfApiSecCalls", { count: cacTuyen.length })}>
        {cacTuyen.map((tuyen) => (
          <div key={tuyen.duong} className="image-node__api-tuyen">
            <code className="image-node__api-duong">{tuyen.duong}</code>
            <span className="image-node__api-ghi">{tuyen.ghiChu}</span>
            <button
              type="button"
              className="image-node__api-chep"
              title={t("node.wfApiCopy")}
              onClick={(e) => { e.stopPropagation(); chep(tuyen.lenh); }}
            >
              {t("node.wfApiCopyNode")}
            </button>
          </div>
        ))}
      </Muc>

      {oTrongKhuon.length ? (
        <Muc nhan={t("node.wfApiSecInputs", { count: oTrongKhuon.length })}>
          <div className="image-node__api-o">
            {t("node.wfApiInputs", { names: oTrongKhuon.join(", ") })}
          </div>
        </Muc>
      ) : null}

      {/* Noi dung that nam o cac node phia sau chu khong o moc BAT DAU, nen
          phai doc duoc tai cho - khong thi phai bam tung node moi biet co gi. */}
      {nodeTrongKhuon.length ? (
        <Muc nhan={t("node.wfApiSecNodes", { count: nodeTrongKhuon.length })}>
          {nodeTrongKhuon.map((n) => (
            <div key={n.id} className="image-node__api-node-muc">
              <div className="image-node__api-node-dau">
                <code className="image-node__api-node-ma">{n.id}</code>
                {n.vaiTro ? <span className="image-node__api-node-vai">{n.vaiTro}</span> : null}
                {/* Node dang co anh dinh san thi gan nhu chac chan la cho nguoi
                    goi se truyen anh vao. */}
                {n.soAnh > 0 ? (
                  <span className="image-node__api-node-anh">
                    {t("node.wfApiNodeImages", { count: n.soAnh })}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="image-node__api-chep"
                  title={t("node.wfApiCopyNodeTitle")}
                  onClick={(e) => { e.stopPropagation(); chep(thanMotNode(n)); }}
                >
                  {t("node.wfApiCopyNode")}
                </button>
              </div>
              <pre className="image-node__api-than-node">
                {n.prompt || t("node.wfApiNoPrompt")}
              </pre>
            </div>
          ))}
        </Muc>
      ) : null}

      {/* Mot khuon goi qua API chay o may chu, co the luc nguoi dung khong mo
          trinh duyet. Khong ke lai thi ho khong biet dem qua no chay nhung gi. */}
      <Muc nhan={t("node.wfApiSecRuns")} khiMo={taiLichSu}>
        {dangTaiLichSu ? <div className="image-node__api-o">…</div> : null}
        {lichSu && lichSu.length === 0 ? (
          <div className="image-node__api-o">{t("node.wfApiHistoryEmpty")}</div>
        ) : null}
        {(lichSu ?? []).map((l) => (
          <div
            key={l.id}
            className={`image-node__api-ls-dong image-node__api-ls-dong--${l.trangThai}`}
            title={l.loi ? `${l.loi.code}: ${l.loi.message}` : l.id}
          >
            <span className="image-node__api-ls-luc">
              {new Date(l.taoLuc).toLocaleString()}
            </span>
            <span className="image-node__api-ls-tt">{l.trangThai}</span>
            <span className="image-node__api-ls-so">
              {l.buoc.filter((b) => b.trangThai === "xong").length}/{l.buoc.length}
            </span>
          </div>
        ))}
      </Muc>
    </div>
  );
}
