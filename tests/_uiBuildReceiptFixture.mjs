import { mkdtemp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SOURCE_DIRS, SOURCE_FILES } from "../scripts/lib/uiBuildReceiptFiles.mjs";

export async function receiptFixture() {
  const root = await mkdtemp(join(tmpdir(), "ima2-ui-receipt-"));
  const saved = new Map();
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("VITE_") || ["CI", "GITHUB_ACTIONS"].includes(key))) {
    saved.set(key, process.env[key]); delete process.env[key];
  }
  const put = async (path, body) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  };
  try {
    for (const directory of [...SOURCE_DIRS, "ui/node_modules", "ui/dist"]) await mkdir(join(root, directory), { recursive: true });
    for (const path of SOURCE_FILES) await put(path, `${path}\n`);
    await put("ui/src/entry.ts", 'export const fixture = "alpha";\n');
    await put("ui/public/fonts/fixture.woff2", "fontbytes");
    await put("ui/dist/index.html", "<main>fixture</main>");
    await put("ui/dist/assets/entry.js", "fixture()");
    await put("ui/dist/.vite/manifest.json", "{}");
    await put("ui/dist/fonts/fixture.woff2", "fontbytes");
    // Complete first directory access during fixture setup, before build watchers.
    await readdir(join(root, "ui/public/fonts"));
    return { root, dist: join(root, "ui/dist"), put, async close() {
      for (const [key, value] of saved) process.env[key] = value;
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } };
  } catch (error) {
    for (const [key, value] of saved) process.env[key] = value;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); throw error;
  }
}
