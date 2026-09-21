import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-wf-api-"));
process.env.IMA2_CONFIG_DIR = TEST_DIR;
process.env.IMA2_DB_PATH = join(TEST_DIR, "sessions.db");

const { registerWorkflowRoutes } = await import("../routes/workflow.ts");
const store = await import("../lib/sessionStore.ts");
const bus = await import("../lib/eventBus.ts");
const db = await import("../lib/db.ts");

after(() => {
  db.closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

type Goi = { duong: string; than: Record<string, unknown> };

/**
 * May chu GIA dong vai cac tuyen sinh anh / sinh video / ghep video.
 *
 * Bo chay khuon goi vong qua HTTP cua chinh may chu, nen thay cong sinh anh bang
 * mot cong gia la du de kiem TOAN BO duong di - thu tu node, ke thua anh, ghi
 * vao graph, ket qua o node KET THUC - ma khong goi mot mo hinh nao.
 */
async function moCongGia(ghiNhan: Goi[], hong: Set<string> = new Set()) {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  let dem = 0;
  app.post("/api/node/generate", (req, res) => {
    ghiNhan.push({ duong: "/api/node/generate", than: req.body });
    if (hong.has(String(req.body.clientNodeId))) {
      return res.status(500).json({ error: { code: "FAKE_FAILED", message: "hong theo kich ban" } });
    }
    dem += 1;
    const nodeId = `n_gia${dem}`;
    res.json({ nodeId, url: `/generated/${nodeId}.png`, filename: `${nodeId}.png` });
  });
  app.post("/api/video/generate", (req, res) => {
    ghiNhan.push({ duong: "/api/video/generate", than: req.body });
    const requestId = String(req.body.requestId);
    res.status(202).json({ ok: true });
    // Bo chay nghe tren bus su kien NGAY TRONG tien trinh, dung nguon ma giao
    // dien dung - nen cong gia chi can dang mot su kien "done".
    setTimeout(() => bus.publish(requestId, "done", {
      url: "/generated/v_gia.mp4", filename: "v_gia.mp4",
    }), 5);
  });
  app.post("/api/media/merge", (req, res) => {
    ghiNhan.push({ duong: "/api/media/merge", than: req.body });
    res.json({ ok: true, url: "/generated/ghep.mp4", filename: "ghep.mp4" });
  });
  const server = await new Promise<Server>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  return { server, port: (server.address() as AddressInfo).port };
}

async function moApiKhuon(congPort: number) {
  const app = express();
  app.use(express.json({ limit: "20mb" }));
  registerWorkflowRoutes(app, { serverActualPort: congPort });
  const server = await new Promise<Server>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function dong(...servers: Server[]) {
  return Promise.all(servers.map((s) => new Promise<void>((ok) => s.close(() => ok()))));
}

async function goi(base: string, duong: string, method = "GET", than?: unknown) {
  const res = await fetch(`${base}${duong}`, {
    method,
    ...(than === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(than),
    }),
  });
  return { status: res.status, body: await res.json() as Record<string, any> };
}

function node(id: string, vaiTro: string | null, prompt = "") {
  return {
    id, x: 0, y: 0,
    data: { clientId: id, prompt, imageUrl: null, status: "empty", serverNodeId: null, ...(vaiTro ? { vaiTro } : {}) },
  };
}

/** Phien co chuoi BAT DAU -> cac buoc -> KET THUC, san sang chay. */
function taoPhien(buoc: { id: string; vaiTro: string | null; prompt?: string }[]) {
  const phien = store.createSession({ title: "khuon kiem thu" }) as { id: string };
  const nodes = [
    node("start", "bat-dau"),
    ...buoc.map((b) => node(b.id, b.vaiTro, b.prompt ?? "")),
    node("end", "ket-thuc"),
  ];
  const edges = [
    { id: "e0", source: "start", target: buoc[0]!.id },
    ...buoc.slice(1).map((b, i) => ({ id: `e${i + 1}`, source: buoc[i]!.id, target: b.id })),
    { id: "ez", source: buoc[buoc.length - 1]!.id, target: "end" },
  ];
  store.saveGraph(phien.id, { nodes, edges, expectedVersion: null });
  return phien.id;
}

async function voiApi(fn: (t: { base: string; ghiNhan: Goi[] }) => Promise<void>, hong?: Set<string>) {
  const ghiNhan: Goi[] = [];
  const cong = await moCongGia(ghiNhan, hong);
  const api = await moApiKhuon(cong.port);
  try { await fn({ base: api.base, ghiNhan }); }
  finally { await dong(cong.server, api.server); }
}

describe("workflow API contracts", () => {
  it("WFAPI-01 liet ke moi node BAT DAU cung trang thai san sang cua no", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    // Phien thu hai co moc dau nhung KHONG noi toi KET THUC: phai liet ke ra kem
    // ly do, khong thi nguoi dung khong hieu vi sao goi vao thi bao loi.
    const que = store.createSession({ title: "thieu ket thuc" }) as { id: string };
    store.saveGraph(que.id, {
      nodes: [node("start", "bat-dau"), node("canh", "canh", "x")],
      edges: [{ id: "e", source: "start", target: "canh" }],
      expectedVersion: null,
    });
    await voiApi(async ({ base }) => {
      const { body } = await goi(base, "/api/wf");
      const ok = body.workflows.find((w: any) => w.sessionId === day);
      const thieu = body.workflows.find((w: any) => w.sessionId === que.id);
      assert.equal(ok.ready, true);
      assert.equal(ok.steps, 1);
      assert.equal(ok.path, `/api/wf/${day}/start`);
      assert.equal(thieu.ready, false);
      assert.equal(thieu.reason, "thieu-ket-thuc");
    });
  });

  it("WFAPI-02 mo ta khuon liet ke dung cac buoc va cac o trong can dien", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle in {{NOI_CHON}}" },
      { id: "vid", vaiTro: "video", prompt: "" },
    ]);
    await voiApi(async ({ base }) => {
      const { status, body } = await goi(base, `/api/wf/${day}/start`);
      assert.equal(status, 200);
      assert.equal(body.soViec, 2);
      assert.equal(body.ketThuc, "end");
      assert.deepEqual(body.inputs, ["MAU_SAC", "NOI_CHON"]);
      assert.deepEqual(body.buoc.map((b: any) => [b.nodeId, b.viec]), [["canh", "anh"], ["vid", "video"]]);
    });
  });

  it("WFAPI-03 tu choi truoc khi ton tien khi thieu dau vao hoac goi sai cho", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle" }]);
    await voiApi(async ({ base, ghiNhan }) => {
      const thieu = await goi(base, `/api/wf/${day}/start`, "POST", {});
      assert.equal(thieu.status, 400);
      assert.equal(thieu.body.error.code, "WF_INPUT_MISSING");
      assert.deepEqual(thieu.body.error.missing, ["MAU_SAC"]);

      const saiTen = await goi(base, `/api/wf/${day}/start`, "POST", { inputs: { "mau sac": "do" } });
      assert.equal(saiTen.status, 400);
      assert.equal(saiTen.body.error.code, "WF_INPUT_INVALID");

      const saiAnh = await goi(base, `/api/wf/${day}/start`, "POST",
        { inputs: { MAU_SAC: "do" }, images: { khong_co: ["data:image/png;base64,AA=="] } });
      assert.equal(saiAnh.status, 400);
      assert.equal(saiAnh.body.error.code, "WF_IMAGE_NODE_UNKNOWN");

      // Anh phai la data URL: nhan duong dan tep se cho nguoi goi doc tep bat ky.
      const anhLa = await goi(base, `/api/wf/${day}/start`, "POST",
        { inputs: { MAU_SAC: "do" }, images: { canh: ["/etc/passwd"] } });
      assert.equal(anhLa.status, 400);
      assert.equal(anhLa.body.error.code, "WF_IMAGE_INVALID");

      const khongPhaiMoc = await goi(base, `/api/wf/${day}/canh`, "POST", {});
      assert.equal(khongPhaiMoc.status, 400);
      assert.equal(khongPhaiMoc.body.error.code, "WF_CHAIN_KHONG_PHAI_MOC_DAU");

      const khongCoPhien = await goi(base, "/api/wf/s_khong_co/start", "POST", {});
      assert.equal(khongCoPhien.status, 404);

      // Khong mot yeu cau nao duoc di toi cong sinh anh.
      assert.deepEqual(ghiNhan, []);
    });
  });

  it("WFAPI-04 chay het khuon theo thu tu, dien o trong va tra ve ket qua cua node KET THUC", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle" },
      { id: "sau", vaiTro: "canh", prompt: "same circle, larger" },
    ]);
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${day}/start`, "POST",
        { inputs: { MAU_SAC: "bright green" } });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.run.trangThai, "xong");

      // Dung thu tu, va o trong da duoc dien bang gia tri goi vao.
      assert.deepEqual(ghiNhan.map((g) => g.than.clientNodeId), ["canh", "sau"]);
      assert.equal(ghiNhan[0]!.than.prompt, "a bright green circle");
      // Node sau ke thua anh cua node truoc qua parentNodeId.
      assert.equal(ghiNhan[0]!.than.parentNodeId, undefined);
      assert.equal(ghiNhan[1]!.than.parentNodeId, "n_gia1");

      // Node KET THUC quyet dinh cai gi duoc tra ve: media cua nhung node noi
      // thang vao no, o day la node cuoi chuoi.
      assert.deepEqual(body.result.media, [
        { nodeId: "sau", url: "/generated/n_gia2.png", loai: "anh" },
      ]);
      assert.deepEqual(Object.keys(body.result.nodes).sort(), ["canh", "sau"]);

      // Ket qua ghi nguoc vao graph, nen mo giao dien len la thay.
      const phien = store.getSession(day)!;
      const canh = phien.nodes.find((n: any) => n.id === "canh") as any;
      assert.equal(canh.data.imageUrl, "/generated/n_gia1.png");
      assert.equal(canh.data.status, "ready");
      // Prompt khuon KHONG bi ghi de: o trong con nguyen cho lan goi sau.
      assert.equal(canh.data.prompt, "a {{MAU_SAC}} circle");
    });
  });

  it("WFAPI-05 dung han o node dau tien hong, khong chay tiep cac node phia sau", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "mot canh" },
      { id: "sau", vaiTro: "canh", prompt: "canh sau" },
    ]);
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${day}/start`, "POST", {});
      assert.equal(status, 500);
      assert.equal(body.ok, false);
      assert.equal(body.run.trangThai, "hong");
      assert.equal(body.error.nodeId, "canh");
      assert.equal(body.error.code, "FAKE_FAILED");
      // Node "sau" an anh cua node vua hong - chay tiep chi ton tien de ra rac.
      assert.deepEqual(ghiNhan.map((g) => g.than.clientNodeId), ["canh"]);
      assert.equal(body.run.buoc[1].trangThai, "cho");
    }, new Set(["canh"]));
  });

  it("WFAPI-06 node VIDEO va node GOP VIDEO di dung cong cua chung", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "mot canh" },
      { id: "vid", vaiTro: "video", prompt: "may quay xoay cham" },
      { id: "gop", vaiTro: "gop-video", prompt: "" },
    ]);
    // Node GOP can it nhat hai muc: noi them mot canh thu hai vao no.
    const phien = store.getSession(day)!;
    store.saveGraph(day, {
      nodes: [...phien.nodes, { id: "vid2", x: 0, y: 0, data: { clientId: "vid2", prompt: "clip hai", vaiTro: "video", imageUrl: null, status: "empty", serverNodeId: null } }],
      edges: [...phien.edges, { id: "ev2", source: "canh", target: "vid2" }, { id: "eg2", source: "vid2", target: "gop" }],
      expectedVersion: phien.graphVersion,
    });
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${day}/start`, "POST", {});
      assert.equal(status, 200, JSON.stringify(body.error ?? {}));
      const duong = ghiNhan.map((g) => g.duong);
      assert.deepEqual(duong, [
        "/api/node/generate",
        "/api/video/generate",
        "/api/video/generate",
        "/api/media/merge",
      ]);
      // Node video khong co prompt rieng thi an loi ta cua canh; co thi ghi them.
      const vid = ghiNhan[1]!.than;
      assert.equal(vid.prompt, "mot canh may quay xoay cham");
      // Node GOP nhan dung hai clip cua hai canh vao.
      assert.deepEqual(ghiNhan[3]!.than.items, [
        { filename: "v_gia.mp4" }, { filename: "v_gia.mp4" },
      ]);
      assert.equal(body.result.media[0].url, "/generated/ghep.mp4");
    });
  });

  it("WFAPI-07 che do tra ngay tra runId roi hoi sau, va huy duoc giua chung", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const mo = await goi(base, `/api/wf/${day}/start?async=1`, "POST", {});
      assert.equal(mo.status, 202);
      assert.match(mo.body.runId, /^wfr_/);
      assert.equal(mo.body.statusUrl, `/api/wf/runs/${mo.body.runId}`);

      const cho = await goi(base, `${mo.body.statusUrl}?wait=1`);
      assert.equal(cho.status, 200);
      assert.equal(cho.body.run.trangThai, "xong");

      // Hoi mot luot khong co thi phai la 404, khong phai mot luot rong.
      const khong = await goi(base, "/api/wf/runs/wfr_khong_co");
      assert.equal(khong.status, 404);
      assert.equal(khong.body.error.code, "WF_RUN_NOT_FOUND");

      // Huy mot luot da xong thi khong "huy duoc" nua.
      const huy = await goi(base, `/api/wf/runs/${mo.body.runId}/cancel`, "POST", {});
      assert.equal(huy.body.ok, false);
    });
  });

  it("WFAPI-08 anh dinh kem qua API di vao dung node va len duong sinh anh", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mac bo do nay" }]);
    const anh = "data:image/png;base64,iVBORw0KGgo=";
    await voiApi(async ({ base, ghiNhan }) => {
      const { status } = await goi(base, `/api/wf/${day}/start`, "POST", { images: { canh: [anh] } });
      assert.equal(status, 200);
      // Gui len duoi dang base64 tran, dung nhu giao dien gui.
      assert.deepEqual(ghiNhan[0]!.than.references, ["iVBORw0KGgo="]);
      // Va luu lai tren node de mo giao dien len la thay dung thu da dua vao.
      const canh = store.getSession(day)!.nodes.find((n: any) => n.id === "canh") as any;
      assert.deepEqual(canh.data.referenceImages, [anh]);
    });
  });
});
