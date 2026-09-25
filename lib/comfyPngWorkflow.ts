// lib/comfyPngWorkflow.ts — read ComfyUI's embedded graph out of a PNG.
//
// lib/pngInfo.ts only parses IHDR (dimensions and colour type); it has no text
// chunk reader, so this is new rather than an extension of it.
//
// ComfyUI's SaveImage writes the API-format graph under the tEXt keyword
// "prompt", and the browser additionally sends the UI save format as
// "workflow" via extra_pnginfo. Only "prompt" is what POST /prompt accepts, and
// an image queued through the REST API carries "prompt" alone — so a missing
// "workflow" key is normal, not a defect.
import { inflateSync } from "node:zlib";
import { parseApiGraph } from "./comfyGraphBind.js";
import { COMFY_WORKFLOW_ERROR, ComfyWorkflowError, type ComfyGraph } from "./comfyWorkflowStore.js";

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";

// Untrusted input: cap both the number of chunks walked and the text kept, so a
// crafted file cannot turn registration into an allocation attack.
const MAX_CHUNKS = 512;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

export function isPngBuffer(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).toString("hex") === PNG_SIGNATURE_HEX;
}

/**
 * Collects tEXt, zTXt, and iTXt chunks keyed by keyword.
 *
 * zTXt/iTXt are read because PIL promotes long text to a compressed chunk, and
 * a large graph is exactly the payload that trips that promotion.
 */
export function readPngTextChunks(buffer: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  if (!isPngBuffer(buffer)) return out;
  let offset = 8;
  let chunks = 0;
  while (offset + 8 <= buffer.length && chunks < MAX_CHUNKS) {
    chunks += 1;
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    if (type === "IEND") break;
    // 4 length + 4 type + payload + 4 crc
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length > MAX_TEXT_BYTES || dataEnd > buffer.length) break;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const body = buffer.subarray(dataStart, dataEnd);
      const nul = body.indexOf(0);
      if (nul > 0) {
        const keyword = body.subarray(0, nul).toString("latin1");
        try {
          if (type === "tEXt") {
            out.set(keyword, body.subarray(nul + 1).toString("latin1"));
          } else if (type === "zTXt") {
            // keyword \0 compressionMethod compressedData
            out.set(keyword, inflateSync(body.subarray(nul + 2)).toString("utf8"));
          } else {
            // keyword \0 compressionFlag compressionMethod langTag \0 translatedKeyword \0 text
            const flag = body[nul + 1];
            const cursor = nul + 3;
            const langEnd = body.indexOf(0, cursor);
            if (langEnd < 0) { offset = dataEnd + 4; continue; }
            const transEnd = body.indexOf(0, langEnd + 1);
            if (transEnd < 0) { offset = dataEnd + 4; continue; }
            const text = body.subarray(transEnd + 1);
            out.set(keyword, flag === 1 ? inflateSync(text).toString("utf8") : text.toString("utf8"));
          }
        } catch {
          // A single unreadable chunk must not abort the whole scan: the graph
          // may still be in a later one.
        }
      }
    }
    offset = dataEnd + 4;
  }
  return out;
}

/**
 * Extracts the API-format graph a ComfyUI PNG carries, or null when the file
 * has no ComfyUI metadata at all.
 *
 * A present-but-unparseable "prompt" key throws instead of returning null: the
 * file IS a ComfyUI image and the user deserves to know why it was rejected.
 */
export function extractComfyApiGraph(buffer: Buffer): ComfyGraph | null {
  const chunks = readPngTextChunks(buffer);
  const raw = chunks.get("prompt");
  if (raw === undefined) {
    if (chunks.has("workflow")) {
      throw new ComfyWorkflowError(
        COMFY_WORKFLOW_ERROR.GRAPH_INVALID,
        "This PNG carries only the UI workflow, not the API graph. Export the workflow with Workflow > Export (API) and register that file instead.",
      );
    }
    return null;
  }
  return parseApiGraph(raw);
}
