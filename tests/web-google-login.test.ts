// Google sign-in mode for the web instance (L9): OIDC authorization code + PKCE
// against a fake Google (keys, token endpoint), server-signed session cookie,
// exact email allow list, Origin check on writes, and an app-only logout.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebAccess, loadWebAccessConfig } from "../lib/webAccess/index.ts";

const ORIGIN = "https://ima2.example.test";
const CLIENT_ID = "client-1.apps.googleusercontent.com";
const SECRET = "s".repeat(48);
const ENV = {
  IMA2_WEB_ACCESS: "google", IMA2_GOOGLE_CLIENT_ID: CLIENT_ID, IMA2_GOOGLE_CLIENT_SECRET: "client-secret",
  IMA2_WEB_SESSION_SECRET: SECRET, IMA2_WEB_PUBLIC_ORIGIN: ORIGIN, IMA2_WEB_ALLOWED_EMAILS: "jun@example.test",
};

type Claims = Record<string, unknown>;

function fakeGoogle(now: () => number) {
  const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...signer.publicKey.export({ format: "jwk" }), kid: "g1", alg: "RS256", use: "sig" };
  const state = { claims: {} as Claims, useStranger: false, tokenStatus: 200, tokenRequests: [] as URLSearchParams[] };
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const idToken = (nonce: string) => {
    const seconds = Math.floor(now() / 1000);
    const head = b64({ alg: "RS256", kid: "g1", typ: "JWT" });
    const body = b64({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "123", email: "Jun@Example.test", email_verified: true,
      nonce, iat: seconds, exp: seconds + 3600, ...state.claims });
    const key = state.useStranger ? stranger.privateKey : signer.privateKey;
    return head + "." + body + "." + sign("RSA-SHA256", Buffer.from(head + "." + body), key).toString("base64url");
  };
  let pendingNonce = "";
  const fetch = (async (url: string, init?: RequestInit) => {
    if (String(url) === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      state.tokenRequests.push(new URLSearchParams(String(init?.body)));
      if (state.tokenStatus !== 200) return new Response("{}", { status: state.tokenStatus });
      return Response.json({ id_token: idToken(pendingNonce), access_token: "unused" });
    }
    return new Response("unexpected " + url, { status: 599 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, state, setNonce: (n: string) => { pendingNonce = n; } };
}

async function withApp(t: import("node:test").TestContext, envOverrides: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ima2-web-google-"));
  let clock = Date.parse("2026-11-26T10:00:00Z");
  const now = () => clock;
  const google = fakeGoogle(now);
  const make = () => {
    const config = loadWebAccessConfig({ ...ENV, ...envOverrides }, dir)!;
    return createWebAccess(config, { fetch: google.fetch, now });
  };
  const app = express();
  let web = make();
  app.use((req, res, next) => web.gate(req, res, next));
  app.get("/api/web/session", (req, res, next) => { web.handleSession(req, res).catch(next); });
  app.use((req, res) => { res.json({ reached: req.method + " " + req.path, email: res.locals.webUser?.email ?? null }); });
  const server = await new Promise<import("node:http").Server>(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  t.after(async () => { await new Promise<void>(r => server.close(() => r())); await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const base = "http://127.0.0.1:" + (server.address() as import("node:net").AddressInfo).port;
  const call = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: "manual", ...init });
  return { call, google, advance: (ms: number) => { clock += ms; }, restart: () => { web = make(); } };
}

function cookiesOf(res: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair!.indexOf("=");
    out.set(pair!.slice(0, at), line);
  }
  return out;
}
const valueOf = (line: string | undefined) => line ? line.split(";")[0]!.slice(line.indexOf("=") + 1) : "";

async function startLogin(h: Awaited<ReturnType<typeof withApp>>, returnTo = "/studio/higgs/") {
  const res = await h.call("/auth/google/start?return=" + encodeURIComponent(returnTo));
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location")!);
  const pending = cookiesOf(res).get("ima2_oauth_pending");
  assert.ok(pending, "pending cookie");
  return { location, pendingCookie: "ima2_oauth_pending=" + valueOf(pending) };
}

async function login(h: Awaited<ReturnType<typeof withApp>>, claims: Claims = {}) {
  const { location, pendingCookie } = await startLogin(h);
  h.google.state.claims = claims;
  h.google.setNonce(location.searchParams.get("nonce")!);
  const res = await h.call("/auth/google/callback?code=auth-code&state=" + location.searchParams.get("state"), { headers: { cookie: pendingCookie } });
  const session = cookiesOf(res).get("__Host-ima2_session");
  return { res, location, session, sessionCookie: session && valueOf(session) ? "__Host-ima2_session=" + valueOf(session) : "" };
}

test("config: google mode needs a client, a long session secret, an https origin and an allow list", () => {
  assert.throws(() => loadWebAccessConfig({ ...ENV, IMA2_GOOGLE_CLIENT_SECRET: "" }, "/tmp/x"), /IMA2_GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadWebAccessConfig({ ...ENV, IMA2_WEB_SESSION_SECRET: "short" }, "/tmp/x"), /IMA2_WEB_SESSION_SECRET/);
  assert.throws(() => loadWebAccessConfig({ ...ENV, IMA2_WEB_PUBLIC_ORIGIN: "http://ima2.example.test" }, "/tmp/x"), /IMA2_WEB_PUBLIC_ORIGIN/);
  assert.throws(() => loadWebAccessConfig({ ...ENV, IMA2_WEB_ALLOWED_EMAILS: "" }, "/tmp/x"), /IMA2_WEB_ALLOWED_EMAILS/);
  const config = loadWebAccessConfig(ENV, "/tmp/x")!;
  assert.equal(config.mode, "google");
  assert.deepEqual(config.allowedEmails, ["jun@example.test"]);
});

test("before sign-in, pages redirect to the login screen and everything else gets 401", async t => {
  const h = await withApp(t);
  for (const path of ["/", "/studio/higgs/", "/index.html"]) {
    const res = await h.call(path, { headers: { accept: "text/html" } });
    assert.equal(res.status, 302, path);
    assert.equal(res.headers.get("location"), "/auth/login?return=" + encodeURIComponent(path));
  }
  for (const path of ["/api/health", "/generated/a.png", "/assets/app.js", "/api/web/session"]) {
    const res = await h.call(path);
    assert.equal(res.status, 401, path);
    assert.equal((await res.json()).error.code, "WEB_LOGIN_REQUIRED");
  }
  const page = await h.call("/auth/login?return=%2Fstudio%2Fhiggs%2F");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /href="\/auth\/google\/start\?return=%2Fstudio%2Fhiggs%2F"/);
});

test("start sends PKCE S256, state and nonce to Google with the fixed callback", async t => {
  const h = await withApp(t);
  const { location } = await startLogin(h);
  assert.equal(location.origin + location.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = location.searchParams;
  assert.equal(q.get("client_id"), CLIENT_ID);
  assert.equal(q.get("redirect_uri"), ORIGIN + "/auth/google/callback");
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "openid email profile");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.match(q.get("state")!, /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get("nonce")!, /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get("code_challenge")!, /^[A-Za-z0-9_-]{43}$/);
});

test("a verified allowed account gets a 24h signed session and reaches the app", async t => {
  const h = await withApp(t);
  const { res, location, session, sessionCookie } = await login(h);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/studio/higgs/");
  assert.ok(session);
  assert.match(session!, /Path=\//);
  assert.match(session!, /HttpOnly/);
  assert.match(session!, /Secure/);
  assert.match(session!, /SameSite=Lax/);
  assert.match(session!, /Max-Age=86400/);
  const token = h.google.state.tokenRequests[0]!;
  assert.equal(token.get("grant_type"), "authorization_code");
  assert.equal(token.get("code"), "auth-code");
  assert.equal(token.get("client_secret"), "client-secret");
  assert.equal(token.get("redirect_uri"), ORIGIN + "/auth/google/callback");
  assert.equal(createHash("sha256").update(token.get("code_verifier")!).digest("base64url"), location.searchParams.get("code_challenge"));
  const page = await h.call("/studio/higgs/", { headers: { cookie: sessionCookie } });
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), { reached: "GET /studio/higgs/", email: "jun@example.test" });
  const badge = cookiesOf(page);
  assert.equal(valueOf(badge.get("ima2_web_user")), "jun%40example.test");
  assert.equal(valueOf(badge.get("ima2_web_auth")), "google");
  const info = await (await h.call("/api/web/session", { headers: { cookie: sessionCookie } })).json();
  assert.equal(info.email, "jun@example.test");
  assert.equal(info.logoutUrl, "/auth/logout");
  assert.equal(info.logoutMethod, "POST");
  // The session expires after 24 hours.
  h.advance(86_400_000 + 1000);
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 401);
});

