// Web access gate (L9): every request needs a valid Cloudflare Access token,
// remote-unsafe routes and unpriced generation are closed, and the signed-in
// email reaches the UI through a readable cookie.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWebRoute, createWebAccess, loadWebAccessConfig } from "../lib/webAccess/index.ts";

const GOOD = "good-token", OTHER = "other-person-token";

async function withGate(t: import("node:test").TestContext, allowedEmails: readonly string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "ima2-web-gate-"));
  const config = loadWebAccessConfig({ IMA2_WEB_ACCESS: "cloudflare", IMA2_CF_ACCESS_TEAM: "team", IMA2_CF_ACCESS_AUD: "aud" }, dir)!;
  const web = createWebAccess({ ...config, allowedEmails }, {
    verifier: { verify: async (token: string) => token === GOOD ? { ok: true as const, email: "jun@example.test" }
      : token === OTHER ? { ok: true as const, email: "other@example.test" } : { ok: false as const, reason: "signature" as const } },
  });
  const app = express();
  app.use(web.gate);
  web.registerRoutes(app);
  app.use((req, res) => { res.json({ reached: req.method + " " + req.path, email: res.locals.webUser?.email ?? null }); });
  const server = await new Promise<import("node:http").Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
  const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.token !== null) headers.set("cf-access-jwt-assertion", init.token ?? GOOD);
    return fetch(base + path, { ...init, headers });
  };
  return { call, base };
}

test("config: off unless IMA2_WEB_ACCESS=cloudflare, and incomplete settings stop the boot", () => {
  assert.equal(loadWebAccessConfig({}, "/tmp/x"), null);
  assert.equal(loadWebAccessConfig({ IMA2_WEB_ACCESS: "off" }, "/tmp/x"), null);
  assert.throws(() => loadWebAccessConfig({ IMA2_WEB_ACCESS: "cloudflare", IMA2_CF_ACCESS_TEAM: "team" }, "/tmp/x"), /IMA2_CF_ACCESS_AUD/);
  assert.throws(() => loadWebAccessConfig({ IMA2_WEB_ACCESS: "yes" }, "/tmp/x"), /IMA2_WEB_ACCESS/);
  assert.throws(() => loadWebAccessConfig({ IMA2_WEB_ACCESS: "cloudflare", IMA2_CF_ACCESS_TEAM: "team", IMA2_CF_ACCESS_AUD: "a", IMA2_WEB_SPEND_DAILY_USD: "-1" }, "/tmp/x"), /IMA2_WEB_SPEND_DAILY_USD/);
  const config = loadWebAccessConfig({ IMA2_WEB_ACCESS: "cloudflare", IMA2_CF_ACCESS_TEAM: "team", IMA2_CF_ACCESS_AUD: "a", IMA2_WEB_ALLOWED_EMAILS: "A@x.test, b@x.test" }, "/tmp/x")!;
  assert.equal(config.mode === "cloudflare" ? config.teamDomain : null, "team.cloudflareaccess.com");
  assert.deepEqual(config.allowedEmails, ["a@x.test", "b@x.test"]);
  assert.equal(config.dailyCapUsd, 5);
  assert.equal(config.requestCapUsd, 1);
  assert.equal(config.ledgerFile, join("/tmp/x", "web-spend-ledger.json"));
});

test("requests without a valid Access token get 401 on pages, API and media alike", async t => {
  const { call } = await withGate(t);
  for (const path of ["/", "/studio/higgs/", "/api/health", "/generated/a.png"]) {
    const missing = await call(path, { token: null });
    assert.equal(missing.status, 401, path);
    assert.equal((await missing.json()).error.code, "WEB_ACCESS_REQUIRED");
    assert.equal(missing.headers.get("cache-control"), "no-store");
    const forged = await call(path, { token: "forged" });
    assert.equal(forged.status, 401);
    assert.equal((await forged.json()).error.code, "WEB_ACCESS_INVALID");
  }
  const duplicated = await call("/", { token: null, headers: [["cf-access-jwt-assertion", GOOD], ["cf-access-jwt-assertion", GOOD]] });
  assert.equal(duplicated.status, 401);
});

