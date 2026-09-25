import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { configureLogger } from "../lib/logger.ts";
import { requestPromptBuilderChat } from "../lib/promptBuilder/client.ts";
import {
  DEFAULT_PROMPT_BUILDER_MODELS,
  PROMPT_BUILDER_BACKENDS,
  PROMPT_BUILDER_MODELS,
  type PromptBuilderBackend,
} from "../lib/promptBuilder/constants.ts";
import {
  lanesForModel,
  normalizePromptBuilderBackend,
  normalizePromptBuilderConfig,
  normalizePromptBuilderModel,
  normalizeRequestModel,
} from "../lib/promptBuilder/requestSchema.ts";
import {
  resolvePromptBuilderTransport,
  selectPromptBuilderBackend,
} from "../lib/promptBuilder/router.ts";
import { buildTransportPayload } from "../lib/promptBuilder/transport.ts";
import { requireRuntimeContext } from "../lib/runtimeContext.ts";
import { seedGrokAuth } from "./_grokAuthFixture.ts";
import type {
  PromptBuilderLaneSummary,
  PromptBuilderMessage,
} from "../lib/promptBuilder/types.ts";
import { registerPromptBuilderRoutes } from "../routes/promptBuilder.ts";

const originalFetch = globalThis.fetch;
const originalBackendEnv = process.env.IMA2_PROMPT_BUILDER_BACKEND;
const originalModelEnv = process.env.IMA2_PROMPT_BUILDER_MODEL;
const textMessages: PromptBuilderMessage[] = [
  { role: "user", content: "Refine this prompt" },
];
const imageMessages: PromptBuilderMessage[] = [{
  role: "user",
  content: "Use this image",
  attachments: [{
    kind: "image",
    name: "reference.png",
    mimeType: "image/png",
    size: 12,
    dataUrl: "data:image/png;base64,AA==",
  }],
}];

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  delete process.env.IMA2_PROMPT_BUILDER_BACKEND;
  delete process.env.IMA2_PROMPT_BUILDER_MODEL;
});

// The grok prompt-builder lane resolves an OAuth bearer from ~/.progrok/auth.json.
const grokAuth = seedGrokAuth();
after(() => { grokAuth.cleanup(); });

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureLogger({ level: "info", sink: console });
  restoreEnv("IMA2_PROMPT_BUILDER_BACKEND", originalBackendEnv);
  restoreEnv("IMA2_PROMPT_BUILDER_MODEL", originalModelEnv);
});

function laneSummary(
  overrides: Partial<PromptBuilderLaneSummary> = {},
): PromptBuilderLaneSummary {
  return {
    oauth: { status: "disconnected", reason: "OAuth unavailable" },
    grok: { status: "disconnected", reason: "Grok unavailable" },
    api: { status: "key-missing", reason: "OpenAI API key missing" },
    "grok-api": { status: "key-missing", reason: "xAI API key missing" },
    ...overrides,
  };
}

function errorContract(error: unknown): { code?: string; status?: number } {
  return error as { code?: string; status?: number };
}

function assertThrowsCode(
  fn: () => unknown,
  code: string,
  status = 400,
): void {
  assert.throws(fn, (error: unknown) => {
    const contract = errorContract(error);
    return contract.code === code && contract.status === status;
  });
}

describe("prompt builder backend selection", () => {
  it("selects ready explicit lanes and never falls back explicit failures", () => {
    assert.deepEqual(
      selectPromptBuilderBackend("grok", laneSummary({ grok: { status: "ready" } })),
      { requestedBackend: "grok", backend: "grok" },
    );
    assertThrowsCode(
      () => selectPromptBuilderBackend("api", laneSummary()),
      "PROMPT_BUILDER_API_KEY_REQUIRED",
      401,
    );
    assertThrowsCode(
      () => selectPromptBuilderBackend("grok-api", laneSummary()),
      "PROMPT_BUILDER_XAI_KEY_REQUIRED",
      401,
    );
    assertThrowsCode(
      () => selectPromptBuilderBackend("oauth", laneSummary()),
      "PROMPT_BUILDER_OAUTH_UNAVAILABLE",
      503,
    );
    assertThrowsCode(
      () => selectPromptBuilderBackend("grok", laneSummary()),
      "PROMPT_BUILDER_GROK_UNAVAILABLE",
      503,
    );
  });

  it("falls back in declared order and reports when no lane is ready", () => {
    assert.deepEqual(
      selectPromptBuilderBackend("auto", laneSummary({ grok: { status: "ready" } })),
      {
        requestedBackend: "auto",
        backend: "grok",
        fallbackFrom: "oauth",
        fallbackReason: "OAuth unavailable",
      },
    );
    assertThrowsCode(
      () => selectPromptBuilderBackend("auto", laneSummary()),
      "PROMPT_BUILDER_NO_BACKEND_READY",
      503,
    );
  });
});

