/**
 * Pure request/response transforms for the Codex backend. No I/O here, so each rule is
 * unit-testable on its own.
 */

export const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Plain strings and string-content messages become the typed content parts the backend expects. */
export function normalizeInput(input: unknown): unknown[] {
  if (typeof input === "string") return [{ role: "user", content: [{ type: "input_text", text: input }] }];
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (!isRecord(item) || typeof item.content !== "string" || typeof item.role !== "string") return item;
    const type = item.role === "assistant" ? "output_text" : "input_text";
    return { ...item, content: [{ type, text: item.content }] };
  });
}

/**
 * Shape a Responses body for the Codex backend. Lite models (catalog \`use_responses_lite\`, which
 * includes every GPT-6 model) take tools as an \`additional_tools\` developer item, instructions as
 * a developer message, \`reasoning.context: "all_turns"\`, and no parallel tool calls.
 */
export function normalizeResponsesBody(body: Json, lite: boolean): Json {
  const out: Json = { ...body, input: normalizeInput(body.input), store: false, stream: true };
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  if (!lite) {
    out.instructions = instructions;
    return out;
  }
  const prefix: unknown[] = [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.length) prefix.push({ type: "additional_tools", role: "developer", tools });
  if (instructions) prefix.push({ role: "developer", content: [{ type: "input_text", text: instructions }] });
  out.input = [...prefix, ...(out.input as unknown[])];
  out.instructions = "";
  out.parallel_tool_calls = false;
  out.reasoning = { ...(isRecord(body.reasoning) ? body.reasoning : {}), context: "all_turns" };
  delete out.tools;
  // A named tool_choice points at \`tools\`, which lite requests no longer carry.
  if (isRecord(out.tool_choice)) delete out.tool_choice;
  return out;
}

/** Chat Completions → Responses, for the JSON planners that still speak chat. */
export function chatToResponsesBody(body: Json): Json {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const input = messages.filter(isRecord).map((message) => ({
    role: message.role === "system" ? "developer" : message.role,
    content: message.content,
  }));
  const format = isRecord(body.response_format) ? body.response_format : null;
  return {
    model: body.model,
    input,
    ...(format?.type === "json_object" ? { text: { format: { type: "json_object" } } } : {}),
    ...(isRecord(body.reasoning) ? { reasoning: body.reasoning } : {}),
  };
}

/** Pull the final assistant text out of a completed Responses object. */
export function responseOutputText(response: Json): string {
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) if (isRecord(part) && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("");
}

export function responsesToChatCompletion(response: Json): Json {
  return {
    id: response.id,
    object: "chat.completion",
    model: response.model,
    choices: [{ index: 0, message: { role: "assistant", content: responseOutputText(response) }, finish_reason: "stop" }],
    ...(isRecord(response.usage) ? { usage: response.usage } : {}),
  };
}

/** Read an SSE body and return the completed response object, or the stream's error. */
export async function collectCompletedResponse(body: ReadableStream<Uint8Array>): Promise<{ response?: Json; error?: Json }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { response?: Json; error?: Json } = {};
  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("");
    if (!data || data === "[DONE]") return;
    let event: unknown;
    try { event = JSON.parse(data); } catch { return; }
    if (!isRecord(event)) return;
    if ((event.type === "response.completed" || event.type === "response.done") && isRecord(event.response)) result = { response: event.response };
    if (event.type === "response.failed" && isRecord(event.response)) result = { error: isRecord(event.response.error) ? event.response.error : { message: "response failed" } };
    if (event.type === "error") result = { error: isRecord(event.error) ? event.error : event };
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
  }
  if (buffer.trim()) consume(buffer);
  return result;
}

const EDIT_SCALARS = ["model", "prompt", "background", "quality", "size", "moderation", "output_format", "n"] as const;

/** The Codex images edit endpoint takes JSON with data-URL images; accept the OpenAI multipart shape too. */
export async function editsFormToJson(form: FormData): Promise<Json> {
  const body: Json = {};
  for (const key of EDIT_SCALARS) {
    const value = form.get(key);
    if (typeof value === "string" && value) body[key] = key === "n" ? Number(value) : value;
  }
  type Upload = { type: string; arrayBuffer(): Promise<ArrayBuffer> };
  const files = [...form.getAll("image"), ...form.getAll("image[]")]
    .filter((value) => typeof value !== "string") as unknown as Upload[];
  body.images = await Promise.all(files.map(async (file) => ({
    image_url: `data:${file.type || "image/png"};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`,
  })));
  return body;
}
