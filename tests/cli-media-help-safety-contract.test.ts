import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("media help is pure before parsing or side effects", async () => {
  const root = await mkdtemp(join(tmpdir(), "ima2-media-help-")); let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('{}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  for (const name of ["open", "xdg-open", "explorer"]) {
    const path = join(root, name); await writeFile(path, `#!/bin/sh\necho called >> "${join(root, "opened")}"\n`); await chmod(path, 0o755);
  }
  const advertise = join(root, "advertise.json"); await writeFile(advertise, JSON.stringify({ port: address.port, host: "127.0.0.1" }));
  try {
    for (const args of [[], ["--help"], ["run", "--help"], ["keys", "set", "x", "--key-stdin", "--help"],
      ["keys", "set", "x", "--extra", "--help"], ["keys", "delete", "x", "--help"],
      ["studio", "open", "higgs", "--help"], ["wait", "x", "--help"]]) {
      const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", "media", ...args], { env: {
        PATH: `${root}:${process.env.PATH}`, TMPDIR: process.env.TMPDIR, NO_COLOR: "1", HOME: root, USERPROFILE: root,
        IMA2_CONFIG_DIR: root, IMA2_GENERATED_DIR: root, IMA2_ADVERTISE_FILE: advertise,
      } });
      let stdout = ""; child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
      const timer = setTimeout(() => child.kill(), 10000); const [code] = await once(child, "close"); clearTimeout(timer);
      assert.equal(code, 0, args.join(" ")); assert.match(stdout, /ima2 media models/);
    }
    assert.equal(requests, 0);
    await assert.rejects(() => import("node:fs/promises").then(({ stat }) => stat(join(root, "opened"))));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
