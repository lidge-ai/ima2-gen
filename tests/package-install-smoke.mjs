import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import net from "node:net";
import { parsePackOutput } from "../scripts/release-artifact-contract.mjs";
import { spawnNpmSync } from "../scripts/npm-subprocess.mjs";

function spawnOptions(options) {
  const env = { ...process.env, npm_config_loglevel: "error", ...(options.env || {}) };
  for (const key of Object.keys(env)) if (key.startsWith("IMA2_PACKAGE_UI_")) delete env[key];
  return {
    encoding: "utf8",
    ...options,
    env,
  };
}

function assertSuccess(result, label, args) {
  assert.equal(
    result.status,
    0,
    `${label} ${args.join(" ")} failed\nerror:\n${result.error?.message || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`,
  );
  return result;
}

function run(command, args, options = {}) {
  return assertSuccess(spawnSync(command, args, spawnOptions(options)), command, args);
}

function runNpm(args, options = {}) {
  return assertSuccess(spawnNpmSync(args, spawnOptions(options)), "npm", args);
}

function npmMajor() {
  const version = runNpm(["--version"]).stdout.trim();
  return Number(version.split(".")[0]);
}

function configureProjectInstallPolicy(projectDir) {
  if (npmMajor() < 12) return;
  const packagePath = join(projectDir, "package.json");
  const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
  manifest.allowScripts = {
    "better-sqlite3": true,
    "ima2-gen": true,
    sharp: true,
  };
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not allocate a free port"));
      });
    });
  });
}

