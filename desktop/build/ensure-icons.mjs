// electron-builder beforeBuild hook: the app/tray icons are gitignored and only exist
// after scripts/make-icons.mjs runs. `npm run dist`/`pack` and direct electron-builder
// calls never ran it, producing packages with a generic app icon and an invisible
// menubar tray. Generating here covers every packaging path.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIcons } from "../scripts/make-icons.mjs";

const buildDir = join(dirname(fileURLToPath(import.meta.url)));

export default async function ensureIcons() {
  const outDir = await generateIcons(buildDir);
  console.log(`[desktop] icons ensured in ${outDir}`);
}
