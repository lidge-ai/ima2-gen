import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import signExtraBinaries from '../desktop/build/sign-extra-binaries.mjs';

const HASH = 'A'.repeat(40);
const OTHER = 'B'.repeat(40);
const identity = (hash = HASH, name = 'Developer ID Application: Example (TEAM123456)') => '  1) ' + hash + ' "' + name + '"\n';
const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });

function fixture(t) {
  const parent = fs.realpathSync(tmpdir());
  const root = fs.realpathSync(fs.mkdtempSync(join(parent, 'ima2-hook-test-')));
  t.after(() => {
    assert.equal(fs.realpathSync(root), root);
    assert.ok(root.startsWith(join(parent, 'ima2-hook-test-')));
    fs.rmSync(root, { recursive: true, force: false });
  });
  const resources = join(root, 'ima2.app/Contents/Resources');
  fs.mkdirSync(resources, { recursive: true });
  const context = {
    electronPlatformName: 'darwin', appOutDir: root,
    packager: { config: { forceCodeSigning: true, mac: {} },
      get forceCodeSigning() { return this.config.forceCodeSigning; },
      appInfo: { productFilename: 'ima2' }, codeSigningInfo: { value: Promise.resolve({ keychainFile: '/owned/signing.keychain' }) } },
  };
  const calls: { cmd: string; args: string[] }[] = [];
  const run = (cmd, args) => {
    calls.push({ cmd, args });
    return success(cmd === '/usr/bin/security' ? identity() : '');
  };
  const binary = (name, magic = 0xfeedfacf) => {
    const path = join(resources, name);
    fs.mkdirSync(dirname(path), { recursive: true });
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32BE(magic);
    fs.writeFileSync(path, bytes);
    return path;
  };
  return { root, resources, context, calls, run, binary };
}

test('hook awaits deferred builder import and signs/strictly verifies in the same keychain', async (t) => {
  const f = fixture(t);
  const deep = f.binary('nested/no-extension');
  const shallow = f.binary('shallow');
  let complete;
  f.context.packager.codeSigningInfo.value = new Promise((resolve) => { complete = resolve; });
  const signing = signExtraBinaries(f.context, { env: { CSC_LINK: 'fixture-only' }, run: f.run });
  assert.equal(f.calls.length, 0);
  complete({ keychainFile: '/owned/imported.keychain' });
  await signing;
  assert.deepEqual(f.calls[0], { cmd: '/usr/bin/security', args: ['find-identity', '-v', '-p', 'codesigning', '/owned/imported.keychain'] });
  const signs = f.calls.filter(({ args }) => args.includes('--sign'));
  assert.deepEqual(signs.map(({ args }) => args.at(-1)), [deep, shallow]);
  for (const { args } of signs) {
    assert.equal(args[args.indexOf('--keychain') + 1], '/owned/imported.keychain');
    assert.equal(args[args.indexOf('--sign') + 1], HASH);
    assert.ok(args.includes('--timestamp'));
    assert.ok(args.includes('runtime'));
  }
  assert.deepEqual(f.calls.filter(({ args }) => args.includes('--verify')).map(({ args }) => args),
    [deep, shallow].map((path) => ['--verify', '--strict', '--verbose=2', path]));
});

test('all eight Mach-O/FAT/FAT64 magics sign, ordinary and tiny files do not', async (t) => {
  const f = fixture(t);
  const magics = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca];
  const expected = magics.map((magic, i) => f.binary('extensionless-' + i, magic)).sort();
  fs.writeFileSync(join(f.resources, 'ordinary'), 'ordinary text');
  fs.writeFileSync(join(f.resources, 'tiny'), 'hi');
  await signExtraBinaries(f.context, { env: {}, run: f.run });
  assert.deepEqual(f.calls.filter(({ args }) => args.includes('--sign')).map(({ args }) => args.at(-1)).sort(), expected);
});

test('explicit preview skips lazy keychain access even when credential env is present', async (t) => {
  const f = fixture(t);
  f.context.packager.config.forceCodeSigning = false;
  Object.defineProperty(f.context.packager.codeSigningInfo, 'value', { get() { throw new Error('must not import'); } });
  await signExtraBinaries(f.context, { env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_LINK: 'fixture-only' }, run: f.run });
  assert.equal(f.calls.length, 0);
  f.context.electronPlatformName = 'win32';
  await signExtraBinaries(f.context, { env: {}, run: f.run });
});

for (const selector of [HASH, 'Example', 'TEAM123456']) {
  test('CSC_NAME selects supported hash/qualifier: ' + selector, async (t) => {
    const f = fixture(t);
    f.binary('binary');
    await signExtraBinaries(f.context, { env: { CSC_NAME: selector }, run: (cmd, args) => {
      f.calls.push({ cmd, args });
      return success(cmd.endsWith('/security') ? identity() + identity(OTHER, 'Developer ID Application: Different (OTHER12345)') : '');
    } });
    const args = f.calls.find(({ args }) => args.includes('--sign')).args;
    assert.equal(args[args.indexOf('--sign') + 1], HASH);
  });
}

