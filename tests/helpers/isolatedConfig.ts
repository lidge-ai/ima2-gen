// Import this first in a test file that imports config, routes or lib/db statically:
//   import "./helpers/isolatedConfig.ts";
// It gives the file its own config directory before config loads, so the test never opens the
// real ~/.ima2/sessions.db, and it closes the database and removes the directory when the file ends.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import { releaseDatabase } from "./releaseDatabase.ts";

const dir = mkdtempSync(join(tmpdir(), "ima2-test-config-"));
process.env.IMA2_CONFIG_DIR = dir;

after(async () => {
  await releaseDatabase();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
