import type { ComfyWorkflowRecord } from "../../lib/api-comfy";
import { workflowMediaModel } from "../../lib/comfyRegistration";
import { useI18n } from "../../i18n";

/** Registered workflows: what each makes, the media model it is listed as, where it runs and whether that server answered. */
export function ComfyWorkflowTable({ workflows, busy, onRemove }: {
  workflows: readonly ComfyWorkflowRecord[];
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="comfy-table-scroll">
      <table className="comfy-workflow-table">
        <thead>
          <tr>
            <th scope="col">{t("comfy.colId")}</th>
            <th scope="col">{t("comfy.colKind")}</th>
            <th scope="col">{t("comfy.colModel")}</th>
            <th scope="col">{t("comfy.colOrigin")}</th>
            <th scope="col">{t("comfy.colStatus")}</th>
            <th scope="col"><span className="sr-only">{t("comfy.colActions")}</span></th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((workflow) => {
            const live = workflow.health?.ok === true;
            const statusId = `comfy-status-${workflow.id}`;
            return (
              <tr key={workflow.id}>
                <td>{workflow.label || workflow.id}</td>
                <td>{workflow.mediaKind === "video" ? t("comfy.kindVideo") : workflow.mediaKind === "audio" ? t("comfy.kindAudio") : t("comfy.kindImage")}</td>
                <td className="mono">{workflowMediaModel(workflow.id)}</td>
                <td className="mono">{workflow.origin}</td>
                {/* Status is never encoded by colour alone. */}
                <td id={statusId}>
                  <span className={live ? "status-ok" : "status-warn"}>
                    {live ? t("comfy.statusReady") : t("comfy.statusOffline")}
                  </span>
                </td>
                <td>
                  <button type="button" onClick={() => onRemove(workflow.id)} disabled={busy} aria-describedby={statusId}>
                    {t("comfy.remove")}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

