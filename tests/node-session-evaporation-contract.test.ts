import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStoreBundle } from "./_storeBundle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFile(join(__dirname, "..", rel), "utf8");

const appSrc = await read("ui/src/App.tsx");
const storeSrc = await readStoreBundle();
const devModeSrc = await read("ui/src/lib/devMode.ts");
const sessionStoreSrc = await read("lib/sessionStore.ts");

// ── 1. loadSessions must run for node mode, not only agent mode ──

assert.match(
  appSrc,
  /ENABLE_NODE_MODE/,
  "App.tsx must import ENABLE_NODE_MODE",
);

assert.match(
  appSrc,
  /if\s*\(ENABLE_AGENT_MODE.*ENABLE_NODE_MODE.*\)\s*loadSessions\(\)/,
  "loadSessions() must be gated on ENABLE_NODE_MODE in addition to ENABLE_AGENT_MODE",
);

assert.match(
  devModeSrc,
  /ENABLE_NODE_MODE\s*=\s*import\.meta\.env\.VITE_IMA2_NODE_MODE\s*!==\s*"0"/,
  "ENABLE_NODE_MODE must default to true (only disabled by explicit env=0)",
);

// ── 2. doSave must not wipe sessions that already have data ──

assert.ok(
  storeSrc.includes("graphNodes.length === 0 && graphVersion > 0"),
  "doSave() must skip saves when graphNodes is empty and session already has persisted data (graphVersion > 0)",
);

assert.ok(
  storeSrc.includes("sessionLoading") &&
    /async function doSave[\s\S]{0,500}sessionLoading/.test(storeSrc),
  "doSave() must check sessionLoading to avoid saving during session transitions",
);

// ── 3. flushGraphSaveBeacon must have matching guards ──

const beaconIdx = storeSrc.indexOf("function flushGraphSaveBeacon");
assert.ok(beaconIdx !== -1, "flushGraphSaveBeacon function must exist");
const beaconBody = storeSrc.slice(beaconIdx, beaconIdx + 1200);

assert.ok(
  beaconBody.includes("sessionLoading"),
  "flushGraphSaveBeacon must check sessionLoading before sending",
);
assert.ok(
  beaconBody.includes("graphNodes.length === 0") &&
    beaconBody.includes("activeSessionGraphVersion"),
  "flushGraphSaveBeacon must guard against empty saves on sessions with data",
);

// ── 4. Server-side saveGraph uses delete-then-reinsert (document the risk) ──

assert.ok(
  sessionStoreSrc.includes('DELETE FROM nodes WHERE session_id') &&
    sessionStoreSrc.includes('DELETE FROM edges WHERE session_id'),
  "saveGraph uses DELETE-all + re-INSERT strategy — client guards are the data-loss prevention layer",
);

// ── 5. New sessions start at graphVersion 0 (defensive guard correctness) ──

assert.match(
  sessionStoreSrc,
  /graph_version\)\s*VALUES\s*\(\?\s*,\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*0\)/,
  "new sessions must start with graph_version=0 so empty saves on new sessions are allowed through the guard",
);

console.log("node-session-evaporation-contract: ok");
