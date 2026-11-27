/** GET /api/comfy/result-graph as the server answers it (lib/comfy/resultGraph.ts), from the fake's history rows. */
import type { ComfyResultGraph } from "../types.ts";
import type { WireHistoryRow } from "../wire.ts";

export type FakeGraphAnswer = { ok: true; body: ComfyResultGraph } | { ok: false; status: number; code: string; message: string };

const SAVE = { image: "SaveImage", video: "SaveVideo", audio: "SaveAudioMP3" } as const;
const NODE = { image: "Ima2MediaImage", video: "Ima2MediaVideo", audio: "Ima2MediaAudio" } as const;

export function fakeResultGraph(rows: readonly WireHistoryRow[], filename: string | null): FakeGraphAnswer {
  const row = rows.find((item) => item.filename === filename);
  if (!row) return { ok: false, status: 404, code: "COMFY_RESULT_NOT_FOUND", message: "That result was not found." };
  const prompt = row.prompt ?? "";
  const model = row.model ?? "";
  if (model.startsWith("comfy/")) {
    // A prompt carrying [graph:gone] stands for a ComfyUI that restarted since the job ran.
    if (prompt.includes("[graph:gone]")) {
      return { ok: false, status: 409, code: "COMFY_GRAPH_UNAVAILABLE",
        message: "ComfyUI at http://127.0.0.1:8188 no longer has job fake-job in its history (it is cleared when ComfyUI restarts), and a video or audio file does not carry its graph." };
    }
    return { ok: true, body: { source: "comfy-history", notes: ["This is the graph ComfyUI ran for this result, read from that server's job history."],
      graph: { "6": { class_type: "CLIPTextEncode", inputs: { text: prompt, clip: ["4", 1] } }, "9": { class_type: "SaveImage", inputs: { images: ["8", 0], filename_prefix: "ima2" } } } } };
  }
  const kind = row.mediaType === "video" || row.mediaType === "audio" ? row.mediaType : "image";
  return { ok: true, body: { source: "ima2-node",
    notes: ["Needs the ima2 node pack in ComfyUI (ima2 for ComfyUI, comfyui-ima2) and ima2 running on the same computer.",
      "max_usd is 0, so a paid model is refused until you raise it on the node: nothing is billed by opening or queueing this graph as it is."],
    graph: { "1": { class_type: NODE[kind], inputs: { model, prompt, max_usd: 0, seed: 0, send_seed: "no" } }, "2": { class_type: SAVE[kind], inputs: {} } } } };
}
