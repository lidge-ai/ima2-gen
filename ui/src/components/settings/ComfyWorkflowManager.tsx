import { useCallback, useEffect, useRef, useState } from "react";
import {
  createComfyWorkflow,
  deleteComfyWorkflow,
  inspectComfyWorkflow,
  listComfyWorkflows,
  probeComfyOrigin,
  type ComfyBindCandidate,
  type ComfyBindField,
  type ComfyInspectResult,
  type ComfyMediaKind,
  type ComfyServerReport,
  type ComfyWorkflowRecord,
} from "../../lib/api-comfy";
import { buildBind, isEditorFormat, presetSlotRoles, unassignedSlots, workflowMediaModel } from "../../lib/comfyRegistration";
import { useI18n } from "../../i18n";
import { refreshLaneCatalog } from "../../lib/laneCatalog";
import { ComfyRemoteServers } from "./ComfyRemoteServers";
import { ComfyEditorFormatHelp, ComfyFileSlots, ComfyServerReportView } from "./ComfyWorkflowReport";
import { ComfyWorkflowTable } from "./ComfyWorkflowTable";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads a dropped file the way the CLI does: by its bytes.
 *
 * A ComfyUI PNG carries the API graph in its metadata, and someone who saved
 * one as .json should still get a working registration.
 */
async function readWorkflowFile(file: File): Promise<{ graph?: unknown; pngBase64?: string }> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const isPng = PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
  if (isPng) {
    let binary = "";
    for (const byte of buffer) binary += String.fromCharCode(byte);
    return { pngBase64: btoa(binary) };
  }
  return { graph: JSON.parse(new TextDecoder().decode(buffer)) };
}

const BIND_FIELDS: ComfyBindField[] = ["prompt", "negativePrompt", "width", "height", "seed", "refImage", "length", "fps", "duration", "output"];
type Source = { graph?: unknown; pngBase64?: string };
type Registered = { model: string; task?: string; server?: ComfyServerReport };

function candidateKey(candidate: ComfyBindCandidate): string {
  return candidate.input ? `${candidate.node}.${candidate.input}` : candidate.node;
}

