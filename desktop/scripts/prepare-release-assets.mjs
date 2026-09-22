#!/usr/bin/env node
/**
 * Gate between a verified build and a public release.
 *
 * The signing job already proved the bundles on the macOS runner and wrote
 * desktop/dist/signature-proof/report.json. That proof is evidence about files
 * on *that* runner, so this step re-hashes the artifacts the release job
 * actually downloaded and refuses to continue unless they are the same bytes.
 * It then derives the public checksum list and release notes from the proof, so
 * the published claims cannot drift from what was verified.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
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

/**
 * electron-builder writes a fixed shape here. Parsing it strictly, rather than
 * with a YAML library, keeps this step runnable on a release runner that never
 * installs dependencies.
 */
function parseUpdateMetadata(text) {
  const document = /^version: ([^\n]+)\nfiles:\n((?:  - url: [^\n]+\n    sha512: [A-Za-z0-9+/=]+\n    size: \d+\n)+)path: ([^\n]+)\nsha512: ([A-Za-z0-9+/=]+)\nreleaseDate: [^\n]+\n?$/.exec(text);
  if (!document) fail('latest-mac.yml does not match the expected electron-builder schema');
  const files = [];
  for (const match of document[2].matchAll(/  - url: ([^\n]+)\n    sha512: ([A-Za-z0-9+/=]+)\n    size: (\d+)\n/g)) {
    files.push({ url: match[1], sha512: match[2], size: Number(match[3]) });
  }
  return { version: document[1], files, path: document[3], sha512: document[4] };
}

function installerNames(architectures, version) {
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

function validateMetadata(metadata, installers, bytesByName, version) {
  if (metadata.version !== version) fail('metadata version ' + metadata.version + ' does not match ' + version);
  const actual = metadata.files.map((entry) => entry.url).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...installers].sort())) {
    fail('metadata files must contain exactly ' + installers.join(', '));
  }
  for (const entry of metadata.files) {
    const bytes = bytesByName.get(entry.url);
    if (entry.size !== bytes.length) fail('metadata size mismatch for ' + entry.url);
    if (entry.sha512 !== digest(bytes, 'sha512', 'base64')) fail('metadata SHA-512 mismatch for ' + entry.url);
  }
  if (!/\.zip$/.test(metadata.path) || !installers.includes(metadata.path)) fail('metadata path must name a published zip');
  if (metadata.sha512 !== digest(bytesByName.get(metadata.path), 'sha512', 'base64')) {
    fail('metadata top-level SHA-512 mismatch for ' + metadata.path);
  }
}

function writeChecksums(distDir, assetNames, bytesByName) {
  const lines = assetNames.map((name) => digest(bytesByName.get(name), 'sha256', 'hex') + '  ' + name);
  writeFileSync(join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
}

function writeNotes(distDir, { version, sha, proof, architectures }) {
  writeFileSync(join(distDir, 'RELEASE_NOTES.md'), [
    'Apple Silicon macOS build for ima2 ' + version + '.',
    '',
    '### Release verification',
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
    'SHA-256 digests are attached as SHA256SUMS.txt.',
    '',
  ].join('\n'));
}

export function prepareReleaseAssets({ distDir, version, tag, sha }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('invalid release version: ' + version);
  if (tag !== 'desktop-v' + version) fail('release tag ' + tag + ' does not match desktop-v' + version);
  if (!/^[0-9a-f]{40}$/.test(sha)) fail('release source SHA must be 40 lowercase hex characters');

  const directory = resolve(distDir);
  const proof = JSON.parse(readRegularFile(join(directory, 'signature-proof/report.json')).toString('utf8'));
  const architectures = validateProof(proof, { version, tag, sha });

  const installers = installerNames(architectures, version);
  const artifactNames = [...installers, ...installers.map((name) => name + '.blockmap'), 'latest-mac.yml'];
  const bytesByName = new Map(artifactNames.map((name) => [name, readRegularFile(join(directory, name))]));

  verifyProofHashes(proof, installers, bytesByName);
  validateMetadata(parseUpdateMetadata(bytesByName.get('latest-mac.yml').toString('utf8')), installers, bytesByName, version);
  writeChecksums(directory, artifactNames, bytesByName);
  writeNotes(directory, { version, sha, proof, architectures });
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
