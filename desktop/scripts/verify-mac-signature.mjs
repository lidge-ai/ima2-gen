#!/usr/bin/env node
/**
 * Fail a signed macOS build that only looks signed.
 *
 * electron-builder exits 0 in several states that all read as success from the
 * terminal and all ship a bundle users cannot open:
 *
 *   - no identity was found, so the build silently fell back to ad-hoc
 *   - the app was signed but `hardenedRuntime` was off, so notarization would
 *     have rejected it
 *   - notarization ran but the ticket was never stapled, so the first launch
 *     on a machine with no network shows the malware dialog
 *
 * The release script asserts the end state here instead of trusting the exit
 * code of the step that produced it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const appPath = resolve(process.argv[2] ?? 'dist/mac-arm64/ima2.app');
const requireStapled = process.env['VERIFY_REQUIRE_STAPLED'] !== '0';

if (!existsSync(appPath)) {
  fail(`No app bundle at ${appPath}. Did the build step run?`);
}

/**
 * Run a command and return stdout AND stderr regardless of exit status.
 *
 * codesign and spctl write their reports to stderr and exit 0. Reading only
 * stdout on the success path makes every check see an empty string, which then
 * reads as "no Authority, no timestamp, no hardened runtime" -- a fully signed,
 * notarized, stapled bundle gets reported as unsigned. Capture both streams on
 * both paths.
 */
function probe(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.error) return { ok: false, text: `${text}${result.error.message}` };
  return { ok: result.status === 0, text };
}

function fail(message) {
  console.error(`\n[verify-mac-signature] FAIL: ${message}\n`);
  process.exit(1);
}

const problems = [];

// 1. Signed by a real authority, not ad-hoc.
const info = probe('/usr/bin/codesign', ['-dv', '--verbose=4', appPath]);
if (!info.text.includes('Authority=')) {
  problems.push('bundle carries no certificate authority (unsigned or ad-hoc)');
}
if (/Signature\s*=\s*adhoc/.test(info.text)) {
  problems.push('bundle is ad-hoc signed; the Developer ID identity was not used');
}

// 2. Developer ID specifically. An Apple Development certificate signs fine and
//    then fails on every machine that is not a registered device.
if (info.text.includes('Authority=') && !/Authority=Developer ID Application:/.test(info.text)) {
  const authority = (info.text.match(/Authority=(.+)/) ?? [, '(unknown)'])[1];
  problems.push(`signed by "${authority.trim()}" rather than a Developer ID Application certificate`);
}

// 3. Hardened runtime. Notarization refuses a bundle without it.
if (!/flags=\S*runtime/.test(info.text)) {
  problems.push('hardened runtime is not enabled (flags do not include runtime)');
}

// 4. A secure timestamp, not the local clock. Without it the signature stops
//    validating the moment the certificate expires.
if (!/^Timestamp=/m.test(info.text)) {
  problems.push('signature has no secure timestamp');
}

// 5. The signature actually verifies, nested code included.
const strict = probe('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
if (!strict.ok) {
  problems.push(`codesign --verify failed:\n${strict.text.trim()}`);
}

// 6. Gatekeeper's own verdict. This is the check that reflects what a user sees.
const assess = probe('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
if (!assess.ok) {
  problems.push(`spctl rejected the bundle:\n${assess.text.trim()}`);
}

// 7. Stapled notarization ticket, so first launch works offline.
if (requireStapled) {
  const staple = probe('/usr/bin/xcrun', ['stapler', 'validate', appPath]);
  if (!staple.ok) {
    problems.push(
      `no stapled notarization ticket:\n${staple.text.trim()}\n` +
        '  (set VERIFY_REQUIRE_STAPLED=0 to check signing only)',
    );
  }
}

if (problems.length > 0) {
  fail(`${appPath}\n\n  - ${problems.join('\n  - ')}`);
}

const authority = (info.text.match(/Authority=(.+)/) ?? [, '(unknown)'])[1].trim();
const teamId = (info.text.match(/TeamIdentifier=(\S+)/) ?? [, '(unknown)'])[1];
console.log('[verify-mac-signature] OK');
console.log(`  bundle    ${appPath}`);
console.log(`  authority ${authority}`);
console.log(`  team      ${teamId}`);
console.log(`  hardened  yes`);
console.log(`  stapled   ${requireStapled ? 'yes' : 'not checked'}`);
