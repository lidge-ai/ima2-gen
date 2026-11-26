import type { MediaProviderAdapter } from "./contract.js";
import { adapter as byteplus } from "./direct/byteplus/index.js";
import { adapter as google } from "./direct/google.js";
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
import { adapter as fal } from "./aggregator/fal.js";
import { adapter as sume } from "./aggregator/sume.js";
import { adapter as atlascloud } from "./aggregator/atlascloud.js";

/**
 * Every media adapter the server can route to, in registration order. Within a
 * model, direct routes are preferred over aggregators; this order breaks ties.
 *
 * Only the L0 integration lane edits this list (devlog/_plan/261126_sume_parity_byok_aggregators):
 * lane branches add adapter files and L0 registers them here when merging.
 */
export const BUILTIN_MEDIA_ADAPTERS: readonly MediaProviderAdapter[] = [
  // L2 direct (China-based makers)
  byteplus,
  // L3 direct video, audio and avatar
  google, googleVertex, xai, sync, heygen, veed, topazVideo, mirelo, elevenlabs, cartesia,
  // L4 direct image
  bfl, ideogram, recraft, topazImage, stability,
  // L1 aggregators (after every direct route)
  fal, sume, atlascloud,
];
