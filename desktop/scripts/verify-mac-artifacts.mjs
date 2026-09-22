#!/usr/bin/env node
/** Verify originals and exported installers before issuing any artifact hashes. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe, readMacExpectations, verifyMacSignature } from './verify-mac-signature.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAC_FOLDERS = { arm64: 'mac-arm64', x64: 'mac' };
const EQUIVALENT_FIELDS = ['cdHash', 'bundleId', 'shortVersion', 'buildVersion', 'executable'];

/** Verify exactly the architectures the builder emits, in a stable order. */
function architectures(expected) {
  return expected.expectedArchitectures.map((arch) => ({ arch, folder: MAC_FOLDERS[arch] }));
}

function sourceBinding(root, env, run, report) {
  const result = probe('git', ['rev-parse', 'HEAD'], run, { cwd: root });
  report.source = {
    sha: result.stdout.trim(), githubSha: env.GITHUB_SHA ?? null,
    ref: env.GITHUB_REF ?? null, event: env.GITHUB_EVENT_NAME ?? null,
    runId: env.GITHUB_RUN_ID ?? null, attempt: env.GITHUB_RUN_ATTEMPT ?? null,
  };
  if (!result.ok || !/^[a-f\d]{40}$/i.test(report.source.sha)) throw new Error('Cannot bind proof to actual git HEAD');
  if ((env.CI || env.GITHUB_ACTIONS === 'true') && !env.GITHUB_SHA) throw new Error('CI requires GITHUB_SHA source binding');
  if (env.GITHUB_SHA && env.GITHUB_SHA !== report.source.sha) throw new Error('GITHUB_SHA differs from actual git HEAD');
}

function exportPaths(dist, options) {
  const paths = architectures(options).flatMap(({ arch }) => ['zip', 'dmg'].map((format) => ({
    arch, format, name: 'ima2-' + options.expectedVersion + '-mac-' + arch + '.' + format,
  })));
  const expected = new Set(paths.map(({ name }) => name));
  const unexpected = readdirSync(dist).filter((name) => (/\.dmg$/i.test(name) || /-mac-.*\.zip$/i.test(name)) && !expected.has(name));
  if (unexpected.length) throw new Error('Unexpected macOS exports: ' + unexpected.join(', '));
  return paths.map((entry) => ({ ...entry, path: join(dist, entry.name) }));
}

function requireSuccess(result, label) {
  if (!result.ok) throw new Error(label + ' failed (status ' + (result.status ?? 'unavailable') + '): ' + result.text);
}

function compareExport(report, original) {
  const differences = EQUIVALENT_FIELDS.filter((key) => report.verification[key] !== original?.[key]);
  report.equivalence = { ok: Boolean(original?.ok) && differences.length === 0, differences };
  if (!report.equivalence.ok) throw new Error('Export differs from verified original: ' + differences.join(', '));
}

function inspectExport(entry, original, options, run) {
  const report = { ...entry, ok: false, checks: [], cleanup: { ok: false, retainedPath: null } };
  let owned;
  let ownership;
  let mountUncertain = false;
  try {
    if (!lstatSync(entry.path).isFile()) throw new Error('Export is not a regular file');
    owned = realpathSync(mkdtempSync(join(tmpdir(), 'ima2-signature-' + entry.arch + '-' + entry.format + '-')));
    ownership = lstatSync(owned, { bigint: true });
    const content = join(owned, 'content');
    mkdirSync(content);
    if (entry.format === 'dmg') {
      // A failed attach may still have mounted a volume. Never recurse into an
      // uncertain mount, nor guess a device to detach after a failed attach.
      mountUncertain = true;
      const attach = probe('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', content, entry.path], run);
      report.checks.push({ name: 'attach', ...attach });
      requireSuccess(attach, 'DMG attach');
    } else {
      const extract = probe('/usr/bin/ditto', ['-x', '-k', entry.path, content], run);
      report.checks.push({ name: 'extract', ...extract });
      requireSuccess(extract, 'ZIP extraction');
    }
    verifyExportContent(report, content, original, options, run);
  } catch (error) {
    report.error = error.message;
  } finally {
    finishExport(report, owned, ownership, mountUncertain, run);
  }
  report.ok = !report.error && report.verification?.ok === true && report.equivalence?.ok === true && report.cleanup.ok;
  return report;
}

