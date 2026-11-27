/**
 * Vendor brand assets. Logos live in studios/kit/assets/vendors with a
 * manifest recording where each file came from; this module only reads that
 * manifest and picks a file, so any UI can show the same logos.
 */
export type LogoVariant = "primary" | "dark" | "light" | "mark";
/** What the file draws: a square symbol, a horizontal wordmark, or a symbol stacked over text. */
export type LogoShape = "mark" | "wordmark" | "stacked";

export interface VendorAssetFile {
  file: string;
  /** Background the file is drawn for ("dark" = white ink); "mark" = a symbol for any background. */
  variant: LogoVariant;
  format: "svg" | "png" | "jpg" | "webp";
  width?: number;
  height?: number;
  shape?: LogoShape;
  /** The file is a full tile with its own background (an app icon or organisation avatar). */
  tile?: boolean;
  /**
   * Share of empty space the file leaves on each side (0 to 0.4). Small slots scale the image up
   * by 1 / (1 - 2 × trim) inside a clipped box, so a mark drawn small in its canvas stays legible
   * without editing the file.
   */
  trim?: number;
  /** Ink of the drawing: "light" needs a dark tile, "dark" a light one; "color" works on a light tile. */
  ink?: "dark" | "light" | "color";
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
  /** Adapter ids and key vocabularies that show this vendor's logo, e.g. "bfl", "topaz-video". */
  aliases?: readonly string[];
}

export interface VendorManifest {
  generatedAt: string;
  vendors: readonly VendorAsset[];
}

/** Official display names, used as text when no logo file exists. */
export const VENDOR_NAMES: Readonly<Record<string, string>> = {
  bytedance: "ByteDance",
  alibaba: "Alibaba Cloud",
  tencent: "Tencent",
  kling: "Kling AI",
  minimax: "MiniMax",
  vidu: "Vidu",
  google: "Google",
  openai: "OpenAI",
  xai: "xAI",
  meta: "Meta",
  "black-forest-labs": "Black Forest Labs",
  ideogram: "Ideogram",
  recraft: "Recraft",
  pixverse: "PixVerse",
  heygen: "HeyGen",
  "sand-ai": "Sand AI",
  veed: "VEED",
  meigen: "MeiGen-AI",
  sync: "sync.",
  "topaz-labs": "Topaz Labs",
  mirelo: "Mirelo",
  elevenlabs: "ElevenLabs",
  cartesia: "Cartesia",
  "stability-ai": "Stability AI",
  "ace-step": "ACE-Step",
  tripo: "Tripo",
  meshy: "Meshy",
  higgsfield: "Higgsfield",
  byteplus: "BytePlus",
  fal: "fal",
  replicate: "Replicate",
  atlascloud: "AtlasCloud",
  sume: "Sume",
  // A registered ComfyUI workflow runs on the person's own machine; no logo file, so a letter mark.
  comfy: "ComfyUI",
};

/** Adapter and provider ids that are spelled differently from the vendor id. */
export const VENDOR_ALIASES: Readonly<Record<string, string>> = {
  bfl: "black-forest-labs",
  topaz: "topaz-labs",
  stability: "stability-ai",
  gemini: "google",
  "google-vertex": "google",
  veo: "google",
  kuaishou: "kling",
  shengshu: "vidu",
  "sync-labs": "sync",
  "fal-ai": "fal",
  "atlas-cloud": "atlascloud",
  "alibaba-cloud": "alibaba",
  dashscope: "alibaba",
  "tencent-cloud": "tencent",
  hunyuan: "tencent",
  "sand.ai": "sand-ai",
  "comfy-local": "comfy",
};

export function vendorId(idOrAlias: string): string {
  const key = idOrAlias.toLowerCase();
  return VENDOR_ALIASES[key] ?? key;
}

/** Manifest entry by id, by its aliases, or by the built-in alias table. */
export function findVendor(manifest: VendorManifest | undefined, idOrAlias: string): VendorAsset | undefined {
  const key = idOrAlias.toLowerCase();
  const id = vendorId(key);
  return manifest?.vendors.find((v) => v.id === id || v.id === key || v.aliases?.includes(key));
}

export function vendorName(idOrAlias: string, manifest?: VendorManifest): string {
  return findVendor(manifest, idOrAlias)?.name ?? VENDOR_NAMES[vendorId(idOrAlias)] ?? idOrAlias;
}

const ORDER: Record<"dark" | "light", Record<"mark" | "full", readonly LogoVariant[]>> = {
  // Wordmarks: ink drawn for this background first. Marks sit on their own tile, so a dark or
  // coloured symbol on a light tile reads best at 16-20 px on either page background.
  dark: { full: ["dark", "mark", "primary", "light"], mark: ["mark", "primary", "light", "dark"] },
  light: { full: ["light", "mark", "primary", "dark"], mark: ["mark", "primary", "light", "dark"] },
};

/** The file's shape, from the manifest or, for older entries, from its proportions. */
export function logoShape(file: VendorAssetFile): LogoShape {
  if (file.shape) return file.shape;
  if (file.width && file.height) return file.width / file.height > 1.6 ? "wordmark" : "mark";
  return file.variant === "mark" ? "mark" : "wordmark";
}

const SHAPES: Record<"mark" | "full", readonly LogoShape[]> = {
  // A wordmark squeezed into a square is unreadable, so a mark slot takes only real symbols.
  mark: ["mark"],
  full: ["wordmark", "stacked", "mark"],
};

/**
 * Best file for a background and slot shape, or null when the vendor has no file of a
 * fitting shape (a UI then shows a monogram for "mark" or the name for "full").
 */
export function pickLogo(
  manifest: VendorManifest | undefined,
  idOrAlias: string,
  options: { background: "dark" | "light"; shape: "mark" | "full" },
): { asset: VendorAsset; file: VendorAssetFile } | null {
  const asset = findVendor(manifest, idOrAlias);
  if (!asset || asset.files.length === 0) return null;
  for (const shape of SHAPES[options.shape]) {
    for (const variant of ORDER[options.background][options.shape]) {
      const file = asset.files.find((f) => f.variant === variant && logoShape(f) === shape);
      if (file) return { asset, file };
    }
  }
  return null;
}

/** One or two letters for a vendor without a symbol: "ByteDance" → "B", "fal" → "F", "sync." → "S". */
export function vendorMonogram(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  return (letters[0] ?? "?").toUpperCase();
}
