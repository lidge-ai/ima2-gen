import { type ReactNode } from "react";
import { Panel } from "@xyflow/react";
import { useI18n } from "../../i18n";
import { useModalFocus } from "../../hooks/useModalFocus";
import type { useNodeStudioController } from "./useNodeStudioController";
import { NodeBranchDialog } from "./NodeBranchDialog";
import { NodeCommandPalette } from "./NodeCommandPalette";
import { NodeElementTray } from "./NodeElementTray";
import { NodeTemplatePicker } from "./NodeTemplatePicker";

type StudioController = ReturnType<typeof useNodeStudioController>;

export interface NodeStudioOverlaysProps {
  studio: StudioController;
  graphEmpty: boolean;
  disabled: boolean;
  onAddRoot(): void;
}

function DialogFrame({ children, onClose }: { children: ReactNode; onClose(): void }) {
  const ref = useModalFocus<HTMLDivElement>(true, onClose);
  return <div ref={ref} className="node-studio-dialog-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>{children}</div>;
}

export function NodeStudioOverlays({ studio, graphEmpty, disabled, onAddRoot }: NodeStudioOverlaysProps) {
  const { t } = useI18n();
  return <>
    <Panel position="top-right" className="node-studio-toolbar">
      <button type="button" disabled={disabled} onClick={onAddRoot}>{t("nodeStudio.toolbar.addImage")}</button>
      <button type="button" disabled={disabled} onClick={studio.openTemplates}>{t("nodeStudio.toolbar.templates")}</button>
      <button type="button" disabled={disabled || graphEmpty} onClick={studio.saveTemplate}>{t("nodeStudio.toolbar.saveTemplate")}</button>
      <button type="button" disabled={disabled || !studio.selectedSource} onClick={studio.openBranch}>{t("nodeStudio.toolbar.branch")}</button>
    </Panel>
    <Panel position="top-left" className="node-studio-element-panel">
      <NodeElementTray disabled={disabled} onAdd={studio.addElement} />
    </Panel>
    <NodeCommandPalette open={Boolean(studio.palette)} anchor={studio.palette?.anchor ?? { clientX: 0, clientY: 0 }} sourcePort={studio.palette?.sourcePort} commands={studio.commands} onInsert={studio.insertCommand} onClose={studio.closePalette} />
    {studio.templateOpen ? <DialogFrame onClose={studio.closeOverlays}><NodeTemplatePicker templates={studio.templates} loading={studio.templateLoading} error={studio.templateError} importError={studio.importError} onCopy={studio.copyTemplate} onRename={studio.renameTemplate} onDelete={studio.removeTemplate} onExport={studio.exportTemplate} onImport={studio.importTemplate} onClose={studio.closeOverlays} /></DialogFrame> : null}
    {studio.branchOpen && studio.selectedSource ? <DialogFrame onClose={studio.closeOverlays}><div role="dialog" aria-modal="true" aria-labelledby="node-branch-dialog-title"><NodeBranchDialog sourceLabel={studio.selectedSource.data.prompt || studio.selectedSource.id} onApply={studio.applyBranch} onClose={studio.closeOverlays} /></div></DialogFrame> : null}
    <div className="node-studio-status" role="status" aria-live="polite" aria-atomic="true">{studio.status}</div>
  </>;
}
