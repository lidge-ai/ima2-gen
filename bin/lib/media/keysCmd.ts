import type { ParsedArgs } from "../args.js";
import { request } from "../client.js";
import { confirmDestructiveAction } from "../destructive-confirm.js";
import { deleteKey, keyStatus, validateKey } from "../mediaApi.js";
import { MediaApiError, scrub, toMediaApiError } from "../mediaErrors.js";
import { pairs, type Dict } from "./common.js";

async function safeExtra(base: string, name: string, extra: Record<string, string>) {
  if (!Object.keys(extra).length) return;
  const data = await request<{ vocabularies: Dict[] }>(base, "/api/keys/vocabulary");
  const vocab = data.vocabularies.find((item) => item.vocabulary === name);
  const fields = Array.isArray(vocab?.extraFields) ? vocab.extraFields as Dict[] : [];
  for (const key of Object.keys(extra)) {
    const field = fields.find((item) => item.name === key);
    if (!field || field.secret) throw new MediaApiError("MEDIA_SECRET_ON_ARGV", `Unknown or secret extra field: ${key}`);
  }
}
async function readInput(args: ParsedArgs): Promise<{ apiKey?: string; extra?: Record<string, string> }> {
  if (args["key-stdin"] && args["stdin-json"]) throw new Error("Choose one stdin mode");
  if (!args["key-stdin"] && !args["stdin-json"]) return {};
  const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) throw new Error("Empty key on stdin");
  if (args["key-stdin"]) return { apiKey: text };
  const parsed = JSON.parse(text) as { apiKey?: string; extra?: Record<string, string> };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed.apiKey !== undefined && typeof parsed.apiKey !== "string") || (parsed.extra !== undefined && (!parsed.extra || typeof parsed.extra !== "object" || Array.isArray(parsed.extra) || Object.values(parsed.extra).some((v) => typeof v !== "string")))) throw new Error("Invalid stdin JSON");
  return parsed;
}
function scrubValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return scrub(value, secrets);
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, secrets)]));
  return value;
}
export async function keyCommand(base: string, args: ParsedArgs): Promise<unknown> {
  const [, action, name] = args.positional;
  if (!action) return keyStatus(base, { redact: false });
  if (!name) throw new Error("Vocabulary required");
  if (action === "delete") {
    if (!args.yes && !process.stdin.isTTY) throw new MediaApiError("MEDIA_CONFIRM_REQUIRED", "Use --yes in non-interactive mode");
    if (!await confirmDestructiveAction(`Delete ${name}?`, Boolean(args.yes))) return { ok: false };
    return deleteKey(base, name);
  }
  if (action !== "set" && action !== "validate") throw new Error("Unknown keys command");
  const extra = pairs(args.extra); await safeExtra(base, name, extra);
  const input = await readInput(args);
  if (action === "set" && !args["key-stdin"] && !args["stdin-json"]) throw new Error("keys set requires stdin");
  const secrets = [input.apiKey ?? "", ...Object.values(input.extra ?? {})].filter(Boolean);
  if (action === "validate" && input.apiKey && input.apiKey.length < 6) throw new MediaApiError("KEY_TOO_SHORT", "Credential is too short");
  const body = { ...(input.apiKey !== undefined && { apiKey: input.apiKey }), extra: { ...input.extra, ...extra } };
  try {
    if (action === "validate") return scrubValue(await validateKey(base, name, body), secrets);
    const payload = name === "vertex" ? { serviceAccountJson: input.apiKey } : body;
    await request(base, `/api/keys/${encodeURIComponent(name)}`, { method: "PUT", body: payload });
    return { ok: true, vocabulary: name };
  } catch (error) { throw toMediaApiError(error, secrets); }
}
