import type { MediaKind, MediaPrice, MediaTask } from "../../contract.js";

/** One model reachable through the user's own Sume API key. */
export interface SumeCatalogEntry {
  id: string;
  /** Router model name sent as "model". */
  wire: string;
  route: "video" | "image";
  label: string;
  vendor: string;
  kind: MediaKind;
  tasks: readonly MediaTask[];
  pricing: readonly MediaPrice[];
}