test("bad state, missing pending cookie and every failed id_token check leave no session", async t => {
  const h = await withApp(t);
  const cases: [string, Claims][] = [
    ["audience", { aud: "someone-else.apps.googleusercontent.com" }],
    ["issuer", { iss: "https://evil.example" }],
    ["expired", { exp: Math.floor(Date.parse("2026-11-26T09:00:00Z") / 1000) }],
    ["unverified email", { email_verified: false }],
    ["nonce", { nonce: "x".repeat(43) }],
  ];
  for (const [why, claims] of cases) {
    const { res, session } = await login(h, claims);
    assert.equal(res.status, 403, why);
    assert.equal(valueOf(session), "", why);
  }
  h.google.state.claims = {};
  h.google.state.useStranger = true;
  const forged = await login(h);
  assert.equal(forged.res.status, 403);
  assert.equal(valueOf(forged.session), "");
  h.google.state.useStranger = false;
  const { location, pendingCookie } = await startLogin(h);
  h.google.setNonce(location.searchParams.get("nonce")!);
  const wrongState = await h.call("/auth/google/callback?code=c&state=" + "A".repeat(43), { headers: { cookie: pendingCookie } });
  assert.equal(wrongState.status, 403);
  assert.equal(valueOf(cookiesOf(wrongState).get("__Host-ima2_session")), "");
  const noPending = await h.call("/auth/google/callback?code=c&state=" + location.searchParams.get("state"));
  assert.equal(noPending.status, 403);
  const denied = await h.call("/auth/google/callback?error=access_denied&state=" + location.searchParams.get("state"), { headers: { cookie: pendingCookie } });
  assert.equal(denied.status, 403);
  h.google.state.tokenStatus = 400;
  const exchange = await login(h);
  assert.equal(exchange.res.status, 403);
  assert.equal(valueOf(exchange.session), "");
});

