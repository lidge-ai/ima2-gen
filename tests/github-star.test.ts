import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ghStarWriteArgs,
  getStarStatus,
  resolveTrustedGh,
  setStarDepsForTests,
  starRepository,
  type StarDeps,
} from "../lib/githubStar.js";
import { createGithubStarHandlers } from "../routes/github.js";
import { isLoopbackPeer } from "../lib/localAccessPolicy.js";

type Answer = number | null;

function fakeDeps(dir: string, answers: { auth?: Answer; probe?: Answer; write?: Answer; missing?: boolean }) {
  const calls: string[] = [];
  let now = 1_000;
  const deps: StarDeps = {
    async runGh(args) {
      calls.push(args.join(" "));
      if (answers.missing) return null;
      if (args[0] === "auth") return { status: answers.auth ?? 0 };
      if (args.includes("PUT")) return { status: answers.write ?? 0 };
      return { status: answers.probe ?? 1 };
    },
    nowMs: () => now,
    statePath: () => join(dir, "state", "star-prompt.json"),
  };
  return { deps, calls, advance: (ms: number) => { now += ms; } };
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return res;
}
const req = (remoteAddress: string) => ({ socket: { remoteAddress } }) as never;

describe("github star state", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ima2-star-")); });
  afterEach(async () => { setStarDepsForTests(null); await rm(dir, { recursive: true, force: true }); });

  it("reports unauthenticated when gh is missing", async () => {
    const { deps } = fakeDeps(dir, { missing: true });
    setStarDepsForTests(deps);
    assert.equal((await getStarStatus(deps)).state, "unauthenticated");
  });

  it("reports unauthenticated when gh is logged out", async () => {
    const { deps, calls } = fakeDeps(dir, { auth: 1 });
    setStarDepsForTests(deps);
    assert.equal((await getStarStatus(deps)).state, "unauthenticated");
    assert.deepEqual(calls, ["auth status --hostname github.com"]);
  });

  it("maps the starred probe to starred / not-starred", async () => {
    const starred = fakeDeps(dir, { probe: 0 });
    setStarDepsForTests(starred.deps);
    assert.equal((await getStarStatus(starred.deps)).state, "starred");
    const notStarred = fakeDeps(dir, { probe: 1 });
    setStarDepsForTests(notStarred.deps);
    assert.equal((await getStarStatus(notStarred.deps)).state, "not-starred");
  });

  it("serves repeat reads from cache within the TTL", async () => {
    const { deps, calls, advance } = fakeDeps(dir, { probe: 1 });
    setStarDepsForTests(deps);
    await getStarStatus(deps);
    advance(60_000);
    await getStarStatus(deps);
    assert.equal(calls.length, 2, "one auth + one probe for both reads");
  });

  it("a successful star marks prompted and later reads skip gh entirely", async () => {
    const { deps, calls } = fakeDeps(dir, { probe: 1 });
    setStarDepsForTests(deps);
    assert.deepEqual(await starRepository(deps), { ok: true });
    const writeCall = calls.find((c) => c.includes("PUT"));
    assert.equal(writeCall, ghStarWriteArgs("github.com").join(" "));
    const before = calls.length;
    const status = await getStarStatus(deps);
    assert.equal(status.state, null);
    assert.equal(status.prompted, true);
    assert.equal(calls.length, before);
    assert.match(await readFile(deps.statePath(), "utf8"), /prompted_at/);
  });

  it("refuses to write while gh is logged out", async () => {
    const { deps, calls } = fakeDeps(dir, { auth: 1 });
    setStarDepsForTests(deps);
    assert.deepEqual(await starRepository(deps), { ok: false, code: "gh_unauthenticated" });
    assert.ok(!calls.some((c) => c.includes("PUT")));
  });

  it("resolves gh only from literal install roots", () => {
    assert.equal(resolveTrustedGh("darwin", (p) => p === "/opt/homebrew/bin/gh"), "/opt/homebrew/bin/gh");
    assert.equal(resolveTrustedGh("linux", () => false), null);
  });
});

describe("github star routes", () => {
  let dir = "";
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ima2-star-route-")); });
  afterEach(async () => { setStarDepsForTests(null); await rm(dir, { recursive: true, force: true }); });

  it("answers loopback peers and refuses LAN peers", async () => {
    const { deps, calls } = fakeDeps(dir, { probe: 1 });
    setStarDepsForTests(deps);
    const handlers = createGithubStarHandlers(deps);
    const local = fakeRes();
    await handlers.status(req("::ffff:127.0.0.1"), local as never);
    assert.equal(local.statusCode, 200);
    assert.equal((local.body as { state: string }).state, "not-starred");

    const before = calls.length;
    for (const handler of [handlers.status, handlers.star, handlers.dismiss]) {
      const lan = fakeRes();
      await handler(req("192.168.0.5"), lan as never);
      assert.equal(lan.statusCode, 403);
      assert.deepEqual(lan.body, { ok: false, code: "LOCAL_ONLY" });
    }
    assert.equal(calls.length, before, "a refused peer never reaches gh");
  });

  it("maps a logged-out star attempt to 409 and dismiss to prompted", async () => {
    const { deps } = fakeDeps(dir, { auth: 1 });
    setStarDepsForTests(deps);
    const handlers = createGithubStarHandlers(deps);
    const star = fakeRes();
    await handlers.star(req("127.0.0.1"), star as never);
    assert.equal(star.statusCode, 409);
    assert.deepEqual(star.body, { ok: false, code: "GH_UNAUTHENTICATED" });
    const dismiss = fakeRes();
    await handlers.dismiss(req("::1"), dismiss as never);
    assert.deepEqual(dismiss.body, { ok: true });
    assert.equal((await getStarStatus(deps)).prompted, true);
  });

  it("recognizes every loopback spelling", () => {
    for (const address of ["127.0.0.1", "127.8.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
      assert.equal(isLoopbackPeer(address), true, address);
    }
    for (const address of ["192.168.0.5", "::ffff:c0a8:5", "10.0.0.1", "", undefined]) {
      assert.equal(isLoopbackPeer(address), false, String(address));
    }
  });
});