async function waitForJson(url, child, logs, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `server exited before ${url} was ready (code ${child.exitCode})\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`,
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message || "unknown"}\nstdout:\n${logs.stdout}\nstderr:\n${logs.stderr}`,
  );
}

function killServer(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1500).unref();
  });
}

test("packaged tarball installs, serves core status routes, and keeps Card News gated", async () => {
  const root = mkdtempSync(join(tmpdir(), "ima2-package-install-"));
  const packDir = join(root, "pack");
  const projectDir = join(root, "project");
  const configDir = join(root, "config");
  const generatedDir = join(root, "generated");
  const homeDir = join(root, "home");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  let child = null;
  try {
    let tarball = process.env.IMA2_PACKAGE_TARBALL;
    const uiOutput = process.env.IMA2_PACKAGE_UI_OUTPUT_DIR;
    let uiIdentity;
    if (uiOutput !== undefined) {
      assert(uiOutput && tarball, "installed UI opt-in requires an output directory and a provided TGZ; no source-pack fallback");
      uiIdentity = JSON.parse(process.env.IMA2_PACKAGE_UI_IDENTITY || "null");
      assert(uiIdentity && ["candidate", "published"].includes(uiIdentity.artifactKind), "missing artifact identity");
      for (const sha of [uiIdentity.sourceSha, uiIdentity.driverSha]) assert.match(sha, /^[0-9a-f]{40}$/);
      assert.equal(uiIdentity.sourceSha, process.env.GITHUB_SHA, "UI product SHA must bind the install smoke");
      assert.equal(uiIdentity.driverSha, process.env.IMA2_PACKAGE_UI_DRIVER_SHA, "driver SHA mismatch");
      assert.equal(uiIdentity.artifactKind, process.env.IMA2_PACKAGE_UI_ARTIFACT_KIND, "artifact kind mismatch");
      mkdirSync(uiOutput, { recursive: true });
      const outputWithinRoot = relative(realpathSync(root), realpathSync(uiOutput));
      assert(outputWithinRoot === ".." || outputWithinRoot.startsWith(`..${sep}`) || isAbsolute(outputWithinRoot), "UI evidence must survive install cleanup");
    }
    if (tarball) {
      assert.equal(existsSync(tarball), true, `provided release tarball should exist: ${tarball}`);
    } else {
      const pack = runNpm(["pack", "--json", "--pack-destination", packDir], {
        cwd: process.cwd(),
      });
      const packManifest = [parsePackOutput(pack.stdout)];
      console.log(JSON.stringify({ kind: "packed-runtime-inventory", name: packManifest[0].name,
        version: packManifest[0].version, files: packManifest[0].files }));
      for (const bundled of ["openai-oauth", "zod"]) {
        assert.ok(packManifest[0].bundled.includes(bundled), `packed artifact should bundle ${bundled}`);
      }
      tarball = join(packDir, packManifest[0].filename);
    }

    runNpm(["init", "-y"], { cwd: projectDir });
    configureProjectInstallPolicy(projectDir);
    runNpm(["install", tarball], { cwd: projectDir });

    const packageRoot = join(projectDir, "node_modules", "ima2-gen");
    const cliPath = join(packageRoot, "bin", "ima2.js");
    const binShim = (name) => join(packageRoot, "node_modules", ".bin", process.platform === "win32" ? `${name}.cmd` : name);
    assert.equal(existsSync(binShim("openai-oauth")), true, "packaged install should include bundled openai-oauth bin");

    const installedRequire = createRequire(join(packageRoot, "package.json"));
    const packageManifest = (packageName) => {
      try {
        return installedRequire.resolve(`${packageName}/package.json`);
      } catch (error) {
        if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
      }
      let current = dirname(installedRequire.resolve(packageName));
      while (true) {
        const candidate = join(current, "package.json");
        if (existsSync(candidate)) {
          const manifest = JSON.parse(readFileSync(candidate, "utf8"));
          if (manifest.name === packageName) return candidate;
        }
        const parent = dirname(current);
        if (parent === current) throw new Error(`Could not locate ${packageName}/package.json`);
        current = parent;
      }
    };
    const packageBin = (packageName, binName) => {
      const manifestPath = packageManifest(packageName);
      const dependencyRoot = dirname(manifestPath);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
      assert.equal(typeof entry, "string", `${packageName} should declare the ${binName} bin`);
      return join(dependencyRoot, entry);
    };
    const oauthBin = packageBin("openai-oauth", "openai-oauth");
    const codexBin = packageBin("@openai/codex", "codex");
    assert.doesNotThrow(() => installedRequire.resolve("zod/v4"));

    const oauthRoot = join(packageRoot, "node_modules", "openai-oauth");
    const oauthPackage = JSON.parse(readFileSync(join(oauthRoot, "package.json"), "utf8"));
    assert.equal(oauthPackage.version, "2.0.0-ima2.1");
    assert.match(oauthPackage.ima2Patch, /serialized refresh/);
    const oauthRuntime = readdirSync(join(oauthRoot, "dist"))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFileSync(join(oauthRoot, "dist", name), "utf8"))
      .join("\n");
    for (const marker of ["createIma2Session", "@openai-oauth/local/auth-file", "compare-before-write"]) {
      assert.ok(oauthRuntime.includes(marker), `installed OAuth runtime should include ${marker}`);
    }
    if (process.env.IMA2_PACKAGE_TARBALL && process.env.GITHUB_SHA) {
      const installedPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
      assert.equal(installedPackage.gitHead, process.env.GITHUB_SHA, "release tarball should embed its source SHA");
    }

    mkdirSync(configDir, { recursive: true });
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ provider: "oauth" }));
    const env = {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      IMA2_CONFIG_DIR: configDir,
      IMA2_GENERATED_DIR: generatedDir,
      IMA2_DB_PATH: join(configDir, "sessions.db"),
      IMA2_ADVERTISE_FILE: join(configDir, "server.json"),
      CODEX_HOME: join(homeDir, ".codex"),
      IMA2_NO_OAUTH_PROXY: "1",
    };
    for (const key of Object.keys(env)) if (key.startsWith("IMA2_PACKAGE_UI_")) delete env[key];

    // The isolated HOME has no xAI session, so the native Grok CLI must still
    // exit 0 and report the signed-out state as JSON.
    const grokStatus = run(process.execPath, [cliPath, "grok", "status", "--json"], { cwd: projectDir, env });
    const grokStatusReport = JSON.parse(grokStatus.stdout);
    assert.equal(typeof grokStatusReport, "object");
    assert.notEqual(grokStatusReport, null);
    assert.equal(Object.hasOwn(grokStatusReport, "auth"), true, "grok status --json should report an auth field");

    const installedVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
    assert.equal(existsSync(join(packageRoot, "bin", "ima2.ts")), false, "installed CLI must not depend on repository TypeScript");
    assert.equal(run(process.execPath, [cliPath, "--version"], { cwd: projectDir, env }).stdout.trim(), installedVersion);
    const installation = run(process.execPath, [cliPath, "doctor", "--installation", "--json"], { cwd: projectDir, env });
    const installationReport = JSON.parse(installation.stdout);
    assert.equal(installationReport.schemaVersion, 1);
    assert.equal(installationReport.mode, "installation");
    assert.equal(installationReport.version, installedVersion);
    assert.equal(installationReport.summary.exitCode, 0);
    assert.equal(installationReport.summary.failed, 0);
    assert.ok(installationReport.checks.some((check) => check.code === "NODE_RUNTIME_OK" && check.kind === "pass"));
    assert.ok(installationReport.checks.every((check) => !check.lane && check.evidence === "local" && check.kind !== "fail"));

    const oauthHelp = run(process.execPath, [oauthBin, "--help"], { cwd: projectDir, env });
    assert.match(oauthHelp.stdout, /openai-oauth|Options/i);

    const codexStatus = spawnSync(process.execPath, [codexBin, "login", "status"], spawnOptions({
      cwd: projectDir,
      env: { ...env, PATH: "" },
    }));
    assert.equal(codexStatus.error, undefined, `package-local Codex should execute: ${codexStatus.error?.message || ""}`);
    assert.equal(codexStatus.status, 1);
    assert.match(`${codexStatus.stdout}\n${codexStatus.stderr}`, /Not logged in/i);

    const status = run(process.execPath, [cliPath, "status"], {
      cwd: projectDir,
      env: { ...env, PATH: "" },
    });
    assert.doesNotMatch(status.stdout, /codex CLI not found/i);
    assert.match(status.stdout, /not logged in/i);

    const doctor = spawnSync(process.execPath, [cliPath, "doctor"], spawnOptions({ cwd: projectDir, env }));
    assert.equal(doctor.status, 1, "doctor should fail when OAuth is configured without a file-backed session");
    assert.match(doctor.stdout, /Doctor/);
    assert.match(doctor.stdout, /runtime dependencies resolvable/);
    assert.match(doctor.stdout, /Storage/);
    assert.match(doctor.stdout, /GPT OAuth has no ChatGPT session; run 'ima2 login'/);

    const port = await freePort();
    const logs = { stdout: "", stderr: "" };
    child = spawn(process.execPath, [cliPath, "serve", "--force"], {
      cwd: packageRoot,
      env: {
        ...env,
        IMA2_PORT: String(port),
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      logs.stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      logs.stderr += chunk.toString();
    });

    const health = await waitForJson(`http://127.0.0.1:${port}/api/health`, child, logs);
    assert.equal(health.ok, true);
    assert.equal(health.provider, "oauth");

    if (uiOutput !== undefined) {
      const { inspectPublishedUi } = await import("../scripts/package-published-ui-smoke.mjs");
      await inspectPublishedUi({ ...uiIdentity, driverSha: process.env.IMA2_PACKAGE_UI_DRIVER_SHA,
        artifactKind: process.env.IMA2_PACKAGE_UI_ARTIFACT_KIND, packageRoot,
        baseUrl: `http://127.0.0.1:${port}`, outputDir: realpathSync(uiOutput) });
    }

    const storage = await waitForJson(
      `http://127.0.0.1:${port}/api/storage/status`,
      child,
      logs,
    );
    assert.equal(storage.ok, true);
    assert.equal(typeof storage.data.generatedDirLabel, "string");

    const cardNewsDefault = await fetch(
      `http://127.0.0.1:${port}/api/cardnews/image-templates`,
    );
    assert.equal(cardNewsDefault.status, 404);

    const advertised = JSON.parse(readFileSync(join(configDir, "server.json"), "utf8"));
    assert.equal(advertised.port, port);

    await killServer(child);
    child = null;

    const cardNewsPort = await freePort();
    const cardNewsLogs = { stdout: "", stderr: "" };
    child = spawn(process.execPath, [cliPath, "serve", "--force"], {
      cwd: packageRoot,
      env: {
        ...env,
        IMA2_CARD_NEWS: "1",
        IMA2_PORT: String(cardNewsPort),
        PORT: String(cardNewsPort),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      cardNewsLogs.stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      cardNewsLogs.stderr += chunk.toString();
    });

    const templates = await waitForJson(
      `http://127.0.0.1:${cardNewsPort}/api/cardnews/image-templates`,
      child,
      cardNewsLogs,
    );
    assert.ok(Array.isArray(templates.templates));
    assert.ok(
      templates.templates.some((template) => template.id === "clean-report-square"),
    );

    const preview = await fetch(
      `http://127.0.0.1:${cardNewsPort}/api/cardnews/image-templates/clean-report-square/preview`,
    );
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type") || "", /image\/png/);
    const previewBytes = await preview.arrayBuffer();
    assert.ok(previewBytes.byteLength > 1000);
  } finally {
    if (child) await killServer(child);
    rmSync(root, { recursive: true, force: true });
  }
});
