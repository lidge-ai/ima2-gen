// Host conditions that failed tests on a Windows machine while dev was green on CI.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { usablePathDirectory } from "./_videoFfmpegFixture.ts";

test("a PATH entry that cannot be read offers no ffmpeg; it is not an error of the test", () => {
  const failing = (code: string) => () => { throw Object.assign(new Error(code + ": unknown error, stat"), { code }); };
  // Windows reports UNKNOWN for a PATH entry that is a link Node cannot follow (an installed app's bin link).
  for (const code of ["UNKNOWN", "ENOENT", "EACCES", "EPERM", "ELOOP"]) assert.equal(usablePathDirectory("C:\\apps\\tool\\bin", failing(code)), false, code);
  assert.equal(usablePathDirectory("/usr/bin", () => ({ isDirectory: () => true })), true);
  assert.equal(usablePathDirectory("/usr/bin/env", () => ({ isDirectory: () => false })), false, "a file on PATH is not a directory to search");
  assert.equal(usablePathDirectory(process.cwd()), true, "the real check, on a directory that exists");
  assert.equal(usablePathDirectory(process.cwd() + "/no-such-directory-for-this-test"), false);
});
