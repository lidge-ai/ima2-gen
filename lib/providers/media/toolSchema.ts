import { MEDIA_INPUT_ROLES } from "./inputs.js";
import { MAX_INPUTS, MAX_PROMPT_CHARS, MAX_SHORT_STRING, MEDIA_TASKS } from "./validate.js";
import type { WorkflowField } from "../../workflows/types.js";

export const MEDIA_TOOL_SCHEMA_VERSION = 1;
export type ObjectSchema = { type: "object"; properties: Record<string, object>; required?: string[]; [k: string]: unknown };
export interface MediaToolDescriptor {
  name: string;
  title: string;
  description: string;
  billed: boolean;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
}
export interface WorkflowSchemaSource { id: string; label: string; fields: readonly WorkflowField[] }

type InputSchema = ObjectSchema & { oneOf: { required: string[] }[] };
const string = { type: "string" };
const shortString = { type: "string", maxLength: MAX_SHORT_STRING };
const requestId = { type: "string", pattern: "^[A-Za-z0-9_.:-]{1,128}$" };
const kind = { type: "string", enum: ["image", "video", "audio"] };
const task = { type: "string", enum: MEDIA_TASKS };
const wait = { type: "boolean" };
const timeout = (max: number) => ({ type: "integer", minimum: 1, maximum: max });

function object(properties: Record<string, object>, required: string[] = []): ObjectSchema {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function sourceSchema(sources: Record<string, object>): InputSchema {
  return { ...object(sources), oneOf: Object.keys(sources).filter((key) => key !== "mimeType")
    .map((key) => ({ required: [key] })) };
}

export function mediaInputSchema(): InputSchema {
  const sources = sourceSchema({
    ref: { type: "string", minLength: 1 }, filename: { type: "string", minLength: 1 },
    url: { type: "string", pattern: "^(?:[Hh][Tt][Tt][Pp][Ss]://|asset://[A-Za-z0-9._-]{1,200}$)" },
    dataUrl: { type: "string", pattern: "^data:[^;,]+;base64," }, mimeType: string,
  });
  return { ...sources, properties: { role: { type: "string", enum: MEDIA_INPUT_ROLES }, ...sources.properties }, required: ["role"] };
}

export function withClientPath(schema: InputSchema): InputSchema {
  return { ...schema, properties: { ...schema.properties, path: {
    type: "string", minLength: 1, "x-ima2-client": true, description: "Local file; the client uploads it first.",
  } }, oneOf: [...schema.oneOf, { required: ["path"] }] };
}

function workflowMediaSchema(): InputSchema {
  return sourceSchema({
    ref: { type: "string", minLength: 1 }, filename: { type: "string", minLength: 1 },
    url: { type: "string", pattern: "^https://" }, mimeType: string,
  });
}

function fieldSchema(field: WorkflowField): object {
  switch (field.type) {
    case "text": return { type: "string", maxLength: field.maxLength };
    case "enum": return { type: "string", enum: field.options.map((option) => option.value), ...(field.default === undefined ? {} : { default: field.default }) };
    case "integer": return { type: "integer", minimum: field.min, maximum: field.max, ...(field.default === undefined ? {} : { default: field.default }) };
    case "boolean": return { type: "boolean", default: field.default };
    case "colors": return { type: "array", minItems: field.min, maxItems: field.max, items: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } };
    case "media": return { type: "array", minItems: field.min, maxItems: field.max, items: workflowMediaSchema() };
    case "shots": return { type: "array", minItems: field.min, maxItems: field.max, items: object({
      prompt: { type: "string", minLength: 1, maxLength: field.promptMaxLength },
      durationSec: { type: "integer", minimum: 1 },
    }, ["prompt", "durationSec"]) };
    default: { const exhaustive: never = field; return exhaustive; }
  }
}

export function workflowValuesSchema(fields: readonly WorkflowField[]): ObjectSchema {
  const schema = object(Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field)])),
    fields.filter((field) => field.required).map((field) => field.name));
  // A field required unless another is given: one of the two must be present.
  const either = fields.flatMap((field) => (field.requiredUnless ? [{ anyOf: [{ required: [field.name] }, { required: [field.requiredUnless] }] }] : []));
  if (either.length === 1) return { ...schema, ...either[0] };
  return either.length > 1 ? { ...schema, allOf: either } : schema;
}

