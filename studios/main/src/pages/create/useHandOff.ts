import { useEffect, useRef } from "react";
import { handOffFile, takeHandOff, watchHandOff, type HandOff } from "../../studio/handoff.ts";
import { useStudioApi } from "../../studio/context.tsx";
import type { UploadedInput } from "@ima2/studio-kit";

/**
 * Picks up a result sent from another screen, or from a result opened on this one, and uploads it.
 * onError reports a result that could not be brought over, so the action never looks ignored.
 */
export function useHandOff(
  target: HandOff["target"],
  accept: (upload: UploadedInput, name: string, values?: HandOff["values"]) => void,
  onError?: () => void,
): void {
  const studio = useStudioApi();
  const latest = useRef({ accept, onError });
  latest.current = { accept, onError };
  useEffect(
    () =>
      watchHandOff(() => {
        const value = takeHandOff(target);
        if (!value) return false;
        // No unmount guard: the hand-off is consumed when read, and a remount (React strict mode)
        // must still receive it. Setting state on the same component is safe.
        void handOffFile(value)
          .then((file) => studio.upload(file).then((upload) => latest.current.accept(upload, file.name, value.values)))
          .catch(() => latest.current.onError?.());
        return true;
      }),
    [studio, target],
  );
}
