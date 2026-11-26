// Cloudflare Access JWT verification for the web instance (L9). Keys are generated
// per run and served by a fake certs endpoint, so nothing reaches Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createAccessJwtVerifier } from "../lib/webAccess/accessJwt.ts";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-synthetic";

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(key: ReturnType<typeof keyPair>, claims: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const head = b64({ alg: "RS256", kid: key.kid, typ: "JWT", ...header });
  const body = b64(claims);
  const signature = sign("RSA-SHA256", Buffer.from(head + "." + body), key.privateKey).toString("base64url");
  return head + "." + body + "." + signature;
}

function claims(nowMs: number, extra: Record<string, unknown> = {}) {
  const seconds = Math.floor(nowMs / 1000);
  return { aud: [AUD], iss: "https://" + TEAM, email: "Person@Example.com", exp: seconds + 600, iat: seconds, ...extra };
}

function fakeCerts(keys: () => readonly unknown[]) {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys: keys() }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

test("a valid Access token yields the lower-cased email and fetches the team certs once", async () => {
  const key = keyPair("k1");
  const now = 1_800_000_000_000;
  const certs = fakeCerts(() => [key.jwk]);
  const verifier = createAccessJwtVerifier({ teamDomain: TEAM, aud: AUD, fetch: certs.fetch, now: () => now });
  assert.deepEqual(await verifier.verify(token(key, claims(now))), { ok: true, email: "person@example.com" });
  assert.deepEqual(await verifier.verify(token(key, claims(now))), { ok: true, email: "person@example.com" });
  assert.deepEqual(certs.calls, ["https://" + TEAM + "/cdn-cgi/access/certs"]);
});

test("wrong audience, issuer, expiry, algorithm, missing email and bad shape are refused", async () => {
  const key = keyPair("k1");
  const now = 1_800_000_000_000;
  const verifier = createAccessJwtVerifier({ teamDomain: TEAM, aud: AUD, fetch: fakeCerts(() => [key.jwk]).fetch, now: () => now });
  const cases: [string, string][] = [
    ["aud", token(key, claims(now, { aud: ["other"] }))],
    ["iss", token(key, claims(now, { iss: "https://evil.cloudflareaccess.com" }))],
    ["expired", token(key, claims(now, { exp: Math.floor(now / 1000) - 1 }))],
    ["not-yet-valid", token(key, claims(now, { nbf: Math.floor(now / 1000) + 60 }))],
    ["email", token(key, claims(now, { email: "" }))],
    ["alg", token(key, claims(now), { alg: "HS256" })],
    ["malformed", "not-a-jwt"],
    ["malformed", "a.b"],
  ];
  for (const [reason, value] of cases) {
    assert.deepEqual(await verifier.verify(value), { ok: false, reason }, reason);
  }
});

test("a token signed by a key outside the team certs, or with a changed payload, is refused", async () => {
  const trusted = keyPair("k1");
  const attacker = keyPair("k1");
  const now = 1_800_000_000_000;
  const verifier = createAccessJwtVerifier({ teamDomain: TEAM, aud: AUD, fetch: fakeCerts(() => [trusted.jwk]).fetch, now: () => now });
  assert.deepEqual(await verifier.verify(token(attacker, claims(now))), { ok: false, reason: "signature" });
  const tampered = token(trusted, claims(now)).split(".");
  tampered[1] = b64(claims(now, { email: "someone-else@example.com" }));
  assert.deepEqual(await verifier.verify(tampered.join(".")), { ok: false, reason: "signature" });
});

test("an unknown kid triggers one rate-limited refresh, which picks up a rotated key", async () => {
  const oldKey = keyPair("old");
  const newKey = keyPair("new");
  let now = 1_800_000_000_000;
  let served: unknown[] = [oldKey.jwk];
  const certs = fakeCerts(() => served);
  const verifier = createAccessJwtVerifier({ teamDomain: TEAM, aud: AUD, fetch: certs.fetch, now: () => now });
  assert.equal((await verifier.verify(token(oldKey, claims(now)))).ok, true);
  served = [oldKey.jwk, newKey.jwk];
  now += 61_000;
  assert.deepEqual(await verifier.verify(token(newKey, claims(now))), { ok: true, email: "person@example.com" });
  assert.equal(certs.calls.length, 2);
  // Unknown kids inside the cooldown do not hammer the certs endpoint.
  const stranger = keyPair("stranger");
  assert.deepEqual(await verifier.verify(token(stranger, claims(now))), { ok: false, reason: "key" });
  assert.equal(certs.calls.length, 2);
});

test("a certs fetch failure fails closed", async () => {
  const key = keyPair("k1");
  const now = 1_800_000_000_000;
  const fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof globalThis.fetch;
  const verifier = createAccessJwtVerifier({ teamDomain: TEAM, aud: AUD, fetch, now: () => now });
  assert.deepEqual(await verifier.verify(token(key, claims(now))), { ok: false, reason: "key" });
});
