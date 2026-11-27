"""Sends a workflow from ComfyUI to ima2, to be registered there as a media model. No ComfyUI or torch imports.

ima2 inspects the graph against the ComfyUI it came from. When nothing is left to decide (one prompt, one
output, every file input settled by the graph) it is registered at once. A choice only a person can make
is handed back with what is undecided, and nothing is registered: a guess here would swap prompts silently.
"""
from __future__ import annotations

import re

from .ima2_client import Ima2ApiError
from .nodes import Ima2BridgeError

FIELDS = ("prompt", "negativePrompt", "width", "height", "seed")
SETTINGS_HINT = "Export it with Workflow > Export (API) and add that file in ima2 Settings > ComfyUI workflows, where each one can be chosen."


def workflow_id(name):
    """An id ima2 accepts, from a workflow's name: lower case, digits and dashes."""
    stem = re.sub(r"\.json$", "", str(name or "").strip(), flags=re.IGNORECASE)
    return re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")[:64]


def describe_problems(report):
    """What the server lacks, one line each. A registration goes through regardless; these say what will fail."""
    if not isinstance(report, dict):
        return []
    if report.get("reachable") is False:
        return [f"ComfyUI at {report.get('origin')} did not answer ima2: {report.get('reason')}"]
    lines = [f"node type not installed: {entry.get('classType')}" for entry in report.get("missingNodes") or []]
    for choice in report.get("missingChoices") or []:
        what = "model file not on the server" if choice.get("model") else f"setting the server does not offer ({choice.get('classType')}.{choice.get('input')})"
        lines.append(f"{what}: {choice.get('value')}")
    if report.get("paidNodes"):
        lines.append("paid partner nodes (ComfyUI may charge your Comfy account): " + ", ".join(report["paidNodes"]))
    return lines


def _refusal(code, message, **more):
    return dict({"ok": False, "code": code, "message": message}, **more)


def _plan(inspection):
    """The bind to register, or the choices that are still open."""
    by_field, undecided = {}, []
    for entry in inspection.get("candidates") or []:
        by_field.setdefault(entry.get("field"), []).append(entry)
    bind = {}
    for field in (*FIELDS, "output"):
        options = by_field.get(field) or []
        # ima2 marks the one it settled (the text a sampler's positive input leads to) and may list other
        # candidates beside it for a person to pick instead. One settled candidate is the answer.
        settled = [entry for entry in options if entry.get("unambiguous")]
        if len(settled) == 1:
            entry = settled[0]
            bind[field] = {"node": entry["node"]} if field == "output" else {"node": entry["node"], "input": entry["input"]}
        elif options:
            undecided.append(f"{field}: " + " or ".join(f"{e['node']}.{e['input']}" if e.get("input") else str(e["node"]) for e in options))
    slots = []
    for slot in inspection.get("mediaSlots") or []:
        if slot.get("role"):
            slots.append({"kind": slot["kind"], "role": slot["role"], "node": slot["node"], "input": slot["input"]})
        else:
            undecided.append(f"file input {slot['node']}.{slot['input']} ({slot.get('classType') or slot['kind']})")
    if inspection.get("mediaSlots"):
        bind["inputs"] = slots
    return bind, undecided


def send_workflow(client, graph, name, origin, label=None, replace=False):
    """Registers graph (API format) in ima2 as comfy/<id>, running on the ComfyUI at origin. Returns a plain result dict."""
    if not isinstance(graph, dict) or not graph:
        return _refusal("EMPTY_GRAPH", "The workflow is empty: add nodes before sending it to ima2.")
    wid = workflow_id(name)
    if not wid:
        return _refusal("NO_ID", "Give the workflow a name with letters or digits; ima2 lists it as comfy/<name>.")
    if any(str(node.get("class_type", "")).startswith("Ima2") for node in graph.values() if isinstance(node, dict)):
        return _refusal("USES_IMA2_NODES", "This workflow uses ima2 nodes. Registered in ima2 it would make ima2 call itself; send a workflow that does the work in ComfyUI.")
    try:
        inspection = client.inspect_workflow(graph, origin)
        bind, undecided = _plan(inspection)
        if undecided:
            return _refusal("NEEDS_A_PERSON", "Some parts of this workflow can go more than one way, so it was not registered. " + SETTINGS_HINT, undecided=undecided)
        if "output" not in bind:
            return _refusal("NO_OUTPUT", "ima2 found no node that saves a result. Add a Save Image, Save Video or Save Audio node and send it again.")
        body = {"graph": graph, "id": wid, "origin": origin, "bind": bind}
        if label:
            body["label"] = str(label)
        if inspection.get("mediaKind"):
            body["mediaKind"] = inspection["mediaKind"]
        if replace:
            body["replace"] = True
        answer = client.register_workflow(body)
    except Ima2ApiError as exc:
        return _refusal(exc.code or "IMA2_REFUSED", str(exc))
    except Ima2BridgeError as exc:
        return _refusal("IMA2_UNREACHABLE", str(exc))
    media = answer.get("media") if isinstance(answer.get("media"), dict) else {}
    return {"ok": True, "id": wid, "model": media.get("model") or "comfy/" + wid, "task": media.get("task"),
            "problems": describe_problems(answer.get("server"))}

