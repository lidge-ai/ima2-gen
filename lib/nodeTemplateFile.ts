/**
 * Doc va viet MOT TEP template de mang di may khac.
 *
 * Template dang nam trong SQLite cua tung may, nen mot khuon dung tay dung
 * xong khong co duong nao sang may thu hai: chep ca thu muc du lieu thi keo
 * theo moi phien va moi anh da sinh. Tep nay chi mang dung phan hinh khuon.
 *
 * Module THUAN TUY va la cho duy nhat dinh nghia dinh dang tep: may chu dung
 * khi xuat/nhap, va bo kiem dung cung ham nay - hai ban rieng se lech nhau roi
 * mot ban xuat ra tep ban kia khong doc duoc.
 */

import type { NodeTemplateGraph, NodeTemplateRecord } from "./nodeTemplateStore.js";

export const LOAI_TEP = "ima2.node-template";
export const PHIEN_BAN_TEP = 1;

/** Tran an toan. Tep tu ngoai vao nen khong duoc phep bat may chu dung mot khuon vo han. */
export const TOI_DA_NODE = 300;
export const TOI_DA_CANH = 1200;
export const TOI_DA_BYTE = 2 * 1024 * 1024;

export interface TepTemplate {
  kind: typeof LOAI_TEP;
  version: number;
  exportedAt: number;
  /** Ma goc chi de doi chieu; luc nhap may chu cap ma moi. */
  sourceId?: string | undefined;
  name: string;
  description: string;
  tags: string[];
  graph: NodeTemplateGraph;
}

export interface TemplateDaDoc {
  name: string;
  description: string;
  tags: string[];
  graph: NodeTemplateGraph;
}

function loi(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export function taoTepXuat(template: NodeTemplateRecord): TepTemplate {
  return {
    kind: LOAI_TEP,
    version: PHIEN_BAN_TEP,
    exportedAt: Date.now(),
    sourceId: template.id,
    name: template.name,
    description: template.description,
    tags: [...template.tags],
    graph: template.graph,
  };
}

/**
 * Ten tep tai ve. Bo dau va moi ky tu he dieu hanh khong nhan, vi ten template
 * la nguoi dung tu dat - dau tieng Viet va dau gach cheo deu co that o day.
 */
export function tenTepXuat(name: string): string {
  // "Đ"/"đ" khong tach ra dau duoi NFD nhu cac nguyen am, nen phai doi tay:
  // khong thi "Đổi đồ" ra "oi-o", mat han chu cai dau.
  const goc = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "d")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${goc || "template"}.ima2-template.json`;
}

export function docTepNhap(raw: unknown): TemplateDaDoc {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw loi(400, "TEMPLATE_FILE_INVALID", "template file must be a JSON object");
  }
  const tep = raw as Partial<TepTemplate>;
  if (tep.kind !== LOAI_TEP) {
    throw loi(400, "TEMPLATE_FILE_KIND", `not an ${LOAI_TEP} file`);
  }
  // Tep moi hon thi co the mang truong ma ban nay khong hieu: noi thang ra
  // thay vi nhap mot nua roi de nguoi dung tu doan sao khuon bi thieu.
  if (typeof tep.version !== "number" || tep.version > PHIEN_BAN_TEP) {
    throw loi(400, "TEMPLATE_FILE_VERSION", `unsupported template file version: ${String(tep.version)}`);
  }
  const name = typeof tep.name === "string" ? tep.name.trim() : "";
  if (!name || name.length > 80) {
    throw loi(400, "INVALID_TEMPLATE_NAME", "template name must be 1-80 characters");
  }
  const graph = tep.graph;
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw loi(400, "INVALID_TEMPLATE_GRAPH", "graph must contain nodes and edges arrays");
  }
  if (graph.nodes.length === 0) {
    throw loi(400, "INVALID_TEMPLATE_GRAPH", "graph must contain at least one node");
  }
  if (graph.nodes.length > TOI_DA_NODE || graph.edges.length > TOI_DA_CANH) {
    throw loi(413, "TEMPLATE_FILE_TOO_LARGE", `template file exceeds ${TOI_DA_NODE} nodes or ${TOI_DA_CANH} edges`);
  }
  return {
    name,
    description: typeof tep.description === "string" ? tep.description.trim() : "",
    tags: Array.isArray(tep.tags) ? tep.tags.filter((tag): tag is string => typeof tag === "string") : [],
    graph,
  };
}

/** Ten khong trung voi template dang co: nhap hai lan thi ra "... (2)", khong de len nhau. */
export function tenKhongTrung(name: string, dangCo: readonly string[]): string {
  const co = new Set(dangCo.map((ten) => ten.toLocaleLowerCase()));
  if (!co.has(name.toLocaleLowerCase())) return name;
  for (let i = 2; i < 100; i++) {
    const thu = `${name} (${i})`.slice(0, 80);
    if (!co.has(thu.toLocaleLowerCase())) return thu;
  }
  return name.slice(0, 74) + ` ${Date.now() % 1000}`;
}
