import { writeFile, access, readFile } from "fs/promises";
import { parseArgs, type FlagValue, type ParsedArgs } from "../lib/args.js";
import { resolveServer, request } from "../lib/client.js";
import { out, die, color, json, exitCodeForError } from "../lib/output.js";
import { errInfo } from "../../lib/errInfo.js";

const HELP = `
  ima2 comfy <subcommand> [options]

  Subcommands:
    export <filename> [-o <out>] [--force]
    workflow ls [--json]
    workflow inspect <file> [--json]
    workflow add <file> --id <id> [--label <text>] [--kind image|video] [--origin <url>]
                        [--prompt <node.input>] [--negative <node.input>]
                        [--width <node.input>] [--height <node.input>]
                        [--seed <node.input>] [--ref <node.input>]
                        [--output <node>] [--yes] [--replace]
     workflow rm <id>

   A workflow file is either a ComfyUI API-format JSON export
   (Workflow > Export (API)) or a PNG ComfyUI produced, which carries the
   same graph in its metadata. The format is detected from the bytes, not
   the extension.
`;

const FLAGS = {
  json: { type: "boolean" },
  server: { type: "string" },
  out: { short: "o", type: "string" },
  force: { type: "boolean" },
  help: { short: "h", type: "boolean" },
};

const WORKFLOW_FLAGS = {
  ...FLAGS,
  id: { type: "string" },
  label: { type: "string" },
  kind: { type: "string" },
  origin: { type: "string" },
  prompt: { type: "string" },
  negative: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  seed: { type: "string" },
  ref: { type: "string" },
  output: { type: "string" },
  yes: { type: "boolean" },
  replace: { type: "boolean" },
};

interface ComfyCandidate {
  field: string;
  node: string;
  input?: string;
  unambiguous?: boolean;
  classType?: string;
  title?: string;
}

interface ComfyInspectResponse {
  nodes: unknown[];
  candidates?: ComfyCandidate[];
  mediaKind?: string;
  needsConfirmation?: boolean;
}

interface ComfyWorkflowSummary {
  id: string;
  label?: string;
  mediaKind?: string;
  origin?: string;
  health?: { ok?: boolean; reason?: string };
}

const PNG_SIGNATURE_HEX = "89504e470d0a1a0a";

/**
 * Reads a workflow file as the server expects it.
 *
 * Judged by magic bytes rather than extension: someone who saved a ComfyUI
 * PNG as .json still gets a working registration, and a .png that is really
 * JSON is not silently mishandled.
 */
async function readWorkflowFile(path: string): Promise<{ pngBase64: string } | { graph: unknown }> {
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch {
    die(2, `cannot read ${path}`);
    throw new Error("unreachable");
  }
  if (buffer.subarray(0, 8).toString("hex") === PNG_SIGNATURE_HEX) {
    return { pngBase64: buffer.toString("base64") };
  }
  try {
    return { graph: JSON.parse(buffer.toString("utf8")) };
  } catch {
    die(2, `${path} is neither a PNG nor valid JSON`);
    throw new Error("unreachable");
  }
}

/** "6.text" -> { node: "6", input: "text" }; "9" -> { node: "9" }. */
function parseBinding(flag: FlagValue, field: string): { node: string; input: string } | undefined {
  if (!flag) return undefined;
  const value = String(flag);
  const dot = value.indexOf(".");
  if (dot < 1 || dot === value.length - 1) {
    die(2, `--${field} must look like <node>.<input>, e.g. --${field} 6.text`);
  }
  return { node: value.slice(0, dot), input: value.slice(dot + 1) };
}

