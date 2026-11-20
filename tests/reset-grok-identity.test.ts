import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { grokIdentity } from "../lib/reset/grokIdentity.ts";

after(() => assert.equal(sentinelCount(), 0));
const endpoint = "https://auth.x.ai/userinfo";
describe("Grok identity safety", () => {
  for (const url of ["https://attacker.example/userinfo", "http://auth.x.ai/userinfo"]) {
    it(`refuses untrusted endpoint ${url}`, async () => {
      let calls = 0;
      const fake = (async () => { calls++; return Response.json({ sub: "a" }); }) as typeof fetch;
      assert.equal(await grokIdentity({ userinfo_endpoint: url }, "synthetic", fake), null);
      assert.equal(calls, 0);
    });
  }
  it("uses manual redirects and a five second timeout", async () => {
    let init: RequestInit | undefined;
    const fake = (async (_url: RequestInfo | URL, options?: RequestInit) => {
      init = options; return Response.json({ sub: "a" });
    }) as typeof fetch;
    await grokIdentity({ userinfo_endpoint: endpoint }, "synthetic", fake);
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
  });
  it("refuses oversized userinfo", async () => {
    const fake = (async () => Response.json({ sub: "a", padding: "x".repeat(65536) })) as typeof fetch;
    assert.equal(await grokIdentity({ userinfo_endpoint: endpoint }, "synthetic", fake), null);
  });
  it("refuses non-success userinfo even if it contains a sub", async () => {
    const fake = (async () => Response.json({ sub: "a" }, { status: 403 })) as typeof fetch;
    assert.equal(await grokIdentity({ userinfo_endpoint: endpoint }, "synthetic", fake), null);
  });
});
describe("Grok identity controls", () => {
  it("keys by sub while email changes", async () => {
    const fake = (async () => Response.json({ sub: "stable", email: "changed@example.test" })) as typeof fetch;
    assert.equal((await grokIdentity({ userinfo_endpoint: endpoint }, "synthetic", fake))?.ledgerKey, "grok:oidc:stable");
  });
  for (const body of ["{}", "{"]) {
    it(`rejects missing or malformed sub: ${body}`, async () => {
      const fake = (async () => new Response(body)) as typeof fetch;
      assert.equal(await grokIdentity({ userinfo_endpoint: endpoint }, "synthetic", fake), null);
    });
  }
  it("rejects missing endpoint without fetching", async () => {
    let calls = 0;
    const fake = (async () => { calls++; return Response.json({ sub: "a" }); }) as typeof fetch;
    assert.equal(await grokIdentity({}, "synthetic", fake), null);
    assert.equal(calls, 0);
  });
});
