// Key validation is a C4 boundary: a wrong verdict either stores a dead key or
// bills the user. These cases drive the real Express route, not a helper, so
// the request shape and the "do not persist on failure" rule are both observed.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.ts";
import { mountKeyRoutes } from "../routes/keys.ts";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

type UpstreamCall = { url: string; method?: string };

function stubUpstream(respond: () => Response, calls: UpstreamCall[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // The test client talks to our own server; only outbound calls are stubbed.
    if (url.startsWith("http://127.0.0.1:")) return originalFetch(input, init);
    calls.push({ url, method: init?.method });
    return respond();
  }) as typeof fetch;
}

async function withKeyRoutes(
  region: string,
  fn: (args: { baseUrl: string; configFile: string }) => Promise<void>,
) {
  const rootDir = await mkdtemp(join(tmpdir(), "ima2-minimax-keys-"));
  const configFile = join(rootDir, "config.json");
  const ctx = {
    rootDir,
    packageVersion: "test",
    config: {
      ...config,
      storage: { ...config.storage, configFile },
      minimaxProvider: { ...config.minimaxProvider, region },
      log: { ...config.log, level: "silent" },
    },
  };
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  mountKeyRoutes(app, ctx as never);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address() as import("node:net").AddressInfo;
  try {
    await fn({ baseUrl: `http://127.0.0.1:${addr.port}`, configFile });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

async function savedKey(configFile: string): Promise<unknown> {
  try {
    const raw = await readFile(configFile, "utf8");
    return JSON.parse(raw).minimaxApiKey;
  } catch {
    return undefined;
  }
}

const modelList = () => Response.json({
  object: "list",
  data: [{ id: "image-01", object: "model" }],
});

test("minimax key validation lists models instead of generating an image", async () => {
  const calls: UpstreamCall[] = [];
  stubUpstream(modelList, calls);

  await withKeyRoutes("global_en", async ({ baseUrl, configFile }) => {
    const res = await fetch(`${baseUrl}/api/keys/minimax`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "mm-valid-key" }),
    });
    assert.equal(res.status, 200);
    assert.equal(await savedKey(configFile), "mm-valid-key");
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.minimax.io/v1/models");
  assert.equal(calls[0].method, "GET");
  // Generating an image would bill the user on every key save.
  assert.doesNotMatch(calls[0].url, /image_generation/);
});

test("minimax key validation targets the China host for the cn_zh region", async () => {
  const calls: UpstreamCall[] = [];
  stubUpstream(modelList, calls);

  await withKeyRoutes("cn_zh", async ({ baseUrl }) => {
    await fetch(`${baseUrl}/api/keys/minimax`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "mm-cn-key" }),
    });
  });

  assert.equal(calls[0].url, "https://api.minimaxi.com/v1/models");
});

const rejectionCases: Array<{ name: string; respond: () => Response }> = [
  { name: "401 auth failure", respond: () => new Response("unauthorized", { status: 401 }) },
  { name: "429 rate limit", respond: () => new Response("slow down", { status: 429 }) },
  { name: "500 upstream error", respond: () => new Response("boom", { status: 500 }) },
  { name: "unparseable body", respond: () => new Response("<html>nope</html>", { status: 200 }) },
  {
    name: "200 carrying an error status_code",
    respond: () => Response.json({ data: [], base_resp: { status_code: 1008, status_msg: "insufficient balance" } }),
  },
  {
    name: "200 without a model list",
    respond: () => Response.json({ object: "list" }),
  },
  {
    // Type drift is not permission to store the key.
    name: "200 carrying a string error status_code",
    respond: () => Response.json({ data: [], base_resp: { status_code: "1008" } }),
  },
  {
    name: "200 with an unreadable status_code",
    respond: () => Response.json({ data: [], base_resp: { status_code: {} } }),
  },
];

for (const testCase of rejectionCases) {
  test(`minimax key validation fails closed on ${testCase.name}`, async () => {
    stubUpstream(testCase.respond, []);

    await withKeyRoutes("global_en", async ({ baseUrl, configFile }) => {
      const res = await fetch(`${baseUrl}/api/keys/minimax`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: "mm-suspect-key" }),
      });
      assert.equal(res.status, 400);
      const body = await res.json() as { code?: string };
      assert.equal(body.code, "KEY_VALIDATION_FAILED");
      // The key must never reach disk when validation did not clearly succeed.
      assert.equal(await savedKey(configFile), undefined);
    });
  });
}
