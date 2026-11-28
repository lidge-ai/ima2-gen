/** Fail packaging when the bundled server would be missing a production dependency or vendor asset. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VENDOR_ASSETS_REL = join('studios', 'kit', 'assets', 'vendors');

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

/** Manifest or vendor logo files missing from the packaged app's vendor asset directory. */
export function missingBundledVendorAssets(appDir) {
  const vendorDir = join(appDir, VENDOR_ASSETS_REL);
  const manifestPath = join(vendorDir, 'manifest.json');
  if (!existsSync(manifestPath)) return [join(VENDOR_ASSETS_REL, 'manifest.json')];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const vendors = Array.isArray(manifest?.vendors) ? manifest.vendors : [];
  if (vendors.length === 0) return [join(VENDOR_ASSETS_REL, 'manifest.json')];
  const missing = [];
  for (const vendor of vendors) {
    const files = Array.isArray(vendor?.files) ? vendor.files : [];
    for (const entry of files) {
      if (typeof entry?.file === 'string' && !existsSync(join(vendorDir, entry.file))) {
        missing.push(join(VENDOR_ASSETS_REL, entry.file));
      }
    }
  }
  return missing;
}

export function verifyBundledVendorAssets(context) {
  const appDir = packagedAppDir(context);
  const missing = missingBundledVendorAssets(appDir);
  if (missing.length > 0) {
    const preview = missing.slice(0, 10).join(', ') + (missing.length > 10 ? ` (+${missing.length - 10} more)` : '');
    throw new Error('[bundled-assets] packaged app is missing vendor assets: ' + preview);
  }
  console.log('[bundled-assets] all vendor assets present in ' + appDir);
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