describe("prompt builder model validation", () => {
  it("offers Astra on the GPT lanes while both defaults stay on Luna", () => {
    const defaults = { oauth: "gpt-6-luna", api: "gpt-5.6-luna" } as const;
    for (const backend of ["oauth", "api"] as const) {
      assert.ok(PROMPT_BUILDER_MODELS[backend].includes("gpt-6-astra"));
      assert.equal(normalizePromptBuilderModel(backend, "gpt-6-astra"), "gpt-6-astra");
      assert.equal(DEFAULT_PROMPT_BUILDER_MODELS[backend], defaults[backend]);
    }
    // A saved pre-GPT-6 OAuth pick keeps working on its GPT-6 tier.
    assert.equal(normalizePromptBuilderModel("oauth", "gpt-5.6-luna"), "gpt-6-luna");
    assert.equal(normalizePromptBuilderModel("oauth", "gpt-5.6-sol"), "gpt-6-sol");
  });

  it("accepts every persisted catalog pair and rejects cross-backend pairs", () => {
    for (const backend of PROMPT_BUILDER_BACKENDS) {
      for (const model of PROMPT_BUILDER_MODELS[backend]) {
        assert.equal(normalizePromptBuilderModel(backend, model), model);
      }
    }
    for (const backend of ["oauth", "api"] as const) {
      assertThrowsCode(
        () => normalizePromptBuilderModel(backend, "grok-4.3"),
        "PROMPT_BUILDER_BAD_MODEL",
      );
    }
    for (const backend of ["grok", "grok-api"] as const) {
      assertThrowsCode(
        () => normalizePromptBuilderModel(backend, "gpt-5.6-luna"),
        "PROMPT_BUILDER_BAD_MODEL",
      );
    }
    assertThrowsCode(
      () => normalizePromptBuilderModel("auto", "gpt-5.5"),
      "PROMPT_BUILDER_BAD_MODEL",
    );
  });

  it("resets a changed persisted backend to its default model", () => {
    assert.deepEqual(
      normalizePromptBuilderConfig(
        { backend: "grok" },
        { backend: "oauth", model: "gpt-5.6-luna" },
      ),
      { backend: "grok", model: "grok-4.3" },
    );
  });

  it("permits request-only auto slugs and narrows them to compatible lanes", () => {
    assert.equal(normalizeRequestModel("auto", "gpt-5.5"), "gpt-5.5");
    assert.deepEqual(lanesForModel("gpt-5.5"), ["oauth", "api"]);
    assert.equal(normalizeRequestModel("auto", "grok-4.3"), "grok-4.3");
    assert.deepEqual(lanesForModel("grok-4.3"), ["grok", "grok-api"]);
    assertThrowsCode(
      () => normalizeRequestModel("auto", "unknown-model"),
      "PROMPT_BUILDER_BAD_MODEL",
    );
  });

  it("treats blank request overrides as omitted and rejects unknown backends", () => {
    assert.equal(normalizePromptBuilderBackend("", "grok"), "grok");
    assert.equal(normalizePromptBuilderBackend("  ", "grok"), "grok");
    assertThrowsCode(
      () => normalizePromptBuilderBackend("bogus", "grok"),
      "PROMPT_BUILDER_BAD_BACKEND",
    );
  });
});

