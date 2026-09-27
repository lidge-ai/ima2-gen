import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import verifyBundledDependencies, { missingBundledDependencies, packagedAppDir } from '../desktop/build/verify-bundled-deps.mjs';

function packagedApp(t, installed: string[]) {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'ima2-bundled-deps-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const context = { electronPlatformName: 'darwin', appOutDir: root, packager: { appInfo: { productFilename: 'ima2' } } };
  const appDir = packagedAppDir(context);
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(join(appDir, 'package.json'), JSON.stringify({ dependencies: { dotenv: '^18.0.1', '@modelcontextprotocol/sdk': '1.30.0' } }));
  for (const name of installed) {
    const dir = join(appDir, 'node_modules', ...name.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'package.json'), '{}');
  }
  return { context, appDir };
}

test('fails the package when node_modules was omitted (desktop-v3.20.0..v3.23.1 regression)', (t) => {
  const { context } = packagedApp(t, []);
  assert.throws(() => verifyBundledDependencies(context), /missing production dependencies: dotenv, @modelcontextprotocol\/sdk/);
});

test('passes when every declared dependency, including scoped ones, is bundled', (t) => {
  const { context, appDir } = packagedApp(t, ['dotenv', '@modelcontextprotocol/sdk']);
  assert.deepEqual(missingBundledDependencies(appDir), []);
  assert.doesNotThrow(() => verifyBundledDependencies(context));
});

test('resolves Resources/app for Windows and Linux layouts', () => {
  const appDir = packagedAppDir({ electronPlatformName: 'win32', appOutDir: '/out/win-unpacked' });
  assert.equal(appDir, join('/out/win-unpacked', 'resources', 'app'));
});
