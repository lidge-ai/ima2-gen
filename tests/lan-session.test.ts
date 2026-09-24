import test from "node:test";
import assert from "node:assert/strict";
import { createLanAuthThrottle, createLanSessionStore } from "../lib/lanSessionStore.ts";
import type { RuntimeContext } from "../lib/runtimeContext.js";

test("pure store: absolute origin-bound expiry and response revocation", () => {
  let now = 1000, closes = 0;
  const store = createLanSessionStore({ ttlMs: 100, maxSessions: 2, now: () => now });
  try {
    const session = store.issue("http://studio:80");
    assert.match(session.value, /^[\w-]{43}$/);
    assert.equal(session.expiresAt, 1100);
    assert.equal(store.validate(session.value, "http://studio:81"), null);
    store.track(session.value, () => closes++);
    now = 1099;
    assert.deepEqual(store.validate(session.value, "http://studio:80"), { expiresAt: 1100 });
    now = 1100;
    assert.equal(store.validate(session.value, "http://studio:80"), null);
    assert.equal(closes, 1);
    store.revoke(session.value); assert.equal(closes, 1);
  } finally { store.dispose(); }
});

test("pure store: capacity does not evict valid sessions and expiry frees capacity", () => {
  let now = 0;
  const store = createLanSessionStore({ ttlMs: 100, maxSessions: 2, now: () => now });
  try {
    const first = store.issue("http://studio"), second = store.issue("http://studio");
    assert.throws(() => store.issue("http://studio"), { code: "LAN_SESSION_CAPACITY", status: 503 });
    assert.deepEqual(store.validate(first.value, "http://studio"), { expiresAt: 100 });
    assert.deepEqual(store.validate(second.value, "http://studio"), { expiresAt: 100 });
    now = 100; assert.equal(store.issue("http://studio").expiresAt, 200);
  } finally { store.dispose(); }
});

test("pure store: bounded random collisions never replace existing sessions", () => {
  let calls = 0;
  const store = createLanSessionStore({ ttlMs: 1000, maxSessions: 2, randomBytes: size => { calls++; return Buffer.alloc(size, 7); } });
  try {
    const first = store.issue("http://studio");
    assert.throws(() => store.issue("http://other"), { code: "LAN_SESSION_UNAVAILABLE" });
    assert.equal(calls, 5);
    assert.ok(store.validate(first.value, "http://studio"));
    assert.equal(store.validate(first.value, "http://other"), null);
  } finally { store.dispose(); }
});

test("pure store: untracking, throwing closer, disposal and restart invalidate all sessions", () => {
  const store = createLanSessionStore({ ttlMs: 1000, maxSessions: 2 });
  const first = store.issue("http://studio"), second = store.issue("http://studio");
  let closed = 0;
  const untrack = store.track(first.value, () => { throw new Error("response closed"); });
  untrack(); untrack();
  store.track(first.value, () => { throw new Error("broken response"); });
  store.track(first.value, () => closed++);
  store.track(second.value, () => closed++);
  store.dispose(); store.dispose();
  assert.equal(closed, 2);
  assert.equal(store.validate(first.value, "http://studio"), null);
  assert.throws(() => store.issue("http://studio"), { code: "LAN_SESSION_UNAVAILABLE" });
  store.track(second.value, () => closed++); assert.equal(closed, 3);
  const restarted = createLanSessionStore({ ttlMs: 1000, maxSessions: 2 });
  try { assert.equal(restarted.validate(first.value, "http://studio"), null); } finally { restarted.dispose(); }
});

test("pure store: scheduled nearest expiry closes streams without another request; disposal clears timer", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const store = createLanSessionStore({ ttlMs: 100, maxSessions: 2 });
  let closed = 0;
  try {
    const first = store.issue("http://studio"); store.track(first.value, () => closed++);
    t.mock.timers.tick(40);
    const second = store.issue("http://studio"); store.track(second.value, () => closed++);
    t.mock.timers.tick(60); assert.equal(closed, 1);
    store.dispose(); assert.equal(closed, 2);
    t.mock.timers.tick(1000); assert.equal(closed, 2);
  } finally { store.dispose(); t.mock.timers.reset(); }
});

test("pure store: disposal during expiry cannot resurrect a pending issue", () => {
  let now = 0;
  const store = createLanSessionStore({ ttlMs: 1, maxSessions: 1, now: () => now });
  const first = store.issue("http://studio");
  store.track(first.value, () => store.dispose()); now = 1;
  assert.throws(() => store.issue("http://studio"), { code: "LAN_SESSION_UNAVAILABLE" });
  assert.equal(store.validate(first.value, "http://studio"), null);
});

