import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  corroborateByStartTime,
  escalateKill,
  gracefulStop,
  verifyServerIdentity,
  waitForExit,
  type AdvertiseEntry,
} from "../lib/processControl.js";
import { registerAdminRoutes } from "../routes/admin.js";
import { createTestRuntimeContext } from "../lib/runtimeContext.js";

// devlog/_plan/260821_260821c-stop-service-commands/010: the stop sequence must
// never kill a pid the advertise file merely claims. Identity is verified
// against the live /api/health pid, and mismatches clean the stale file
// instead of signalling an innocent recycled pid (adversarial audit blocker).

function fakeFetch(response: { status?: number; ok?: boolean; json?: unknown }): typeof fetch {
  return (async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.json ?? {},
  })) as unknown as typeof fetch;
}

describe("verifyServerIdentity", () => {
  const entry: AdvertiseEntry = { pid: 4242, port: 3333 };

  test("matching health pid verifies", async () => {
    assert.equal(await verifyServerIdentity(entry, fakeFetch({ json: { pid: 4242 } })), "match");
  });

  test("a different pid answering there is a mismatch, never a kill target", async () => {
    assert.equal(await verifyServerIdentity(entry, fakeFetch({ json: { pid: 9999 } })), "mismatch");
  });

  test("unreachable server yields unreachable, not a guess", async () => {
    const failing = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    assert.equal(await verifyServerIdentity(entry, failing), "unreachable");
  });

  test("an entry without pid or url cannot be verified", async () => {
    assert.equal(await verifyServerIdentity({}, fakeFetch({ json: { pid: 1 } })), "unreachable");
  });
});

describe("gracefulStop", () => {
  test("202 from the admin API is the only success", async () => {
    const entry: AdvertiseEntry = { pid: 1, port: 3333, adminNonce: "n" };
    assert.equal(await gracefulStop(entry, fakeFetch({ status: 202 })), true);
    assert.equal(await gracefulStop(entry, fakeFetch({ status: 401 })), false);
    assert.equal(await gracefulStop(entry, fakeFetch({ status: 403 })), false);
  });

  test("without a nonce the graceful path is skipped entirely", async () => {
    let called = false;
    const spy = (async () => { called = true; return { status: 202 }; }) as unknown as typeof fetch;
    assert.equal(await gracefulStop({ pid: 1, port: 3333 }, spy), false);
    assert.equal(called, false);
  });
});

