import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import { assertAllActionsPinned } from './_actionPins.mjs';
import { executionChildEnv } from './_executionTestProcess.ts';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DRIVER = join(REPO, 'scripts/run-agy-artifact-check.mjs');
const WORKFLOW = join(REPO, '.github/workflows/agy-artifact-check.yml');
// Independent 066_1 oracles. Never import or extract these from the driver.
const FIXTURES: Record<string, string[]> = {
  'agy-artifact-confinement.test.ts': [
    'Agy artifact accepts owned regular bytes and guarded cleanup',
    'Agy artifact rejects leaf symlinks without reading or deleting targets',
    'Agy artifact rejects changed identity before return',
    'Agy artifact cleanup preserves replacement and concurrent siblings',
  ],
  'agy-artifact-read-bounds.test.ts': [
    'Agy artifact reader uses bounded chunks and no readFile',
    'Agy artifact reader rejects overflow before concatenation',
    'Agy artifact reader closes on read error and cancellation',
    'Agy emitted artifact reader enforces tiny policy and cleanup',
  ],
  'agy-artifact-fallback.test.ts': ['findRecentAgyArtifact returns matching file within time window'],
  'agy-execution-cleanup.test.ts': [
    'Agy ordinary success activates exact staging/read/removal hooks',
    'Agy abort during successful held reference removal is caught after cleanup',
    'Agy primary read EIO survives abort during held reference cleanup',
  ],
  'agy-execution-process.test.ts': process.platform === 'win32' ? [
    'Windows Agy cancellation closes before one rejection',
    'Windows Agy timeout keeps first reason through abrupt close',
    'Windows Agy watchdog reaps suppressed DUT termination',
    'Windows Agy parent SystemRoot toggle isolates native startup',
  ] : [
    'native cooperative cancellation observes close before rejection',
    'native TERM-ignoring cancellation observes close before rejection',
    'timeout wins first reason over later external abort and waits native KILL/close',
    'native watchdog reaps a missing-DUT-KILL child and close fails its violation ledger',
  ],
};
const BOUND_CASES = [
  '[hosted CI] Agy artifact exact 50MiB succeeds',
  '[hosted CI] Agy artifact declared 50MiB plus one rejects',
  '[hosted CI] Agy artifact growth beyond 50MiB rejects',
  '[hosted CI] Agy artifact streamed cap rejects 50MiB plus one',
];

function fixtureSource(file: string, heavyAllowed: boolean) {
  const names = FIXTURES[file];
  const heavy = file === 'agy-artifact-read-bounds.test.ts' ? BOUND_CASES : [];
  return `
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { writeFileSync } from 'node:fs';
import { executionTestProcess } from ${JSON.stringify(pathToFileURL(join(REPO, 'tests/_executionTestProcess.ts')).href)};
mock.module('node:os', { namedExports: { tmpdir: () => 'native-tiny-fixture' } });
assert.equal((await import('node:os')).tmpdir(), 'native-tiny-fixture');
if (executionTestProcess(import.meta.url)) {
  const registerOrdinary = async (context) => {
  for (const name of ${JSON.stringify(names)}) await context.test(name, () => {
    for (const key of ['HOME', 'USERPROFILE', 'NODE_OPTIONS', 'AGY_API_KEY', 'GITHUB_ACTIONS', 'AGY_NPM_CLI', 'npm_execpath'])
      assert.equal(process.env[key], undefined, key + ' leaked');
    writeFileSync(new URL('./' + ${JSON.stringify(file)} + '.executed', import.meta.url), 'ordinary body ran');
  });
  };
  ${file === 'agy-execution-process.test.ts'
    ? "await test('tiny process fixture group', registerOrdinary);"
    : 'await registerOrdinary({ test });'}
  for (const name of ${JSON.stringify(heavy)}) test(name, () => {
    ${heavyAllowed ? 'assert.equal(2 + 2, 4);' : "throw new Error('tiny heavy body selected by light driver');"}
  });
}
`;
}

