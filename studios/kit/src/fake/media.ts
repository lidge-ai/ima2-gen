import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { MediaKind } from '../types.ts';

export interface FileData { data: Buffer; mime: string }
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type,data])));
  return Buffer.concat([size,type,data,crc]);
}
function png(prompt: string, ratio: string | undefined): Buffer {
  const [w,h] = ratio === '9:16' ? [90,160] : ratio === '16:9' ? [160,90] : [128,128];
  const hash = createHash('sha256').update(prompt).digest();
  const raw = Buffer.alloc((w*3+1)*h);
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const i = y*(w*3+1)+1+x*3;
    raw[i] = (x+hash[0]!) % 256; raw[i+1] = (y+hash[1]!) % 256; raw[i+2] = (x+y+hash[2]!) % 256;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function wav(): Buffer {
  const rate=16000, samples=rate, data=Buffer.alloc(44+samples*2);
  data.write('RIFF'); data.writeUInt32LE(data.length-8,4); data.write('WAVEfmt ',8); data.writeUInt32LE(16,16);
  data.writeUInt16LE(1,20); data.writeUInt16LE(1,22); data.writeUInt32LE(rate,24); data.writeUInt32LE(rate*2,28);
  data.writeUInt16LE(2,32); data.writeUInt16LE(16,34); data.write('data',36); data.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) data.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);
  return data;
}
export function fixture(kind: MediaKind, prompt: string, ratio?: string): FileData {
  if (kind === 'video') return {data:readFileSync(new URL(`./media/${ratio === '9:16' ? 'portrait' : 'landscape'}.mp4`,import.meta.url)),mime:'video/mp4'};
  if (kind === 'audio') return {data:wav(),mime:'audio/wav'};
  return {data:png(prompt,ratio),mime:'image/png'};
}
