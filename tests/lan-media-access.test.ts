import test from "node:test";
import assert from "node:assert/strict";
import type { RuntimeContext } from "../lib/runtimeContext.js";

// HTTP and filesystem integration: hosted execution only, no local pure-name match.
async function fixture(t: import("node:test").TestContext, host = "0.0.0.0") {
  const [{ default: express }, { createServer }, fs, { join }, { tmpdir }, { createLocalLanAccess }, { createGeneratedMediaAccess }] = await Promise.all([
    import("express"), import("node:http"), import("node:fs/promises"), import("node:path"), import("node:os"),
    import("../lib/localLanAccess.ts"), import("../lib/generatedMediaAccess.ts"),
  ]);
  const directory = await fs.mkdtemp(join(tmpdir(), "ima2-lan-media-")), generatedDir = join(directory, "generated");
  await fs.mkdir(join(generatedDir, "nested"), { recursive: true });
  await fs.writeFile(join(generatedDir, "nested", "clip.mp4"), "0123456789");
  await fs.writeFile(join(generatedDir, "image.png"), "synthetic-png");
  await fs.writeFile(join(generatedDir, "trace.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await fs.writeFile(join(generatedDir, "metadata.JSON"), '{"private":"synthetic-sidecar"}');
  await fs.writeFile(join(directory, "outside.png"), "synthetic-outside");
  // Middleware-only context; unrelated provider/runtime fields are intentionally absent.
  const ctx = { config: { server: { host, lanToken: "synthetic-media-token", lanTokenOnLoopback: true, publicOrigins: [] },
    storage: { generatedDir, staticMaxAge: "1y" }, security: { lanSessionTtlMs: 28800000, lanMaxSessions: 256,
      lanAuthWindowMs: 60000, lanAuthMaxFailures: 10, lanAuthMaxBuckets: 4096, lanTokenMaxBytes: 4096 } } } as unknown as RuntimeContext;
  const app = express(), access = createLocalLanAccess(ctx);
  access.registerSessionRoutes(app, (_req, _res, next) => next());
  app.use(access.mediaHeaders, access.guard);
  app.use("/generated", ...createGeneratedMediaAccess(ctx, access));
  app.use((_req, res) => res.status(404).end());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { access.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); });
  const address = server.address(); assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${base}/api/auth/lan/session`, { method: "POST", headers: { origin: base, "content-type": "application/json", "x-ima2-token": "synthetic-media-token" }, body: "{}" });
  assert.equal(login.status, 204);
  const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { base, cookie, fs, join, directory, generatedDir };
}

function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(response.headers.get("vary")!, /Cookie/i); assert.match(response.headers.get("vary")!, /X-Ima2-Token/i);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("etag"), null); assert.equal(response.headers.get("last-modified"), null);
  assert.equal(response.headers.get("location"), null);
}

test("hosted media: anonymous GET HEAD Range conditional denied before file info and alias errors private", async t => {
  const { base } = await fixture(t);
  for (const path of ["/generated/image.png", "/generated/missing.png"]) {
    for (const init of [{}, { method: "HEAD" }, { headers: { range: "bytes=0-2" } }, { headers: { "if-none-match": "*" } }, { headers: { "if-modified-since": "Wed, 01 Jan 2099 00:00:00 GMT" } }]) {
      const response = await fetch(`${base}${path}`, init);
      assert.equal(response.status, 401); privateHeaders(response);
      assert.equal(response.headers.get("content-range"), null);
      await response.arrayBuffer();
    }
  }
  for (const path of ["/%67enerated/image.png", "/generated%2fimage.png", "/generated/%zz", "/%67enerated/%zz"]) {
    const response = await fetch(`${base}${path}`); assert.equal(response.status, 400); privateHeaders(response); await response.arrayBuffer();
  }
  const hostile = await fetch(`${base}/generated/image.png`, { headers: { origin: "http://evil.example", "x-ima2-token": "synthetic-media-token" } });
  assert.equal(hostile.status, 403); privateHeaders(hostile);
  const { request } = await import("node:http");
  // fetch/URL removes dot segments before transmission; send the actual raw target.
  const escaped = await new Promise<{ status: number; cache: string | undefined }>((resolve, reject) => {
    const req = request(base, { path: "/generated/../../x" }, res => {
      res.resume(); res.on("end", () => resolve({ status: res.statusCode!, cache: res.headers["cache-control"] }));
    }); req.on("error", reject); req.end();
  });
  assert.deepEqual(escaped, { status: 400, cache: "private, no-store, max-age=0" });
});

test("hosted media: cookie/header/query bytes HEAD Range, no validator bypass and explicit bad credentials", async t => {
  const { base, cookie } = await fixture(t);
  for (const [suffix, headers] of [["", { cookie }], ["", { "x-ima2-token": "synthetic-media-token" }], ["?token=synthetic-media-token", {}]] as [string, Record<string, string>][]) {
    const response = await fetch(`${base}/generated/nested/clip.mp4${suffix}`, { headers });
    assert.equal(response.status, 200); assert.equal(await response.text(), "0123456789"); privateHeaders(response);
    const range = await fetch(`${base}/generated/nested/clip.mp4${suffix}`, { headers: { ...headers, range: "bytes=2-5" } });
    assert.equal(range.status, 206); assert.equal(await range.text(), "2345"); assert.equal(range.headers.get("content-range"), "bytes 2-5/10"); privateHeaders(range);
    const head = await fetch(`${base}/generated/nested/clip.mp4${suffix}`, { method: "HEAD", headers });
    assert.equal(head.status, 200); assert.equal(await head.text(), ""); privateHeaders(head);
  }
  for (const query of ["?token=wrong", "?token=a&token=b", "?token[]=synthetic-media-token"]) {
    const denied = await fetch(`${base}/generated/image.png${query}`, { headers: { cookie } }); assert.equal(denied.status, 401); privateHeaders(denied);
  }
  const explicit = await fetch(`${base}/generated/image.png`, { headers: { cookie, "x-ima2-token": "wrong" } }); assert.equal(explicit.status, 401);
  const missing = await fetch(`${base}/generated/missing.png`, { headers: { cookie } }); assert.equal(missing.status, 404); privateHeaders(missing);
  const conditional = await fetch(`${base}/generated/image.png`, { headers: { cookie, "if-modified-since": "Wed, 01 Jan 2099 00:00:00 GMT" } });
  assert.equal(conditional.status, 200); privateHeaders(conditional);
  const invalidRange = await fetch(`${base}/generated/nested/clip.mp4`, { headers: { cookie, range: "bytes=999-1000" } });
  assert.equal(invalidRange.status, 416); privateHeaders(invalidRange);
});

test("hosted media: sidecar case/encoding, malformed paths, canonical aliases and SVG CSP", async t => {
  const { base, cookie, fs, join, directory, generatedDir } = await fixture(t);
  for (const path of ["metadata.JSON", "metadata%2eJSON", "%6detadata.JSON"]) {
    const response = await fetch(`${base}/generated/${path}`, { headers: { cookie } });
    assert.equal(response.status, 404); assert.equal(await response.text(), "Generated metadata is not public"); privateHeaders(response);
  }
  for (const path of ["nested%2fclip.mp4", "nested%5cclip.mp4", "image.png%00"]) {
    const response = await fetch(`${base}/generated/${path}`, { headers: { cookie } }); assert.ok([400, 404].includes(response.status)); privateHeaders(response);
  }
  const svg = await fetch(`${base}/generated/trace.svg`, { headers: { cookie } });
  assert.equal(svg.status, 200); assert.equal(svg.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(svg.headers.get("x-content-type-options"), "nosniff"); privateHeaders(svg);
  const png = await fetch(`${base}/generated/image.png`, { headers: { cookie } }); assert.equal(png.headers.get("content-security-policy"), null);
  if (process.platform !== "win32") {
    await fs.symlink(join(directory, "outside.png"), join(generatedDir, "escape.png"));
    await fs.symlink(join(generatedDir, "metadata.JSON"), join(generatedDir, "sidecar.png"));
    await fs.symlink(join(generatedDir, "trace.svg"), join(generatedDir, "vector.png"));
    await fs.symlink(join(directory, "outside.png"), join(generatedDir, "nested", "index.html"));
    const directoryIndex = await fetch(`${base}/generated/nested/`, { headers: { cookie } }); assert.equal(directoryIndex.status, 404);
    const escape = await fetch(`${base}/generated/escape.png`, { headers: { cookie } }); assert.equal(escape.status, 404); assert.doesNotMatch(await escape.text(), /synthetic-outside/);
    const metadata = await fetch(`${base}/generated/sidecar.png`, { headers: { cookie } }); assert.equal(metadata.status, 404); assert.equal(await metadata.text(), "Generated metadata is not public");
    const aliasSvg = await fetch(`${base}/generated/vector.png`, { headers: { cookie } });
    assert.equal(aliasSvg.status, 200); assert.equal(aliasSvg.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'");
  }
});

test("hosted media: local no-token static caching and sidecar exclusion remain", async t => {
  const { base } = await fixture(t, "127.0.0.1");
  const response = await fetch(`${base}/generated/image.png`);
  assert.equal(response.status, 200); assert.equal(await response.text(), "synthetic-png");
  assert.match(response.headers.get("cache-control")!, /public.*immutable/);
  assert.ok(response.headers.get("etag"));
  assert.equal((await fetch(`${base}/generated/metadata.JSON`)).status, 404);
});
