import type { ImageTask } from "@ima2/studio-kit";
import { messages, useT } from "../../i18n.ts";
import type { ImageTool } from "./imageState.ts";

const M = messages(
  { tool: "Tool", create: "Create", "image-to-image": "Edit", "image-upscale": "Upscale", "image-vectorize": "Vectorize", "image-segment": "Separate" },
  { tool: "도구", create: "만들기", "image-to-image": "편집", "image-upscale": "업스케일", "image-vectorize": "벡터화", "image-segment": "분리" },
);

/** Create, plus the image tools this catalog can run. */
export function ImageToolTabs({ tool, tools, onPick }: { tool: ImageTool; tools: readonly ImageTask[]; onPick: (tool: ImageTool) => void }) {
  const t = useT(M);
  if (tools.length === 0) return null;
  return (
    <div className="dock-tools" role="group" aria-label={t("tool")}>
      {(["create", ...tools] as const).map((value) => (
        <button key={value} type="button" className="chip" aria-pressed={tool === value} onClick={() => { if (value !== tool) onPick(value); }}>
          {t(value)}
        </button>
      ))}
    </div>
  );
}
