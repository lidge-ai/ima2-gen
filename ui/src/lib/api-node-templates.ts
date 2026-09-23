import type { GraphEdge, GraphNode } from "../store/storeTypes";
import type { NodeTemplateSummary } from "../components/node-canvas/NodeTemplatePicker";
import { jsonFetch } from "./api-core";

export type NodeTemplateGraphDto = {
  nodes: Array<Partial<GraphNode> & { id: string }>;
  edges: Array<Partial<GraphEdge> & { id: string; source: string; target: string }>;
  viewport?: { x: number; y: number; zoom: number };
};

const jsonHeaders = { "Content-Type": "application/json" };

export async function listNodeTemplates(): Promise<NodeTemplateSummary[]> {
  try {
    const response = await jsonFetch<{ templates: NodeTemplateSummary[] }>("/api/node-templates");
    return response.templates;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function createNodeTemplate(input: {
  name: string;
  description?: string;
  graph: NodeTemplateGraphDto;
}): Promise<NodeTemplateSummary> {
  try {
    const response = await jsonFetch<{ template: NodeTemplateSummary }>("/api/node-templates", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
    return response.template;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function instantiateNodeTemplate(id: string): Promise<NodeTemplateGraphDto> {
  try {
    const response = await jsonFetch<{ graph: NodeTemplateGraphDto }>(
      `/api/node-templates/${encodeURIComponent(id)}/instantiate`,
      { method: "POST" },
    );
    return response.graph;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function renameNodeTemplate(
  id: string,
  name: string,
): Promise<NodeTemplateSummary> {
  try {
    const response = await jsonFetch<{ template: NodeTemplateSummary }>(
      `/api/node-templates/${encodeURIComponent(id)}`,
      { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ name }) },
    );
    return response.template;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function deleteNodeTemplate(id: string): Promise<void> {
  try {
    await jsonFetch<{ ok: true }>(`/api/node-templates/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** The server enforces the same byte limit independently; this only avoids reading a huge file. */
export const NODE_TEMPLATE_FILE_MAX_BYTES = 2 * 1024 * 1024;

export type NodeTemplateFileDto = {
  kind: string;
  version: number;
  exportedAt: number;
  sourceId?: string;
  name: string;
  description: string;
  tags: string[];
  graph: NodeTemplateGraphDto;
};

export async function exportNodeTemplate(id: string): Promise<NodeTemplateFileDto> {
  return jsonFetch<NodeTemplateFileDto>(`/api/node-templates/${encodeURIComponent(id)}/export`);
}

/** Sends the file text as-is: the server parses and validates it at the file boundary. */
export async function importNodeTemplate(fileText: string): Promise<NodeTemplateSummary> {
  const response = await jsonFetch<{ template: NodeTemplateSummary }>("/api/node-templates/import", {
    method: "POST",
    headers: jsonHeaders,
    body: fileText,
  });
  return response.template;
}

export { nodeTemplateFileName } from "./nodeTemplateFileName";
