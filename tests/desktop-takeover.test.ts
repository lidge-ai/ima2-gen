import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stopArgs, takeOver } from "../desktop/lib/takeover.mjs";

const approved = (extra: Record<string, unknown> = {}, rt: Record<string, unknown> = {}) => ({ liveness: "live", stoppable: true, serviceOwnership: "unmanaged", runtime: { pid: 4242, url: "http://127.0.0.1:1", bootId: "b1", startedAt: 7, ...rt }, ...extra });
const quiet = { attempts: 5, needed: 3, delayMs: 1 };
const stopOk = { ok: true, report: { ok: true, runtimeDown: true } };

describe("takeover", () => {
  it("stops exactly the approved server and waits for silence", async () => {
    const calls: string[][] = [];
    const result = await takeOver({ approved: approved(), quiet, resolve: async () => ({ ok: true, status: approved() }), stop: async (args: string[]) => { calls.push(args); return stopOk; }, probe: async () => "refused" });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [["stop", "--json", "--expect-pid", "4242", "--expect-boot", "b1"]]);
  });

  it("refuses before stopping when the server changed", async () => {
    let stopped = false;
    const result = await takeOver({ approved: approved(), quiet, resolve: async () => ({ ok: true, status: approved({}, { bootId: "b2" }) }), stop: async () => { stopped = true; return stopOk; }, probe: async () => "refused" });
    assert.equal(result.ok, false);
    assert.equal(stopped, false);
  });

  it("never calls stop for a server it cannot stop safely", async () => {
    let stopped = false;
    const stop = async () => { stopped = true; return stopOk; };
    for (const bad of [approved({ stoppable: false }), approved({ serviceOwnership: "unknown" })]) {
      assert.equal((await takeOver({ approved: bad, quiet, resolve: async () => ({ ok: true, status: bad }), stop, probe: async () => "refused" })).ok, false);
    }
    assert.equal(stopped, false);
  });

  it("fails when the stop is refused or the port keeps answering", async () => {
    const refused = await takeOver({ approved: approved(), quiet, resolve: async () => ({ ok: true, status: approved() }), stop: async () => ({ ok: true, report: { ok: false, runtimeDown: false, message: "service-managed" } }), probe: async () => "refused" });
    assert.equal(refused.ok, false);
    const loud = await takeOver({ approved: approved(), quiet, resolve: async () => ({ ok: true, status: approved() }), stop: async () => stopOk, probe: async () => "answered" });
    assert.match(loud.reason, /still answers/);
  });

  it("uses the start time for pre-upgrade servers and --service for managed ones", () => {
    assert.deepEqual(stopArgs(approved({ serviceOwnership: "managed" }, { bootId: null })), ["stop", "--json", "--expect-pid", "4242", "--expect-started", "7", "--service"]);
  });

  it("a cancellation during the re-check stops nothing", async () => {
    let cancelled = false;
    let stopped = false;
    const result = await takeOver({ approved: approved(), quiet, cancelled: () => cancelled, resolve: async () => { cancelled = true; return { ok: true, status: approved() }; }, stop: async () => { stopped = true; return stopOk; }, probe: async () => "refused" });
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(stopped, false);
  });
});
