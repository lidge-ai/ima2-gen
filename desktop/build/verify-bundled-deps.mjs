/** Fail packaging when the bundled server would be missing a production dependency. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Resources/app for the packaged platform layout (asar is disabled for this app). */
export function packagedAppDir(context) {
  if (context.electronPlatformName === 'darwin') {
    const appName = context.packager.appInfo.productFilename + '.app';
    return join(context.appOutDir, appName, 'Contents', 'Resources', 'app');
  }
  return join(context.appOutDir, 'resources', 'app');
}

/** Names of declared dependencies that have no package.json under the packaged node_modules. */
export function missingBundledDependencies(appDir) {
  const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
  const names = Object.keys(manifest.dependencies ?? {});
  return names.filter((name) => !existsSync(join(appDir, 'node_modules', ...name.split('/'), 'package.json')));
}

export default function verifyBundledDependencies(context) {
  const appDir = packagedAppDir(context);
  const missing = missingBundledDependencies(appDir);
  if (missing.length > 0) {
    throw new Error('[bundled-deps] packaged app is missing production dependencies: ' + missing.join(', ')
      + '. A falsy beforeBuild result makes electron-builder skip node_modules.');
  }
  console.log('[bundled-deps] all production dependencies present in ' + appDir);
}
