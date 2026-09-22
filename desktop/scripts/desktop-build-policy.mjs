import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGETS = [
  { os: 'macos-latest', label: 'macOS (arm64 + x64)', target: 'mac' },
  { os: 'windows-latest', label: 'Windows (x64 + arm64)', target: 'win' },
  { os: 'ubuntu-latest', label: 'Linux (x64 + arm64)', target: 'linux' },
];
export const MAC_SIGNING_INPUTS = [
  'CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID',
];

/** @param {{ eventName: string, platform?: string, publish?: boolean | string }} input */
export function resolveDesktopBuildPolicy({ eventName, platform = 'all', publish = false }) {
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(eventName)) {
    throw new Error('Unsupported desktop build event');
  }
  const selected = eventName === 'workflow_dispatch' ? (platform || 'all') : 'all';
  if (!['all', 'mac', 'win', 'linux'].includes(selected)) {
    throw new Error('Desktop platform must be all, mac, win, or linux');
  }
  if (eventName === 'workflow_dispatch') {
    if (![true, false, 'true', 'false', ''].includes(publish)) {
      throw new Error('Desktop publish input must be true or false');
    }
    if ((publish === true || publish === 'true') && selected !== 'all') {
      throw new Error('Publishing requires all desktop platforms');
    }
  }
  return {
    matrix: { include: TARGETS.filter(({ target }) => selected === 'all' || target === selected)
      .map((target) => ({ ...target })) },
  };
}

export function validateMacSigningCredentials(env) {
  // Presence is preflight; certificate import and notarization prove authentication.
  const missing = MAC_SIGNING_INPUTS.filter((name) => typeof env[name] !== 'string' || !env[name].trim());
  if (missing.length) throw new Error(`Missing macOS signing inputs: ${missing.join(', ')}`);
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Use --matrix or --credentials');
    if (process.argv[2] === '--matrix') {
      const { matrix } = resolveDesktopBuildPolicy({
        eventName: process.env.DESKTOP_EVENT,
        platform: process.env.DESKTOP_PLATFORM || 'all',
        publish: process.env.DESKTOP_PUBLISH || 'false',
      });
      if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
      appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`, 'utf8');
    } else if (process.argv[2] === '--credentials') {
      validateMacSigningCredentials(process.env);
      console.log('[desktop-signing] Required Apple signing inputs are present.');
    } else {
      throw new Error('Use --matrix or --credentials');
    }
  } catch (error) {
    console.error(`[desktop-policy] ${error.message}`);
    process.exitCode = 1;
  }
}
