// electron-builder beforeBuild hook: the app/tray icons are gitignored and only exist
// after scripts/make-icons.mjs runs. `npm run dist`/`pack` and direct electron-builder
// calls never ran it, producing packages with a generic app icon and an invisible
// menubar tray. Generating here covers every packaging path.
//
// The hook MUST resolve to true. electron-builder treats any falsy result (including
// undefined) as "node_modules are handled externally": it then skips the dependency
// rebuild AND omits node_modules from the package, so the bundled server dies on its
// first import. desktop-v3.20.0 through desktop-v3.23.1 shipped that way.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateIcons } from "../scripts/make-icons.mjs";

const buildDir = join(dirname(fileURLToPath(import.meta.url)));

export default async function ensureIcons() {
  const outDir = await generateIcons(buildDir);
  console.log(`[desktop] icons ensured in ${outDir}`);
  return true;
}
