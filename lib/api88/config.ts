type Pickable = string | number | boolean | undefined;
type Pickers = {
  pickStr: (env: Pickable, file: Pickable, fallback: string) => string;
  pickPositiveInt: (env: Pickable, file: Pickable, fallback: number) => number;
};

export function buildApi88ProviderConfig(
  env: NodeJS.ProcessEnv, file: Record<string, Pickable> | undefined, { pickStr, pickPositiveInt }: Pickers,
) {
  const saved = file ?? {};
  return {
    baseUrl: pickStr(env.IMA2_88API_BASE_URL, saved.baseUrl, "https://api.88api.ai"),
    baseUrlSource: (env.IMA2_88API_BASE_URL ? "env" : saved.baseUrl ? "config" : "default") as "env" | "config" | "default",
    defaultImageModel: "gpt-image-2",
    defaultVideoModel: "grok-imagine-video-1.5",
    imageTimeoutMs: pickPositiveInt(env.IMA2_88API_IMAGE_TIMEOUT_MS, saved.imageTimeoutMs, 180_000),
    catalogTimeoutMs: pickPositiveInt(env.IMA2_88API_CATALOG_TIMEOUT_MS, saved.catalogTimeoutMs, 10_000),
    catalogTtlMs: 600_000,
    imageDownloadTimeoutMs: pickPositiveInt(env.IMA2_88API_IMAGE_DOWNLOAD_TIMEOUT_MS, saved.imageDownloadTimeoutMs, 60_000),
    maxImageBytes: pickPositiveInt(env.IMA2_88API_MAX_IMAGE_BYTES, saved.maxImageBytes, 52_428_800),
    videoSubmitTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_SUBMIT_TIMEOUT_MS, saved.videoSubmitTimeoutMs, 60_000),
    videoFirstPollMs: 4_000,
    videoPollIntervalMs: 12_000,
    videoPollTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_POLL_TIMEOUT_MS, saved.videoPollTimeoutMs, 30_000),
    videoTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_TIMEOUT_MS, saved.videoTimeoutMs, 900_000),
    videoDownloadTimeoutMs: pickPositiveInt(env.IMA2_88API_VIDEO_DOWNLOAD_TIMEOUT_MS, saved.videoDownloadTimeoutMs, 300_000),
    maxVideoBytes: 209_715_200,
    videoUnknownStatusLimit: 3,
  };
}
