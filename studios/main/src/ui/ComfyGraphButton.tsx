import { useState } from "react";
import type { ComfyResultGraph, HistoryItem } from "@ima2/studio-kit";
import { messages, useT } from "../i18n.ts";
import { useStudio, useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";

const M = messages(
  {
    button: "ComfyUI graph", loading: "Getting the graph",
    ran: "Saved {file}. It is the graph ComfyUI ran for this result, with the values it used.",
    node: "Saved {file}. It repeats this request with the ima2 node in ComfyUI.",
    open: "Drop the file onto the ComfyUI canvas to open it.",
    pack: "ComfyUI needs the ima2 node pack (comfyui-ima2), and ima2 must be running on the same computer.",
    budget: "The node's spending limit is $0, so a paid model is refused until you raise it. Opening or queueing the graph as it is costs nothing.",
    none: "There is no ComfyUI graph for this result.",
  },
  {
    button: "ComfyUI 그래프", loading: "그래프를 가져오는 중",
    ran: "{file} 파일을 저장했어요. ComfyUI가 이 결과를 만들 때 실행한 그래프이고, 그때 쓴 값이 들어 있어요.",
    node: "{file} 파일을 저장했어요. ComfyUI의 ima2 노드로 같은 요청을 다시 보내는 그래프예요.",
    open: "파일을 ComfyUI 캔버스에 끌어다 놓으면 열려요.",
    pack: "ComfyUI에 ima2 노드 팩(comfyui-ima2)이 설치되어 있고, 같은 컴퓨터에서 ima2가 켜져 있어야 해요.",
    budget: "노드의 지출 한도가 $0이라 유료 모델은 한도를 올리기 전까지 거절돼요. 그래프를 그대로 열거나 실행해도 비용이 들지 않아요.",
    none: "이 결과에는 ComfyUI 그래프가 없어요.",
  },
);

/** The two notes the server always sends with an ima2-node graph; they are shown in the studio's own words. */
const STANDARD_NOTE = /^(Needs the ima2 node pack|max_usd is 0)/;

export function graphFileName(historyId: string): string {
  return historyId.replace(/\.[a-z0-9]+$/i, "") + ".comfy.json";
}

function saveFile(name: string, graph: ComfyResultGraph["graph"]): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

type State = { phase: "idle" | "loading" } | { phase: "saved"; result: ComfyResultGraph } | { phase: "failed"; reason: string };

/**
 * Saves a result's ComfyUI graph as a file and says what the file is. A shared web instance has no
 * ComfyUI routes, so the button is not shown there.
 */
export function ComfyGraphButton({ item }: { item: HistoryItem }) {
  const t = useT(M);
  const studio = useStudioApi();
  const web = useStudio((s) => s.webSpend !== null);
  const [state, setState] = useState<State>({ phase: "idle" });
  if (web) return null;
  const file = graphFileName(item.historyId);
  const fetchGraph = async () => {
    setState({ phase: "loading" });
    try {
      const result = await studio.client.comfy.resultGraph(item.historyId);
      saveFile(file, result.graph);
      setState({ phase: "saved", result });
    } catch (error) {
      setState({ phase: "failed", reason: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <>
      <button type="button" className="btn" disabled={state.phase === "loading"} onClick={() => void fetchGraph()}>
        <Icon name="layers" size={15} /> {state.phase === "loading" ? t("loading") : t("button")}
      </button>
      {state.phase === "saved" ? (
        <div className="lightbox-note" role="status">
          <p>
            {t(state.result.source === "ima2-node" ? "node" : "ran", { file })} {t("open")}
          </p>
          {state.result.source === "ima2-node" ? (
            <>
              <p>{t("pack")}</p>
              <p>{t("budget")}</p>
            </>
          ) : null}
          {/* Anything else the server said about this graph (input files it could not include), in its words. */}
          {state.result.source === "ima2-node"
            ? state.result.notes.filter((note) => !STANDARD_NOTE.test(note)).map((note) => <p key={note}>{note}</p>)
            : null}
        </div>
      ) : null}
      {state.phase === "failed" ? (
        <div className="lightbox-note" role="alert">
          <p>{t("none")}</p>
          <p>{state.reason}</p>
        </div>
      ) : null}
    </>
  );
}
