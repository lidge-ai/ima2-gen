import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keysFrom, parseFlags, loadPorts } from "./api88Demo.ts";
import { recordFetch, saveJson } from "./api88DemoRecord.ts";

type HistoryRow = { filename: string; provider: string; model: string; kind: string;
  prompt: string; createdAt: number };
function assertPackageConfigSafe(): void {
  const path = new URL("../.ima2/config.json", import.meta.url);
  if (!existsSync(path)) return;
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error("DEMO_PACKAGE_CONFIG_INVALID"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEMO_PACKAGE_CONFIG_INVALID");
  const config = value as Record<string, unknown>;
  const forbidden = ["apiKey", "xaiApiKey", "geminiApiKey", "atlasCloudApiKey",
    "minimaxApiKey", "naiApiKey", "vertexServiceAccountJson"];
  if (forbidden.some(name => Boolean(config[name]))) throw new Error("DEMO_PACKAGE_CREDENTIALS_PRESENT");
}
async function readJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(base + path, { method: "GET", headers: { origin: base },
    signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("DEMO_PREVIEW_READ_FAILED");
  return response.json();
}
async function verifyGallery(base: string, dir: string, secrets: string[]): Promise<void> {
  const names = ["01-generation.png", "02-edit.png", "03-gemini.png", "04-grok.mp4"]
    .map(name => "api88-demo-" + name);
  const found = new Map<string, HistoryRow>();
  let cursor = "";
  for (let pageNumber = 0; pageNumber < 1000 && found.size < names.length; pageNumber++) {
    const page = await readJson(base, "/api/history?limit=100" + cursor) as {
      items: HistoryRow[]; nextCursor: { before: number; beforeFilename: string } | null };
    for (const row of page.items) if (names.includes(row.filename)) found.set(row.filename, row);
    if (!page.nextCursor) break;
    cursor = `&before=${page.nextCursor.before}&beforeFilename=${encodeURIComponent(page.nextCursor.beforeFilename)}`;
  }
  if (found.size !== names.length) throw new Error("DEMO_PREVIEW_GALLERY_MISSING");
  for (const name of names) {
    const sidecar = JSON.parse(readFileSync(join(process.env.IMA2_GENERATED_DIR!, name + ".json"), "utf8")) as HistoryRow;
    const row = found.get(name)!;
    if (row.provider !== "88api" || row.model !== sidecar.model || row.kind !== sidecar.kind
        || row.prompt !== sidecar.prompt || row.createdAt !== sidecar.createdAt)
      throw new Error("DEMO_PREVIEW_GALLERY_PROVENANCE");
  }
  saveJson(join(dir, "server-gallery.masked.json"), [...found.values()], secrets);
}
async function main(): Promise<void> {
  process.umask(0o077);
  parseFlags(["--run"], process.env);
  if (!process.send || !process.env.IMA2_CONFIG_DIR || !process.env.HOME) throw new Error("DEMO_SERVER_CHILD_ONLY");
  const keys = keysFrom(process.env, {});
  const secrets = [keys.image, keys.video];
  const dir = dirname(process.env.HOME);
  const { api88Origin } = await import("../lib/api88/origin.ts");
  const recorder = recordFetch(dir, api88Origin(keys.baseUrl), secrets, "server-requests.masked.json", false);
  try {
    assertPackageConfigSafe();
    const { config } = await import("../config.ts");
    config.mcp.enabledProviders = [];
    const { startServer } = await import("../server.ts");
    const { ctx } = await startServer();
    const ports = await loadPorts();
    const imageIds = await ports.catalog(ctx, "image");
    const videoIds = await ports.catalog(ctx, "video");
    if (!imageIds.includes("gpt-image-2") || !videoIds.includes("grok-imagine-video-1.5")
        || recorder.rows.some(row => row.endpoint.endsWith("/v1/models") &&
          (row.status === null || row.status >= 400 || row.state === "failed")))
      throw new Error("DEMO_SERVER_CATALOG_FAILED");
    await verifyGallery(ctx.serverUrl, dir, secrets);
    const status = await readJson(ctx.serverUrl, "/api/keys/status") as Record<string, unknown>;
    saveJson(join(dir, "server-key-status.masked.json"), {
      "api88-image": status["api88-image"], "api88-video": status["api88-video"] }, secrets);
    saveJson(join(dir, "server-summary.masked.json"), { status: "gallery/status verified", paidSubmissions: 0 }, secrets);
    process.send({ state: "ready", url: ctx.serverUrl, bootId: ctx.bootId });
    await new Promise<void>(resolve => setTimeout(resolve, 300_000));
  } catch (error) {
    saveJson(join(dir, "server-failure.masked.json"), { status: "failed", message: error instanceof Error ? error.message : "DEMO_SERVER_FAILED" }, secrets);
    throw error;
  } finally { recorder.restore(); }
}
main().then(() => process.exit(0), () => process.exit(1));
