import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getUiDistBuildStatus } from "./ui-build.js";
import type { DoctorCheckLine } from "./doctor-checks.js";

const RUNTIME_DEPENDENCIES = ["express", "better-sqlite3", "openai", "@openai/codex/package.json", "zod"];
const REQUIRED_BINS = [["@openai/codex", "codex"]] as const;
const line = (code: string, kind: DoctorCheckLine["kind"], text: string): DoctorCheckLine => ({ code, kind, text, evidence: "local" });

export function parseMinimumNodeMajor(engine: unknown): number {
  if (typeof engine !== "string" || !/^>=[1-9][0-9]*$/.test(engine)) throw Error("ENGINE_REQUIREMENT_INVALID");
  const major = Number(engine.slice(2));
  if (!Number.isSafeInteger(major)) throw Error("ENGINE_REQUIREMENT_INVALID");
  return major;
}

export function checkNodeEngine(version: string, engine: unknown): DoctorCheckLine {
  try {
    const minimum = parseMinimumNodeMajor(engine), match = /^v?([0-9]+)\.[0-9]+\.[0-9]+$/.exec(version);
    const major = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(major) || major < minimum) return line("NODE_RUNTIME_UNSUPPORTED", "fail", `Node runtime requires >=${minimum}`);
    return line("NODE_RUNTIME_OK", "pass", `Node.js ${version} (>=${minimum})`);
  } catch { return line("ENGINE_REQUIREMENT_INVALID", "fail", "Package Node engine requirement is invalid"); }
}

export function missingRuntimeDeps(root: string): string[] {
  const require = createRequire(join(resolve(root), "package.json")), missing: string[] = [];
  for (const dependency of RUNTIME_DEPENDENCIES) {
    try { require.resolve(dependency); } catch { missing.push(dependency.replace(/\/package\.json$/, "")); }
  }
  for (const [name, bin] of REQUIRED_BINS) {
    try {
      let manifestPath: string;
      try { manifestPath = require.resolve(name + "/package.json"); }
      catch {
        let parent = dirname(require.resolve(name));
        while (!existsSync(join(parent, "package.json"))) {
          const next = dirname(parent); if (next === parent) throw Error("MISSING_MANIFEST"); parent = next;
        }
        manifestPath = join(parent, "package.json");
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: unknown; bin?: unknown };
      const entry = typeof manifest.bin === "string" ? manifest.bin
        : manifest.bin && typeof manifest.bin === "object" ? (manifest.bin as Record<string, unknown>)[bin] : undefined;
      if (manifest.name !== name || typeof entry !== "string" || !existsSync(resolve(dirname(manifestPath), entry))) throw Error("MISSING_BIN");
    } catch { if (!missing.includes(name)) missing.push(name); }
  }
  return missing;
}

export function checkNativeBinding(root: string): DoctorCheckLine {
  let db: { close(): void } | undefined;
  try {
    const require = createRequire(join(resolve(root), "package.json"));
    const module = require("better-sqlite3") as { default?: unknown };
    const Database = (module.default ?? module) as new (name: string) => { close(): void };
    db = new Database(":memory:"); db.close(); db = undefined;
    return line("INSTALL_NATIVE_OK", "pass", "better-sqlite3 native binding loads");
  } catch { return line("INSTALL_NATIVE_FAILED", "fail", "better-sqlite3 native binding failed; reinstall the approved package"); }
  finally { try { db?.close(); } catch { /* The failed native check is already reported. */ } }
}

export function checkPackagedSkills(root: string): DoctorCheckLine[] {
  return ["ima2", "ima2-front", "ima2-uiux"].map((name) => existsSync(join(root, "skills", name, "SKILL.md"))
    ? line("INSTALL_SKILLS_OK", "pass", `packaged skill found: ${name}`)
    : line("INSTALL_SKILL_MISSING", "fail", `packaged skill missing: ${name}`));
}

export function buildInstallationDoctorLines(root: string): DoctorCheckLine[] {
  const lines: DoctorCheckLine[] = [];
  try {
    const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { engines?: { node?: unknown } };
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw Error("INSTALL_PACKAGE_MISSING");
    lines.push(line("INSTALL_PACKAGE_OK", "pass", "package.json found"), checkNodeEngine(process.version, metadata.engines?.node));
  } catch { lines.push(line("INSTALL_PACKAGE_MISSING", "fail", "package.json missing or invalid")); }
  const missing = missingRuntimeDeps(root);
  lines.push(missing.length ? line("INSTALL_DEPENDENCY_MISSING", "fail", `Missing runtime dependencies: ${missing.join(", ")}`)
    : line("INSTALL_DEPENDENCIES_OK", "pass", "Runtime dependencies and bins resolve"));
  lines.push(checkNativeBinding(root), ...checkPackagedSkills(root));
  try {
    const ui = getUiDistBuildStatus(root);
    const code = ui.reason === "stale" ? "INSTALL_UI_STALE"
      : ui.reason === "missing" || ui.reason === "missing-source-and-dist" ? "INSTALL_UI_MISSING" : "INSTALL_UI_OK";
    lines.push(line(code, code === "INSTALL_UI_OK" ? "pass" : code === "INSTALL_UI_STALE" ? "warn" : "fail", code));
  } catch { lines.push(line("INSTALL_UI_MISSING", "fail", "UI build could not be inspected")); }
  return lines;
}

export async function probeDoctorRuntime(input: { url: string; expectedVersion: string; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<DoctorCheckLine[]> {
  const result = (code: string, kind: DoctorCheckLine["kind"] = "fail"): DoctorCheckLine[] => [{ code, kind, text: code, evidence: "local-http" }];
  let url: URL;
  try {
    url = new URL(input.url);
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") return result("RUNTIME_ORIGIN_INVALID");
  } catch { return result("RUNTIME_ORIGIN_INVALID"); }
  const timeoutMs = Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? Math.min(input.timeoutMs, 30000) : 1500;
  const controller = new AbortController();
  let timeout!: ReturnType<typeof setTimeout>, response: Response | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(Error("RUNTIME_TIMEOUT")); }, timeoutMs);
  });
  try {
    const work = (async () => {
      response = await (input.fetchImpl ?? fetch)(new URL("/api/health", url), {
        redirect: "error", signal: controller.signal, headers: { Connection: "close" },
      });
      if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return result("RUNTIME_AUTH_REQUIRED", "warn"); }
      if (!response.ok) { await response.body?.cancel(); return result("RUNTIME_INVALID_HEALTH"); }
      let data: unknown;
      try { data = await response.json(); } catch { return result(controller.signal.aborted ? "RUNTIME_TIMEOUT" : "RUNTIME_INVALID_HEALTH"); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return result("RUNTIME_INVALID_HEALTH");
      const health = data as Record<string, unknown>;
      if (health.ok !== true || typeof health.version !== "string" || (health.pid !== undefined && (typeof health.pid !== "number" || !Number.isFinite(health.pid)))) return result("RUNTIME_INVALID_HEALTH");
      return health.version === input.expectedVersion ? result("RUNTIME_READY", "pass") : result("RUNTIME_VERSION_MISMATCH", "warn");
    })();
    return await Promise.race([work, deadline]);
  } catch { return result(controller.signal.aborted ? "RUNTIME_TIMEOUT" : "RUNTIME_UNREACHABLE"); }
  finally { clearTimeout(timeout); controller.abort(); }
}
