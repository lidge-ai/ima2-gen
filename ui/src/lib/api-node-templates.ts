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

/**
 * Tep template de mang sang may khac. Chi chua phan hinh khuon - khong phien,
 * khong anh da sinh.
 */
export type TepTemplateDto = {
  kind: string;
  version: number;
  exportedAt: number;
  sourceId?: string;
  name: string;
  description: string;
  tags: string[];
  graph: NodeTemplateGraphDto;
};

export async function xuatTemplate(id: string): Promise<TepTemplateDto> {
  try {
    return await jsonFetch<TepTemplateDto>(
      `/api/node-templates/${encodeURIComponent(id)}/export`,
    );
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function nhapTemplate(tep: unknown): Promise<NodeTemplateSummary> {
  try {
    const response = await jsonFetch<{ template: NodeTemplateSummary }>(
      "/api/node-templates/import",
      { method: "POST", headers: jsonHeaders, body: JSON.stringify(tep) },
    );
    return response.template;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
