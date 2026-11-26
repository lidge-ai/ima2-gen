import type { MediaModelSpec } from "../../contract.js";

const IMAGE_DOC = "https://kling.ai/document-api/apiReference/model/imageGeneration";
const VIDEO_DOC = "https://kling.ai/document-api/api/video/3-0-omni/text-to-video/legacy";
export const models: readonly MediaModelSpec[] = [
  {
    id: "kling/kling-image-3",
    upstreamId: "kling-v3",
    vendor: "kling",
    label: "Kling Image 3",
    kind: "image",
    tasks: ["text-to-image", "image-to-image"],
    params: {
      resolutions: ["1k", "2k"],
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9"],
      maxReferenceImages: 1,
      negativePrompt: true,
    },
    pricing: [
      {
        unit: "image",
        usd: 0.028,
        variant: "1k/2k: 8 units/image × $0.0035/unit",
        source: "https://kling.ai/dev/model/image",
        checkedAt: "2026-11-26",
      },
    ],
    docsUrl: IMAGE_DOC,
  },
  {
    id: "kling/kling-2.6",
    upstreamId: "kling-v2-6",
    vendor: "kling",
    label: "Kling 2.6",
    kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: {
      durationsSec: [5, 10],
      aspectRatios: ["16:9", "9:16", "1:1"],
      nativeAudio: true,
      negativePrompt: true,
    },
    pricing: [],
    docsUrl: VIDEO_DOC,
  },
  {
    id: "kling/kling-3",
    upstreamId: "kling-v3",
    vendor: "kling",
    label: "Kling 3",
    kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: {
      durationsSec: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      aspectRatios: ["16:9", "9:16", "1:1"],
      nativeAudio: true,
      negativePrompt: true,
    },
    pricing: [],
    docsUrl: VIDEO_DOC,
  },
  {
    id: "kling/kling-4",
    upstreamId: "kling-4.0",
    vendor: "kling",
    label: "Kling 4",
    kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: {
      durationsSec: Array.from({ length: 28 }, (_, i) => i + 3),
      resolutions: ["720p", "1080p", "4k"],
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    },
    pricing: [
      {
        unit: "second",
        usd: 0.15386,
        variant: "720p no input video: 1 unit/s × $0.15386/unit, flagship package 1",
        source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package",
        checkedAt: "2026-11-26",
      },
      {
        unit: "second",
        usd: 0.23079,
        variant: "1080p no input video: 1.5 units/s × $0.15386/unit, flagship package 1",
        source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package",
        checkedAt: "2026-11-26",
      },
    ],
    docsUrl: "https://kling.ai/document-api/api/usage-guide/kling-4-0",
  },
  {
    id: "kling/kling-3-turbo",
    upstreamId: "kling-3.0-turbo",
    vendor: "kling",
    label: "Kling 3 Turbo",
    kind: "video",
    tasks: ["text-to-video", "image-to-video"],
    params: {
      durationsSec: Array.from({ length: 13 }, (_, i) => i + 3),
      resolutions: ["720p", "1080p"],
      aspectRatios: ["16:9", "9:16", "1:1"],
    },
    pricing: [],
    docsUrl: "https://kling.ai/document-api/api/video/3-0-turbo/text-to-video",
  },
  ...(
    [
      ["kling-o1", "kling-video-o1"],
      ["kling-3-omni", "kling-v3-omni"],
    ] as const
  ).map(([id, upstreamId]): MediaModelSpec => ({
    id: `kling/${id}`,
    upstreamId,
    vendor: "kling",
    label: id,
    kind: "video",
    tasks: ["text-to-video", "reference-to-video", "video-to-video"],
    params: {
      durationsSec: Array.from({ length: id === "kling-o1" ? 8 : 13 }, (_, i) => i + 3),
      aspectRatios: ["16:9", "9:16", "1:1"],
      maxReferenceImages: 4,
      maxReferenceVideos: 1,
    },
    pricing: [],
    docsUrl: "https://kling.ai/document-api/api/video/o1/video-omni/legacy",
  })),
  ...(
    [
      ["kling-image-o1", "kling-image-o1"],
      ["kling-image-3-omni", "kling-v3-omni"],
    ] as const
  ).map(([id, upstreamId]): MediaModelSpec => ({
    id: `kling/${id}`,
    upstreamId,
    vendor: "kling",
    label: id,
    kind: "image",
    tasks: ["text-to-image", "image-to-image"],
    params: {
      resolutions: id === "kling-image-3-omni" ? ["1k", "2k", "4k"] : ["1k", "2k"],
      aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"],
      maxReferenceImages: 10,
    },
    pricing: [
      {
        unit: "image",
        usd: 0.028,
        variant: "1k/2k: 8 units/image × $0.0035/unit",
        source: "https://kling.ai/dev/model/image",
        checkedAt: "2026-11-26",
      },
      ...(id === "kling-image-3-omni"
        ? [
            {
              unit: "image" as const,
              usd: 0.056,
              variant: "4k: 16 units/image × $0.0035/unit",
              source: "https://kling.ai/dev/model/image",
              checkedAt: "2026-11-26",
            },
          ]
        : []),
    ],
    docsUrl: "https://kling.ai/document-api/apiReference/model/OmniImage",
  })),
  {
    id: "kling/kling-4-omni",
    upstreamId: "kling-4.0",
    vendor: "kling",
    label: "Kling 4 Omni",
    kind: "video",
    tasks: ["reference-to-video", "video-to-video"],
    params: {
      durationsSec: Array.from({ length: 28 }, (_, i) => i + 3),
      resolutions: ["720p", "1080p", "4k"],
      maxReferenceImages: 10,
      maxReferenceVideos: 5,
    },
    pricing: [
      {
        unit: "second",
        usd: 0.15386,
        variant: "720p no input video: 1 unit/s × $0.15386/unit, flagship package 1",
        source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package",
        checkedAt: "2026-11-26",
      },
      {
        unit: "second",
        usd: 0.23079,
        variant: "1080p no input video: 1.5 units/s × $0.15386/unit, flagship package 1",
        source: "https://kling.ai/dev/pricing?packageFilter=flagship-180&scrollTo=video-package",
        checkedAt: "2026-11-26",
      },
    ],
    docsUrl: "https://kling.ai/document-api/api/video/4-0",
  },
  {
    id: "kling/kling-lipsync",
    upstreamId: "advanced-lip-sync",
    vendor: "kling",
    label: "Kling Lip Sync",
    kind: "video",
    tasks: ["lipsync"],
    params: {},
    pricing: [],
    docsUrl: "https://kling.ai/document-api/api/video/lip-sync",
  },
];
