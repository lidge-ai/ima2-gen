import { useEffect, useState, type DragEvent } from "react";
import { elementPreviewPath, loadAllElementAssets } from "../../lib/elementMembership";
import { NODE_ELEMENT_MIME, type ElementDropPayload } from "../../lib/nodeStudioGraph";
import type { AssetItem } from "../../store/storeTypes";
import { useI18n } from "../../i18n";

export interface NodeElementTrayProps {
  disabled?: boolean;
  onAdd(element: AssetItem): void | Promise<void>;
}

function payloadFor(elementId: string): ElementDropPayload {
  return { version: 1, assetKind: "element", elementId };
}

function onDragStart(event: DragEvent<HTMLElement>, element: AssetItem): void {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(NODE_ELEMENT_MIME, JSON.stringify(payloadFor(element.id)));
}

/**
 * Khay Element dong san.
 *
 * Mo san thi no chiem mot goc canvas o moi phien lam viec, ke ca voi nguoi chua
 * luu element nao - luc do no chi hien mot dong "chua co element". Nho lua chon
 * trong localStorage: day la tien nghi cua tung nguoi tren tung may, khong phai
 * du lieu cua khuon.
 */
const KHOA_MO = "ima2.nodeElements.mo";

function docDaMo(): boolean {
  try { return localStorage.getItem(KHOA_MO) === "1"; } catch { return false; }
}

export function NodeElementTray({ disabled = false, onAdd }: NodeElementTrayProps) {
  const { t } = useI18n();
  const [elements, setElements] = useState<AssetItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [mo, setMo] = useState(docDaMo);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await loadAllElementAssets();
        if (active) { setElements(loaded); setState("ready"); }
      } catch {
        if (active) setState("error");
      }
    })();
    return () => { active = false; };
  }, []);

  const bat = () => setMo((v) => {
    try { localStorage.setItem(KHOA_MO, v ? "0" : "1"); } catch { /* rieng tu / chan luu: van dong mo duoc, chi khong nho. */ }
    return !v;
  });

  return <aside className={`node-element-tray${mo ? "" : " is-dong"}`} aria-label={t("nodeStudio.elements.ariaLabel")}>
    <header>
      <button type="button" className="node-element-tray__mo" onClick={bat} aria-expanded={mo}>
        {mo ? "▾" : "▸"} <strong>{t("nodeStudio.elements.title")}</strong>
        {state === "ready" && elements.length > 0 ? <span className="node-element-tray__so">{elements.length}</span> : null}
      </button>
      {mo ? <span>{t("nodeStudio.elements.hint")}</span> : null}
    </header>
    {!mo ? null : <>
    {state === "loading" ? <p role="status">{t("nodeStudio.elements.loading")}</p> : null}
    {state === "error" ? <p role="alert">{t("nodeStudio.elements.loadError")}</p> : null}
    {state === "ready" && elements.length === 0 ? <p>{t("nodeStudio.elements.empty")}</p> : null}
    <div className="node-element-tray__list">
      {elements.map((element) => {
        const preview = elementPreviewPath(element);
        return <article key={element.id} className="node-element-tray__item" draggable={!disabled} onDragStart={(event) => onDragStart(event, element)}>
          {preview ? <img src={`/generated/${preview.split("/").map(encodeURIComponent).join("/")}`} alt="" /> : <span className="node-element-tray__placeholder" aria-hidden="true" />}
          <span title={element.name}>{element.name}</span>
          <button type="button" disabled={disabled} onClick={() => void onAdd(element)}>{t("nodeStudio.elements.addToCanvas")}</button>
        </article>;
      })}
    </div>
    </>}
  </aside>;
}