async function withFixtures(work: (root: string) => Promise<void>, heavyAllowed = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agy-driver-contract-')));
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    for (const file of Object.keys(FIXTURES)) writeFileSync(join(root, file), fixtureSource(file, heavyAllowed));
    writeFileSync(join(root, 'must-not-discover.test.ts'), "throw new Error('unexpected discovery');");
    await work(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function copiedDriver(root: string, from: string, to: string) {
  const source = readFileSync(DRIVER, 'utf8');
  assert.equal(source.split(from).length, 2, 'mutation must replace exactly one source site');
  const path = join(root, 'driver-copy.mjs');
  writeFileSync(path, source.replace(from, to));
  writeFileSync(join(root, 'npm-subprocess.mjs'), readFileSync(join(REPO, 'scripts/npm-subprocess.mjs')));
  return path;
}

async function invoke(root: string, options: { driver?: string; mode?: string; env?: NodeJS.ProcessEnv } = {}) {
  const output = join(root, 'receipts');
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [options.driver ?? DRIVER, options.mode ?? '--light',
        '--test-root', root, '--output-dir', output], {
        cwd: REPO, env: { ...executionChildEnv(), ...options.env }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', (chunk) => { text += chunk; });
      child.stderr.on('data', (chunk) => { text += chunk; });
      // The real driver handles TERM by killing its owned child tree, then awaits close.
      const timer = setTimeout(() => child.kill('SIGTERM'), 45_000);
      child.once('error', reject);
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal, output: text });
      });
    });
    assert.equal(result.signal, null, result.output);
    return { ...result, receipts: output };
  } catch (error) { throw error; }
}

function summary(root: string) { return JSON.parse(readFileSync(join(root, 'receipts/summary.json'), 'utf8')); }

function npmFixture(root: string, version = '12.0.0') {
  const prefix = join(root, 'pinned npm');
  const cli = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules/npm/bin/npm-cli.js');
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, `if (process.argv.length !== 3 || process.argv[2] !== '--version') throw new Error('unexpected npm fixture args');\nconsole.log(${JSON.stringify(version)});\n`);
  return { prefix, cli };
}

test('Agy driver executes exactly five tiny files inline; light never executes heavy bodies', async () => {
  await withFixtures(async (root) => {
    const result = await invoke(root, { env: { HOME: root, USERPROFILE: root, AGY_API_KEY: 'fixture-only' } });
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(summary(root).files.map((file: { name: string }) => file.name), Object.keys(FIXTURES));
    for (const [file, names] of Object.entries(FIXTURES)) {
      assert.equal(readFileSync(join(root, `${file}.executed`), 'utf8'), 'ordinary body ran');
      const receipt = JSON.parse(readFileSync(join(result.receipts, `${file}.json`), 'utf8'));
      assert.equal(receipt.exitStatus, 0);
      assert.equal(receipt.platform, process.platform);
      assert.equal(receipt.node, process.versions.node);
      assert.match(receipt.actualSha, /^[a-f0-9]{40}$/);
      const expected = file === 'agy-execution-process.test.ts' ? [...names, 'tiny process fixture group'] : names;
      assert.deepEqual(receipt.rows.filter((row: { pass: boolean }) => row.pass).map((row: { name: string }) => row.name), expected);
      assert.ok(readFileSync(join(result.receipts, `${file}.tap`), 'utf8').startsWith('TAP version 13'));
    }
    assert.equal(readdirSync(result.receipts).length, 11);
    const stale = await invoke(root);
    assert.equal(stale.code, 1);
    assert.match(stale.output, /EEXIST/);
    assert.equal(summary(root).exitStatus, 0, 'stale output must not be overwritten');
  });
});

test('Agy driver propagates actual tiny ordinary failure', async () => {
  await withFixtures(async (root) => {
    const path = join(root, 'agy-artifact-confinement.test.ts');
    writeFileSync(path, readFileSync(path, 'utf8').replace("'ordinary body ran'", "(() => { throw new Error('deliberate ordinary failure'); })()"));
    const result = await invoke(root);
    assert.equal(result.code, 1);
    assert.match(readFileSync(join(result.receipts, 'agy-artifact-confinement.test.ts.tap'), 'utf8'), /deliberate ordinary failure/);
    assert.equal(summary(root).exitStatus, 1);
  });
});

