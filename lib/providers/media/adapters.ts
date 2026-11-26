import type { MediaProviderAdapter } from "./contract.js";

/**
 * Every media adapter the server can route to, in registration order. Within a
 * model, direct routes are preferred over aggregators; this order breaks ties.
 *
 * Only the L0 integration lane edits this list (devlog/_plan/261126_sume_parity_byok_aggregators):
 * lane branches add adapter files and L0 registers them here when merging.
 */
export const BUILTIN_MEDIA_ADAPTERS: readonly MediaProviderAdapter[] = [];
