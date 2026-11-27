"""Runs one ima2 media job from start to finish. No ComfyUI or torch imports, so it is tested on its own."""
from __future__ import annotations

import time
import uuid
from urllib.parse import urlsplit

from .nodes import Ima2BridgeError

TERMINAL = ("completed", "error", "canceled")
WORKFLOW_PREFIX = "comfy/"
LOOPBACK = ("127.0.0.1", "localhost", "::1", "0.0.0.0", "::")


class Ima2Interrupted(Ima2BridgeError):
    """The ComfyUI run was stopped; the ima2 job was canceled with it."""


def models_for(catalog, kind):
    """Model ids of one kind, the ones that can run right now first."""
    models = [m for m in catalog.get("models", []) if m.get("kind") == kind and isinstance(m.get("id"), str)]
    ready = [m["id"] for m in models if m.get("defaultRoute")]
    waiting = [m["id"] for m in models if not m.get("defaultRoute")]
    return ready + waiting


def same_server(origin, own_server):
    """True when origin is the ComfyUI at own_server, an (address, port) pair."""
    if not own_server:
        return False
    try:
        parts = urlsplit(str(origin))
        port = parts.port or {"http": 80, "https": 443}.get(parts.scheme)
    except ValueError:
        return False
    host, (own_host, own_port) = (parts.hostname or "").lower(), own_server
    return bool(host) and port == own_port and (host in LOOPBACK or host == str(own_host).lower())


def refuse_own_server(client, model, own_server):
    """A workflow model runs on a ComfyUI. On the one running this node it would queue behind this very run and wait forever."""
    if not own_server or not str(model).startswith(WORKFLOW_PREFIX):
        return
    origin = client.workflow_origin(str(model)[len(WORKFLOW_PREFIX):])
    if same_server(origin, own_server):
        raise Ima2BridgeError(
            f"{model} is a workflow on this same ComfyUI ({origin}), which runs one graph at a time: it would wait for itself. "
            "Open that workflow here instead, or register it in ima2 on another ComfyUI server."
        )


def pick_task(kind, roles):
    """The task the connected inputs ask for. ima2 refuses it when the model cannot do it."""
    has = lambda *names: any(role in roles for role in names)
    if kind == "image":
        return "image-to-image" if roles else "text-to-image"
    if kind == "audio":
        return "video-to-audio" if has("source-video") else "text-to-audio"
    if has("source-audio"):
        return "lipsync" if has("source-video") else "avatar"
    if has("source-video"):
        return "video-to-video"
    if has("first-frame", "last-frame"):
        return "image-to-video"
    return "reference-to-video" if has("reference-image") else "text-to-video"


def describe_estimate(estimate):
    """One line a person reads before and after the run."""
    local = estimate.get("local")
    if isinstance(local, dict):
        seconds = local.get("expectedSec")
        when = f"about {seconds:g} s on your machine" if isinstance(seconds, (int, float)) else "time unknown (first run)"
        return "runs locally, " + when + (", may be charged by a paid node" if local.get("mayBill") else ", no provider charge")
    usd = estimate.get("usd")
    return f"estimated ${usd:g}" if isinstance(usd, (int, float)) else "price unknown: " + str(estimate.get("note") or "the provider publishes none")


def check_budget(estimate, max_usd):
    """Stops before anything is billed. An unknown price is treated as over budget, never as free."""
    usd = estimate.get("usd")
    if isinstance(usd, (int, float)):
        if usd > max_usd:
            raise Ima2BridgeError(f"The estimate is ${usd:g}, above max_usd ${max_usd:g}. Raise max_usd on the node to run it.")
        return
    raise Ima2BridgeError(
        "ima2 cannot price this run (" + str(estimate.get("note") or "no published price") + "). "
        "Set max_usd to -1 on the node to run it without a price check."
    )


def _status_line(job, estimate_line, started):
    phase = job.get("phase") or job.get("status") or "queued"
    return f"ima2: {phase}, {int(time.time() - started)} s, {estimate_line}"


def run_media_job(client, request, inputs, max_usd=0.0, on_status=None, interrupted=None, sleep=time.sleep, timeout=1800, poll=1.0, own_server=None):
    """Estimate, check the budget, upload inputs, submit, wait, and return the saved outputs with their bytes.

    request: model, task, prompt and the optional settings ima2's POST /api/media takes.
    inputs: [(role, bytes, mime_type)].
    interrupted: called between polls; True cancels the ima2 job and raises Ima2Interrupted.
    own_server: (address, port) of the ComfyUI running the node, so a workflow model on it is refused.
    """
    notify = on_status or (lambda _line: None)
    body = {key: value for key, value in request.items() if value not in (None, "")}
    refuse_own_server(client, body.get("model"), own_server)
    estimate = client.estimate(dict(body))
    estimate_line = describe_estimate(estimate)
    if max_usd >= 0:
        check_budget(estimate, max_usd)
    notify("ima2: " + estimate_line)
    if interrupted and interrupted():
        raise Ima2Interrupted("stopped before the job was sent")
    body["inputs"] = [{"role": role, "ref": client.upload(data, mime_type), "mimeType": mime_type} for role, data, mime_type in inputs]
    request_id = "comfyui_" + uuid.uuid4().hex
    body["requestId"] = request_id
    accepted = client.submit(body)
    started = time.time()
    while True:
        if interrupted and interrupted():
            client.cancel(request_id)
            raise Ima2Interrupted("stopped; the ima2 job was canceled")
        job = client.job(request_id) or {}
        status = job.get("status")
        if status in TERMINAL:
            break
        # A finished job leaves the active list a moment before it is listed as recent: its outputs settle it.
        if not job and time.time() - started > 3 and client.outputs(request_id):
            status = "completed"
            break
        if time.time() - started > timeout:
            client.cancel(request_id)
            raise Ima2BridgeError(f"ima2 did not finish within {timeout} s; the job was canceled")
        notify(_status_line(job, estimate_line, started))
        sleep(poll)
    if status == "canceled":
        raise Ima2Interrupted("the ima2 job was canceled")
    if status == "error":
        code = job.get("errorCode") or "MEDIA_FAILED"
        category = (job.get("meta") or {}).get("category")
        raise Ima2BridgeError(f"ima2 job failed: {code}" + (f" ({category})" if category else "") + f". The full reason is in ima2 under request {request_id}.")
    items = client.outputs(request_id)
    if not items:
        raise Ima2BridgeError(f"ima2 finished request {request_id} but saved no output")
    outputs = [{"filename": item.get("filename"), "mediaType": item.get("mediaType"), "mimeType": item.get("mimeType"),
                "data": client.download(item["filename"])} for item in items if isinstance(item.get("filename"), str)]
    first = items[0]
    return {
        "requestId": request_id, "model": accepted.get("model") or body.get("model"), "adapter": accepted.get("adapter"),
        "task": body.get("task"), "estimate": {key: estimate.get(key) for key in ("usd", "unit", "quantity", "route", "note", "local") if key in estimate},
        "billed": first.get("billed"), "elapsed": round(time.time() - started, 1), "outputs": outputs,
    }
