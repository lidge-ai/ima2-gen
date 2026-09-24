import type { Express, Request, Response } from "express";
import { abortJob, listJobs, listTerminalJobs } from "../lib/inflight.js";

import { errInfo } from "../lib/errInfo.js";
import { loadGrokCredentials } from "../lib/xaiAuth.js";
import { gptAuthStatus, grokAuthStatus } from "../lib/authStatus.js";
import { resolveChatgptSession } from "../lib/chatgptAuth.js";
import { requireRuntimeContext, type RouteRuntimeContext } from "../lib/runtimeContext.js";

// Upstream auth refusals surfaced through the proxy's /v1/models error body. Kept narrow:
// generic 5xx/network text must never read as "re-login needed" — status 401 covers
// non-standard auth rejections regardless of wording.
const AUTH_FAILURE_BODY_RE = /invalidated oauth|invalid_token|invalid_grant|access token not found|account id not found|not logged in/i;

export function registerHealthRoutes(app: Express, ctxRaw: RouteRuntimeContext) {
  const ctx = requireRuntimeContext(ctxRaw);
  const runtimePorts = () => ({
    backend: {
      configuredPort: Number(ctx.serverConfiguredPort || ctx.config.server.port),
      actualPort: Number(ctx.serverActualPort || ctx.config.server.port),
      url: ctx.serverUrl || `http://localhost:${ctx.serverActualPort || ctx.config.server.port}`,
    },
    oauth: {
      configuredPort: Number(ctx.oauthPort),
      actualPort: Number(ctx.oauthActualPort || ctx.oauthPort),
      url: ctx.oauthUrl,
      status: ctx.oauthReadyState,
    },
    // Grok has no local endpoint any more: requests go to https://api.x.ai, so
    // the only runtime fact worth publishing is whether a session exists.
    grok: { auth: loadGrokCredentials(ctx.grokAuthHomeDir) ? "oauth" : "none" },
  });

  app.get("/api/providers", (_req: Request, res: Response) => {
    res.json({
      apiKey: Boolean(ctx.hasApiKey),
      oauth: true,
      oauthPort: ctx.oauthPort,
      oauthActualPort: ctx.oauthActualPort || ctx.oauthPort,
      oauthUrl: ctx.oauthUrl,
      apiKeyDisabled: false,
      apiKeySource: ctx.apiKeySource ?? "none",
      runtime: runtimePorts(),
    });
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      ok: true,
      version: ctx.packageVersion,
      provider: "oauth",
      uptimeSec: Math.round(process.uptime()),
      activeJobs: listJobs().length,
      pid: process.pid,
      startedAt: ctx.startedAt,
      runtime: runtimePorts(),
    });
  });

  // `auth` is the session verdict (lib/authStatus.ts): account, health, and the action that
  // fixes it. `status` stays the proxy's live verdict the UI already switches on.
  app.get("/api/oauth/status", async (_req: Request, res: Response) => {
    ctx.syncOAuthProxySession?.();
    const session = resolveChatgptSession();
    const reply = (status: "ready" | "auth_required" | "offline" | "starting", extra: Record<string, unknown> = {}) => res.json({
      status,
      ...extra,
      auth: gptAuthStatus(session, { proxyStatus: status }),
      grokAuth: grokAuthStatus(loadGrokCredentials(ctx.grokAuthHomeDir)),
      runtime: runtimePorts(),
    });
    // With IMA2_NO_OAUTH_PROXY an external proxy owns its own session; local files say nothing.
    const missingSession = ctx.config.oauth.autoStart && !session;
    if (ctx.oauthReadyState === "starting") return reply("starting");
    // The proxy exits at boot when there is no session file; that is a login problem, not an outage.
    if (ctx.oauthReadyState === "failed") return reply(missingSession ? "auth_required" : "offline");
    try {
      const r = await fetch(`${ctx.oauthUrl}/v1/models`, {
        signal: AbortSignal.timeout(ctx.config.oauth.statusTimeoutMs),
      });
      if (r.ok) {
        const data = (await r.json()) as { data?: Array<{ id: string }> };
        reply("ready", { models: data.data?.map((m) => m.id) || [] });
      } else {
        // A non-OK /v1/models means the proxy's authed upstream call failed — not always
        // a dead session. 401 is always a refused session; for any other status only an
        // auth-shaped error body is. Everything else (5xx, network) is an outage, so a
        // usable session file stays logged in instead of flipping to "log in required".
        const body = (await r.text().catch(() => "")).slice(0, 4000);
        reply(r.status === 401 || missingSession || AUTH_FAILURE_BODY_RE.test(body) ? "auth_required" : "offline");
      }
    } catch {
      reply(missingSession ? "auth_required" : "offline");
    }
  });

  app.get("/api/inflight", (req: Request, res: Response) => {
    const kind =
      typeof req.query.kind === "string" && req.query.kind.length > 0
        ? req.query.kind
        : undefined;
    const sessionId =
      typeof req.query.sessionId === "string" && req.query.sessionId.length > 0
        ? req.query.sessionId
        : undefined;
    const includeTerminal =
      req.query.includeTerminal === "1" || req.query.includeTerminal === "true";
    const jobs = listJobs({ kind, sessionId });
    if (!includeTerminal) return res.json({ jobs });
    return res.json({
      jobs,
      terminalJobs: listTerminalJobs({ kind, sessionId }),
    });
  });

  app.delete("/api/inflight/:requestId", (req: Request<{ requestId: string }>, res: Response) => {
    res.json(abortJob(req.params.requestId));
  });

  app.get("/api/billing", async (_req: Request, res: Response) => {
    if (!ctx.hasApiKey) {
      return res.json({ oauth: true, apiKeyValid: false, apiKeySource: "none" });
    }

    try {
      const headers = { Authorization: `Bearer ${ctx.apiKey}`, "Content-Type": "application/json" };
      const start = Math.floor(new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000);
      const end = Math.floor(Date.now() / 1000);
      const billingSignal = AbortSignal.timeout(10_000);
      const [subRes, usageRes, modelsRes] = await Promise.allSettled([
        fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${end}&bucket_width=1d&limit=31`, { headers, signal: billingSignal }),
        fetch("https://api.openai.com/dashboard/billing/credit_grants", { headers, signal: billingSignal }),
        fetch("https://api.openai.com/v1/models", { headers, signal: billingSignal }),
      ]);

      const billing: Record<string, unknown> = { apiKeySource: ctx.apiKeySource ?? "env" };
      if (subRes.status === "fulfilled" && subRes.value.ok) billing.costs = await subRes.value.json();
      if (usageRes.status === "fulfilled" && usageRes.value.ok) billing.credits = await usageRes.value.json();
      billing.apiKeyValid = modelsRes.status === "fulfilled" && modelsRes.value.ok === true;
      res.json(billing);
    } catch (e) {
      const err = errInfo(e);
      res.status(500).json({ error: err.message, apiKeyValid: false });
    }
  });
}
