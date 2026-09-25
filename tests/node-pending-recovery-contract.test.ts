import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStoreBundle } from "./_storeBundle.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const historyPath = join(__dirname, "..", "lib", "historyList.ts");
const nodesRoutePath = join(__dirname, "..", "routes", "nodes.ts");
const nodeGenerationPath = join(__dirname, "..", "lib", "nodeGeneration.ts");

const storeSrc = readStoreBundle();
const historySrc = await readFile(historyPath, "utf8");
const nodesRouteSrc =
  (await readFile(nodesRoutePath, "utf8")) +
  (await readFile(nodeGenerationPath, "utf8"));

assert.ok(
  storeSrc.includes("pendingRequestId: flightId") &&
    storeSrc.includes("recoveryRequestId: flightId"),
  "node generation should persist request identity for pending and recovery states",
);

assert.ok(
  storeSrc.includes("const requestKey = n.data.pendingRequestId ?? n.data.recoveryRequestId ?? null") &&
    storeSrc.includes("(h.requestId ?? null) === requestKey"),
  "history recovery should match requestId before falling back to client node metadata",
);

assert.ok(
  storeSrc.includes('status: "ready" as const') &&
    storeSrc.includes("imageUrl: recovered.url"),
  "history recovery should restore completed nodes as ready with a canonical imageUrl",
);

assert.ok(
  storeSrc.includes("delete safe.referenceImages") &&
    storeSrc.includes("delete safe.partialImageUrl"),
  "session graph saves should strip draft references and partial previews",
);

assert.ok(
  storeSrc.includes("const requestSessionId = s.activeSessionId") &&
    storeSrc.includes("if (get().activeSessionId !== requestSessionId) return") &&
    storeSrc.includes("if (get().activeSessionId === requestSessionId)") &&
    storeSrc.includes("cross-session: result will be restored via recoverGraphNodesFromHistory"),
  "node generation should guard cross-session mutations and rely on recovery when users switch sessions",
);

assert.ok(
  storeSrc.includes("await recoverGraphNodesFromHistory(get, set).catch(() => {})"),
  "graph conflict reload should run node history recovery after loading the latest graph",
);

assert.ok(
  nodesRouteSrc.includes("refsCount") && historySrc.includes("refsCount"),
  "node route sidecars and history listings should expose numeric refsCount metadata",
);

// Runtime replacements: inflight-reload-reconcile-contract.test.ts exercises both
// public actions for server-only node metadata and other-session preservation.

console.log("node-pending-recovery-contract: ok");
