import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  ConnectionMode,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppStore, type GraphNode, type GraphEdge } from "../store/useAppStore";
import { ImageNode } from "./ImageNode";
import { NodeBatchBar } from "./NodeBatchBar";
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";
import { ElementReferenceNode } from "./node-canvas/ElementReferenceNode";
import { NodeCanvasEmptyState } from "./node-canvas/NodeCanvasEmptyState";
import { NodeStudioOverlays } from "./node-canvas/NodeStudioOverlays";
import { useNodeStudioController } from "./node-canvas/useNodeStudioController";
import { getImageParentEdges } from "../lib/nodeGraph";

function NodeCanvasInner() {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const nodes = useAppStore((s) => s.graphNodes);
  const edges = useAppStore((s) => s.graphEdges);
  const setGraphNodes = useAppStore((s) => s.setGraphNodes);
  const setGraphEdges = useAppStore((s) => s.setGraphEdges);
  const disconnectEdges = useAppStore((s) => s.disconnectEdges);
  const addRootNode = useAppStore((s) => s.addRootNode);
  const deleteNodes = useAppStore((s) => s.deleteNodes);
  const nodeSelectionMode = useAppStore((s) => s.nodeSelectionMode);
  const selectNodeGraph = useAppStore((s) => s.selectNodeGraph);
  const sessionLoading = useAppStore((s) => s.sessionLoading);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const studio = useNodeStudioController(wrapperRef);

  const nodeTypes = useMemo(() => ({
    imageNode: ImageNode,
    elementReferenceNode: ElementReferenceNode,
  }), []);

  const labelledEdges = useMemo(() => {
    const imageEdges = getImageParentEdges(nodes, edges);
    const incomingCount = new Map<string, number>();
    const imageEdgeIds = new Set(imageEdges.map((edge) => edge.id));
    for (const edge of imageEdges) {
      incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    }
    const seenTargets = new Set<string>();
    return edges.map((edge) => {
      if (!imageEdgeIds.has(edge.id)) return edge;
      const isBase = !seenTargets.has(edge.target);
      seenTargets.add(edge.target);
      if ((incomingCount.get(edge.target) ?? 0) < 2) return edge;
      return {
        ...edge,
        label: t(isBase ? "edge.roleBase" : "edge.roleRef"),
        labelBgPadding: [6, 3] as [number, number],
        labelBgStyle: {
          fill: isBase ? "var(--accent, #6b7cff)" : "var(--node-canvas-grid, #9aa0aa)",
          opacity: 0.92,
        },
        labelStyle: { fill: "#fff", fontSize: 11, fontWeight: 600 },
        style: isBase ? edge.style : { ...edge.style, strokeDasharray: "6 4" },
      };
    });
  }, [edges, nodes, t]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setGraphNodes(applyNodeChanges(changes, nodes) as GraphNode[]),
    [nodes, setGraphNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removedEdgeIds = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id);
      if (removedEdgeIds.length > 0) {
        if (nodeSelectionMode) return;
        disconnectEdges(removedEdgeIds);
        return;
      }
      setGraphEdges(applyEdgeChanges(changes, edges) as GraphEdge[]);
    },
    [disconnectEdges, edges, nodeSelectionMode, setGraphEdges],
  );

  const onNodesDelete = useCallback(
    (deleted: GraphNode[]) => deleteNodes(deleted.map((n) => n.id)),
    [deleteNodes],
  );
  const onNodeClick: NodeMouseHandler<GraphNode> = useCallback(
    (event, node) => {
      if (!nodeSelectionMode) return;
      event.preventDefault();
      selectNodeGraph(node.id, event.metaKey || event.ctrlKey);
    },
    [nodeSelectionMode, selectNodeGraph],
  );

  return (
    <main
      className={`node-canvas${nodes.length === 0 ? " node-canvas--empty" : ""}`}
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={studio.onKeyDown}
    >
      {sessionLoading && <div className="node-canvas__loading">{t("nodeCanvas.loading")}</div>}
      <ReactFlow
            nodes={nodes}
            edges={labelledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={studio.onConnect}
            onConnectEnd={studio.onConnectEnd}
            isValidConnection={studio.isValidConnection}
            onDragOver={studio.onDragOver}
            onDrop={studio.onDropElement}
            onNodesDelete={onNodesDelete}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={32}
            selectionOnDrag={nodeSelectionMode}
            multiSelectionKeyCode={nodeSelectionMode ? null : undefined}
            panOnDrag={nodeSelectionMode ? [2] : true}
            fitView
            deleteKeyCode={nodeSelectionMode ? null : ["Delete", "Backspace"]}
            proOptions={{ hideAttribution: true }}
          >
            {nodes.length === 0 ? <div className="node-studio-empty-overlay"><NodeCanvasEmptyState hasRecentGraph={studio.hasRecentGraph} onStartBlank={() => { if (!sessionLoading) addRootNode(); }} onOpenTemplates={studio.openTemplates} onResumeRecent={studio.resumeRecent} /></div> : null}
            {nodes.length > 0 ? <NodeBatchBar /> : null}
            <NodeStudioOverlays studio={studio} graphEmpty={nodes.length === 0} disabled={sessionLoading} onAddRoot={() => addRootNode()} />
            <Background
              gap={24}
              size={1.6}
              color="var(--node-canvas-grid)"
              variant={BackgroundVariant.Dots}
            />
            <Controls className="node-canvas__controls" />
            {!isMobile && (
              <MiniMap
                pannable
                zoomable
                maskColor="var(--minimap-mask)"
                nodeColor="var(--minimap-node-fill)"
                nodeStrokeColor="var(--minimap-node-stroke)"
                style={{
                  background: "var(--minimap-bg)",
                  border: "1px solid var(--minimap-border)",
                }}
              />
            )}
          </ReactFlow>
      {nodes.length > 0 ? (
        <>
          <button
            type="button"
            className="node-canvas__add-root"
            onClick={() => addRootNode()}
            title={t("nodeCanvas.addRootTitle")}
          >
            +
          </button>
          <div className="node-canvas__hint">
            {t("nodeCanvas.hint")}
          </div>
        </>
      ) : null}
    </main>
  );
}

export function NodeCanvas() {
  return (
    <ReactFlowProvider>
      <NodeCanvasInner />
    </ReactFlowProvider>
  );
}
