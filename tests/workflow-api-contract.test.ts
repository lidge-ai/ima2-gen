import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const runStore = await import("../lib/wfRunStore.ts");
const refStore = await import("../lib/nodeRefStore.ts");
const cfg = (await import("../config.ts")).config;
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
    // Ghi mot tep THAT: buoc doc flat lay ra mo ta se doc tep nay len, khong co
    // tep thi no bo qua trong im lang va bai kiem khong con kiem gi.
    mkdirSync(cfg.storage.generatedDir, { recursive: true });
    writeFileSync(
      join(cfg.storage.generatedDir, `${nodeId}.png`),
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"),
    );
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
  // Buoc doc flat lay ra mo ta di qua day. Cong gia tra ve mot cau co dinh, nen
  // kiem duoc ca duong di ma khong goi mot mo hinh nao.
  app.post("/api/prompt-builder/chat", (req, res) => {
    ghiNhan.push({ duong: "/api/prompt-builder/chat", than: req.body });
    res.json({ message: { content: "a cream cardigan, blue jeans, white sneakers" } });
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

/** Dia chi day du may chu se tra ve khi duoc goi qua `base`. */
function diaChi(base: string, duong: string): string {
  return `http://${new URL(base).host}${duong}`;
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

      // Anh nham vao moc thi khong co tac dung gi - bao ra con hon de im lang.
      const vaoMoc = await goi(base, `/api/wf/${day}/start`, "POST",
        { inputs: { MAU_SAC: "do" }, images: { end: ["data:image/png;base64,AA=="] } });
      assert.equal(vaoMoc.status, 400);
      assert.equal(vaoMoc.body.error.code, "WF_IMAGE_NODE_UNKNOWN");

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
        { nodeId: "sau", url: diaChi(base, "/generated/n_gia2.png"), loai: "anh" },
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
      assert.equal(body.result.media[0].url, diaChi(base, "/generated/ghep.mp4"));
    });
  });

  it("WFAPI-07 che do tra ngay tra runId roi hoi sau, va huy duoc giua chung", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const mo = await goi(base, `/api/wf/${day}/start?async=1`, "POST", {});
      assert.equal(mo.status, 202);
      assert.match(mo.body.runId, /^wfr_/);
      assert.equal(mo.body.statusUrl, diaChi(base, `/api/wf/runs/${mo.body.runId}`));

      // statusUrl la dia chi DAY DU: ghep them base nua se ra mot dia chi vo nghia.
      const cho = await goi("", `${mo.body.statusUrl}?wait=1`);
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
      // Va KHONG ghi vao graph: giong inputs va nodes, anh gui kem chi ap cho
      // luot chay do - goi mot tram lan voi mot tram bo anh van la mot khuon.
      const canh = store.getSession(day)!.nodes.find((n: any) => n.id === "canh") as any;
      assert.equal(canh.data.referenceImages, undefined);
    });
  });
});

