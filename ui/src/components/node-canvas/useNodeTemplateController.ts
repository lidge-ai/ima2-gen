import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  createNodeTemplate,
  deleteNodeTemplate,
  instantiateNodeTemplate,
  listNodeTemplates,
  nhapTemplate,
  renameNodeTemplate,
  xuatTemplate,
} from "../../lib/api-node-templates";
import { commitGraphSnapshot, normalizeTemplateGraph } from "../../lib/nodeStudioGraph";
import type { GraphEdge, GraphNode } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import type { NodeTemplateSummary } from "./NodeTemplatePicker";

type TemplateOptions = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  fitView(options: { padding: number; duration: number }): Promise<boolean>;
  restoreFocus(): void;
  showToast(message: string, error?: boolean): void;
};

type TemplateSetters = {
  setTemplates: Dispatch<SetStateAction<NodeTemplateSummary[]>>;
  setTemplateError: Dispatch<SetStateAction<string | null>>;
};

export function useNodeTemplateState(options: TemplateOptions) {
  const { t } = useI18n();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<NodeTemplateSummary[]>([]);
  const openTemplates = useCallback(async () => {
    setTemplateOpen(true); setTemplateLoading(true); setTemplateError(null);
    try { setTemplates(await listNodeTemplates()); }
    catch { setTemplateError(t("nodeStudio.templates.loadError")); }
    finally { setTemplateLoading(false); }
  }, [t]);
  const copyTemplate = useCallback(async (template: NodeTemplateSummary) => {
    if (options.nodes.length > 0 && !window.confirm(t("nodeStudio.templates.replaceConfirm"))) return;
    setTemplateLoading(true); setTemplateError(null);
    try {
      const next = normalizeTemplateGraph(await instantiateNodeTemplate(template.id));
      if (!commitGraphSnapshot({ ...next, reason: "template" })) { setTemplateError(t("nodeStudio.templates.invalidGraph")); return; }
      setTemplateOpen(false); options.restoreFocus();
      requestAnimationFrame(() => void options.fitView({ padding: 0.16, duration: 180 }));
    } catch { setTemplateError(t("nodeStudio.templates.copyError")); }
    finally { setTemplateLoading(false); }
  }, [options, t]);
  return { templateOpen, templateLoading, templateError, templates, setTemplateOpen,
    openTemplates, copyTemplate, setters: { setTemplates, setTemplateError } };
}

/** Ten tep tai ve: bo dau va ky tu he dieu hanh khong nhan, giong ben may chu. */
function tenTep(name: string): string {
  // "Đ"/"đ" khong tach ra dau duoi NFD nhu cac nguyen am, nen phai doi tay:
  // khong thi "Đổi đồ" ra "oi-o", mat han chu cai dau.
  const goc = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${goc || "template"}.ima2-template.json`;
}

function luuTep(ten: string, noiDung: string): void {
  const url = URL.createObjectURL(new Blob([noiDung], { type: "application/json" }));
  try {
    const the = document.createElement("a");
    the.href = url; the.download = ten; the.click();
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Ma loi cua may chu -> cau noi cho nguoi dung.
 *
 * Viet thanh tung t("...") chu khong tra ve ten khoa roi goi t(ten): bo kiem
 * i18n doc duoc moi khoa tinh, nen khoa nao thieu ban dich la thay ngay.
 */
function loiNhap(t: (key: string) => string, ma: string | undefined): string {
  switch (ma) {
    case "TEMPLATE_FILE_KIND":
    case "TEMPLATE_FILE_INVALID": return t("nodeStudio.templates.importNotTemplate");
    case "TEMPLATE_FILE_VERSION": return t("nodeStudio.templates.importNewerVersion");
    case "TEMPLATE_FILE_TOO_LARGE": return t("nodeStudio.templates.importTooLarge");
    case "INVALID_TEMPLATE_GRAPH": return t("nodeStudio.templates.invalidGraph");
    case "INVALID_TEMPLATE_NAME": return t("nodeStudio.templates.importBadName");
    default: return t("nodeStudio.templates.importError");
  }
}

export function useNodeTemplateMutations(options: TemplateOptions, setters: TemplateSetters) {
  const { t } = useI18n();
  const saveTemplate = useCallback(async () => {
    const name = window.prompt(t("nodeStudio.templates.namePrompt"));
    if (!name?.trim()) return;
    try {
      const template = await createNodeTemplate({ name: name.trim(), graph: { nodes: options.nodes, edges: options.edges } });
      setters.setTemplates((current) => [...current.filter((item) => item.id !== template.id), template]);
      options.showToast(t("nodeStudio.templates.saved"));
    } catch { options.showToast(t("nodeStudio.templates.saveError"), true); }
  }, [options, setters, t]);
  const renameTemplate = useCallback(async (template: NodeTemplateSummary) => {
    const name = window.prompt(t("nodeStudio.templates.renamePrompt"), template.name);
    if (!name?.trim()) return;
    try {
      const updated = await renameNodeTemplate(template.id, name.trim());
      setters.setTemplates((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch { setters.setTemplateError(t("nodeStudio.templates.renameError")); }
  }, [setters, t]);
  const removeTemplate = useCallback(async (template: NodeTemplateSummary) => {
    try { await deleteNodeTemplate(template.id); setters.setTemplates((current) => current.filter((item) => item.id !== template.id)); }
    catch { setters.setTemplateError(t("nodeStudio.templates.deleteError")); }
  }, [setters, t]);
  /**
   * Xuat mot khuon ra tep.
   *
   * Template nam trong SQLite cua tung may, nen khong xuat duoc thi mot khuon
   * dung tay ca buoi chi song tren dung may do. Tep chi mang phan hinh khuon -
   * khong keo theo phien hay anh da sinh.
   */
  const exportTemplate = useCallback(async (template: NodeTemplateSummary) => {
    try {
      const tep = await xuatTemplate(template.id);
      luuTep(tenTep(template.name), JSON.stringify(tep, null, 2));
      options.showToast(t("nodeStudio.templates.exported", { name: template.name }));
    } catch { options.showToast(t("nodeStudio.templates.exportError"), true); }
  }, [options, t]);

  const importTemplate = useCallback(async (file: File) => {
    try {
      // Doc tai day thay vi day ca tep len: sai dinh dang thi bao duoc ngay,
      // va may chu chi nhan JSON nhu moi route khac.
      const tep: unknown = JSON.parse(await file.text());
      const template = await nhapTemplate(tep);
      setters.setTemplates((current) => [template, ...current.filter((item) => item.id !== template.id)]);
      options.showToast(t("nodeStudio.templates.imported", { name: template.name }));
    } catch (error) {
      // May chu tra ma loi noi RO tep sai o dau; dich duoc ma nao thi noi cai
      // do, con lai moi noi chung "khong nhap duoc".
      setters.setTemplateError(loiNhap(t, (error as { code?: string } | null)?.code));
    }
  }, [options, setters, t]);

  return { saveTemplate, renameTemplate, removeTemplate, exportTemplate, importTemplate };
}