test('duplicate identity hashes do not create ambiguity; default keychain supports local signing', async (t) => {
  const f = fixture(t);
  f.binary('binary');
  f.context.packager.codeSigningInfo.value = Promise.resolve({ keychainFile: null });
  await signExtraBinaries(f.context, { env: {}, run: (cmd, args) => {
    f.calls.push({ cmd, args });
    return success(cmd.endsWith('/security') ? identity() + identity() : '');
  } });
  assert.equal(f.calls[0].args.length, 4);
  assert.equal(f.calls.filter(({ args }) => args.includes('--sign')).length, 1);
  assert.ok(f.calls.every(({ args }) => !args.includes('--keychain')));
});

for (const [name, listing, selector, error] of [
  ['distinct ambiguity', identity() + identity(OTHER), '', /ambiguous/],
  ['missing identity', '', '', /no matching/],
  ['wrong certificate', identity(HASH, 'Apple Development: Example'), '', /no matching/],
  ['unmatched qualifier', identity(), 'Missing', /no matching/],
  ['hash case rejected by outer builder', identity(), HASH.toLowerCase(), /no matching/],
  ['full certificate prefix', identity(), 'Developer ID Application: Example', /prefix/],
  ['installer prefix', identity(), 'Developer ID Installer: Example', /prefix/],
] as const) {
  test('forced hook rejects ' + name, async (t) => {
    const f = fixture(t);
    await assert.rejects(signExtraBinaries(f.context, { env: { CSC_NAME: selector }, run: (cmd, args) => {
      f.calls.push({ cmd, args }); return success(listing);
    } }), error);
    assert.ok(f.calls.every(({ cmd }) => cmd === '/usr/bin/security'));
  });
}

test('force rejects unsigned override, missing API, and missing imported keychain before lookup', async (t) => {
  const f = fixture(t);
  await assert.rejects(signExtraBinaries(f.context, { env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, run: f.run }), /unsigned override/);
  f.context.packager.codeSigningInfo.value = Promise.resolve({ keychainFile: null });
  await assert.rejects(signExtraBinaries(f.context, { env: { CSC_LINK: 'fixture-only' }, run: f.run }), /no keychain/);
  Reflect.deleteProperty(f.context.packager, 'codeSigningInfo');
  await assert.rejects(signExtraBinaries(f.context, { env: {}, run: f.run }), /signing API/);
  assert.equal(f.calls.length, 0);
});

test('hook follows the packager forceCodeSigning getter including platform overrides', async (t) => {
  const f = fixture(t);
  f.context.packager.config.forceCodeSigning = false;
  Object.defineProperty(f.context.packager, 'forceCodeSigning', { get: () => true, configurable: true });
  await assert.rejects(signExtraBinaries(f.context, { env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, run: f.run }), /unsigned override/);
  f.context.packager.config.forceCodeSigning = true;
  Object.defineProperty(f.context.packager, 'forceCodeSigning', { get: () => false });
  await signExtraBinaries(f.context, { env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, run: f.run });
  assert.equal(f.calls.length, 0);
});

test('failed import promise propagates without lookup, signing or guessed cleanup', async (t) => {
  const f = fixture(t);
  Object.defineProperty(f.context.packager.codeSigningInfo, 'value', { get: () => Promise.reject(new Error('import failed')) });
  await assert.rejects(signExtraBinaries(f.context, { env: { CSC_LINK: 'fixture-only' }, run: f.run }), /import failed/);
  assert.deepEqual(f.calls, []);
});

for (const failure of ['lookup', 'sign', 'verify']) {
  test('native ' + failure + ' failure cannot pass with plausible output', async (t) => {
    const f = fixture(t);
    f.binary('binary');
    await assert.rejects(signExtraBinaries(f.context, { env: {}, run: (cmd, args) => {
      const failed = failure === 'lookup' ? cmd.endsWith('/security') : args.includes(failure === 'sign' ? '--sign' : '--verify');
      return { ...success(identity()), status: failed ? 1 : 0 };
    } }), /failed/);
  });
}

test('missing scan tree and unreadable Mach-O fail closed', async (t) => {
  const f = fixture(t);
  f.context.appOutDir = join(f.root, 'absent');
  await assert.rejects(signExtraBinaries(f.context, { env: {}, run: f.run }), /ENOENT/);
  f.context.appOutDir = f.root;
  const binary = f.binary('unreadable');
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (path, ...args) => {
    if (path === binary) throw new Error('EACCES fixture read denied');
    return Reflect.apply(open, fs, [path, ...args]);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(signExtraBinaries(f.context, { env: {}, run: f.run }), /EACCES/);
    assert.ok(f.calls.every(({ cmd }) => cmd === '/usr/bin/security'));
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test('hook imports and runs outside the repo with only built-in modules', async (t) => {
  const f = fixture(t);
  const isolated = join(f.root, 'isolated-hook.mjs');
  fs.copyFileSync(new URL('../desktop/build/sign-extra-binaries.mjs', import.meta.url), isolated);
  const hook = await import(pathToFileURL(isolated).href);
  await hook.default({ electronPlatformName: 'win32' });
});