describe("escalateKill / waitForExit", () => {
  test("a dead pid reports already-dead without signalling", async () => {
    // pid 2^22-ish beyond typical ranges; if alive on this machine the test is
    // still safe because escalateKill only probes with signal 0 first.
    let target = 999999;
    while (isAlive(target) && target < 1000100) target++;
    assert.equal(await escalateKill(target), "already-dead");
  });

  test("waitForExit resolves fast for a dead pid", async () => {
    let target = 999999;
    while (isAlive(target) && target < 1000100) target++;
    const started = Date.now();
    assert.equal(await waitForExit(target, 2000), true);
    assert.ok(Date.now() - started < 500);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("escalateKill ladder on a real child", () => {
  test("SIGTERM stops a cooperative child (term outcome)", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const pid = child.pid!;
    assert.equal(isAlive(pid), true);
    const outcome = await escalateKill(pid, { termMs: 3000, killMs: 2000 });
    assert.equal(outcome, "term");
    assert.equal(isAlive(pid), false);
  });

  test("an owned stubborn child follows native platform termination semantics", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { stdio: "ignore" },
    );
    const pid = child.pid!;
    // give the child a beat to install its SIGTERM handler
    await new Promise((r) => setTimeout(r, 300));
    const outcome = await escalateKill(pid, { termMs: 800, killMs: 3000 });
    assert.equal(outcome, process.platform === "win32" ? "term" : "kill");
    assert.equal(isAlive(pid), false);
  });
});

describe("corroborateByStartTime", () => {
  const now = Date.now();

  test("POSIX agreement corroborates while Windows refuses birth-time inference", () => {
    let called = false;
    assert.equal(
      corroborateByStartTime(1234, now, () => { called = true; return new Date(now + 30_000).toString(); }),
      process.platform === "win32" ? "unknown" : "corroborated",
    );
    assert.equal(called, process.platform !== "win32");
  });

  test("POSIX younger process is recycled while Windows refuses birth-time inference", () => {
    let called = false;
    assert.equal(
      corroborateByStartTime(1234, now - 3_600_000, () => { called = true; return new Date(now).toString(); }),
      process.platform === "win32" ? "unknown" : "recycled",
    );
    assert.equal(called, process.platform !== "win32");
  });

  test("unreadable ps output refuses with unknown, never a guess", () => {
    assert.equal(corroborateByStartTime(1234, now, () => null), "unknown");
    assert.equal(corroborateByStartTime(1234, now, () => "garbage"), "unknown");
    assert.equal(corroborateByStartTime(1234, undefined, () => new Date(now).toString()), "unknown");
  });
});

describe("POST /api/admin/stop gates", () => {
  async function withServer(fn: (base: string, nonce: string) => Promise<void>): Promise<void> {
    const app = express();
    const ctx = createTestRuntimeContext();
    (ctx as { adminNonce: string }).adminNonce = "nonce-under-test";
    registerAdminRoutes(app, ctx);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await fn(base, "nonce-under-test");
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  test("a browser-shaped request (Origin header) is refused even with the nonce", async () => {
    await withServer(async (base, nonce) => {
      const r = await fetch(`${base}/api/admin/stop`, {
        method: "POST",
        headers: { origin: "https://evil.example", "x-ima2-admin-nonce": nonce },
      });
      assert.equal(r.status, 403);
    });
  });

  test("a missing or wrong nonce is refused", async () => {
    await withServer(async (base) => {
      const missing = await fetch(`${base}/api/admin/stop`, { method: "POST" });
      assert.equal(missing.status, 401);
      const wrong = await fetch(`${base}/api/admin/stop`, {
        method: "POST",
        headers: { "x-ima2-admin-nonce": "not-the-nonce" },
      });
      assert.equal(wrong.status, 401);
    });
  });

  test("the correct nonce without an Origin is accepted with 202", async () => {
    // Intercept the self-signal so the test process does not shut down.
    const originalKill = process.kill.bind(process);
    const originalWrite = process.stdout.write.bind(process.stdout);
    const intents: string[] = [];
    // Capture the stop-intent line (and keep it out of the test output).
    (process.stdout as { write: unknown }).write = ((chunk: unknown, ...rest: unknown[]) => {
      if (String(chunk).startsWith("IMA2_STOP_INTENT ")) {
        intents.push(String(chunk));
        const cb = rest.find((x) => typeof x === "function") as (() => void) | undefined;
        cb?.();
        return true;
      }
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    let signalled: string | number | undefined;
    (process as { kill: typeof process.kill }).kill = ((pid: number, sig?: string | number) => {
      if (pid === process.pid && sig === "SIGTERM") {
        signalled = sig;
        return true;
      }
      return originalKill(pid, sig as never);
    }) as typeof process.kill;
    try {
      await withServer(async (base, nonce) => {
        const r = await fetch(`${base}/api/admin/stop`, {
          method: "POST",
          headers: { "x-ima2-admin-nonce": nonce },
        });
        assert.equal(r.status, 202);
        const body = (await r.json()) as { stopping?: boolean };
        assert.equal(body.stopping, true);
        // the self-signal is deferred via setImmediate
        await new Promise((r2) => setTimeout(r2, 50));
        assert.equal(signalled, "SIGTERM");
        // ...and follows the stop-intent line the desktop supervisor reads.
        assert.equal(intents.length, 1);
        assert.match(intents[0]!, /^IMA2_STOP_INTENT \S+\n$/);
      });
    } finally {
      (process as { kill: typeof process.kill }).kill = originalKill;
      (process.stdout as { write: unknown }).write = originalWrite;
    }
  });
});