describe("workflow node override contracts", () => {
  it("WFGD-01 ghi de noi dung node chi ap cho luot chay do, graph giu nguyen", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle" },
      { id: "sau", vaiTro: "canh", prompt: "same circle, larger" },
    ]);
    await voiApi(async ({ base, ghiNhan }) => {
      const { status } = await goi(base, `/api/wf/${day}/start`, "POST", {
        nodes: {
          canh: { prompt: "a teal square", size: "512x512" },
          sau: { prompt: "same square, red outline" },
        },
      });
      assert.equal(status, 200);
      assert.deepEqual(ghiNhan.map((g) => g.than.prompt), ["a teal square", "same square, red outline"]);
      assert.equal(ghiNhan[0]!.than.size, "512x512");
      // Khuon mau phai con nguyen: goi mot tram lan voi mot tram noi dung khac
      // nhau van la cung mot khuon.
      const nodes = store.getSession(day)!.nodes as any[];
      assert.equal(nodes.find((n) => n.id === "canh").data.prompt, "a {{MAU_SAC}} circle");
      assert.equal(nodes.find((n) => n.id === "canh").data.size, undefined);
      assert.equal(nodes.find((n) => n.id === "sau").data.prompt, "same circle, larger");
    });
  });

  it("WFGD-02 o trong duoc tinh tren prompt HIEU LUC, khong phai prompt trong graph", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle" }]);
    await voiApi(async ({ base }) => {
      // Ghi de bo o trong di thi khong con gi de dien nua.
      const bo = await goi(base, `/api/wf/${day}/start`, "POST",
        { nodes: { canh: { prompt: "a teal square" } } });
      assert.equal(bo.status, 200);

      // Va nguoc lai: ghi de dua VAO mot o trong moi thi phai bao thieu.
      const them = await goi(base, `/api/wf/${day}/start`, "POST",
        { inputs: { MAU_SAC: "teal" }, nodes: { canh: { prompt: "a {{HINH_DANG}} thing" } } });
      assert.equal(them.status, 400);
      assert.deepEqual(them.body.error.missing, ["HINH_DANG"]);
    });
  });

  it("WFGD-03 tu choi ghi de nham cho hoac ghi de thu khong duoc phep", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base, ghiNhan }) => {
      const laNode = await goi(base, `/api/wf/${day}/start`, "POST", { nodes: { khong_co: { prompt: "x" } } });
      assert.equal(laNode.status, 400);
      assert.equal(laNode.body.error.code, "WF_NODE_OVERRIDE_UNKNOWN");

      // Moc khong sinh gi nen khong co gi de ghi de.
      const moc = await goi(base, `/api/wf/${day}/start`, "POST", { nodes: { end: { prompt: "x" } } });
      assert.equal(moc.status, 400);
      assert.equal(moc.body.error.code, "WF_NODE_OVERRIDE_UNKNOWN");

      // Hinh dang khuon la thu nguoi dung ve ra tren canvas: mot lan goi API
      // khong duoc phep ve lai no.
      const vaiTro = await goi(base, `/api/wf/${day}/start`, "POST", { nodes: { canh: { vaiTro: "video" } } });
      assert.equal(vaiTro.status, 400);
      assert.equal(vaiTro.body.error.code, "WF_NODE_OVERRIDE_INVALID");

      const size = await goi(base, `/api/wf/${day}/start`, "POST", { nodes: { canh: { size: "to bang nha" } } });
      assert.equal(size.status, 400);
      assert.equal(size.body.error.code, "WF_NODE_OVERRIDE_INVALID");

      assert.deepEqual(ghiNhan, []);
    });
  });

  it("WFGD-04 ghi de node VIDEO chi thay phan rieng, van ke thua loi ta cua canh", async () => {
    const day = taoPhien([
      { id: "canh", vaiTro: "canh", prompt: "a coffee shop" },
      { id: "vid", vaiTro: "video", prompt: "she turns around" },
    ]);
    await voiApi(async ({ base, ghiNhan }) => {
      const { status } = await goi(base, `/api/wf/${day}/start`, "POST",
        { nodes: { vid: { prompt: "she waves at the camera" } } });
      assert.equal(status, 200);
      // Loi ta cua canh van dung dau; ghi de chi thay phan ghi them cua node video.
      assert.equal(ghiNhan[1]!.than.prompt, "a coffee shop she waves at the camera");
    });
  });

  it("WFGD-05 mo ta khuon kem noi dung hien tai de nguoi goi dung duoc than request", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "a {{MAU_SAC}} circle" }]);
    await voiApi(async ({ base }) => {
      const { body } = await goi(base, `/api/wf/${day}/start`);
      assert.equal(body.buoc[0].prompt, "a {{MAU_SAC}} circle");
      assert.equal(body.buoc[0].nodeId, "canh");
    });
  });

  it("WFGD-07 base64 rac bi chan ngay o tuyen, khong di toi may sinh anh", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base, ghiNhan }) => {
      // Chuoi giu cho trong vi du tren giao dien phai hong o day, voi mot loi
      // noi dung cho sai - khong phai mot loi kho hieu cua nha cung cap.
      const giuCho = await goi(base, `/api/wf/${day}/start`, "POST",
        { images: { canh: ["data:image/png;base64,<base64 cua anh>"] } });
      assert.equal(giuCho.status, 400);
      assert.match(giuCho.body.error.message, /base64/);

      const rong = await goi(base, `/api/wf/${day}/start`, "POST",
        { images: { canh: ["data:image/png;base64,"] } });
      assert.equal(rong.status, 400);

      const that = await goi(base, `/api/wf/${day}/start`, "POST",
        { images: { canh: ["data:image/png;base64,iVBORw0KGgo="] } });
      assert.equal(that.status, 200);
      assert.deepEqual(ghiNhan[0]!.than.references, ["iVBORw0KGgo="]);
    });
  });

  it("WFGD-08 vi du than request luon co phan anh cho node nhan duoc anh", () => {
    const src = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
    // Node CANH va nhung node sau no hau nhu luon co anh dinh kem, nen thieu
    // phan images trong vi du la thieu dung thu nguoi dung can nhat.
    assert.match(src, /than\.images = Object\.fromEntries/);
    // Uu tien node dang co anh; ca khuon khong co node nao thi van phai co mot
    // vi du, khong thi khong ai doan ra cach truyen.
    assert.match(src, /const coSan = nodeTrongKhuon\.filter\(\(n\) => n\.nhanAnh && n\.soAnh > 0\)/);
    assert.match(src, /const dau = nodeTrongKhuon\.find\(\(n\) => n\.nhanAnh\)/);
    // Node GOP lay media tu canh vao, dua no vao vi du se ra than bi tu choi.
    assert.match(src, /nhanAnh: n\.data\.vaiTro !== "gop-video" && n\.data\.vaiTro !== "gop-anh"/);
  });

  it("WFGD-06 node BAT DAU bay than cua MOI node trong khuon, khong chi node noi thang", () => {
    const src = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
    // Dung chuoi chay, khong dung canh noi truc tiep: noi dung that nam rai rac
    // o ca chuoi, chi hien node dau tien thi van phai di tim id cua nhung node kia.
    assert.match(src, /chuoi\.thuTu[\s\S]{0,200}laViecThat/);
    assert.match(src, /than\.nodes = Object\.fromEntries/);
  });
});

