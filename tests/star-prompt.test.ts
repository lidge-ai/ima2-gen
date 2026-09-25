import { describe, it } from "node:test";
import assert from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("star prompt", () => {
  it("state path honors IMA2_CONFIG_DIR", async () => {
    const prev = process.env.IMA2_CONFIG_DIR;
    const dir = await mkdtemp(join(tmpdir(), "ima2-star-home-"));
    process.env.IMA2_CONFIG_DIR = dir;
    try {
      const mod = await import(`../bin/lib/star-prompt.js?case=${Date.now()}`);
      assert.strictEqual(mod.starPromptStatePath(), join(dir, "state", "star-prompt.json"));
    } finally {
      if (prev === undefined) delete process.env.IMA2_CONFIG_DIR;
      else process.env.IMA2_CONFIG_DIR = prev;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("starRepo calls gh starred API with hidden Windows console", async () => {
    const { starRepo } = await import("../bin/lib/star-prompt.js");
    let seenCommand = "";
    let seenArgs = [];
    let seenOptions;

    const result = starRepo(((command, args, options) => {
      seenCommand = command;
      seenArgs = args;
      seenOptions = options;
      return {
        status: 0,
        stdout: "",
        stderr: "",
      };
    }) as unknown as typeof import("node:child_process").spawnSync);

    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(seenCommand, "gh");
    assert.deepStrictEqual(seenArgs, ["api", "-X", "PUT", "/user/starred/lidge-ai/ima2-gen"]);
    assert.strictEqual(seenOptions.windowsHide, true);
  });

  it("maybePromptGithubStar skips non-TTY sessions", async () => {
    const { maybePromptGithubStar } = await import("../bin/lib/star-prompt.js");
    let marked = false;

    await maybePromptGithubStar({
      stdinIsTTY: false,
      stdoutIsTTY: true,
      markPromptedFn: async () => { marked = true; },
    });

    assert.strictEqual(marked, false);
  });

  it("maybePromptGithubStar marks once and thanks on successful star", async () => {
    const { maybePromptGithubStar } = await import("../bin/lib/star-prompt.js");
    const logs = [];
    let marked = false;

    await maybePromptGithubStar({
      env: {},
      stdinIsTTY: true,
      stdoutIsTTY: true,
      hasBeenPromptedFn: async () => false,
      isGhInstalledFn: () => true,
      markPromptedFn: async () => { marked = true; },
      askYesNoFn: async () => true,
      starRepoFn: () => ({ ok: true }),
      logFn: (message) => logs.push(message),
    });

    assert.strictEqual(marked, true);
    assert.deepStrictEqual(logs, ["[ima2] Thanks for the star!"]);
  });

  it("maybePromptGithubStar defers to the user when an agent drives the CLI", async () => {
    const { maybePromptGithubStar } = await import("../bin/lib/star-prompt.js");
    const logs = [];
    let marked = false;
    let asked = false;
    let starred = false;

    await maybePromptGithubStar({
      env: { CODEX_THREAD_ID: "019fa50b" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      hasBeenPromptedFn: async () => false,
      isGhInstalledFn: () => true,
      markPromptedFn: async () => { marked = true; },
      askYesNoFn: async () => { asked = true; return true; },
      starRepoFn: () => { starred = true; return { ok: true }; },
      logFn: (message) => logs.push(message),
    });

    // The agent must not answer, and must not spend the user's GitHub identity.
    assert.strictEqual(asked, false);
    assert.strictEqual(starred, false);
    // The one-time state stays unwritten so the user still sees the real prompt.
    assert.strictEqual(marked, false);
    assert.ok(logs.some((line) => line.includes("do not answer this yourself")));
    assert.ok(logs.some((line) => line.includes("Ask the user whether to star")));
  });

  it("isGhInstalled requires an authenticated gh, not just an installed one", async () => {
    const { isGhInstalled } = await import("../bin/lib/star-prompt.js");
    const calls = [];

    const spawnSyncFn = ((_command, args) => {
      calls.push(args.join(" "));
      // `gh --version` succeeds, `gh auth status` reports logged out.
      return args[0] === "--version" ? { status: 0 } : { status: 1 };
    }) as unknown as typeof import("node:child_process").spawnSync;

    assert.strictEqual(isGhInstalled(spawnSyncFn), false);
    assert.deepStrictEqual(calls, ["--version", "auth status"]);
  });

  it("interactiveConfirm answers on arrow keys, y/n, and a bare enter", async () => {
    const { interactiveConfirm } = await import("../bin/lib/interactive-confirm.js");
    const { PassThrough } = await import("node:stream");

    const ask = async (keys, defaultYes = true) => {
      const input = new PassThrough() as unknown as NodeJS.ReadStream & { isRaw: boolean };
      input.isRaw = false;
      input.setRawMode = ((mode: boolean) => { input.isRaw = mode; return input; }) as NodeJS.ReadStream["setRawMode"];
      const output = new PassThrough() as unknown as NodeJS.WriteStream;
      const painted: string[] = [];
      const write = output.write.bind(output);
      output.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
        painted.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
        return write(chunk as string, ...(rest as []));
      }) as NodeJS.WriteStream["write"];

      const pending = interactiveConfirm({ question: "Star it?", defaultYes, input, output });
      for (const key of keys) input.write(key);
      return { answer: await pending, painted: painted.join(""), raw: input.isRaw };
    };

    assert.strictEqual((await ask(["\r"], true)).answer, true);
    assert.strictEqual((await ask(["\r"], false)).answer, false);
    assert.strictEqual((await ask(["\x1b[C", "\r"])).answer, false); // right → No
    assert.strictEqual((await ask(["n"])).answer, false);
    assert.strictEqual((await ask(["y"], false)).answer, true);
    assert.strictEqual((await ask(["\x1b"], true)).answer, false); // escape declines

    const shown = await ask(["\r"]);
    assert.ok(shown.painted.includes("Yes"));
    assert.ok(shown.painted.includes("No"));
    assert.strictEqual(shown.raw, false);
  });
});