async function exportSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  const filename = args.positional[0];
  if (!filename) die(2, "filename required");
  let server;
  try { server = await resolveServer({ serverFlag: args.server }); }
  catch (e) { die(exitCodeForError(e), errInfo(e).message); }
  const resp = await request(server.base, "/api/comfy/export-image", {
    method: "POST",
    body: { filename },
  }).catch((e: unknown) => { const err = e as { message?: string; code?: string }; die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`); });
  const target = String(args.out || `${filename}.workflow.json`);
  if (!args.force) {
    try {
      await access(target);
      die(2, `${target} already exists. Pass --force to overwrite.`);
    } catch { /* file does not exist — proceed */ }
  }
  await writeFile(target, JSON.stringify(resp, null, 2));
  if (args.json) { json({ path: target }); return; }
  out(color.green("✓ ") + target);
}

async function serverBase(serverFlag: unknown): Promise<string> {
  try {
    return (await resolveServer({ serverFlag })).base;
  } catch (e: unknown) {
    die(exitCodeForError(e), errInfo(e).message);
    throw e;
  }
}

async function workflowLs(args: ParsedArgs): Promise<void> {
  const base = await serverBase(args.server);
  const resp = await request<{ workflows?: ComfyWorkflowSummary[] } | null>(base, "/api/comfy/workflows", { method: "GET" })
    .catch((e: unknown) => {
      const err = e as { message?: string; code?: string };
      die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
    });
  const workflows = resp?.workflows ?? [];
  if (args.json) { json({ workflows }); return; }
  if (workflows.length === 0) {
    out("No workflow registered. Add one with: ima2 comfy workflow add <file> --id <id>");
    return;
  }
  const pad = (value: string, width: number) => value.padEnd(width);
  const idWidth = Math.max(4, ...workflows.map((w) => w.id.length));
  const labelWidth = Math.max(5, ...workflows.map((w) => String(w.label ?? "").length));
  out(`${pad("ID", idWidth)}  ${pad("LABEL", labelWidth)}  KIND   ORIGIN`);
  for (const workflow of workflows) {
    // Liveness is per origin, not per lane: one instance can be down while
    // another serves fine.
    const health = workflow.health?.ok
      ? color.green("ready")
      : color.yellow(`offline${workflow.health?.reason ? ` (${workflow.health.reason})` : ""}`);
    out(`${pad(workflow.id, idWidth)}  ${pad(String(workflow.label ?? ""), labelWidth)}  ${pad(String(workflow.mediaKind ?? "image"), 6)} ${workflow.origin}  ${health}`);
  }
}

async function workflowInspect(args: ParsedArgs): Promise<void> {
  const file = args.positional[0];
  if (!file) die(2, "workflow file required");
  const base = await serverBase(args.server);
  const body = await readWorkflowFile(file);
  const resp = await request<ComfyInspectResponse>(base, "/api/comfy/inspect", { method: "POST", body })
    .catch((e: unknown) => {
      const err = e as { message?: string; code?: string };
      die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
    });
  if (args.json) { json(resp); return; }
  out(`${resp.nodes.length} nodes`);
  for (const candidate of resp.candidates ?? []) {
    const mark = candidate.unambiguous ? color.green("auto") : color.yellow("pick");
    const target = candidate.input ? `${candidate.node}.${candidate.input}` : candidate.node;
    out(`  ${mark}  ${candidate.field.padEnd(15)} ${target.padEnd(12)} ${candidate.classType}${candidate.title ? `  "${candidate.title}"` : ""}`);
  }
  out(`  kind             ${resp.mediaKind ?? "image"}`);
  if (resp.needsConfirmation) {
    out("");
    out("Some fields have several candidates; pass them explicitly when adding, e.g. --prompt 6.text");
  }
}

async function workflowAdd(args: ParsedArgs): Promise<void> {
  const file = args.positional[0];
  if (!file) die(2, "workflow file required");
  if (!args.id) die(2, "--id is required");
  const base = await serverBase(args.server);
  const source = await readWorkflowFile(file);

  const inspected = await request<ComfyInspectResponse>(base, "/api/comfy/inspect", { method: "POST", body: source })
    .catch((e: unknown) => {
      const err = e as { message?: string; code?: string };
      die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
    });
  const explicitKind = args.kind === undefined ? undefined : String(args.kind);
  if (explicitKind && explicitKind !== "image" && explicitKind !== "video") {
    die(2, "--kind must be image or video");
  }
  const mediaKind = explicitKind ?? inspected.mediaKind ?? "image";

  const explicit = {
    prompt: parseBinding(args.prompt, "prompt"),
    negativePrompt: parseBinding(args.negative, "negative"),
    width: parseBinding(args.width, "width"),
    height: parseBinding(args.height, "height"),
    seed: parseBinding(args.seed, "seed"),
    refImage: parseBinding(args.ref, "ref"),
  };

  const bind: Record<string, unknown> = {};
  for (const candidate of inspected.candidates ?? []) {
    if (candidate.field === "output") {
      if (candidate.unambiguous) bind.output = { node: candidate.node };
      continue;
    }
    if (candidate.unambiguous) bind[candidate.field] = { node: candidate.node, input: candidate.input };
  }
  for (const [field, value] of Object.entries(explicit)) {
    if (value) bind[field] = value;
  }
  if (args.output) bind.output = { node: args.output };

  /**
   * Ambiguity is never resolved by guessing, and --yes does not override it.
   *
   * Two CLIPTextEncode nodes is the ordinary shape and nothing in the graph
   * distinguishes positive from negative — _meta.title is free text the user
   * can rename. A wrong guess swaps the prompts silently and surfaces later as
   * "the model ignores my prompt", with nothing pointing back here. --yes only
   * accepts the candidates that were already unambiguous.
   */
  const unresolved = (inspected.candidates ?? [])
    .filter((candidate) => !candidate.unambiguous)
    .map((candidate) => candidate.field)
    .filter((field: string, index: number, all: string[]) => all.indexOf(field) === index)
    .filter((field: string) => !(field in bind));
  if (unresolved.length > 0) {
    const flagFor: Record<string, string> = {
      prompt: "--prompt", negativePrompt: "--negative", width: "--width",
      height: "--height", seed: "--seed", refImage: "--ref", output: "--output",
    };
    die(2, `ambiguous bindings: ${unresolved.join(", ")}\n`
      + `Run: ima2 comfy workflow inspect ${file}\n`
      + `Then pass each explicitly, e.g. ${unresolved.map((f: string) => `${flagFor[f] ?? f} <node>.<input>`).join(" ")}`);
  }
  if (!bind.prompt || !bind.output) {
    die(2, "a prompt binding and an output node are required (see: ima2 comfy workflow inspect <file>)");
  }

  const resp = await request<{ workflow: ComfyWorkflowSummary }>(base, "/api/comfy/workflows", {
    method: "POST",
    body: {
      ...source,
      id: args.id,
      ...(args.label ? { label: args.label } : {}),
      ...(args.origin ? { origin: args.origin } : {}),
      mediaKind,
      bind,
      ...(args.replace ? { replace: true } : {}),
    },
  }).catch((e: unknown) => {
    const err = e as { message?: string; code?: string };
    die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
  });
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + `${resp.workflow.id} -> ${resp.workflow.origin}`);
  if (resp.workflow.mediaKind === "video") {
    out("  catalog-only: ComfyUI video execution is not supported yet");
  } else {
    out(`  use it with: ima2 gen "<prompt>" --provider comfy --model ${resp.workflow.id}`);
  }
}

async function workflowRm(args: ParsedArgs): Promise<void> {
  const id = args.positional[0];
  if (!id) die(2, "workflow id required");
  const base = await serverBase(args.server);
  const resp = await request(base, `/api/comfy/workflows/${encodeURIComponent(id)}`, { method: "DELETE" })
    .catch((e: unknown) => {
      const err = e as { message?: string; code?: string };
      die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
    });
  if (args.json) { json(resp); return; }
  out(color.green("✓ ") + `removed ${id}`);
}

const WORKFLOW_SUB: Record<string, (args: ParsedArgs) => Promise<void>> = {
  ls: workflowLs,
  inspect: workflowInspect,
  add: workflowAdd,
  rm: workflowRm,
};

async function workflowSub(argv: string[]): Promise<void> {
  const action = argv[0];
  if (!action || action === "--help" || action === "-h") { out(HELP); return; }
  const handler = WORKFLOW_SUB[action];
  if (!handler) die(2, `unknown workflow action: ${action}\n${HELP}`);
  const args = parseArgs(argv.slice(1), { flags: WORKFLOW_FLAGS });
  return handler(args);
}

const SUB: Record<string, (argv: string[]) => Promise<void>> = {
  export: exportSub,
  workflow: workflowSub,
};

export default async function comfyCmd(argv: string[]) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") { out(HELP); return; }
  const handler = SUB[sub];
  if (!handler) die(2, `unknown subcommand: ${sub}\n${HELP}`);
  return handler(argv.slice(1));
}
