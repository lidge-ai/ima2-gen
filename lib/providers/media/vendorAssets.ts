import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MediaProviderAdapter } from "./contract.js";

/**
 * Vendor logos live in one place, studios/kit/assets/vendors (owned by the studio
 * kit, with manifest.json recording each file's source). The server reads that
 * manifest and hands out URLs under VENDOR_ASSET_PREFIX, so the classic UI, every
 * studio and the CLI show the same files without copying them.
 */
export const VENDOR_ASSET_PREFIX = "/media-assets/vendors";
export const VENDOR_ASSET_DIR = join("studios", "kit", "assets", "vendors");

type Variant = "primary" | "dark" | "light" | "mark";
const VARIANTS: readonly Variant[] = ["primary", "dark", "light", "mark"];
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*\.(svg|png|webp)$/i;

interface ManifestVendor {
  id: string;
  name: string;
  aliases?: readonly string[];
  files?: readonly { file: string; variant: string }[];
  sourceUrl?: string;
  pageUrl?: string;
}

export interface VendorLogo {
  id: string;
  name: string;
  /** Same-origin URLs per variant; empty when the manifest has no file for this vendor. */
  urls: Partial<Record<Variant, string>>;
  source: string | null;
}

function toLogo(v: ManifestVendor): VendorLogo {
  const urls: Partial<Record<Variant, string>> = {};
  for (const f of v.files ?? []) {
    const variant = f.variant as Variant;
    if (VARIANTS.includes(variant) && SAFE_FILE.test(f.file) && !urls[variant]) urls[variant] = `${VENDOR_ASSET_PREFIX}/${f.file}`;
  }
  return { id: v.id, name: v.name, urls, source: v.sourceUrl ?? v.pageUrl ?? null };
}

/** Lookup by vendor id or any manifest alias (case-insensitive). */
export class VendorLogos {
  private readonly byKey = new Map<string, VendorLogo>();

  constructor(vendors: readonly ManifestVendor[]) {
    for (const v of vendors) {
      if (!v || typeof v.id !== "string" || typeof v.name !== "string") continue;
      const logo = toLogo(v);
      for (const key of [v.id, ...(v.aliases ?? [])]) {
        if (typeof key === "string" && !this.byKey.has(key.toLowerCase())) this.byKey.set(key.toLowerCase(), logo);
      }
    }
  }

  find(...keys: readonly (string | undefined)[]): VendorLogo | null {
    for (const key of keys) {
      const hit = key ? this.byKey.get(key.toLowerCase()) : undefined;
      if (hit) return hit;
    }
    return null;
  }

  /** An adapter's own brand: its id, then its key vocabulary (topaz, gemini), then the first model's maker. */
  forAdapter(adapter: MediaProviderAdapter): VendorLogo | null {
    return this.find(adapter.id, adapter.credential.keyVocabulary, adapter.listModels()[0]?.vendor);
  }

  all(): VendorLogo[] {
    return [...new Set(this.byKey.values())];
  }
}

let cached: { path: string; mtimeMs: number; logos: VendorLogos } | null = null;

/** Reads manifest.json once per change; a missing or broken manifest means "no logos", never an error. */
export async function loadVendorLogos(rootDir: string): Promise<VendorLogos> {
  const path = join(rootDir, VENDOR_ASSET_DIR, "manifest.json");
  const st = await stat(path).catch(() => null);
  if (!st) return new VendorLogos([]);
  if (cached && cached.path === path && cached.mtimeMs === st.mtimeMs) return cached.logos;
  let vendors: ManifestVendor[] = [];
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { vendors?: unknown };
    vendors = Array.isArray(parsed.vendors) ? parsed.vendors as ManifestVendor[] : [];
  } catch {
    vendors = [];
  }
  cached = { path, mtimeMs: st.mtimeMs, logos: new VendorLogos(vendors) };
  return cached.logos;
}
