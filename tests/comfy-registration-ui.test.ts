// The pure rules behind the ComfyUI workflow settings screen: which file is refused before it is sent,
// which file inputs still need a role, what a registration sends, and what the server report means for a person.
import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBind, isEditorFormat, presetSlotRoles, reportSummary, slotKey, SLOT_ROLES, unassignedSlots, workflowMediaModel } =
  await import("../ui/src/lib/comfyRegistration.js");
const { jobProgressPercent } = await import("../ui/src/lib/jobProgress.js");

const frame = { kind: "image" as const, node: "52", input: "image", classType: "LoadImage", role: "first-frame" as const };
const second = { kind: "image" as const, node: "53", input: "image", classType: "LoadImage" };
const third = { kind: "image" as const, node: "54", input: "image", classType: "LoadImage" };
const voice = { kind: "audio" as const, node: "60", input: "audio", classType: "LoadAudio", role: "source-audio" as const };

test("ComfyUI's editor format is recognised by the same rule the server uses, before anything is sent", () => {
  assert.equal(isEditorFormat({ last_node_id: 3, nodes: [{ id: 1, type: "KSampler" }], links: [], version: 0.4 }), true);
  assert.equal(isEditorFormat({ "1": { class_type: "KSampler", inputs: {} } }), false, "the API format is an object keyed by node id");
  // A node id may be the word "nodes": only an array there means the editor format.
  assert.equal(isEditorFormat({ nodes: { class_type: "KSampler", inputs: {} } }), false);
  assert.equal(isEditorFormat(null), false);
  assert.equal(isEditorFormat([]), false);
});

test("a file input the graph settles is preset; one it does not settle stays empty until a person says", () => {
  const slots = [frame, second, third, voice];
  const roles = presetSlotRoles(slots);
  assert.deepEqual(roles, { "52.image": "first-frame", "60.audio": "source-audio" });
  assert.deepEqual(unassignedSlots(slots, roles), [second, third]);
  assert.deepEqual(unassignedSlots(slots, { ...roles, [slotKey(second)]: "last-frame", [slotKey(third)]: "reference-image" }), []);
  // An empty choice is not an assignment.
  assert.deepEqual(unassignedSlots([second], { "53.image": "" }), [second]);
});

test("each kind of file offers only the roles the server accepts for it", () => {
  assert.deepEqual(SLOT_ROLES.image, ["first-frame", "last-frame", "reference-image", "source-image", "mask"]);
  assert.deepEqual(SLOT_ROLES.video, ["source-video", "reference-video"]);
  assert.deepEqual(SLOT_ROLES.audio, ["source-audio", "reference-audio"]);
});

test("a registration sends the chosen fields and every file input with its role", () => {
  const selection = { prompt: "6.text", negativePrompt: "7.text", seed: "3.noise.seed", output: "9", width: "" };
  const bind = buildBind(selection, [frame, second], { "52.image": "first-frame", "53.image": "last-frame" });
  assert.deepEqual(bind, {
    prompt: { node: "6", input: "text" }, negativePrompt: { node: "7", input: "text" },
    // Only the first dot separates the node from the input name.
    seed: { node: "3", input: "noise.seed" }, output: { node: "9" },
    inputs: [{ kind: "image", role: "first-frame", node: "52", input: "image" }, { kind: "image", role: "last-frame", node: "53", input: "image" }],
  });
  // A server that could not be asked lists no file inputs: nothing is sent for them, so the server keeps its own rule.
  assert.equal("inputs" in buildBind({ prompt: "6.text", output: "9" }, [], {}), false);
});

