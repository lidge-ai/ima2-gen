import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { buildApp } from "../server.ts";
import { nodeTemplateSeeds } from "../lib/nodeTemplateSeeds.ts";
import { nodeTemplateStore } from "../lib/nodeTemplateStore.ts";
import {
  TEMPLATE_FILE_KIND,
  TemplateFileError,
  buildTemplateFile,
  parseTemplateFile,
  portableTemplateGraph,
  templateFileLimits,
  templateFileName,
  uniqueTemplateName,
} from "../lib/nodeTemplateFile.ts";

async function listen(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(buildApp(createTestRuntimeContext({ config })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function postImport(base: string, body: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${base}/api/node-templates/import`, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body,
  });
  return { status: res.status, text: await res.text() };
}

const SECRET = "sk-proj-portable-secret-0123456789";
const file = (graph: unknown, extra: Record<string, unknown> = {}) => ({
  kind: TEMPLATE_FILE_KIND, version: 1, exportedAt: 1, name: "Portable test", description: "d", tags: ["a"], graph, ...extra,
});
const hostileNode = {
  id: "a", type: "imageNode", position: { x: 10, y: 20 }, width: 300, height: 400,
  style: { backgroundImage: "url(https://attacker.example/beacon)" }, className: "evil", parentId: "b", hidden: true,
  domAttributes: { dangerouslySetInnerHTML: { __html: "<img src=x>" } },
  data: {
    kind: "generator", prompt: "a red kite", provider: "openai", model: "gpt-image-2", variation: 3, style: "A",
    imageUrl: "/generated/a.png", partialImageUrl: "data:image/png;base64,AAAA", serverNodeId: "srv-1",
    clientId: "c-1", parentServerNodeId: "srv-0", extraParentServerNodeIds: ["srv-9"], pendingRequestId: "req-1",
    templateProvenance: "template_x", filename: "a.png", apiKey: SECRET, nested: { token: SECRET }, status: "pending",
  },
};
const plainNode = (id: string, x = 0) => ({ id, type: "imageNode", position: { x, y: 0 }, data: { prompt: id } });

function expectCode(fn: () => unknown, code: string, status = 400) {
  assert.throws(fn, (error: unknown) => error instanceof TemplateFileError && error.code === code && error.status === status, code);
}

describe("portable node template files (PR 256 WP4)", () => {
  it("rebuilds nodes, edges and data from allowlists", () => {
    const graph = portableTemplateGraph({
      nodes: [hostileNode, plainNode("b", 400)],
      edges: [{ id: "e1", source: "a", target: "b", sourceHandle: "output", targetHandle: "input", style: { stroke: "red" }, className: "x", label: "L" }],
      viewport: { x: 1, y: 2, zoom: 1 }, manifest: { requiredPlaceholders: ["p"], expectedTerminalResults: 1 },
    }, "strict");
    const node = graph.nodes[0]!;
    assert.deepEqual(Object.keys(node).sort(), ["data", "height", "id", "position", "type", "width"]);
    assert.deepEqual(node.data, {
      kind: "generator", prompt: "a red kite", provider: "openai", model: "gpt-image-2", style: "A", variation: 3, status: "idle",
    });
    assert.deepEqual(graph.edges[0], { id: "e1", source: "a", target: "b", sourceHandle: "output", targetHandle: "input", label: "L" });
    assert.deepEqual(graph.viewport, { x: 1, y: 2, zoom: 1 });
    const serialized = JSON.stringify(graph);
    for (const needle of [SECRET, "attacker.example", "evil", "dangerouslySetInnerHTML", "srv-", "req-1", "/generated/", "data:image", "a.png", "template_x"]) {
      assert.ok(!serialized.includes(needle), needle);
    }
  });

  it("keeps element nodes safe and seed placeholders intact", () => {
    const graph = portableTemplateGraph({
      nodes: [
        { id: "el", type: "elementReferenceNode", position: { x: 0, y: 0 }, data: { nodeType: "element-reference", elementId: "asset_1", elementName: "Hat", thumbnailUrl: "/generated/t.png", refCount: 2 } },
        { id: "r", position: { x: 1, y: 1 }, data: { kind: "reference", media: { placeholder: "reference-image", unresolved: true } } },
      ],
      edges: [],
    }, "strict");
    assert.deepEqual(graph.nodes[0]!.data, { nodeType: "element-reference", elementName: "Hat", status: "idle", refCount: 2, missing: true });
    assert.deepEqual(graph.nodes[1]!.data, { kind: "reference", media: { placeholder: "reference-image", unresolved: true }, status: "idle" });
  });

  it("round-trips every seed template without losing its distinguishing fields", () => {
    for (const seed of nodeTemplateSeeds) {
      const exported = buildTemplateFile(seed);
      const parsed = parseTemplateFile(JSON.parse(JSON.stringify(exported)));
      assert.equal(parsed.graph.nodes.length, seed.graph.nodes.length, seed.id);
      assert.deepEqual(parsed.graph.edges.map((edge) => [edge.source, edge.target]), seed.graph.edges.map((edge) => [edge.source, edge.target]));
      assert.deepEqual(parsed.graph.nodes.map((node) => [node.data?.variation, node.data?.style, node.data?.kind]),
        seed.graph.nodes.map((node) => [node.data?.variation, node.data?.style, node.data?.kind]), seed.id);
    }
  });

  it("rejects wrong kinds, versions, names and oversized files with fixed codes", () => {
    const graph = { nodes: [plainNode("a")], edges: [] };
    expectCode(() => parseTemplateFile([]), "TEMPLATE_FILE_INVALID");
    expectCode(() => parseTemplateFile(file(graph, { kind: "other" })), "TEMPLATE_FILE_KIND");
    for (const version of [0, -1, 1.5, 2, "1", null]) expectCode(() => parseTemplateFile(file(graph, { version })), "TEMPLATE_FILE_VERSION");
    expectCode(() => parseTemplateFile(file(graph, { name: "  " })), "INVALID_TEMPLATE_NAME");
    expectCode(() => parseTemplateFile(file(graph, { name: "가".repeat(81) })), "INVALID_TEMPLATE_NAME");
    assert.equal(parseTemplateFile(file(graph, { name: "가".repeat(80) })).name.length, 80);
    expectCode(() => parseTemplateFile(file(graph, { description: "x".repeat(2001) })), "TEMPLATE_FILE_INVALID");
    const limits = templateFileLimits({ graphMaxNodes: 2, graphMaxEdges: 1000 });
    expectCode(() => parseTemplateFile(file({ nodes: [plainNode("a"), plainNode("b"), plainNode("c")], edges: [] }), limits), "TEMPLATE_FILE_TOO_LARGE", 413);
    assert.deepEqual(templateFileLimits({ graphMaxNodes: 500, graphMaxEdges: 1000 }), { maxNodes: 300, maxEdges: 1000 });
  });

  it("rejects structural problems instead of repairing them", () => {
    const bad: unknown[] = [
      { nodes: [], edges: [] },
      { nodes: [plainNode("a"), plainNode("a")], edges: [] },
      { nodes: [plainNode("a"), plainNode("b")], edges: [{ id: "e", source: "a", target: "b" }, { id: "e", source: "b", target: "a" }] },
      { nodes: [plainNode("a")], edges: [{ id: "e", source: "a", target: "ghost" }] },
      { nodes: [plainNode("a"), plainNode("b")], edges: [{ id: "e1", source: "a", target: "b" }, { id: "e2", source: "b", target: "a" }] },
      { nodes: [{ id: "a", position: { x: "1", y: 0 }, data: {} }], edges: [] },
      { nodes: [{ id: "a", position: { x: Number.NaN, y: 0 }, data: {} }], edges: [] },
      { nodes: [{ id: "a", position: { x: 0, y: 0 }, data: "text" }], edges: [] },
      { nodes: ["a"], edges: [] },
    ];
    for (const graph of bad) expectCode(() => parseTemplateFile(file(graph)), "INVALID_TEMPLATE_GRAPH");
    const protoNode = JSON.parse('{"id":"a","position":{"x":0,"y":0},"data":{"__proto__":{"status":"ready"}}}');
    expectCode(() => parseTemplateFile(file({ nodes: [protoNode], edges: [] })), "INVALID_TEMPLATE_GRAPH");
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let depth = 0; depth < 20000; depth += 1) { deep.child = {}; deep = deep.child as Record<string, unknown>; }
    expectCode(() => parseTemplateFile(file({ nodes: [{ id: "a", position: { x: 0, y: 0 }, data: root }], edges: [] })), "INVALID_TEMPLATE_GRAPH");
  });

  it("names downloads and duplicates within the 80-character limit", () => {
    assert.equal(templateFileName("Đổi đồ / Look #1"), "doi-do-look-1.ima2-template.json");
    assert.equal(templateFileName("🎨🎨"), "template.ima2-template.json");
    assert.ok(templateFileName("a".repeat(200)).startsWith("a".repeat(80) + "."));
    assert.equal(uniqueTemplateName("Hat", ["Other"]), "Hat");
    assert.equal(uniqueTemplateName("Hat", ["hat", "Hat (2)"]), "Hat (3)");
    const long = "🎨".repeat(80);
    const unique = uniqueTemplateName(long, [long]);
    assert.equal(Array.from(unique).length, 80);
    assert.ok(unique.endsWith(" (2)"));
    assert.ok(!unique.includes("\uFFFD"));
  });

  it("exports and imports over HTTP with fixed errors and the app's origin guard", async () => {
    const running = await listen();
    const created = await nodeTemplateStore.create({ name: `WP4 route ${Date.now()}`, graph: { nodes: [hostileNode as never, plainNode("b") as never], edges: [{ id: "e", source: "a", target: "b" }] } });
    const imported: string[] = [];
    try {
      const exported = await fetch(`${running.base}/api/node-templates/${created.id}/export`);
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get("content-disposition") ?? "", /attachment; filename="wp4-route-\d+\.ima2-template\.json"/);
      const text = await exported.text();
      for (const needle of [SECRET, "attacker.example", "srv-1", "/generated/"]) assert.ok(!text.includes(needle), needle);
      for (let round = 0; round < 2; round += 1) {
        const response = await postImport(running.base, text);
        assert.equal(response.status, 201, response.text);
        const template = JSON.parse(response.text).template;
        imported.push(template.id);
        assert.notEqual(template.id, created.id);
        assert.equal(template.name, round === 0 ? `${created.name} (2)` : `${created.name} (3)`);
      }
      const stored = await nodeTemplateStore.get(imported[0]!);
      assert.deepEqual(stored!.graph.nodes.map((node) => node.data?.status), ["idle", "idle"]);

      const hostile = await postImport(running.base, '{"kind": "ima2.node-template", "name": "' + SECRET + '"');
      assert.equal(hostile.status, 400);
      assert.deepEqual(JSON.parse(hostile.text).error.code, "TEMPLATE_FILE_INVALID");
      assert.ok(!hostile.text.includes(SECRET));
      const huge = await postImport(running.base, JSON.stringify(file({ nodes: [plainNode("a")], edges: [] }, { description: "é".repeat(1_100_000) })));
      assert.equal(huge.status, 413);
      assert.equal(JSON.parse(huge.text).error.code, "TEMPLATE_FILE_TOO_LARGE");
      const charset = await postImport(running.base, "{}", { "content-type": "application/json; charset=x-hostile-" + SECRET });
      assert.equal(charset.status, 400);
      assert.ok(!charset.text.includes(SECRET));
      const graphError = await postImport(running.base, JSON.stringify(file({ nodes: [plainNode("a")], edges: [{ id: SECRET, source: "a", target: SECRET }] })));
      assert.equal(graphError.status, 400);
      assert.ok(!graphError.text.includes(SECRET));
      const crossSite = await postImport(running.base, text, { "sec-fetch-site": "cross-site" });
      assert.equal(crossSite.status, 403);
    } finally {
      for (const id of [created.id, ...imported]) await nodeTemplateStore.remove(id).catch(() => undefined);
      await running.close();
    }
  });
});

describe("portable template file name parity", () => {
  it("the client names downloads exactly like the server", async () => {
    const { nodeTemplateFileName } = await import("../ui/src/lib/nodeTemplateFileName.ts");
    for (const name of ["Đổi đồ / Look #1", "🎨🎨", "a".repeat(200), "  Café -- Menu  ", "WP4 portable"]) {
      assert.equal(nodeTemplateFileName(name), templateFileName(name), name);
    }
  });
});
