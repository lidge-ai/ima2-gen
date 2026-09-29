import { detectPlatform, formatSize, loadDesktopRelease, preferredPlatforms, type Os, type PlatformId } from './desktopRelease';

export interface DownloadLabels {
  ctaFor: string;
  detected: string;
  soon: string;
  platforms: Record<PlatformId, string>;
  os: Record<Exclude<Os, 'unknown'>, string>;
}

/**
 * Fills every desktop download block on the page ([data-desktop-download]) from the
 * latest published desktop release: per-platform links when the block lists
 * platforms, and a primary "Download for {OS}" link for the visitor's machine.
 * Without a release or a recognised OS the static fallback links stay in place.
 */
export function mountDesktopDownloads(): void {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-desktop-download]')).filter((root) => !root.dataset.mounted);
  if (!roots.length) return;
  roots.forEach((root) => { root.dataset.mounted = 'true'; });
  void Promise.all([loadDesktopRelease(), detectPlatform()]).then(([release, detected]) => {
    if (!release) return;
    const byPlatform = new Map(release.assets.map((a) => [a.platform, a]));
    for (const root of roots) {
      const labels = JSON.parse(root.dataset.labels ?? '{}') as DownloadLabels;
      fillPlatformList(root, byPlatform, release.url, labels);
      fillPrimary(root, byPlatform, detected, release.version, labels);
    }
  });
}

type Assets = Map<PlatformId, { platform: PlatformId; url: string; size: number }>;

function fillPlatformList(root: HTMLElement, byPlatform: Assets, releaseUrl: string, labels: DownloadLabels): void {
  root.querySelectorAll<HTMLLIElement>('[data-platform]').forEach((item) => {
    const asset = byPlatform.get(item.dataset.platform as PlatformId);
    const link = item.querySelector('a');
    const meta = item.querySelector('[data-dl-meta]');
    if (!link || !meta) return;
    if (asset) {
      link.href = asset.url;
      link.removeAttribute('target');
      meta.textContent = formatSize(asset.size) || '↓';
      meta.removeAttribute('aria-hidden');
    } else {
      link.href = releaseUrl;
      item.classList.add('is-soon');
      meta.textContent = labels.soon;
      meta.removeAttribute('aria-hidden');
    }
  });
}

function fillPrimary(
  root: HTMLElement,
  byPlatform: Assets,
  detected: Awaited<ReturnType<typeof detectPlatform>>,
  version: string,
  labels: DownloadLabels,
): void {
  const primary = preferredPlatforms(detected).map((id) => byPlatform.get(id)).find(Boolean);
  const primaryLink = root.querySelector<HTMLAnchorElement>('[data-dl-primary]');
  const primaryLabel = root.querySelector('[data-dl-primary-label]');
  if (!primary || !primaryLink || !primaryLabel || detected.os === 'unknown') return;
  primaryLink.href = primary.url;
  primaryLink.removeAttribute('target');
  primaryLabel.textContent = labels.ctaFor.replace('{platform}', labels.os[detected.os]);
  root.querySelector(`[data-platform="${primary.platform}"]`)?.classList.add('is-primary');
  const detectedEl = root.querySelector<HTMLElement>('[data-dl-detected]');
  if (detectedEl) {
    detectedEl.textContent = labels.detected
      .replace('{platform}', labels.platforms[primary.platform])
      .replace('{version}', `v${version}`);
    detectedEl.hidden = false;
  }
}

/** Server-side label bundle both download blocks pass to the mounter. */
export function downloadLabels(t: (key: string) => string, platformIds: readonly PlatformId[]): DownloadLabels {
  return {
    ctaFor: t('install.desktop.ctaFor'),
    detected: t('install.desktop.detected'),
    soon: t('install.desktop.soon'),
    platforms: Object.fromEntries(platformIds.map((id) => [id, t(`dl.platform.${id}`)])) as Record<PlatformId, string>,
    os: { mac: t('dl.os.mac'), win: t('dl.os.win'), linux: t('dl.os.linux') },
  };
}
