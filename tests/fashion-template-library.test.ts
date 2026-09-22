import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { khuonThoiTrang, promptCanh, conceptThoiTrang } from "../lib/nodeTemplateThoiTrang.ts";
import { nodeTemplateSeeds } from "../lib/nodeTemplateSeeds.ts";
import { canhAnhVao, oTrongCuaKhuon, timChuoiChay, viecCuaNode } from "../lib/wfChain.ts";
import { O_TRANG_PHUC } from "../lib/moTaTrangPhuc.ts";

/**
 * Kho khuon THOI TRANG: dau vao mot bo do, dau ra nguoi mau mac bo do do.
 *
 * Bo kiem nay giu dung nhung diem da tung hong that tren canvas cua nguoi dung,
 * chu khong kiem "co du so khuon khong".
 */

const nodesCua = (k: (typeof khuonThoiTrang)[number]) => k.graph.nodes as any[];
const edgesCua = (k: (typeof khuonThoiTrang)[number]) => k.graph.edges as any[];

describe("kho khuon thoi trang", () => {
  it("TP-01 moi khuon la mot chuoi hoan chinh va khong doi dau vao nao", () => {
    // Doi `inputs` la doi nguoi goi truyen mot gia tri ma buoc BOC DO ghi de
    // ngay sau do - bat truyen cho co.
    for (const k of khuonThoiTrang) {
      const nodes = nodesCua(k);
      const edges = edgesCua(k);
      const start = nodes.find((n) => n.data?.vaiTro === "bat-dau");
      assert.ok(start, `${k.name}: thieu node BAT DAU`);
      const chuoi = timChuoiChay(start.id, nodes, edges);
      assert.ok(chuoi.ok, `${k.name}: chuoi hong (${chuoi.ok ? "" : chuoi.loi})`);
      assert.deepEqual(oTrongCuaKhuon(nodes, chuoi.thuTu, edges), [], `${k.name}: con doi dau vao`);
      // Ti le dat o BAT DAU, nen ca khuon ra mot ti le duy nhat.
      assert.match(String(start.data.size), /^\d+x\d+$/, `${k.name}: BAT DAU chua co ti le`);
    }
  });

  it("TP-02 anh nen la nguoi, flat lay chi la tham chieu", () => {
    // Canh vao DAU TIEN la anh dem di sua. Dao lai thi node MAC DO lay flat lay
    // lam anh nen va sinh ra mot bo do bay tren nen trang, khong co nguoi nao.
    for (const k of khuonThoiTrang) {
      const nodes = nodesCua(k);
      const edges = edgesCua(k);
      const vaoMacDo = canhAnhVao(edges, nodes, "mac-do");
      assert.equal(vaoMacDo[0]?.source, "mau", `${k.name}: anh nen cua MAC DO phai la node MAU`);
      assert.equal(vaoMacDo[1]?.source, "boc-do", `${k.name}: flat lay phai la tham chieu cua MAC DO`);

      for (const n of nodes.filter((x) => x.data?.vaiTro === "canh")) {
        const vao = canhAnhVao(edges, nodes, n.id);
        assert.equal(vao[0]?.source, "mac-do", `${k.name}/${n.id}: anh nen phai la nguoi da mac do`);
        assert.equal(vao[1]?.source, "boc-do", `${k.name}/${n.id}: flat lay phai la tham chieu`);
      }
    }
  });

  it("TP-03 moi canh mang o trong {{TRANG_PHUC}} va khoa nhan dang", () => {
    for (const k of khuonThoiTrang) {
      for (const n of nodesCua(k).filter((x) => ["canh", "mac-do"].includes(x.data?.vaiTro))) {
        const p = String(n.data.prompt);
        assert.ok(p.includes(`{{${O_TRANG_PHUC}}}`), `${k.name}/${n.id}: thieu o trong trang phuc`);
        assert.match(p, /Keep the exact same face, hair, body shape and skin tone/, `${k.name}/${n.id}`);
        // Khong dong cung gioi tinh: nguoi mau nam hay nu do node MAU quyet dinh.
        assert.doesNotMatch(p, /She wears|He wears/, `${k.name}/${n.id}: dung "Wearing:" thay vi gioi tinh`);
      }
    }
  });

  it("TP-04 cac canh trong cung mot khuon co dang KHAC NHAU", () => {
    // Loi da thay that: cau dang chung chung kieu "walking toward the camera,
    // mid-stride" lam tam nao cung ra gan giong tam nao, du nhan khac nhau.
    for (const k of khuonThoiTrang) {
      const dang = nodesCua(k)
        .filter((n) => n.data?.vaiTro === "canh")
        .map((n) => String(n.data.prompt).split("LOCATION (keep identical in every shot):")[0]);
      assert.equal(new Set(dang).size, dang.length, `${k.name}: co hai canh trung dang`);
      for (const d of dang) {
        // Goi ten MAY: do cao hoac tieu cu. Khong co thi mo hinh tu chon khung.
        assert.match(d, /Camera at |mm,/, `${k.name}: mot canh khong noi gi ve may`);
      }
    }
  });

  it("TP-05 boi canh giong nhau tung chu trong cung mot khuon", () => {
    // Co the la thu duy nhat giu cho tam nao cung nhin ra la cung mot buoi chup.
    for (const k of khuonThoiTrang) {
      const boiCanh = nodesCua(k)
        .filter((n) => n.data?.vaiTro === "canh")
        .map((n) => String(n.data.prompt).split("LOCATION (keep identical in every shot):")[1]);
      assert.equal(new Set(boiCanh).size, 1, `${k.name}: boi canh khong dong nhat giua cac canh`);
    }
  });

  it("TP-06 prompt BOC DO trung khop voi ban trong giao dien", async () => {
    // Hai ban lech nhau thi khuon lay tu kho va node them tay o canvas boc ra
    // hai kieu flat lay khac nhau.
    const { PROMPT_BOC_TRANG_PHUC } = await import("../ui/src/lib/vaiTroNode.ts");
    for (const k of khuonThoiTrang) {
      const bocDo = String(nodesCua(k).find((n) => n.data?.vaiTro === "trang-phuc")!.data.prompt);
      assert.equal(bocDo, PROMPT_BOC_TRANG_PHUC, k.name);
    }
  });

  it("TP-07 moi node trong khuon deu co viec that, tru hai moc", () => {
    for (const k of khuonThoiTrang) {
      for (const n of nodesCua(k)) {
        const viec = viecCuaNode(n);
        const laMoc = ["bat-dau", "ket-thuc"].includes(String(n.data?.vaiTro));
        assert.equal(viec === "moc", laMoc, `${k.name}/${n.id}: viec khong khop vai tro`);
      }
    }
  });

  it("TP-08 ma khuon khong trung voi bat ky khuon nao khac", () => {
    const ma = nodeTemplateSeeds.map((s) => s.id);
    assert.equal(new Set(ma).size, ma.length, "co hai khuon trung ma");
    for (const k of khuonThoiTrang) {
      assert.ok(nodeTemplateSeeds.some((s) => s.id === k.id), `${k.name} chua duoc dang ky vao kho`);
    }
  });

  it("TP-09 promptCanh ghep dung ba phan theo dung thu tu", () => {
    const c = conceptThoiTrang[0]!;
    const p = promptCanh(c, c.canh[0]!);
    assert.ok(p.indexOf("Wearing: {{TRANG_PHUC}}") < p.indexOf(c.canh[0]!.dang));
    assert.ok(p.indexOf(c.canh[0]!.dang) < p.indexOf(c.boiCanh));
    assert.ok(p.endsWith(c.duoi));
  });
});
