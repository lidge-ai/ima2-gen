import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { spawn } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(process.cwd(), "tests", "tmp");
const TEST_CONFIG = join(TEST_DIR, "config.json");
const FAKE_HOME = mkdtempSync(join(tmpdir(), "ima2-bin-home-"));

function runCLI(args = []) {
  return new Promise<any>((resolve) => {
    const child = spawn("node", ["--import", "tsx", "bin/ima2.ts", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_CONFIG_DIR: TEST_DIR,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

describe("ima2 CLI", () => {
  before(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  });

  after(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    if (existsSync(FAKE_HOME)) rmSync(FAKE_HOME, { recursive: true, force: true });
  });

  it("should show help when no command given", async () => {
    const { stdout } = await runCLI([]);
    assert.ok(stdout.includes("Usage:"), "help should include Usage");
    assert.ok(stdout.includes("serve [--dev]"), "help should mention serve --dev");
    assert.ok(stdout.includes("status"), "help should mention status");
    assert.ok(stdout.includes("doctor"), "help should mention doctor");
  });

  it("should show help with --help", async () => {
    const { stdout, code } = await runCLI(["--help"]);
    assert.strictEqual(code, 0, "--help should exit 0");
    assert.ok(stdout.includes("commands:"), "help should list commands");
    assert.ok(stdout.includes("serve [--dev]"), "help should mention serve --dev");
    assert.ok(stdout.includes("version"), "help should mention version");
    assert.ok(stdout.includes("Generation workflow:"), "help should explain async generation workflow");
    assert.ok(stdout.includes("ima2 ps --json"), "help should point agents to active job monitoring");
  });

  it("should show version with --version", async () => {
    const { stdout, code } = await runCLI(["--version"]);
    assert.strictEqual(code, 0, "--version should exit 0");
    assert.ok(/^\d+\.\d+\.\d+/.test(stdout.trim()), "version should be semver");
  });

  it("should show version with -v", async () => {
    const { stdout, code } = await runCLI(["-v"]);
    assert.strictEqual(code, 0, "-v should exit 0");
    assert.ok(/^\d+\.\d+\.\d+/.test(stdout.trim()), "-v should show semver");
  });

  it("should show status", async () => {
    const { stdout } = await runCLI(["status"]);
    assert.ok(stdout.includes("ima2-gen"), "status should show name");
    assert.ok(stdout.includes("Config file"), "status should mention config");
  });

  it("should run doctor", async () => {
    const { stdout, code } = await runCLI(["doctor"]);
    assert.ok(stdout.includes("Doctor"), "doctor should show header");
    const requiredNode = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).engines.node;
    assert.ok(stdout.includes(requiredNode), "doctor should report package Node requirement");
    assert.ok(stdout.includes("Storage"), "doctor should show storage section");
    assert.ok(stdout.includes("passed") || stdout.includes("failed"), "doctor should show results");
    // doctor exits 0 if all ok, 1 if failures
    assert.ok(code === 0 || code === 1, "doctor should exit 0 or 1");
  });

  it("should show doctor image-probe help without running live probes", async () => {
    const { stdout, code } = await runCLI(["doctor", "image-probe", "--help"]);
    assert.strictEqual(code, 0, "doctor image-probe --help should exit 0");
    assert.ok(stdout.includes("ima2 doctor image-probe"), "help should mention image-probe command");
    assert.ok(stdout.includes("--matrix"), "help should document matrix probes");
    assert.ok(stdout.includes("base64 image data"), "help should document redaction");
  });

  it("should redact credential URLs from doctor image-probe JSON failures", async () => {
    const { stdout, code } = await runCLI([
      "doctor",
      "image-probe",
      "--json",
      "--oauth-url",
      "http://user:pass@127.0.0.1:9",
      "--timeout-ms",
      "100",
    ]);
    assert.strictEqual(code, 1, "failed probes should exit 1");
    assert.doesNotMatch(stdout, /user:pass/, "JSON output must not echo URL credentials");
    const parsed = JSON.parse(stdout);
    // GPT OAuth runs one plan-then-render lane probe.
    assert.equal(parsed.summary.failed, 1);
    assert.ok(parsed.probes.every((probe) => !String(probe.error?.message || "").includes("user:pass")));
  });

  it("should redact malformed API key material from doctor image-probe JSON failures", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG, JSON.stringify({ provider: "api", apiKey: "sk-test\nSECRET" }));
    try {
      const { stdout, code } = await runCLI(["doctor", "image-probe", "--json", "--timeout-ms", "100"]);
      assert.strictEqual(code, 1, "failed probes should exit 1");
      assert.doesNotMatch(stdout, /SECRET|sk-test/, "JSON output must not echo malformed API key material");
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.summary.failed, 3);
      assert.ok(parsed.probes.every((probe) => probe.error?.code === "AUTH_API_KEY_INVALID"));
      assert.ok(parsed.probes.every((probe) => !/SECRET|sk-test/.test(String(probe.error?.message || ""))));
    } finally {
      writeFileSync(TEST_CONFIG, "{}");
    }
  });

  it("should handle unknown command", async () => {
    const { stdout, code } = await runCLI(["foobar"]);
    assert.strictEqual(code, 1, "unknown command should exit 1");
    assert.ok(stdout.includes("Unknown command"), "should report unknown");
  });

  it("should reset config file", async () => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(TEST_CONFIG, JSON.stringify({ provider: "api", apiKey: "test" }));
    assert.ok(existsSync(TEST_CONFIG));

    const child = spawn("node", ["--import", "tsx", "bin/ima2.ts", "reset", "--yes"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: FAKE_HOME,
        USERPROFILE: FAKE_HOME,
        IMA2_CONFIG_DIR: TEST_DIR,
      },
    });
    await new Promise<any>((resolve) => child.on("close", resolve));

    // reset now honors IMA2_CONFIG_DIR → file content is `{}`
    const { readFileSync } = await import("fs");
    const content = readFileSync(TEST_CONFIG, "utf-8");
    assert.strictEqual(content.trim(), "{}", "reset should empty config file");
  });

  it("should reject invalid command", async () => {
    const { stdout } = await runCLI(["invalid"]);
    assert.ok(stdout.includes("Unknown command"), "invalid cmd shows error");
  });
});
