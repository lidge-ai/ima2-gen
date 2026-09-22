import { useCallback, useState } from "react";
import type { Connection, OnConnectEnd } from "@xyflow/react";
import { canConnectPorts, type CompatibilityResult, type PortDescriptor } from "../../lib/nodeCompatibility";
import { isValidFlowConnection, normalizeFlowConnection, type FlowConnectionLike } from "../../lib/nodeConnectionValidation";
import { resolveNodePort } from "../../lib/nodePortCatalog";
import { buildPaletteInsertion, commitGraphSnapshot } from "../../lib/nodeStudioGraph";
import type { GraphEdge, GraphNode } from "../../store/useAppStore";
import type { NodeCommandDescriptor } from "./NodeCommandPalette";

export type PaletteState = {
  anchor: { clientX: number; clientY: number };
  sourcePort?: PortDescriptor;
} | null;

type Options = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  connectNodes(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): void;
  screenToFlowPosition(point: { x: number; y: number }): { x: number; y: number };
  surfaceReason(reason: CompatibilityResult["reason"] | "UNKNOWN_PORT"): void;
  restoreFocus(): void;
};

function clientPoint(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } {
  return "changedTouches" in event
    ? { clientX: event.changedTouches[0].clientX, clientY: event.changedTouches[0].clientY }
    : { clientX: event.clientX, clientY: event.clientY };
}

export function useNodeConnectionController(options: Options) {
  const [palette, setPalette] = useState<PaletteState>(null);
  const isValidConnection = useCallback(
    (connection: FlowConnectionLike) => isValidFlowConnection(connection, options.nodes, options.edges),
    [options],
  );
  const onConnect = useCallback((rawConnection: Connection) => {
    const connection = normalizeFlowConnection(rawConnection, options.nodes);
    const sourceNode = options.nodes.find((node) => node.id === connection.source);
    const targetNode = options.nodes.find((node) => node.id === connection.target);
    const source = sourceNode ? resolveNodePort(sourceNode, connection.sourceHandle, "output") : null;
    const target = targetNode ? resolveNodePort(targetNode, connection.targetHandle, "input") : null;
    if (!source || !target) { options.surfaceReason("UNKNOWN_PORT"); return; }
    const verdict = canConnectPorts(source, target, { nodes: options.nodes, edges: options.edges });
    if (!verdict.allowed) { options.surfaceReason(verdict.reason); return; }
    options.connectNodes(connection.source, connection.target, connection.sourceHandle, connection.targetHandle);
  }, [options]);
  const onConnectEnd: OnConnectEnd = useCallback((event, state) => {
    if (state.isValid || state.toNode || state.toHandle) return;
    const node = state.fromNode ? options.nodes.find((item) => item.id === state.fromNode?.id) : null;
    const sourcePort = node ? resolveNodePort(node, state.fromHandle?.id, "output") : null;
    if (!sourcePort) { options.surfaceReason("UNKNOWN_PORT"); return; }
    setPalette({ anchor: clientPoint(event), sourcePort });
  }, [options]);
  const insertCommand = useCallback((command: NodeCommandDescriptor) => {
    if (command.type !== "image-generate" || !palette) return;
    const position = options.screenToFlowPosition({ x: palette.anchor.clientX, y: palette.anchor.clientY });
    const next = buildPaletteInsertion({ graph: { nodes: options.nodes, edges: options.edges }, position, sourcePort: palette.sourcePort });
    if (!commitGraphSnapshot({ ...next, reason: "palette" })) { options.surfaceReason("UNKNOWN_PORT"); return; }
    setPalette(null); options.restoreFocus();
  }, [options, palette]);
  return { palette, setPalette, onConnect, onConnectEnd, insertCommand, isValidConnection };
}
