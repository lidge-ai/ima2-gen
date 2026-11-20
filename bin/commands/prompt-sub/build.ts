import { readFile } from "fs/promises";
import { parseArgs } from "../../lib/args.js";
import { resolveServer, request } from "../../lib/client.js";
import { readStdin } from "../../lib/files.js";
import { out, die, color, json, exitCodeForError } from "../../lib/output.js";

const BUILD_HELP = `
  ima2 prompt build [options]

  Refine prompt intent through the embedded prompt builder.

  Options:
    --message <text>          User message (required unless --messages)
    --messages <file|@file|-> Multi-turn conversation as JSON array
    --ref <image>             Image reference (repeatable)
    --backend <backend>       Backend override (auto, oauth, api, grok, grok-api)
    --model <model>           Model for the configured Prompt Builder backend
    --language <ko|en|both>   Preferred output language hint
    --server <url>            Override server URL
    --json                    Output raw JSON
    -h, --help                Show this help

  Examples:
    ima2 prompt build --message "make this prompt more cinematic" --json
    ima2 prompt build --messages @conversation.json --model gpt-6-luna
    echo '{"role":"user","content":"hi"}' | ima2 prompt build --messages -
`;

const FLAGS = {
  message: { type: "string" },
  messages: { type: "string" },
  ref: { type: "string", repeatable: true },
  backend: { type: "string" },
  model: { type: "string" },
  language: { type: "string" },
  server: { type: "string" },
  json: { type: "boolean" },
  help: { short: "h", type: "boolean" },
} as const;

async function resolveMessages(args: Record<string, unknown>): Promise<Array<{ role: string; content: string }>> {
  if (args.messages) {
    const raw = String(args.messages);
    let text: string;
    if (raw === "-") {
      text = await readStdin();
    } else if (raw.startsWith("@")) {
      text = await readFile(raw.slice(1), "utf-8");
    } else {
      text = await readFile(raw, "utf-8");
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) die(2, "--messages must resolve to a JSON array");
    return parsed;
  }
  if (args.message) {
    return [{ role: "user", content: String(args.message) }];
  }
  die(2, "--message or --messages required");
  throw new Error("unreachable");
}

export default async function buildSub(argv: string[]) {
  const args = parseArgs(argv, { flags: FLAGS });
  if (args.help) { out(BUILD_HELP); return; }

  const messages = await resolveMessages(args);
  const body: Record<string, unknown> = { messages };
  if (args.backend) body.backend = args.backend;
  if (args.model) body.model = args.model;

  let server: { base: string };
  try {
    server = await resolveServer({ serverFlag: args.server as string | undefined });
  } catch (e: unknown) {
    die(exitCodeForError(e), (e as Error).message);
    throw e;
  }

  let result: Record<string, unknown>;
  try {
    result = await request(server.base, "/api/prompt-builder/chat", {
      method: "POST",
      body,
    }) as Record<string, unknown>;
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    die(exitCodeForError(e), `${err.message}${err.code ? ` (${err.code})` : ""}`);
    throw e;
  }

  if (args.json) {
    json(result);
    return;
  }

  const message = result.message as { content?: string } | undefined;
  const content = message?.content ?? "";
  if (content) {
    out(content);
  } else {
    out(color.dim("(empty response)"));
  }
}
