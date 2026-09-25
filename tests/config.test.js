// tests/config.test.js — verify config module loads defaults, honors env overrides,
// and exposes the shape promised by 0.09.12 PRD.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_JS = join(ROOT, "config.ts");
const CONFIG_URL = pathToFileURL(CONFIG_JS).href;

// Run a small node inline program with a custom env and capture JSON output so
// we can assert independent of whatever env the test host has set.
function loadConfig(env = {}) {
  const script = `
    import("${CONFIG_URL}").then((m) => {
      const c = m.config;
      // Serialize Set separately.
      process.stdout.write(JSON.stringify({
        server: c.server,
        limits: c.limits,
        history: c.history,
        oauth: { ...c.oauth, validModeration: [...c.oauth.validModeration] },
        imageModels: {
          ...c.imageModels,
          valid: [...c.imageModels.valid],
          unsupported: [...c.imageModels.unsupported],
        },
        apiProvider: c.apiProvider,
        grokProvider: c.grokProvider,
        styleSheet: c.styleSheet,
        storage: c.storage,
        ids: c.ids,
        inflight: c.inflight,
        trash: c.trash,
        log: c.log,
        features: c.features,
        cardNewsPlanner: c.cardNewsPlanner,
        comfy: c.comfy,
        legacy: { PORT: m.PORT, OAUTH_PORT: m.OAUTH_PORT, BODY_LIMIT: m.BODY_LIMIT, NO_OAUTH_PROXY: m.NO_OAUTH_PROXY },
      }));
    });
  `;
  const res = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    env: { ...process.env, ...env, NODE_ENV: env.NODE_ENV || "test" },
    encoding: "utf-8",
  });
  if (res.status !== 0) throw new Error(`config load failed: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("config exposes default shape", () => {
  const c = loadConfig({
    IMA2_PORT: "",
    PORT: "",
    IMA2_OAUTH_PROXY_PORT: "",
    OAUTH_PORT: "",
    IMA2_NO_OAUTH_PROXY: "",
    IMA2_DEV: "",
    IMA2_LOG_LEVEL: "",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-default",
  });
  assert.equal(c.server.port, 3333);
  assert.equal(c.server.host, "127.0.0.1");
  assert.equal(c.server.bodyLimit, "50mb");
  assert.equal(c.oauth.proxyPort, 10531);
  assert.equal(c.oauth.autoStart, true);
  assert.equal(c.oauth.generationTimeoutMs, 400000);
  assert.ok(c.oauth.researchSuffix.includes("If factual visual accuracy is required"));
  assert.ok(c.oauth.researchSuffix.includes("pass the user's prompt through"));
  assert.equal(c.limits.maxRefCount, 5);
  assert.equal(c.history.defaultPageSize, 50);
  assert.equal(c.history.maxPageCap, 500);
  assert.equal(c.ids.generatedHexBytes, 4);
  assert.equal(c.ids.nodeHexBytes, 5);
  // Raised so the TTL outlives the longest legal request: purgeStaleJobs() drops the job
  // row without aborting its worker, so a 10-minute TTL erased live Grok videos mid-flight.
  // devlog/_plan/260817_grok_video_planner_timeout/010_timeout_budgets.md
  assert.equal(c.inflight.ttlMs, 5400000);
  assert.equal(c.inflight.terminalTtlMs, 300000);
  assert.deepEqual(c.oauth.validModeration.sort(), ["auto", "low"]);
  assert.equal(c.imageModels.default, "gpt-6-luna");
  assert.equal(c.apiProvider.defaultImageModel, "gpt-5.6-luna");
  assert.equal(c.styleSheet.model, "gpt-6-luna");
  assert.equal(c.grokProvider.plannerModel, "grok-4.3");
  assert.equal(c.grokProvider.defaultImageModel, "grok-imagine-image-2.0");
  assert.equal(c.grokProvider.defaultVideoModel, "grok-imagine-video-1.5");
  assert.deepEqual(c.imageModels.valid.sort(), ["gpt-6-astra", "gpt-6-luna", "gpt-6-sol"]);
  assert.deepEqual(c.imageModels.unsupported, []);
  assert.equal(c.features.cardNews, false);
  assert.equal(c.cardNewsPlanner.enabled, true);
  assert.equal(c.cardNewsPlanner.model, "gpt-6-luna");
  assert.equal(c.cardNewsPlanner.timeoutMs, 60000);
  assert.equal(c.cardNewsPlanner.deterministicFallback, false);
  assert.equal(c.comfy.defaultUrl, "http://127.0.0.1:8188");
  assert.equal(c.comfy.uploadTimeoutMs, 30000);
  assert.equal(c.comfy.maxUploadBytes, 50 * 1024 * 1024);
  assert.equal(c.log.level, "info");
});

test("env overrides win", () => {
  const c = loadConfig({
    IMA2_PORT: "4321",
    IMA2_OAUTH_PROXY_PORT: "20000",
    IMA2_OAUTH_GENERATION_TIMEOUT_MS: "123456",
    IMA2_MAX_REF_COUNT: "7",
    IMA2_NO_OAUTH_PROXY: "1",
    IMA2_BODY_LIMIT: "10mb",
    IMA2_GROK_PLANNER_MODEL: "grok-4.3",
    IMA2_STYLE_MODEL: "gpt-5.4-mini",
    IMA2_CARD_NEWS_PLANNER_MODEL: "gpt-5.5",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-env",
  });
  assert.equal(c.server.port, 4321);
  assert.equal(c.oauth.proxyPort, 20000);
  assert.equal(c.oauth.generationTimeoutMs, 123456);
  assert.equal(c.limits.maxRefCount, 7);
  assert.equal(c.oauth.autoStart, false);
  assert.equal(c.server.bodyLimit, "10mb");
  assert.equal(c.grokProvider.plannerModel, "grok-4.3");
  assert.equal(c.styleSheet.model, "gpt-5.4-mini");
  assert.equal(c.cardNewsPlanner.model, "gpt-5.5");
});

test("comfy bridge config env overrides and invalid numeric fallbacks", () => {
  const explicit = loadConfig({
    IMA2_COMFY_URL: "http://localhost:9999",
    IMA2_COMFY_UPLOAD_TIMEOUT_MS: "1234",
    IMA2_COMFY_MAX_UPLOAD_BYTES: "5678",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-comfy-explicit",
  });
  assert.equal(explicit.comfy.defaultUrl, "http://localhost:9999");
  assert.equal(explicit.comfy.uploadTimeoutMs, 1234);
  assert.equal(explicit.comfy.maxUploadBytes, 5678);

  const fallback = loadConfig({
    IMA2_COMFY_UPLOAD_TIMEOUT_MS: "0",
    IMA2_COMFY_MAX_UPLOAD_BYTES: "-1",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-comfy-fallback",
  });
  assert.equal(fallback.comfy.uploadTimeoutMs, 30000);
  assert.equal(fallback.comfy.maxUploadBytes, 50 * 1024 * 1024);
});

test("card news feature is dev-only unless explicitly enabled", () => {
  const off = loadConfig({
    IMA2_DEV: "",
    IMA2_CARD_NEWS: "",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-card-news-off",
  });
  assert.equal(off.features.cardNews, false);

  const dev = loadConfig({
    IMA2_DEV: "1",
    IMA2_CARD_NEWS: "",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-card-news-dev",
  });
  assert.equal(dev.features.cardNews, true);

  const explicit = loadConfig({
    IMA2_DEV: "",
    IMA2_CARD_NEWS: "1",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-card-news-explicit",
  });
  assert.equal(explicit.features.cardNews, true);
});

test("log level defaults show operational progress unless dev mode is enabled", () => {
  const normal = loadConfig({
    IMA2_DEV: "",
    IMA2_LOG_LEVEL: "",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-log-normal",
  });
  assert.equal(normal.log.level, "info");

  const dev = loadConfig({
    IMA2_DEV: "1",
    IMA2_LOG_LEVEL: "",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-log-dev",
  });
  assert.equal(dev.log.level, "debug");

  const explicit = loadConfig({
    IMA2_DEV: "1",
    IMA2_LOG_LEVEL: "error",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-log-explicit",
  });
  assert.equal(explicit.log.level, "error");
});

test("card news planner env overrides win", () => {
  const c = loadConfig({
    IMA2_CARD_NEWS_PLANNER: "0",
    IMA2_CARD_NEWS_PLANNER_MODEL: "gpt-5.5",
    IMA2_CARD_NEWS_PLANNER_TIMEOUT_MS: "12345",
    IMA2_CARD_NEWS_PLANNER_FALLBACK: "1",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-card-news-planner",
  });

  assert.equal(c.cardNewsPlanner.enabled, false);
  assert.equal(c.cardNewsPlanner.model, "gpt-5.5");
  assert.equal(c.cardNewsPlanner.timeoutMs, 12345);
  assert.equal(c.cardNewsPlanner.deterministicFallback, true);
});


test("legacy env alias: PORT falls back when IMA2_PORT absent", () => {
  const c = loadConfig({
    IMA2_PORT: "",
    PORT: "9876",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-legacy",
  });
  assert.equal(c.server.port, 9876);
  assert.equal(c.legacy.PORT, 9876);
});

test("legacy env alias: OAUTH_PORT falls back", () => {
  const c = loadConfig({
    IMA2_OAUTH_PROXY_PORT: "",
    OAUTH_PORT: "11111",
    IMA2_CONFIG_DIR: "/tmp/ima2-test-legacy2",
  });
  assert.equal(c.oauth.proxyPort, 11111);
  assert.equal(c.legacy.OAUTH_PORT, 11111);
});

test("storage paths honor IMA2_CONFIG_DIR", () => {
  const configDir = "/tmp/ima2-custom-xyz";
  const c = loadConfig({ IMA2_CONFIG_DIR: configDir });
  assert.equal(c.storage.configDir, configDir);
  assert.equal(c.storage.configFile, join(configDir, "config.json"));
  assert.ok(c.storage.dbPath.endsWith("sessions.db"));
  assert.equal(c.storage.generatedDir, join(configDir, "generated"));
  assert.equal(c.storage.trashDir, join(configDir, "generated", ".trash"));
});
