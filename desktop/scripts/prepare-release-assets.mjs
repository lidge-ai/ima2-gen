#!/usr/bin/env node
/**
 * Gate between a verified build and a public release.
 *
 * The signing job already proved the bundles on the macOS runner and wrote
 * desktop/dist/signature-proof/report.json. That proof is evidence about files
 * on *that* runner, so this step re-hashes the artifacts the release job
 * actually downloaded and refuses to continue unless they are the same bytes.
 * It then derives the public checksum list and release notes from the proof,
 * so the published claims cannot drift from what was verified.
 *
 * Windows and Linux have no notarization pipeline: each leg's electron-builder
 * update metadata (latest.yml / latest-linux*.yml) records the sha512 of the
 * installer it produced, so the check here is that the downloaded bytes match
 * the metadata the updater will hand to clients. Windows ships one merged
 * latest.yml covering both architectures, which this step writes after
 * validating each leg's own metadata.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  throw new Error('[prepare-release-assets] ' + message);
}

function readRegularFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail('missing required file: ' + basename(path));
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('required file is not a regular file: ' + basename(path));
  const bytes = readFileSync(path);
  if (bytes.length === 0) fail('required file is empty: ' + basename(path));
  return bytes;
}

function digest(bytes, algorithm, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

const WIN_ARCHES = ['x64', 'arm64'];
const LINUX_LEGS = [
  { arch: 'x64', appImageArch: 'x86_64', debArch: 'amd64', channel: 'latest-linux.yml' },
  { arch: 'arm64', appImageArch: 'arm64', debArch: 'arm64', channel: 'latest-linux-arm64.yml' },
];

/**
 * electron-builder writes a fixed shape here. Parsing it strictly, rather than
 * with a YAML library, keeps this step runnable on a release runner that never
 * installs dependencies. File entries may carry optional extra scalar fields
 * (AppImage entries also carry blockMapSize), preserved verbatim when a merged
 * file is emitted.
 */
function parseUpdateMetadata(text, label = 'latest-mac.yml') {
  const document = /^version: ([^\n]+)\nfiles:\n((?:  - url: [^\n]+\n(?:    [A-Za-z0-9]+: [^\n]+\n)+)+)path: ([^\n]+)\nsha512: ([A-Za-z0-9+/=]+)\nreleaseDate: ([^\n]+)\n?$/.exec(text);
  if (!document) fail(label + ' does not match the expected electron-builder schema');
  const files = [];
  for (const match of document[2].matchAll(/  - url: ([^\n]+)\n((?:    [A-Za-z0-9]+: [^\n]+\n)+)/g)) {
    const fields = {};
    const order = [];
    for (const field of match[2].matchAll(/    ([A-Za-z0-9]+): ([^\n]+)\n/g)) {
      fields[field[1]] = field[2];
      order.push(field[1]);
    }
    if (!/^[A-Za-z0-9+/=]+$/.test(fields.sha512 ?? '')) fail(label + ' entry for ' + match[1] + ' has no valid sha512');
    if (!/^\d+$/.test(fields.size ?? '')) fail(label + ' entry for ' + match[1] + ' has no valid size');
    files.push({ url: match[1], sha512: fields.sha512, size: Number(fields.size), fields, order });
  }
  return { version: document[1], files, path: document[3], sha512: document[4], releaseDate: document[5] };
}

function serializeUpdateMetadata(metadata) {
  const lines = ['version: ' + metadata.version, 'files:'];
  for (const entry of metadata.files) {
    lines.push('  - url: ' + entry.url);
    const emitted = new Set();
    for (const key of ['sha512', 'size', ...entry.order]) {
      if (emitted.has(key)) continue;
      emitted.add(key);
      lines.push('    ' + key + ': ' + entry.fields[key]);
    }
  }
  lines.push('path: ' + metadata.path, 'sha512: ' + metadata.sha512, 'releaseDate: ' + metadata.releaseDate, '');
  return lines.join('\n');
}

function macInstallerNames(architectures, version) {
  return architectures.flatMap((arch) => ['dmg', 'zip'].map((format) => 'ima2-' + version + '-mac-' + arch + '.' + format));
}

