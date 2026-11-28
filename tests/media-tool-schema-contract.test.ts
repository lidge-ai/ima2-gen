import assert from "node:assert/strict";
import { test } from "node:test";
import { Ajv } from "ajv";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { MEDIA_INPUT_ROLES, resolveMediaInputRef } from "../lib/providers/media/inputs.ts";
import { MEDIA_TASKS, parseMediaJobBody } from "../lib/providers/media/validate.ts";
import { WORKFLOWS } from "../lib/workflows/index.ts";
import { buildMediaToolDescriptors, mediaInputSchema, workflowValuesSchema } from "../lib/providers/media/toolSchema.ts";

const names = [
  "media_catalog", "media_keys_status", "media_estimate", "media_submit", "media_job_status",
  "media_wait", "media_jobs", "media_cancel", "media_result", "media_history",
  "workflow_list", "workflow_schema", "workflow_estimate", "workflow_run",
];
const prefix = "BILLED: runs on the user's own provider key and is charged by that provider. Call media_estimate (or workflow_estimate) first.";
const retryNotice = "requestId is the job handle. Before submitting, ima2 checks whether it already knows this requestId (running, recent, or saved in history) and refuses it if so. The check is best-effort: it is not atomic with the submit and cannot see very old or pre-restart ids, so a retry can still create a second, separately billed job. Check media_job_status before retrying.";
const validator = new AjvJsonSchemaValidator(new Ajv({ strict: false }));
const dirs = { generatedDir: "/nonexistent-ima2-schema-generated", inputsDir: "/nonexistent-ima2-schema-inputs", maxBytes: 1024 };
const base = { model: "test/model", task: "image-to-image" };

type Schema = Record<string, any>;
function check(schema: object, value: unknown): boolean {
  return validator.getValidator(schema as any)(value).valid;
}
function descriptor(name: string, workflows = WORKFLOWS) {
  const result = buildMediaToolDescriptors(workflows).find((tool) => tool.name === name);
  assert.ok(result, `missing ${name}`);
  return result;
}
function normalize(raw: Record<string, any>): Record<string, any> {
  const result = { ...raw };
  for (const [key, value] of Object.entries(result)) {
    if (key !== "model" && key !== "task" && (value === "" || value === null)) delete result[key];
  }
  if (Array.isArray(result.inputs)) {
    result.inputs = result.inputs.map((input: Record<string, any>) => {
      const item = { ...input };
      for (const key of ["ref", "filename", "url", "dataUrl", "mimeType"]) {
        if (item[key] === "" || item[key] === null) delete item[key];
      }
      return item;
    });
  }
  return result;
}
async function parseAndResolve(body: Record<string, any>): Promise<void> {
  const parsed = parseMediaJobBody(body);
  for (const input of parsed.inputs) await resolveMediaInputRef(input, dirs);
}

test("tool inventory, billing, descriptions, and annotations are explicit", () => {
  const tools = buildMediaToolDescriptors(WORKFLOWS);
  assert.deepEqual(tools.map((tool) => tool.name), names);
  assert.deepEqual(tools.filter((tool) => tool.billed).map((tool) => tool.name), ["media_submit", "workflow_run"]);
  const reads = new Set(["media_catalog", "media_keys_status", "media_estimate", "media_job_status", "media_wait", "media_jobs", "media_history", "workflow_list", "workflow_schema"]);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: reads.has(tool.name), destructiveHint: tool.name === "media_cancel",
      idempotentHint: !tool.billed, openWorldHint: tool.billed || tool.name === "media_cancel",
    }, tool.name);
    if (tool.billed) {
      assert.ok(tool.description.startsWith(prefix), tool.name);
      assert.ok(tool.description.includes(retryNotice), tool.name);
    }
    assert.equal(tool.outputSchema.type, "object", tool.name);
    assert.equal(tool.outputSchema.required?.length ?? 0, 0, tool.name);
    assert.notEqual(tool.outputSchema.additionalProperties, false, tool.name);
  }
  const estimateText = descriptor("media_estimate").description;
  assert.ok(estimateText.startsWith("Informational: published price x quantity for the chosen route. The price row is chosen from the request"), estimateText);
  assert.ok(estimateText.includes("quote carries the full answer") && estimateText.endsWith("The provider's actual bill may differ."), estimateText);
  assert.ok(descriptor("media_job_status").description.includes("Jobs stay listed while running and among the last 100 finished; saved outputs stay in history."));
  assert.ok(descriptor("workflow_estimate").description.includes("Prices each step from published prices. Runs a local media probe; calls no provider."));
  assert.ok(descriptor("workflow_run").description.endsWith("Director text planning uses the signed-in GPT session."));
});