for (const [label, from, to] of [
  ['native flag', "'--experimental-test-module-mocks', ", ''],
  ['inline marker', 'env.EXECUTION_TEST_FILE = pathToFileURL(file).href;', ''],
  ['light selector', "if (mode === 'light') args.push(`--test-skip-pattern=${SKIP_PATTERN}`);", ''],
]) test(`Agy real driver-copy mutation rejects removed ${label}`, async () => {
  await withFixtures(async (root) => {
    const result = await invoke(root, { driver: copiedDriver(root, from, to) });
    assert.equal(result.code, 1, result.output);
    assert.equal(summary(root).exitStatus, 1);
    if (label === 'native flag') {
      assert.match(readFileSync(join(result.receipts, 'agy-artifact-confinement.test.ts.tap'), 'utf8'), /experimental-test-module-mocks|mock\.module is not a function/);
    }
    if (label === 'inline marker') assert.match(result.output, /missing required PASS/);
    if (label === 'light selector') {
      assert.match(readFileSync(join(result.receipts, 'agy-artifact-read-bounds.test.ts.tap'), 'utf8'), /tiny heavy body selected/);
    }
  });
});

test('Agy driver watchdog kills the tiny child and drains close before fixture removal', async () => {
  await withFixtures(async (root) => {
    const path = join(root, 'agy-artifact-confinement.test.ts');
    writeFileSync(path, readFileSync(path, 'utf8') + '\nsetInterval(() => {}, 1000);\n');
    const result = await invoke(root, { driver: copiedDriver(root, 'const CHILD_DEADLINE_MS = 180_000;', 'const CHILD_DEADLINE_MS = 2_000;') });
    assert.equal(result.code, 1);
    assert.match(result.output, /child watchdog expired/);
    const receipt = JSON.parse(readFileSync(join(result.receipts, 'agy-artifact-confinement.test.ts.json'), 'utf8'));
    // Windows taskkill reports an exit code; POSIX process-group KILL reports a signal.
    assert.ok(receipt.signal !== null || receipt.code > 0, 'watchdog must record non-success termination');
    assert.ok(Number.isInteger(receipt.pid) && receipt.pid > 0);
    assert.throws(() => process.kill(receipt.pid, 0), { code: 'ESRCH' }, 'closed child must actually be gone');
  });
});

test('Agy light gate rejects heavy PASS rows even when tiny heavy bodies succeed', async () => {
  await withFixtures(async (root) => {
    const driver = copiedDriver(root, "if (mode === 'light') args.push(`--test-skip-pattern=${SKIP_PATTERN}`);", '');
    const result = await invoke(root, { driver });
    assert.equal(result.code, 1);
    assert.match(result.output, /heavy PASS in light mode/);
  }, true);
});

test('Agy driver rejects mismatched identity before running tiny files', async () => {
  for (const env of [{ WANT_SHA: '0'.repeat(40) }, { WANT_PLATFORM: 'wrong-platform' }, { WANT_NPM: '0.0.0' }]) {
    await withFixtures(async (root) => {
      const result = await invoke(root, { env });
      assert.equal(result.code, 1);
      assert.equal(summary(root).exitStatus, 1);
      assert.deepEqual(summary(root).files, []);
      assert.equal(existsSync(join(root, 'agy-artifact-confinement.test.ts.executed')), false);
    });
  }
});

test('Agy driver rejects absent emitted PASS and skipped platform PASS, even with exit zero', async () => {
  for (const [file, name, replacement] of [
    ['agy-artifact-read-bounds.test.ts', 'Agy emitted artifact reader enforces tiny policy and cleanup', 'different emitted case'],
    ['agy-execution-process.test.ts', FIXTURES['agy-execution-process.test.ts'][0], ''],
  ]) await withFixtures(async (root) => {
    const path = join(root, file);
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, replacement ? source.replace(name, replacement)
      : source.replace('test(name, () => {', 'test(name, { skip: true }, () => {'));
    const result = await invoke(root);
    assert.equal(result.code, 1);
    assert.match(result.output, /missing required PASS/);
  });
});

