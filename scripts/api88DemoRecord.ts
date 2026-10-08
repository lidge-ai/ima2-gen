import { writeFileSync } from "node:fs";
import { join } from "node:path";

export type RequestRow = {
  operation: string; model: string | null; method: string; endpoint: string;
  status: number | null; ms: number; bytes: number; authorization: string;
  state: "pending" | "complete" | "failed" | "cancelled";
};
export function masker(secrets: string[]) {
  const cleanText = (text: string): string => {
    for (const secret of secrets.filter(Boolean)) text = text.split(secret).join("[REDACTED]");
    return text.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .replace(/Bearer\s+[^\s"',}]+/gi, "Bearer [REDACTED]")
      .replace(/https?:\/\/[^\s"<>)]*/g, (value) => {
        const url = new URL(value);
        url.username = ""; url.password = ""; url.hash = "";
        if (url.search) url.search = "?[REDACTED]";
        return url.href;
      });
  };
  const clean = (value: unknown, key = ""): unknown => {
    if (/authorization|cookie|api.?key|api88(?:image|video)key|secret|token|password/i.test(key))
      return value === "absent" || value === "Bearer [REDACTED]" ? value : "[REDACTED]";
    if (typeof value === "string") return cleanText(value);
    if (Array.isArray(value)) return value.map(item => clean(item));
    if (value && typeof value === "object") return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, clean(item, name)]),
    );
    return value;
  };
  return { clean, text: cleanText };
}
export function saveJson(path: string, value: unknown, secrets: string[] = []): void {
  writeFileSync(path, JSON.stringify(masker(secrets).clean(value), null, 2) + "\n", { mode: 0o600 });
}
function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input));
  return { url, method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: new Headers(init?.headers ?? request?.headers), body: init?.body };
}
function modelOf(body: BodyInit | null | undefined): string | null {
  if (body instanceof FormData) return String(body.get("model") ?? "") || null;
  if (typeof body !== "string") return null;
  const value: unknown = JSON.parse(body);
  return value && typeof value === "object" && "model" in value && typeof value.model === "string"
    ? value.model : null;
}
function trackBody(response: Response, row: RequestRow, started: number, flush: () => void): Response {
  if (!response.body) { row.state = "complete"; flush(); return response; }
  const reader = response.body.getReader();
  const finish = (state: RequestRow["state"]) => {
    row.state = state; row.ms = Date.now() - started; flush();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) { finish("complete"); controller.close(); return; }
        row.bytes += chunk.value.byteLength; controller.enqueue(chunk.value);
      } catch (error) { finish("failed"); controller.error(error); }
    },
    async cancel(reason) { finish("cancelled"); await reader.cancel(reason); },
  });
  const wrapped = new Response(body, { status: response.status,
    statusText: response.statusText, headers: response.headers });
  Object.defineProperty(wrapped, "url", { value: response.url });
  Object.defineProperty(wrapped, "redirected", { value: response.redirected });
  return wrapped;
}
export function recordFetch(dir: string, origin: string, secrets: string[], name = "requests.masked.json", allowSubmissions = true) {
  const original = globalThis.fetch;
  const base = new URL(origin);
  const basePath = base.pathname.replace(/\/+$/, "");
  const rows: RequestRow[] = [];
  const submissions = new Set<string>();
  let operation = "preflight";
  let selectedModel: string | null = null;
  const flush = () => saveJson(join(dir, name), rows, secrets);
  const wrapper: typeof fetch = async (input, init) => {
    const { url, method, headers, body } = requestParts(input, init);
    if (method === "POST" && !allowSubmissions) throw new Error("DEMO_PREVIEW_SUBMIT_FORBIDDEN");
    const isApi = url.origin === base.origin && url.pathname.startsWith(basePath + "/v1/");
    const endpoint = url.origin + url.pathname;
    if (isApi && !/^\/v1\/(models|images\/(generations|edits)|chat\/completions|videos(?:\/[^/]+)?)$/.test(url.pathname.slice(basePath.length)))
      throw new Error("DEMO_ENDPOINT_FORBIDDEN");
    if (!isApi && headers.has("authorization")) throw new Error("DEMO_DOWNLOAD_AUTH_FORBIDDEN");
    if (isApi && method === "POST") {
      const key = operation;
      if (submissions.has(key)) throw new Error("DEMO_SUBMIT_RETRY_FORBIDDEN");
      submissions.add(key);
    }
    const row: RequestRow = { operation, model: modelOf(body) ?? selectedModel, method,
      endpoint, status: null, ms: 0, bytes: 0,
      authorization: headers.has("authorization") ? "Bearer [REDACTED]" : "absent", state: "pending" };
    rows.push(row); flush();
    return recordedResponse(input, init, row);
  };
  async function recordedResponse(input: RequestInfo | URL, init: RequestInit | undefined, row: RequestRow) {
    const started = Date.now();
    try {
      const response = await original(input, init);
      row.status = response.status; row.ms = Date.now() - started; flush();
      const wrapped = trackBody(response, row, started, flush);
      if (row.endpoint === origin + "/v1/chat/completions") {
        const json: unknown = await wrapped.clone().json();
        saveJson(join(dir, "gemini-response.masked.json"), json, secrets);
      }
      return wrapped;
    } catch (error) { row.state = "failed"; row.ms = Date.now() - started; flush(); throw error; }
  }
  globalThis.fetch = wrapper;
  return { rows, setOperation(label: string, model: string | null = null) {
    operation = label; selectedModel = model;
  }, restore() { if (globalThis.fetch === wrapper) globalThis.fetch = original; flush(); } };
}
