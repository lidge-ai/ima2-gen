import type { MediaKind, MediaPrice } from "../../contract.js";
import type { EndpointSchema } from "../shared/fields.js";

/** One Sume-catalog model served by fal, with one endpoint per task. */
export interface FalCatalogEntry {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  endpoints: readonly EndpointSchema[];
  pricing: readonly MediaPrice[];
}