test('Agy heavy guard rejects local parent; hosted selector contract uses only tiny bodies', async () => {
  await withFixtures(async (root) => {
    const result = await invoke(root, { mode: '--hosted-heavy' });
    assert.equal(result.code, 1);
    assert.match(result.output, /requires parent GITHUB_ACTIONS=true/);
    assert.equal(existsSync(result.receipts), false);
  });
  await withFixtures(async (root) => {
    const result = await invoke(root, { mode: '--hosted-heavy', env: {
      GITHUB_ACTIONS: 'true', WANT_SHA: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
      WANT_NODE: process.versions.node,
      WANT_NPM: '12.0.0', AGY_NPM_CLI: npmFixture(root).cli,
      WANT_PLATFORM: process.platform,
    } });
    assert.equal(result.code, 0, result.output);
    const bounds = JSON.parse(readFileSync(join(result.receipts, 'agy-artifact-read-bounds.test.ts.json'), 'utf8'));
    assert.deepEqual(bounds.rows.filter((row: { name: string }) => row.name.startsWith('[hosted CI]'))
      .map((row: { name: string; pass: boolean }) => [row.name, row.pass]), BOUND_CASES.map((name) => [name, true]));
  }, true);
});

test('Agy driver uses explicit pinned npm instead of a stale ambient CLI and isolates children', async () => {
  for (const mutate of [false, true]) await withFixtures(async (root) => {
    const pinned = npmFixture(root), stale = join(root, 'stale-npm.mjs');
    writeFileSync(stale, 'console.log("11.13.0");');
    const driver = mutate ? copiedDriver(root, 'const path = process.env.AGY_NPM_CLI;', 'const path = process.env.npm_execpath;') : DRIVER;
    const result = await invoke(root, { driver, env: { AGY_NPM_CLI: pinned.cli, npm_execpath: stale, WANT_NPM: '12.0.0' } });
    assert.equal(result.code, mutate ? 1 : 0, result.output);
    assert.equal(summary(root).npm, mutate ? '11.13.0' : '12.0.0');
    assert.equal(summary(root).npmCli, realpathSync(mutate ? stale : pinned.cli));
    if (mutate) assert.match(result.output, /expectedNpm/);
  });
  for (const binding of ['relative/npm-cli.js', 'missing', 'wrong-version', 'unset-hosted']) await withFixtures(async (root) => {
    const cli = binding === 'wrong-version' ? npmFixture(root, '11.13.0').cli
      : binding === 'missing' ? join(root, 'missing-cli.js') : binding;
    const env = binding === 'unset-hosted' ? { GITHUB_ACTIONS: 'true' } : { AGY_NPM_CLI: cli, WANT_NPM: '12.0.0' };
    const result = await invoke(root, { env });
    assert.equal(result.code, 1);
    assert.deepEqual(summary(root).files, []);
    if (binding === 'unset-hosted') assert.match(result.output, /hosted identity requires AGY_NPM_CLI/);
  });
});

test('Agy workflow verifies the prefix-installed npm before exporting its CLI binding', async () => {
  await withFixtures(async (root) => {
    const pinned = npmFixture(root), envFile = join(root, 'github-env');
    const script = parsed(readFileSync(WORKFLOW, 'utf8')).jobs.filesystem.steps[4].run;
    const env = { ...executionChildEnv(), AGY_NPM_PREFIX: pinned.prefix, WANT_NPM: '12.0.0', GITHUB_ENV: envFile };
    execFileSync(process.execPath, ['-e', script], { cwd: REPO, env, timeout: 10_000, stdio: 'pipe' });
    const expected = `AGY_NPM_CLI=${realpathSync(pinned.cli)}\n`;
    assert.equal(readFileSync(envFile, 'utf8'), expected);
    npmFixture(root, '11.13.0');
    assert.throws(() => execFileSync(process.execPath, ['-e', script], { cwd: REPO, env, timeout: 10_000, stdio: 'pipe' }));
    assert.equal(readFileSync(envFile, 'utf8'), expected, 'failed version cannot export another binding');
  });
});

