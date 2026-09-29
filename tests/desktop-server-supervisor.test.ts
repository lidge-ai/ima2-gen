import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerSupervisor } from "../desktop/lib/server.mjs";

// devlog/_plan/260929_background_runtime/030 + 040: the supervisor asks the
// bundled CLI first, and restarts only a bundled child that crashed.

type Child = EventEmitter & { pid: number; stdout: PassThrough; stderr: PassThrough; exitCode: number | null; kill: () => boolean; env: Record<string, string> };

const SETTINGS = { port: 3333, existingServer: "ask", nodeBinary: "/fake/node", configDir: "", devLogging: false };
const statusRun = (doc: Record<string, unknown>, code: number) => ({ code, stdout: JSON.stringify({ schema: "ima2-status/1", manager: { state: "absent" }, serviceOwnership: "unmanaged", stoppable: false, runtime: null, ...doc }), stderr: "" });
const ABSENT = statusRun({ liveness: "absent-proven" }, 3);
const NATIVE = statusRun({ liveness: "live", stoppable: true, runtime: { pid: 4242, url: "http://127.0.0.1:1", bootId: "native", startedAt: 1, launcher: "foreground", root: "/elsewhere" } }, 0);
const STOPPED = { code: 0, stdout: JSON.stringify({ schema: "ima2-stop/1", ok: true, outcome: "stopped", runtimeDown: true }), stderr: "" };

function harness(cliAnswers: Array<{ code: number | null; stdout: string; stderr: string }>, extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ima2-supervisor-"));
  const children: Child[] = [];
  const cliCalls: string[][] = [];
  const spawnFn = (_bin: string, _args: string[], opts: { env: Record<string, string> }) => {
    const c = Object.assign(new EventEmitter(), { pid: 9000 + children.length, stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, kill: () => true, env: opts.env }) as Child;
    children.push(c);
    return c;
  };
  const runCli = async (args: string[]) => { cliCalls.push(args); return cliAnswers.length > 1 ? cliAnswers.shift()! : cliAnswers[0]!; };
  const sup = new ServerSupervisor({ rootDir: dir, logFile: join(dir, "server.log"), isPackaged: false, spawnFn: spawnFn as never, runCli, probe: async () => "refused", ...extra });
  const cleanup = async () => {
    const stream = (sup as unknown as { logStream: { end: (cb: () => void) => void } | null }).logStream;
    if (stream) await new Promise<void>((r) => stream.end(() => r()));
    sup.dispose();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };
  return { sup, children, cliCalls, cleanup };
}