describe("workflow outfit + attachment contracts", () => {
  /** Mot tep anh that trong thu muc generated, de bo chay doc len duoc. */
  function tepAnh(ten: string): string {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    );
    mkdirSync(cfg.storage.generatedDir, { recursive: true });
    writeFileSync(join(cfg.storage.generatedDir, ten), png);
    return `/generated/${ten}`;
  }

  /** Khuon that: BOC DO -> MAC DO, node MAC DO dung BOC DO lam THAM CHIEU. */
  function taoKhuonThoiTrang(promptMacDo: string) {
    const phien = store.createSession({ title: "khuon thoi trang" }) as { id: string };
    const nodes = [
      node("start", "bat-dau"),
      node("mau", null, "mot nguoi mau"),
      node("bocdo", "trang-phuc", "boc trang phuc ra flat lay"),
      node("macdo", "mac-do", promptMacDo),
      node("end", "ket-thuc"),
    ];
    // Canh vao DAU TIEN cua macdo la anh nen (mau), canh sau la tham chieu (bocdo).
    const edges = [
      { id: "e0", source: "start", target: "bocdo" },
      { id: "e1", source: "mau", target: "macdo" },
      { id: "e2", source: "bocdo", target: "macdo" },
      { id: "e3", source: "macdo", target: "end" },
    ];
    // Node "mau" phai co san anh: no khong nam trong khuon nen khong duoc chay.
    nodes[1]!.data.serverNodeId = "n_mau";
    (nodes[1]!.data as Record<string, unknown>).imageUrl = "/generated/n_mau.png";
    store.saveGraph(phien.id, { nodes, edges, expectedVersion: null });
    return phien.id;
  }

  const PROMPT_MAC_DO =
    "Keep the exact same face. She wears: an off-white shirt printed with mountain landscapes. "
    + "Use the reference image for the garments.";

  it("WFTP-01 BOC DO tu doc lai mo ta, node sau nhan do MOI chu khong phai do cu", async () => {
    const day = taoKhuonThoiTrang(PROMPT_MAC_DO);
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${day}/start`, "POST", {});
      assert.equal(status, 200, JSON.stringify(body.error ?? {}));

      // Flat lay vua sinh xong thi phai duoc doc ra mo ta ngay.
      const doc = ghiNhan.find((g) => g.duong === "/api/prompt-builder/chat");
      assert.ok(doc, "phai co buoc doc flat lay ra mo ta");

      const macDo = ghiNhan.filter((g) => g.duong === "/api/node/generate")
        .find((g) => g.than.clientNodeId === "macdo")!;
      // Day la loi hong that da xay ra: doi anh trang phuc roi ma node MAC DO
      // van mang nguyen cau ta bo do cu, nen ket qua ra dung bo do cu.
      assert.match(String(macDo.than.prompt), /She wears: a cream cardigan, blue jeans, white sneakers\./);
      assert.doesNotMatch(String(macDo.than.prompt), /mountain landscapes/);
      // Va flat lay duoc dinh vao duong THAM CHIEU manh, khong chi qua canh ref.
      assert.equal((macDo.than.references as string[] | undefined)?.length, 1);

      // Graph giu nguyen: khuon mau phai doc lai tu dau o lan goi sau.
      const nodes = store.getSession(day)!.nodes as any[];
      assert.equal(nodes.find((n) => n.id === "macdo").data.prompt, PROMPT_MAC_DO);
    });
  });

  it("WFTP-07 doi loi ta o MOI node phia sau, khong chi node tham chieu truc tiep", async () => {
    // Dung hinh dang da lam hong that: BOC DO -> MAC DO -> CANH. Node CANH lay
    // anh nguoi da mac lam anh NEN nen khong co canh nao noi ve node trang phuc,
    // ma no van mang cau ta bo do - nen no mac lai dung bo do cu.
    const phien = store.createSession({ title: "chuoi ba buoc" }) as { id: string };
    const nodes = [
      node("start", "bat-dau"),
      node("mau", null, "mot nguoi mau"),
      node("bocdo", "trang-phuc", "boc trang phuc"),
      node("macdo", "mac-do", PROMPT_MAC_DO),
      node("canh", "canh", PROMPT_MAC_DO + " In a coffee shop."),
      node("end", "ket-thuc"),
    ];
    nodes[1]!.data.serverNodeId = "n_mau";
    (nodes[1]!.data as Record<string, unknown>).imageUrl = "/generated/n_mau.png";
    store.saveGraph(phien.id, {
      nodes,
      edges: [
        { id: "e0", source: "start", target: "bocdo" },
        { id: "e1", source: "mau", target: "macdo" },
        { id: "e2", source: "bocdo", target: "macdo" },
        { id: "e3", source: "macdo", target: "canh" },
        { id: "e4", source: "canh", target: "end" },
      ],
      expectedVersion: null,
    });
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${phien.id}/start`, "POST", {});
      assert.equal(status, 200, JSON.stringify(body.error ?? {}));
      const gui = ghiNhan.filter((g) => g.duong === "/api/node/generate");
      for (const id of ["macdo", "canh"]) {
        const g = gui.find((x) => x.than.clientNodeId === id)!;
        assert.match(String(g.than.prompt), /She wears: a cream cardigan/, `${id} phai nhan do moi`);
        assert.doesNotMatch(String(g.than.prompt), /mountain landscapes/, `${id} van mang do cu`);
      }
      // Nhung flat lay chi dinh vao node tham chieu TRUC TIEP: node CANH da co
      // anh nen la nguoi da mac, dinh them vao do chi lam loang dau vao.
      assert.equal((gui.find((x) => x.than.clientNodeId === "macdo")!.than.references as string[]).length, 1);
      assert.equal(gui.find((x) => x.than.clientNodeId === "canh")!.than.references, undefined);
    });
  });

  it("WFTP-09 node VIDEO ke thua loi ta DA DOI cua node canh, khong phai ban trong graph", async () => {
    // Node VIDEO lay loi ta cua node canh lam dau vao. Neu doc prompt cha thang
    // tu graph thi no mang cau ta bo do CU va video ra bo do cu, du ba buoc anh
    // truoc da dung. Dung loi da xay ra.
    const phien = store.createSession({ title: "chuoi co video" }) as { id: string };
    const nodes = [
      node("start", "bat-dau"),
      node("mau", null, "mot nguoi mau"),
      node("bocdo", "trang-phuc", "boc trang phuc"),
      node("macdo", "mac-do", PROMPT_MAC_DO),
      node("canh", "canh", PROMPT_MAC_DO + " In a coffee shop."),
      node("vid", "video", ""),
      node("end", "ket-thuc"),
    ];
    nodes[1]!.data.serverNodeId = "n_mau";
    (nodes[1]!.data as Record<string, unknown>).imageUrl = "/generated/n_mau.png";
    store.saveGraph(phien.id, {
      nodes,
      edges: [
        { id: "e0", source: "start", target: "bocdo" },
        { id: "e1", source: "mau", target: "macdo" },
        { id: "e2", source: "bocdo", target: "macdo" },
        { id: "e3", source: "macdo", target: "canh" },
        { id: "e4", source: "canh", target: "vid" },
        { id: "e5", source: "vid", target: "end" },
      ],
      expectedVersion: null,
    });
    await voiApi(async ({ base, ghiNhan }) => {
      const { status, body } = await goi(base, `/api/wf/${phien.id}/start`, "POST", {});
      assert.equal(status, 200, JSON.stringify(body.error ?? {}));
      const video = ghiNhan.find((g) => g.duong === "/api/video/generate")!;
      assert.match(String(video.than.prompt), /She wears: a cream cardigan/);
      assert.doesNotMatch(String(video.than.prompt), /mountain landscapes/);
    });
  });

  it("WFTP-02 prompt khong co khuon 'She wears' thi khong bi sua gi", async () => {
    const day = taoKhuonThoiTrang("Keep the exact same face. Put her in a coffee shop.");
    await voiApi(async ({ base, ghiNhan }) => {
      await goi(base, `/api/wf/${day}/start`, "POST", {});
      const macDo = ghiNhan.filter((g) => g.duong === "/api/node/generate")
        .find((g) => g.than.clientNodeId === "macdo")!;
      assert.equal(macDo.than.prompt, "Keep the exact same face. Put her in a coffee shop.");
      // Van dinh flat lay vao: chinh no la thu giu duoc chi tiet bo do.
      assert.equal((macDo.than.references as string[] | undefined)?.length, 1);
    });
  });

  it("WFTP-03 khong truyen images thi lay anh nguoi dung da dinh o giao dien", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    const url = tepAnh(`ref_${Date.now()}.png`);
    refStore.datRefCuaNode(day, "canh", [url]);
    await voiApi(async ({ base, ghiNhan }) => {
      await goi(base, `/api/wf/${day}/start`, "POST", {});
      // Truoc day anh dinh nam o localStorage nen may chu khong he thay: doi anh
      // tren giao dien xong goi API van ra ket qua cu.
      assert.equal((ghiNhan[0]!.than.references as string[]).length, 1);

      // API truyen anh thi anh do THAY THE anh da dinh, khong cong them.
      ghiNhan.length = 0;
      await goi(base, `/api/wf/${day}/start`, "POST",
        { images: { canh: ["data:image/png;base64,iVBORw0KGgo="] } });
      assert.deepEqual(ghiNhan[0]!.than.references, ["iVBORw0KGgo="]);
    });
  });

  it("WFTP-04 anh dinh luu duoc, doc lai duoc, va don theo node da xoa", () => {
    const phien = store.createSession({ title: "kho anh dinh" }) as { id: string };
    refStore.datRefCuaNode(phien.id, "a", ["/generated/x.png", "/generated/y.png"]);
    refStore.datRefCuaNode(phien.id, "b", ["/generated/z.png"]);
    assert.deepEqual(refStore.refCuaNode(phien.id, "a"), ["/generated/x.png", "/generated/y.png"]);
    assert.deepEqual(Object.keys(refStore.refCuaPhien(phien.id)).sort(), ["a", "b"]);
    // Dat lai la THAY toan bo, khong cong don.
    refStore.datRefCuaNode(phien.id, "a", ["/generated/x.png"]);
    assert.deepEqual(refStore.refCuaNode(phien.id, "a"), ["/generated/x.png"]);
    // Node bi xoa khoi graph thi anh cua no thanh rac khong ai doc nua.
    assert.equal(refStore.donRefMoCoi(phien.id, ["a"]), 1);
    assert.deepEqual(Object.keys(refStore.refCuaPhien(phien.id)), ["a"]);
  });

  it("WFTP-05 chi nhan data URL anh that hoac duong trong generated", async () => {
    const dir = cfg.storage.generatedDir;
    // Duong dan tuy y thi doc duoc tep bat ky tren may; dia chi ngoai thi bien
    // may chu thanh cong cu tai ho noi dung la.
    await assert.rejects(() => refStore.chuanHoaRef(dir, ["/etc/passwd"]), /khong nhan duong dan/);
    await assert.rejects(() => refStore.chuanHoaRef(dir, ["https://x.test/a.png"]), /khong nhan duong dan/);
    await assert.rejects(() => refStore.chuanHoaRef(dir, ["/generated/../../secret"]), /khong nhan duong dan/);
    // MIME khai bao khong khop byte thi hong o tan ben sinh anh, chan tu day.
    await assert.rejects(
      () => refStore.chuanHoaRef(dir, ["data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQ=="]),
      /khong khop/,
    );
    await assert.rejects(
      () => refStore.chuanHoaRef(dir, Array(9).fill("/generated/a.png")),
      /toi da/,
    );
    assert.deepEqual(await refStore.chuanHoaRef(dir, ["/generated/a.png"]), ["/generated/a.png"]);
  });

  it("WFTP-08 boc do la doc mo ta luon, khong con nut rieng de nho bam", () => {
    const src = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
    // Boc do ma khong doc lai mo ta thi cac node sau van mang cau ta bo do
    // truoc, va chu moi la thu quyet dinh mac gi - bo do cu se quay lai. De
    // nguoi dung phai nho bam them mot nut la de san mot cai bay.
    assert.match(src, /const laNodeBocDo = d\.vaiTro === "trang-phuc";/);
    assert.match(src, /generateNode\(id\)\.then\(sauKhiSinh\)/);
    assert.match(src, /generateNodeInPlace\(id\)\.then\(sauKhiSinh\)/);
    assert.doesNotMatch(src, /node\.readOutfit/);
    // Doc graph tu store, khong tu closure: anh moi chi co trong store.
    assert.match(src, /const st = useAppStore\.getState\(\);/);
    // Va node con ban trong luc doc, khong bao "xong" som.
    assert.match(src, /\|\| nodeDangChayTuApi \|\| dangDocDo;/);
  });

  it("WFTP-06 giao dien va may chu dung chung mot khuon 'She wears'", () => {
    // Hai ban rieng thi nut "Doc bo do" tren giao dien va luot chay qua API se
    // thay hai doan khac nhau trong cung mot prompt.
    const uiSrc = readFileSync("ui/src/lib/moTaTrangPhuc.ts", "utf-8");
    assert.match(uiSrc, /from "\.\.\/\.\.\/\.\.\/lib\/moTaTrangPhuc\.js"/);
    assert.match(uiSrc, /content: CAU_HOI_MO_TA/);
    const engine = readFileSync("lib/wfEngine.ts", "utf-8");
    assert.match(engine, /thayMoTaTrongPrompt/);
    assert.match(engine, /CAU_HOI_MO_TA/);
  });
});

