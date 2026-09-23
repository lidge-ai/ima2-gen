import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "../../i18n";

export type NodeTemplateSource = "seed" | "user";

export interface NodeTemplateSummary {
  id: string;
  name: string;
  description: string;
  source: NodeTemplateSource;
  tags: readonly string[];
  nodeCount: number;
  terminalCount: number;
  preview?: readonly { id: string; x: number; y: number; label?: string }[];
}

export interface NodeTemplatePickerProps {
  templates: readonly NodeTemplateSummary[];
  loading?: boolean;
  error?: string | null;
  onCopy(template: NodeTemplateSummary): void | Promise<void>;
  onClose(): void;
  onRename?(template: NodeTemplateSummary): void;
  onDelete?(template: NodeTemplateSummary): void;
  onExport?(template: NodeTemplateSummary): void;
  onImport?(file: File): void;
  /** Shown next to the import action; never replaces the template list. */
  importError?: string | null;
}

function matches(template: NodeTemplateSummary, query: string) {
  const value = query.toLocaleLowerCase();
  return [template.name, ...template.tags].some((part) => part.toLocaleLowerCase().includes(value));
}

function MiniGraph({ template }: { template: NodeTemplateSummary }) {
  const { t } = useI18n();
  const nodes = template.preview ?? [];
  return (
    <div className="node-template-picker__preview" aria-label={t("nodeStudio.templates.previewAria", { name: template.name })}>
      {nodes.length ? nodes.map((node) => (
        <span key={node.id} className="node-template-picker__preview-node" style={{ left: `${node.x}%`, top: `${node.y}%` }}>
          {node.label}
        </span>
      )) : <span className="node-template-picker__preview-empty">{t(template.nodeCount === 1 ? "nodeStudio.templates.nodeCountOne" : "nodeStudio.templates.nodeCount", { count: template.nodeCount })}</span>}
    </div>
  );
}

function TemplateCard({ template, selected, onSelect, onRename, onDelete, onExport }: {
  template: NodeTemplateSummary;
  selected: boolean;
  onSelect(): void;
  onRename?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
}) {
  const { t } = useI18n();
  const userActions = template.source === "user" && (onRename || onDelete);
  return (
    <article className={`node-template-picker__card${selected ? " is-selected" : ""}`}>
      <button type="button" className="node-template-picker__card-main" onClick={onSelect} onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); onSelect(); }
      }} aria-pressed={selected}>
        <MiniGraph template={template} />
        <span className="node-template-picker__card-copy">
          <strong>{template.name}</strong>
          <span>{template.description}</span>
          <small>{t(template.nodeCount === 1 ? "nodeStudio.templates.nodeCountOne" : "nodeStudio.templates.nodeCount", { count: template.nodeCount })} · {t(template.terminalCount === 1 ? "nodeStudio.templates.outputCountOne" : "nodeStudio.templates.outputCount", { count: template.terminalCount })}</small>
        </span>
      </button>
      <div className="node-template-picker__tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      {/* Starter templates export too: carrying one to another machine and editing it there is a real use. */}
      {onExport || userActions ? <div className="node-template-picker__card-actions">
        {onExport ? <button type="button" onClick={onExport}>{t("nodeStudio.templates.export")}</button> : null}
        {template.source === "user" && onRename ? <button type="button" onClick={onRename}>{t("nodeStudio.templates.rename")}</button> : null}
        {template.source === "user" && onDelete ? <button type="button" onClick={onDelete}>{t("nodeStudio.templates.delete")}</button> : null}
      </div> : null}
    </article>
  );
}

export function NodeTemplatePicker({ templates, loading = false, error = null, onCopy, onClose, onRename, onDelete, onExport, onImport, importError = null }: NodeTemplatePickerProps) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => templates.filter((template) => matches(template, query)), [query, templates]);
  const selected = filtered.find((template) => template.id === selectedId) ?? null;
  const seed = filtered.filter((template) => template.source === "seed");
  const user = filtered.filter((template) => template.source === "user");

  const confirmCopy = () => { if (selected) void onCopy(selected); };
  const pickFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires change.
    event.target.value = "";
    if (file) onImport?.(file);
  };
  const exportAction = (template: NodeTemplateSummary) => onExport ? () => onExport(template) : undefined;
  const remove = (template: NodeTemplateSummary) => {
    if (window.confirm(t("nodeStudio.templates.deleteConfirm", { name: template.name }))) onDelete?.(template);
  };

  return <section className="node-template-picker" role="dialog" aria-modal="true" aria-labelledby="node-template-picker-title">
    <header><div><p className="node-template-picker__eyebrow">{t("nodeStudio.name")}</p><h2 id="node-template-picker-title">{t("nodeStudio.templates.title")}</h2></div><button type="button" aria-label={t("nodeStudio.templates.close")} onClick={onClose}>×</button></header>
    <label className="node-template-picker__search"><span>{t("nodeStudio.templates.searchLabel")}</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("nodeStudio.templates.searchPlaceholder")} /></label>
    {loading ? <p className="node-template-picker__state" role="status">{t("nodeStudio.templates.loading")}</p> : null}
    {error ? <p className="node-template-picker__state is-error" role="alert">{error}</p> : null}
    {!loading && !error && filtered.length === 0 ? <p className="node-template-picker__state">{t("nodeStudio.templates.empty", { query })}</p> : null}
    {!loading && !error ? <div className="node-template-picker__sections">
      {seed.length ? <section><h3>{t("nodeStudio.templates.starter")}</h3><div className="node-template-picker__grid">{seed.map((template) => <TemplateCard key={template.id} template={template} selected={template.id === selectedId} onSelect={() => setSelectedId(template.id)} onExport={exportAction(template)} />)}</div></section> : null}
      {user.length ? <section><h3>{t("nodeStudio.templates.yours")}</h3><div className="node-template-picker__grid">{user.map((template) => <TemplateCard key={template.id} template={template} selected={template.id === selectedId} onSelect={() => setSelectedId(template.id)} onRename={onRename ? () => onRename(template) : undefined} onDelete={onDelete ? () => remove(template) : undefined} onExport={exportAction(template)} />)}</div></section> : null}
    </div> : null}
    {importError ? <p className="node-template-picker__state is-error" role="alert">{importError}</p> : null}
    <footer>
      {onImport ? <>
        <button type="button" title={t("nodeStudio.templates.importHint")} onClick={() => fileRef.current?.click()}>{t("nodeStudio.templates.import")}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={pickFile} aria-label={t("nodeStudio.templates.import")} />
      </> : null}
      <button type="button" onClick={onClose}>{t("nodeStudio.templates.cancel")}</button><button type="button" className="node-template-picker__copy" disabled={!selected} onClick={confirmCopy}>{t("nodeStudio.templates.copy")}</button>
    </footer>
  </section>;
}
