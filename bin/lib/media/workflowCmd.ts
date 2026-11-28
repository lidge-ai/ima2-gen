import { request } from "../client.js";
import { inputs, type Dict } from "./common.js";

function groupPairs(values: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const entry of (values as string[] ?? [])) {
    const i = entry?.indexOf("=") ?? -1;
    if (i < 1) throw new Error("Expected --input name=value");
    out.set(entry.slice(0, i), [...(out.get(entry.slice(0, i)) ?? []), entry.slice(i + 1)]);
  }
  return out;
}

/** --input shots=<seconds>:<prompt>, repeated once per shot in order. */
function shot(value: string): Dict {
  const i = value.indexOf(":");
  const seconds = Number(value.slice(0, i));
  const prompt = value.slice(i + 1).trim();
  if (i < 1 || !Number.isInteger(seconds) || !prompt) throw new Error(`Invalid shot (expected <seconds>:<prompt>): ${value}`);
  return { prompt, durationSec: seconds };
}
// Field types come from the L6 workflow schema (GET /api/workflows fields[]). Repeat --input for lists.
export async function workflowInput(base: string, id: string, values: unknown): Promise<Dict> {
  const catalog = await request<{ workflows: Dict[] }>(base, "/api/workflows");
  const workflow = catalog.workflows.find((item) => item.id === id);
  if (!workflow) throw new Error(`Unknown workflow: ${id}`);
  const fields = workflow.fields as Dict[];
  const result: Dict = {};
  for (const [name, list] of groupPairs(values)) {
    const type = String(fields.find((field) => field.name === name)?.type ?? "");
    if (!type) throw new Error(`Unknown workflow field: ${name}`);
    if (type === "media") {
      result[name] = (await inputs(base, list.map((v) => `source=${v}`))).map(({ role: _role, ...source }) => source);
    } else if (type === "colors") {
      result[name] = list.flatMap((v) => v.split(","));
    } else if (type === "shots") {
      result[name] = list.map(shot);
    } else if (type === "integer") {
      const n = Number(list[0]); if (!Number.isInteger(n)) throw new Error(`Invalid integer: ${name}`); result[name] = n;
    } else if (type === "boolean") {
      if (list[0] !== "true" && list[0] !== "false") throw new Error(`Invalid boolean: ${name}`); result[name] = list[0] === "true";
    } else result[name] = list[0];
  }
  return result;
}
