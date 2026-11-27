import { useState } from "react";
import type { ComfyResultGraph, HistoryItem } from "@ima2/studio-kit";
import { messages, useT } from "../i18n.ts";
import { useStudio, useStudioApi } from "../studio/context.tsx";
import { Icon } from "./Icon.tsx";

const M = messages(
  {
    button: "Save ComfyUI graph", loading: "Getting the graph",
    saved: "Saved the graph file (.comfy.json). Drop it onto the ComfyUI canvas to open it.",
    ran: "It is the graph ComfyUI ran for this result, with the values it used.",
    node: "It repeats this request with the ima2 node in ComfyUI.",
    pack: "ComfyUI needs the comfyui-ima2 node pack, with ima2 running on the same computer.",
    budget: "The node's spending limit is $0: a paid model is refused until you raise it.",
    none: "There is no ComfyUI graph for this result.",
  },
  {
    button: "ComfyUI 그래프 저장", loading: "그래프를 가져오는 중",
    saved: "그래프 파일(.comfy.json)을 저장했어요. ComfyUI 캔버스에 끌어다 놓으면 열려요.",
    ran: "ComfyUI가 이 결과를 만들 때 실행한 그래프이고, 그때 쓴 값이 들어 있어요.",
    node: "ComfyUI의 ima2 노드로 같은 요청을 다시 보내는 그래프예요.",
    pack: "ComfyUI에 comfyui-ima2 노드 팩이 있고, 같은 컴퓨터에서 ima2가 켜져 있어야 해요.",
    budget: "노드의 지출 한도가 $0이라, 한도를 올리기 전에는 유료 모델이 거절돼요.",
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
 * Saves a result's ComfyUI graph as a file and says what the file is. It is offered to someone who can
 * open the file: the result came from ComfyUI, or this server has a ComfyUI workflow registered. A shared
 * web instance has no ComfyUI routes, so it is never shown there.
 */
export function ComfyGraphButton({ item }: { item: HistoryItem }) {
  const t = useT(M);
  const studio = useStudioApi();
  const web = useStudio((s) => s.webSpend !== null);
  const hasComfy = useStudio((s) => s.catalog?.models.some((model) => model.routes.some((route) => route.route === "local")) ?? false);
  const [state, setState] = useState<State>({ phase: "idle" });
  if (web || !(hasComfy || item.model.startsWith("comfy/"))) return null;
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
          <p>{t("saved")}</p>
          <p>{t(state.result.source === "ima2-node" ? "node" : "ran")}</p>
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
