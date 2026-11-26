import { createHash, createHmac } from "node:crypto";

interface Tc3Input {
  secretId: string;
  secretKey: string;
  host: string;
  service: string;
  timestamp: number;
  payload: string;
  contentType?: string;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();

/** Tencent Cloud API Signature v3; payload must match the transmitted bytes. */
export function tc3Authorization(input: Tc3Input): string {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const contentType = input.contentType ?? "application/json; charset=utf-8";
  const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${input.host}\n\ncontent-type;host\n${hash(input.payload)}`;
  const scope = `${date}/${input.service}/tc3_request`;
  const toSign = `TC3-HMAC-SHA256\n${input.timestamp}\n${scope}\n${hash(canonical)}`;
  const signing = hmac(hmac(hmac(`TC3${input.secretKey}`, date), input.service), "tc3_request");
  const signature = hmac(signing, toSign).toString("hex");
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`;
}
