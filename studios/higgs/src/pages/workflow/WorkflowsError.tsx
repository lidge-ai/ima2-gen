import { messages, useT } from "../../i18n.ts";
import { useStudioApi } from "../../studio/context.tsx";

const M = messages(
  { failed: "Could not load workflows: {error}", retry: "Retry" },
  { failed: "워크플로를 불러오지 못했어요: {error}", retry: "다시 시도" },
);

/** Workflow list failed to load: say so and offer the one recovery there is. */
export function WorkflowsError({ error }: { error: string }) {
  const t = useT(M);
  const studio = useStudioApi();
  return (
    <div className="empty" role="alert">
      <p>{t("failed", { error })}</p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void studio.refreshWorkflows();
        }}
      >
        {t("retry")}
      </button>
    </div>
  );
}