test("a valid token reaches the app with the email in context and a readable cookie", async t => {
  const { call } = await withGate(t);
  const res = await call("/studio/higgs/");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { reached: "GET /studio/higgs/", email: "jun@example.test" });
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^ima2_web_user=jun%40example\.test;/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /HttpOnly/);
  const session = await call("/api/web/session");
  const body = await session.json();
  assert.equal(body.email, "jun@example.test");
  assert.equal(body.logoutUrl, "/cdn-cgi/access/logout");
  assert.deepEqual({ daily: body.spend.dailyCapUsd, perRequest: body.spend.requestCapUsd, spent: body.spend.spentUsd }, { daily: 5, perRequest: 1, spent: 0 });
});

test("an optional server-side email allow list refuses other signed-in people", async t => {
  const { call } = await withGate(t, ["jun@example.test"]);
  assert.equal((await call("/")).status, 200);
  const other = await call("/", { token: OTHER });
  assert.equal(other.status, 403);
  assert.equal((await other.json()).error.code, "WEB_ACCESS_FORBIDDEN");
});

test("remote-unsafe routes and unpriced generation are closed; everyday routes stay open", async t => {
  const { call } = await withGate(t);
  const closed: [string, string, string][] = [
    ["POST", "/api/admin/stop", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/auth/switch", "WEB_ROUTE_DISABLED"],
    ["GET", "/api/mcp/providers", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/comfy/probe", "WEB_ROUTE_DISABLED"],
    ["GET", "/api/comfy/workflows", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/comfy/workflows", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/comfy/inspect", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/comfy/export-image", "WEB_ROUTE_DISABLED"],
    ["GET", "/api/comfy/result-graph?filename=x.png", "WEB_ROUTE_DISABLED"],
    ["GET", "/api/comfy/remotes", "WEB_ROUTE_DISABLED"],
    ["PUT", "/api/comfy/remotes", "WEB_ROUTE_DISABLED"],
    ["DELETE", "/api/comfy/remotes", "WEB_ROUTE_DISABLED"],
    ["PUT", "/api/keys/fal", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/storage/open-generated-dir", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/history/import-local", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/prompts/import/folder-files", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/quota/codex/reset-credits/redeem", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/update/check", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/something-new", "WEB_ROUTE_DISABLED"],
    ["POST", "/API/Admin/stop", "WEB_ROUTE_DISABLED"],
    ["POST", "/api/generate", "WEB_UNPRICED"],
    ["POST", "/api/generate/multimode", "WEB_UNPRICED"],
    ["POST", "/api/edit", "WEB_UNPRICED"],
    ["POST", "/api/node/generate", "WEB_UNPRICED"],
    ["POST", "/api/video/generate", "WEB_UNPRICED"],
    ["POST", "/api/agent/sessions", "WEB_UNPRICED"],
    ["POST", "/api/prompt-builder/chat", "WEB_UNPRICED"],
    ["POST", "/api/cardnews/generate", "WEB_UNPRICED"],
  ];
  for (const [method, path, code] of closed) {
    const res = await call(path, { method });
    assert.equal(res.status, 403, method + " " + path);
    assert.equal((await res.json()).error.code, code, method + " " + path);
  }
  for (const [method, path] of [["GET", "/api/health"], ["GET", "/api/media/catalog"], ["POST", "/api/media"], ["POST", "/api/media/estimate"], ["POST", "/api/media/inputs"],
    ["POST", "/api/media/r1/cancel"], ["GET", "/api/keys/status"], ["POST", "/api/sessions"], ["PATCH", "/api/sessions/s1"],
    ["POST", "/api/workflows/director-studio/estimate"], ["POST", "/api/workflows/director-studio"], ["GET", "/api/history"], ["POST", "/api/history/favorite"], ["DELETE", "/api/inflight/r1"]]) {
    const res = await call(path!, { method: method! });
    assert.equal(res.status, 200, method + " " + path);
  }
});

test("route classification decodes and normalizes before matching", () => {
  assert.equal(classifyWebRoute("POST", "/api/%61dmin/stop").action, "deny");
  assert.equal(classifyWebRoute("POST", "/api/media/../admin/stop").action, "deny");
  assert.equal(classifyWebRoute("GET", "/index.html").action, "allow");
});
