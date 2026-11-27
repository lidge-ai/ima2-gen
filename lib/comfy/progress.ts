// lib/comfy/progress.ts — live progress for one ComfyUI job over its WebSocket.
//
// ComfyUI reports node and step progress only on /ws; /history says nothing
// until a job ends. The socket is an addition to polling, never a replacement:
// if it cannot open or drops, the job carries on and only the percentage is lost.
import { WebSocket } from "undici";
import type { ComfyTarget } from "./access.js";

export interface ComfyProgress {
  /** 0..1 across the whole graph, when ComfyUI reported per-node state. */
  fraction?: number;
  /** The node working now. */
  node?: string;
  nodeType?: string;
  /** Steps inside that node, e.g. sampler step 7 of 20. */
  step?: { value: number; max: number };
}

export interface ComfySocket {
  close(): void;
}

export interface ComfySocketHandlers {
  onOpen(): void;
  onText(data: string): void;
  onClose(): void;
}

/** Opens the socket. Injected by tests; the default speaks to a real server. */
export type OpenComfySocket = (url: string, headers: Readonly<Record<string, string>>, handlers: ComfySocketHandlers) => ComfySocket;

export const openComfySocket: OpenComfySocket = (url, headers, handlers) => {
  const socket = new WebSocket(url, { headers: { ...headers } });
  socket.addEventListener("open", () => handlers.onOpen());
  // Binary frames are previews; only the JSON status messages matter here.
  socket.addEventListener("message", (event) => { if (typeof event.data === "string") handlers.onText(event.data); });
  socket.addEventListener("close", () => handlers.onClose());
  socket.addEventListener("error", () => handlers.onClose());
  return { close: () => { try { socket.close(); } catch { /* already closed */ } } };
};

export function comfySocketUrl(origin: string, clientId: string): string {
  return origin.replace(/^http/, "ws") + "/ws?clientId=" + encodeURIComponent(clientId);
}

interface NodeState { value?: unknown; max?: unknown; state?: unknown }

type GraphShape = Readonly<Record<string, { class_type: string }>>;

/** Folds ComfyUI's messages for one prompt into a single progress picture. */
export class ComfyProgressTracker {
  private readonly cached = new Set<string>();
  private nodes: Record<string, NodeState> = {};
  private current: string | undefined;
  private step: { value: number; max: number } | undefined;

  constructor(private readonly graph: GraphShape, private promptId: string | null) {}

  setPromptId(id: string): void {
    this.promptId = id;
  }

  private fraction(): number | undefined {
    const total = Object.keys(this.graph).length;
    if (total === 0 || (Object.keys(this.nodes).length === 0 && this.cached.size === 0)) return undefined;
    let done = 0;
    for (const id of Object.keys(this.graph)) {
      const state = this.nodes[id];
      if (state?.state === "finished" || (!state && this.cached.has(id))) { done += 1; continue; }
      const value = Number(state?.value), max = Number(state?.max);
      if (state?.state === "running" && max > 0 && Number.isFinite(value)) done += Math.min(1, Math.max(0, value / max));
    }
    // Completion is decided by history, never by arithmetic on messages.
    return Math.min(0.99, done / total);
  }

  private snapshot(): ComfyProgress {
    const out: ComfyProgress = {};
    const fraction = this.fraction();
    if (fraction !== undefined) out.fraction = fraction;
    if (this.current !== undefined) {
      out.node = this.current;
      const nodeType = this.graph[this.current]?.class_type;
      if (nodeType) out.nodeType = nodeType;
    }
    if (this.step) out.step = this.step;
    return out;
  }

  /** Returns the new picture when a message for this prompt changed it, else null. */
  accept(raw: string): ComfyProgress | null {
    let message: { type?: unknown; data?: Record<string, unknown> };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return null;
    }
    const data = message.data;
    if (!data || typeof data !== "object") return null;
    // Without a client id ComfyUI broadcasts other people's progress too.
    if (!this.promptId || data.prompt_id !== this.promptId) return null;
    switch (message.type) {
      case "execution_cached":
        for (const id of Array.isArray(data.nodes) ? data.nodes : []) this.cached.add(String(id));
        return this.snapshot();
      case "executing":
        if (data.node === null || data.node === undefined) return null;
        this.current = String(data.node);
        this.step = undefined;
        return this.snapshot();
      case "progress": {
        const value = Number(data.value), max = Number(data.max);
        if (!(max > 0) || !Number.isFinite(value)) return null;
        if (data.node !== null && data.node !== undefined) this.current = String(data.node);
        this.step = { value, max };
        return this.snapshot();
      }
      case "progress_state":
        if (!data.nodes || typeof data.nodes !== "object") return null;
        this.nodes = data.nodes as Record<string, NodeState>;
        return this.snapshot();
      default:
        return null;
    }
  }
}

export interface ComfyProgressWatch {
  /** Resolves once the socket is open, or after waitMs, whichever is first. */
  ready: Promise<void>;
  setPromptId(id: string): void;
  close(): void;
}

/**
 * Watches one job. onProgress fires only when the picture changes by a whole
 * percent, a node or a step, so a sampler emitting 50 updates a second does not
 * become 50 server-sent events.
 */
export function watchComfyProgress(
  target: ComfyTarget,
  clientId: string,
  graph: GraphShape,
  promptId: string | null,
  onProgress: (progress: ComfyProgress) => void,
  open: OpenComfySocket = openComfySocket,
  waitMs = 1_500,
): ComfyProgressWatch {
  const tracker = new ComfyProgressTracker(graph, promptId);
  let lastKey = "";
  let settle: () => void = () => {};
  const ready = new Promise<void>((resolve) => { settle = resolve; });
  const timer = setTimeout(settle, waitMs);
  const done = () => { clearTimeout(timer); settle(); };
  let socket: ComfySocket | null = null;
  try {
    socket = open(comfySocketUrl(target.origin, clientId), target.headers, {
      onOpen: done,
      onClose: done,
      onText: (data) => {
        const progress = tracker.accept(data);
        if (!progress) return;
        const percent = progress.fraction === undefined ? "" : String(Math.floor(progress.fraction * 100));
        const key = [percent, progress.node ?? "", progress.step?.value ?? "", progress.step?.max ?? ""].join("|");
        if (key === lastKey) return;
        lastKey = key;
        onProgress(progress);
      },
    });
  } catch {
    done();
  }
  return {
    ready,
    setPromptId: (id) => tracker.setPromptId(id),
    close: () => { done(); socket?.close(); },
  };
}
