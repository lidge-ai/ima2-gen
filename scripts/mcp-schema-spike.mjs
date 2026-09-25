#!/usr/bin/env node
// mcp-schema-spike.mjs — 010 WP1: authenticated read-only tools/list capture.
// Allowlist: initialize / notifications/initialized / tools/list / ping.
// tools/call, resources, prompts are structurally denied (no call path + guard).
// Usage: node scripts/mcp-schema-spike.mjs --provider runway|higgsfield [--list-only]
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { scrub, sha, denyMutations } from "./lib/spikeSanitize.mjs";

const PROVIDERS = {
  runway: "https://mcp.runwayml.com/mcp",
  higgsfield: "https://mcp.higgsfield.ai/mcp",
};
const CALLBACK_PORT = 8976;
const REDIRECT_URL = `http://localhost:${CALLBACK_PORT}/callback`;

const args = process.argv.slice(2);
const provider = args[args.indexOf("--provider") + 1];
if (!PROVIDERS[provider]) {
  console.error(`unknown provider. use: ${Object.keys(PROVIDERS).join("|")}`);
  process.exit(2);
}
const endpoint = PROVIDERS[provider];
const configDir = process.env.IMA2_CONFIG_DIR || join(homedir(), ".ima2");
const spikeDir = join(configDir, "mcp-spike");
mkdirSync(spikeDir, { recursive: true });
const storePath = join(spikeDir, `${provider}.json`);

function loadStore() {
  try { return JSON.parse(readFileSync(storePath, "utf8")); } catch { return {}; }
}
function saveStore(store) {
  writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  try { chmodSync(storePath, 0o600); } catch { /* best-effort: chmod is unsupported on some platforms; file was written with mode 0600 */ }
}

const store = loadStore();
const authProvider = {
  get redirectUrl() { return REDIRECT_URL; },
  get clientMetadata() {
    return {
      client_name: "ima2-gen schema spike (read-only)",
      redirect_uris: [REDIRECT_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  },
  clientInformation() { return store.clientInformation; },
  saveClientInformation(info) { store.clientInformation = info; saveStore(store); },
  tokens() { return store.tokens; },
  saveTokens(tokens) { store.tokens = tokens; saveStore(store); },
  redirectToAuthorization(url) {
    console.log(`[oauth] browser opening for ${provider} — approve the login:`);
    console.log(`[oauth] ${url.toString()}`);
    spawn("open", [url.toString()], { stdio: "ignore", detached: true }).unref();
  },
  saveCodeVerifier(v) { store.codeVerifier = v; saveStore(store); },
  codeVerifier() { return store.codeVerifier; },
};

function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const code = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      res.end(code ? "ima2 spike: 인증 완료. 이 창은 닫아도 됩니다." : `실패: ${err}`);
      server.close();
      if (code) resolve(code); else reject(new Error(`oauth error: ${err}`));
    });
    server.listen(CALLBACK_PORT, () => console.log(`[oauth] callback listening on ${REDIRECT_URL}`));
    setTimeout(() => { try { server.close(); } catch { /* best-effort: server may already be closed */ } ; reject(new Error("oauth callback timeout (10min)")); }, 600_000);
  });
}

async function connectOnce() {
  const client = new Client({ name: "ima2-gen-spike", version: "0.1.0" }, { capabilities: {} });
  denyMutations(client);
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider });
  await client.connect(transport);
  return { client, transport };
}

async function main() {
  console.log(`[spike] provider=${provider} endpoint=${endpoint}`);
  let session;
  try {
    session = await connectOnce();
  } catch (e) {
    if (e instanceof UnauthorizedError || /unauthorized/i.test(String(e?.message))) {
      console.log("[oauth] authorization required — waiting for user approval…");
      const code = await waitForCallback();
      const t = new StreamableHTTPClientTransport(new URL(endpoint), { authProvider });
      await t.finishAuth(code);
      await t.close().catch(() => {});
      session = await connectOnce();
    } else { throw e; }
  }
  const { client } = session;
  const serverInfo = client.getServerVersion?.() ?? null;
  const instructions = client.getInstructions?.() ?? null;

  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  console.log(`[spike] tools/list ok — ${tools.length} tools`);

  const originalHash = sha(tools);
  const sanitizedTools = tools.map((t) => scrub({
    name: t.name, title: t.title, description: t.description,
    inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations,
  }));
  const artifact = {
    provenance: {
      provider, endpoint, fetchedAt: new Date().toISOString(),
      serverInfo: scrub(serverInfo), entitlementTag: "user-oauth-account",
      originalHash, sanitizedHash: sha(sanitizedTools),
    },
    serverInstructions: scrub(instructions),
    tools: sanitizedTools,
  };
  const outPath = join("tests", "fixtures", "mcp", `${provider}-tools.sanitized.json`);
  mkdirSync(join("tests", "fixtures", "mcp"), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n");
  console.log(`[spike] wrote ${outPath}`);
  console.log(`[spike] tool names: ${tools.map((t) => t.name).join(", ")}`);
  await session.transport.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => { console.error(`[spike] FAILED: ${e?.message || e}`); process.exit(1); });
