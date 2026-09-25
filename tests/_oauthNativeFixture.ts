/**
 * Test adapter for the GPT OAuth image lane (lib/oauthImages.ts).
 *
 * GPT OAuth now plans with a GPT-6 model (a streamed /v1/responses call that must call the
 * `image_gen` function tool) and renders through /v1/images/{generations,edits}. Many route and
 * queue tests only care that "one upstream call yields this image". `withNativeOAuth` lets them
 * keep a legacy fixture: the wrapped mock still answers the planner call (so hit counts, holds and
 * aborts behave as before), each `image_generation_call` it returns becomes an `image_gen` call,
 * and the render call that follows is answered with that image. Every other request, including
 * text-only planner calls, passes through untouched.
 */
export type FetchLike = (input: any, init?: any) => Promise<Response>;

export interface NativeOAuthCalls {
  planner: Array<{ url: string; payload: any }>;
  images: Array<{ url: string; kind: "generations" | "edits"; prompt: string; fields: Record<string, string>; imageCount: number }>;
}

const IMAGE_TOOL = "image_gen";

function urlOf(input: unknown): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request)?.url ?? input);
}

export function isImagePlannerPayload(payload: any): boolean {
  return Array.isArray(payload?.tools) && payload.tools.some((tool: any) => tool?.type === "function" && tool?.name === IMAGE_TOOL);
}

function parsePayload(init: any): any {
  try { return JSON.parse(String(init?.body ?? "")); } catch { return null; }
}

async function renderRequest(init: any) {
  const body = init?.body;
  if (body instanceof FormData) {
    const fields: Record<string, string> = {};
    let imageCount = 0;
    body.forEach((value, key) => {
      if (key === "image") imageCount++;
      else if (typeof value === "string") fields[key] = value;
    });
    return { prompt: fields.prompt ?? "", fields, imageCount };
  }
  const json = parsePayload(init) ?? {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(json)) if (typeof value === "string") fields[key] = value;
  const imageCount = Array.isArray(json.images) ? json.images.length : 0;
  return { prompt: fields.prompt ?? "", fields, imageCount };
}

function sseEvents(text: string): any[] {
  return text.split(/\r?\n/)
    .filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]")
    .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
    .filter(Boolean);
}

export function plannerSse(prompts: string[], usage: Record<string, number> = { total_tokens: 1 }): Response {
  const events = [
    ...prompts.map((prompt, index) => ({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: `call_fixture_${index}`, name: IMAGE_TOOL, arguments: JSON.stringify({ prompt }) },
    })),
    { type: "response.completed", response: { usage } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200, headers: { "content-type": "text/event-stream" },
  });
}

export function imagesJson(b64: string): Response {
  return new Response(JSON.stringify({ data: [{ b64_json: b64 }], usage: { total_tokens: 1 } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export function withNativeOAuth(inner: FetchLike, options: { fallbackImage?: string } = {}): FetchLike & { calls: NativeOAuthCalls } {
  const rendered = new Map<string, string[]>();
  let lastImage = options.fallbackImage ?? "";
  let callIndex = 0;
  const calls: NativeOAuthCalls = { planner: [], images: [] };
  const remember = (prompt: string, b64: string) => {
    rendered.set(prompt, [...(rendered.get(prompt) ?? []), b64]);
    lastImage = b64;
  };
  const toCall = (item: any) => {
    const prompt = typeof item.revised_prompt === "string" && item.revised_prompt ? item.revised_prompt : "fixture image";
    remember(prompt, item.result);
    return { type: "function_call", call_id: `call_fixture_${callIndex++}`, name: IMAGE_TOOL, arguments: JSON.stringify({ prompt }) };
  };
  const isImageItem = (item: any) => item?.type === "image_generation_call" && typeof item.result === "string" && item.result.length > 0;

  const wrapped = (async (input: any, init?: any) => {
    const url = urlOf(input);
    const pathname = (() => { try { return new URL(url).pathname; } catch { return url; } })();
    const render = /\/v1\/images\/(generations|edits)$/.exec(pathname);
    if (render) {
      const request = await renderRequest(init);
      calls.images.push({ url, kind: render[1] as "generations" | "edits", ...request });
      const b64 = rendered.get(request.prompt)?.shift() ?? lastImage;
      if (!b64) return new Response(JSON.stringify({ error: { message: "no fixture image" } }), { status: 500 });
      return imagesJson(b64);
    }
    const payload = pathname.endsWith("/v1/responses") ? parsePayload(init) : null;
    if (!isImagePlannerPayload(payload)) return inner(input, init);
    calls.planner.push({ url, payload });
    const res = await inner(input, init);
    if (!res.ok) return res;
    const text = await res.text();
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const json = JSON.parse(text);
      if (Array.isArray(json?.output)) json.output = json.output.map((item: any) => (isImageItem(item) ? toCall(item) : item));
      return new Response(JSON.stringify(json), { status: res.status, headers: res.headers });
    }
    const events = sseEvents(text).map((event) => (
      event?.type === "response.output_item.done" && isImageItem(event.item) ? { ...event, item: toCall(event.item) } : event
    ));
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: res.status, headers: res.headers });
  }) as FetchLike & { calls: NativeOAuthCalls };
  wrapped.calls = calls;
  return wrapped;
}

/**
 * Wrap every later `globalThis.fetch = mock` assignment in this test file with
 * `withNativeOAuth`, so queue/agent tests keep their one-call image fixtures unchanged.
 */
export function adaptFetchAssignmentsForNativeOAuth(): void {
  let current = globalThis.fetch as unknown as FetchLike;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: FetchLike) => {
      current = typeof next === "function" && !("calls" in next) ? withNativeOAuth(next) : next;
    },
  });
}
