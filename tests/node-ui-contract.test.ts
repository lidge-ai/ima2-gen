import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "./_readTree.mjs";

const root = process.cwd();

function readSource(path) {
  return readSourceTree(path);
}

describe("node UI compact metadata contract", () => {
  it("keeps node metadata in a fixed clipped footer slot", () => {
    const component = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const statusRule = /\.image-node__status\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const actionsRule = /\.image-node__actions\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(component, /className="image-node__status"/);
    assert.match(component, /title=\{d\.errorInfo\?\.code \? `\$\{statusLabel\} \[\$\{d\.errorInfo\.code\}\]` : statusLabel\}/);
    assert.match(statusRule, /overflow:\s*hidden/);
    assert.match(statusRule, /text-overflow:\s*ellipsis/);
    assert.match(statusRule, /white-space:\s*nowrap/);
    assert.match(actionsRule, /display:\s*flex/);
    assert.match(actionsRule, /flex:\s*0 1 auto/);
    assert.match(actionsRule, /flex-wrap:\s*wrap/);
    assert.match(actionsRule, /align-items:\s*center/);
  });

  it("keeps preview height fixed while node width follows generated aspect ratio", () => {
    const component = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const nodeRule = /\.image-node\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const previewRule = /\.image-node__preview\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const imageRule = /\.image-node__preview img[\s,][\s\S]*?\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(component, /function getPreviewWidth\(size\?: string \| null\): number/);
    assert.match(component, /NODE_PREVIEW_HEIGHT \* \(width \/ height\)/);
    assert.match(component, /"--node-preview-w": `\$\{getPreviewWidth\(d\.size\)\}px`/);
    assert.match(nodeRule, /width:\s*var\(--node-preview-w,\s*240px\)/);
    assert.match(previewRule, /height:\s*var\(--node-preview-h,\s*240px\)/);
    assert.doesNotMatch(previewRule, /aspect-ratio:\s*1 \/ 1/);
    assert.match(imageRule, /object-fit:\s*contain/);
  });

  it("persists returned node output size so aspect-ratio layout survives reload", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const api = readSource("ui/src/lib/nodeApi.ts");
    const route = (readSource("routes/nodes.ts") + readSource("lib/nodeGeneration.ts") + readSource("lib/nodeValidation.ts"));

    assert.match(api, /size\?: string \| null/);
    assert.match(route, /size: effectiveSize,\s*\n\s*moderation/);
    assert.match(store, /size: \(d\.size \?\? null\) as string \| null/);
    assert.match(store, /size: res\.size \?\? null/);
    assert.match(store, /size: recovered\.size \?\? n\.data\.size \?\? null/);
  });

  it("uses compact regenerate labels", () => {
    const en = readSource("ui/src/i18n/en.json");
    const ko = readSource("ui/src/i18n/ko.json");

    assert.match(en, /"regenerate":\s*"Regen"/);
    assert.match(en, /"addChild":\s*"Child"/);
    assert.match(en, /"duplicateBranch":\s*"Branch"/);
    assert.match(ko, /"regenerate":\s*"재생성"/);
    assert.match(ko, /"addChild":\s*"자식"/);
    assert.match(ko, /"duplicateBranch":\s*"복제"/);
    assert.doesNotMatch(en, /"regenerate":\s*"Regenerate"/);
  });

  it("keeps the empty-node generate button readable in the compact footer", () => {
    const component = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const en = readSource("ui/src/i18n/en.json");
    const actionsRule = /\.image-node__actions button:first-child:not\(\.image-node__generate\),\s*\.image-node__del\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const generateRule = /\.image-node__generate\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(component, /className="image-node__generate"/);
    assert.match(component, /aria-label=\{t\("node\.generateTitle"\)\}/);
    assert.match(actionsRule, /width:\s*30px/);
    assert.match(generateRule, /min-width:\s*44px !important/);
    assert.match(en, /"generate":\s*"Gen"/);
    assert.match(en, /"generateTitle":\s*"Generate node image"/);
  });

  it("keeps canvas overlays readable in both theme palettes", () => {
    const cssPaths = [
      "ui/src/index.css",
      ...readdirSync(join(root, "ui/src/styles"))
        .filter((f) => f.endsWith(".css"))
        .map((f) => `ui/src/styles/${f}`),
    ];
    const css = cssPaths.map((p) => readFileSync(join(root, p), "utf8")).join("\n");
    const rootRule = /:root\s*\{[^}]*--on-scrim:\s*#f6f7fb[^}]*\}/s.exec(css)?.[0] ?? "";
    const hintRule = /\.node-canvas__hint\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const loadingRule = /\.node-canvas__loading\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(rootRule, /--on-scrim:\s*#f6f7fb/);
    // The light palette was reintroduced deliberately (devlog 260821b). Scrim
    // text must stay readable in BOTH themes: the light override block must
    // redefine --on-scrim so scrim chips never go dark-on-dark.
    const lightRule = /:root\[data-theme="light"\]\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    assert.match(lightRule, /--on-scrim:\s*#fafafc/);
    assert.match(hintRule, /color:\s*var\(--on-scrim\)/);
    assert.match(hintRule, /background:\s*var\(--chip-scrim\)/);
    assert.match(loadingRule, /color:\s*var\(--on-scrim\)/);
  });

  it("makes node connection handles easier to target", () => {
    const canvas = readSource("ui/src/components/NodeCanvas.tsx");
    const component = readSource("ui/src/components/ImageNode.tsx");
    const css = readSource("ui/src/index.css");
    const handleRule = /\.image-node__handle\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const hitRule = /\.image-node__handle::before\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const hoverRule = /\.image-node:hover \.image-node__handle,[^{]+\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(component, /type="source"/);
    assert.match(component, /type="target"/);
    assert.match(component, /id=\{`source-\$\{handleId\}`\}/);
    assert.match(component, /id=\{`target-\$\{handleId\}`\}/);
    assert.match(canvas, /ConnectionMode/);
    assert.match(canvas, /connectionMode=\{ConnectionMode\.Loose\}/);
    assert.match(canvas, /connectionRadius=\{32\}/);
    assert.match(handleRule, /transition:/);
    assert.match(hitRule, /inset:\s*-9px/);
    assert.match(hoverRule, /width:\s*14px !important/);
    assert.match(hoverRule, /height:\s*14px !important/);
    assert.match(hoverRule, /box-shadow:/);
  });

  it("keeps node canvas dot grid visible for empty and zoomed-out graphs", () => {
    const canvas = readSource("ui/src/components/NodeCanvas.tsx");
    const css = readSource("ui/src/index.css");
    const canvasRule = /\.node-canvas\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const emptyRule = /\.node-canvas--empty\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(canvas, /BackgroundVariant/);
    assert.match(canvas, /node-canvas--empty/);
    assert.match(canvas, /variant=\{BackgroundVariant\.Dots\}/);
    assert.match(canvas, /size=\{1\.6\}/);
    assert.match(canvas, /color="var\(--node-canvas-grid\)"/);
    assert.match(canvasRule, /--node-canvas-grid:/);
    assert.match(emptyRule, /radial-gradient\(circle,\s*var\(--node-canvas-grid\)\s*1px/);
    assert.match(emptyRule, /\/\s*24px 24px/);
  });

  it("renders one visible connection dot per node side", () => {
    const css = readSource("ui/src/index.css");
    const sourceRule = /\.image-node__handle--source\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const targetRule = /\.image-node__handle--target\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const topRule = /\.image-node__handle--top\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const rightRule = /\.image-node__handle--right\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const bottomRule = /\.image-node__handle--bottom\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";
    const leftRule = /\.image-node__handle--left\s*\{[^}]*\}/s.exec(css)?.[0] ?? "";

    assert.match(sourceRule, /z-index:\s*2/);
    assert.match(targetRule, /opacity:\s*0/);
    assert.match(targetRule, /pointer-events:\s*none/);
    assert.match(topRule, /left:\s*50% !important/);
    assert.match(rightRule, /top:\s*50% !important/);
    assert.match(bottomRule, /left:\s*50% !important/);
    assert.match(leftRule, /top:\s*50% !important/);
    assert.doesNotMatch(css, /calc\(50% [+-] 12px\)/);
  });

  it("preserves directional node connection handles through connect and session save", () => {
    const controller = readSource("ui/src/components/node-canvas/useNodeConnectionController.ts");
    const store = readSource("ui/src/store/storeGraphSave.ts");

    assert.match(controller, /connectNodes\(connection\.source,\s*connection\.target,\s*connection\.sourceHandle,\s*connection\.targetHandle\)/);
    assert.match(controller, /state\.isValid \|\| state\.toNode \|\| state\.toHandle/);
    assert.match(store, /sourceHandle:\s*e\.sourceHandle \?\? null/);
    assert.match(store, /targetHandle:\s*e\.targetHandle \?\? null/);
    assert.match(store, /sourceHandle:\s*typeof data\.sourceHandle === "string" \? data\.sourceHandle : null/);
    assert.match(store, /targetHandle:\s*typeof data\.targetHandle === "string" \? data\.targetHandle : null/);
  });

  it("uses one graph edge serializer for normal and refresh saves", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /SessionGraphEdge/);
    assert.match(store, /function serializeGraphEdgesForSave\(graphEdges: GraphEdge\[\]\): SessionGraphEdge\[\]/);
    assert.match(store, /const edges = serializeGraphEdgesForSave\(graphEdges\)/);
    assert.match(store, /const edges = serializeGraphEdgesForSave\(s\.graphEdges\)/);
    assert.doesNotMatch(store, /data:\s*\{\s*\}\s*\}\)\)/);
  });

  it("flushes node completion saves without waiting for debounce", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /"node-complete"/);
    assert.match(store, /void get\(\)\.flushGraphSave\("node-complete"\)/);
    assert.match(store, /serverNodeId:\s*res\.nodeId/);
    assert.match(store, /imageUrl:\s*res\.url/);
    assert.match(store, /status:\s*"ready"/);
  });

  it("uses handle-aware edge ids for node connections", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /function newGraphEdgeId\(/);
    assert.match(store, /sourceHandle\?: string \| null/);
    assert.match(store, /targetHandle\?: string \| null/);
    assert.match(store, /const sourceAnchor = sourceHandle \?\? "auto"/);
    assert.match(store, /const targetAnchor = targetHandle \?\? "auto"/);
    assert.match(store, /return `\$\{sourceClientId\}:\$\{sourceAnchor\}->\$\{targetClientId\}:\$\{targetAnchor\}`/);
    assert.match(store, /id:\s*newGraphEdgeId\(sourceClientId,\s*targetClientId,\s*sourceHandle,\s*targetHandle\)/);
  });

  it("uses the same edge id helper for programmatic child edges", () => {
    const store = readSource("ui/src/store/useAppStore.ts");

    assert.match(store, /const DEFAULT_CHILD_SOURCE_HANDLE = "source-right"/);
    assert.match(store, /const DEFAULT_CHILD_TARGET_HANDLE = "target-left"/);
    assert.match(store, /function addChildNodeImpl[\s\S]*?newGraphEdgeId\(parentClientId,\s*clientId,\s*DEFAULT_CHILD_SOURCE_HANDLE,\s*DEFAULT_CHILD_TARGET_HANDLE\)/);
    assert.match(store, /function addSiblingNodeImpl[\s\S]*?newGraphEdgeId\(parentClientId,\s*clientId,\s*DEFAULT_CHILD_SOURCE_HANDLE,\s*DEFAULT_CHILD_TARGET_HANDLE\)/);
    assert.match(store, /sourceHandle:\s*DEFAULT_CHILD_SOURCE_HANDLE/);
    assert.match(store, /targetHandle:\s*DEFAULT_CHILD_TARGET_HANDLE/);
  });

  it("preserves the dragged source handle when creating a child node from a connector", () => {
    const controller = readSource("ui/src/components/node-canvas/useNodeConnectionController.ts");
    const insertion = readSource("ui/src/lib/nodeStudioGraph.ts");
    const store = readSource("ui/src/store/storeGraphNodeImpl.ts");

    // Drag-end resolves the dragged handle into the palette's source port;
    // the inserted child edge inherits that exact handle.
    assert.match(controller, /resolveNodePort\(node, state\.fromHandle\?\.id, "output"\)/);
    assert.match(insertion, /sourceHandle: input\.sourcePort\.handleId/);
    assert.match(insertion, /`\$\{input\.sourcePort\.nodeId\}:\$\{input\.sourcePort\.handleId\}->\$\{id\}:target-left`/);
    assert.match(store, /function normalizeNodeHandleId\(/);
    assert.match(store, /function getOppositeTargetHandle\(sourceHandle\?: string \| null\): string \| null/);
    assert.match(store, /case "source-right":[\s\S]*?return "target-left"/);
    assert.match(store, /function addChildNodeAtImpl[\s\S]*?sourceHandle/);
    assert.match(store, /const normalizedSourceHandle =[\s\S]*?normalizeNodeHandleId\(sourceHandle,\s*"source"\) \?\? DEFAULT_CHILD_SOURCE_HANDLE/);
    assert.match(store, /const targetHandle = getOppositeTargetHandle\(normalizedSourceHandle\) \?\? DEFAULT_CHILD_TARGET_HANDLE/);
    assert.match(store, /id:\s*newGraphEdgeId\(parentClientId,\s*clientId,\s*normalizedSourceHandle,\s*targetHandle\)/);
    assert.match(store, /sourceHandle:\s*normalizedSourceHandle/);
    assert.match(store, /targetHandle,/);
  });
});
