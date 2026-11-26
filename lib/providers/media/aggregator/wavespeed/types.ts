import type { MediaKind, MediaPrice } from "../../contract.js";
import type { EndpointSchema } from "../shared/fields.js";

/** A WaveSpeed model endpoint; path is "/api/v3/<model_id>". */
export interface WaveSpeedEndpoint extends EndpointSchema {
  path: string;
}

export interface WaveSpeedCatalogEntry {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  endpoints: readonly WaveSpeedEndpoint[];
  pricing: readonly MediaPrice[];
}
