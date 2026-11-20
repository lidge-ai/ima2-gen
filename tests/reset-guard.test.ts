import "./helpers/resetTestGuard.ts";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sentinelCount } from "./helpers/resetTestGuard.ts";
import { fakeResetTransport } from "./helpers/fakeResetTransport.ts";
import { dispatchReset } from "../lib/reset/dispatch.ts";
import { CODEX_CONSUME_URL, realResetTransport } from "../lib/reset/transport.ts";

after(() => assert.equal(sentinelCount(), 0));
describe("consumption guard controls", () => {
  it("blocks real transport before a socket", async () => {
    await assert.rejects(dispatchReset(realResetTransport, CODEX_CONSUME_URL, {}), /CONSUME_DISABLED/);
    assert.equal(sentinelCount(), 0);
  });
  it("counts fake calls independently", async () => {
    const fake = fakeResetTransport({ ok: true });
    assert.deepEqual(await dispatchReset(fake, "fixture", {}), { ok: true });
    assert.equal(fake.calls.length, 1);
  });
  it("keeps consume URLs in the transport module", () => {
    const find = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? find(path) : /\.ts$/.test(path) ? [path] : [];
    });
    const matches = ["lib", "routes"].flatMap(find).filter((file) =>
      readFileSync(file, "utf8").includes("rate-limit-reset-credits/consume"));
    assert.deepEqual(matches, ["lib/reset/transport.ts"]);
  });
});
