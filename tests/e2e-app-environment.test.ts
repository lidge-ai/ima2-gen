import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { createGuardReport } from "../ui/e2e/fixtures/appGuardReport";
import { makeAppEnv } from "../ui/e2e/fixtures/appIsolation";

const home = "/synthetic/wp09-home";
const stubUrl = "http://127.0.0.1:41234/v1";

function env(overrides: NodeJS.ProcessEnv = {}, withoutMinimaxKey = false) {
  return makeAppEnv(
    {
      PATH: "/synthetic/bin",
      SystemRoot: "C:/synthetic/windows",
      TMPDIR: "/developer/tmp",
      ...overrides,
    },
    { home, stubUrl, mode: "minimax", withoutMinimaxKey },
  );
}

test("maps the explicit isolated environment exactly", () => {
  assert.deepEqual(env(), {
    PATH: "/synthetic/bin",
    SystemRoot: "C:/synthetic/windows",
    TMPDIR: join(home, "tmp"),
    TMP: join(home, "tmp"),
    TEMP: join(home, "tmp"),
    IMA2_CONFIG_DIR: home,
    IMA2_DB_PATH: join(home, "sessions.db"),
    IMA2_GENERATED_DIR: join(home, "generated"),
    IMA2_TRASH_DIR: join(home, "generated/.trash"),
    IMA2_PORT: "0",
    IMA2_HOST: "127.0.0.1",
    IMA2_NO_OAUTH_PROXY: "1",
    IMA2_DISABLE_UPDATE_CHECK: "1",
    IMA2_OAUTH_PROXY_PORT: "41234",
    IMA2_MINIMAX_REGION: "global_en",
    IMA2_MINIMAX_GLOBAL_BASE_URL: stubUrl,
    IMA2_MINIMAX_CN_BASE_URL: stubUrl,
    IMA2_NAI_BASE_URL: "http://127.0.0.1:41234",
    IMA2_NAI_ACCOUNT_BASE_URL: "http://127.0.0.1:41234",
    IMA2_MCP_TOKEN_DIR: join(home, "mcp"),
    IMA2_MCP_SNAPSHOT_DIR: join(home, "mcp/snapshots"),
    IMA2_MCP_PROVIDERS: ",",
    DOTENV_CONFIG_PATH: join(home, "fixture.env"),
    IMA2_E2E_HOME: home,
    IMA2_TEST_HOME: home,
    IMA2_TEST_EXEC_PATH: join(home, "runtime/bin/node"),
    IMA2_TEST_ARGV1: join(home, "runtime/bin/ima2"),
    TSX_DISABLE_CACHE: "1",
    IMA2_E2E_ALLOWED_ORIGIN: "http://127.0.0.1:41234",
    MINIMAX_API_KEY: "e2e-minimax-key",
  });
});

test("keeps mappings and comma-only MCP disabled across every mode", () => {
  for (const mode of ["minimax", "oauth-expired", "minimax-billing"] as const) {
    const result = makeAppEnv({}, { home, stubUrl, mode, withoutMinimaxKey: false });
    assert.equal(result.IMA2_MCP_PROVIDERS, ",");
    assert.equal(result.IMA2_MINIMAX_GLOBAL_BASE_URL, stubUrl);
    assert.equal(result.IMA2_MINIMAX_CN_BASE_URL, stubUrl);
    assert.equal(result.IMA2_OAUTH_PROXY_PORT, "41234");
    assert.equal(result.MINIMAX_API_KEY, "e2e-minimax-key");
  }
});