function validateProof(proof, { version, tag, sha }) {
  if (proof?.schemaVersion !== 1) fail('signature proof schema version must be 1');
  if (proof.ok !== true) fail('signature proof did not pass: ' + (proof.errors ?? []).join('; '));
  if (proof.source?.sha !== sha) fail('signature proof source sha does not match ' + sha);
  if (proof.source?.githubSha !== sha) fail('signature proof GITHUB_SHA does not match ' + sha);
  if (proof.source?.ref !== 'refs/tags/' + tag) fail('signature proof was not produced for ' + tag);
  if (proof.expected?.expectedVersion !== version) fail('signature proof version does not match ' + version);
  if (!/^[A-Z0-9]{10}$/.test(proof.expected?.expectedTeam ?? '')) fail('signature proof has no valid Apple Team ID');
  const architectures = proof.expected?.expectedArchitectures;
  if (!Array.isArray(architectures) || architectures.length === 0) fail('signature proof declares no architectures');
  for (const arch of architectures) {
    const original = proof.originals?.[arch];
    if (original?.ok !== true) fail('signature proof has no passing original for ' + arch);
    if (!/^Developer ID Application: /.test(original.authority ?? '')) fail('original for ' + arch + ' is not Developer ID signed');
    if (original.teamId !== proof.expected.expectedTeam) fail('original for ' + arch + ' carries a different team');
  }
  if (!Array.isArray(proof.exports) || proof.exports.length === 0) fail('signature proof verified no exports');
  if (!proof.exports.every((entry) => entry.ok === true)) fail('signature proof has a failing export');
  return architectures;
}

/** The proof was issued elsewhere; only re-hashing binds it to these bytes. */
function verifyProofHashes(proof, installers, bytesByName) {
  const hashed = new Map((proof.hashes ?? []).map((entry) => [entry.name, entry.sha256]));
  if (hashed.size !== installers.length) fail('signature proof hashes do not cover exactly the expected installers');
  for (const name of installers) {
    const expected = hashed.get(name);
    if (!expected) fail('signature proof has no hash for ' + name);
    if (expected !== digest(bytesByName.get(name), 'sha256', 'hex')) fail('downloaded ' + name + ' differs from the verified build');
  }
}

function validateMetadata(metadata, installers, bytesByName, version, label) {
  if (metadata.version !== version) fail(label + ' version ' + metadata.version + ' does not match ' + version);
  const actual = metadata.files.map((entry) => entry.url).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...installers].sort())) {
    fail(label + ' files must contain exactly ' + installers.join(', '));
  }
  for (const entry of metadata.files) {
    const bytes = bytesByName.get(entry.url);
    if (bytes === undefined) fail(label + ' names ' + entry.url + ' but it was not downloaded');
    if (entry.size !== bytes.length) fail(label + ' size mismatch for ' + entry.url);
    if (entry.sha512 !== digest(bytes, 'sha512', 'base64')) fail(label + ' SHA-512 mismatch for ' + entry.url);
  }
  if (!installers.includes(metadata.path)) fail(label + ' path must name a published installer');
  if (metadata.sha512 !== digest(bytesByName.get(metadata.path), 'sha512', 'base64')) {
    fail(label + ' top-level SHA-512 mismatch for ' + metadata.path);
  }
}

/**
 * The two Windows legs each emit a latest.yml naming only their own exe.
 * electron-updater selects the installer whose URL names its process arch, so
 * the published latest.yml must list both. The x64 leg remains the legacy
 * path/sha512 fallback.
 */
function mergeWindowsMetadata(legByArch, version) {
  const primary = legByArch.x64;
  const secondary = legByArch.arm64;
  return {
    version,
    files: [...primary.files, ...secondary.files],
    path: primary.path,
    sha512: primary.sha512,
    releaseDate: primary.releaseDate,
  };
}

