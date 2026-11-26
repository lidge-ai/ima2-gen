import type { MediaKind, MediaPrice } from "../../contract.js";
import type { EndpointSchema } from "../shared/fields.js";

/** An Atlas Cloud model endpoint; path is the generate route its schema declares. */
export interface AtlasEndpoint extends EndpointSchema {
  path: string;
}

export interface AtlasCatalogEntry {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  endpoints: readonly AtlasEndpoint[];
  pricing: readonly MediaPrice[];
}
