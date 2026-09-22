import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import {
  danhSachKhuon,
  huyLuotChayApi,
  lichSuChung,
  type WfKhuonApi,
  type WfLuotApi,
} from "../../lib/wfApi";

/**
 * Bang Runner: moi khuon dang co, va moi lan goi vao chung.
 *
 * Mot khuon co the duoc kich hoat tu he thong khac bat cu luc nao, ke ca khi
 * khong ai mo trinh duyet. O API tren node BAT DAU chi ke duoc lich su cua
 * CHINH no, va chi khi dang mo dung phien do - nen van thieu mot cho nhin duoc
 * toan canh: khuon nao dang co, lan goi nao vua chay, chay ra cai gi.
 */
export function WfRunnerPanel({ onClose }: { onClose(): void }) {
  const { t } = useI18n();
  const switchSession = useAppStore((s) => s.switchSession);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showToast = useAppStore((s) => s.showToast);
  // Luot chay do may chu dieu khien. Khi mot luot ket thuc, danh sach vua co
  // them mot dong - tai lai dung luc do thay vi hoi lien tuc.
  const wfApiChay = useAppStore((s) => s.wfApiChay);
  const soDangChay = Object.keys(wfApiChay).length;

  const [khuon, setKhuon] = useState<WfKhuonApi[]>([]);
  const [luot, setLuot] = useState<WfLuotApi[]>([]);
  const [dangTai, setDangTai] = useState(false);
  const [loc, setLoc] = useState<{ sessionId: string; startNodeId: string } | null>(null);
  const [moRong, setMoRong] = useState<string | null>(null);

  const tai = useCallback(async () => {
    setDangTai(true);
    try {
      const [k, l] = await Promise.all([
        danhSachKhuon(),
        lichSuChung({ ...(loc ?? {}), gioiHan: 30 }),
      ]);
      setKhuon(k);
      setLuot(l);
    } catch (e) {
      showToast(String((e as Error).message || e), true);
    } finally {
      setDangTai(false);
    }
  }, [loc, showToast]);

  useEffect(() => { void tai(); }, [tai, soDangChay]);

  /** Ten phien theo id - de dong luot chay noi ro no thuoc khuon nao. */
  const tenPhien = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of khuon) if (k.title) m.set(k.sessionId, k.title);
    return m;
  }, [khuon]);

  const dangChayTheoKhuon = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of Object.values(wfApiChay)) {
      m.set(`${r.sessionId}/${r.startNodeId}`, (m.get(`${r.sessionId}/${r.startNodeId}`) ?? 0) + 1);
    }
    return m;
  }, [wfApiChay]);

  const moPhien = useCallback(async (sessionId: string) => {
    if (sessionId === activeSessionId) { onClose(); return; }
    try { await switchSession(sessionId); onClose(); }
    catch (e) { showToast(String((e as Error).message || e), true); }
  }, [activeSessionId, switchSession, onClose, showToast]);

  return (
    <div className="wf-runner" role="dialog" aria-modal="true" aria-labelledby="wf-runner-title">
      <div className="wf-runner__dau">
        <h2 id="wf-runner-title" className="wf-runner__tieu">{t("runner.title")}</h2>
        <button type="button" onClick={() => void tai()} disabled={dangTai}>
          {dangTai ? t("runner.loading") : t("runner.refresh")}
        </button>
        <button type="button" onClick={onClose} aria-label={t("runner.close")}>×</button>
      </div>

      <div className="wf-runner__than">
        <section className="wf-runner__cot">
          <h3 className="wf-runner__nhan">{t("runner.workflows", { count: khuon.length })}</h3>
          {khuon.length === 0 ? (
            <p className="wf-runner__trong">{t("runner.noWorkflow")}</p>
          ) : null}
          {khuon.map((k) => {
            const dangChay = dangChayTheoKhuon.get(`${k.sessionId}/${k.startNodeId}`) ?? 0;
            const dangLoc = loc?.sessionId === k.sessionId && loc?.startNodeId === k.startNodeId;
            return (
              <div key={`${k.sessionId}/${k.startNodeId}`} className={`wf-runner__khuon${dangLoc ? " is-loc" : ""}`}>
                <div className="wf-runner__khuon-dau">
                  <span className="wf-runner__khuon-ten">{k.title || k.sessionId}</span>
                  {dangChay > 0 ? (
                    <span className="wf-runner__chay">{t("runner.running", { count: dangChay })}</span>
                  ) : null}
                </div>
                <code className="wf-runner__duong">POST {k.path}</code>
                <div className="wf-runner__khuon-tt">
                  {k.ready
                    ? t("runner.steps", { count: k.steps ?? 0 })
                    : t(`node.wfErr.${k.reason ?? "thieu-ket-thuc"}`)}
                </div>
                <div className="wf-runner__nut">
                  <button type="button" onClick={() => void moPhien(k.sessionId)}>
                    {t("runner.open")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoc(dangLoc ? null : { sessionId: k.sessionId, startNodeId: k.startNodeId })}
                  >
                    {dangLoc ? t("runner.filterOff") : t("runner.filterOn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(`${window.location.origin}${k.path}`)}
                  >
                    {t("runner.copyUrl")}
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <section className="wf-runner__cot wf-runner__cot--luot">
          <h3 className="wf-runner__nhan">
            {t("runner.runs", { count: luot.length })}
            {loc ? ` · ${loc.startNodeId}` : ""}
          </h3>
          {luot.length === 0 ? (
            <p className="wf-runner__trong">{t("runner.noRun")}</p>
          ) : null}
          {luot.map((l) => {
            const xong = l.buoc.filter((b) => b.trangThai === "xong").length;
            const mo = moRong === l.id;
            return (
              <div key={l.id} className={`wf-runner__luot wf-runner__luot--${l.trangThai}`}>
                <button
                  type="button"
                  className="wf-runner__luot-dau"
                  onClick={() => setMoRong(mo ? null : l.id)}
                  aria-expanded={mo}
                >
                  <span className="wf-runner__tt">{l.trangThai}</span>
                  <span className="wf-runner__luc">
                    {new Date(l.taoLuc).toLocaleString()}
                    {tenPhien.get(l.sessionId) ? ` · ${tenPhien.get(l.sessionId)}` : ""}
                  </span>
                  <span className="wf-runner__so">{xong}/{l.buoc.length}</span>
                </button>
                {mo ? (
                  <div className="wf-runner__chitiet">
                    <code className="wf-runner__ma">{l.id}</code>
                    {l.loi ? (
                      <div className="wf-runner__loi">{l.loi.code}: {l.loi.message}</div>
                    ) : null}
                    {Object.keys(l.inputs ?? {}).length ? (
                      <pre className="wf-runner__vao">{JSON.stringify(l.inputs, null, 2)}</pre>
                    ) : null}
                    <div className="wf-runner__buoc">
                      {l.buoc.map((b) => (
                        <div key={b.nodeId} className={`wf-runner__mot-buoc wf-runner__mot-buoc--${b.trangThai}`}>
                          {b.url ? (
                            b.loai === "video"
                              ? <video src={b.url} muted playsInline preload="metadata" />
                              : <img src={b.url} alt={b.nodeId} />
                          ) : <span className="wf-runner__khong-anh" />}
                          <span className="wf-runner__buoc-ma">{b.nodeId}</span>
                          <span className="wf-runner__buoc-tt">{b.loi ?? b.trangThai}</span>
                        </div>
                      ))}
                    </div>
                    <div className="wf-runner__nut">
                      {/* Ket qua cua luot chay duoc ghi vao graph cua phien, nen
                          xem no chay den dau thi mo dung phien do ra canvas -
                          node dang sinh sang vien va anh hien ra tung cai mot. */}
                      <button type="button" onClick={() => void moPhien(l.sessionId)}>
                        {l.trangThai === "dang-chay" ? t("runner.watch") : t("runner.openRun")}
                      </button>
                      {l.trangThai === "dang-chay" ? (
                        <button
                          type="button"
                          className="wf-runner__dung"
                          onClick={() => void huyLuotChayApi(l.id)
                            .then(() => tai())
                            .catch((e) => showToast(String((e as Error).message || e), true))}
                        >
                          {t("node.wfStop")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
