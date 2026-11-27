import type { ComfyMediaSlotCandidate, ComfyServerReport } from "../../lib/api-comfy";
import { reportSummary, slotKey, SLOT_ROLES } from "../../lib/comfyRegistration";
import { useI18n } from "../../i18n";

/**
 * What the server the workflow will run on says about it: reachable or not, and the node types and
 * model files it lacks. Nothing here blocks registration; it says what will fail and what to install.
 */
export function ComfyServerReportView({ report }: { report: ComfyServerReport | undefined }) {
  const { t } = useI18n();
  const summary = reportSummary(report);
  if (summary.state === "unknown") return null;
  if (summary.state === "unreachable") {
    return (
      <div className="comfy-report comfy-report--warn" role="status">
        <strong>{t("comfy.reportUnreachable", { origin: summary.origin })}</strong>
        <p>{t("comfy.reportUnreachableHint")}</p>
        <p className="mono">{summary.reason}</p>
      </div>
    );
  }
  const paid = summary.paidNodes.length > 0 ? <p>{t("comfy.reportPaid", { nodes: summary.paidNodes.join(", ") })}</p> : null;
  if (summary.state === "ready") {
    return (
      <div className="comfy-report comfy-report--ok" role="status">
        <strong>{t("comfy.reportReady", { origin: summary.origin })}</strong>
        {paid}
      </div>
    );
  }
  return (
    <div className="comfy-report comfy-report--warn" role="status">
      <strong>{t("comfy.reportProblems", { origin: summary.origin })}</strong>
      {summary.missingNodes.length > 0 ? (
        <>
          <p>{t("comfy.reportMissingNodes")}</p>
          <ul>
            {summary.missingNodes.map((entry) => (
              <li key={entry.classType}><span className="mono">{entry.classType}</span> {t("comfy.reportNodeIds", { nodes: entry.nodes.join(", ") })}</li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.missingModels.length > 0 ? (
        <>
          <p>{t("comfy.reportMissingModels")}</p>
          <ul>
            {summary.missingModels.map((choice) => (
              <li key={choice.node + "." + choice.input}><span className="mono">{choice.value}</span> {t("comfy.reportChoiceAt", { node: choice.node, classType: choice.classType, input: choice.input })}</li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.otherChoices.length > 0 ? (
        <>
          <p>{t("comfy.reportOtherChoices")}</p>
          <ul>
            {summary.otherChoices.map((choice) => (
              <li key={choice.node + "." + choice.input}><span className="mono">{choice.value}</span> {t("comfy.reportChoiceAt", { node: choice.node, classType: choice.classType, input: choice.input })}</li>
            ))}
          </ul>
        </>
      ) : null}
      {paid}
      <p>{t("comfy.reportCanRegister")}</p>
    </div>
  );
}

/** One row per file the workflow takes. A role the graph settles is preselected; the rest wait for a person. */
export function ComfyFileSlots({ slots, roles, onChange }: {
  slots: readonly ComfyMediaSlotCandidate[];
  roles: Readonly<Record<string, string | undefined>>;
  onChange: (key: string, role: string) => void;
}) {
  const { t } = useI18n();
  if (slots.length === 0) return null;
  return (
    <>
      <div className="section-title">{t("comfy.slotsTitle")}</div>
      <div className="muted">{t("comfy.slotsHint")}</div>
      {slots.map((slot) => {
        const key = slotKey(slot);
        const selectId = "comfy-slot-" + key.replace(/[^a-zA-Z0-9_-]/g, "-");
        return (
          <div key={key} className="comfy-bind-row">
            <label htmlFor={selectId}>
              {t("comfy.slotKind." + slot.kind)} <span className="mono">{key}</span> — {slot.classType}{slot.title ? ` "${slot.title}"` : ""}
            </label>
            <select id={selectId} value={roles[key] ?? ""} onChange={(event) => onChange(key, event.target.value)} aria-invalid={!roles[key]}>
              <option value="">{t("comfy.choose")}</option>
              {SLOT_ROLES[slot.kind].map((role) => <option key={role} value={role}>{t("comfy.role." + role)}</option>)}
            </select>
          </div>
        );
      })}
    </>
  );
}

/** Shown in place of the form when the file is ComfyUI's editor format: why it cannot be used, and how to get one that can. */
export function ComfyEditorFormatHelp() {
  const { t } = useI18n();
  return (
    <div className="comfy-report comfy-report--warn" role="alert">
      <strong>{t("comfy.editorFormatTitle")}</strong>
      <p>{t("comfy.editorFormatWhy")}</p>
      <ol>
        <li>{t("comfy.editorFormatStep1")}</li>
        <li>{t("comfy.editorFormatStep2")}</li>
        <li>{t("comfy.editorFormatStep3")}</li>
      </ol>
      <p>{t("comfy.editorFormatPng")}</p>
    </div>
  );
}

