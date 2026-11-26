type Box = { type: string; start: number; end: number };
type Probe = { width: number; height: number; durationSec: number; frameRate: number; frameCount: number; container: "mp4" | "mov" };

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: "MEDIA_INPUT_PROBE_FAILED" });
}

class Reader {
  private view: DataView;
  constructor(bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  number(offset: number, length: number, end: number): number {
    if (offset < 0 || length < 0 || offset + length > end || end > this.view.byteLength) fail("Truncated MP4 box");
    if (length === 4) return this.view.getUint32(offset);
    if (length === 8) {
      const value = this.view.getBigUint64(offset);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail("MP4 value exceeds safe integer range");
      return Number(value);
    }
    fail("Invalid MP4 field size");
  }
  text(offset: number, length: number, end: number): string {
    if (offset < 0 || offset + length > end || end > this.view.byteLength) fail("Truncated MP4 box");
    return Array.from({ length }, (_, i) => String.fromCharCode(this.view.getUint8(offset + i))).join("");
  }
  boxes(start: number, end: number): Box[] {
    const result: Box[] = [];
    while (start < end) {
      const size32 = this.number(start, 4, end);
      const type = this.text(start + 4, 4, end);
      const header = size32 === 1 ? 16 : 8;
      const size = size32 === 1 ? this.number(start + 8, 8, end) : size32 || end - start;
      if (size < header || size > end - start) fail("Invalid or truncated MP4 box");
      result.push({ type, start: start + header, end: start + size });
      start += size;
    }
    return result;
  }
}

function child(reader: Reader, parent: Box, type: string): Box | undefined {
  return reader.boxes(parent.start, parent.end).find((box) => box.type === type);
}

function required(reader: Reader, parent: Box, type: string): Box {
  return child(reader, parent, type) ?? fail(`Missing MP4 ${type} box`);
}

function videoTrack(reader: Reader, track: Box): boolean {
  const mdia = child(reader, track, "mdia");
  const hdlr = mdia && child(reader, mdia, "hdlr");
  return !!hdlr && reader.text(hdlr.start + 8, 4, hdlr.end) === "vide";
}

function timing(reader: Reader, mdhd: Box): { timescale: number; durationSec: number } {
  const version = reader.number(mdhd.start, 4, mdhd.end) >>> 24;
  if (version > 1) fail("Unsupported mdhd version");
  const offset = mdhd.start + (version === 1 ? 20 : 12);
  const timescale = reader.number(offset, 4, mdhd.end);
  const duration = reader.number(offset + 4, version === 1 ? 8 : 4, mdhd.end);
  if (!timescale || !duration) fail("Invalid MP4 duration or timescale");
  return { timescale, durationSec: duration / timescale };
}

function dimensions(reader: Reader, tkhd: Box): { width: number; height: number } {
  const version = reader.number(tkhd.start, 4, tkhd.end) >>> 24;
  if (version > 1) fail("Unsupported tkhd version");
  const offset = tkhd.start + (version === 1 ? 88 : 76);
  const width = reader.number(offset, 4, tkhd.end) / 65536;
  const height = reader.number(offset + 4, 4, tkhd.end) / 65536;
  if (!width || !height) fail("Invalid MP4 video dimensions");
  return { width, height };
}

function constantDelta(reader: Reader, stbl: Box): number | undefined {
  const stts = child(reader, stbl, "stts");
  if (!stts) return undefined;
  const count = reader.number(stts.start + 4, 4, stts.end);
  if (count > Math.floor((stts.end - stts.start - 8) / 8)) fail("Truncated stts entries");
  let delta: number | undefined;
  for (let i = 0; i < count; i++) {
    const samples = reader.number(stts.start + 8 + i * 8, 4, stts.end);
    const current = reader.number(stts.start + 12 + i * 8, 4, stts.end);
    if (!samples || !current) fail("Invalid stts entry");
    if (delta !== undefined && delta !== current) return undefined;
    delta = current;
  }
  return delta;
}

function sampleCount(reader: Reader, sizes: Box): number {
  const field = reader.number(sizes.start + 4, 4, sizes.end);
  const count = reader.number(sizes.start + 8, 4, sizes.end);
  if (!count) fail("Invalid MP4 sample count");
  let tableBytes = 0;
  if (sizes.type === "stsz" && field === 0) tableBytes = count * 4;
  if (sizes.type === "stz2") {
    const bits = field & 255;
    if (bits !== 4 && bits !== 8 && bits !== 16) fail("Invalid stz2 field size");
    tableBytes = Math.ceil(count * bits / 8);
  }
  if (tableBytes > sizes.end - sizes.start - 12) fail("Truncated MP4 sample sizes");
  return count;
}

export function probeMp4(bytes: Uint8Array): Probe {
  const reader = new Reader(bytes);
  const top = reader.boxes(0, bytes.byteLength);
  const ftyp = top.find((box) => box.type === "ftyp");
  const container = ftyp && reader.text(ftyp.start, 4, ftyp.end) === "qt  " ? "mov" : "mp4";
  const moov = top.find((box) => box.type === "moov") ?? fail("Missing MP4 moov box");
  const track = reader.boxes(moov.start, moov.end).find((box) => box.type === "trak" && videoTrack(reader, box))
    ?? fail("No MP4 video track");
  const mdia = required(reader, track, "mdia");
  const stbl = required(reader, required(reader, mdia, "minf"), "stbl");
  const sizes = child(reader, stbl, "stsz") ?? required(reader, stbl, "stz2");
  const frameCount = sampleCount(reader, sizes);
  const { timescale, durationSec } = timing(reader, required(reader, mdia, "mdhd"));
  const delta = constantDelta(reader, stbl);
  const frameRate = Math.round((delta ? timescale / delta : frameCount / durationSec) * 1000) / 1000;
  return { ...dimensions(reader, required(reader, track, "tkhd")), durationSec, frameRate, frameCount, container };
}