test("pure store: exactly ten failures, cooldown, saturation and expired bucket pruning", () => {
  let now = 0;
  const throttle = createLanAuthThrottle({ windowMs: 60000, maxFailures: 10, maxBuckets: 2, now: () => now });
  for (let i = 0; i < 10; i++) { assert.equal(throttle.retryAfter("peer1"), 0); throttle.fail("peer1"); }
  assert.equal(throttle.retryAfter("peer1"), 60);
  // Checking a valid attempt does not clear the failure history.
  assert.equal(throttle.retryAfter("peer1"), 60);
  throttle.fail("peer2"); assert.equal(throttle.retryAfter("peer3"), 60);
  now = 59999; assert.equal(throttle.retryAfter("peer1"), 1);
  now = 60000; assert.equal(throttle.retryAfter("peer1"), 0); assert.equal(throttle.retryAfter("peer3"), 0);
  throttle.dispose();
});

test("pure store: concurrent issuance stops at the 256-session bound", async () => {
  const store = createLanSessionStore({ ttlMs: 28800000, maxSessions: 256 });
  try {
    const issued = await Promise.allSettled(Array.from({ length: 257 }, () => Promise.resolve().then(() => store.issue("http://studio"))));
    assert.equal(issued.filter(result => result.status === "fulfilled").length, 256);
    const denied = issued.find(result => result.status === "rejected");
    assert.ok(denied && denied.status === "rejected"); assert.equal(denied.reason.code, "LAN_SESSION_CAPACITY");
  } finally { store.dispose(); }
});

test("pure middleware: literal comma token works while duplicate raw fields fail", async () => {
  const { createLanApiGuard } = await import("../lib/localLanAccess.ts");
  const guard = createLanApiGuard("0.0.0.0", "legacy,a");
  for (const duplicate of [false, true]) {
    const req = { path: "/api/health", method: "GET", originalUrl: "/api/health",
      rawHeaders: duplicate ? ["x-ima2-token", "legacy,a", "x-ima2-token", "legacy,a"] : ["x-ima2-token", "legacy,a"],
      headers: { "x-ima2-token": "legacy,a" } } as unknown as import("express").Request;
    let next = 0, status = 0;
    const res = { getHeader: () => undefined, setHeader: () => {},
      status(code: number) { status = code; return this; }, type() { return this; }, end() {} } as unknown as import("express").Response;
    guard(req, res, () => { next++; });
    assert.equal(next, duplicate ? 0 : 1);
    assert.equal(status, duplicate ? 401 : 0);
  }
});

test("pure middleware: failed token guesses share cooldown across API media and status", async t => {
  const { createLocalLanAccess } = await import("../lib/localLanAccess.ts");
  const ctx = { config: { server: { host: "0.0.0.0", lanToken: "synthetic-shared", publicOrigins: [] },
    security: { lanSessionTtlMs: 28800000, lanMaxSessions: 256, lanAuthWindowMs: 60000,
      lanAuthMaxFailures: 10, lanAuthMaxBuckets: 4096, lanTokenMaxBytes: 4096 } } } as unknown as RuntimeContext;
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const access = createLocalLanAccess(ctx);
  let sessionCheck!: import("express").RequestHandler;
  access.registerSessionRoutes({ all(_path: unknown, check: import("express").RequestHandler) { sessionCheck = check; } } as unknown as
    import("express").Express, (_req, _res, next) => next());
  try {
    for (let attempt = 0; attempt < 13; attempt++) {
      if (attempt === 12) t.mock.timers.tick(60000);
      const value = attempt < 10 ? "wrong" : "synthetic-shared";
      const path = [`/api/probe?token=${value}`, "/generated/owned.png", `/api/auth/lan/session?token=${value}`][attempt % 3]!;
      const headers: Record<string, string> = { host: "127.0.0.1:49123", origin: "http://127.0.0.1:49123" };
      if (attempt % 3 === 1) headers["x-ima2-token"] = value;
      const req = { method: "GET", path: path.split("?")[0], originalUrl: path, url: path,
        headers, rawHeaders: Object.entries(headers).flat(),
        socket: { localAddress: "127.0.0.1", localPort: 49123, remoteAddress: "192.0.2.1" } } as unknown as import("express").Request;
      let status = 0, response = "";
      const output: Record<string, string> = {};
      const res = { getHeader: (name: string) => output[name], setHeader: (name: string, value: string) => { output[name] = value; },
        status(code: number) { status = code; return this; }, type() { return this; }, end(body: string) { response = body; } } as unknown as
        import("express").Response;
      (attempt % 3 === 2 ? sessionCheck : access.guard)(req, res, () => { status = 200; });
      assert.equal(status, attempt < 10 ? 401 : attempt < 12 ? 429 : 200, `attempt ${attempt + 1}`);
      if (attempt < 12) assert.equal(JSON.parse(response).error.code, attempt < 10 ? "LAN_TOKEN_REQUIRED" : "LAN_AUTH_RATE_LIMITED");
      if (attempt >= 10 && attempt < 12) assert.ok(Number(output["Retry-After"]) > 0);
    }
  } finally { access.dispose(); t.mock.timers.reset(); }
});

