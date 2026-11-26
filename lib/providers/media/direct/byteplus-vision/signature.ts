import { createHash, createHmac } from 'node:crypto';

export const SIGNED_HEADERS = 'content-type;host;x-content-sha256;x-date';
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
export function canonicalRequest(
  method: string,
  path: string,
  query: string,
  contentType: string,
  host: string,
  payloadHash: string,
  date: string,
): string {
  const headers =
    `content-type:${contentType}\nhost:${host}\nx-content-sha256:${payloadHash}\nx-date:${date}\n`;
  return `${method}\n${path}\n${query}\n${headers}\n${SIGNED_HEADERS}\n${payloadHash}`;
}
export function signatureFromSigningKey(
  key: Buffer, date: string, scope: string, canonicalHash: string,
): string {
  return hmac(key, `HMAC-SHA256\n${date}\n${scope}\n${canonicalHash}`).toString('hex');
}
export function deriveSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(secret, date), region), service), 'request');
}
