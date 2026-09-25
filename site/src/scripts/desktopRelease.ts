export const RELEASES_API = 'https://api.github.com/repos/lidge-ai/ima2-gen/releases?per_page=30';
export const RELEASES_PAGE = 'https://github.com/lidge-ai/ima2-gen/releases?q=desktop&expanded=true';
const TAG_PREFIX = 'desktop-v';
const CACHE_KEY = 'ima2:desktop-release';
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

export type PlatformId = 'mac-arm64' | 'win-x64' | 'win-arm64' | 'linux-x64-appimage' | 'linux-arm64-appimage' | 'linux-x64-deb' | 'linux-arm64-deb';
export type Os = 'mac' | 'win' | 'linux' | 'unknown';
export type Arch = 'x64' | 'arm64' | 'unknown';

export interface DesktopAsset { platform: PlatformId; name: string; url: string; size: number; }
export interface DesktopRelease { version: string; tag: string; url: string; publishedAt: string; assets: DesktopAsset[]; }

interface GitHubAsset { name: string; browser_download_url: string; size: number; }
interface GitHubRelease { tag_name: string; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: GitHubAsset[]; }

export const PLATFORM_ORDER: PlatformId[] = ['mac-arm64', 'win-x64', 'win-arm64', 'linux-x64-appimage', 'linux-x64-deb', 'linux-arm64-appimage', 'linux-arm64-deb'];

const ASSET_PATTERNS: Record<PlatformId, RegExp> = {
  'mac-arm64': /^ima2-[\w.+-]+-mac-arm64\.dmg$/,
  'win-x64': /^ima2-[\w.+-]+-win-x64\.exe$/,
  'win-arm64': /^ima2-[\w.+-]+-win-arm64\.exe$/,
  'linux-x64-appimage': /^ima2-[\w.+-]+-linux-x86_64\.AppImage$/,
  'linux-arm64-appimage': /^ima2-[\w.+-]+-linux-arm64\.AppImage$/,
  'linux-x64-deb': /^ima2-[\w.+-]+-linux-amd64\.deb$/,
  'linux-arm64-deb': /^ima2-[\w.+-]+-linux-arm64\.deb$/,
};

export function platformOs(platform: PlatformId): Os {
  return platform.startsWith('mac') ? 'mac' : platform.startsWith('win') ? 'win' : 'linux';
}

export function matchAssets(assets: GitHubAsset[]): DesktopAsset[] {
  const found: DesktopAsset[] = [];
  for (const platform of PLATFORM_ORDER) {
    const asset = assets.find((a) => ASSET_PATTERNS[platform].test(a.name));
    if (asset) found.push({ platform, name: asset.name, url: asset.browser_download_url, size: asset.size });
  }
  return found;
}

export function pickLatestDesktopRelease(releases: GitHubRelease[]): DesktopRelease | null {
  const candidates = releases
    .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(TAG_PREFIX) && r.published_at)
    .sort((a, b) => Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? ''));
  const latest = candidates[0];
  if (!latest) return null;
  return {
    version: latest.tag_name.slice(TAG_PREFIX.length),
    tag: latest.tag_name,
    url: latest.html_url,
    publishedAt: latest.published_at ?? '',
    assets: matchAssets(latest.assets),
  };
}

function readCache(): DesktopRelease | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { at: number; release: DesktopRelease | null };
    return Date.now() - cached.at < CACHE_TTL_MS ? cached.release : null;
  } catch {
    return null;
  }
}

function writeCache(release: DesktopRelease | null): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
  } catch {
    // Storage can be unavailable (private mode, quota); the fetch result is still used.
  }
}

let pending: Promise<DesktopRelease | null> | null = null;

/** Latest published desktop release, or null when it cannot be resolved. */
export function loadDesktopRelease(): Promise<DesktopRelease | null> {
  if (pending) return pending;
  const cached = readCache();
  if (cached) return (pending = Promise.resolve(cached));
  pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal });
      if (!res.ok) return null;
      const release = pickLatestDesktopRelease((await res.json()) as GitHubRelease[]);
      writeCache(release);
      return release;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  return pending;
}

interface UADataValues { platform?: string; architecture?: string; bitness?: string; }
interface UAData { platform?: string; mobile?: boolean; getHighEntropyValues?: (hints: string[]) => Promise<UADataValues>; }

export interface DetectedPlatform { os: Os; arch: Arch; mobile: boolean; }

function osFrom(s: string): Os | null {
  if (/Windows|Win32|Win64/i.test(s)) return 'win';
  if (/Macintosh|Mac OS X|MacIntel/i.test(s)) return 'mac';
  if (/Linux|X11|CrOS/i.test(s)) return 'linux';
  return null;
}

export function detectFromUserAgent(ua: string, navPlatform = ''): DetectedPlatform {
  const s = `${ua} ${navPlatform}`;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  let os: Os = 'unknown';
  if (!mobile) os = osFrom(ua) ?? osFrom(navPlatform) ?? 'unknown';
  let arch: Arch = 'unknown';
  if (/aarch64|arm64|ARM64/i.test(s)) arch = 'arm64';
  else if (/x86_64|x64|Win64|WOW64|amd64|i686/i.test(s)) arch = 'x64';
  return { os, arch, mobile };
}

export async function detectPlatform(): Promise<DetectedPlatform> {
  const detected = detectFromUserAgent(navigator.userAgent, navigator.platform ?? '');
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  if (!uaData?.getHighEntropyValues) return detected;
  try {
    const values = await uaData.getHighEntropyValues(['architecture', 'bitness', 'platform']);
    const platform = (values.platform ?? uaData.platform ?? '').toLowerCase();
    const os: Os = uaData.mobile ? 'unknown'
      : platform === 'windows' ? 'win'
      : platform === 'macos' ? 'mac'
      : platform === 'linux' || platform === 'chrome os' ? 'linux'
      : detected.os;
    const arch: Arch = values.architecture === 'arm' ? 'arm64' : values.architecture === 'x86' ? 'x64' : detected.arch;
    return { os, arch, mobile: Boolean(uaData.mobile) };
  } catch {
    return detected;
  }
}

/** Installer for this visitor, in preference order. Mac always maps to Apple Silicon (the only Mac build). */
export function preferredPlatforms({ os, arch }: DetectedPlatform): PlatformId[] {
  if (os === 'mac') return ['mac-arm64'];
  if (os === 'win') return arch === 'arm64' ? ['win-arm64', 'win-x64'] : ['win-x64'];
  if (os === 'linux') return arch === 'arm64' ? ['linux-arm64-appimage', 'linux-arm64-deb'] : ['linux-x64-appimage', 'linux-x64-deb'];
  return [];
}

export function formatSize(bytes: number): string {
  return bytes > 0 ? `${Math.round(bytes / 1024 / 1024)} MB` : '';
}
