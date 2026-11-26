/**
 * Converts a published JSON/OpenAPI input schema into EndpointSchema fields.
 * Used at runtime for endpoints outside the compiled catalog (fal, Atlas Cloud,
 * Replicate all publish one), so a discovered model can be submitted safely.
 */
import type { MediaTask } from "../../contract.js";
import type { EndpointSchema, InputField } from "./fields.js";
import { asArray, asNumber, asRecord, asString } from "./http.js";

function nonNullAlternative(prop: Record<string, unknown>): Record<string, unknown> {
  const alternatives = asArray(prop.anyOf ?? prop.oneOf).map(asRecord);
  return alternatives.find((alt) => alt.type !== "null") ?? prop;
}

function typeOf(prop: Record<string, unknown>, alt: Record<string, unknown>): string | undefined {
  const declared = asString(prop.type) ?? asString(alt.type);
  if (declared) return declared;
  if (alt.$ref || prop.$ref || prop.allOf) return "object";
  return undefined;
}

export function toInputField(raw: unknown): InputField {
  const prop = asRecord(raw);
  const alt = nonNullAlternative(prop);
  const items = asRecord(alt.items ?? prop.items);
  const field: InputField = {};
  const type = typeOf(prop, alt);
  if (type) field.type = type;
  const values = asArray(alt.enum ?? prop.enum).filter((v): v is string | number => typeof v === "string" || typeof v === "number");
  if (values.length > 0) field.enum = values;
  const minimum = asNumber(alt.minimum ?? prop.minimum);
  const maximum = asNumber(alt.maximum ?? prop.maximum);
  const maxItems = asNumber(alt.maxItems ?? prop.maxItems);
  if (minimum !== undefined) field.minimum = minimum;
  if (maximum !== undefined) field.maximum = maximum;
  if (maxItems !== undefined) field.maxItems = maxItems;
  if (Object.keys(items).length > 0) field.items = asString(items.type) ?? "object";
  return field;
}

/** Fields of one JSON schema object ({ properties, required }). */
export function endpointFromJsonSchema(endpoint: string, task: MediaTask, schema: unknown): EndpointSchema {
  const record = asRecord(schema);
  const fields: Record<string, InputField> = {};
  for (const [name, prop] of Object.entries(asRecord(record.properties))) fields[name] = toInputField(prop);
  const required = asArray(record.required).filter((v): v is string => typeof v === "string");
  return { endpoint, task, required, fields };
}

function refName(value: unknown): string | undefined {
  const match = /#\/components\/schemas\/([A-Za-z0-9_.-]+)/.exec(JSON.stringify(value ?? null));
  return match?.[1];
}

/** The request-body schema of the first POST operation in an OpenAPI document. */
export function requestSchemaFromOpenApi(doc: unknown): unknown {
  const root = asRecord(doc);
  const schemas = asRecord(asRecord(root.components).schemas);
  for (const pathItem of Object.values(asRecord(root.paths))) {
    const post = asRecord(asRecord(pathItem).post);
    if (Object.keys(post).length === 0) continue;
    const name = refName(post.requestBody);
    if (name && schemas[name]) return schemas[name];
  }
  return undefined;
}
