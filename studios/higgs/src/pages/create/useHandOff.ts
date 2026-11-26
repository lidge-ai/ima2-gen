import { useEffect } from "react";
import { handOffFile, takeHandOff, type HandOff } from "../../studio/handoff.ts";
import { useStudioApi } from "../../studio/context.tsx";
import type { UploadedInput } from "@ima2/studio-kit";

/** Picks up a result sent from another screen and uploads it once. */
export function useHandOff(target: HandOff["target"], accept: (upload: UploadedInput, name: string) => void): void {
  const studio = useStudioApi();
  useEffect(() => {
    const value = takeHandOff(target);
    if (!value) return;
    let live = true;
    void handOffFile(value)
      .then((file) =>
        studio.upload(file).then((upload) => {
          if (live) accept(upload, file.name);
        }),
      )
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Runs once per mount: a hand-off is consumed when read.
  }, []);
}
