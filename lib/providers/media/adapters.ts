import type { MediaProviderAdapter } from "./contract.js";
import { adapter as byteplus } from "./direct/byteplus/index.js";
import { adapter as byteplusVision } from "./direct/byteplus-vision.js";
import { adapter as kling } from "./direct/kling/index.js";
import { adapter as klingLegacy } from "./direct/kling-legacy/index.js";
import { adapter as alibaba } from "./direct/alibaba.js";
import { adapter as minimax } from "./direct/minimax.js";
import { adapter as vidu } from "./direct/vidu.js";
import { adapter as pixverse } from "./direct/pixverse.js";
import { adapter as tencent } from "./direct/tencent.js";
import { adapter as tencentVod } from "./direct/tencent-vod/index.js";
import { adapter as google } from "./direct/google.js";
import { adapter as googleImage } from "./direct/google-image.js";
import { adapter as googleVertex } from "./direct/google-vertex.js";
import { adapter as xai } from "./direct/xai.js";
import { adapter as sync } from "./direct/sync.js";
import { adapter as heygen } from "./direct/heygen.js";
import { adapter as veed } from "./direct/veed.js";
import { adapter as topazVideo } from "./direct/topaz-video.js";
import { adapter as mirelo } from "./direct/mirelo.js";
import { adapter as elevenlabs } from "./direct/elevenlabs.js";
import { adapter as cartesia } from "./direct/cartesia.js";
import { adapter as bfl } from "./direct/bfl.js";
import { adapter as ideogram } from "./direct/ideogram.js";
import { adapter as recraft } from "./direct/recraft.js";
import { adapter as topazImage } from "./direct/topaz-image.js";
import { adapter as stability } from "./direct/stability.js";
import { adapter as openai } from "./direct/openai.js";
import { adapter as fal } from "./aggregator/fal.js";
import { adapter as sume } from "./aggregator/sume.js";
import { adapter as atlascloud } from "./aggregator/atlascloud.js";
import { adapter as replicate } from "./aggregator/replicate.js";
import { adapter as openrouter } from "./aggregator/openrouter.js";
import { adapter as wavespeed } from "./aggregator/wavespeed.js";
import { adapter as comfyLocal } from "./local/comfy.js";

/**
 * Every media adapter the server can route to, in registration order. Within a
 * model, direct routes are preferred over aggregators; this order breaks ties.
 *
 * Only the L0 integration lane edits this list (devlog/_plan/261126_sume_parity_byok_aggregators):
 * lane branches add adapter files and L0 registers them here when merging.
 */
export const BUILTIN_MEDIA_ADAPTERS: readonly MediaProviderAdapter[] = [
  // L2 direct (China-based makers)
  byteplus, byteplusVision, kling, klingLegacy, alibaba, minimax, vidu, pixverse, tencent, tencentVod,
  // L3 direct video, audio and avatar
  google, googleImage, googleVertex, xai, sync, heygen, veed, topazVideo, mirelo, elevenlabs, cartesia,
  // L4 direct image
  bfl, ideogram, recraft, topazImage, stability, openai,
  // L1 aggregators (after every direct route)
  fal, replicate, wavespeed, openrouter, atlascloud, sume,
  // Local routes (the user's own server): keyless, with a catalog that changes while the server runs
  comfyLocal,
];
