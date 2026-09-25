import type { ComfyLaneModels, LaneCatalog } from "../../src/lib/api-comfy";

export const J6_WORKFLOWS: ComfyLaneModels = {
  image: [{ id: "wf-first", label: "First image", executable: true },
    { id: "wf-selected", label: "Selected image", executable: true }],
  video: [{ id: "wf-video-first", label: "First video", executable: true },
    { id: "wf-video-selected", label: "Selected video", executable: true }],
};
export type J6CatalogState = {
  mode: "ready" | "empty" | "offline" | "error" | "missing" | "malformed" | "loading"
    | "mixed" | "locked" | "key-missing" | "disconnected" | "schema" | "invalid" | "app-auth401" | "app-auth403";
  lanes?: LaneCatalog;
  mcp?: boolean;
};

function modelCatalog(state: J6CatalogState, composer = false): { ok: true; lanes: LaneCatalog } {
  const lane = (image: string[], video: string[] = []) => ({ status: "ready" as const,
    models: { image: image.map((id) => ({ id, label: id })), video: video.map((id) => ({ id, label: id })) } });
  const models = state.mode === "empty" ? { image: [], video: [] } : {
    image: J6_WORKFLOWS.image.map((row) => ({ ...row, executable: state.mode !== "offline" })),
    video: J6_WORKFLOWS.video.map((row) => ({ ...row, executable: state.mode !== "offline" })),
  };
  if (state.lanes) return { ok: true, lanes: state.lanes };
  if (state.mode === "mixed") {
    models.image = [{ id: "wf-online", label: "Online image", executable: true },
      { id: "wf-offline", label: "Offline image", description: "Unavailable (offline)", executable: true }];
  }
  if (state.mode === "locked") models.image = [{ id: "wf-locked", label: "Locked image", executable: false }];
  if (state.mode === "key-missing") return { ok: true, lanes: { oauth: lane(["gpt-6-luna"]), comfy: { status: "key-missing", models } } };
  if (state.mode === "disconnected") return { ok: true, lanes: { oauth: lane(["gpt-6-luna"]), comfy: { status: "disconnected", models } } };
  return { ok: true, lanes: {
    oauth: lane(["gpt-6-luna", "gpt-6-sol", "gpt-6-astra"]),
    api: lane(["gpt-5.6-luna", "gpt-6-astra", "gpt-5.6-sol"]),
    grok: lane(["grok-imagine-image-2.0", "grok-imagine-image-quality"], ["grok-imagine-video-1.5"]),
    "grok-api": lane(["grok-imagine-image-2.0", "grok-imagine-image-quality"], ["grok-imagine-video-1.5"]),
    "gemini-api": lane(["nano-banana-pro", "nano-banana-2"]),
    ...(composer ? { nai: lane(["nai-diffusion-5-full"]), minimax: lane(["image-01"]) } : {}),
    comfy: { status: state.mode === "offline" ? "disconnected" : "ready", models },
  } };
}

export function readFixtures(catalog: J6CatalogState, composer = false): Record<string, unknown> {
  // An already-saved empty session: version0 invokes the existing beforeunload
  // initialization PUT. Selection reloads do not exercise graph creation.
  const session = { id: "wp02-session", title: "Selection fixture", createdAt: 1, updatedAt: 1,
    graphVersion: 1, nodeCount: 0, nodes: [], edges: [] };
  return {
    "/api/auth/lan/session": { mode: "local", authenticated: true, expiresAt: null },
    "/api/models": catalog.mode === "malformed" || catalog.mode === "invalid" ? { ok: true, lanes: { comfy: { status: "ready", models: { image: [{ id: 7, label: "bad" }], video: [] } } } } : catalog.mode === "missing" ? { ok: true, lanes: {} } : catalog.mode === "schema" ? { ok: true, lanes: { comfy: { status: "wrong-status", models: { image: [], video: [] } } } } : modelCatalog(catalog, composer),
    "/api/capabilities": { limits: { maxRefCount: 5 }, defaults: {} },
    "/api/oauth/status": { status: "ready", models: ["gpt-6-luna"] },
    "/api/grok/status": { status: "ready", models: ["grok-imagine-image-2.0"] },
    "/api/agy/status": { installed: false },
    "/api/keys/status": Object.fromEntries(["openai", "xai", "gemini", "vertex", "atlascloud", "minimax", "nai"]
      .map((id) => [id, { configured: true, valid: true, source: "fixture", maskedKey: null }])),
    "/api/providers": { apiKey: true, oauth: true, apiKeyDisabled: false, apiKeySource: "fixture" },
    "/api/billing": { oauth: true, apiKeyValid: true, apiKeySource: "fixture" },
    "/api/mcp/providers": { ok: true, providers: catalog.mcp ? [{ id: "runway", endpoint: "http://synthetic.invalid",
      enabled: true, executable: true, status: { provider: "runway", state: "connected", toolCount: 1 } }] : [] },
    "/api/mcp/providers/runway/models": { ok: true, models: { image: [{ id: "mcp-image", label: "MCP image",
      capabilities: { source: "verified-contract", aspectRatios: [], parameters: [], inputRoles: ["text"] } }], video: [] } },
    "/api/inflight": { jobs: [], terminalJobs: [] },
    "/api/assets": { assets: [], nextCursor: null, total: 0 },
    "/api/sessions": { sessions: [session] },
    "/api/sessions/wp02-session": { session },
    "/api/config/grok-planner": { model: "grok-4.3", options: ["grok-4.3"] },
    "/api/prompt-builder/config": { backend: "auto", model: "gpt-5.6-luna",
      options: { backends: ["auto"], models: { auto: ["gpt-5.6-luna"] }, autoOrder: [] },
      locked: { backend: true, model: true } },
    "/api/comfy/workflows": { ok: true, workflows: [] },
  };
}