describe("workflow absolute url contracts", () => {
  it("WFURL-01 moi dia chi tra ve la day du, va doi theo nguon goi", async () => {
    const day = taoPhien([{ id: "a", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const chay = await goi(base, `/api/wf/${day}/start`, "POST", {});
      // Goi tu dau thi nhan dia chi cua chinh cho do: mot goc co dinh se tra ve
      // dia chi ma nguoi goi khong voi toi duoc.
      assert.equal(chay.body.run.buoc[0].url, diaChi(base, "/generated/n_gia1.png"));
      assert.equal(chay.body.result.media[0].url, diaChi(base, "/generated/n_gia1.png"));
      assert.equal(chay.body.result.nodes.a.url, diaChi(base, "/generated/n_gia1.png"));

      const runId = chay.body.run.id as string;
      // fetch khong cho dat tieu de Host (ten bi cam), nen goi qua mot TEN KHAC
      // cung tro ve 127.0.0.1 - dung co che that chu khong gia lap.
      const cong2 = new URL(base).port;
      const khac = await goi(`http://localhost:${cong2}`, `/api/wf/runs/${runId}`);
      assert.equal(khac.body.run.buoc[0].url, `http://localhost:${cong2}/generated/n_gia1.png`);

      // Nhung KHONG luu dia chi day du xuong co so du lieu: host la thuoc tinh
      // cua lan goi, khong phai cua tep. Luu vao thi doi cong la lich su tro sai.
      assert.equal(runStore.layLuotChay(runId)?.buoc[0]?.url, "/generated/n_gia1.png");
    });
  });

  it("WFURL-02 duong hoi, duong nghe va dia chi khuon cung la day du", async () => {
    const day = taoPhien([{ id: "a", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const mo = await goi(base, `/api/wf/${day}/start?async=1`, "POST", {});
      assert.equal(mo.body.statusUrl, diaChi(base, `/api/wf/runs/${mo.body.runId}`));
      assert.equal(mo.body.streamUrl, diaChi(base, `/api/wf/runs/${mo.body.runId}/stream`));

      const ds = await goi(base, "/api/wf");
      const w = ds.body.workflows.find((x: any) => x.sessionId === day);
      // `path` cu van con cho ai da dung no; `url` la ban day du.
      assert.equal(w.path, `/api/wf/${day}/start`);
      assert.equal(w.url, diaChi(base, `/api/wf/${day}/start`));

      const mota = await goi(base, `/api/wf/${day}/start`);
      assert.equal(mota.body.url, diaChi(base, `/api/wf/${day}/start`));
    });
  });

  it("WFURL-03 giao dien chep dia chi may chu ghep, khong tu ghep lai", () => {
    const panel = readFileSync("ui/src/components/node-canvas/WfRunnerPanel.tsx", "utf-8");
    // Tu ghep o trinh duyet se ra dia chi cua trinh duyet, khong phai cua nguoi
    // se goi API - hai cai khac nhau ngay khi mo giao dien qua LAN.
    assert.match(panel, /writeText\(k\.url\)/);
    assert.doesNotMatch(panel, /window\.location\.origin\}\$\{k\.path\}/);
  });
});

describe("workflow streaming contracts", () => {
  /** Doc mot duong SSE cho toi khi gap `wf_end`, tra ve tung khung mot. */
  async function docSse(res: Response, hanMs = 20_000): Promise<{ suKien: string; du: any }[]> {
    const khung: { suKien: string; du: any }[] = [];
    const doc = res.body!.getReader();
    const giaiMa = new TextDecoder();
    let dem = "";
    const han = setTimeout(() => void doc.cancel(), hanMs);
    try {
      for (;;) {
        const { done, value } = await doc.read();
        if (done) break;
        dem += giaiMa.decode(value, { stream: true });
        let i: number;
        while ((i = dem.indexOf("\n\n")) >= 0) {
          const kh = dem.slice(0, i);
          dem = dem.slice(i + 2);
          const suKien = /^event: (.+)$/m.exec(kh)?.[1];
          const du = /^data: (.+)$/m.exec(kh)?.[1];
          if (!suKien || !du) continue;
          khung.push({ suKien, du: JSON.parse(du) });
        }
        if (khung.some((k) => k.suKien === "wf_end")) break;
      }
    } finally {
      clearTimeout(han);
      await doc.cancel().catch(() => {});
    }
    return khung;
  }

  it("WFST-01 xong buoc nao tra buoc do, va ket thuc kem ca ket qua", async () => {
    const day = taoPhien([
      { id: "a", vaiTro: "canh", prompt: "canh mot" },
      { id: "b", vaiTro: "canh", prompt: "canh hai" },
    ]);
    await voiApi(async ({ base }) => {
      const res = await fetch(`${base}/api/wf/${day}/start?stream=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      const khung = await docSse(res);

      assert.equal(khung[0]!.suKien, "wf_start");
      assert.equal(khung[0]!.du.tong, 2);
      // Moi buoc bay ra hai lan: luc bat dau va luc xong.
      const xong = khung.filter((k) => k.suKien === "wf_step" && k.du.trangThai === "xong");
      assert.deepEqual(xong.map((k) => k.du.nodeId), ["a", "b"]);
      assert.equal(xong[0]!.du.url, diaChi(base, "/generated/n_gia1.png"));
      assert.equal(xong[0]!.du.daXong, 1);

      // Khung cuoi kem ca luot va ket qua: nguoi goi khong phai goi them mot
      // lan nua chi de lay media.
      const cuoi = khung.at(-1)!;
      assert.equal(cuoi.suKien, "wf_end");
      assert.equal(cuoi.du.ok, true);
      assert.equal(cuoi.du.run.trangThai, "xong");
      assert.equal(cuoi.du.result.media.length, 1);
    });
  });

  it("WFST-02 bam vao mot luot da xong thi tra ket qua ngay roi dong", async () => {
    const day = taoPhien([{ id: "a", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const chay = await goi(base, `/api/wf/${day}/start`, "POST", {});
      const runId = chay.body.run.id as string;
      const res = await fetch(`${base}/api/wf/runs/${runId}/stream`);
      const khung = await docSse(res);
      // De nguoi goi treo cho mot thu da ket thuc la mot duong khong bao gio dong.
      assert.equal(khung.length, 1);
      assert.equal(khung[0]!.suKien, "wf_end");
      assert.equal(khung[0]!.du.run.id, runId);

      const khong = await fetch(`${base}/api/wf/runs/wfr_khong_co/stream`);
      assert.equal(khong.status, 404);
    });
  });

  it("WFST-03 duong SSE nghe tren res, khong phai tren req", () => {
    // Voi mot POST, req phat "close" ngay khi than yeu cau doc xong - nen nghe
    // tren req la tu ngat chinh minh sau khung dau tien, va duong treo mai. Dung
    // loi da xay ra: luot chay xong binh thuong ma khach hang chi nhan 2 khung.
    const src = readFileSync("routes/workflow.ts", "utf-8");
    assert.match(src, /res\.on\("close"/);
    assert.doesNotMatch(src, /req\.on\("close"/);
  });

  it("WFST-04 che do tra ngay chi ra ca duong hoi va duong nghe", async () => {
    const day = taoPhien([{ id: "a", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const { body } = await goi(base, `/api/wf/${day}/start?async=1`, "POST", {});
      assert.equal(body.statusUrl, diaChi(base, `/api/wf/runs/${body.runId}`));
      assert.equal(body.streamUrl, diaChi(base, `/api/wf/runs/${body.runId}/stream`));
    });
  });

  it("WFST-05 node BAT DAU bay ra ca nam cach goi, moi cach mot lenh chep san", () => {
    const src = readFileSync("ui/src/components/ImageNode.tsx", "utf-8");
    // De nguoi dung tu doan hay di doc tai lieu thi ho chi biet duong mac dinh.
    for (const m of [/\?stream=1/, /\?async=1/, /GET \/api\/wf\/runs\/:runId/, /:runId\/stream/]) {
      assert.match(src, m);
    }
    assert.match(src, /cacTuyen\.map\(\(tuyen\)/);
    // Lenh chep ra phai xuong dong duoc: mot dau gach truoc newline trong
    // template literal bi hieu la noi dong va bay mat.
    assert.match(src, /\\\\\r?\n/);
  });
});

describe("workflow run history contracts", () => {
  it("WFLS-01 mot luot chay con lai trong lich su sau khi tien trinh mat ban nho", async () => {
    const day = taoPhien([{ id: "canh", vaiTro: "canh", prompt: "mot canh" }]);
    await voiApi(async ({ base }) => {
      const chay = await goi(base, `/api/wf/${day}/start`, "POST", { inputs: { A: "x" } });
      assert.equal(chay.status, 200);
      const runId = chay.body.run.id as string;

      // Bo nho bi don sach, dung nhu sau mot lan khoi dong lai.
      runStore.moPhongKhoiDongLai();

      const doc = await goi(base, `/api/wf/runs/${runId}`);
      assert.equal(doc.status, 200);
      assert.equal(doc.body.run.trangThai, "xong");
      // Ca dau vao lan buoc deu con nguyen: do la thu tra loi duoc cau "lan goi
      // do da chay voi gia tri gi va ra cai gi".
      assert.deepEqual(doc.body.run.inputs, { A: "x" });
      assert.equal(doc.body.run.buoc[0].url, diaChi(base, "/generated/n_gia1.png"));
      assert.equal(doc.body.result.media[0].url, diaChi(base, "/generated/n_gia1.png"));
    });
  });

  it("WFLS-02 luot con treo khi may chu tat duoc dong lai luc khoi dong, khong treo mai", () => {
    runStore.luuLuotChay({
      id: "wfr_treo", sessionId: "s_x", startNodeId: "start",
      trangThai: "dang-chay", taoLuc: Date.now(), inputs: {},
      buoc: [
        { nodeId: "a", vaiTro: "canh", viec: "anh", trangThai: "dang-chay" },
        { nodeId: "b", vaiTro: "canh", viec: "anh", trangThai: "cho" },
      ],
    });
    // Tien trinh sinh anh chet theo may chu, nen mot luot "dang chay" con lai
    // trong bang la mot luot khong bao gio ket thuc.
    runStore.moPhongKhoiDongLai();
    const luot = runStore.layLuotChay("wfr_treo")!;
    assert.equal(luot.trangThai, "hong");
    assert.equal(luot.loi?.code, "WF_SERVER_RESTARTED");
    assert.deepEqual(luot.buoc.map((b) => b.trangThai), ["bo-qua", "bo-qua"]);
    assert.ok(typeof luot.xongLuc === "number");
  });

  it("WFLS-03 khoi phuc khong dung toi luot dang that su chay trong tien trinh nay", () => {
    runStore.moPhongKhoiDongLai();
    runStore.taoLuotChay({
      id: "wfr_that", sessionId: "s_y", startNodeId: "start",
      trangThai: "dang-chay", taoLuc: Date.now(), inputs: {},
      buoc: [{ nodeId: "a", vaiTro: null, viec: "anh", trangThai: "dang-chay" }],
    });
    // Lan doc dau tien sau khi dat lai co se chay buoc khoi phuc; no phai chua
    // mot luot dang nam trong bo nho cua tien trinh nay.
    assert.equal(runStore.layLuotChay("wfr_that")?.trangThai, "dang-chay");
    runStore.ketThucLuotChay("wfr_that");
  });

  it("WFLS-04 loc va lat trang theo phien, node va trang thai", () => {
    runStore.xoaHetLuotChay();
    const goc = Date.now() - 10_000;
    for (let i = 0; i < 5; i++) {
      runStore.luuLuotChay({
        id: `wfr_l${i}`, sessionId: i < 3 ? "s_a" : "s_b", startNodeId: i === 0 ? "start2" : "start",
        trangThai: i === 4 ? "hong" : "xong", taoLuc: goc + i * 1000,
        xongLuc: goc + i * 1000 + 5, inputs: {}, buoc: [],
      });
    }
    // Moi nhat truoc.
    assert.deepEqual(runStore.danhSachLuotChay({}).map((l) => l.id),
      ["wfr_l4", "wfr_l3", "wfr_l2", "wfr_l1", "wfr_l0"]);
    assert.deepEqual(runStore.danhSachLuotChay({ sessionId: "s_a" }).map((l) => l.id),
      ["wfr_l2", "wfr_l1", "wfr_l0"]);
    assert.deepEqual(runStore.danhSachLuotChay({ startNodeId: "start2" }).map((l) => l.id), ["wfr_l0"]);
    assert.deepEqual(runStore.danhSachLuotChay({ trangThai: "hong" }).map((l) => l.id), ["wfr_l4"]);
    // Lat trang: lay tiep nhung luot tao TRUOC moc cua trang dau.
    const trang1 = runStore.danhSachLuotChay({ gioiHan: 2 });
    const trang2 = runStore.danhSachLuotChay({ gioiHan: 2, truoc: trang1[1]!.taoLuc });
    assert.deepEqual(trang1.map((l) => l.id), ["wfr_l4", "wfr_l3"]);
    assert.deepEqual(trang2.map((l) => l.id), ["wfr_l2", "wfr_l1"]);
    assert.equal(runStore.demLuotChay({ sessionId: "s_a" }), 3);
  });

  it("WFLS-05 tuyen liet ke tra ve bo loc, tong so va moc lat trang", async () => {
    runStore.xoaHetLuotChay();
    for (let i = 0; i < 3; i++) {
      runStore.luuLuotChay({
        id: `wfr_r${i}`, sessionId: "s_r", startNodeId: "start",
        trangThai: "xong", taoLuc: Date.now() - (3 - i) * 1000, inputs: {}, buoc: [],
      });
    }
    await voiApi(async ({ base }) => {
      const { body } = await goi(base, "/api/wf/runs?sessionId=s_r&limit=2");
      assert.equal(body.runs.length, 2);
      assert.equal(body.total, 3);
      assert.equal(body.nextBefore, body.runs[1].taoLuc);
      const tiep = await goi(base, `/api/wf/runs?sessionId=s_r&limit=2&before=${body.nextBefore}`);
      assert.deepEqual(tiep.body.runs.map((r: any) => r.id), ["wfr_r0"]);
    });
  });

  it("WFLS-06 xoa duoc mot luot da xong, khong xoa duoc luot dang chay", async () => {
    runStore.xoaHetLuotChay();
    runStore.luuLuotChay({
      id: "wfr_xoa", sessionId: "s_x", startNodeId: "start",
      trangThai: "xong", taoLuc: Date.now(), inputs: {}, buoc: [],
    });
    runStore.taoLuotChay({
      id: "wfr_song", sessionId: "s_x", startNodeId: "start",
      trangThai: "dang-chay", taoLuc: Date.now(), inputs: {}, buoc: [],
    });
    await voiApi(async ({ base }) => {
      assert.equal((await goi(base, "/api/wf/runs/wfr_xoa", "DELETE")).status, 200);
      assert.equal(runStore.layLuotChay("wfr_xoa"), null);
      // Xoa so mot luot van dang ton tien chay tiep se lam mat duong theo doi no.
      const song = await goi(base, "/api/wf/runs/wfr_song", "DELETE");
      assert.equal(song.status, 409);
      assert.equal(runStore.layLuotChay("wfr_song")?.trangThai, "dang-chay");
    });
    runStore.ketThucLuotChay("wfr_song");
  });

  it("WFLS-08 mo mot phien thi hoi may chu trang thai luot dang chay, khong doi su kien", () => {
    // Kenh su kien chi noi nhung gi xay ra TU LUC NAY, va giao dien bo qua su
    // kien cua phien khong mo. Nen vao Runner chon dung phien ma chi doi su kien
    // thi node dang sinh khong sang len - da xay ra that.
    const wf = readFileSync("ui/src/store/storeWorkflowImpl.ts", "utf-8");
    assert.match(wf, /export async function napWfApiDangChayImpl/);
    assert.match(wf, /if \(l\.trangThai !== "dang-chay"\) continue;/);
    // Doi phien nhanh tay thi ket qua hoi cu khong duoc de len phien moi.
    assert.match(wf, /if \(get\(\)\.activeSessionId === sessionId\) set\(\{ wfApiChay: dang \}\);/);
    // Va cho goi phai la luc phien duoc mo.
    const phien = readFileSync("ui/src/store/storeSessionImpl.ts", "utf-8");
    assert.match(phien, /napWfApiDangChay\(id\)/);
    // Bo loc theo phien dang mo van phai con: no la ly do phai hoi mot lan.
    assert.match(wf, /if \(sessionId !== get\(\)\.activeSessionId\) return;/);
  });

  it("WFLS-09 dong luot chay trong Runner mo duoc dung phien cua no", () => {
    const panel = readFileSync("ui/src/components/node-canvas/WfRunnerPanel.tsx", "utf-8");
    // Ket qua cua luot chay ghi vao graph cua phien, nen xem no chay den dau la
    // mo dung phien do ra canvas.
    assert.match(panel, /onClick=\{\(\) => void moPhien\(l\.sessionId\)\}/);
    assert.match(panel, /runner\.watch/);
    // Va dong luot phai noi ro no thuoc khuon nao, khong thi khong biet mo cai gi.
    assert.match(panel, /tenPhien\.get\(l\.sessionId\)/);
  });

  it("WFLS-07 ten su kien khuon deu duoc kenh su kien cua giao dien dang ky", () => {
    // EventSource chi nhan nhung ten da dang ky truoc. Thieu mot ten la mat tin
    // trong im lang - dung loi da xay ra mot lan, khong bao, khong dau vet.
    const kenh = readFileSync("ui/src/lib/eventChannel.ts", "utf-8");
    assert.match(kenh, /\.\.\.Object\.values\(WF_SU_KIEN\)/);
    assert.match(kenh, /from "\.\.\/\.\.\/\.\.\/lib\/wfEvents\.js"/);
  });
});