function exit(c: Child, code: number | null, signal: string | null = null) {
  c.exitCode = code;
  c.stdout.end();
  c.stderr.end();
  c.emit("exit", code, signal);
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function running(h: ReturnType<typeof harness>) {
  await h.sup.start(SETTINGS);
  const c = h.children[0]!;
  c.stdout.write("Image Gen running at http://127.0.0.1:1\n");
  await tick();
  assert.equal(h.sup.state, "running");
  return c;
}

describe("ServerSupervisor", () => {
  it("does not restart a server stopped on request, even when the marker is split", async () => {
    const h = harness([ABSENT]);
    try {
      const c = await running(h);
      const marker = `IMA2_STOP_INTENT ${c.env.IMA2_BOOT_ID}\n`;
      c.stdout.write(marker.slice(0, 10));
      c.stdout.write(marker.slice(10));
      exit(c, 0);
      await tick(1300);
      assert.equal(h.sup.state, "stopped");
      assert.equal(h.sup.snapshot().stoppedBy, "cli");
      assert.equal(h.children.length, 1, "no respawn");
    } finally {
      await h.cleanup();
    }
  });

  it("restarts after an external SIGTERM (exit 0 without marker), a foreign marker, or a crash", async () => {
    for (const [label, line, code] of [["no marker", "", 0], ["foreign boot", "IMA2_STOP_INTENT 00000000-0000-4000-8000-000000000000\n", 0], ["crash", "", 1]] as const) {
      const h = harness([ABSENT]);
      try {
        const c = await running(h);
        if (line) c.stdout.write(line);
        exit(c, code);
        await tick(1300);
        assert.equal(h.children.length, 2, `${label}: respawned`);
      } finally {
        await h.cleanup();
      }
    }
  });

  it("blocks without spawning when the bundled CLI cannot answer", async () => {
    const h = harness([{ code: null, stdout: "", stderr: "", error: "spawn ENOENT" } as never]);
    try {
      await h.sup.start(SETTINGS);
      assert.equal(h.sup.state, "error");
      assert.equal(h.children.length, 0);
      assert.match(h.sup.lastError, /ENOENT/);
    } finally {
      await h.cleanup();
    }
  });

  it("attaches as a guest when the user keeps the running server", async () => {
    const h = harness([NATIVE], { askTakeover: async () => ({ approve: false }) });
    try {
      await h.sup.start(SETTINGS);
      const snap = h.sup.snapshot();
      assert.equal(snap.state, "running");
      assert.equal(snap.ownership, "guest");
      assert.equal(snap.guest.pid, 4242);
      assert.equal(snap.guest.launcher, "foreground");
      assert.equal(h.children.length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("takes over after approval: identity-guarded stop, then the bundled spawn", async () => {
    const h = harness([NATIVE, NATIVE, STOPPED], { askTakeover: async () => ({ approve: true }) });
    try {
      await h.sup.start(SETTINGS);
      assert.deepEqual(h.cliCalls[2], ["stop", "--json", "--expect-pid", "4242", "--expect-boot", "native"]);
      assert.equal(h.children.length, 1);
      assert.equal(h.children[0]!.env.IMA2_DESKTOP, "1");
    } finally {
      await h.cleanup();
    }
  });

  it("switches to the bundled server on demand from a guest session", async () => {
    const h = harness([NATIVE, NATIVE, STOPPED], { askTakeover: async () => ({ approve: false }) });
    try {
      await h.sup.start(SETTINGS);
      assert.equal((h.sup as unknown as { ownership: string }).ownership, "guest");
      await h.sup.useBundledServer(SETTINGS);
      assert.equal(h.children.length, 1);
    } finally {
      await h.cleanup();
    }
  });

  it("waits for an active login service instead of racing it", async () => {
    const starting = statusRun({ liveness: "absent-proven", manager: { state: "bound", kind: "launchd", pid: null, active: true } }, 3);
    const h = harness([starting, NATIVE], { askTakeover: async () => ({ approve: false }) });
    try {
      await h.sup.start(SETTINGS);
      assert.equal((h.sup as unknown as { ownership: string }).ownership, "guest");
      assert.equal(h.children.length, 0);
    } finally {
      await h.cleanup();
    }
  });

  it("a stop during a pending prompt retires that startup: nothing is spawned later", async () => {
    let answer!: (v: { approve: boolean }) => void;
    const h = harness([NATIVE, NATIVE, STOPPED], { askTakeover: () => new Promise((r) => { answer = r; }) });
    try {
      const pending = h.sup.start(SETTINGS);
      await tick();
      await h.sup.stop();
      answer({ approve: true });
      await pending;
      await tick();
      assert.equal(h.children.length, 0);
      assert.equal(h.sup.state, "stopped");
    } finally {
      await h.cleanup();
    }
  });

  it("a previous child's delayed exit does not clear its replacement", async () => {
    // (see also: stop during takeover, below)
    const h = harness([ABSENT]);
    try {
      const first = await running(h);
      const stopping = h.sup.stop();
      await tick();
      // Exit without ending stdout: the supervisor waits up to 500 ms for the last chunk.
      first.exitCode = 0;
      first.emit("exit", 0, null);
      await stopping;
      await h.sup.start(SETTINGS);
      const second = h.children[1]!;
      await tick(700);
      assert.equal((h.sup as unknown as { child: unknown }).child, second);
      assert.equal(h.children.length, 2);
    } finally {
      await h.cleanup();
    }
  });

  it("an unterminated stop-intent line at exit is not a stop intent", async () => {
    const h = harness([ABSENT]);
    try {
      const c = await running(h);
      c.stdout.write(`IMA2_STOP_INTENT ${c.env.IMA2_BOOT_ID}`);
      exit(c, 0);
      await tick(1300);
      assert.equal(h.children.length, 2, "treated as an unrequested exit and respawned");
    } finally {
      await h.cleanup();
    }
  });

  it("a stop while takeover re-checks the server never runs the CLI stop", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let call = 0;
    const h = harness([NATIVE], { askTakeover: async () => ({ approve: true }) });
    (h.sup as unknown as { runCli: unknown }).runCli = async (args: string[]) => {
      h.cliCalls.push(args);
      call += 1;
      if (call === 2) await gate; // the takeover's fresh status check
      return args[0] === "stop" ? STOPPED : NATIVE;
    };
    try {
      const pending = h.sup.start(SETTINGS);
      await tick();
      await h.sup.stop();
      release();
      await pending;
      assert.equal(h.cliCalls.filter((a) => a[0] === "stop").length, 0);
      assert.equal(h.children.length, 0);
    } finally {
      await h.cleanup();
    }
  });
});
