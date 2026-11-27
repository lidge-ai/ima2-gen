// The pure rules behind the ComfyUI workflow settings screen: which file is refused before it is sent,
// which file inputs still need a role, what a registration sends, and what the server report means for a person.
import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBind, isEditorFormat, presetSlotRoles, reportSummary, slotKey, SLOT_ROLES, unassignedSlots, workflowMediaModel } =
  await import("../ui/src/lib/comfyRegistration.js");

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

