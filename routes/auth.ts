import type { Express } from "express";
import type { RouteRuntimeContext } from "../lib/runtimeContext.js";
import { randomBytes } from "node:crypto";
import { runChatgptLogin, type ChatgptLoginFlow, type ChatgptLoginPrompt } from "../lib/chatgptLogin.js";
import { runXaiDeviceLogin } from "../lib/xaiDeviceLogin.js";

/**
 * Web/CLI shared login sessions. Both providers run the same native flows as the CLI
 * (lib/chatgptLogin.ts, lib/xaiDeviceLogin.ts); this module only keeps the per-session
 * status the UI polls and the AbortController that cancels an abandoned flow.
 */
interface AuthSession {
  provider: "grok" | "codex";
  flow: ChatgptLoginFlow | "device";
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  status: "pending" | "complete" | "error" | "expired";
  error?: string;
  email?: string;
  abort: AbortController;
}

interface StartResult {
  sessionId: string;
  flow: ChatgptLoginFlow | "device";
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
}

const MAX_CONCURRENT_SESSIONS = 20;
const PROMPT_TIMEOUT_MS = 30_000;
const sessions = new Map<string, AuthSession>();

function sid(): string {
  return randomBytes(16).toString("hex");
}

function finish(id: string, status: AuthSession["status"], error?: string) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.status === "pending") {
    s.status = status;
    if (error) s.error = error;
  }
  s.abort.abort();
  setTimeout(() => sessions.delete(id), 120_000).unref?.();
}

/** Only one ChatGPT browser login can own localhost:1455; a new start retires the old ones. */
function cancelPending(provider: AuthSession["provider"]) {
  for (const [id, s] of sessions) {
    if (s.provider === provider && s.status === "pending") finish(id, "error", "superseded by a newer login");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a flow and resolves as soon as the user has something to open. The flow keeps
 * running in the background and records its outcome on the session.
 */
function startSession(
  provider: AuthSession["provider"],
  run: (signal: AbortSignal, onPrompt: (prompt: { flow: AuthSession["flow"]; url: string; userCode?: string; expiresIn: number }) => void) => Promise<{ email?: string }>,
  onComplete?: () => void,
): Promise<StartResult> {
  const id = sid();
  const abort = new AbortController();
  return new Promise<StartResult>((resolve, reject) => {
    let prompted = false;
    const promptTimer = setTimeout(() => {
      if (prompted) return;
      abort.abort();
      reject(new Error("Timed out starting the login"));
    }, PROMPT_TIMEOUT_MS);
    run(abort.signal, (prompt) => {
      prompted = true;
      clearTimeout(promptTimer);
      const session: AuthSession = {
        provider,
        flow: prompt.flow,
        userCode: prompt.userCode ?? "",
        verificationUrl: prompt.url,
        expiresAt: Date.now() + prompt.expiresIn * 1000,
        status: "pending",
        abort,
      };
      sessions.set(id, session);
      // Server-side reaper: an abandoned flow must not hold its poll loop or port forever.
      setTimeout(() => finish(id, "expired"), prompt.expiresIn * 1000 + 5_000).unref?.();
      resolve({ sessionId: id, flow: prompt.flow, userCode: session.userCode, verificationUrl: prompt.url, expiresIn: prompt.expiresIn });
    }).then((result) => {
      const session = sessions.get(id);
      if (session && result.email) session.email = result.email;
      if (session?.status === "pending") onComplete?.();
      finish(id, "complete");
    }, (error: unknown) => {
      clearTimeout(promptTimer);
      if (!prompted) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      finish(id, abort.signal.aborted ? "expired" : "error", errorMessage(error));
    });
  });
}

function startCodexLogin(flow: ChatgptLoginFlow, ctx?: RouteRuntimeContext): Promise<StartResult> {
  cancelPending("codex");
  return startSession(
    "codex",
    async (signal, onPrompt) => {
      const session = await runChatgptLogin({
        flow,
        signal,
        onPrompt: (prompt: ChatgptLoginPrompt) => onPrompt(prompt),
      });
      return session.email ? { email: session.email } : {};
    },
    () => { ctx?.restartOAuthProxy?.(); },
  );
}

function startGrokLogin(ctx?: RouteRuntimeContext): Promise<StartResult> {
  return startSession("grok", async (signal, onPrompt) => {
    const creds = await runXaiDeviceLogin({
      signal,
      ...(ctx?.grokAuthHomeDir ? { homeDir: ctx.grokAuthHomeDir } : {}),
      onUserCode: (info) => onPrompt({ flow: "device", url: info.verificationUrl, userCode: info.userCode, expiresIn: info.expiresIn }),
    });
    return creds.email ? { email: creds.email } : {};
  });
}

export function registerAuthRoutes(app: Express, ctx?: RouteRuntimeContext) {
  app.post("/api/auth/switch", async (req, res) => {
    const provider = req.body?.provider;
    if (provider !== "grok" && provider !== "codex") {
      return res.status(400).json({ error: "provider must be grok or codex" });
    }
    const flow = req.body?.flow === "device" ? "device" : "browser";
    if (sessions.size >= MAX_CONCURRENT_SESSIONS) {
      return res.status(429).json({ error: "Too many pending auth sessions" });
    }
    try {
      res.json(provider === "grok" ? await startGrokLogin(ctx) : await startCodexLogin(flow, ctx));
    } catch (e) {
      res.status(502).json({ error: errorMessage(e) });
    }
  });

  app.get("/api/auth/switch/:sessionId", (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ status: "expired" });
    if (session.status === "complete") return res.json({ status: "complete", ...(session.email ? { email: session.email } : {}) });
    if (session.status === "error") return res.json({ status: "error", error: session.error });
    if (session.status === "expired" || Date.now() > session.expiresAt) {
      finish(req.params.sessionId, "expired");
      return res.json({ status: "expired" });
    }
    res.json({ status: "pending", flow: session.flow });
  });

  app.delete("/api/auth/switch/:sessionId", (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ status: "expired" });
    finish(req.params.sessionId, "expired", "cancelled");
    res.json({ status: "expired" });
  });

  /** CLI logins write the session file directly; this lets them tell a running server. */
  app.post("/api/oauth/restart", (_req, res) => {
    const result = ctx?.restartOAuthProxy?.() ?? { restarted: false, reason: "oauth proxy is not managed by this server" };
    res.json(result);
  });
}