function verifyExportContent(report, content, original, options, run) {
  const apps = readdirSync(content).filter((name) => name.endsWith('.app'));
  if (apps.length !== 1 || apps[0] !== 'ima2.app') throw new Error('Export must contain exactly ima2.app');
  report.verification = verifyMacSignature(join(content, 'ima2.app'), { ...options, expectedArch: report.arch, requireStapled: true }, run);
  if (!report.verification.ok) throw new Error('Export native signature verification failed');
  compareExport(report, original);
}

function finishExport(report, owned, ownership, mountUncertain, run) {
  if (!owned) { report.cleanup.ok = true; return; }
  if (mountUncertain) {
    const attached = report.checks.some((check) => check.name === 'attach' && check.ok);
    if (attached) {
      const detach = probe('/usr/bin/hdiutil', ['detach', join(owned, 'content')], run);
      report.checks.push({ name: 'detach', ...detach });
      mountUncertain = !detach.ok;
    }
    if (mountUncertain) {
      report.cleanup.retainedPath = owned;
      report.cleanup.error = 'Mount state uncertain; preserved owned directory';
      return;
    }
  }
  try {
    const current = lstatSync(owned, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || realpathSync(owned) !== owned
      || current.dev !== ownership.dev || current.ino !== ownership.ino) {
      throw new Error('Owned extraction directory identity changed; preserving it');
    }
    const content = lstatSync(join(owned, 'content'), { bigint: true });
    if (!content.isDirectory() || content.isSymbolicLink() || content.dev !== current.dev) {
      throw new Error('Extraction content may still be mounted or replaced; preserving it');
    }
    // Only the validated, originally owned directory with no active mount.
    rmSync(owned, { recursive: true, force: false });
    report.cleanup.ok = true;
  } catch (error) {
    report.cleanup.retainedPath = owned;
    report.cleanup.error = error.message;
  }
}

async function hashInstallers(exports) {
  const hashes = [];
  for (const entry of exports) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(entry.path)) hash.update(chunk);
    hashes.push({ name: entry.name, sha256: hash.digest('hex') });
  }
  return hashes;
}

function verifyAll(dist, options, run, report) {
  for (const { arch, folder } of architectures(options)) {
    report.originals[arch] = verifyMacSignature(join(dist, folder, 'ima2.app'),
      { ...options, expectedArch: arch, requireStapled: true }, run);
  }
  for (const entry of exportPaths(dist, options)) {
    report.exports.push(inspectExport(entry, report.originals[entry.arch], options, run));
  }
  if (!Object.values(report.originals).every((original) => original.ok) || !report.exports.every((entry) => entry.ok)) {
    throw new Error('Original or exported application verification failed');
  }
}

/**
 * Callers can supply native-command ports; the CLI always uses native defaults.
 * @param {{dist?: string, root?: string, env?: NodeJS.ProcessEnv}} options
 * @param {import('./verify-mac-signature.mjs').NativeRunner} run
 */
export async function verifyMacArtifacts({ dist = 'desktop/dist', root = repositoryRoot, env = process.env } = {}, run = spawnSync) {
  dist = resolve(dist);
  const proofDir = join(dist, 'signature-proof');
  mkdirSync(proofDir, { recursive: true });
  const reportPath = join(proofDir, 'report.json');
  const report = { schemaVersion: 1, ok: false, source: null, expected: null,
    originals: {}, exports: [], hashes: [], errors: [], reportPath };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  try {
    sourceBinding(root, env, run, report);
    if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? '')) throw new Error('APPLE_TEAM_ID is required and must be a valid team identifier');
    report.expected = { ...readMacExpectations(root), expectedTeam: env.APPLE_TEAM_ID };
    verifyAll(dist, report.expected, run, report);
    report.hashes = await hashInstallers(report.exports);
    report.ok = true;
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 2 && args[0] === '--dist' && !args[1].startsWith('-'));
  if (!valid) {
    console.error('Usage: node desktop/scripts/verify-mac-artifacts.mjs --dist desktop/dist');
    process.exitCode = 1;
  } else {
    try {
      const report = await verifyMacArtifacts({ dist: args[1] ?? 'desktop/dist' });
      console.log('[verify-mac-artifacts] ' + (report.ok ? 'OK' : 'FAIL') + ': ' + report.reportPath);
      process.exitCode = report.ok ? 0 : 1;
    } catch (error) {
      console.error('[verify-mac-artifacts] FAIL: ' + error.message);
      process.exitCode = 1;
    }
  }
}
