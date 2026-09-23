import { useCallback, useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";
import { NODE_STUDIO_COMMANDS } from "../../lib/nodeStudioCatalog";
import type { CompatibilityResult } from "../../lib/nodeCompatibility";
import { graphHistoryChord, paletteAnchor, shouldOpenNodePalette } from "../../lib/nodeStudioKeyboard";
import { useAppStore } from "../../store/useAppStore";
import { useI18n } from "../../i18n";
import type { NodeTemplateSummary } from "./NodeTemplatePicker";
import { useNodeBranchController } from "./useNodeBranchController";
import { useNodeConnectionController } from "./useNodeConnectionController";
import { useNodeElementController } from "./useNodeElementController";
import { useNodeTemplateMutations, useNodeTemplateState } from "./useNodeTemplateController";

type CompatibilityReason = NonNullable<CompatibilityResult["reason"]> | "UNKNOWN_PORT";

const COMPATIBILITY_REASON_KEYS: Record<CompatibilityReason, string> = {
  SAME_DIRECTION: "nodeStudio.compatibility.sameDirection",
  TYPE_MISMATCH: "nodeStudio.compatibility.typeMismatch",
  CARDINALITY: "nodeStudio.compatibility.cardinality",
  SELF_EDGE: "nodeStudio.compatibility.selfEdge",
  DUPLICATE_EDGE: "nodeStudio.compatibility.duplicateEdge",
  CYCLE: "nodeStudio.compatibility.cycle",
  UNKNOWN_PORT: "nodeStudio.compatibility.unknownPort",
};

export function useNodeStudioController(wrapperRef: RefObject<HTMLElement | null>) {
  const { t } = useI18n();
  const nodes = useAppStore((state) => state.graphNodes); const edges = useAppStore((state) => state.graphEdges);
  const sessions = useAppStore((state) => state.sessions); const activeSessionId = useAppStore((state) => state.activeSessionId);
  const switchSession = useAppStore((state) => state.switchSession); const connectNodes = useAppStore((state) => state.connectNodes);
  const undoGraph = useAppStore((state) => state.undoGraph); const redoGraph = useAppStore((state) => state.redoGraph);
  const showToast = useAppStore((state) => state.showToast); const { fitView, screenToFlowPosition } = useReactFlow();
  const [status, setStatus] = useState("");
  const restoreFocus = useCallback(() => requestAnimationFrame(() => wrapperRef.current?.focus()), [wrapperRef]);
  const surfaceReason = useCallback((reason: CompatibilityReason) => {
    const message = t(COMPATIBILITY_REASON_KEYS[reason]); setStatus(message); showToast(message, true);
  }, [showToast, t]);
  const shared = { nodes, edges, fitView, restoreFocus, showToast };
  const template = useNodeTemplateState(shared); const templateMutations = useNodeTemplateMutations(shared, template.setters);
  const connection = useNodeConnectionController({ nodes, edges, connectNodes, screenToFlowPosition, surfaceReason, restoreFocus });
  const branch = useNodeBranchController(shared);
  const element = useNodeElementController({ nodes, edges, wrapperRef, screenToFlowPosition, showToast });
  const recent = useMemo(() => sessions.filter((item) => item.id !== activeSessionId && item.nodeCount > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null, [activeSessionId, sessions]);
  const closeOverlays = useCallback(() => {
    connection.setPalette(null); template.setTemplateOpen(false); branch.setBranchOpen(false); restoreFocus();
  }, [branch.setBranchOpen, connection.setPalette, restoreFocus, template.setTemplateOpen]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const chord = graphHistoryChord(event);
    if (chord) {
      const handled = chord === "undo" ? undoGraph() : redoGraph();
      if (handled) {
        event.preventDefault();
        showToast(t(chord === "undo" ? "graph.undone" : "graph.redone"));
      }
      return;
    }
    if (event.key === "Escape" && (connection.palette || template.templateOpen || branch.branchOpen)) { event.preventDefault(); closeOverlays(); return; }
    if (!shouldOpenNodePalette(event, wrapperRef.current, nodes.length === 0)) return;
    event.preventDefault(); connection.setPalette({ anchor: paletteAnchor(wrapperRef.current) });
  }, [branch.branchOpen, closeOverlays, connection.palette, connection.setPalette, nodes.length, redoGraph, showToast, t, template.templateOpen, undoGraph, wrapperRef]);
  const resumeRecent = useCallback(async () => {
    if (!recent) return;
    try { await switchSession(recent.id); } catch { showToast(t("nodeStudio.empty.resumeError"), true); }
  }, [recent, showToast, switchSession, t]);
  return { commands: NODE_STUDIO_COMMANDS, ...connection, ...branch, ...element, ...template, status,
    hasRecentGraph: Boolean(recent), onKeyDown, resumeRecent, closeOverlays, closePalette: closeOverlays,
    openTemplates: () => void template.openTemplates(), saveTemplate: () => void templateMutations.saveTemplate(),
    copyTemplate: template.copyTemplate, renameTemplate: (item: NodeTemplateSummary) => void templateMutations.renameTemplate(item),
    removeTemplate: (item: NodeTemplateSummary) => void templateMutations.removeTemplate(item),
    exportTemplate: (item: NodeTemplateSummary) => void templateMutations.exportTemplate(item),
    importTemplate: (file: File) => void templateMutations.importTemplate(file),
    openBranch: () => branch.setBranchOpen(true) };
}
