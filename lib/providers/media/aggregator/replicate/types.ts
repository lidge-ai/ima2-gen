import type { MediaKind, MediaPrice, MediaTask } from "../../contract.js";
import type { InputField } from "../shared/fields.js";

/** One Replicate model serving a Sume-catalog model; one schema covers all its tasks. */
export interface ReplicateCatalogEntry {
  id: string;
  label: string;
  vendor: string;
  kind: MediaKind;
  /** "owner/name" on Replicate. */
  upstream: string;
  /** Official models run at /v1/models/{owner}/{name}/predictions; others need version. */
  official: boolean;
  version?: string;
  tasks: readonly MediaTask[];
  required: readonly string[];
  fields: Readonly<Record<string, InputField>>;
  pricing: readonly MediaPrice[];
}
