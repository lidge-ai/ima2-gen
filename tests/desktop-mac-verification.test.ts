import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { probe, verifyMacSignature } from '../desktop/scripts/verify-mac-signature.mjs';
import { verifyMacArtifacts } from '../desktop/scripts/verify-mac-artifacts.mjs';

const TEAM = 'TEAM123456';
const HEAD = 'd'.repeat(40);
const VERSION = '8.7.6';
const APP_ID = 'com.fixture.ima2';
const OPTIONS = { expectedTeam: TEAM, expectedArch: 'arm64', expectedAppId: APP_ID, expectedVersion: VERSION };
const success = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
const metadataPath = (app) => join(app, 'Contents/fixture.json');

function removeOwnedFixture(path: string, parent: string, prefix: string) {
  if (!existsSync(path)) return;
  assert.equal(realpathSync(path), resolve(path));
  assert.ok(path.startsWith(join(parent, prefix)));
  rmSync(path, { recursive: true, force: false });
}

function makeApp(app, arch) {
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), 'native PlistBuddy double fixture');
  writeFileSync(join(app, 'Contents/MacOS/ima2'), Buffer.from('cffaedfe00000000', 'hex'));
  writeFileSync(metadataPath(app), JSON.stringify({
    arch, executable: 'ima2', bundleId: APP_ID, shortVersion: VERSION, buildVersion: VERSION + '.42',
    team: TEAM, authority: 'Developer ID Application: Example (' + TEAM + ')',
    cdHash: (arch === 'arm64' ? 'a' : 'b').repeat(40), runtime: true, timestamp: true,
  }));
}

function changeApp(app, changes) {
  writeFileSync(metadataPath(app), JSON.stringify({ ...JSON.parse(readFileSync(metadataPath(app), 'utf8')), ...changes }));
}

function nativeSignature(cmd, args) {
  const subject = args.at(-1);
  const app = cmd.endsWith('/PlistBuddy') || cmd.endsWith('/lipo')
    ? subject.slice(0, subject.lastIndexOf('Contents') - 1) : subject;
  const data = JSON.parse(readFileSync(metadataPath(app), 'utf8'));
  if (cmd.endsWith('/codesign') && args.includes('-dv')) {
    return success('Executable=' + join(app, 'Contents/MacOS/ima2') + '\n',
      ['Authority=' + data.authority, 'TeamIdentifier=' + data.team, 'CDHash=' + data.cdHash,
        data.runtime ? 'CodeDirectory v=20500 flags=0x10000(runtime) hashes=12+7' : 'flags=0x0(none)',
        data.timestamp ? 'Timestamp=Sep 22, 2026 at 10:00:00 AM' : 'Signed Time=local'].join('\n'));
  }
  if (cmd.endsWith('/PlistBuddy')) {
    const names = { CFBundleIdentifier: 'bundleId', CFBundleShortVersionString: 'shortVersion',
      CFBundleVersion: 'buildVersion', CFBundleExecutable: 'executable' };
    return success(data[names[args[1].replace('Print :', '')]] + '\n');
  }
  if (cmd.endsWith('/lipo')) return success(data.arch === 'x64' ? 'x86_64\n' : data.arch + '\n');
  if (cmd.endsWith('/codesign')) return success('', 'valid on disk\nsatisfies its Designated Requirement');
  if (cmd.endsWith('/spctl')) return success('', 'accepted\nsource=Notarized Developer ID');
  if (cmd.endsWith('/xcrun')) return success('The validate action worked!');
  throw new Error('Unexpected native command ' + cmd);
}

