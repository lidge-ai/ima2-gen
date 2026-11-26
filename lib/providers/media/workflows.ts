import type { MediaWorkflow } from "./workflow.js";

/**
 * Registered workflows (L6 implements them under lib/workflows/). Only the L0
 * integration lane edits this list.
 */
export const BUILTIN_MEDIA_WORKFLOWS: readonly MediaWorkflow[] = [];

export function findMediaWorkflow(id: string, workflows: readonly MediaWorkflow[] = BUILTIN_MEDIA_WORKFLOWS): MediaWorkflow | undefined {
  return workflows.find((w) => w.id === id);
}