describe("prompt builder transport payloads", () => {
  it("routes OAuth, API, and Grok payloads to their supported endpoint shapes", () => {
    assert.equal(buildTransportPayload("oauth", "gpt-5.6-luna", textMessages, undefined).endpoint, "chat");
    assert.equal(buildTransportPayload("oauth", "gpt-5.6-luna", imageMessages, undefined).endpoint, "responses");
    assert.equal(buildTransportPayload("api", "gpt-5.6-luna", textMessages, undefined).endpoint, "responses");
    assert.equal(buildTransportPayload("api", "gpt-5.6-luna", imageMessages, undefined).endpoint, "responses");
    for (const backend of ["grok", "grok-api"] as const) {
      for (const messages of [textMessages, imageMessages]) {
        const payload = buildTransportPayload(backend, "grok-4.3", messages, undefined);
        assert.equal(payload.endpoint, "chat");
        assert.equal("reasoning_effort" in payload.body, false);
      }
    }
  });

  it("resolves direct API targets without crossing into OAuth or progrok", async () => {
    const api = requireRuntimeContext({
      ...clientContext("api"),
      apiKey: "sk-test",
      hasApiKey: true,
    });
    const apiTarget = await resolvePromptBuilderTransport(api, "api", "responses");
    assert.equal(apiTarget.url, "https://api.openai.com/v1/responses");
    assert.equal(apiTarget.useOAuthFetch, false);
    assert.equal(apiTarget.headers.Authorization, "Bearer sk-test");

    const grokApi = requireRuntimeContext({
      ...clientContext("grok-api"),
      xaiApiKey: "xai-test",
      hasXaiApiKey: true,
    });
    const grokTarget = await resolvePromptBuilderTransport(grokApi, "grok-api", "chat");
    assert.equal(grokTarget.url, "https://api.x.ai/v1/chat/completions");
    assert.equal(grokTarget.useOAuthFetch, false);
    assert.equal(grokTarget.headers.Authorization, "Bearer xai-test");
  });
});

type CapturedCall = { url: string; body: Record<string, unknown> };

function stubChatTransport(calls: CapturedCall[]): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Response.json({
      choices: [{ message: { role: "assistant", content: "Refined prompt" } }],
      usage: { total_tokens: 4 },
    });
  }) as typeof fetch;
}

function clientContext(
  backend: PromptBuilderBackend,
  model = DEFAULT_PROMPT_BUILDER_MODELS[backend],
) {
  return {
    config: {
      ...config,
      promptBuilder: { backend, model },
      oauth: { ...config.oauth, generationTimeoutMs: 1_000 },
    },
    grokAuthHomeDir: grokAuth.homeDir,
    oauthReadyState: "ready" as const,
    oauthReadyPromise: Promise.resolve(),
  };
}

describe("prompt builder client routing", () => {
  it("uses the override backend default without leaking a persisted model", async () => {
    const calls: CapturedCall[] = [];
    stubChatTransport(calls);
    const result = await requestPromptBuilderChat(
      clientContext("oauth"),
      { backend: "grok", messages: textMessages },
      laneSummary({ grok: { status: "ready" } }),
    );
    assert.equal(result.model, "grok-4.3");
    assert.equal(result.provider, "grok");
    assert.equal(result.backend, "grok");
    assert.equal(result.requestedBackend, "grok");
    assert.equal(calls[0]?.body.model, "grok-4.3");
    assert.match(calls[0]?.url ?? "", /\/v1\/chat\/completions$/);
  });

  it("keeps persisted backend for blank overrides and rejects cross-lane models", async () => {
    const calls: CapturedCall[] = [];
    stubChatTransport(calls);
    for (const backend of ["", "  "]) {
      const result = await requestPromptBuilderChat(
        clientContext("grok"),
        { backend, messages: textMessages },
        laneSummary({ grok: { status: "ready" } }),
      );
      assert.equal(result.backend, "grok");
    }
    await assert.rejects(
      requestPromptBuilderChat(
        clientContext("oauth"),
        { backend: "grok", model: "gpt-5.5", messages: textMessages },
        laneSummary({ grok: { status: "ready" } }),
      ),
      (error: unknown) => errorContract(error).code === "PROMPT_BUILDER_BAD_MODEL",
    );
  });

  it("logs one observable auto fallback and returns the resolved backend", async () => {
    const calls: CapturedCall[] = [];
    const logs: string[] = [];
    stubChatTransport(calls);
    configureLogger({ level: "info", sink: { info: (line) => logs.push(line) } });
    const result = await requestPromptBuilderChat(
      clientContext("auto"),
      { messages: textMessages },
      laneSummary({ grok: { status: "ready" } }),
    );
    assert.equal(result.requestedBackend, "auto");
    assert.equal(result.backend, "grok");
    assert.equal(logs.length, 1);
    assert.match(logs[0] ?? "", /prompt-builder\.backend_fallback/);
    assert.match(logs[0] ?? "", /from="oauth".*to="grok"/);
  });
});

