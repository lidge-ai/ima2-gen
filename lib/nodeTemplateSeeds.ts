import type { NodeTemplateRecord } from "./nodeTemplateStore.js";
import { khuonThoiTrang } from "./nodeTemplateThoiTrang.js";

type Node = NodeTemplateRecord["graph"]["nodes"][number];
type Edge = NodeTemplateRecord["graph"]["edges"][number];

function node(id: string, kind: string, x: number, y: number, data: Record<string, unknown> = {}): Node {
  return { id, type: "imageNode", position: { x, y }, data: { kind, status: "idle", ...data } };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, sourceHandle: "output", targetHandle: "input" };
}

function seed(
  id: string,
  name: string,
  description: string,
  nodes: Node[],
  edges: Edge[],
  tags: string[],
  expectedTerminalResults: number,
  requiredPlaceholders: string[] = [],
): NodeTemplateRecord {
  return {
    id,
    name,
    description,
    source: "seed",
    graph: { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, manifest: { requiredPlaceholders, expectedTerminalResults } },
    tags,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

export const nodeTemplateSeeds: readonly NodeTemplateRecord[] = [
  // Kho khuon THOI TRANG dung truoc: dau vao mot bo do, dau ra nguoi mau mac bo
  // do do theo tung concept chup. Day la viec nguoi dung lam nhieu nhat.
  ...khuonThoiTrang,
  seed("seed-four-variations", "이미지 4변형 비교", "하나의 프롬프트를 네 가지 변형으로 비교합니다.", [
    node("prompt", "prompt", 0, 180, { prompt: "" }),
    ...[0, 1, 2, 3].flatMap((index) => [
      node(`generator-${index + 1}`, "generator", 300, index * 120, { variation: index + 1 }),
      node(`result-${index + 1}`, "result", 600, index * 120),
    ]),
  ], [
    ...[0, 1, 2, 3].flatMap((index) => [
      edge(`prompt-generator-${index + 1}`, "prompt", `generator-${index + 1}`),
      edge(`generator-result-${index + 1}`, `generator-${index + 1}`, `result-${index + 1}`),
    ]),
  ], ["compare", "image", "variations"], 4),
  seed("seed-reference-edit-i2v", "참조→편집→I2V", "참조 이미지를 편집하고 영상으로 확장합니다.", [
    node("reference", "reference", 0, 100, { media: { placeholder: "reference-image", unresolved: true } }),
    node("edit", "edit", 300, 100, { prompt: "" }),
    node("video", "video", 600, 100, { prompt: "" }),
  ], [edge("reference-edit", "reference", "edit"), edge("edit-video", "edit", "video")], ["edit", "i2v", "reference"], 1, ["reference-image"]),
  seed("seed-style-ab", "스타일 A/B", "동일한 프롬프트를 두 스타일로 비교합니다.", [
    node("prompt", "prompt", 0, 120, { prompt: "" }),
    node("style-a", "style", 280, 40, { style: "A" }),
    node("style-b", "style", 280, 200, { style: "B" }),
    node("result-a", "result", 560, 40),
    node("result-b", "result", 560, 200),
  ], [edge("prompt-a", "prompt", "style-a"), edge("prompt-b", "prompt", "style-b"), edge("a-result", "style-a", "result-a"), edge("b-result", "style-b", "result-b")], ["ab", "compare", "style"], 2),
  seed("seed-character-sheet", "캐릭터 시트", "하나의 요소를 네 가지 각도로 생성합니다.", [
    node("element", "element", 0, 180, { media: { placeholder: "character-element", unresolved: true } }),
    ...["front", "three-quarter", "side", "back"].flatMap((angle, index) => [
      node(`angle-${angle}`, "prompt", 280, index * 120, { prompt: `${angle} view` }),
      node(`result-${angle}`, "result", 560, index * 120),
    ]),
  ], [
    ...["front", "three-quarter", "side", "back"].flatMap((angle) => [edge(`element-${angle}`, "element", `angle-${angle}`), edge(`${angle}-result`, `angle-${angle}`, `result-${angle}`)]),
  ], ["character", "element", "sheet"], 4, ["character-element"]),
  seed("seed-provider-compare", "프로바이더 비교", "같은 입력을 GPT, Gemini, Grok에서 비교합니다.", [
    node("input", "prompt", 0, 120, { prompt: "" }),
    node("gpt", "generator", 300, 0, { provider: "openai" }),
    node("gemini", "generator", 300, 120, { provider: "gemini" }),
    node("grok", "generator", 300, 240, { provider: "grok" }),
    node("gpt-result", "result", 580, 0), node("gemini-result", "result", 580, 120), node("grok-result", "result", 580, 240),
  ], [
    edge("input-gpt", "input", "gpt"), edge("input-gemini", "input", "gemini"), edge("input-grok", "input", "grok"),
    edge("gpt-result", "gpt", "gpt-result"), edge("gemini-result", "gemini", "gemini-result"), edge("grok-result", "grok", "grok-result"),
  ], ["compare", "providers", "gpt", "gemini", "grok"], 3),
];

export const NODE_TEMPLATE_SEEDS = nodeTemplateSeeds;
