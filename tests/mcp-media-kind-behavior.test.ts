// Behavior tests for the 010 MCP media-kind lane (devlog/_fin/260716_mcp-model-surface-ui).
// Runs the actual production code paths that are importable under Node:
// - normalizeMcpSelection (used verbatim by storePersistence.loadMcpSelection)
// - getMcpModelCatalog (fetch-only; the EventSource-backed generation
//   orchestration is intentionally NOT executed here — see audit R3-2).
// Store-impl wiring (provider-switch kind preservation etc.) is covered by
// source contracts in tests/mcp-provider-ui-contract.test.ts because
// ui/src/store modules require Vite's import.meta.env at import time.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { normalizeMcpSelection } from "../ui/src/lib/mcpSelection.js";
import { getMcpModelCatalog } from "../ui/src/lib/mcpProviders.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type FakeRoute = { status: number; body: unknown };

function installFakeFetch(routes: Record<string, FakeRoute>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (init?.signal?.aborted) {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }
    const route = Object.entries(routes).find(([key]) => url.includes(key))?.[1]
      ?? { status: 404, body: { error: { code: "NOT_FOUND", message: "missing" } } };
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body,
    } as Response;
  }) as typeof fetch;
  return calls;
}

const capabilities = { source: "verified-contract", aspectRatios: [], parameters: [], inputRoles: [] };

describe("MCP media-kind persistence migration", () => {
  it("falls back to image for legacy defaults without a kind", () => {
    assert.deepEqual(
      normalizeMcpSelection({ mcpProvider: "runway", mcpModel: "gen-4" }),
      { provider: "runway", model: "gen-4", kind: "image", ratio: null, parameters: {} },
    );
  });

  it("round-trips a persisted video kind", () => {
    assert.deepEqual(
      normalizeMcpSelection({ mcpProvider: "runway", mcpModel: "seedance-2", mcpMediaKind: "video" }),
      { provider: "runway", model: "seedance-2", kind: "video", ratio: null, parameters: {} },
    );
  });

  it("restores a whitelisted persisted ratio and normalizes corrupt ones to Auto", () => {
    assert.equal(
      normalizeMcpSelection({ mcpProvider: "runway", mcpRatio: "9:16" }).ratio,
      "9:16",
    );
    assert.equal(
      normalizeMcpSelection({ mcpProvider: "runway", mcpRatio: "4x7" }).ratio,
      null,
    );
    assert.equal(normalizeMcpSelection({ mcpProvider: "runway" }).ratio, null);
  });

  it("normalizes corrupt kind values and non-string ids", () => {
    assert.deepEqual(
      normalizeMcpSelection({ mcpProvider: 7, mcpModel: null, mcpMediaKind: "wide" }),
      { provider: null, model: null, kind: "image", ratio: null, parameters: {} },
    );
  });

  it("round-trips bounded scalar preset values and drops malformed records", () => {
    assert.deepEqual(
      normalizeMcpSelection({ mcpProvider: "runway", mcpParameters: { duration: 8, resolution: "720p", audio: false } }).parameters,
      { duration: 8, resolution: "720p", audio: false },
    );
    assert.deepEqual(normalizeMcpSelection({ mcpProvider: "runway", mcpParameters: ["bad"] }).parameters, {});
  });
});

describe("getMcpModelCatalog error semantics", () => {
  it("loads one canonical enriched catalog for Runway", async () => {
    const calls = installFakeFetch({
      "/api/mcp/providers/runway/models": { status: 200, body: { ok: true, models: {
        image: [{ id: "gen-4", label: "Gen-4", capabilities }],
        video: [{ id: "seedance-2", label: "Seedance 2", capabilities }],
      } } },
    });
    const catalog = await getMcpModelCatalog("runway");
    assert.deepEqual(catalog.image.map((entry) => entry.id), ["gen-4"]);
    assert.deepEqual(catalog.video.map((entry) => entry.id), ["seedance-2"]);
    assert.equal(calls.length, 1);
  });

  it("returns empty arrays when a successful catalog omits model arrays", async () => {
    installFakeFetch({
      "/api/mcp/providers/imageonly/models": { status: 200, body: { ok: true, models: {} } },
    });
    const catalog = await getMcpModelCatalog("imageonly");
    assert.deepEqual(catalog, { image: [], video: [] });
  });

  it("loads Higgsfield capabilities from the same endpoint exactly once", async () => {
    const calls = installFakeFetch({
      "/api/mcp/providers/higgsfield/models": {
        status: 200,
        body: { ok: true, models: {
          image: [{ id: "soul_2", label: "Higgsfield Soul 2.0", capabilities }],
          video: [{ id: "kling_3", label: "Kling 3", capabilities }],
        } },
      },
    });
    const catalog = await getMcpModelCatalog("higgsfield");
    assert.equal(catalog.image[0].label, "Higgsfield Soul 2.0");
    assert.equal(catalog.video[0].label, "Kling 3");
    const fallbackCalls = calls.filter((url) => url.includes("/providers/higgsfield/models"));
    assert.equal(fallbackCalls.length, 1);
  });

  it("propagates fallback endpoint failures as catalog errors", async () => {
    installFakeFetch({
      "/api/mcp/providers/higgsfield/models": {
        status: 409,
        body: { error: { code: "MCP_NOT_CONNECTED", message: "not connected" } },
      },
    });
    await assert.rejects(getMcpModelCatalog("higgsfield"), (error: Error & { status?: number }) => {
      assert.equal(error.status, 409);
      return true;
    });
  });

  it("propagates non-404 failures", async () => {
    installFakeFetch({
      "/api/mcp/providers/runway/models": { status: 500, body: { error: { code: "BOOM", message: "server broke" } } },
    });
    await assert.rejects(getMcpModelCatalog("runway"), (error: Error & { status?: number }) => {
      assert.equal(error.status, 500);
      return true;
    });
  });

  it("propagates aborts untouched", async () => {
    installFakeFetch({
      "/api/mcp/providers/runway/models": { status: 200, body: { ok: true, models: { image: [], video: [] } } },
    });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(getMcpModelCatalog("runway", controller.signal), (error: Error) => {
      assert.equal(error.name, "AbortError");
      return true;
    });
  });
});
