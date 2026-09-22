/** Sign loose Mach-O sidecars before electron-builder seals the outer bundle. */
import { spawnSync } from 'node:child_process';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** @typedef {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) => {status: number | null, stdout?: string | Buffer, stderr?: string | Buffer, error?: Error}} NativeRunner */
const MACHO_MAGIC = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe,
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
]);

function isMachO(path) {
  if (statSync(path).size < 4) return false;
  const fd = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(4);
    if (readSync(fd, bytes, 0, 4, 0) !== 4) throw new Error('Short read scanning Mach-O file');
    return MACHO_MAGIC.has(bytes.readUInt32BE(0));
  } finally {
    closeSync(fd);
  }
}

/** Symlinks are not separate signing subjects; never follow them while scanning. */
async function collectFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function command(run, executable, args) {
  const result = run(executable, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    // Do not echo diagnostics that may include credential-import details.
    throw new Error('[sign-extra] ' + executable + ' failed (status ' + (result.status ?? 'unavailable') + ')');
  }
  return String(result.stdout ?? '') + '\n' + String(result.stderr ?? '');
}

async function resolveIdentity(context, env, run) {
  const signingInfo = context.packager?.codeSigningInfo;
  if (!signingInfo || !('value' in signingInfo)) throw new Error('[sign-extra] missing builder signing API');
  // This lazy promise performs CSC_LINK import and registers builder-owned cleanup.
  const info = await signingInfo.value;
  const keychain = info?.keychainFile;
  if (env.CSC_LINK && (typeof keychain !== 'string' || !keychain.trim())) {
    throw new Error('[sign-extra] CSC_LINK import returned no keychain');
  }
  const qualifier = (context.packager.config?.mac?.identity ?? env.CSC_NAME ?? '').trim();
  if (/^(?:Developer ID (?:Application|Installer)|3rd Party Mac Developer (?:Application|Installer)|Apple Development|Apple Distribution|Mac Developer):/.test(qualifier)) {
    throw new Error('[sign-extra] remove the certificate-type prefix from CSC_NAME/identity; use a qualifier or hash');
  }
  const args = ['find-identity', '-v', '-p', 'codesigning'];
  if (keychain) args.push(keychain);
  const listing = command(run, '/usr/bin/security', args);
  const identities = new Map();
  for (const match of listing.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(Developer ID Application: [^"]+)"\s*$/gm)) {
    const [, hash, name] = match;
    const matches = /^[A-Fa-f0-9]{40}$/.test(qualifier)
      ? hash === qualifier : name.includes(qualifier);
    if (matches) identities.set(hash.toUpperCase(), name);
  }
  if (identities.size > 1) throw new Error('[sign-extra] ambiguous Developer ID identities; select a unique hash or qualifier');
  return { hash: identities.keys().next().value, keychain };
}

/**
 * Native command/env ports are injectable by callers; electron-builder uses defaults.
 * @param {object} context
 * @param {{env?: NodeJS.ProcessEnv, run?: NativeRunner}} ports
 */
export default async function signExtraBinaries(context, { env = process.env, run = spawnSync } = {}) {
  if (context.electronPlatformName !== 'darwin') return;
  const force = context.packager?.forceCodeSigning === true;
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' || context.packager?.config?.mac?.identity === null) {
    if (force) throw new Error('[sign-extra] forced signing conflicts with unsigned override');
    console.log('[sign-extra] explicit unsigned preview');
    return;
  }
  const identity = await resolveIdentity(context, env, run);
  if (!identity.hash) {
    if (force || env.CSC_LINK || env.CSC_NAME) throw new Error('[sign-extra] no matching Developer ID identity');
    console.log('[sign-extra] no Developer ID identity available for local build');
    return;
  }
  const appName = context.packager.appInfo.productFilename + '.app';
  const resources = join(context.appOutDir, appName, 'Contents', 'Resources');
  const binaries = (await collectFiles(resources)).filter(isMachO);
  binaries.sort((a, b) => b.split(sep).length - a.split(sep).length);
  for (const binary of binaries) {
    const args = ['--force', '--timestamp', '--options', 'runtime',
      '--entitlements', join(here, 'entitlements.mac.plist'), '--sign', identity.hash];
    if (identity.keychain) args.push('--keychain', identity.keychain);
    command(run, '/usr/bin/codesign', [...args, binary]);
    command(run, '/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', binary]);
  }
  console.log('[sign-extra] signed and verified ' + binaries.length + ' Mach-O binaries');
}