test("the server report is read as one of four plain states", () => {
  assert.deepEqual(reportSummary(undefined), { state: "unknown" });
  assert.deepEqual(reportSummary({ origin: "http://127.0.0.1:8188", reachable: false, reason: "connect ECONNREFUSED" }),
    { state: "unreachable", origin: "http://127.0.0.1:8188", reason: "connect ECONNREFUSED" });
  assert.deepEqual(reportSummary({ origin: "http://127.0.0.1:8188", reachable: true, missingNodes: [], missingChoices: [], paidNodes: [] }),
    { state: "ready", origin: "http://127.0.0.1:8188", missingNodes: [], missingModels: [], otherChoices: [], paidNodes: [] });
  const report = {
    origin: "http://127.0.0.1:8188", reachable: true as const,
    missingNodes: [{ classType: "WanAnimate", nodes: ["12", "14"] }],
    missingChoices: [
      { node: "4", classType: "UNETLoader", input: "unet_name", value: "wan2.2.safetensors", model: true },
      { node: "8", classType: "KSampler", input: "scheduler", value: "beta57", model: false },
    ],
    paidNodes: ["KlingTextToVideo"],
  };
  assert.deepEqual(reportSummary(report), {
    state: "problems", origin: "http://127.0.0.1:8188",
    missingNodes: [{ classType: "WanAnimate", nodes: ["12", "14"] }],
    missingModels: [report.missingChoices[0]], otherChoices: [report.missingChoices[1]], paidNodes: ["KlingTextToVideo"],
  });
  // A paid node alone is not something missing: the workflow can run, and the person is told it may be charged.
  assert.equal(reportSummary({ ...report, missingNodes: [], missingChoices: [] }).state, "ready");
});

test("a registered workflow is named the way the media catalog lists it", () => {
  assert.equal(workflowMediaModel("klein-edit"), "comfy/klein-edit");
});


test("a running job's progress is shown only when it reported one between nothing and done", () => {
  assert.equal(jobProgressPercent(0.426), 43);
  assert.equal(jobProgressPercent(0), 0);
  assert.equal(jobProgressPercent(1), 100);
  for (const none of [null, undefined, -0.1, 1.2, Number.NaN, "0.5"]) assert.equal(jobProgressPercent(none), null);
});
// What the settings screen sends. The server reads a body only when it is declared as JSON
// (express.json): without the header every one of these arrives empty and is refused.
const sent: Array<{ url: string; method: string; type: string | null; body: unknown }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  sent.push({ url: String(url), method: init?.method ?? "GET", type: new Headers(init?.headers).get("content-type"),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  return new Response(JSON.stringify({ ok: true, workflows: [], remotes: [], strandedWorkflows: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;
const api = await import("../ui/src/lib/api-comfy.js");

test("every request that carries a body declares it as JSON, and reads carry none", async () => {
  try {
    const graph = { "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox" } } };
    await api.inspectComfyWorkflow({ graph }, "http://127.0.0.1:8188");
    await api.inspectComfyWorkflow({ graph });
    await api.probeComfyOrigin("http://127.0.0.1:8188");
    await api.createComfyWorkflow({ id: "fox", mediaKind: "image", graph, bind: { prompt: { node: "6", input: "text" }, output: { node: "9" } } });
    await api.putComfyRemote("https://comfy.example.com", "secret");
    await api.putComfyRemote("https://comfy.example.com");
    await api.deleteComfyRemote("https://comfy.example.com");
    await api.deleteComfyWorkflow("fox");
    await api.listComfyRemotes();
    await api.listComfyWorkflows();
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent.map((call) => [call.method, call.url, call.type]), [
    ["POST", "/api/comfy/inspect", "application/json"], ["POST", "/api/comfy/inspect", "application/json"],
    ["POST", "/api/comfy/probe", "application/json"], ["POST", "/api/comfy/workflows", "application/json"],
    ["PUT", "/api/comfy/remotes", "application/json"], ["PUT", "/api/comfy/remotes", "application/json"],
    ["DELETE", "/api/comfy/remotes?origin=https%3A%2F%2Fcomfy.example.com", null], ["DELETE", "/api/comfy/workflows/fox", null],
    ["GET", "/api/comfy/remotes", null], ["GET", "/api/comfy/workflows", null],
  ]);
  assert.deepEqual(sent[0]!.body, { graph: { "6": { class_type: "CLIPTextEncode", inputs: { text: "a fox" } } }, origin: "http://127.0.0.1:8188" });
  assert.equal("origin" in (sent[1]!.body as object), false, "no origin is sent when none was chosen");
  assert.deepEqual(sent[4]!.body, { origin: "https://comfy.example.com", token: "secret" });
  assert.deepEqual(sent[5]!.body, { origin: "https://comfy.example.com" }, "an empty token is not sent, so a saved one is kept");
});
