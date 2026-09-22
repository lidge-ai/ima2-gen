#!/usr/bin/env node
// Chay may chu cho ca may khac trong tailnet goi vao - ca API lan giao dien.
//
// Ba thu phai dung cung luc, thieu mot la khong vao duoc:
//
//   1. `IMA2_HOST=0.0.0.0` - mac dinh la 127.0.0.1, chi chinh may do goi duoc.
//   2. `IMA2_LAN_TOKEN` - may chu TU CHOI KHOI DONG khi mo ra ngoai loopback
//      ma khong co token (xem assertLanAccessConfiguration trong server.ts).
//      Co y: mo cong ma khong khoa la mot loi im lang.
//   3. `IMA2_PUBLIC_ORIGINS` - ten MagicDNS. Dia chi IP thi may chu tu nhan ra,
//      nhung mot cai ten thi khong: request mang Host la ten do se bi tra
//      403 LOCAL_HOST_REJECTED.
//
// Token nam NGOAI kho ma nguon (`~/.ima2/lan-token.txt`), khong bao gio nam
// trong tep nay.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const THU_MUC = join(homedir(), ".ima2");
const TEP_TOKEN = join(THU_MUC, "lan-token.txt");

/** Token cu neu da co; chua co thi tao mot cai moi va ghi ra ngoai kho ma nguon. */
function layToken() {
  if (existsSync(TEP_TOKEN)) {
    const cu = readFileSync(TEP_TOKEN, "utf-8").trim();
    if (cu) return cu;
  }
  const moi = randomBytes(32).toString("base64url");
  mkdirSync(THU_MUC, { recursive: true });
  writeFileSync(TEP_TOKEN, moi, "utf-8");
  console.log(`[tailscale] da tao token moi tai ${TEP_TOKEN}`);
  return moi;
}

/** Ten MagicDNS va IP cua chinh may nay, hoi thang tailscale. */
function tailnet() {
  const duongDan = [
    "tailscale",
    "C:\\Program Files\\Tailscale\\tailscale.exe",
    "/usr/bin/tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];
  for (const bin of duongDan) {
    try {
      const raw = execFileSync(bin, ["status", "--json"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
      const self = JSON.parse(raw).Self ?? {};
      const ten = String(self.DNSName || "").replace(/\.$/, "");
      return { ten, ip: (self.TailscaleIPs || []).find((v) => v.includes(".")) || "" };
    } catch { /* thu duong tiep theo */ }
  }
  return { ten: "", ip: "" };
}

const token = layToken();
const { ten, ip } = tailnet();
const cong = process.env.IMA2_PORT || process.env.PORT || "3333";
if (!ip) {
  console.warn("[tailscale] khong hoi duoc tailscale - van chay, nhung hay kiem tra tailscale co dang bat khong.");
}

const origins = ten ? [`http://${ten}:${cong}`] : [];
const env = {
  ...process.env,
  IMA2_HOST: "0.0.0.0",
  IMA2_LAN_TOKEN: token,
  ...(origins.length ? { IMA2_PUBLIC_ORIGINS: JSON.stringify(origins) } : {}),
};

console.log("[tailscale] giao dien va API:");
if (ip) console.log(`             http://${ip}:${cong}`);
if (ten) console.log(`             http://${ten}:${cong}`);
console.log(`[tailscale] token (dan vao o dang nhap lan dau tren tung trinh duyet):\n             ${token}`);
console.log(`[tailscale] token luu tai ${TEP_TOKEN}`);

spawn(process.execPath, [join(ROOT, "bin", "ima2.js"), "serve"], { cwd: ROOT, env, stdio: "inherit" })
  .on("exit", (ma) => process.exit(ma ?? 0));