test("a Google account outside the allow list sees a refusal and gets no session", async t => {
  const h = await withApp(t);
  const { res, session } = await login(h, { email: "stranger@gmail.com" });
  assert.equal(res.status, 403);
  assert.equal(valueOf(session), "");
  const body = await res.text();
  assert.match(body, /stranger@gmail\.com/);
  assert.match(body, /not allowed/i);
});

test("writes need this site's Origin, and the route policy still applies after sign-in", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  const post = (path: string, origin?: string) => h.call(path, { method: "POST", headers: { cookie: sessionCookie, ...(origin ? { origin } : {}) } });
  const missing = await post("/api/sessions");
  assert.equal(missing.status, 403);
  assert.equal((await missing.json()).error.code, "WEB_ORIGIN_REJECTED");
  assert.equal((await post("/api/sessions", "https://evil.example")).status, 403);
  assert.equal((await post("/api/sessions", ORIGIN)).status, 200);
  const admin = await post("/api/admin/stop", ORIGIN);
  assert.equal(admin.status, 403);
  assert.equal((await admin.json()).error.code, "WEB_ROUTE_DISABLED");
});

test("a tampered session cookie is refused", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  const [name, value] = sessionCookie.split("=") as [string, string];
  const [payload, mac] = value.split(".") as [string, string];
  const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), e: "other@example.test" })).toString("base64url");
  assert.equal((await h.call("/api/health", { headers: { cookie: name + "=" + other + "." + mac } })).status, 401);
  assert.equal((await h.call("/api/health", { headers: { cookie: name + "=" + payload + "." + "A".repeat(43) } })).status, 401);
});

test("logout needs this site's Origin, ends only this app's session, and survives a restart", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  const { sessionCookie: second } = await login(h);
  assert.equal((await h.call("/auth/logout", { method: "POST", headers: { cookie: sessionCookie } })).status, 403);
  const out = await h.call("/auth/logout", { method: "POST", headers: { cookie: sessionCookie, origin: ORIGIN } });
  assert.equal(out.status, 303);
  assert.equal(out.headers.get("location"), "/auth/signed-out");
  assert.equal(valueOf(cookiesOf(out).get("__Host-ima2_session")), "");
  assert.match(cookiesOf(out).get("__Host-ima2_session")!, /Max-Age=0/);
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 401);
  // Another browser's session is untouched, and both facts survive a restart.
  assert.equal((await h.call("/api/health", { headers: { cookie: second } })).status, 200);
  h.restart();
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 401);
  assert.equal((await h.call("/api/health", { headers: { cookie: second } })).status, 200);
  const signedOut = await h.call("/auth/signed-out");
  assert.equal(signedOut.status, 200);
  assert.match(await signedOut.text(), /href="\/auth\/login"/);
});

test("removing an email from the allow list ends its existing sessions", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 200);
  const narrowed = await withApp(t, { IMA2_WEB_ALLOWED_EMAILS: "someone-else@example.test" });
  assert.equal((await narrowed.call("/api/health", { headers: { cookie: sessionCookie } })).status, 401);
});

test("a same-origin form POST from a no-referrer page (Origin: null) can log out; cross-site cannot", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  const post = (headers: Record<string, string>) => h.call("/auth/logout", { method: "POST", headers: { cookie: sessionCookie, ...headers } });
  assert.equal((await post({ origin: "null", "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await post({ origin: "null" })).status, 403);
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 200);
  const out = await post({ origin: "null", "sec-fetch-site": "same-origin" });
  assert.equal(out.status, 303);
  assert.equal((await h.call("/api/health", { headers: { cookie: sessionCookie } })).status, 401);
});

test("writes with Origin: null pass only with Sec-Fetch-Site: same-origin", async t => {
  const h = await withApp(t);
  const { sessionCookie } = await login(h);
  const post = (headers: Record<string, string>) => h.call("/api/sessions", { method: "POST", headers: { cookie: sessionCookie, ...headers } });
  assert.equal((await post({ origin: "null", "sec-fetch-site": "same-site" })).status, 403);
  assert.equal((await post({ origin: "null", "sec-fetch-site": "same-origin" })).status, 200);
  assert.equal((await post({ origin: "https://evil.example", "sec-fetch-site": "same-origin" })).status, 403);
});
