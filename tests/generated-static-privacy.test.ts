import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config } from "../config.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";
import { buildApp } from "../server.js";

function listen(server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

test("/generated serves media files but never generated sidecar metadata", async () => {
  const generatedDir = await mkdtemp(join(tmpdir(), "ima2-generated-static-"));
  const server = createServer(
    buildApp(
      createTestRuntimeContext({
        config: {
          ...config,
          storage: { ...config.storage, generatedDir, staticMaxAge: "0" },
        },
      }),
    ),
  );
  const base = await listen(server);
  try {
    await writeFile(join(generatedDir, "clip.mp4"), Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]));
    await writeFile(join(generatedDir, "clip.mp4.json"), JSON.stringify({ secret: true }));

    const media = await fetch(`${base}/generated/clip.mp4`);
    assert.equal(media.status, 200);

    const sidecar = await fetch(`${base}/generated/clip.mp4.json`);
    assert.equal(sidecar.status, 404);
    assert.equal(await sidecar.text(), "Generated metadata is not public");

    // A traced SVG is an active document under top-level navigation, and
    // /generated sits outside the LAN token guard, so the serving layer must
    // neuter it regardless of who wrote the file.
    await writeFile(join(generatedDir, "traced.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h1v1z\"/></svg>");
    const vector = await fetch(`${base}/generated/traced.svg`);
    assert.equal(vector.status, 200);
    assert.equal(vector.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'");
    assert.equal(vector.headers.get("x-content-type-options"), "nosniff");

    // Raster media must not gain the restrictive policy.
    const raster = await fetch(`${base}/generated/clip.mp4`);
    assert.equal(raster.headers.get("content-security-policy"), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(generatedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
