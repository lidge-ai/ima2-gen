import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaInput } from "../providers/media/contract.js";
import { WorkflowError } from "./errors.js";
import type {
  ArtifactDraft, StepRuntime, WorkflowArtifact, WorkflowGateway, WorkflowLocalOps,
  WorkflowMediaRef, WorkflowStep, WorkflowValues,
} from "./types.js";

const EXT: Readonly<Record<string, string>> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/mp4": "m4a",
  "application/json": "json",
};

export function extensionFor(mimeType: string): string {
  return EXT[mimeType] ?? "bin";
}

/** Holds every artifact of one run; files live under workDir. */
export class ArtifactStore {
  private readonly byStep = new Map<string, WorkflowArtifact[]>();
  constructor(private readonly workDir: string) {}

  async save(step: WorkflowStep, drafts: readonly ArtifactDraft[]): Promise<WorkflowArtifact[]> {
    const saved: WorkflowArtifact[] = [];
    for (const [index, draft] of drafts.entries()) saved.push(await this.saveOne(step, draft, index));
    this.byStep.set(step.id, saved);
    return saved;
  }

  private async saveOne(step: WorkflowStep, draft: ArtifactDraft, index: number): Promise<WorkflowArtifact> {
    let path = draft.path;
    if (!path) {
      if (!draft.bytes) throw new WorkflowError("WORKFLOW_INTERNAL", "step " + step.id + " returned an empty artifact", { stepId: step.id, status: 500 });
      path = join(this.workDir, step.id + "-" + index + "." + extensionFor(draft.mimeType));
      await writeFile(path, draft.bytes);
    }
    const artifact: WorkflowArtifact = {
      id: randomUUID(), stepId: step.id, kind: draft.kind, mimeType: draft.mimeType,
      path, sizeBytes: (await stat(path)).size, final: step.final === true,
    };
    if (draft.meta) artifact.meta = draft.meta;
    return artifact;
  }

  of(stepId: string): readonly WorkflowArtifact[] {
    return this.byStep.get(stepId) ?? [];
  }

  finals(): WorkflowArtifact[] {
    return [...this.byStep.values()].flat().filter((a) => a.final);
  }

  all(): WorkflowArtifact[] {
    return [...this.byStep.values()].flat();
  }
}

export interface RuntimeDeps {
  values: WorkflowValues;
  workDir: string;
  signal: AbortSignal;
  local: WorkflowLocalOps;
  gateway: WorkflowGateway;
  store: ArtifactStore;
}

function isArtifact(source: WorkflowArtifact | WorkflowMediaRef): source is WorkflowArtifact {
  return "stepId" in source;
}

async function toInput(source: WorkflowArtifact | WorkflowMediaRef, role: MediaInput["role"]): Promise<MediaInput> {
  if (!isArtifact(source) && source.url) return { role, url: source.url, mimeType: source.mimeType };
  if (!source.path) throw new WorkflowError("WORKFLOW_INTERNAL", "media reference has neither path nor url", { status: 500 });
  return { role, bytes: new Uint8Array(await readFile(source.path)), mimeType: source.mimeType };
}

export function createStepRuntime(step: WorkflowStep, deps: RuntimeDeps): StepRuntime {
  let counter = 0;
  return {
    values: deps.values,
    workDir: deps.workDir,
    signal: deps.signal,
    local: deps.local,
    gateway: deps.gateway,
    artifactsOf(stepId: string) {
      if (!step.dependsOn.includes(stepId)) {
        throw new WorkflowError("WORKFLOW_INTERNAL", step.id + " reads " + stepId + " without depending on it", { stepId: step.id, status: 500 });
      }
      return deps.store.of(stepId);
    },
    asInput: toInput,
    tempPath(name: string) {
      counter += 1;
      return join(deps.workDir, step.id + "-tmp" + counter + "-" + name);
    },
  };
}
