import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { request } from "node:http";
import { configureApiCachePolicy } from "../lib/apiCachePolicy.ts";

type HitOptions = {
  headers?: Record<string, string>;
  path?: string;
};

type HitResult = {
  body: unknown;
  headers: import("node:http").IncomingHttpHeaders;
  status: number | undefined;
};

async function hit(app: express.Express, { headers = {}, path = "/api/history" }: HitOptions = {}) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as import("node:net").AddressInfo).port;
  try {
    return await new Promise<HitResult>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path, headers }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ body: raw ? JSON.parse(raw) : null, headers: res.headers, status: res.statusCode });
          } catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("API JSON responses use no-store and do not return 304 for conditional requests", async () => {
  const app = express();
  configureApiCachePolicy(app);
  app.get("/api/history", (_req, res) => {
    res.json({ items: [], nextCursor: null, total: 0 });
  });

  const first = await hit(app);
  assert.equal(first.status, 200);
  assert.equal(first.headers["cache-control"], "no-store, max-age=0");
  assert.equal(first.headers.etag, undefined);

  const second = await hit(app, {
    headers: { "If-None-Match": first.headers.etag ?? 'W/"stale-cache-validator"' },
  });
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, { items: [], nextCursor: null, total: 0 });
  assert.equal(second.headers["cache-control"], "no-store, max-age=0");
  assert.equal(second.headers.etag, undefined);
});