export function ComfyWorkflowManager() {
  const { t } = useI18n();
  const [workflows, setWorkflows] = useState<ComfyWorkflowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspection, setInspection] = useState<ComfyInspectResult | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [editorFormat, setEditorFormat] = useState(false);
  const [selection, setSelection] = useState<Partial<Record<ComfyBindField, string>>>({});
  const [slotRoles, setSlotRoles] = useState<Record<string, string>>({});
  const [workflowId, setWorkflowId] = useState("");
  const [label, setLabel] = useState("");
  const [mediaKind, setMediaKind] = useState<ComfyMediaKind>("image");
  const [origin, setOrigin] = useState("http://127.0.0.1:8188");
  const [originState, setOriginState] = useState<{ kind: "idle" | "ok" | "unreachable" | "invalid"; detail?: string }>({ kind: "idle" });
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const originTouched = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listComfyWorkflows();
      setWorkflows(response.workflows);
      // The address field starts from the configured server, until a person types in it.
      if (response.defaultOrigin && !originTouched.current) setOrigin(response.defaultOrigin);
    } catch {
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Asks the server the workflow will run on, so slots and the missing-node report describe that server. */
  const inspect = async (parsed: Source, at: string) => {
    const result = await inspectComfyWorkflow(parsed, at);
    setInspection(result);
    setMediaKind(result.mediaKind ?? "image");
    // Unambiguous candidates are preselected; ambiguous ones stay empty on
    // purpose so the user has to look at them.
    const preset: Partial<Record<ComfyBindField, string>> = {};
    for (const candidate of result.candidates) {
      if (candidate.unambiguous) preset[candidate.field] = candidateKey(candidate);
    }
    setSelection(preset);
    setSlotRoles(presetSlotRoles(result.mediaSlots ?? []));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setRegistered(null);
    setEditorFormat(false);
    try {
      const parsed = await readWorkflowFile(file);
      // The editor format is turned away here with the way to export the right one, not after a round trip.
      if (isEditorFormat(parsed.graph)) {
        setInspection(null);
        setSource(null);
        setEditorFormat(true);
        return;
      }
      await inspect(parsed, origin);
      setSource(parsed);
      if (!workflowId) setWorkflowId(file.name.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 64));
    } catch (cause) {
      setInspection(null);
      setSource(null);
      setError(cause instanceof Error ? cause.message : t("comfy.inspectFailed"));
    }
  };

  /**
   * Reachability goes through the server, never a browser fetch of a typed
   * string. A malformed origin and an unreachable one get different messages:
   * telling someone to start ComfyUI when their URL has no port sends them
   * looking in the wrong place.
   */
  const checkOrigin = async () => {
    setOriginState({ kind: "idle" });
    try {
      const response = await probeComfyOrigin(origin);
      setOriginState(response.health.ok
        ? { kind: "ok", ...(response.health.version ? { detail: response.health.version } : {}) }
        : { kind: "unreachable" });
      // A file already chosen was read against the previous address: read it again against this one.
      if (source) await inspect(source, origin);
    } catch (cause) {
      setOriginState({ kind: "invalid", detail: cause instanceof Error ? cause.message : undefined });
    }
  };

  const slots = inspection?.mediaSlots ?? [];
  const unresolved = (inspection?.candidates ?? [])
    .filter((candidate) => !candidate.unambiguous)
    .map((candidate) => candidate.field)
    .filter((field, index, all) => all.indexOf(field) === index)
    .filter((field) => !selection[field]);
  const slotsWaiting = unassignedSlots(slots, slotRoles).length;

  // A workflow with no text input registers without a prompt: only the node that saves the result is required.
  const canSubmit = Boolean(inspection && workflowId && selection.output && unresolved.length === 0 && slotsWaiting === 0 && !busy);

  const submit = async () => {
    if (!canSubmit || !source) return;
    setBusy(true);
    setError(null);
    try {
      const response = await createComfyWorkflow({
        ...source,
        id: workflowId,
        ...(label ? { label } : {}),
        origin,
        mediaKind,
        bind: buildBind(selection, slots, slotRoles, inspection?.candidates ?? []),
      });
      setRegistered({
        model: response.media?.model ?? workflowMediaModel(response.workflow?.id ?? workflowId),
        ...(response.media?.task ? { task: response.media.task } : {}),
        ...(response.server ? { server: response.server } : {}),
      });
      setInspection(null);
      setSource(null);
      setSelection({});
      setSlotRoles({});
      setWorkflowId("");
      setLabel("");
      setMediaKind("image");
      if (fileRef.current) fileRef.current.value = "";
      await Promise.all([refresh(), refreshLaneCatalog()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("comfy.registerFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setRegistered(null);
    try {
      await deleteComfyWorkflow(id);
      await Promise.all([refresh(), refreshLaneCatalog()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("comfy.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="comfy-manager" aria-labelledby="comfy-workflow-manager-title">
      <article className="settings-row">
        <div className="settings-row-main">
          <div className="section-title" id="comfy-workflow-manager-title">{t("comfy.workflowsTitle")}</div>
          {loading ? <div className="muted">{t("comfy.loading")}</div> : null}
          {!loading && workflows.length === 0 ? <div className="muted">{t("comfy.empty")}</div> : null}
          {workflows.length > 0 ? <ComfyWorkflowTable workflows={workflows} busy={busy} onRemove={(id) => void remove(id)} /> : null}
          {registered ? (
            <div className="comfy-report comfy-report--ok" role="status">
              <strong>{t("comfy.registered", { model: registered.model })}</strong>
              {registered.task ? <p className="mono">ima2 media run --model {registered.model} --task {registered.task} --prompt "…"</p> : null}
            </div>
          ) : null}
          {registered?.server && (!registered.server.reachable || registered.server.missingNodes.length + registered.server.missingChoices.length + registered.server.paidNodes.length > 0)
            ? <ComfyServerReportView report={registered.server} /> : null}
        </div>
      </article>

      <article className="settings-row">
        <div className="settings-row-main">
          <div className="section-title">{t("comfy.addTitle")}</div>

          <div className="comfy-field">
            <label htmlFor="comfy-origin">{t("comfy.originLabel")}</label>
            <div className="comfy-origin-row">
              <input
                id="comfy-origin"
                value={origin}
                onChange={(event) => { originTouched.current = true; setOrigin(event.target.value); setOriginState({ kind: "idle" }); }}
                spellCheck={false}
              />
              <button type="button" onClick={() => void checkOrigin()}>{t("comfy.checkOrigin")}</button>
            </div>
          </div>
          {originState.kind === "ok" ? <div className="status-ok">{t("comfy.originReachable")}{originState.detail ? ` (${originState.detail})` : ""}</div> : null}
          {originState.kind === "unreachable" ? <div className="status-warn">{t("comfy.originUnreachable")}</div> : null}
          {originState.kind === "invalid" ? <div className="status-err">{t("comfy.originInvalid")}</div> : null}

          <div className="comfy-field">
            <label htmlFor="comfy-file">{t("comfy.fileLabel")}</label>
            <input
              id="comfy-file"
              ref={fileRef}
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </div>

          {editorFormat ? <ComfyEditorFormatHelp /> : null}

          {inspection ? (
            <>
              <ComfyServerReportView report={inspection.server} />

              <div className="comfy-field">
                <label htmlFor="comfy-id">{t("comfy.idLabel")}</label>
                <input id="comfy-id" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} spellCheck={false} />
              </div>

              <div className="comfy-field">
                <label htmlFor="comfy-label">{t("comfy.labelLabel")}</label>
                <input id="comfy-label" value={label} onChange={(event) => setLabel(event.target.value)} />
              </div>

              <div className="comfy-field">
                <label htmlFor="comfy-kind">{t("comfy.kindLabel")}</label>
                <select
                  id="comfy-kind"
                  value={mediaKind}
                  onChange={(event) => setMediaKind(event.target.value as ComfyMediaKind)}
                >
                  <option value="image">{t("comfy.kindImage")}</option>
                  <option value="video">{t("comfy.kindVideo")}</option>
                  <option value="audio">{t("comfy.kindAudio")}</option>
                </select>
                {mediaKind === "video" ? <div className="muted">{t("comfy.videoKindHint")}</div> : null}
              </div>

              <div className="section-title">{t("comfy.bindTitle")}</div>
              {unresolved.length > 0 ? (
                <div className="muted">{t("comfy.bindAmbiguous")}</div>
              ) : null}

              {BIND_FIELDS.map((field) => {
                const candidates = inspection.candidates.filter((candidate) => candidate.field === field);
                if (candidates.length === 0) return null;
                const ambiguous = candidates.some((candidate) => !candidate.unambiguous);
                const selectId = `comfy-bind-${field}`;
                return (
                  <div key={field} className="comfy-bind-row">
                    <label htmlFor={selectId}>{t(`comfy.field.${field}`)}</label>
                    <select
                      id={selectId}
                      value={selection[field] ?? ""}
                      onChange={(event) => setSelection((prev) => ({ ...prev, [field]: event.target.value }))}
                      aria-invalid={ambiguous && !selection[field]}
                    >
                      <option value="">{t("comfy.choose")}</option>
                      {candidates.map((candidate) => (
                        <option key={candidateKey(candidate)} value={candidateKey(candidate)}>
                          {candidateKey(candidate)} — {candidate.classType}{candidate.title ? ` "${candidate.title}"` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {!selection.prompt ? <div className="muted">{t("comfy.promptNone")}</div> : null}
              {!selection.output ? <div className="status-warn">{t("comfy.outputRequired")}</div> : null}

              <ComfyFileSlots slots={slots} roles={slotRoles} onChange={(key, role) => setSlotRoles((prev) => ({ ...prev, [key]: role }))} />

              <button type="button" className="settings-action-btn" onClick={() => void submit()} disabled={!canSubmit}>
                {t("comfy.register")}
              </button>
            </>
          ) : null}

          {error ? <div className="status-err" role="alert">{error}</div> : null}
        </div>
      </article>

      <article className="settings-row">
        <div className="settings-row-main">
          <ComfyRemoteServers />
        </div>
      </article>
    </div>
  );
}