function fixture(t) {
  const parent = realpathSync(tmpdir());
  const root = realpathSync(mkdtempSync(join(parent, 'ima2-verifier-test-')));
  const dist = join(root, 'desktop/dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: VERSION }));
  writeFileSync(join(root, 'desktop/electron-builder.yml'), 'appId: "' + APP_ID + '"\n');
  const originals = { arm64: join(dist, 'mac-arm64/ima2.app'), x64: join(dist, 'mac/ima2.app') };
  for (const arch of ['arm64', 'x64']) {
    makeApp(originals[arch], arch);
    for (const ext of ['zip', 'dmg']) writeFileSync(join(dist, 'ima2-' + VERSION + '-mac-' + arch + '.' + ext), arch + ':' + ext);
  }
  const owned = new Set<string>();
  t.after(() => {
    // These are fixture directories only: no native mounting occurs in this test.
    for (const path of owned) removeOwnedFixture(path, parent, 'ima2-signature-');
    removeOwnedFixture(root, parent, 'ima2-verifier-test-');
  });
  const calls: { cmd: string; args: string[]; options: object }[] = [];
  const settings = { exportedChanges: {}, fail: (_cmd, _args) => false, extractedMissingApp: false };
  const run = (cmd, args, options = {}) => {
    calls.push({ cmd, args, options });
    if (cmd === 'git') return settings.fail(cmd, args) ? { ...success(HEAD), status: 1 } : success(HEAD + '\n');
    if (cmd.endsWith('/ditto') || (cmd.endsWith('/hdiutil') && args[0] === 'attach')) {
      const archive = cmd.endsWith('/ditto') ? args[2] : args.at(-1);
      const target = cmd.endsWith('/ditto') ? args[3] : args[args.indexOf('-mountpoint') + 1];
      owned.add(dirname(target));
      const arch = archive.includes('-arm64.') ? 'arm64' : 'x64';
      if (!settings.extractedMissingApp) {
        cpSync(originals[arch], join(target, 'ima2.app'), { recursive: true });
        changeApp(join(target, 'ima2.app'), settings.exportedChanges);
      }
      return { ...success('created content'), status: settings.fail(cmd, args) ? 1 : 0 };
    }
    if (cmd.endsWith('/hdiutil') && args[0] === 'detach') return { ...success('detached'), status: settings.fail(cmd, args) ? 1 : 0 };
    const result = nativeSignature(cmd, args);
    return { ...result, status: settings.fail(cmd, args) ? 1 : 0 };
  };
  return { root, dist, originals, owned, calls, settings, run, env: {
    APPLE_TEAM_ID: TEAM, CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_SHA: HEAD,
    GITHUB_REF: 'refs/heads/audited', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    CSC_KEY_PASSWORD: 'NEVER-IN-PROOF', APPLE_APP_SPECIFIC_PASSWORD: 'NEVER-IN-PROOF',
  } };
}

function persisted(report) {
  const saved = JSON.parse(readFileSync(report.reportPath, 'utf8'));
  assert.equal(saved.ok, report.ok);
  return saved;
}

test('native verifier combines stdout/stderr and verifies actual metadata and x64 mapping', (t) => {
  const f = fixture(t);
  for (const arch of ['arm64', 'x64']) {
    const report = verifyMacSignature(f.originals[arch], { ...OPTIONS, expectedArch: arch }, f.run);
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.ok(report.checks.every((check) => check.ok));
    assert.ok(report.checks.find((check) => check.name === 'codesign-info').detail.includes('Executable='));
    assert.ok(report.checks.find((check) => check.name === 'codesign-info').detail.includes('Authority='));
  }
  assert.ok(f.calls.some(({ args }) => args.includes('--deep') && args.includes('--strict')));
  assert.ok(f.calls.some(({ args }) => args[0] === 'stapler' && args[1] === 'validate'));
});

for (const [name, changes] of [
  ['wrong team', { team: 'OTHER12345' }], ['wrong arch', { arch: 'x64' }],
  ['missing arch', { arch: '' }], ['universal instead of single arch', { arch: 'arm64 x86_64' }],
  ['wrong app ID', { bundleId: 'com.other.app' }], ['wrong short version', { shortVersion: '1.0.0' }],
  ['missing build version', { buildVersion: '' }], ['missing CDHash', { cdHash: '' }],
  ['development authority', { authority: 'Apple Development: Example' }],
  ['ad-hoc authority', { authority: '', cdHash: 'a'.repeat(40) }],
  ['missing runtime', { runtime: false }], ['missing secure timestamp', { timestamp: false }],
  ['executable traversal', { executable: '../escape' }], ['absolute executable', { executable: '/bin/sh' }],
  ['backslash executable', { executable: '..\\escape' }], ['dot executable', { executable: '.' }],
] as const) {
  test('native verifier rejects ' + name, (t) => {
    const f = fixture(t);
    changeApp(f.originals.arm64, changes);
    const report = verifyMacSignature(f.originals.arm64, OPTIONS, f.run);
    assert.equal(report.ok, false, JSON.stringify(report));
    if (name.includes('executable')) assert.ok(!f.calls.some(({ cmd }) => cmd.endsWith('/lipo')));
  });
}

for (const command of ['info', 'strict', 'gatekeeper', 'staple', 'plist', 'lipo']) {
  test('plausible output cannot rescue failed ' + command + ' status', (t) => {
    const f = fixture(t);
    f.settings.fail = (cmd, args) => ({
      info: cmd.endsWith('/codesign') && args.includes('-dv'),
      strict: cmd.endsWith('/codesign') && args.includes('--verify'),
      gatekeeper: cmd.endsWith('/spctl'), staple: cmd.endsWith('/xcrun'),
      plist: cmd.endsWith('/PlistBuddy'), lipo: cmd.endsWith('/lipo'),
    })[command];
    assert.equal(verifyMacSignature(f.originals.arm64, OPTIONS, f.run).ok, false);
  });
}

test('probe rejects thrown errors, spawn errors and signal exits', () => {
  for (const run of [
    () => { throw new Error('spawn failed'); },
    () => ({ ...success('accepted'), error: new Error('spawn failed') }),
    () => ({ ...success('accepted'), status: null }),
  ]) assert.equal(probe('native', [], run).ok, false);
});

test('both original architectures and all exports pass before SHA-256 proof is issued', async (t) => {
  const f = fixture(t);
  const report = await verifyMacArtifacts(f, f.run);
  assert.equal(report.ok, true, JSON.stringify(report));
  const saved = persisted(report);
  assert.equal(Object.keys(saved.originals).length, 2);
  assert.equal(saved.exports.length, 4);
  assert.equal(saved.hashes.length, 4);
  assert.ok(saved.hashes.every((entry) => /^[a-f\d]{64}$/.test(entry.sha256)));
  assert.ok(saved.exports.every((entry) => entry.ok && entry.cleanup.ok && entry.equivalence.ok));
  assert.deepEqual(saved.source, { sha: HEAD, githubSha: HEAD, ref: f.env.GITHUB_REF,
    event: 'workflow_dispatch', runId: '123', attempt: '2' });
  assert.equal(saved.expected.expectedAppId, APP_ID);
  assert.equal(saved.expected.expectedVersion, VERSION);
  assert.ok(!JSON.stringify(saved).includes('NEVER-IN-PROOF'));
  for (const path of f.owned) assert.equal(existsSync(path), false);
  const mounts = f.calls.filter(({ cmd, args }) => cmd.endsWith('/hdiutil') && args[0] === 'attach');
  assert.equal(mounts.length, 2);
  assert.ok(mounts.every(({ args }) => args.includes('-readonly') && args.includes('-nobrowse')));
});

for (const [name, changes] of [
  ['CDHash', { cdHash: 'c'.repeat(40) }], ['bundle ID', { bundleId: 'com.other.app' }],
  ['short version', { shortVersion: '0.0.1' }], ['build version', { buildVersion: '8.7.6.999' }],
  ['team', { team: 'OTHER12345' }], ['architecture', { arch: 'ppc' }],
] as const) {
  test('export substitution of ' + name + ' fails with retained proof and no hashes', async (t) => {
    const f = fixture(t);
    f.settings.exportedChanges = changes;
    const report = await verifyMacArtifacts(f, f.run);
    assert.equal(report.ok, false);
    assert.deepEqual(persisted(report).hashes, []);
    assert.ok(report.exports.every((entry) => !entry.ok));
    if (['CDHash', 'build version'].includes(name)) {
      assert.ok(report.exports.every((entry) => entry.verification.ok && !entry.equivalence.ok));
    }
    for (const path of f.owned) assert.equal(existsSync(path), false);
  });
}

test('artifact gate requires staples even with legacy VERIFY_REQUIRE_STAPLED=0', async (t) => {
  const f = fixture(t);
  f.settings.fail = (cmd) => cmd.endsWith('/xcrun');
  const report = await verifyMacArtifacts({ ...f, env: { ...f.env, VERIFY_REQUIRE_STAPLED: '0' } }, f.run);
  assert.equal(report.ok, false);
  assert.equal(f.calls.filter(({ cmd }) => cmd.endsWith('/xcrun')).length, 6);
  assert.deepEqual(persisted(report).hashes, []);
});

for (const missing of ['mac-arm64/ima2.app', 'mac/ima2.app',
  ...['arm64', 'x64'].flatMap((arch) => ['zip', 'dmg'].map((ext) => 'ima2-' + VERSION + '-mac-' + arch + '.' + ext))]) {
  test('missing output ' + missing + ' fails with report', async (t) => {
    const f = fixture(t);
    const target = realpathSync(join(f.dist, missing));
    const scoped = relative(f.root, target);
    assert.ok(scoped && scoped !== '..' && !scoped.startsWith('..' + sep) && !isAbsolute(scoped));
    rmSync(target, { recursive: true });
    const report = await verifyMacArtifacts(f, f.run);
    assert.equal(report.ok, false);
    assert.deepEqual(persisted(report).hashes, []);
  });
}

test('unexpected mac export and missing recovered app fail closed', async (t) => {
  const f = fixture(t);
  const stale = join(f.dist, 'ima2-old-mac-x64.zip');
  writeFileSync(stale, 'stale');
  assert.equal((await verifyMacArtifacts(f, f.run)).ok, false);
  rmSync(stale);
  f.settings.extractedMissingApp = true;
  const report = await verifyMacArtifacts(f, f.run);
  assert.equal(report.ok, false);
  assert.ok(report.exports.every((entry) => entry.error.includes('exactly ima2.app')));
  persisted(report);
});

for (const failure of ['extract', 'attach', 'detach', 'export verification']) {
  test(failure + ' failure retains report and safely handles owned content', async (t) => {
    const f = fixture(t);
    f.settings.fail = (cmd, args) => {
      if (failure === 'extract') return cmd.endsWith('/ditto');
      if (failure === 'export verification') return cmd.endsWith('/codesign') && args.includes('--verify') && args.at(-1).includes('ima2-signature-');
      return cmd.endsWith('/hdiutil') && args[0] === failure;
    };
    const report = await verifyMacArtifacts(f, f.run);
    assert.equal(report.ok, false);
    const saved = persisted(report);
    assert.deepEqual(saved.hashes, []);
    for (const entry of saved.exports) {
      if (['attach', 'detach'].includes(failure) && entry.format === 'dmg') {
        assert.equal(entry.cleanup.ok, false);
        assert.ok(existsSync(join(entry.cleanup.retainedPath, 'content/ima2.app')));
      } else assert.equal(entry.cleanup.ok, true);
    }
    if (failure === 'attach') assert.ok(!f.calls.some(({ args }) => args[0] === 'detach'));
  });
}

test('cleanup failure prevents hashes and preserves owned directory plus failed report', async (t) => {
  const f = fixture(t);
  const remove = fs.rmSync;
  t.mock.method(fs, 'rmSync', (path, options) => {
    if (String(path).includes('ima2-signature-')) throw new Error('EACCES fixture cleanup denied');
    return remove(path, options);
  });
  syncBuiltinESMExports();
  try {
    const report = await verifyMacArtifacts(f, f.run);
    assert.equal(report.ok, false);
    assert.deepEqual(persisted(report).hashes, []);
    assert.ok(report.exports.every((entry) => !entry.cleanup.ok && existsSync(entry.cleanup.retainedPath)));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('changed extraction directory identity prevents recursive cleanup and successful proof', async (t) => {
  const f = fixture(t);
  const changed = new Set<string>();
  let injected = 0;
  const inspect = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (path, ...args) => {
    const stat = Reflect.apply(inspect, fs, [path, ...args]);
    if (!changed.has(resolve(String(path)))) return stat;
    injected++;
    const ino = typeof stat.ino === 'bigint' ? stat.ino + 1n : stat.ino + 1;
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { ino });
  });
  syncBuiltinESMExports();
  try {
    const report = await verifyMacArtifacts(f, (cmd, args, options) => {
      const result = f.run(cmd, args, options);
      if (cmd.endsWith('/hdiutil') && args[0] === 'detach') changed.add(resolve(dirname(args[1])));
      return result;
    });
    assert.equal(report.ok, false);
    assert.ok(injected > 0);
    assert.deepEqual(persisted(report).hashes, []);
    for (const entry of report.exports.filter((value) => value.format === 'dmg')) {
      assert.equal(entry.cleanup.ok, false);
      assert.match(entry.cleanup.error, /identity changed/);
      assert.ok(existsSync(entry.cleanup.retainedPath));
    }
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

for (const problem of ['missing team', 'missing CI SHA', 'wrong CI SHA', 'git failure', 'invalid yaml']) {
  test(problem + ' fails before native app verification and retains report', async (t) => {
    const f = fixture(t);
    if (problem === 'missing team') f.env.APPLE_TEAM_ID = '';
    if (problem === 'missing CI SHA') f.env.GITHUB_SHA = '';
    if (problem === 'wrong CI SHA') f.env.GITHUB_SHA = 'e'.repeat(40);
    if (problem === 'git failure') f.settings.fail = (cmd) => cmd === 'git';
    if (problem === 'invalid yaml') writeFileSync(join(f.root, 'desktop/electron-builder.yml'), 'appId: [broken');
    const report = await verifyMacArtifacts(f, f.run);
    assert.equal(report.ok, false);
    assert.deepEqual(persisted(report).hashes, []);
    assert.equal(f.calls.filter(({ cmd }) => cmd !== 'git').length, 0);
  });
}

test('real artifact CLI exits nonzero and writes proof when validation cannot run', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [resolve('desktop/scripts/verify-mac-artifacts.mjs'), '--dist', f.dist],
    { encoding: 'utf8', env: { ...process.env, APPLE_TEAM_ID: '' } });
  assert.equal(result.status, 1, result.stderr);
  const saved = JSON.parse(readFileSync(join(f.dist, 'signature-proof/report.json'), 'utf8'));
  assert.equal(saved.ok, false);
  assert.deepEqual(saved.hashes, []);
});

test('legacy CLI still accepts positional bundle path and fails on missing bundle', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [resolve('desktop/scripts/verify-mac-signature.mjs'), join(f.root, 'missing.app')],
    { encoding: 'utf8', env: { ...process.env, VERIFY_REQUIRE_STAPLED: '0' } });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
