import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { collectCallArguments, collectReturnedFields } from "./_executionImportEdges.mjs";
import {
  canConnectPorts,
  canConnectPortTypes,
} from "../ui/src/lib/nodeCompatibility.ts";
import {
  NODE_PORT_BINDINGS,
  resolveNodePort,
} from "../ui/src/lib/nodePortCatalog.ts";

const read = (path) => readFileSync(path, "utf8");
const occurrences = (source, pattern) => source.match(pattern)?.length ?? 0;
const section = (source, start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `expected source section ${start} ... ${end}`);
  return source.slice(from, to);
};
const deepKeys = (value, prefix = "") => Object.entries(value).flatMap(([key, child]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  return child && typeof child === "object" && !Array.isArray(child)
    ? deepKeys(child, path)
    : [path];
}).sort();

const canvas = read("ui/src/components/NodeCanvas.tsx");
const emptyState = read("ui/src/components/node-canvas/NodeCanvasEmptyState.tsx");
const overlays = read("ui/src/components/node-canvas/NodeStudioOverlays.tsx");
const templatePicker = read("ui/src/components/node-canvas/NodeTemplatePicker.tsx");
const templateController = read("ui/src/components/node-canvas/useNodeTemplateController.ts");
const palette = read("ui/src/components/node-canvas/NodeCommandPalette.tsx");
const studioController = read("ui/src/components/node-canvas/useNodeStudioController.ts");
const keyboard = read("ui/src/lib/nodeStudioKeyboard.ts");
const connectionController = read("ui/src/components/node-canvas/useNodeConnectionController.ts");
const graphOwner = read("ui/src/lib/nodeStudioGraph.ts");
const branchDialog = read("ui/src/components/node-canvas/NodeBranchDialog.tsx");
const branchController = read("ui/src/components/node-canvas/useNodeBranchController.ts");
const branching = read("ui/src/lib/nodeBranching.ts");
const elementTray = read("ui/src/components/node-canvas/NodeElementTray.tsx");
const elementController = read("ui/src/components/node-canvas/useNodeElementController.ts");
const elementNode = read("ui/src/components/node-canvas/ElementReferenceNode.tsx");
const graphSave = read("ui/src/store/storeGraphSave.ts");
const nodeRun = read("ui/src/store/storeNodeGenImpl.ts");
const routes = read("routes/nodeTemplates.ts");
const routeIndex = read("routes/index.ts");
const templateApi = read("ui/src/lib/api-node-templates.ts");
const templateStore = read("lib/nodeTemplateStore.ts");
const css = read("ui/src/index.css");
const en = JSON.parse(read("ui/src/i18n/en.json"));
const ko = JSON.parse(read("ui/src/i18n/ko.json"));

