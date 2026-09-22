import type { GraphEdge, GraphNode } from "../store/storeTypes";
import { canConnectPorts } from "./nodeCompatibility";
import { resolveNodePort } from "./nodePortCatalog";

/** Shared shape of React Flow `Connection` and `Edge` for validation. */
export type FlowConnectionLike = {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

const IMAGE_SOURCE_HANDLE_PREFIX = "source-";
const IMAGE_TARGET_HANDLE_PREFIX = "target-";

/**
 * ImageNode draws a source and a target handle at the same spot, and only the source
 * handle receives the pointer (node-polish.css). In loose mode React Flow prefers the
 * handle under the pointer, so dropping on a node's visible dot yields a source-* target
 * handle. Map it to the target handle at the same position so validation and storage see
 * the input port the user meant. This does not decide validity.
 */
export function normalizeFlowConnection<T extends FlowConnectionLike>(
  connection: T,
  nodes: readonly GraphNode[],
): T {
  const handle = connection.targetHandle;
  if (!handle?.startsWith(IMAGE_SOURCE_HANDLE_PREFIX)) return connection;
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!targetNode || targetNode.type !== "imageNode") return connection;
  const inputHandle = IMAGE_TARGET_HANDLE_PREFIX + handle.slice(IMAGE_SOURCE_HANDLE_PREFIX.length);
  if (!resolveNodePort(targetNode, inputHandle, "input")) return connection;
  return { ...connection, targetHandle: inputHandle };
}

/**
 * Pure drag-time connection validator for React Flow's `isValidConnection`
 * (010_phase1 round2 fold-back #2). Resolves both ends through the port
 * catalog and delegates to canConnectPorts (which includes the CYCLE guard).
 * Unresolvable handles are invalid.
 */
export function isValidFlowConnection(
  rawConnection: FlowConnectionLike,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): boolean {
  const connection = normalizeFlowConnection(rawConnection, nodes);
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) return false;
  const source = resolveNodePort(sourceNode, connection.sourceHandle, "output");
  const target = resolveNodePort(targetNode, connection.targetHandle, "input");
  if (!source || !target) return false;
  return canConnectPorts(source, target, { nodes, edges }).allowed;
}