// Imports of real buildApp/config/native modules stay inside hosted callbacks below.
// These are NOT part of the locally allowed --test-name-pattern='pure ' run.
async function httpFixture(t: import("node:test").TestContext, options: { publicOrigins?: string[]; host?: string; tokenTrenLoopback?: boolean } = {}) {
  const [{ default: express }, { createServer }, { createLocalLanAccess }, { createApiRequestBudget }] = await Promise.all([
    import("express"), import("node:http"), import("../lib/localLanAccess.ts"), import("../lib/apiRequestBudget.ts"),
  ]);
  // This middleware-only fixture deliberately supplies just the consumed config fields.
  const ctx = { config: { server: { host: options.host ?? "0.0.0.0", lanToken: "synthetic-session-token", lanTokenOnLoopback: options.tokenTrenLoopback ?? true, publicOrigins: options.publicOrigins ?? [] },
    security: { lanSessionTtlMs: 28800000, lanMaxSessions: 256, lanAuthWindowMs: 60000, lanAuthMaxFailures: 10, lanAuthMaxBuckets: 4096, lanTokenMaxBytes: 4096 } } } as unknown as RuntimeContext;
  const app = express(), access = createLocalLanAccess(ctx);
  const budget = createApiRequestBudget({ windowMs: 60000, requests: 600, mutations: 120, maxPeers: 4096 });
  access.registerSessionRoutes(app, budget); app.use(access.mediaHeaders, access.guard, budget);
  app.all("/api/probe", (_req, res) => res.json({ ok: true }));
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => { access.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const bootstrap = (headers: Record<string, string> = {}, body = "{}", query = "") => fetch(`${base}/api/auth/lan/session${query}`, {
    method: "POST", headers: { origin: base, "content-type": "application/json", ...headers }, body,
  });
  return { base, bootstrap, access, app };
}

test("hosted HTTP: bootstrap/status/logout, explicit precedence, shape and safe errors", async t => {
  const { base, bootstrap } = await httpFixture(t);
  const status = await fetch(`${base}/api/auth/lan/session`);
  assert.deepEqual(await status.json(), { mode: "lan", authenticated: false, expiresAt: null });
  const good = await bootstrap({ "x-ima2-token": "synthetic-session-token" });
  assert.equal(good.status, 204); assert.equal(await good.text(), "");
  const setCookie = good.headers.get("set-cookie")!;
  assert.match(setCookie, /^ima2_lan_[a-f0-9]{12}=[\w-]{43}; Path=\/; HttpOnly; SameSite=Strict$/);
  assert.doesNotMatch(setCookie, /synthetic-session-token|Max-Age|Expires|Secure/);
  const cookie = setCookie.split(";")[0]!;
  const authenticated = await fetch(`${base}/api/auth/lan/session`, { headers: { cookie } });
  assert.equal((await authenticated.json()).authenticated, true);
  for (const [headers, body, query, expected] of [
    [{}, "{}", "", 401], [{ cookie }, "{}", "", 401], [{}, "{}", "?token=synthetic-session-token", 401],
    [{ cookie, "x-ima2-token": "wrong" }, "{}", "", 401],
    [{ "x-ima2-token": "synthetic-session-token" }, "{}", "?token=a&token=b", 401],
    [{ "x-ima2-token": "synthetic-session-token" }, "{}", "?token[]=a", 401],
    [{ "x-ima2-token": "synthetic-session-token", cookie: `${cookie}; ${cookie}` }, "{}", "", 401],
    [{ "x-ima2-token": "synthetic-session-token", "content-type": "application/x-www-form-urlencoded" }, "{}", "", 415],
    [{ "x-ima2-token": "synthetic-session-token" }, '{"unknown":true}', "", 400],
    [{ "x-ima2-token": "synthetic-session-token" }, "{", "", 400],
    [{ "x-ima2-token": "synthetic-session-token" }, `{"x":"${"a".repeat(1100)}"}`, "", 400],
  ] as [Record<string, string>, string, string, number][]) {
    const response = await bootstrap(headers, body, query);
    assert.equal(response.status, expected); assert.doesNotMatch(await response.text(), /synthetic-session-token|unknown/);
  }
  for (const headers of [{ cookie, "x-ima2-token": "wrong" }, { cookie: `${cookie}; ${cookie}` }]) {
    const denied = await fetch(`${base}/api/auth/lan/session`, { headers }); assert.equal(denied.status, 401);
  }
  const badQuery = await fetch(`${base}/api/probe?token=wrong`, { headers: { cookie } }); assert.equal(badQuery.status, 401);
  const queryLogout = await fetch(`${base}/api/auth/lan/session?token=synthetic-session-token`, { method: "DELETE", headers: { origin: base } }); assert.equal(queryLogout.status, 401);
  const unsafe = await fetch(`${base}/api/probe`, { method: "POST", headers: { cookie } }); assert.equal(unsafe.status, 403);
  const logout = await fetch(`${base}/api/auth/lan/session`, { method: "DELETE", headers: { cookie, origin: base } });
  assert.equal(logout.status, 204); assert.match(logout.headers.get("set-cookie")!, /Expires=/);
  assert.equal((await fetch(`${base}/api/probe`, { headers: { cookie } })).status, 401);
});

test("hosted HTTP: HTTPS cookie attributes, local no-cookie flow and single shared budget", async t => {
  const tls = await httpFixture(t, { publicOrigins: ["https://studio.example"] });
  // Native fetch drops a caller-supplied Host. This is the synthetic reverse
  // proxy wire contract, so send the exact authority with node:http instead.
  const { request } = await import("node:http");
  const response = await new Promise<{ status: number; cookie: string | undefined }>((resolve, reject) => {
    const req = request(`${tls.base}/api/auth/lan/session`, { method: "POST", headers: {
      host: "studio.example", origin: "https://studio.example", "x-ima2-token": "synthetic-session-token",
      "content-type": "application/json", "content-length": "2",
    } }, res => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode!, cookie: res.headers["set-cookie"]?.[0] }));
    });
    req.on("error", reject); req.end("{}");
  });
  assert.equal(response.status, 204);
  assert.match(response.cookie!, /^__Host-ima2_lan_[a-f0-9]{12}=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  const local = await httpFixture(t, { host: "127.0.0.1" });
  const created = await local.bootstrap(); assert.equal(created.status, 204); assert.equal(created.headers.get("set-cookie"), null);
  for (let i = 1; i < 120; i++) { const res = await local.bootstrap(); assert.equal(res.status, 204, `mutation ${i + 1}`); }
  const exhausted = await fetch(`${local.base}/api/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(exhausted.status, 429); assert.equal((await exhausted.json()).error.code, "API_RATE_LIMITED");
});

test("hosted HTTP: token byte bound, duplicate raw headers, cooldown and rebootstrap rotation", async t => {
  const { base, bootstrap } = await httpFixture(t);
  const good = await bootstrap({ "x-ima2-token": "synthetic-session-token" });
  const oldCookie = good.headers.get("set-cookie")!.split(";")[0]!;
  const bad = await bootstrap({ "x-ima2-token": "wrong", cookie: oldCookie }); assert.equal(bad.status, 401);
  assert.equal((await fetch(`${base}/api/probe`, { headers: { cookie: oldCookie } })).status, 200);
  const next = await bootstrap({ "x-ima2-token": "synthetic-session-token", cookie: oldCookie }); assert.equal(next.status, 204);
  const newCookie = next.headers.get("set-cookie")!.split(";")[0]!; assert.notEqual(oldCookie, newCookie);
  assert.equal((await fetch(`${base}/api/probe`, { headers: { cookie: oldCookie } })).status, 401);
  const oversized = await bootstrap({ "x-ima2-token": "a".repeat(4097) }); assert.equal(oversized.status, 401);
  const { request } = await import("node:http");
  const duplicateStatus = await new Promise<number>((resolve, reject) => {
    const req = request(`${base}/api/probe`, { headers: { "x-ima2-token": ["synthetic-session-token", "synthetic-session-token"] } }, res => { res.resume(); res.on("end", () => resolve(res.statusCode!)); });
    req.on("error", reject); req.end();
  });
  assert.equal(duplicateStatus, 401);
  for (let i = 2; i < 10; i++) assert.equal((await bootstrap()).status, 401);
  const cooled = await bootstrap({ "x-ima2-token": "synthetic-session-token" });
  assert.equal(cooled.status, 429); assert.ok(Number(cooled.headers.get("retry-after")) > 0);
});

test("hosted HTTP: shared token cooldown preserves existing cookie sessions", async t => {
  const { base, bootstrap } = await httpFixture(t);
  const created = await bootstrap({ "x-ima2-token": "synthetic-session-token" });
  assert.equal(created.status, 204);
  const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
  for (let attempt = 0; attempt < 10; attempt++) {
    const path = ["/api/probe", "/generated/owned.png", "/api/auth/lan/session"][attempt % 3]!;
    const denied = await fetch(`${base}${path}?token=wrong`);
    assert.equal(denied.status, 401);
  }
  const limited = await fetch(`${base}/api/probe`, { headers: { "x-ima2-token": "synthetic-session-token", cookie } });
  assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await bootstrap({ "x-ima2-token": "synthetic-session-token" })).status, 429);
  assert.equal((await fetch(`${base}/api/probe`, { headers: { cookie } })).status, 200);
  const status = await fetch(`${base}/api/auth/lan/session`, { headers: { cookie } });
  assert.equal((await status.json()).authenticated, true);
  assert.equal((await (await fetch(`${base}/api/auth/lan/session`)).json()).authenticated, false);
});

test("hosted HTTP: mo tu chinh may nay thi khong bi hoi token, may khac thi co", async t => {
  // Bind ra 0.0.0.0 la de may trong tailnet vao duoc, khong phai de khoa chinh
  // may dang chay server: truoc khi bat Tailscale, localhost:3333 chua bao gio
  // bi hoi token, va khong co ly do gi de doi.
  const { base } = await httpFixture(t, { tokenTrenLoopback: false });
  const probe = await fetch(`${base}/api/probe`);
  assert.equal(probe.status, 200);
  assert.deepEqual(await probe.json(), { ok: true });
  const status = await fetch(`${base}/api/auth/lan/session`);
  assert.deepEqual(await status.json(), { mode: "local", authenticated: true, expiresAt: null });

  // Dia chi nguon moi la bang chung, khong phai header: khai la may khac khong
  // mo duoc cua, ma khai la loopback cung khong mo duoc cua.
  const noiDoi = await fetch(`${base}/api/probe`, { headers: {
    "x-forwarded-for": "100.64.0.9", "x-real-ip": "100.64.0.9", forwarded: "for=100.64.0.9",
  } });
  assert.equal(noiDoi.status, 200);
});

test("pure policy: chi ket noi that su tu loopback moi duoc mien", async () => {
  const { laKetNoiLoopback } = await import("../lib/localAccessPolicy.ts");
  const req = (remoteAddress: string | undefined) =>
    ({ socket: { remoteAddress } }) as unknown as import("express").Request;
  for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", " 127.0.0.1 "]) {
    assert.equal(laKetNoiLoopback(req(address)), true, address);
  }
  // 100.x la dai Tailscale; 0.0.0.0 va socket da dong thi coi nhu tu mang.
  for (const address of ["100.64.0.9", "192.168.1.20", "::ffff:100.64.0.9", "2001:db8::1", "0.0.0.0", "", undefined]) {
    assert.equal(laKetNoiLoopback(req(address)), false, String(address));
  }
});

test("hosted HTTP: pending parsed bootstrap cannot issue after disposal", async t => {
  const { default: express } = await import("express");
  const { createServer, request } = await import("node:http");
  const { createLocalLanAccess } = await import("../lib/localLanAccess.ts");
  const ctx = { config: { server: { host: "0.0.0.0", lanToken: "synthetic-pending", lanTokenOnLoopback: true, publicOrigins: [] },
    security: { lanSessionTtlMs: 28800000, lanMaxSessions: 256, lanAuthWindowMs: 60000, lanAuthMaxFailures: 10, lanAuthMaxBuckets: 4096, lanTokenMaxBytes: 4096 } } } as unknown as RuntimeContext;
  const app = express(), access = createLocalLanAccess(ctx);
  let admitted!: () => void;
  const admission = new Promise<void>(resolve => { admitted = resolve; });
  access.registerSessionRoutes(app, (_req, _res, next) => { admitted(); next(); });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { access.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert.ok(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  const response = new Promise<{ status: number; cookie: string[] | undefined }>((resolve, reject) => {
    const req = request(`${base}/api/auth/lan/session`, { method: "POST", headers: { origin: base, "content-type": "application/json", "x-ima2-token": "synthetic-pending", "content-length": "2" } }, res => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode!, cookie: res.headers["set-cookie"] }));
    });
    req.on("error", reject); req.write("{");
    void admission.then(() => { access.dispose(); req.end("}"); }).catch(reject);
  });
  assert.deepEqual(await response, { status: 503, cookie: undefined });
});

test("hosted HTTP: exact session suffix and token-only compatibility ignore unrelated cookies", async t => {
  const { base } = await httpFixture(t);
  for (const path of ["/api/auth/lan/session/", "/api/auth/lan/session/extra", "/api/auth/lan/%73ession"]) {
    assert.equal((await fetch(`${base}${path}`)).status, 401, path);
  }
  const canonical = await fetch(`${base}/API/AUTH/LAN/SESSION`); assert.equal(canonical.status, 200);
  const { createLanApiGuard } = await import("../lib/localLanAccess.ts");
  // Direct compatibility middleware invocation; no server wrapper/config import.
  const guard = createLanApiGuard("0.0.0.0", "synthetic-compat");
  const req = { path: "/api/health", method: "GET", originalUrl: "/api/health", rawHeaders: ["x-ima2-token", "synthetic-compat"], headers: { "x-ima2-token": "synthetic-compat", cookie: "unrelated=value;" } } as unknown as import("express").Request;
  let calls = 0;
  guard(req, {} as import("express").Response, () => { calls++; });
  assert.equal(calls, 1);
});

test("hosted real app: expiry and disposal close admitted SSE before server close completes", async t => {
  const { isolateExecution, assertOwned } = await import("./_executionRouteIsolation.ts");
  const { listenOwnedLoopback } = await import("./_grokImageTransportFixture.ts");
  const isolation = await isolateExecution();
  let teardown = async () => {};
  t.after(async () => { try { await teardown(); } finally { await isolation.close(); } });
  const [{ buildApp }, { config }, { createTestRuntimeContext }, { createServer }, { publish }, { closeDb }] = await Promise.all([
    import("../server.ts"), import("../config.ts"), import("../lib/runtimeContext.ts"), import("node:http"), import("../lib/eventBus.ts"), import("../lib/db.ts"),
  ]);
  for (const key of ["dbPath", "configDir", "generatedDir"] as const) assertOwned(isolation.rootDir, config.storage[key]);
  let clock = Date.now();
  const originalNow = Date.now;
  // Only the synchronous constructors capture this clock. Native I/O and the
  // rest of the process retain real time; production TTL remains unchanged.
  const app = (() => {
    try {
      Date.now = () => clock;
      return buildApp(createTestRuntimeContext({ config: { ...config, server: { ...config.server, host: "0.0.0.0", lanToken: "synthetic-teardown-token", lanTokenOnLoopback: true, publicOrigins: [] } } }));
    } finally { Date.now = originalNow; }
  })();
  const server = createServer(app);
  teardown = async () => { app.locals.disposeLocalLanAccess(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); };
  await new Promise<void>(resolve => listenOwnedLoopback(() => server.listen(0, "127.0.0.1", resolve)));
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  for (const reason of ["expiry", "dispose"]) {
    const login = await isolation.fetchOwned(server, `${base}/api/auth/lan/session`, { method: "POST", headers: { origin: base, "content-type": "application/json", "x-ima2-token": "synthetic-teardown-token" }, body: "{}" });
    assert.equal(login.status, 204);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const stream = await isolation.fetchOwned(server, `${base}/api/events`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    assert.equal(stream.status, 200); const reader = stream.body!.getReader();
    publish("session-teardown", "progress", { synthetic: true });
    assert.equal((await reader.read()).done, false);
    if (reason === "expiry") {
      clock += config.security.lanSessionTtlMs + 1;
      const expired = await isolation.fetchOwned(server, `${base}/api/auth/lan/session`, { headers: { cookie } });
      assert.equal((await expired.json()).authenticated, false);
    } else { app.locals.disposeLocalLanAccess(); app.locals.disposeLocalLanAccess(); }
    assert.equal((await reader.read()).done, true, reason);
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
  assert.equal(server.listening, false);
});
