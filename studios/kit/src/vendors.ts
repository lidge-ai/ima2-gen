/**
 * Vendor brand assets. Logos live in studios/kit/assets/vendors with a
 * manifest recording where each file came from; this module only reads that
 * manifest and picks a file, so any UI can show the same logos.
 */
export type LogoVariant = "primary" | "dark" | "light" | "mark";

export interface VendorAssetFile {
  file: string;
  variant: LogoVariant;
  format: "svg" | "png";
  width?: number;
  height?: number;
}

export interface VendorAsset {
  id: string;
  name: string;
  files: readonly VendorAssetFile[];
  sourceUrl?: string;
  pageUrl?: string;
  firstParty?: boolean;
  retrievedAt?: string;
  license?: string;
  modifications?: string;
  missing?: string;
}

export interface VendorManifest {
  generatedAt: string;
  vendors: readonly VendorAsset[];
}

/** Official display names, used as text when no logo file exists. */
export const VENDOR_NAMES: Readonly<Record<string, string>> = {
  bytedance: "ByteDance", alibaba: "Alibaba Cloud", tencent: "Tencent", kling: "Kling AI", minimax: "MiniMax",
  vidu: "Vidu", google: "Google", openai: "OpenAI", xai: "xAI", meta: "Meta", "black-forest-labs": "Black Forest Labs",
  ideogram: "Ideogram", recraft: "Recraft", pixverse: "PixVerse", heygen: "HeyGen", "sand-ai": "Sand AI", veed: "VEED",
  meigen: "MeiGen-AI", sync: "sync.", "topaz-labs": "Topaz Labs", mirelo: "Mirelo", elevenlabs: "ElevenLabs",
  cartesia: "Cartesia", "stability-ai": "Stability AI", "ace-step": "ACE-Step", tripo: "Tripo", meshy: "Meshy",
  higgsfield: "Higgsfield", byteplus: "BytePlus", fal: "fal", replicate: "Replicate", atlascloud: "AtlasCloud", sume: "Sume",
};

/** Adapter and provider ids that are spelled differently from the vendor id. */
export const VENDOR_ALIASES: Readonly<Record<string, string>> = {
  bfl: "black-forest-labs", topaz: "topaz-labs", stability: "stability-ai", gemini: "google", "google-vertex": "google",
  veo: "google", kuaishou: "kling", shengshu: "vidu", "sync-labs": "sync", "fal-ai": "fal", "atlas-cloud": "atlascloud",
  "alibaba-cloud": "alibaba", dashscope: "alibaba", "tencent-cloud": "tencent", hunyuan: "tencent", "sand.ai": "sand-ai",
};

export function vendorId(idOrAlias: string): string {
  const key = idOrAlias.toLowerCase();
  return VENDOR_ALIASES[key] ?? key;
}

export function vendorName(idOrAlias: string, manifest?: VendorManifest): string {
  const id = vendorId(idOrAlias);
  return manifest?.vendors.find((v) => v.id === id)?.name ?? VENDOR_NAMES[id] ?? idOrAlias;
}

const ORDER: Record<"dark" | "light", Record<"mark" | "full", readonly LogoVariant[]>> = {
  dark: { mark: ["mark", "dark", "primary"], full: ["dark", "primary", "mark"] },
  light: { mark: ["mark", "light", "primary"], full: ["light", "primary", "mark"] },
};

/** Best file for a background and shape, or null when the manifest has none for this vendor. */
export function pickLogo(
  manifest: VendorManifest | undefined,
  idOrAlias: string,
  options: { background: "dark" | "light"; shape: "mark" | "full" },
): { asset: VendorAsset; file: VendorAssetFile } | null {
  const asset = manifest?.vendors.find((v) => v.id === vendorId(idOrAlias));
  if (!asset || asset.files.length === 0) return null;
  for (const variant of ORDER[options.background][options.shape]) {
    const file = asset.files.find((f) => f.variant === variant);
    if (file) return { asset, file };
  }
  return { asset, file: asset.files[0]! };
}
