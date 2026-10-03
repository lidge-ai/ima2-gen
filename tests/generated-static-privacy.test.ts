import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const TEST_DIR = mkdtempSync(join(tmpdir(), "ima2-generated-privacy-"));
const savedEnv = new Map(Object.entries(process.env).filter(([key]) => key.startsWith("IMA2_") || key === "DOTENV_CONFIG_PATH"));
let stopQueueWorker: (() => void) | undefined;
let closeDb: (() => void) | undefined;
after(() => {
  try { stopQueueWorker?.(); }
  finally {
    try { closeDb?.(); }
    finally {
      try { rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
      finally {
        for (const key of Object.keys(process.env)) {
          if (key.startsWith("IMA2_") || key === "DOTENV_CONFIG_PATH") delete process.env[key];
        }
        for (const [key, value] of savedEnv) process.env[key] = value;
      }
    }
  }
});

// Config is captured at import time, including through validation/logger imports.
for (const key of savedEnv.keys()) delete process.env[key];
Object.assign(process.env, {
  IMA2_CONFIG_DIR: TEST_DIR,
  IMA2_DB_PATH: join(TEST_DIR, "sessions.db"),
  DOTENV_CONFIG_PATH: join(TEST_DIR, "empty.env"),
});
writeFileSync(join(TEST_DIR, "config.json"), "{}");
writeFileSync(join(TEST_DIR, "empty.env"), "");

const { config } = await import("../config.js");
({ closeDb } = await import("../lib/db.js"));
({ stopAgentQueueWorker: stopQueueWorker } = await import("../lib/agentQueueWorker.js"));
const { createTestRuntimeContext } = await import("../lib/runtimeContext.js");
const { buildApp } = await import("../server.js");

function listen(server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

test("/generated serves media files but never generated sidecar metadata", async () => {
  const generatedDir = await mkdtemp(join(TEST_DIR, "ima2-generated-static-"));
  const app = buildApp(createTestRuntimeContext({
    config: {
      ...config,
      storage: { ...config.storage, generatedDir, staticMaxAge: "0" },
    },
  }));
  const server = createServer(app);
  server.once("close", app.locals.disposeLocalLanAccess);
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