const HEAD_EXPRESSION = "${{ inputs.sha || github.sha }}";
const MATRIX = [
  { os: 'ubuntu-latest', platform: 'linux', node: '22.23.0', npm: '11.18.0', mode: 'hosted-heavy' },
  { os: 'ubuntu-latest', platform: 'linux', node: '24.17.0', npm: '12.0.0', mode: 'hosted-heavy' },
  { os: 'macos-latest', platform: 'darwin', node: '24.17.0', npm: '12.0.0', mode: 'light' },
  { os: 'windows-latest', platform: 'win32', node: '24.17.0', npm: '12.0.0', mode: 'light' },
];
function parsed(source: string) {
  const document = parseDocument(source);
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function validateWorkflow(source: string) {
  const workflow = parsed(source);
  // Cross-platform evidence moved post-merge: the four-leg matrix runs on dev
  // pushes and manual dispatch, while PRs carry only the fast Ubuntu contract.
  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.push.branches, ['dev']);
  assert.equal(workflow.on.workflow_dispatch.inputs.sha.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.sha.type, 'string');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs), ['filesystem']);
  const job = workflow.jobs.filesystem;
  assert.equal(job['runs-on'], '${{ matrix.os }}');
  assert.equal(job['timeout-minutes'], 20);
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix, { include: MATRIX });
  for (const key of ['if', 'environment', 'permissions', 'secrets', 'continue-on-error']) assert.equal(job[key], undefined);
  assert.equal(job.env.WANT_SHA, HEAD_EXPRESSION);
  for (const [key, value] of [['WANT_NODE', 'node'], ['WANT_NPM', 'npm'], ['WANT_PLATFORM', 'platform']]) {
    assert.equal(job.env[key], '${{ matrix.' + value + ' }}');
  }
  // Parsed policy checks do not validate Actions expression contexts; actionlint owns that gate.
  for (const value of Object.values(job.env)) {
    assert.doesNotMatch(String(value), /\$\{\{[^}]*\brunner\s*(?:\.|\[)/, 'runner context is invalid in job-level env');
  }
  assert.equal(job.env.AGY_CHECK_OUTPUT_BASENAME, 'agy-artifacts-${{ github.run_id }}-${{ github.run_attempt }}-${{ matrix.os }}-${{ matrix.node }}');
  const actions = assertAllActionsPinned(source).map((entry: { action: string }) => entry.action);
  assert.deepEqual(actions, ['actions/checkout', 'actions/setup-node', 'actions/upload-artifact']);
  const steps = job.steps;
  assert.equal(steps.length, 9);
  assert.deepEqual(steps[0].with, { ref: HEAD_EXPRESSION, 'fetch-depth': 0, 'persist-credentials': false });
  assert.deepEqual(steps[1].with, { 'node-version': '${{ matrix.node }}' });
  assert.equal(steps[2].shell, 'node {0}');
  assert.match(steps[2].run, /assert\.match\(process\.env\.WANT_SHA, \/\^\[a-f0-9\]\{40\}\$\/\)/);
  assert.match(steps[2].run, /assert\.equal\(execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(steps[2].run, /\.trim\(\), process\.env\.WANT_SHA\)/);
  assert.match(steps[2].run, /assert\.equal\(process\.versions\.node, process\.env\.WANT_NODE\)/);
  assert.match(steps[2].run, /assert\.equal\(process\.platform, process\.env\.WANT_PLATFORM\)/);
  assert.equal(steps[3].run, 'npm install -g --prefix "${{ runner.temp }}/agy-pinned-npm" npm@${{ matrix.npm }}');
  assert.equal(steps[4].shell, 'node {0}');
  assert.deepEqual(steps[4].env, { AGY_NPM_PREFIX: '${{ runner.temp }}/agy-pinned-npm' });
  assert.match(steps[4].run, /spawnSync\(process\.execPath, \[npmCli, '--version'\]/);
  assert.match(steps[4].run, /appendFileSync\(process\.env\.GITHUB_ENV, `AGY_NPM_CLI=/);
  assert.match(steps[4].run, /assert\.equal\(result\.stdout\.trim\(\), process\.env\.WANT_NPM\)/);
  assert.equal(steps[5].run, 'node "${{ env.AGY_NPM_CLI }}" ci');
  assert.equal(steps[6].run, 'node "${{ env.AGY_NPM_CLI }}" run build:server');
  assert.equal(steps[7].run, 'node scripts/run-agy-artifact-check.mjs --${{ matrix.mode }} --output-dir "${{ runner.temp }}/${{ env.AGY_CHECK_OUTPUT_BASENAME }}"');
  validateArtifact(steps[8]);
  for (const step of steps.slice(0, -1)) assert.equal(step.if, undefined);
  for (const step of steps) assert.equal(step['continue-on-error'], undefined);
  assert.doesNotMatch(source, /secrets\.|NODE_AUTH_TOKEN|id-token:|npm publish/);
}

function validateArtifact(step: ReturnType<typeof parsed>) {
  assert.equal(step.if, 'always()');
  assert.equal(step.with['if-no-files-found'], 'error');
  assert.equal(step.with.name, 'agy-artifacts-${{ matrix.os }}-${{ matrix.node }}-${{ env.WANT_SHA }}-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.deepEqual(step.with.path.trim().split('\n'), ['${{ runner.temp }}/${{ env.AGY_CHECK_OUTPUT_BASENAME }}/*.json', '${{ runner.temp }}/${{ env.AGY_CHECK_OUTPUT_BASENAME }}/*.tap']);
}

test('Agy parsed workflow locks exact-head four-row filesystem gate', () => {
  validateWorkflow(readFileSync(WORKFLOW, 'utf8'));
});

test('Agy parsed YAML mutations reject checkout, guard, platform, mode, artifacts and privileges', () => {
  const mutations: Array<(workflow: ReturnType<typeof parsed>) => void> = [
    (w) => { delete w.jobs.filesystem.steps[0].with.ref; },
    (w) => { w.jobs.filesystem.steps[0].with.ref = '${{ github.sha }}'; },
    (w) => { w.jobs.filesystem.steps.splice(2, 1); },
    (w) => { w.jobs.filesystem.steps[2].run = 'console.log("unchecked")'; },
    (w) => { w.jobs.filesystem.strategy.matrix.include.pop(); },
    (w) => { w.jobs.filesystem.strategy.matrix.include[0].mode = 'light'; },
    (w) => { w.jobs.filesystem.steps[7].run = 'npm test'; },
    (w) => { w.jobs.filesystem.steps[7].run = 'node scripts/run-agy-artifact-check.mjs --light'; },
    (w) => { w.jobs.filesystem.steps.pop(); },
    (w) => { w.jobs.filesystem.steps[8].if = 'success()'; },
    (w) => { w.jobs.filesystem.steps[0].with['persist-credentials'] = true; },
    (w) => { w.permissions.contents = 'write'; },
    (w) => { w.on.pull_request_target = {}; },
    (w) => { w.jobs.filesystem.steps[0].uses = 'actions/checkout@main'; },
    (w) => { w.jobs.filesystem.env.WANT_PLATFORM = 'linux'; },
    (w) => { w.jobs.filesystem.steps[4].run = 'console.log("npm unchecked")'; },
    (w) => { w.jobs.filesystem.env.AGY_CHECK_OUTPUT_BASENAME = '${{ runner.temp }}/agy-artifacts'; },
    (w) => { w.jobs.filesystem.env.INVALID_JOB_CONTEXT = '${{ runner.temp }}'; },
    (w) => { w.jobs.filesystem.steps[7].run = w.jobs.filesystem.steps[7].run.replace('${{ runner.temp }}/', ''); },
    (w) => { w.jobs.filesystem.steps[8].with.path = '${{ env.AGY_CHECK_OUTPUT_BASENAME }}/*.json'; },
    (w) => { delete w.jobs.filesystem.steps[4].env; },
    (w) => { w.jobs.filesystem.steps[5].run = 'npm ci'; },
    (w) => { w.jobs.filesystem.steps[6].run = 'npm run build:server'; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const workflow = parsed(readFileSync(WORKFLOW, 'utf8'));
    mutate(workflow);
    assert.throws(() => validateWorkflow(stringify(workflow)), `parsed mutation ${index} must fail`);
  }
});

test('Agy workflow SHA/runtime guard really fails malformed, wrong SHA and platform', () => {
  const guard = parsed(readFileSync(WORKFLOW, 'utf8')).jobs.filesystem.steps[2].run;
  const env = { ...executionChildEnv(), WANT_SHA: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
    WANT_NODE: process.versions.node, WANT_PLATFORM: process.platform };
  execFileSync(process.execPath, ['-e', guard], { cwd: REPO, env, stdio: 'pipe', timeout: 10_000 });
  for (const override of [{ WANT_SHA: 'not-a-sha' }, { WANT_SHA: '0'.repeat(40) }, { WANT_PLATFORM: 'wrong-platform' }, { WANT_NODE: '0.0.0' }]) {
    assert.throws(() => execFileSync(process.execPath, ['-e', guard], { cwd: REPO, env: { ...env, ...override }, stdio: 'pipe', timeout: 10_000 }));
  }
});