export function withClientMediaPaths(schema: ObjectSchema): ObjectSchema {
  const properties = Object.fromEntries(Object.entries(schema.properties).map(([name, value]) => {
    const field = value as Record<string, unknown>;
    const items = field.items as InputSchema | undefined;
    if (field.type !== "array" || !items || items.type !== "object" || !items.properties || !Array.isArray(items.oneOf)
      || !items.properties.ref || !items.properties.filename || !items.properties.url) return [name, value];
    return [name, { ...field, items: withClientPath(items) }];
  }));
  return { ...schema, properties };
}

function clientWorkflowValues(fields: readonly WorkflowField[]): ObjectSchema {
  return withClientMediaPaths(workflowValuesSchema(fields));
}

function mediaJobSchema(clientPath: boolean): ObjectSchema {
  return object({
    model: { type: "string", minLength: 1, maxLength: MAX_SHORT_STRING }, task, adapter: shortString,
    prompt: { type: "string", maxLength: MAX_PROMPT_CHARS }, negativePrompt: { type: "string", maxLength: MAX_PROMPT_CHARS },
    durationSec: { type: "number" }, resolution: shortString, quality: shortString, aspectRatio: shortString,
    seed: { type: "integer" }, count: { type: "integer" }, audio: { type: "boolean" }, vendorOptions: { type: "object" },
    maskConvention: { type: "string", enum: ["vendor", "repaint-white"], description: "What the mask input means. vendor (default): the provider's own rule, passed through. repaint-white: a PNG the size of the image, white = repaint, black = keep; only routes that declare it take it." },
    inputs: { type: "array", maxItems: MAX_INPUTS, items: clientPath ? withClientPath(mediaInputSchema()) : mediaInputSchema() },
  }, ["model", "task"]);
}

function output(properties: Record<string, object>): ObjectSchema {
  return { type: "object", properties: { ...properties, ok: { type: "boolean" }, code: string, error: string,
    category: string, retryable: { type: "boolean" }, field: string, stepId: string, hint: string,
    status: { type: ["string", "number"] } } };
}

type ToolMode = "read" | "local" | "billed" | "cancel";
function tool(name: string, title: string, description: string, inputSchema: ObjectSchema,
  properties: Record<string, object>, mode: ToolMode = "read"): MediaToolDescriptor {
  return { name, title, description, inputSchema, outputSchema: output(properties), billed: mode === "billed", annotations: {
    readOnlyHint: mode === "read", destructiveHint: mode === "cancel", idempotentHint: mode !== "billed",
    openWorldHint: mode === "billed" || mode === "cancel",
  } };
}

const billedDescription = "BILLED: runs on the user's own provider key and is charged by that provider. Call media_estimate (or workflow_estimate) first. requestId is the job handle. Before submitting, ima2 checks whether it already knows this requestId (running, recent, or saved in history) and refuses it if so. The check is best-effort: it is not atomic with the submit and cannot see very old or pre-restart ids, so a retry can still create a second, separately billed job. Check media_job_status before retrying. If you cancel after the job was submitted, it keeps running; check media_job_status with your requestId.";
const estimateOutput = { model: string, adapter: string, usd: { type: ["number", "null"] }, quote: { type: "object" }, prices: { type: "array" }, quantity: { type: ["number", "null"] }, unit: string, note: string, route: string, hasKey: { type: "boolean" },
  local: { type: "object", properties: { expectedSec: { type: ["number", "null"] }, basis: string, mayBill: { type: "boolean" } } } };
const jobOutput = { requestId: string, jobId: string, model: string, adapter: string, outputs: { type: "array" },
  filename: { type: ["string", "null"] }, url: { type: ["string", "null"] }, mediaType: { type: ["string", "null"] }, elapsed: { type: "number" } };
const statusOutput = { job: { type: "object" }, pollAfterSeconds: { type: "number" }, timedOut: { type: "boolean" } };

