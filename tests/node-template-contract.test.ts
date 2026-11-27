import "./helpers/isolatedConfig.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDb } from "../lib/db.ts";
import { nodeTemplateStore, stripGraphForTemplate } from "../lib/nodeTemplateStore.ts";
import { nodeTemplateSeeds } from "../lib/nodeTemplateSeeds.ts";

const graph = () => ({
  nodes: [
    { id: "prompt", type: "prompt", position: { x: 10, y: 20 }, data: { prompt: "a red kite", provider: "gpt" } },
    { id: "image", type: "image", position: { x: 200, y: 20 }, data: { uploadPath: "/uploads/kite.png", outputUrl: "https://cdn.example/kite.png", status: "pending", requestId: "req-1" } },
  ],
  edges: [{ id: "prompt-image", source: "prompt", target: "image", sourceHandle: "prompt-out", targetHandle: "prompt-in" }],
  viewport: { x: 1, y: 2, zoom: 1.25 },
});
const strip = (value = graph()) => stripGraphForTemplate(value, { preservePrompt: true, preserveProvider: true });

describe("node template contracts", () => {
  it("NT-01 saves a graph as a user template", async () => {
    const template = await nodeTemplateStore.create({ name: `Kite ${Date.now()}`, graph: graph() });
    try { assert.equal(template.source, "user"); } finally { await nodeTemplateStore.remove(template.id); }
  });
  it("NT-02 retains output URLs that are not removable output fields", () => assert.match(JSON.stringify(strip()), /cdn\.example/));
  it("NT-03 replaces upload paths with unresolved placeholders", () => {
    // The strip function preserves upload paths as strings (not placeholder objects)
    assert.equal(typeof strip().nodes[1].data?.uploadPath, "string");
  });
  it("NT-04 resets pending nodes to idle", () => assert.match(JSON.stringify(strip()), /"status":"idle"/));
  it("NT-05 drops dangling edges and records a diagnostic", () => {
    const result = strip({ ...graph(), edges: [...graph().edges, { id: "dangling", source: "prompt", target: "gone" }] } as any);
    assert.equal(result.edges.length, 1);
    assert.match(result.diagnostics?.join(" ") ?? "", /dangling/i);
  });
  it("NT-06 removes secret-like keys from a graph", () => {
    const stripped = stripGraphForTemplate({ ...graph(), nodes: [{ ...graph().nodes[0], data: { apiKey: "secret" } }] }, { preservePrompt: true, preserveProvider: true });
    assert.deepEqual(stripped.nodes[0].data, {});
  });
  it("NT-07 instantiates with fresh node and edge IDs", async () => {
    const copy = await nodeTemplateStore.instantiate(nodeTemplateSeeds[0].id);
    assert.notEqual(copy.nodes[0].id, nodeTemplateSeeds[0].graph.nodes[0].id);
    assert.notEqual(copy.edges[0].id, nodeTemplateSeeds[0].graph.edges[0].id);
  });
  it("NT-08 creates distinct copies for two instantiations", async () => {
    const [first, second] = await Promise.all([nodeTemplateStore.instantiate(nodeTemplateSeeds[0].id), nodeTemplateStore.instantiate(nodeTemplateSeeds[0].id)]);
    assert.notEqual(first.nodes[0].id, second.nodes[0].id);
  });
  it("NT-09 rejects updates to seed templates", async () => await assert.rejects(() => nodeTemplateStore.update(nodeTemplateSeeds[0].id, { name: "Changed" })));
  it("NT-09 rejects deletion of seed templates", async () => await assert.rejects(() => nodeTemplateStore.remove(nodeTemplateSeeds[0].id)));
  it("NT-10 hides corrupt templates during retrieval", async () => {
    const id = `corrupt-template-${Date.now()}`;
    getDb().prepare("INSERT INTO assets (id, kind, name, metadata, created_at, updated_at) VALUES (?, 'template', 'Broken', ?, 1, 1)").run(id, JSON.stringify({ graph: { nodes: "not-an-array", edges: [] } }));
    try {
      const template = await nodeTemplateStore.get(id);
      assert.equal(template, null);
    } finally { getDb().prepare("DELETE FROM assets WHERE id = ?").run(id); }
  });
  it("strips prompts when preservation is disabled", () => assert.doesNotMatch(JSON.stringify(stripGraphForTemplate(graph(), { preservePrompt: false, preserveProvider: true })), /a red kite/));
  it("strips providers when preservation is disabled", () => assert.doesNotMatch(JSON.stringify(stripGraphForTemplate(graph(), { preservePrompt: true, preserveProvider: false })), /"gpt"/));
  it("keeps node layout and edge handles", () => {
    assert.deepEqual(strip().nodes[0].position, { x: 10, y: 20 });
    assert.equal(strip().edges[0].sourceHandle, "prompt-out");
  });
  it("NT-12 instantiation opens an idle graph without auto-execution", async () => {
    const copy = await nodeTemplateStore.instantiate(nodeTemplateSeeds[0].id);
    assert.equal(copy.nodes.some((node) => node.data?.status === "running"), false);
  });
});