type RouteHarness = {
  baseUrl: string;
  configFile: string;
  ctx: { config: typeof config };
};

async function withPromptBuilderRoutes(
  fn: (harness: RouteHarness) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ima2-prompt-builder-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({
    unrelated: "preserved",
    promptBuilder: { backend: "oauth", model: "gpt-5.6-luna" },
  }));
  const ctx = {
    config: {
      ...config,
      storage: { ...config.storage, configFile },
      promptBuilder: { backend: "oauth" as const, model: "gpt-5.6-luna" },
    },
  };
  const app = express();
  app.use(express.json());
  registerPromptBuilderRoutes(app, ctx);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address() as import("node:net").AddressInfo;
  try {
    await fn({ baseUrl: `http://127.0.0.1:${address.port}`, configFile, ctx });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function putConfig(
  baseUrl: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return originalFetch(`${baseUrl}/api/prompt-builder/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("prompt builder config routes", () => {
  it("GET exposes the pair, catalog, and environment locks", async () => {
    await withPromptBuilderRoutes(async ({ baseUrl }) => {
      const res = await originalFetch(`${baseUrl}/api/prompt-builder/config`);
      const body = await res.json() as Record<string, any>;
      assert.equal(body.backend, "oauth");
      assert.equal(body.model, "gpt-5.6-luna");
      assert.deepEqual(body.options.backends, [...PROMPT_BUILDER_BACKENDS]);
      assert.deepEqual(body.options.models.grok, ["grok-4.3", "grok-4.6", "grok-4.5"]);
      assert.deepEqual(body.locked, { backend: false, model: false });
    });
  });

  it("PUT persists and hot-applies a valid pair while preserving unrelated config", async () => {
    await withPromptBuilderRoutes(async ({ baseUrl, configFile, ctx }) => {
      const res = await putConfig(baseUrl, { backend: "grok" });
      const body = await res.json() as { backend: string; model: string };
      const saved = JSON.parse(await readFile(configFile, "utf8")) as Record<string, any>;
      assert.equal(res.status, 200);
      assert.deepEqual({ backend: body.backend, model: body.model }, {
        backend: "grok",
        model: "grok-4.3",
      });
      assert.deepEqual(saved.promptBuilder, { backend: "grok", model: "grok-4.3" });
      assert.equal(saved.unrelated, "preserved");
      assert.deepEqual(ctx.config.promptBuilder, { backend: "grok", model: "grok-4.3" });
    });
  });

  it("rejects invalid and environment-locked pairs without changing persisted state", async () => {
    await withPromptBuilderRoutes(async ({ baseUrl, configFile, ctx }) => {
      const before = await readFile(configFile, "utf8");
      const bad = await putConfig(baseUrl, { backend: "grok", model: "gpt-5.6-luna" });
      assert.equal(bad.status, 400);
      assert.equal((await bad.json() as Record<string, any>).error.code, "PROMPT_BUILDER_BAD_MODEL");
      process.env.IMA2_PROMPT_BUILDER_BACKEND = "oauth";
      const locked = await putConfig(baseUrl, { backend: "grok" });
      assert.equal(locked.status, 409);
      assert.equal((await locked.json() as Record<string, any>).error.code, "PROMPT_BUILDER_CONFIG_ENV_LOCKED");
      assert.equal(await readFile(configFile, "utf8"), before);
      assert.deepEqual(ctx.config.promptBuilder, { backend: "oauth", model: "gpt-5.6-luna" });
    });
  });

  it("maps malformed persisted config to the typed unreadable-file 500", async () => {
    await withPromptBuilderRoutes(async ({ baseUrl, configFile }) => {
      await writeFile(configFile, "{");
      const res = await putConfig(baseUrl, { backend: "grok" });
      const body = await res.json() as Record<string, any>;
      assert.equal(res.status, 500);
      assert.equal(body.error.code, "PROMPT_BUILDER_CONFIG_UNREADABLE");
      assert.equal(await readFile(configFile, "utf8"), "{");
    });
  });
});
