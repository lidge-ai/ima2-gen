import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readStoreBundle } from "./_storeBundle.mjs";
import { readSourceTree } from "./_readTree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = join(__dirname, "..", "ui", "src", "App.tsx");
const sessionRoutesPath = join(__dirname, "..", "routes", "sessions.ts");
const enPath = join(__dirname, "..", "ui", "src", "i18n", "en.json");
const koPath = join(__dirname, "..", "ui", "src", "i18n", "ko.json");

const registryPath = join(__dirname, "..", "ui", "src", "store", "persistenceRegistry.ts");
const storeSrc = readStoreBundle();
const registrySrc = await readFile(registryPath, "utf8");
const appSrc = await readFile(appPath, "utf8");
const apiSrc = readSourceTree("ui/src/lib/api.ts");
const routeSrc = await readFile(sessionRoutesPath, "utf8");
const en = JSON.parse(await readFile(enPath, "utf8"));
const ko = JSON.parse(await readFile(koPath, "utf8"));

assert.ok(
  storeSrc.includes("localStorage.getItem(ACTIVE_SESSION_ID_STORAGE_KEY)") &&
    registrySrc.includes('"ima2.activeSessionId"'),
  "active graph session should be persisted per browser",
);
assert.ok(
  storeSrc.includes("const savedExists = savedId ? sessions.some"),
  "session loader should prefer the browser's saved session when present",
);
assert.ok(
  !storeSrc.includes("if (!current && sessions.length > 0)"),
  "new browsers must not auto-attach to the most recent shared session",
);
assert.ok(
  routeSrc.includes('code === "GRAPH_VERSION_CONFLICT"'),
  "graph version conflicts should have an explicit handling branch",
);
assert.ok(
  routeSrc.includes('logEvent("session", "graph_conflict"'),
  "graph version conflicts should be logged as structured concurrency events",
);
assert.ok(
  apiSrc.includes("GraphSaveMeta") &&
    apiSrc.includes("X-Ima2-Graph-Save-Id") &&
    apiSrc.includes("X-Ima2-Graph-Save-Reason") &&
    apiSrc.includes("X-Ima2-Tab-Id"),
  "graph saves should carry save metadata headers",
);
assert.ok(
  !appSrc.includes('document.addEventListener("visibilitychange", onHide)'),
  "visibilitychange should not send graph save beacons",
);
assert.ok(
  storeSrc.includes("isSavingGraph") &&
    storeSrc.includes("needsGraphSave") &&
    storeSrc.includes("runGraphSaveQueue") &&
    !storeSrc.includes("saveGraphPromise"),
  "graph autosave should use a drainable single-flight queue",
);
assert.ok(
  storeSrc.includes('if (get().activeSessionId !== id) return "skipped"'),
  "graph save completion should not apply an old session graphVersion to a new active session",
);
assert.ok(
  en.toast.sessionReloadedElsewhere.includes("Graph version changed"),
  "English conflict toast should use neutral graph-version wording",
);
assert.ok(
  !en.toast.sessionReloadedElsewhere.includes("another tab"),
  "English conflict toast should not claim another tab caused the reload",
);
assert.ok(
  ko.toast.sessionReloadedElsewhere.includes("그래프 버전"),
  "Korean conflict toast should use neutral graph-version wording",
);
assert.ok(
  !ko.toast.sessionReloadedElsewhere.includes("다른 탭"),
  "Korean conflict toast should not claim another tab caused the reload",
);

console.log("session-conflict: ok");
