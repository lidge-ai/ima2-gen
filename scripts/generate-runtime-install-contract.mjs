import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INSTALL_START = "# runtime-contract:generated:start";
const INSTALL_END = "# runtime-contract:generated:end";
const DOC_START = "<!-- runtime-install:generated:start -->";
const DOC_END = "<!-- runtime-install:generated:end -->";
const INSTALLERS = ["install-mac.sh", "install-linux.sh", "install-windows.ps1"];
const DOCS = ["README.md", "docs/README.ko.md", "docs/README.ja.md", "docs/README.zh-CN.md", "docs/README.zh-TW.md", "AGENTS.md", "structure/06-infra-operations.md"];

function text(root, path) { return readFileSync(join(root, path), "utf8"); }
function replaceRegion(value, start, end, body, path) {
  const first = value.indexOf(start), last = value.indexOf(end);
  if (first < 0 || last < 0 || last < first || value.indexOf(start, first + start.length) >= 0 || value.indexOf(end, last + end.length) >= 0) {
    throw new Error(`MARKERS_INVALID:${path}`);
  }
  return `${value.slice(0, first)}${start}\n${body}\n${end}${value.slice(last + end.length)}`;
}
function mdTable(contract) {
  return ["| Contract | Value |", "|---|---|", `| Node engine | \`${contract.engine}\` |`, `| npm toolchain | \`${contract.packageManager}\` |`, `| Release Node | \`${contract.releaseNode}\` |`, `| CLI entry | \`${contract.cli}\` |`, `| OpenAI SDK | \`${contract.openaiSdk}\` |`, `| Express | \`${contract.express}\` |`].join("\n");
}

export async function readRuntimeInstallContract(root) {
  const packageRoot = resolve(root);
  let manifest;
  try { manifest = JSON.parse(text(packageRoot, "package.json")); } catch { throw new Error("PACKAGE_METADATA_INVALID"); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("PACKAGE_METADATA_INVALID");
  const engine = manifest.engines?.node;
  if (typeof engine !== "string" || !engine) throw new Error("ENGINE_REQUIREMENT_INVALID");
  const nodeVersion = text(packageRoot, ".node-version").trim().replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) throw new Error("RELEASE_NODE_INVALID");
  if (typeof manifest.packageManager !== "string" || !/^npm@[0-9]+\.[0-9]+\.[0-9]+$/.test(manifest.packageManager)) throw new Error("PACKAGE_MANAGER_INVALID");
  const cli = manifest.bin?.ima2;
  if (typeof cli !== "string" || !cli || /[|\r\n]/.test(cli)) throw new Error("CLI_ENTRY_INVALID");
  for (const [name, value] of [["engine", engine], ["packageManager", manifest.packageManager], ["releaseNode", nodeVersion], ["openaiSdk", manifest.dependencies?.openai], ["express", manifest.dependencies?.express]]) {
    if (typeof value !== "string" || !value || /[|\r\n]/.test(value)) throw new Error(`${name.toUpperCase()}_INVALID`);
  }
  const { parseMinimumNodeMajor } = await import(new URL("../bin/lib/doctor-runtime.ts", import.meta.url).href);
  const minimumNodeMajor = parseMinimumNodeMajor(engine);
  return { engine, minimumNodeMajor, packageManager: manifest.packageManager, releaseNode: nodeVersion,
    cli, openaiSdk: manifest.dependencies.openai, express: manifest.dependencies.express };
}

export async function projectRuntimeInstallContract(root, { check = false } = {}) {
  const packageRoot = resolve(root), contract = await readRuntimeInstallContract(packageRoot);
  const changes = [];
  const outputs = new Map();
  for (const name of INSTALLERS) {
    const path = `scripts/${name}`, source = text(packageRoot, path);
    const marker = name.endsWith(".ps1") ? `$MIN_NODE = ${contract.minimumNodeMajor}` : `MIN_NODE=${contract.minimumNodeMajor}`;
    outputs.set(path, replaceRegion(source, INSTALL_START, INSTALL_END, marker, path));
  }
  for (const path of DOCS) outputs.set(path, replaceRegion(text(packageRoot, path), DOC_START, DOC_END, mdTable(contract), path));
  for (const name of INSTALLERS) outputs.set(`site/public/${name}`, outputs.get(`scripts/${name}`));
  for (const [path, value] of outputs) if (value !== text(packageRoot, path)) changes.push(path);
  if (!check) for (const [path, value] of outputs) if (value !== text(packageRoot, path)) writeFileSync(join(packageRoot, path), value);
  return { changedPaths: changes.sort() };
}

function usage() { console.error("usage: node generate-runtime-install-contract.mjs [--root DIR] [--check]"); }
async function main(argv) {
  let root = process.cwd(), check = false;
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--root" && argv[i + 1] && !argv[i + 1].startsWith("--")) root = argv[++i]; else if (argv[i] === "--check") check = true; else return usage(), 2; }
  try { const result = await projectRuntimeInstallContract(root, { check }); if (check && result.changedPaths.length) { console.error(`runtime install projection stale: ${result.changedPaths.join(", ")}`); return 1; } console.log(JSON.stringify(result)); return 0; }
  catch (error) { console.error(error instanceof Error ? error.message : "RUNTIME_INSTALL_CONTRACT_INVALID"); return 2; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
