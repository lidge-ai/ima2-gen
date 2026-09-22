import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertLanAccessConfiguration } from "../server.ts";

/**
 * Mo may chu ra cho ca tailnet goi vao.
 *
 * Bo kiem nay giu dung cai khoa, khong kiem "co chay duoc khong".
 */

const script = readFileSync("scripts/serve-tailscale.mjs", "utf-8");

describe("serve qua tailscale", () => {
  it("TS-01 mo ra ngoai loopback ma khong co token thi may chu KHONG khoi dong", () => {
    // Mo cong ma khong khoa la mot loi im lang: khong ai bao gi, va bat ky ai
    // toi duoc cong deu goi duoc.
    assert.throws(() => assertLanAccessConfiguration("0.0.0.0", ""), /IMA2_LAN_TOKEN/);
    assert.throws(() => assertLanAccessConfiguration("100.106.62.7", undefined), /IMA2_LAN_TOKEN/);
    // Loopback thi khong doi token - do la cach chay hang ngay.
    assert.doesNotThrow(() => assertLanAccessConfiguration("127.0.0.1", ""));
    assert.doesNotThrow(() => assertLanAccessConfiguration("localhost", ""));
    // Va co token thi mo duoc.
    assert.doesNotThrow(() => assertLanAccessConfiguration("0.0.0.0", "mot-token-du-dai"));
  });

  it("TS-02 token khong bao gio nam trong kho ma nguon", () => {
    // Token nam o ~/.ima2/lan-token.txt. Viet thang vao script la no di theo
    // moi ban sao cua kho, ke ca ban day len GitHub.
    assert.match(script, /join\(homedir\(\), "\.ima2"\)/);
    assert.match(script, /lan-token\.txt/);
    assert.doesNotMatch(script, /IMA2_LAN_TOKEN\s*=\s*["'][^"']{8,}/);
    // Sinh ngau nhien that su, khong phai mot chuoi doan duoc.
    assert.match(script, /randomBytes\(32\)/);
  });

  it("TS-03 mo dung ba thu, thieu mot la khong vao duoc", () => {
    // Dia chi IP thi may chu tu nhan ra; mot cai TEN thi khong - request mang
    // Host la ten MagicDNS se bi tra 403 LOCAL_HOST_REJECTED.
    assert.match(script, /IMA2_HOST: "0\.0\.0\.0"/);
    assert.match(script, /IMA2_LAN_TOKEN: token/);
    assert.match(script, /IMA2_PUBLIC_ORIGINS: JSON\.stringify\(origins\)/);
    assert.match(script, /http:\/\/\$\{ten\}:\$\{cong\}/);
  });

  it("TS-04 ten may lay tu tailscale, khong viet cung", () => {
    // Viet cung ten thi may khac clone ve la sai ngay, va doi tailnet cung sai.
    assert.match(script, /execFileSync\(bin, \["status", "--json"\]/);
    assert.doesNotMatch(script, /tail[0-9a-f]{6,}\.ts\.net/);
  });
});