function writeChecksums(distDir, assetNames, bytesByName) {
  const lines = assetNames.map((name) => digest(bytesByName.get(name), 'sha256', 'hex') + '  ' + name);
  writeFileSync(join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}

function writeNotes(distDir, { version, sha, proof, architectures, windowsSigned }) {
  writeFileSync(join(distDir, 'RELEASE_NOTES.md'), [
    'Desktop builds for ima2 ' + version + ': macOS (Apple Silicon), Windows (x64, arm64) and Linux (x86_64, arm64).',
    '',
    '### macOS verification',
    '',
    '- Build commit: ' + sha,
    '- Architectures: ' + architectures.join(', '),
    '- Apple Team ID: ' + proof.expected.expectedTeam,
    '- Signing authority: ' + proof.originals[architectures[0]].authority,
    '- Developer ID signature, hardened runtime and secure timestamp: passed',
    '- Gatekeeper assessment: passed',
    '- Stapled notarization ticket: passed',
    '- Exported DMG and ZIP contents verified against the signed originals',
    '',
    '### Windows and Linux',
    '',
    windowsSigned
      ? '- Windows installers: Authenticode signed'
      : '- Windows installers: not Authenticode signed (WIN_CSC_LINK was not configured); SmartScreen may warn on first install',
    '- Windows and Linux installers verified against the sha512 digests electron-builder recorded in latest*.yml',
    '- Auto-update: macOS, Windows (NSIS) and Linux AppImage; deb installs update through the package manager manually',
    '',
    'SHA-256 digests are attached as SHA256SUMS.txt.',
    '',
  ].join('\n'));
}

export function prepareReleaseAssets({ distDir, version, tag, sha }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('invalid release version: ' + version);
  if (tag !== 'desktop-v' + version) fail('release tag ' + tag + ' does not match desktop-v' + version);
  if (!/^[0-9a-f]{40}$/.test(sha)) fail('release source SHA must be 40 lowercase hex characters');

  const directory = resolve(distDir);
  const bytesByName = new Map();
  const artifactNames = [];
  // Loads a leg artifact and, when it came from a leg directory, lifts it to
  // the dist root so every published asset sits flat for `gh release upload`.
  const load = (dir, name) => {
    const bytes = readRegularFile(join(dir, name));
    if (resolve(dir) !== directory) copyFileSync(join(dir, name), join(directory, name));
    bytesByName.set(name, bytes);
    artifactNames.push(name);
    return bytes;
  };

  // macOS: strict proof binding, unchanged.
  const proof = JSON.parse(readRegularFile(join(directory, 'signature-proof/report.json')).toString('utf8'));
  const architectures = validateProof(proof, { version, tag, sha });
  const macInstallers = macInstallerNames(architectures, version);
  for (const name of macInstallers) load(directory, name);
  for (const name of macInstallers) load(directory, name + '.blockmap');
  load(directory, 'latest-mac.yml');
  verifyProofHashes(proof, macInstallers, bytesByName);
  const macMetadata = parseUpdateMetadata(bytesByName.get('latest-mac.yml').toString('utf8'), 'latest-mac.yml');
  validateMetadata(macMetadata, macInstallers, bytesByName, version, 'latest-mac.yml');
  if (!/\.zip$/.test(macMetadata.path)) fail('latest-mac.yml path must name the published zip');

  // Windows: two per-arch legs, merged into one latest.yml.
  const winLegs = {};
  const winSigning = new Set();
  for (const arch of WIN_ARCHES) {
    const dir = join(directory, 'win-' + arch);
    const exe = 'ima2-' + version + '-win-' + arch + '.exe';
    load(dir, exe);
    load(dir, exe + '.blockmap');
    const leg = parseUpdateMetadata(readRegularFile(join(dir, 'latest.yml')).toString('utf8'), 'win-' + arch + '/latest.yml');
    validateMetadata(leg, [exe], bytesByName, version, 'win-' + arch + '/latest.yml');
    if (!/\.exe$/.test(leg.path) || leg.path !== exe) fail('win-' + arch + '/latest.yml path must name ' + exe);
    winLegs[arch] = leg;
    const marker = readRegularFile(join(dir, 'signing-windows.txt')).toString('utf8').trim();
    if (marker !== 'signed' && marker !== 'unsigned') fail('win-' + arch + ' signing marker must be signed or unsigned, got: ' + marker);
    winSigning.add(marker);
  }
  if (winSigning.size !== 1) fail('win legs disagree on signing: ' + [...winSigning].join(', '));
  const windowsSigned = winSigning.has('signed');
  const mergedWin = mergeWindowsMetadata(winLegs, version);
  const mergedWinYaml = serializeUpdateMetadata(mergedWin);
  writeFileSync(join(directory, 'latest.yml'), mergedWinYaml);
  bytesByName.set('latest.yml', Buffer.from(mergedWinYaml, 'utf8'));
  artifactNames.push('latest.yml');

  // Linux: each leg already emits its own channel file; re-validate and republish it.
  for (const { arch, appImageArch, debArch, channel } of LINUX_LEGS) {
    const dir = join(directory, 'linux-' + arch);
    const appImage = 'ima2-' + version + '-linux-' + appImageArch + '.AppImage';
    const deb = 'ima2-' + version + '-linux-' + debArch + '.deb';
    load(dir, appImage);
    load(dir, deb);
    const bytes = readRegularFile(join(dir, channel));
    const metadata = parseUpdateMetadata(bytes.toString('utf8'), 'linux-' + arch + '/' + channel);
    validateMetadata(metadata, [appImage], bytesByName, version, 'linux-' + arch + '/' + channel);
    if (!/\.AppImage$/.test(metadata.path)) fail(channel + ' path must name the published AppImage');
    writeFileSync(join(directory, channel), bytes);
    bytesByName.set(channel, bytes);
    artifactNames.push(channel);
  }

  writeChecksums(directory, artifactNames, bytesByName);
  writeNotes(directory, { version, sha, proof, architectures, windowsSigned });
  return { publicAssets: [...artifactNames, 'SHA256SUMS.txt'] };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!key || value === undefined) fail('invalid arguments: ' + argv.join(' '));
    values[key] = value;
  }
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = prepareReleaseAssets({ distDir: args.dist, version: args.version, tag: args.tag, sha: args.sha });
    console.log('[prepare-release-assets] OK: ' + result.publicAssets.join(', '));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
