// A ComfyUI stand-in that speaks real HTTP and WebSocket on a loopback port, so
// tests exercise ima2's own transport instead of a stubbed fetch. It implements
// only what ima2 calls, with the response shapes of ComfyUI 0.46.0
// (devlog/_plan/261126_sume_parity_byok_aggregators/lanes/L13-research/A_server_api.md).
import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface FakeComfyOptions {
  /** When set, every HTTP request and the WebSocket upgrade must carry this bearer token. */
  token?: string;
  /** false imitates a server older than 0.26.0: no /api/jobs/{id}/cancel. */
  jobsApi?: boolean;
  /** Keep jobs running until they are canceled. */
  hold?: boolean;
  /** Answer POST /prompt with this status and body instead of queueing. */
  reject?: { status: number; body: unknown };
  /** Answer GET /history/* with a redirect to this URL. */
  redirectHistoryTo?: string;
  /** WebSocket messages sent for each job, in order, before it finishes. */
  events?: (promptId: string) => Array<{ type: string; data: Record<string, unknown> }>;
  /** Node schemas served at GET /object_info/{class}; a class not listed answers {} like a real server. */
  objectInfo?: Record<string, unknown>;
}

export interface FakeComfyRequest { method: string; path: string; authorization: string | undefined; body: unknown }

export interface FakeComfy {
  origin: string;
  requests: FakeComfyRequest[];
  sockets: Array<{ clientId: string | null; authorization: string | undefined }>;
  prompts: Array<{ promptId: string; clientId: unknown; body: Record<string, unknown> }>;
  canceledBy: string[];
  close(): Promise<void>;
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Ports fetch refuses to call ("bad port"). A Windows host can hand one out for port 0. */
const FETCH_BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function startFakeComfy(options: FakeComfyOptions = {}): Promise<FakeComfy> {
  const jobsApi = options.jobsApi !== false;
  const history = new Map<string, unknown>();
  const running = new Set<string>();
  const clients = new Map<string, Duplex>();
  const open = new Set<Duplex>();
  const fake: FakeComfy = { origin: "", requests: [], sockets: [], prompts: [], canceledBy: [], close: async () => {} };

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? "" : JSON.stringify(body));
    // One request per connection: a later fixture can be handed the port of one that just closed (seen on
    // Windows), and a client that kept a socket to the old one would fail its first request to the new one.
    res.writeHead(status, { "Content-Type": Buffer.isBuffer(body) ? "image/png" : "application/json", Connection: "close", ...headers });
    res.end(payload);
  };
  const authorized = (req: IncomingMessage) => !options.token || req.headers.authorization === "Bearer " + options.token;
  const finish = (promptId: string, ok: boolean) => {
    running.delete(promptId);
    history.set(promptId, ok
      ? { status: { status_str: "success", completed: true, messages: [] },
          outputs: { "9": { images: [{ filename: "ima2_00001_.png", subfolder: "", type: "output" }] } } }
      : { status: { status_str: "error", completed: false, messages: [["execution_interrupted", { prompt_id: promptId }]] }, outputs: {} });
  };
  const cancel = (promptId: string, via: string): boolean => {
    fake.canceledBy.push(via);
    if (!running.has(promptId)) return false;
    finish(promptId, false);
    return true;
  };
  const play = async (promptId: string, clientId: unknown) => {
    const socket = typeof clientId === "string" ? clients.get(clientId) : undefined;
    for (const event of options.events?.(promptId) ?? []) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (socket && !socket.destroyed) socket.write(textFrame(JSON.stringify(event)));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (!options.hold && running.has(promptId)) finish(promptId, true);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const body = req.method === "POST" && !String(req.headers["content-type"] ?? "").startsWith("multipart/")
      ? await readBody(req) : undefined;
    if (req.method === "POST" && body === undefined) req.resume();
    fake.requests.push({ method: req.method ?? "", path: url.pathname, authorization: req.headers.authorization, body });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
    const path = url.pathname;
    if (path === "/system_stats") return send(res, 200, { system: { comfyui_version: "0.46.0" }, devices: [] });
    if (path.startsWith("/object_info/")) {
      const classType = decodeURIComponent(path.slice("/object_info/".length));
      const node = options.objectInfo?.[classType];
      return send(res, 200, node ? { [classType]: node } : {});
    }
    if (path === "/prompt" && req.method === "POST") {
      if (options.reject) return send(res, options.reject.status, options.reject.body);
      const payload = body as Record<string, unknown>;
      const promptId = typeof payload.prompt_id === "string" ? payload.prompt_id : randomUUID();
      running.add(promptId);
      fake.prompts.push({ promptId, clientId: payload.client_id, body: payload });
      void play(promptId, payload.client_id);
      return send(res, 200, { prompt_id: promptId, number: 1, node_errors: {} });
    }
    if (path.startsWith("/history/")) {
      if (options.redirectHistoryTo) return send(res, 302, undefined, { Location: options.redirectHistoryTo });
      const id = decodeURIComponent(path.slice("/history/".length));
      return send(res, 200, history.has(id) ? { [id]: history.get(id) } : {});
    }
    if (path === "/queue" && req.method === "GET") {
      return send(res, 200, { queue_running: [...running].map((id) => [0, id, {}, {}, []]), queue_pending: [] });
    }
    const jobCancel = /^\/api\/jobs\/([^/]+)\/cancel$/.exec(path);
    if (jobCancel && req.method === "POST") {
      if (!jobsApi) return send(res, 404, { error: "not found" });
      return send(res, 200, { cancelled: cancel(decodeURIComponent(jobCancel[1]!), "jobs") });
    }
    if (path === "/queue" && req.method === "POST") { fake.canceledBy.push("queue"); return send(res, 200, undefined); }
    if (path === "/interrupt" && req.method === "POST") {
      const id = (body as { prompt_id?: unknown } | undefined)?.prompt_id;
      if (typeof id === "string") cancel(id, "interrupt");
      return send(res, 200, undefined);
    }
    if (path === "/view") return send(res, 200, FAKE_PNG);
    if (path === "/upload/image") return send(res, 200, { name: "ima2_ref.png", subfolder: "", type: "input" });
    return send(res, 404, { error: "not found" });
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const clientId = url.searchParams.get("clientId");
    fake.sockets.push({ clientId, authorization: req.headers.authorization });
    if (url.pathname !== "/ws" || !authorized(req)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(String(req.headers["sec-websocket-key"]) + WS_GUID).digest("base64");
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    open.add(socket);
    if (clientId) clients.set(clientId, socket);
    socket.on("error", () => {});
    socket.on("close", () => open.delete(socket));
    socket.write(textFrame(JSON.stringify({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } }, sid: clientId } })));
  });

  for (;;) {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    if (!FETCH_BLOCKED_PORTS.has((server.address() as AddressInfo).port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  fake.origin = "http://127.0.0.1:" + String((server.address() as AddressInfo).port);
  fake.close = async () => {
    for (const socket of open) socket.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return fake;
}