test("excludes inherited secrets, loaders, proxies and provider defaults", () => {
  const result = env({
    HOME: "/developer/home", USERPROFILE: "C:/developer", CODEX_HOME: "/developer/codex",
    NODE_OPTIONS: "--import loader", NODE_PATH: "/developer/modules",
    HTTPS_PROXY: "http://proxy", HTTP_PROXY: "http://proxy", ALL_PROXY: "http://proxy",
    OPENAI_API_KEY: "openai", XAI_API_KEY: "xai", GEMINI_API_KEY: "gemini",
    GOOGLE_APPLICATION_CREDENTIALS: "/credentials", MINIMAX_API_KEY: "inherited",
    IMA2_CONFIG_DIR: "/developer/config", OAUTH_PORT: "3333",
  });
  for (const key of [
    "HOME", "USERPROFILE", "CODEX_HOME", "NODE_OPTIONS", "NODE_PATH", "HTTPS_PROXY", "HTTP_PROXY",
    "ALL_PROXY", "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
    "OAUTH_PORT",
  ]) assert.equal(result[key], undefined, key);
  assert.equal(result.IMA2_CONFIG_DIR, home);
  assert.notEqual(result.IMA2_CONFIG_DIR, "/developer/config");
  assert.equal(result.MINIMAX_API_KEY, "e2e-minimax-key");
});

test("rejects unsafe stub URLs, including reserved port and URL components", () => {
  for (const hostile of [
    "http://127.0.0.1:3333",
    "http://127.0.0.1:41234?token=secret",
    "http://127.0.0.1:41234#fragment",
    "http://user:pass@127.0.0.1:41234",
    "https://127.0.0.1:41234",
    "http://localhost:41234",
    "http://127.0.0.1:0",
  ]) assert.throws(() => makeAppEnv({}, { home, stubUrl: hostile, mode: "minimax", withoutMinimaxKey: true }));
});

test("omits the synthetic MiniMax key when explicitly disabled", () => {
  assert.equal(env({}, true).MINIMAX_API_KEY, undefined);
});

test("LAN fixture opts in explicitly without inheriting a real token or widening child egress", () => {
  const inherited = { IMA2_LAN_TOKEN: "never-inherit", IMA2_E2E_LAN_BIND: "1", IMA2_PUBLIC_ORIGINS: "never-inherit" };
  assert.equal(env(inherited).IMA2_LAN_TOKEN, undefined);
  assert.equal(env(inherited).IMA2_E2E_LAN_BIND, undefined);
  const result = makeAppEnv(inherited, { home, stubUrl, mode: "minimax", withoutMinimaxKey: true,
    lan: { token: "synthetic-lan", publicOrigins: ["https://localhost:41235"] } });
  assert.equal(result.IMA2_HOST, "0.0.0.0");
  assert.equal(result.IMA2_E2E_LAN_BIND, "1");
  assert.equal(result.IMA2_LAN_TOKEN, "synthetic-lan");
  assert.equal(result.IMA2_PUBLIC_ORIGINS, '["https://localhost:41235"]');
  assert.equal(result.IMA2_E2E_ALLOWED_ORIGIN, "http://127.0.0.1:41234");
});

test("platform refusal IPC accepts only the fixed readonly operation vocabulary", () => {
  const report = createGuardReport(); report.accept({ type: "ima2-e2e-guard-ready", version: 1 });
  report.accept({ type: "ima2-e2e-file-denied", operation: "openSync.platformExecutable", category: "expected-platform-probe" });
  report.accept({ type: "ima2-e2e-file-denied", operation: "promises.readFile.platformLdd", category: "expected-platform-probe" });
  report.accept({ type: "ima2-e2e-file-denied", operation: "readFileSync.platformMaps", category: "expected-platform-probe" });
  assert.deepEqual(report.expectedPlatformProbes, [{ operation: "openSync.platformExecutable" }, { operation: "promises.readFile.platformLdd" }, { operation: "readFileSync.platformMaps" }]);
  assert.deepEqual(report.deniedFilesystem, []); report.assertClean();
  for (const operation of ["writeFileSync.platformLdd", "openSync.platformMaps", "readFile.platformMaps", "openSync.platformKernel", "readFileSync", "openSync.platformLdd.extra"]) {
    const rejected = createGuardReport(); rejected.accept({ type: "ima2-e2e-guard-ready", version: 1 });
    rejected.accept({ type: "ima2-e2e-file-denied", operation, category: "expected-platform-probe" });
    assert.throws(() => rejected.assertClean(), /E2E_GUARD_UNEXPECTED_DENIAL/);
  }
});
