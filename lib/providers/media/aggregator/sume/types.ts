import type { MediaKind, MediaModelSpec, MediaPrice, MediaTask } from "../../contract.js";

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
  /** From the router's live capabilities (resolutions, durations, aspect ratios, audio). */
  params: MediaModelSpec["params"];
  pricing: readonly MediaPrice[];
}
