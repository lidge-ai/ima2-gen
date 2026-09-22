import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { useI18n } from "../i18n";
import { useIsMobile } from "../hooks/useIsMobile";
import { ElementReferenceNode } from "./node-canvas/ElementReferenceNode";
import { NodeCanvasEmptyState } from "./node-canvas/NodeCanvasEmptyState";
import { NodeStudioOverlays } from "./node-canvas/NodeStudioOverlays";
import { useNodeStudioController } from "./node-canvas/useNodeStudioController";
import { laCanhThuTu } from "../lib/canhAnh";
import { subscribe } from "../lib/eventChannel";
import { WF_KENH } from "../../../lib/wfEvents.js";

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

  // Mot he thong khac co the goi API kich hoat khuon bat cu luc nao. Nghe kenh
  // su kien chung de thay no chay ngay tren canvas, thay vi hoi lien tuc hay de
  // nguoi dung tu tai lai trang moi biet.
  const nhanSuKienWf = useAppStore((s) => s.nhanSuKienWf);
  useEffect(
    () => subscribe(WF_KENH, null, (suKien, du) => nhanSuKienWf(suKien, du)),
    [nhanSuKienWf],
  );

  const nodeTypes = useMemo(() => ({
    imageNode: ImageNode,
    elementReferenceNode: ElementReferenceNode,
  }), []);

  // Nhan tren canh: khi mot node nhan NHIEU nguon thi vai tro tung canh khac hau:
  // canh dau la ANH GOC dem di sua, cac canh sau chi gop ANH lam tham chieu.
  // Nhin hai duong cong giong het nhau thi khong doan duoc, nen danh dau ra.
  const labelledEdges = useMemo(() => {
    const incomingCount = new Map<string, number>();
    for (const edge of edges) {
      // Canh tu node MOC chi dinh thu tu chay - dem no vao day thi mot node
      // co dung mot anh cha van bi gan nhan "base/ref" nhu the co hai.
      if (laCanhThuTu(edge, nodes)) continue;
      incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    }
    const seenTarget = new Set<string>();
    return edges.map((edge) => {
      if (laCanhThuTu(edge, nodes)) return edge;
      const isBase = !seenTarget.has(edge.target);
      seenTarget.add(edge.target);
      // Mot cha thi khong can nhan - khong co gi de nham lan.
      if ((incomingCount.get(edge.target) ?? 0) < 2) return edge;
      return {
        ...edge,
        label: isBase ? t("edge.roleBase") : t("edge.roleRef"),
        labelBgPadding: [6, 3] as [number, number],
        labelBgStyle: { fill: isBase ? "var(--accent, #6b7cff)" : "var(--node-canvas-grid, #9aa0aa)", opacity: 0.92 },
        labelStyle: { fill: "#fff", fontSize: 11, fontWeight: 600 },
        style: isBase ? undefined : { strokeDasharray: "6 4" },
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
