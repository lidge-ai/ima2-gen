import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import {
  createNodeTemplate,
  deleteNodeTemplate,
  exportNodeTemplate,
  importNodeTemplate,
  instantiateNodeTemplate,
  listNodeTemplates,
  NODE_TEMPLATE_FILE_MAX_BYTES,
  nodeTemplateFileName,
  renameNodeTemplate,
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
  setImportError: Dispatch<SetStateAction<string | null>>;
};

export function useNodeTemplateState(options: TemplateOptions) {
  const { t } = useI18n();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<NodeTemplateSummary[]>([]);
  const openTemplates = useCallback(async () => {
    setTemplateOpen(true); setTemplateLoading(true); setTemplateError(null); setImportError(null);
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
  return { templateOpen, templateLoading, templateError, importError, templates, setTemplateOpen,
    openTemplates, copyTemplate, setters: { setTemplates, setTemplateError, setImportError } };
}

function downloadJson(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One literal t() call per code so the dictionary contract sees every key. */
function importErrorMessage(t: (key: string) => string, code: string | undefined): string {
  switch (code) {
    case "TEMPLATE_FILE_KIND":
    case "TEMPLATE_FILE_INVALID": return t("nodeStudio.templates.importNotTemplate");
    case "TEMPLATE_FILE_VERSION": return t("nodeStudio.templates.importNewerVersion");
    case "TEMPLATE_FILE_TOO_LARGE": return t("nodeStudio.templates.importTooLarge");
    case "INVALID_TEMPLATE_GRAPH": return t("nodeStudio.templates.importInvalidGraph");
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
  const exportTemplate = useCallback(async (template: NodeTemplateSummary) => {
    try {
      const file = await exportNodeTemplate(template.id);
      downloadJson(nodeTemplateFileName(template.name), JSON.stringify(file, null, 2));
      options.showToast(t("nodeStudio.templates.exported", { name: template.name }));
    } catch { options.showToast(t("nodeStudio.templates.exportError"), true); }
  }, [options, t]);
  const importTemplate = useCallback(async (file: File) => {
    if (file.size > NODE_TEMPLATE_FILE_MAX_BYTES) { setters.setImportError(t("nodeStudio.templates.importTooLarge")); return; }
    try {
      const template = await importNodeTemplate(await file.text());
      setters.setTemplates((current) => [template, ...current.filter((item) => item.id !== template.id)]);
      setters.setImportError(null);
      options.showToast(t("nodeStudio.templates.imported", { name: template.name }));
    } catch (error) {
      setters.setImportError(importErrorMessage(t, (error as { code?: string } | null)?.code));
    }
  }, [options, setters, t]);
  return { saveTemplate, renameTemplate, removeTemplate, exportTemplate, importTemplate };
}