function catalogTools(): MediaToolDescriptor[] {
  const estimate = mediaJobSchema(false);
  estimate.properties.priceVariant = shortString;
  const submit = mediaJobSchema(true);
  Object.assign(submit.properties, { requestId, wait, timeoutSec: timeout(600) });
  submit.required = [...(submit.required ?? []), "requestId"];
  return [
    tool("media_catalog", "Media catalog", "List available media models and routes; maxUsd filters by the cheapest published price.", object({ kind, vendor: shortString, task, model: shortString, adapter: shortString, keyed: { type: "boolean" }, maxUsd: { type: "number" } }), { models: { type: "array" }, adapters: { type: "array" } }),
    tool("media_keys_status", "Media keys status", "Inspect provider key availability.", object({}), { vocabularies: { type: "array" } }),
    tool("media_estimate", "Estimate media", "Informational: published price x quantity for the chosen route. The price row is chosen from the request (task, resolution, quality, audio, duration); one image and the route's default clip length are assumed when not given. usd is set when one published price applies; quote carries the full answer (exact, from, range, usage, unpriced, unknown). The provider's actual bill may differ.", estimate, estimateOutput),
    tool("media_submit", "Submit media", billedDescription, submit, jobOutput, "billed"),
  ];
}

function jobTools(): MediaToolDescriptor[] {
  const cursor = object({ before: { type: "number" }, beforeFilename: string }, ["before", "beforeFilename"]);
  return [
    tool("media_job_status", "Media job status", "Jobs stay listed while running and among the last 100 finished; saved outputs stay in history.", object({ requestId }, ["requestId"]), statusOutput),
    tool("media_wait", "Wait for media", "Wait for a media job to finish or the timeout to elapse.", object({ requestId, timeoutSec: timeout(60) }, ["requestId"]), statusOutput),
    tool("media_jobs", "Media jobs", "List media jobs.", object({ all: { type: "boolean" } }), { jobs: { type: "array" }, terminalJobs: { type: "array" } }),
    tool("media_cancel", "Cancel media", "Cancel a running media job.", object({ requestId }, ["requestId"]), { requestId: string, active: { type: "boolean" }, aborted: { type: "boolean" } }, "cancel"),
    tool("media_result", "Media result", "Retrieve or save a media job's outputs.", object({ requestId, saveDir: string }, ["requestId"]), { requestId: string, outputs: { type: "array" }, paths: { type: "array", items: string } }, "local"),
    tool("media_history", "Media history", "List saved media, continuing from the returned cursor when truncated.", object({ limit: timeout(50), kind, cursor }), { items: { type: "array" }, truncated: { type: "boolean" }, cursor: object({ before: { type: ["string", "number"] }, beforeFilename: string }) }),
  ];
}

function workflowArguments(workflows: readonly WorkflowSchemaSource[], run: boolean): ObjectSchema {
  const id = workflows.length ? { type: "string", enum: workflows.map((workflow) => workflow.id) } : string;
  const selection = object({ models: { type: "object", additionalProperties: string }, routes: { type: "object", additionalProperties: string } });
  const schema = object({ id, values: { type: "object" }, selection, ...(run ? { requestId, wait, timeoutSec: timeout(600) } : {}) }, run ? ["id", "requestId"] : ["id"]);
  if (workflows.length) schema.allOf = workflows.map((workflow) => ({
    if: { properties: { id: { const: workflow.id } }, required: ["id"] },
    then: { properties: { values: clientWorkflowValues(workflow.fields) } },
  }));
  return schema;
}

function workflowTools(workflows: readonly WorkflowSchemaSource[]): MediaToolDescriptor[] {
  const id = workflows.length ? { type: "string", enum: workflows.map((workflow) => workflow.id) } : string;
  return [
    tool("workflow_list", "List workflows", "List available workflows.", object({}), { workflows: { type: "array" } }),
    tool("workflow_schema", "Workflow schema", "Get a workflow's input schema.", object({ id }, ["id"]), { id: string, label: string, schema: { type: "object" } }),
    tool("workflow_estimate", "Estimate workflow", "Prices each step from published prices. Runs a local media probe; calls no provider.", workflowArguments(workflows, false), { estimate: { type: "object" }, steps: { type: "array" } }, "local"),
    tool("workflow_run", "Run workflow", `${billedDescription} Director text planning uses the signed-in GPT session.`, workflowArguments(workflows, true), { ...jobOutput, workflow: string, estimate: { type: "object" }, steps: { type: "array" } }, "billed"),
  ];
}

export function buildMediaToolDescriptors(workflows: readonly WorkflowSchemaSource[]): MediaToolDescriptor[] {
  return [...catalogTools(), ...jobTools(), ...workflowTools(workflows)];
}
