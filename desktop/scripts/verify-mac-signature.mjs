#!/usr/bin/env node
/** Native, import-safe verification. Never launches the application. */
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** @typedef {(command: string, args: string[], options: import('node:child_process').SpawnSyncOptionsWithStringEncoding) => {status: number | null, stdout?: string | Buffer, stderr?: string | Buffer, error?: Error}} NativeRunner */

/**
 * Preserve both native streams, including when a command fails or throws.
 * @param {string} cmd
 * @param {string[]} args
 * @param {NativeRunner} run
 */
export function probe(cmd, args, run = spawnSync, options = {}) {
  try {
    const result = run(cmd, args, { ...options, encoding: 'utf8' });
    return { ok: !result.error && result.status === 0, status: result.status,
      stdout: String(result.stdout ?? ''),
      text: (String(result.stdout ?? '') + '\n' + String(result.stderr ?? '')
        + (result.error ? '\n' + result.error.message : '')).trim() };
  } catch (error) {
    return { ok: false, status: null, stdout: '', text: error.message };
  }
}

export const SUPPORTED_MAC_ARCHITECTURES = ['arm64', 'x64'];

/**
 * The architectures worth verifying are exactly the ones the builder is
 * configured to emit. Deriving them here means narrowing distribution to Apple
 * Silicon - or widening it again later - is a single config change, with no
 * second list that can silently drift out of step with the packaged output.
 * An unconfigured target set stays strict and demands both.
 */
function readMacArchitectures(builder) {
  const targets = Array.isArray(builder.mac?.target) ? builder.mac.target : [];
  const declared = new Set(targets.flatMap((entry) => (Array.isArray(entry?.arch) ? entry.arch : [])));
  if (declared.size === 0) return [...SUPPORTED_MAC_ARCHITECTURES];
  const unsupported = [...declared].filter((arch) => !SUPPORTED_MAC_ARCHITECTURES.includes(arch));
  if (unsupported.length) throw new Error('Unsupported macOS architecture: ' + unsupported.join(', '));
  return SUPPORTED_MAC_ARCHITECTURES.filter((arch) => declared.has(arch));
}

export function readMacExpectations(root = repositoryRoot) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const builder = parse(readFileSync(join(root, 'desktop/electron-builder.yml'), 'utf8'));
  if (typeof pkg.version !== 'string' || !/^[\w.+-]+$/.test(pkg.version)) throw new Error('Invalid root package version');
  if (typeof builder.appId !== 'string' || !builder.appId.trim()) throw new Error('Missing builder appId');
  return {
    expectedVersion: pkg.version,
    expectedAppId: builder.appId,
    expectedArchitectures: readMacArchitectures(builder),
  };
}

function addCheck(report, name, ok, detail = '') {
  report.checks.push({ name, ok: Boolean(ok), detail });
}

function inside(root, path) {
  const rel = relative(realpathSync(root), realpathSync(path));
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function inspectSignature(report, options, run) {
  const info = probe('/usr/bin/codesign', ['-dv', '--verbose=4', report.appPath], run);
  addCheck(report, 'codesign-info', info.ok, info.text);
  const field = (name) => info.text.match(new RegExp('^' + name + '=(.+)$', 'm'))?.[1]?.trim() ?? '';
  report.authority = field('Authority');
  report.teamId = field('TeamIdentifier');
  report.cdHash = field('CDHash');
  addCheck(report, 'developer-id', info.ok && report.authority.startsWith('Developer ID Application: ')
    && !/^Signature\s*=\s*adhoc/m.test(info.text), report.authority);
  addCheck(report, 'team', info.ok && /^[A-Z0-9]{10}$/.test(report.teamId)
    && (!options.expectedTeam || report.teamId === options.expectedTeam), report.teamId);
  addCheck(report, 'runtime', info.ok && /flags=\S*\bruntime\b/.test(info.text));
  addCheck(report, 'timestamp', info.ok && /^Timestamp=\S.+$/m.test(info.text) && !/^Timestamp=none\s*$/mi.test(info.text));
  addCheck(report, 'cdhash', info.ok && /^[a-f\d]{40,64}$/i.test(report.cdHash), report.cdHash);
  for (const [name, cmd, args] of [
    ['strict-deep', '/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2']],
    ['gatekeeper', '/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4']],
    ...(options.requireStapled ? [['staple', '/usr/bin/xcrun', ['stapler', 'validate']]] : []),
  ]) {
    const result = probe(cmd, [...args, report.appPath], run);
    addCheck(report, name, result.ok, result.text);
  }
}

function inspectBundle(report, options, run) {
  const plist = join(report.appPath, 'Contents/Info.plist');
  for (const [key, name, expected] of [
    ['CFBundleIdentifier', 'bundleId', options.expectedAppId],
    ['CFBundleShortVersionString', 'shortVersion', options.expectedVersion],
    ['CFBundleVersion', 'buildVersion', options.expectedBuildVersion],
    ['CFBundleExecutable', 'executable', undefined],
  ]) {
    const result = probe('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist], run);
    report[name] = result.stdout.trim();
    addCheck(report, key, result.ok && Boolean(report[name]) && (!expected || report[name] === expected), result.text);
  }
  const safe = /^[^/\\:\x00-\x1f\x7f]+$/.test(report.executable) && !['.', '..'].includes(report.executable);
  addCheck(report, 'executable-basename', safe, report.executable);
  if (!safe) return;
  const executable = join(report.appPath, 'Contents/MacOS', report.executable);
  if (!inside(report.appPath, executable) || !lstatSync(executable).isFile()) throw new Error('Executable escapes bundle or is not a regular file');
  const arch = probe('/usr/bin/lipo', ['-archs', executable], run);
  report.architectures = arch.stdout.trim().split(/\s+/).filter(Boolean);
  const expected = options.expectedArch === 'x64' ? 'x86_64' : options.expectedArch;
  addCheck(report, 'architecture', arch.ok && report.architectures.length === 1
    && ['arm64', 'x86_64'].includes(report.architectures[0])
    && (!expected || report.architectures[0] === expected), arch.text);
}

/**
 * @param {string} appPath
 * @param {{expectedTeam?: string, expectedArch?: string, expectedAppId?: string, expectedVersion?: string, expectedBuildVersion?: string, requireStapled?: boolean}} options
 * @param {NativeRunner} run
 */
export function verifyMacSignature(appPath, options = {}, run = spawnSync) {
  const report = { appPath: resolve(appPath), ok: false, checks: [] };
  try {
    if (!lstatSync(report.appPath).isDirectory()) throw new Error('No regular app bundle directory');
    inspectSignature(report, { requireStapled: true, ...options }, run);
    inspectBundle(report, options, run);
  } catch (error) {
    addCheck(report, 'bundle-readable', false, error.message);
  }
  report.ok = report.checks.length > 0 && report.checks.every((check) => check.ok);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const appPath = resolve(process.argv[2] ?? 'dist/mac-arm64/ima2.app');
    const report = verifyMacSignature(appPath, {
      ...readMacExpectations(), expectedTeam: process.env.APPLE_TEAM_ID,
      requireStapled: process.env.VERIFY_REQUIRE_STAPLED !== '0',
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error('[verify-mac-signature] FAIL: ' + error.message);
    process.exitCode = 1;
  }
}
