// ima2 for ComfyUI: "Send workflow to ima2" in the Workflow menu.
//
// The editor converts the open workflow to the API format (only it can do that reliably) and the pack's
// own route hands it to the ima2 on this computer, which registers it as a model: comfy/<name>.
// Nothing is generated and no key or address is involved.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const COMMAND = "ima2.sendWorkflow";
const ui = () => app.extensionManager ?? {};

function tell(severity, summary, detail) {
  const toast = ui().toast;
  if (toast?.add) toast.add({ severity, summary, detail, life: severity === "success" ? 8000 : 15000 });
  else window.alert(summary + (detail ? "\n\n" + detail : ""));
}

async function ask(title, message, defaultValue) {
  const dialog = ui().dialog;
  if (dialog?.prompt) return dialog.prompt({ title, message, defaultValue });
  return window.prompt(title + "\n" + message, defaultValue);
}

async function agree(title, message) {
  const dialog = ui().dialog;
  if (dialog?.confirm) return (await dialog.confirm({ title, message })) === true;
  return window.confirm(title + "\n" + message);
}

function currentName() {
  const active = ui().workflow?.activeWorkflow;
  const name = active?.filename ?? active?.key ?? "";
  return String(name).replace(/\.json$/i, "").split("/").pop() || "workflow";
}

async function post(body) {
  const response = await api.fetchApi("/ima2/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

async function sendWorkflow() {
  const { output } = await app.graphToPrompt();
  if (!output || Object.keys(output).length === 0) return tell("warn", "Nothing to send", "The workflow is empty.");
  const name = await ask("Send workflow to ima2", "Name it. ima2 lists it as comfy/<name> and runs it on this ComfyUI.", currentName());
  if (!name) return undefined;
  let result = await post({ graph: output, name, label: name });
  if (result.code === "COMFY_WORKFLOW_ID_TAKEN" && (await agree("Replace it?", "ima2 already has a workflow with that name. Replace it with this one?"))) {
    result = await post({ graph: output, name, label: name, replace: true });
  }
  if (!result.ok) {
    const undecided = Array.isArray(result.undecided) ? "\n" + result.undecided.join("\n") : "";
    return tell("error", "Not sent to ima2", String(result.message ?? result.code) + undecided);
  }
  const problems = Array.isArray(result.problems) && result.problems.length > 0 ? "\nima2 reports: " + result.problems.join("; ") : "";
  return tell(problems ? "warn" : "success", "Registered in ima2 as " + result.model, "Choose it in ima2's model list, or run: ima2 media run --model " + result.model + problems);
}

app.registerExtension({
  name: "ima2.sendWorkflow",
  commands: [{ id: COMMAND, label: "Send workflow to ima2", icon: "pi pi-send", function: () => sendWorkflow().catch((error) => tell("error", "Not sent to ima2", String(error?.message ?? error))) }],
  menuCommands: [{ path: ["Workflow"], commands: [COMMAND] }],
});

