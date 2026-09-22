import type { GraphNode } from "../store/storeTypes";
import type { NodePortType, PortDescriptor } from "./nodeCompatibility";

const IMAGE_TARGET_HANDLES = [
  "target-top",
  "target-right",
  "target-bottom",
  "target-left",
] as const;
const IMAGE_SOURCE_HANDLES = [
  "source-top",
  "source-right",
  "source-bottom",
  "source-left",
] as const;

export type PortBinding = {
  nodeType: "imageNode" | "elementReferenceNode";
  flowHandleId: string;
  logicalPortId: string;
  direction: "input" | "output";
  type: NodePortType;
  acceptsMany: boolean;
  equivalentHandleIds: readonly string[];
};

export const NODE_PORT_BINDINGS: readonly PortBinding[] = [
  ...IMAGE_TARGET_HANDLES.map((flowHandleId) => ({
    nodeType: "imageNode" as const,
    flowHandleId,
    logicalPortId: "image-input",
    direction: "input" as const,
    type: "image" as const,
    acceptsMany: true,
    equivalentHandleIds: IMAGE_TARGET_HANDLES,
  })),
  ...IMAGE_SOURCE_HANDLES.map((flowHandleId) => ({
    nodeType: "imageNode" as const,
    flowHandleId,
    logicalPortId: "image-output",
    direction: "output" as const,
    type: "image" as const,
    acceptsMany: true,
    equivalentHandleIds: IMAGE_SOURCE_HANDLES,
  })),
  {
    nodeType: "elementReferenceNode",
    flowHandleId: "refs",
    logicalPortId: "element-refs-output",
    direction: "output",
    type: "element-refs",
    acceptsMany: true,
    equivalentHandleIds: ["refs"],
  },
  {
    nodeType: "elementReferenceNode",
    flowHandleId: "notes",
    logicalPortId: "element-notes-output",
    direction: "output",
    type: "element-notes",
    acceptsMany: true,
    equivalentHandleIds: ["notes"],
  },
];

export function resolveNodePort(
  node: GraphNode,
  flowHandleId: string | null | undefined,
  expectedDirection: "input" | "output",
): PortDescriptor | null {
  if (!flowHandleId) return null;
  const nodeType = node.type === "elementReferenceNode"
    ? "elementReferenceNode"
    : node.type === "imageNode"
      ? "imageNode"
      : null;
  if (!nodeType) return null;
  const binding = NODE_PORT_BINDINGS.find((entry) =>
    entry.nodeType === nodeType
    && entry.flowHandleId === flowHandleId
    && entry.direction === expectedDirection,
  );
  if (!binding) return null;
  return {
    nodeId: node.id,
    handleId: binding.flowHandleId,
    logicalPortId: binding.logicalPortId,
    equivalentHandleIds: binding.equivalentHandleIds,
    direction: binding.direction,
    type: binding.type,
    acceptsMany: binding.acceptsMany,
  };
}