describe("NT — empty state and template integration", () => {
  it("renders the three empty-canvas choices in blank, template, recent order", () => {
    assert.match(canvas, /nodes\.length === 0[\s\S]*<NodeCanvasEmptyState/);
    assert.match(canvas, /onOpenTemplates=\{studio\.openTemplates\}/);
    assert.match(canvas, /onResumeRecent=\{studio\.resumeRecent\}/);
    const blank = emptyState.indexOf('nodeStudio.empty.blankTitle');
    const template = emptyState.indexOf('nodeStudio.empty.templateTitle');
    const recent = emptyState.indexOf('nodeStudio.empty.recentTitle');
    assert.ok(blank >= 0 && blank < template && template < recent);
    assert.match(emptyState, /disabled=\{!hasRecentGraph\}/);
    assert.match(emptyState, /description=\{t\(hasRecentGraph \? "nodeStudio\.empty\.recentDescription" : "nodeStudio\.empty\.recentUnavailable"\)\}/);
    assert.match(overlays, /onClick=\{studio\.openTemplates\}/);
    assert.match(overlays, /studio\.templateOpen[\s\S]*<NodeTemplatePicker/);
  });

  it("exposes the full template REST/client surface with read-only seeds and fresh copy IDs", () => {
    assert.match(routes, /app\.get\("\/api\/node-templates"/);
    assert.match(routes, /app\.post\("\/api\/node-templates"/);
    assert.match(routes, /app\.post\("\/api\/node-templates\/:id\/instantiate"/);
    assert.match(routes, /app\.patch\("\/api\/node-templates\/:id"/);
    assert.match(routes, /app\.delete\("\/api\/node-templates\/:id"/);
    assert.match(routeIndex, /registerNodeTemplateRoutes\(app, ctx\)/);
    for (const name of ["listNodeTemplates", "createNodeTemplate", "instantiateNodeTemplate", "renameNodeTemplate", "deleteNodeTemplate"]) {
      assert.match(templateApi, new RegExp(`export async function ${name}\\b`));
    }
    assert.match(templateStore, /update\([\s\S]*error\(403, "SEED_TEMPLATE_READ_ONLY"/);
    assert.match(templateStore, /remove\([\s\S]*error\(403, "SEED_TEMPLATE_READ_ONLY"/);
    assert.match(templateStore, /new Map\(graph\.nodes\.map\(\(node\) => \[node\.id, `n_\$\{randomUUID\(\)\}`\]\)\)/);
    assert.match(templateStore, /id: `e_\$\{randomUUID\(\)\}`/);
  });

  it("copies a template with one graph commit, fitView, and user-only mutation gates", () => {
    const copy = section(templateController, "const copyTemplate", "return { templateOpen");
    const instantiate = copy.indexOf("instantiateNodeTemplate(template.id)");
    const normalize = copy.indexOf("normalizeTemplateGraph");
    const commit = copy.indexOf('commitGraphSnapshot({ ...next, reason: "template" })');
    const fit = copy.indexOf("options.fitView");
    assert.ok(instantiate >= 0 && normalize >= 0 && normalize < instantiate && instantiate < commit && commit < fit);
    assert.equal(occurrences(copy, /commitGraphSnapshot\(/g), 1);
    assert.match(copy, /options\.nodes\.length > 0 && !window\.confirm\(t\("nodeStudio\.templates\.replaceConfirm"\)\)/);
    assert.doesNotMatch(copy, /postNodeGenerate|runGenerate|generateNode/);
    assert.match(templatePicker, /template\.source === "user" && \(onRename \|\| onDelete\)/);
    assert.match(templatePicker, /window\.confirm\(t\("nodeStudio\.templates\.deleteConfirm"/);
    assert.match(templateController, /window\.prompt\(t\("nodeStudio\.templates\.renamePrompt"\), template\.name\)/);
    assert.match(templateController, /await renameNodeTemplate\(template\.id, name\.trim\(\)\)/);
    assert.match(templateController, /await deleteNodeTemplate\(template\.id\)/);
  });
});

describe("NC — palette and compatibility boundary", () => {
  it("opens only from canvas focus and restores focus after Escape", () => {
    assert.match(keyboard, /target\.matches\("input, textarea, select, \[contenteditable=true\]"\)/);
    assert.match(keyboard, /target === wrapper[\s\S]*classList\.contains\("react-flow__pane"\)/);
    assert.match(keyboard, /event\.key === "\/" \|\| event\.key === " " && graphEmpty/);
    assert.match(studioController, /shouldOpenNodePalette\(event, wrapperRef\.current, nodes\.length === 0\)/);
    assert.match(studioController, /event\.preventDefault\(\); connection\.setPalette/);
    assert.match(studioController, /event\.key === "Escape"[\s\S]*closeOverlays\(\)/);
    assert.match(studioController, /const closeOverlays[\s\S]*restoreFocus\(\)/);
    assert.match(palette, /event\.key === "Escape"[\s\S]*onClose\(\)/);
  });

  it("filters port-drag commands through the compatibility matrix, not equality", () => {
    assert.match(palette, /import \{[\s\S]*canConnectPortTypes[\s\S]*\} from "\.\.\/\.\.\/lib\/nodeCompatibility"/);
    assert.match(palette, /sourcePort\.direction === "output" && command\.inputPorts\.some\([\s\S]*canConnectPortTypes\(sourcePort\.type, port\.type\)/);
    assert.doesNotMatch(palette, /port\.type\s*===\s*sourcePort\.type|sourcePort\.type\s*===\s*port\.type/);
    assert.match(connectionController, /setPalette\(\{ anchor: clientPoint\(event\), sourcePort \}\)/);
  });

  it("publishes the exact ten React Flow port bindings", () => {
    const imageInputs = ["top", "right", "bottom", "left"].map((side) => ({
      nodeType: "imageNode", flowHandleId: `target-${side}`, logicalPortId: "image-input",
      direction: "input", type: "image", acceptsMany: true,
      equivalentHandleIds: ["target-top", "target-right", "target-bottom", "target-left"],
    }));
    const imageOutputs = ["top", "right", "bottom", "left"].map((side) => ({
      nodeType: "imageNode", flowHandleId: `source-${side}`, logicalPortId: "image-output",
      direction: "output", type: "image", acceptsMany: true,
      equivalentHandleIds: ["source-top", "source-right", "source-bottom", "source-left"],
    }));
    const elementOutputs = [
      { nodeType: "elementReferenceNode", flowHandleId: "refs", logicalPortId: "element-refs-output", direction: "output", type: "element-refs", acceptsMany: true, equivalentHandleIds: ["refs"] },
      { nodeType: "elementReferenceNode", flowHandleId: "notes", logicalPortId: "element-notes-output", direction: "output", type: "element-notes", acceptsMany: true, equivalentHandleIds: ["notes"] },
    ];
    assert.equal(NODE_PORT_BINDINGS.length, 10);
    assert.deepEqual(NODE_PORT_BINDINGS, [...imageInputs, ...imageOutputs, ...elementOutputs]);
    assert.equal(NODE_PORT_BINDINGS.filter((port) => port.nodeType === "imageNode").length, 8);
    assert.equal(NODE_PORT_BINDINGS.filter((port) => port.nodeType === "elementReferenceNode").length, 2);
  });

  it("executes mapped compatibility and equivalent-handle cardinality rules", () => {
    const imageNode = { id: "image", type: "imageNode", position: { x: 0, y: 0 }, data: {} };
    const elementNodeValue = { id: "element", type: "elementReferenceNode", position: { x: 0, y: 0 }, data: { nodeType: "element-reference" } };
    const imageOut = resolveNodePort(imageNode, "source-right", "output");
    const imageIn = resolveNodePort({ ...imageNode, id: "target" }, "target-top", "input");
    const refsOut = resolveNodePort(elementNodeValue, "refs", "output");
    const notesOut = resolveNodePort(elementNodeValue, "notes", "output");
    assert.ok(imageOut && imageIn && refsOut && notesOut);
    assert.equal(canConnectPortTypes("image", "image"), true);
    assert.equal(canConnectPortTypes("element-refs", "image"), true);
    assert.equal(canConnectPortTypes("element-notes", "image"), false);
    assert.deepEqual(canConnectPorts(refsOut, imageIn, { nodes: [], edges: [] }), { allowed: true });
    assert.equal(canConnectPorts(notesOut, imageIn, { nodes: [], edges: [] }).reason, "TYPE_MISMATCH");
    assert.deepEqual(canConnectPorts(imageOut, imageIn, { nodes: [], edges: [{ id: "occupied", source: "other", target: "target", sourceHandle: "source-left", targetHandle: "target-left" }] }), { allowed: true });
  });

  it("resolves catalog ports before connecting and surfaces typed failures", () => {
    const connect = section(connectionController, "const onConnect =", "const onConnectEnd");
    assert.equal(occurrences(connect, /resolveNodePort\(/g), 2);
    assert.ok(connect.indexOf("canConnectPorts(") < connect.indexOf("options.connectNodes("));
    assert.match(connect, /!source \|\| !target[\s\S]*surfaceReason\("UNKNOWN_PORT"\)/);
    assert.match(connect, /!verdict\.allowed[\s\S]*surfaceReason\(verdict\.reason\)/);
    for (const key of ["SAME_DIRECTION", "TYPE_MISMATCH", "CARDINALITY", "SELF_EDGE", "DUPLICATE_EDGE", "UNKNOWN_PORT"]) {
      assert.match(studioController, new RegExp(`${key}: "nodeStudio\\.compatibility\\.`));
    }
    assert.match(studioController, /setStatus\(message\); showToast\(message, true\)/);
    assert.match(overlays, /role="status" aria-live="polite" aria-atomic="true"/);
    const commit = section(graphOwner, "export function commitGraphSnapshot", "export function appendBranchOutput");
    assert.equal(occurrences(commit, /useAppStore\.setState\(/g), 1);
    assert.equal(occurrences(commit, /scheduleGraphSave\(\)/g), 1);
  });
});

describe("NB — atomic branch consumer", () => {
  it("wires the 2–4 variant dialog to the branch controller", () => {
    assert.match(studioController, /useNodeBranchController\(shared\)/);
    assert.match(overlays, /<NodeBranchDialog[\s\S]*onApply=\{studio\.applyBranch\}/);
    assert.match(branchDialog, /\[0, 1\]\.map/);
    assert.match(branchDialog, /if \(current\.length >= 4\) return current/);
    assert.match(branchDialog, /disabled=\{drafts\.length <= 2\}/);
    assert.match(branchDialog, /disabled=\{drafts\.length >= 4\}/);
    assert.match(branchDialog, /settingsPatch:[\s\S]*draft\.model\.trim\(\)[\s\S]*draft\.size\.trim\(\)/);
  });

  it("appends and commits a complete branch graph once with effective node overrides", () => {
    const apply = section(branchController, "const applyBranch", "return { branchOpen");
    const create = apply.indexOf("createBranchGraph(");
    const append = apply.indexOf("appendBranchOutput(");
    const commit = apply.indexOf('commitGraphSnapshot({ ...candidate.graph, reason: "branch" })');
    assert.ok(create >= 0 && create < append && append < commit);
    assert.match(apply, /sourceNodeId: selectedSource\.id/);
    assert.match(apply, /if \(!candidate\.ok \|\| !commitGraphSnapshot/);
    assert.equal(occurrences(apply, /commitGraphSnapshot\(/g), 1);
    assert.match(branching, /\.\.\.\(applyVariant \? variant\.settingsPatch : \{\}\)/);
    assert.match(branching, /if \(applyVariant && variant\.provider\) data\.provider = variant\.provider/);
    assert.match(nodeRun, /const nodeProvider = \(typeof node\.data\.provider === "string"[\s\S]*: s\.provider\)/);
    assert.match(nodeRun, /const nodeModel = \(typeof node\.data\.model === "string"[\s\S]*: s\.imageModel\)/);
    assert.match(nodeRun, /const size = options\.sizeOverride \?\? \(typeof node\.data\.size === "string"[\s\S]*: s\.getResolvedSize\(\)\)/);
    assert.match(nodeRun, /postNodeGenerateStream\(\{[\s\S]*provider: nodeProvider,[\s\S]*model: nodeModel/);
  });
});

describe("EN — element node lifecycle", () => {
  it("registers element nodes and provides drag plus keyboard-add activation", () => {
    assert.match(canvas, /elementReferenceNode: ElementReferenceNode/);
    assert.match(overlays, /<NodeElementTray disabled=\{disabled\} onAdd=\{studio\.addElement\}/);
    assert.match(elementTray, /NODE_ELEMENT_MIME[\s\S]*JSON\.stringify\(payloadFor\(element\.id\)\)/);
    assert.match(elementTray, /return \{ version: 1, assetKind: "element", elementId \}/);
    assert.match(elementTray, /draggable=\{!disabled\}[\s\S]*onDragStart/);
    assert.match(elementTray, /<button type="button" disabled=\{disabled\} onClick=\{\(\) => void onAdd\(element\)\}/);
    assert.match(elementController, /parseElementDropPayload\(event\.dataTransfer\.getData\(NODE_ELEMENT_MIME\)\)/);
    assert.match(elementController, /screenToFlowPosition\(\{ x: event\.clientX, y: event\.clientY \}\)/);
    assert.match(elementController, /await getAssetById\(elementId\)[\s\S]*buildElementReferenceNode\(latest\.asset, position\)/);
    assert.match(elementController, /commitGraphSnapshot\(\{ \.\.\.next, reason: "element-drop" \}\)/);
    assert.match(elementNode, /<Handle type="source" id="refs"/);
    assert.match(elementNode, /<Handle type="source" id="notes"/);
  });

  it("restores the renderer and blocks single and batch runs for missing inputs", () => {
    assert.match(graphSave, /nodeType === "element-reference" \? "elementReferenceNode" : "imageNode"/);
    // Reload preserves unmanaged element/branch fields (spread-first mapper).
    assert.match(graphSave, /\.\.\.\(d as unknown as ImageNodeData\),/);
    // Traversal lives in the pure module; the run resolves through it.
    const traversal = read("ui/src/lib/nodeElementInputs.ts");
    assert.match(traversal, /source\.type === "elementReferenceNode"/);
    assert.match(traversal, /queue\.push\(source\.id\)/);
    const single = section(nodeRun, "export async function runGenerateNodeInPlaceImpl", "export async function runNodeBatchImpl");
    assert.ok(single.indexOf("collectElementInputs(get().graphNodes, get().graphEdges, [clientId])") < single.indexOf("postNodeGenerateStream({"));
    assert.match(single, /resolveElementInputsForRun\(elementInputs, set, get\)/);
    assert.match(single, /if \(elementResolution\.ok === false\)[\s\S]*showToast[\s\S]*return null/);
    assert.match(single, /mergeRunReferences\(node\.data\.referenceImages \?\? \[\], elementResolution\.referenceDataUrls/);
    const batch = section(nodeRun, "export async function runNodeBatchImpl", "\n}");
    assert.ok(batch.indexOf("collectElementInputs(get().graphNodes, get().graphEdges, candidates)") < batch.indexOf("set({ nodeBatchRunning: true"));
    assert.match(batch, /batchElementInputs\.find\(\(input\) => input\.missing\)/);
    assert.match(batch, /type !== "elementReferenceNode"/);
  });

  it("executable — collectElementInputs walks upstream chains and dedupes", async () => {
    const { collectElementInputs } = await import("../ui/src/lib/nodeElementInputs.ts");
    const elementNode = { id: "el1", type: "elementReferenceNode", position: { x: 0, y: 0 }, data: { elementId: "a_1", elementName: "Hero", missing: false } };
    const missingNode = { id: "el2", type: "elementReferenceNode", position: { x: 0, y: 0 }, data: { elementId: "a_2", elementName: "Lost", missing: true } };
    const imageA = { id: "a", type: "imageNode", position: { x: 0, y: 0 }, data: {} };
    const imageB = { id: "b", type: "imageNode", position: { x: 0, y: 0 }, data: {} };
    const nodes = [elementNode, missingNode, imageA, imageB];
    const edges = [
      { id: "e1", source: "el1", target: "a" },
      { id: "e2", source: "a", target: "b" },
      { id: "e3", source: "el2", target: "b" },
    ];
    const inputs = collectElementInputs(nodes, edges, ["b"]);
    assert.deepEqual(inputs.map((i) => i.elementId).sort(), ["a_1", "a_2"]);
    assert.equal(inputs.find((i) => i.elementId === "a_2")?.missing, true);
    assert.deepEqual(collectElementInputs(nodes, edges, ["a"]).map((i) => i.elementId), ["a_1"]);
    assert.equal(collectElementInputs(nodes, edges, ["a", "b"]).filter((i) => i.elementId === "a_1").length, 1);
  });

  it("pre-run element resolution re-fetches, snapshots revision, and merges refs", () => {
    assert.match(nodeRun, /await getAssetById\(input\.elementId\)/);
    assert.match(nodeRun, /upsertElementCatalog\(get\(\)\.elementCatalog, asset\)/);
    assert.match(nodeRun, /resolvedRevision: revision/);
    assert.match(nodeRun, /elementReferenceFilenames\(asset\)/);
    assert.match(nodeRun, /if \(!dataUrls\.includes\(dataUrl\)\) dataUrls\.push\(dataUrl\)/);
    assert.match(nodeRun, /return \{ ok: false, name: input\.name \}/);
    // Notes, ids, revisions ride the request; server keeps the prompt raw.
    assert.match(nodeRun, /elementIds: elementResolution\.elementIds, elementRevisions: elementResolution\.revisions, elementNotes: elementResolution\.notes/);
    const nodeApi = read("ui/src/lib/nodeApi.ts");
    assert.match(nodeApi, /elementIds\?: string\[\]/);
    assert.match(nodeApi, /elementRevisions\?: Record<string, unknown>/);
    assert.match(nodeApi, /elementNotes\?: string\[\]/);
    const nodeServer = read("lib/nodeGeneration.ts");
    assert.match(nodeServer, /const generationPrompt = elementNotes\.length/);
    assert.match(nodeServer, /\.\.\.\(elementIds\.length \? \{ elementIds, elementRevisions \} : \{\}\)/);
    // The caller forwards both prompts; effective-prompt and raw-prompt lanes
    // retain their distinct legacy behavior after dispatch moves to execution.
    const prepared = collectCallArguments(nodeServer, "lib/nodeGeneration.ts", "prepareImageExecution");
    assert.equal(prepared.length, 1);
    assert.match(prepared[0][1], /prompt: generationPrompt/);
    assert.match(prepared[0][1], /rawPrompt: prompt/);
    const openaiOwner = "lib/providers/adapters/openaiExecution.ts";
    const openaiExecution = read(openaiOwner);
    const grokOwner = "lib/providers/adapters/grokExecution.ts";
    const grokExecution = read(grokOwner);
    const googleOwner = "lib/providers/adapters/googleExecution.ts";
    const googleExecution = read(googleOwner);
    // Legacy lanes now own their node dispatch inside their adapter's prepareNode.
    const adapterOwners = {
      generateViaAtlasCloud: "lib/providers/adapters/atlascloud.ts",
      generateViaMinimax: "lib/providers/adapters/minimax.ts",
      generateViaNai: "lib/providers/adapters/nai.ts",
    };
    for (const [name, position, expected] of [
      ["generateViaResponses", 1, "generationPrompt"],
      ["editViaResponses", 1, "generationPrompt"],
      ["generateViaGrok", 0, "generationPrompt"],
      ["generateViaGeminiApi", 0, "input.prompt"],
      ["generateViaAgy", 0, "input.prompt"],
      ["generateViaAtlasCloud", 0, 'parentB64 ? `Edit this image: ${prompt}` : prompt'],
      ["generateViaMinimax", 0, 'parentB64 ? `Edit this image: ${prompt}` : prompt'],
      ["generateViaNai", 0, "prompt"],
    ]) {
      const calls = name === "generateViaResponses" || name === "editViaResponses"
        ? collectCallArguments(openaiExecution, openaiOwner, name, "executeOpenaiNode")
        : name === "generateViaGrok"
        ? collectCallArguments(grokExecution, grokOwner, name, "executeGrokNode")
        : name === "generateViaGeminiApi" || name === "generateViaAgy"
        ? collectCallArguments(googleExecution, googleOwner, name, "runGoogleImage")
        : collectCallArguments(read(adapterOwners[name]), adapterOwners[name], name, "prepareNode");
      assert.equal(calls.length, 1, `${name}: expected a live call expression`);
      assert.equal(calls[0][position], expected, `${name}: wrong prompt lane`);
    }
    assert.deepEqual(collectCallArguments(googleExecution, googleOwner, "runGoogleImage")
      .map(args => args[2]), ["googleInput(request)", "googleInput(request)"]);
    assert.deepEqual(collectReturnedFields(googleExecution, googleOwner, "googleInput", "prompt"), [
      '`Edit this image: ${request.prompt}`',
      'request.sourceImage ? `Edit this image: ${request.prompt}` : request.prompt',
      "request.prompt",
    ]);
    // Merge dedupes across classic+element refs and caps at the active limit.
    assert.match(nodeRun, /mergeRunReferences\(node\.data\.referenceImages \?\? \[\], elementResolution\.referenceDataUrls, variantRefLimit\)/);
    assert.match(nodeRun, /effectiveReferenceLimit\(\{\s*provider: nodeProvider/);
    assert.match(nodeRun, /if \(!merged\.includes\(ref\)\) merged\.push\(ref\)/);
    assert.match(nodeRun, /if \(merged\.length >= activeLimit\) break/);
    // Ref fetches fail closed on non-200 instead of embedding error HTML.
    const image = read("ui/src/lib/image.ts");
    assert.match(image, /if \(!response\.ok\) throw new Error/);
  });

  it("assets detail opens even under active filters or a missing page", () => {
    const workspace = read("ui/src/components/assets/AssetsWorkspace.tsx");
    assert.match(workspace, /setFilters\(\{ kind: null, folderId: null, tag: null, q: "" \}\)/);
    assert.match(workspace, /setQuery\(""\)/);
    assert.match(workspace, /const existing = useAppStore\.getState\(\)\.assets\.find/);
    assert.match(workspace, /setDetailAssetOverride\(existing\)/);
    assert.match(workspace, /if \(!existing\)/);
    assert.match(workspace, /getAssetById\(id\)/);
    assert.match(workspace, /assets: \[asset, \.\.\.state\.assets\.filter\(\(entry\) => entry\.id !== asset\.id\)\]/);
    assert.match(workspace, /detailAssetOverride\?\.id === selectedAssetId \? detailAssetOverride : null/);
  });

  it("open-assets-detail listener wires canvas double-click to the assets detail", () => {
    const app = read("ui/src/App.tsx");
    const workspace = read("ui/src/components/assets/AssetsWorkspace.tsx");
    const storeTypes = read("ui/src/store/storeTypes.ts");
    assert.match(app, /addEventListener\("ima2:open-assets-detail"/);
    assert.match(app, /openAssetDetail\(assetId\)/);
    assert.match(storeTypes, /pendingAssetDetailId: string \| null/);
    assert.match(workspace, /setSelectedAssetId\(id\)/);
    assert.match(workspace, /pendingAssetDetailId: null \}\)/);
  });

  it("palette clamps into the viewport", () => {
    assert.match(palette, /Math\.min\(anchor\.clientX, window\.innerWidth - 372\)/);
    assert.match(palette, /Math\.min\(anchor\.clientY, window\.innerHeight - 220\)/);
  });
});

describe("CSS and i18n contracts", () => {
  it("loads node canvas extras and keeps visible studio copy behind translation keys", () => {
    assert.match(css, /@import "\.\/styles\/node-canvas-extras\.css";/);
    assert.match(emptyState, /t\("nodeStudio\.empty\.blankTitle"\)/);
    assert.match(templatePicker, /t\("nodeStudio\.templates\.title"\)/);
    assert.match(palette, /`nodeStudio\.commands\.\$\{command\.type\}\.\$\{field\}`/);
    assert.match(branchDialog, /t\("nodeStudio\.branch\.title"\)/);
    assert.match(elementTray, /t\("nodeStudio\.elements\.addToCanvas"\)/);
    assert.match(elementNode, /t\("nodeStudio\.elementNode\.missing"\)/);
    assert.doesNotMatch(emptyState, />Start with a blank canvas<|>Browse templates<|>Resume recent</);
  });

  it("keeps English and Korean nodeStudio translation trees in exact key parity", () => {
    assert.deepEqual(deepKeys(en.nodeStudio), deepKeys(ko.nodeStudio));
  });
});