test("all input schemas compile for empty and populated workflow catalogs", () => {
  for (const workflows of [[], WORKFLOWS]) {
    for (const tool of buildMediaToolDescriptors(workflows)) {
      assert.doesNotThrow(() => validator.getValidator(tool.inputSchema as any), tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    }
  }
});

test("only workflow-dependent descriptors vary with the workflow catalog", () => {
  const empty = buildMediaToolDescriptors([]);
  const populated = buildMediaToolDescriptors(WORKFLOWS);
  const dependent = new Set(["workflow_schema", "workflow_estimate", "workflow_run"]);
  assert.deepEqual(empty.filter((tool) => !dependent.has(tool.name)), populated.filter((tool) => !dependent.has(tool.name)));
  // The catalog grows as workflows land (dev added the open Remix variants); every one must get a branch.
  assert.ok(WORKFLOWS.length >= 10);
  for (const name of dependent) {
    const blank = empty.find((tool) => tool.name === name)!.inputSchema as Schema;
    const full = populated.find((tool) => tool.name === name)!.inputSchema as Schema;
    assert.equal(blank.properties.id.type, "string");
    assert.equal(blank.properties.id.enum, undefined);
    assert.deepEqual(full.properties.id.enum, WORKFLOWS.map((workflow) => workflow.id));
    if (name === "workflow_schema") continue;
    assert.equal(blank.properties.values.type, "object");
    assert.equal(full.allOf.length, WORKFLOWS.length);
    assert.deepEqual(full.allOf.map((branch: Schema) => branch.if.properties.id.const), WORKFLOWS.map((workflow) => workflow.id));
    for (const branch of full.allOf) {
      assert.deepEqual(branch.if.required, ["id"]);
      assert.equal(branch.then.properties.values.type, "object");
    }
  }
});

test("a field required unless another is given becomes anyOf: one of the two must be present", () => {
  const studio = WORKFLOWS.find((workflow) => workflow.id === "director-studio")!;
  const schema = workflowValuesSchema(studio.fields) as Schema;
  assert.equal((schema.required ?? []).includes("prompt"), false);
  assert.equal(check(schema, {}), false, "neither Scene nor shots");
  assert.equal(check(schema, { prompt: "a canoe at dawn" }), true);
  assert.equal(check(schema, { shots: [{ prompt: "wide", durationSec: 5 }, { prompt: "close", durationSec: 5 }] }), true);
  for (const workflow of WORKFLOWS.filter((w) => w.fields.every((f) => !f.requiredUnless))) {
    assert.equal("anyOf" in workflowValuesSchema(workflow.fields), false, workflow.id);
  }
});

test("workflow fields preserve their required flags, types, bounds, enums, and defaults", () => {
  for (const workflow of WORKFLOWS) {
    const schema = workflowValuesSchema(workflow.fields) as Schema;
    assert.equal(schema.additionalProperties, false, workflow.id);
    assert.deepEqual(new Set(schema.required ?? []), new Set(workflow.fields.filter((field) => field.required).map((field) => field.name)), workflow.id);
    for (const field of workflow.fields) {
      const prop = schema.properties[field.name];
      assert.ok(prop, `${workflow.id}.${field.name}`);
      switch (field.type) {
        case "text": assert.equal(prop.type, "string"); assert.equal(prop.maxLength, field.maxLength); break;
        case "enum": assert.equal(prop.type, "string"); assert.deepEqual(prop.enum, field.options.map((option) => option.value)); assert.equal(prop.default, field.default); break;
        case "integer": assert.equal(prop.type, "integer"); assert.equal(prop.minimum, field.min); assert.equal(prop.maximum, field.max); assert.equal(prop.default, field.default); break;
        case "boolean": assert.equal(prop.type, "boolean"); assert.equal(prop.default, field.default); break;
        case "colors":
        case "media": assert.equal(prop.type, "array"); assert.equal(prop.minItems, field.min); assert.equal(prop.maxItems, field.max); break;
        case "shots":
          assert.equal(prop.type, "array"); assert.equal(prop.minItems, field.min); assert.equal(prop.maxItems, field.max);
          assert.equal(check(prop.items, { prompt: "wide shot", durationSec: 5 }), true);
          assert.equal(check(prop.items, { prompt: "wide shot", durationSec: 5.5 }), false);
          assert.equal(check(prop.items, { prompt: "", durationSec: 5 }), false);
          assert.equal(check(prop.items, { prompt: "x".repeat(field.promptMaxLength + 1), durationSec: 5 }), false);
          assert.equal(check(prop.items, { prompt: "wide shot" }), false);
          assert.equal(check(prop.items, { prompt: "wide shot", durationSec: 5, camera: "x" }), false);
          break;
      }
      if (field.type === "colors") {
        assert.equal(check(prop.items, "#a0B1c2"), true);
        assert.equal(check(prop.items, "#abc"), false);
      }
      if (field.type === "media") {
        const item = prop.items;
        assert.equal(check(item, { url: "https://example.test/a" }), true);
        assert.equal(check(item, { url: "HTTPS://example.test/a" }), false);
        assert.equal(check(item, { ref: "x", filename: "y" }), false);
        assert.equal(check(item, {}), false);
      }
    }
  }
});

test("tasks and input roles come from server enumerations", () => {
  const submit = descriptor("media_submit").inputSchema as Schema;
  assert.deepEqual(submit.properties.task.enum, MEDIA_TASKS);
  assert.deepEqual((mediaInputSchema() as Schema).properties.role.enum, MEDIA_INPUT_ROLES);
  assert.deepEqual(submit.properties.inputs.items.properties.role.enum, MEDIA_INPUT_ROLES);
  assert.deepEqual((descriptor("media_catalog").inputSchema as Schema).properties.task.enum, MEDIA_TASKS);
});

test("submit, workflow media, and history expose client-only paths and cursor", () => {
  const submit = descriptor("media_submit").inputSchema as Schema;
  const item = submit.properties.inputs.items;
  assert.deepEqual(item.properties.path, { type: "string", minLength: 1, "x-ima2-client": true, description: "Local file; the client uploads it first." });
  assert.equal(check(item, { role: "source-image", path: "/tmp/image.png" }), true);
  assert.equal(check(item, { role: "source-image", path: "/tmp/image.png", ref: "x" }), false);
  const run = descriptor("workflow_run").inputSchema as Schema;
  for (const workflow of WORKFLOWS) {
    const branch = run.allOf.find((b: Schema) => b.if.properties.id.const === workflow.id);
    for (const field of workflow.fields.filter((f) => f.type === "media")) {
      assert.equal(branch.then.properties.values.properties[field.name].items.properties.path["x-ima2-client"], true);
    }
  }
  const history = descriptor("media_history").inputSchema;
  assert.equal(check(history, { limit: 50, cursor: { before: 1767225600000, beforeFilename: "a.png" } }), true);
  assert.equal(check(history, { limit: 51 }), false);
  assert.equal(check(history, { unexpected: true }), false);
});

test("normalized submit inputs agree with parsing and input resolution", async () => {
  const schema = descriptor("media_estimate").inputSchema;
  const valid = [
    { ...base, adapter: "", prompt: null, inputs: null },
    { ...base, inputs: [{ role: "source-image", url: "HTTPS://example.test/a", ref: "", mimeType: null }] },
    { ...base, inputs: [{ role: "source-image", url: "asset://abc_1" }] },
    { ...base, inputs: [{ role: "source-image", dataUrl: "data:image/png;base64,YQ==" }] },
    { ...base, inputs: Array.from({ length: 16 }, () => ({ role: "source-image", url: "https://example.test/a" })) },
    { ...base, prompt: "a".repeat(20_000), durationSec: -1 },
  ];
  for (const raw of valid) {
    const body = normalize(raw);
    assert.equal(check(schema, body), true, JSON.stringify(body).slice(0, 150));
    await assert.doesNotReject(() => parseAndResolve(body));
  }
  const invalid = [
    { ...base, model: "" },
    { ...base, inputs: [{ role: "typo", url: "https://example.test/a" }] },
    { ...base, inputs: [{ role: "source-image" }] },
    { ...base, inputs: [{ role: "source-image", ref: "x", url: "https://example.test/a" }] },
    { ...base, inputs: Array.from({ length: 17 }, () => ({ role: "source-image", url: "https://example.test/a" })) },
    { ...base, prompt: "a".repeat(20_001) },
    { ...base, seed: 1.5 }, { ...base, audio: "yes" },
    { ...base, inputs: [{ role: "source-image", url: "http://example.test/a" }] },
    { ...base, inputs: [{ role: "source-image", url: "asset://" }] },
  ];
  for (const raw of invalid) {
    const body = normalize(raw);
    assert.equal(check(schema, body), false, JSON.stringify(body).slice(0, 150));
    await assert.rejects(() => parseAndResolve(body));
  }
});

test("schema admits syntax that only server-side resolution can reject", async () => {
  const schema = descriptor("media_estimate").inputSchema;
  for (const input of [
    { role: "source-image", dataUrl: "data:image/png;base64,!!!!" },
    { role: "source-image", ref: "unregistered" },
  ]) {
    const body = { ...base, inputs: [input] };
    assert.equal(check(schema, body), true);
    assert.doesNotThrow(() => parseMediaJobBody(body));
    await assert.rejects(() => resolveMediaInputRef(input, dirs));
  }
});

test("tool argument bounds, required handles, and output properties match their contracts", () => {
  for (const name of ["media_keys_status", "workflow_list"]) {
    const schema = descriptor(name).inputSchema;
    assert.equal(check(schema, {}), true, name);
    assert.equal(check(schema, { extra: 1 }), false, name);
  }
  for (const name of ["media_job_status", "media_wait", "media_cancel", "media_result", "workflow_run"]) {
    assert.ok((descriptor(name).inputSchema.required ?? []).includes("requestId"), name);
  }
  const submit = descriptor("media_submit").inputSchema;
  const request = { ...base, requestId: "job:1" };
  assert.equal(check(submit, request), true);
  assert.equal(check(submit, { ...request, requestId: "bad id" }), false);
  assert.equal(check(submit, { ...request, requestId: "x".repeat(129) }), false);
  assert.equal(check(submit, { ...request, timeoutSec: 600 }), true);
  assert.equal(check(submit, { ...request, timeoutSec: 601 }), false);
  assert.equal(check(descriptor("media_wait").inputSchema, { requestId: "id", timeoutSec: 60 }), true);
  assert.equal(check(descriptor("media_wait").inputSchema, { requestId: "id", timeoutSec: 61 }), false);
  assert.equal(check(descriptor("media_catalog").inputSchema, { keyed: true, maxUsd: 0.1 }), true);
  assert.equal(check(descriptor("media_jobs").inputSchema, { all: "yes" }), false);
  const estimate = descriptor("media_estimate").inputSchema;
  assert.equal(check(estimate, { ...base, priceVariant: "x" }), true);
  assert.equal(check(estimate, { ...base, priceVariant: "x".repeat(201) }), false);
  for (const [name, properties] of [
    ["media_submit", ["requestId", "model", "adapter", "status", "outputs"]],
    ["media_estimate", ["model", "adapter", "usd", "prices", "quantity", "unit", "note"]],
  ] as const) {
    const output = descriptor(name).outputSchema as Schema;
    for (const property of properties) assert.ok(output.properties[property], `${name}.${property}`);
  }
});

test("the media tools take quality, and the CLI help names the flag", async () => {
  const { buildMediaToolDescriptors } = await import("../lib/providers/media/toolSchema.ts");
  const tools = buildMediaToolDescriptors([]) as { name: string; inputSchema: { properties: Record<string, unknown> } }[];
  const taking = tools.filter((tool) => "resolution" in tool.inputSchema.properties);
  assert.ok(taking.some((tool) => tool.name === "media_estimate") && taking.length >= 2, "the estimate and the submit tool");
  for (const tool of taking) assert.deepEqual(tool.inputSchema.properties.quality, tool.inputSchema.properties.resolution, tool.name);
  const { readFile } = await import("node:fs/promises");
  assert.ok((await readFile(new URL("../bin/commands/media.ts", import.meta.url), "utf8")).includes("[--resolution R] [--quality Q]"));
});
