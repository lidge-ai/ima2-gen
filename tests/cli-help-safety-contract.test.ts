import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";

// A help command that regressed can block on device-code polling, so every run
// carries a deadline. Without it a red run hangs for the whole suite timeout
// instead of failing.
const CLI_DEADLINE_MS = 20_000;

function runCLI(args, env) {
  return new Promise<any>((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", "bin/ima2.ts", ...args], {
      env: { ...process.env, NO_COLOR: "1", ...env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CLI_DEADLINE_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/**
 * A loopback stand-in for a running `ima2 serve`, advertised through
 * IMA2_ADVERTISE_FILE so CLI server discovery stops here.
 *
 * This is the load-bearing part of the Grok cases. HOME isolation only protects
 * the credential file the CLI reads itself; findRunningServer still probes
 * localhost:3333 unconditionally, and a real server there would accept
 * /api/auth/switch and write credentials under ITS OWN home, where the seeded
 * sentinel below cannot see the damage. The trap makes discovery terminate on a
 * socket the test owns, and the request count turns any discovery attempt into
 * an assertion failure rather than a real login.
 *
 * /api/health must answer with valid JSON: a non-JSON body makes probe() raise
 * SERVER_INVALID_HEALTH and take a different path.
 */
async function startTrapServer() {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, pid: process.pid, version: "trap" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as any;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() { return requests; },
    close: () => new Promise<any>((resolve) => server.close(resolve)),
  };
}

const SENTINEL_CREDENTIALS = JSON.stringify({
  accessToken: "sentinel-access-token",
  refreshToken: "sentinel-refresh-token",
  email: "sentinel@example.test",
  expiresAt: 4102444800000,
}, null, 2);

/** Isolated HOME with a seeded ~/.progrok/auth.json plus an advertised trap. */
async function grokFixture() {
  const root = await mkdtemp(join(tmpdir(), "ima2-grok-help-"));
  const authFile = join(root, ".progrok", "auth.json");
  await mkdir(join(root, ".progrok"), { recursive: true });
  await writeFile(authFile, SENTINEL_CREDENTIALS);
  const trap = await startTrapServer();
  const advertiseFile = join(root, "advertise.json");
  await writeFile(advertiseFile, JSON.stringify({ url: trap.url }));
  return {
    authFile,
    trap,
    env: {
      HOME: root,
      USERPROFILE: root,
      IMA2_CONFIG_DIR: root,
      IMA2_ADVERTISE_FILE: advertiseFile,
    },
    cleanup: async () => {
      await trap.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function snapshot(dir) {
  const names = await readdir(dir);
  return Promise.all(names.sort().map(async (name) => {
    const info = await stat(join(dir, name));
    return [name, info.mtimeMs, info.size];
  }));
}

describe("CLI help safety", () => {
  it("backfill-thumbs --help leaves generated files unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "ima2-help-safety-"));
    const generated = join(root, "generated");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(generated));
    await writeFile(join(generated, "fixture.png"), "not-a-real-image");
    const before = await snapshot(generated);
    const result = await runCLI(["backfill-thumbs", "--help"], {
      IMA2_CONFIG_DIR: root,
      IMA2_GENERATED_DIR: generated,
    });
    const after = await snapshot(generated);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Usage: ima2 backfill-thumbs/);
    assert.doesNotMatch(result.stdout, /Scanning|Done:/);
    assert.deepEqual(after, before);
    await rm(root, { recursive: true, force: true });
  });

  // #244: grokCmd dispatched login/status/logout before parsing their argv, so
  // 'grok login --help' started a real device-code flow and 'grok logout --help'
  // deleted the stored session.
  it("grok login --help prints help without discovering a server or touching credentials", async () => {
    const fixture = await grokFixture();
    try {
      const result = await runCLI(["grok", "login", "--help"], fixture.env);
      assert.equal(result.timedOut, false, "help must not block on device-code polling");
      assert.equal(result.code, 0);
      assert.match(result.stdout, /ima2 grok login/);
      assert.doesNotMatch(result.stdout, /enter the code/);
      assert.equal(fixture.trap.requests, 0, "help must not reach a running server");
      assert.equal(await readFile(fixture.authFile, "utf8"), SENTINEL_CREDENTIALS);
    } finally {
      await fixture.cleanup();
    }
  });

  it("grok logout --help prints help and leaves the stored session in place", async () => {
    const fixture = await grokFixture();
    try {
      const result = await runCLI(["grok", "logout", "--help"], fixture.env);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /ima2 grok logout/);
      assert.doesNotMatch(result.stdout, /Removed the stored/);
      assert.equal(await readFile(fixture.authFile, "utf8"), SENTINEL_CREDENTIALS);
    } finally {
      await fixture.cleanup();
    }
  });

  it("grok status -h prints help instead of the stored session", async () => {
    const fixture = await grokFixture();
    try {
      const result = await runCLI(["grok", "status", "-h"], fixture.env);
      assert.equal(result.timedOut, false);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /ima2 grok status/);
      assert.doesNotMatch(result.stdout, /expires:/);
      assert.doesNotMatch(result.stdout, /sentinel@example\.test/);
    } finally {
      await fixture.cleanup();
    }
  });
  // Same contract for the ChatGPT session: help must never start a login (which would
  // bind localhost:1455 and open a browser) or delete ima2's stored session.
  for (const argv of [["gpt", "login", "--help"], ["gpt", "logout", "--help"], ["login", "--help"], ["gpt", "--help"]]) {
    it(`${argv.join(" ")} prints help without logging in or out`, async () => {
      const fixture = await grokFixture();
      const gptFile = join(fixture.env.IMA2_CONFIG_DIR, "chatgpt-auth.json");
      await writeFile(gptFile, SENTINEL_CREDENTIALS);
      try {
        const result = await runCLI(argv, fixture.env);
        assert.equal(result.timedOut, false, "help must not wait for a login callback");
        assert.equal(result.code, 0);
        assert.match(result.stdout, /ima2 gpt|ima2 login/);
        assert.doesNotMatch(result.stdout, /Usage: ima2 <command>/);
        assert.equal(fixture.trap.requests, 0, "help must not reach a running server");
        assert.equal(await readFile(gptFile, "utf8"), SENTINEL_CREDENTIALS);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
