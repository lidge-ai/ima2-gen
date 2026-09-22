import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";
import { buildApp } from "../server.js";
import { nodeTemplateSeeds } from "../lib/nodeTemplateSeeds.js";
import { nodeTemplateStore } from "../lib/nodeTemplateStore.js";
import { docTepNhap, taoTepXuat, tenKhongTrung, tenTepXuat } from "../lib/nodeTemplateFile.js";

async function listen(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(buildApp(createTestRuntimeContext({ config })));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      // Dong ca socket dang giu truoc: fetch cua Node giu ket noi lai theo
      // origin, ma origin o day la "127.0.0.1:<cong ngau nhien>" - he dieu hanh
      // cap lai dung cong do cho may chu cua bai ke tiep thi lan fetch sau boc
      // phai socket da chet va bao "fetch failed".
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

const graph = () => ({
  nodes: [
    { id: "a", type: "prompt", position: { x: 0, y: 0 }, data: { prompt: "a red kite" } },
    { id: "b", type: "image", position: { x: 200, y: 0 }, data: { prompt: "closer" } },
  ],
  edges: [{ id: "a-b", source: "a", target: "b" }],
});

async function nhap(base: string, body: unknown) {
  const res = await fetch(`${base}/api/node-templates/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("portable node templates", () => {
  it("NTX-01 exports a template as an ima2 template file named after it", async () => {
    const running = await listen();
    const template = await nodeTemplateStore.create({ name: `Xuất thử ${Date.now()}`, graph: graph() });
    try {
      const res = await fetch(`${running.base}/api/node-templates/${template.id}/export`);
      assert.equal(res.status, 200);
      assert.match(
        res.headers.get("content-disposition") || "",
        /attachment; filename="xuat-thu-[0-9]+\.ima2-template\.json"/,
      );
      const tep = (await res.json()) as Record<string, any>;
      assert.equal(tep.kind, "ima2.node-template");
      assert.equal(tep.version, 1);
      assert.equal(tep.name, template.name);
      assert.equal(tep.graph.nodes.length, 2);
    } finally { await nodeTemplateStore.remove(template.id); await running.close(); }
  });

  it("NTX-02 imports an exported file back as a separate user template", async () => {
    const running = await listen();
    const goc = await nodeTemplateStore.create({ name: `Vòng tròn ${Date.now()}`, graph: graph() });
    let moiId: string | null = null;
    try {
      const tep = await (await fetch(`${running.base}/api/node-templates/${goc.id}/export`)).json();
      const { status, body } = await nhap(running.base, tep);
      assert.equal(status, 201);
      moiId = body.template.id as string;
      assert.notEqual(moiId, goc.id);
      assert.equal(body.template.source, "user");
      assert.equal(body.template.nodeCount, 2);
      // Cai mang sang may khac phai la HINH KHUON, khong phai chi cai ten.
      const graphMoi = await nodeTemplateStore.instantiate(moiId!);
      assert.equal(graphMoi.edges.length, 1);
      assert.match(JSON.stringify(graphMoi), /a red kite/);
    } finally {
      if (moiId) await nodeTemplateStore.remove(moiId);
      await nodeTemplateStore.remove(goc.id);
      await running.close();
    }
  });

  it("NTX-03 exports a seed template too, and it lands as an editable user template", async () => {
    const running = await listen();
    let moiId: string | null = null;
    try {
      const seed = nodeTemplateSeeds[0]!;
      const tep = await (await fetch(`${running.base}/api/node-templates/${seed.id}/export`)).json();
      const { status, body } = await nhap(running.base, tep);
      assert.equal(status, 201);
      moiId = body.template.id as string;
      assert.equal(body.template.source, "user");
      // Ban goc la seed nen khong sua duoc; ban vua nhap thi phai sua duoc.
      const doiTen = await nodeTemplateStore.update(moiId!, { name: "Seed đã nhập" });
      assert.equal(doiTen.name, "Seed đã nhập");
    } finally {
      if (moiId) await nodeTemplateStore.remove(moiId);
      await running.close();
    }
  });

  it("NTX-04 refuses a file that is not a template export", async () => {
    const running = await listen();
    try {
      assert.equal((await nhap(running.base, { hello: "world" })).body.error.code, "TEMPLATE_FILE_KIND");
      const { status, body } = await nhap(running.base, {
        kind: "ima2.node-template", version: 99, name: "x", graph: graph(),
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, "TEMPLATE_FILE_VERSION");
    } finally { await running.close(); }
  });

  it("NTX-05 refuses a file over the node ceiling", async () => {
    const running = await listen();
    try {
      const nodes = Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, position: { x: i, y: 0 }, data: {} }));
      const { status, body } = await nhap(running.base, {
        kind: "ima2.node-template", version: 1, name: "To quá", graph: { nodes, edges: [] },
      });
      assert.equal(status, 413);
      assert.equal(body.error.code, "TEMPLATE_FILE_TOO_LARGE");
    } finally { await running.close(); }
  });

  it("NTX-06 never lets a secret in an imported file reach the database", async () => {
    const running = await listen();
    let moiId: string | null = null;
    try {
      const doc = {
        kind: "ima2.node-template", version: 1, name: `Bí mật ${Date.now()}`,
        graph: {
          nodes: [{ id: "a", position: { x: 0, y: 0 }, data: { apiKey: "sk-should-not-survive", prompt: "ok" } }],
          edges: [],
        },
      };
      const { status, body } = await nhap(running.base, doc);
      assert.equal(status, 201);
      moiId = body.template.id as string;
      const luu = await nodeTemplateStore.get(moiId!);
      assert.doesNotMatch(JSON.stringify(luu), /should-not-survive/);
    } finally {
      if (moiId) await nodeTemplateStore.remove(moiId);
      await running.close();
    }
  });

  it("NTX-07 keeps an existing template when a file has the same name", async () => {
    const running = await listen();
    const ten = `Trùng tên ${Date.now()}`;
    const goc = await nodeTemplateStore.create({ name: ten, graph: graph() });
    let moiId: string | null = null;
    try {
      const { body } = await nhap(running.base, {
        kind: "ima2.node-template", version: 1, name: ten, graph: graph(),
      });
      moiId = body.template.id as string;
      assert.equal(body.template.name, `${ten} (2)`);
      assert.equal((await nodeTemplateStore.get(goc.id))?.name, ten);
    } finally {
      if (moiId) await nodeTemplateStore.remove(moiId);
      await nodeTemplateStore.remove(goc.id);
      await running.close();
    }
  });

  it("NTX-08 reads /import as the import route, not as a template id", async () => {
    // "/import" dang ky SAU cac route ":id" thi Express doc no thanh mot ma
    // template - loi do im lang, chi hien ra bang 404 TEMPLATE_NOT_FOUND.
    const running = await listen();
    try {
      assert.equal((await nhap(running.base, { hello: 1 })).status, 400);
    } finally { await running.close(); }
  });

  it("NTX-09 builds a file name a file system accepts", () => {
    assert.equal(tenTepXuat("Idol Kpop · Đổi đồ"), "idol-kpop-doi-do.ima2-template.json");
    assert.equal(tenTepXuat("Khuôn ĐẸP"), "khuon-dep.ima2-template.json");
    assert.equal(tenTepXuat("///"), "template.ima2-template.json");
  });

  it("NTX-10 round-trips through the pure file module without a server", () => {
    const doc = taoTepXuat({
      id: "template_x", name: "Khuôn", description: "d", source: "user", tags: ["a"],
      graph: graph(), version: 1, createdAt: 1, updatedAt: 1,
    });
    const lai = docTepNhap(JSON.parse(JSON.stringify(doc)));
    assert.equal(lai.name, "Khuôn");
    assert.equal(lai.graph.nodes.length, 2);
    assert.equal(tenKhongTrung("Khuôn", ["khuôn"]), "Khuôn (2)");
    assert.equal(tenKhongTrung("Khác", ["khuôn"]), "Khác");
    // express.json() chan mot chuoi tran truoc khi vao route, nen kiem o day.
    assert.throws(() => docTepNhap("just a string"), /JSON object/);
    assert.throws(
      () => docTepNhap({ kind: "ima2.node-template", version: 1, name: "x", graph: { nodes: [], edges: [] } }),
      /at least one node/,
    );
  });

  it("NTX-11 wires export and import into the template picker", () => {
    const picker = readFileSync("ui/src/components/node-canvas/NodeTemplatePicker.tsx", "utf-8");
    const controller = readFileSync("ui/src/components/node-canvas/useNodeTemplateController.ts", "utf-8");
    const overlays = readFileSync("ui/src/components/node-canvas/NodeStudioOverlays.tsx", "utf-8");
    assert.match(picker, /onImport\?\(file: File\): void/);
    assert.match(picker, /type="file"/);
    // Chon lai dung mot tep thi input khong phat change neu gia tri con do.
    assert.match(picker, /event\.target\.value = ""/);
    assert.match(controller, /xuatTemplate/);
    assert.match(controller, /nhapTemplate/);
    assert.match(overlays, /onExport=\{studio\.exportTemplate\}/);
    assert.match(overlays, /onImport=\{studio\.importTemplate\}/);
  });
});
