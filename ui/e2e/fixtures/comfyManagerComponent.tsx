import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { ComfyWorkflowManager } from "../../src/components/settings/ComfyWorkflowManager";
import { useLaneCatalog } from "../../src/hooks/useLaneCatalog";
import { getLaneCatalogSnapshot, type LaneCatalogSnapshot } from "../../src/lib/laneCatalog";

export type ManagerScenario = "create-success" | "create-failure" | "delete-success" | "delete-failure" | "create-catalog-error";
type Call = { method: string; path: string; body: unknown; outcome: string };
type Workflow = { id: string; label: string; origin: string; mediaKind: "image"; bind: { prompt: { node: string; input: string }; output: { node: string } }; params: []; createdAt: number; updatedAt: number };
const GRAPH = { "1": { class_type: "CLIPTextEncode", inputs: { text: "cedar" } }, "2": { class_type: "SaveImage", inputs: {} } };
const workflow = (): Workflow => ({ id: "cedar-a", label: "Cedar", origin: "http://127.0.0.1:8188", mediaKind: "image",
  bind: { prompt: { node: "1", input: "text" }, output: { node: "2" } }, params: [], createdAt: 1, updatedAt: 1 });
let scenario: ManagerScenario, workflows: Workflow[] = [], root: Root | undefined;
let inspectionDone = false, writeSucceeded = false, pending: (() => void) | null = null;
let calls: Call[] = [], violations: string[] = [];
const observations: Record<string, LaneCatalogSnapshot | undefined> = {};

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unexpected synthetic API payload");
}
function assertBody(actual: unknown, expected: Record<string, unknown>) {
  if (!actual || typeof actual !== "object") throw new Error("Missing synthetic body");
  equal(Object.keys(actual).sort(), Object.keys(expected).sort());
  for (const key of Object.keys(expected)) equal((actual as Record<string, unknown>)[key], expected[key]);
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const method = init.method ?? "GET", body = init.body === undefined ? undefined : JSON.parse(String(init.body));
  const call: Call = { method, path, body, outcome: "pending" }; calls.push(call);
  try {
    if (method === "GET" && ["/api/models", "/api/comfy/workflows"].includes(path)) {
      if (body !== undefined) throw new Error("GET body forbidden");
      if (path === "/api/comfy/workflows") { call.outcome = "success"; return { ok: true, workflows: [...workflows] }; }
      if (writeSucceeded && scenario === "create-catalog-error") {
        call.outcome = "expected-503"; throw Object.assign(new Error("Synthetic catalog failure"), { status: 503 });
      }
      call.outcome = "success";
      return { ok: true, lanes: { comfy: { status: workflows.length ? "ready" : "disconnected",
        models: { image: workflows.map(({ id, label }) => ({ id, label })), video: [] } } } };
    }
    if (method === "POST" && path === "/api/comfy/inspect") {
      // The inspection names the server the workflow will run on.
      assertBody(body, { graph: GRAPH, origin: "http://127.0.0.1:8188" }); inspectionDone = true; call.outcome = "success";
      return { ok: true, mediaKind: "image", nodes: [], needsConfirmation: false, candidates: [
        { field: "prompt", node: "1", input: "text", classType: "CLIPTextEncode", unambiguous: true },
        { field: "output", node: "2", input: "", classType: "SaveImage", unambiguous: true },
      ] };
    }
    return await mutation(call, body);
  } catch (error) {
    if (!call.outcome.startsWith("expected-")) { call.outcome = "violation"; violations.push(String(error)); }
    throw error;
  }
}

async function mutation(call: Call, body: unknown) {
  const creating = call.method === "POST" && call.path === "/api/comfy/workflows";
  const deleting = call.method === "DELETE" && call.path === "/api/comfy/workflows/cedar-a";
  if ((!creating && !deleting) || pending || writeSucceeded) throw new Error("Unexpected synthetic mutation");
  if (creating) {
    if (!inspectionDone || !scenario.startsWith("create")) throw new Error("Create before inspect");
    assertBody(body, { graph: GRAPH, id: "cedar-a", label: "Cedar", origin: "http://127.0.0.1:8188", mediaKind: "image", bind: workflow().bind });
  } else if (body !== undefined || !scenario.startsWith("delete")) throw new Error("Invalid delete");
  await new Promise<void>((resolve) => { pending = resolve; });
  if (scenario.endsWith("failure")) { call.outcome = "expected-write-failure"; throw new Error("Synthetic write rejected"); }
  workflows = creating ? [workflow()] : []; writeSucceeded = true; call.outcome = "success";
  return creating ? { ok: true, workflow: workflow() } : { ok: true, id: "cedar-a" };
}

function Observer({ id }: { id: string }) {
  const state = useLaneCatalog(); observations[id] = getLaneCatalogSnapshot();
  return <output id={id} data-phase={state.phase}>{JSON.stringify({ phase: state.phase, error: state.error, observedAt: state.observedAt,
    ids: state.catalog?.comfy?.models.image.map((row) => row.id) ?? [] })}</output>;
}

function snapshot() {
  return { calls: calls.map((call) => ({ ...call })), violations: [...violations], workflows: [...workflows], pending: pending !== null,
    sameSnapshot: observations.a !== undefined && observations.a === observations.b,
    resource: getLaneCatalogSnapshot(), first: document.getElementById("a")?.textContent,
    second: document.getElementById("b")?.textContent,
    manager: document.querySelector("[aria-labelledby='comfy-workflow-manager-title']")?.textContent ?? "" };
}
function mount(input: ManagerScenario) {
  scenario = input; workflows = input.startsWith("delete") ? [workflow()] : [];
  calls = []; violations = []; inspectionDone = false; writeSucceeded = false;
  const host = document.getElementById("root"); if (!host) throw new Error("Missing manager host");
  root = createRoot(host);
  flushSync(() => root!.render(<><ComfyWorkflowManager /><Observer id="a" /><Observer id="b" /></>));
}
function release() { const resolve = pending; pending = null; resolve?.(); }
function unmount() { release(); flushSync(() => root?.unmount()); root = undefined; }
declare global { interface Window { wp08c: { mount: typeof mount; snapshot: typeof snapshot; release: typeof release; unmount: typeof unmount }; wp08cApi: typeof api } }
window.wp08cApi = api;
window.wp08c = { mount, snapshot, release, unmount };
