"""The one route this pack adds to ComfyUI: POST /ima2/send, called by the pack's own menu entry.

It forwards the workflow the editor converted to API format to the ima2 on this computer. It reads no file,
takes no address and no key, and can only register a workflow in ima2: it starts no generation.
"""
from __future__ import annotations

import asyncio

from aiohttp import web
from server import PromptServer

from .ima2_client import Ima2Client
from .ima2_send import send_workflow
from .nodes import Ima2BridgeError


def _own_origin():
    # ima2 runs on this computer, so it reaches this ComfyUI on loopback whatever address ComfyUI listens on.
    return f"http://127.0.0.1:{int(PromptServer.instance.port)}"


@PromptServer.instance.routes.post("/ima2/send")
async def ima2_send_route(request):
    try:
        body = await request.json()
    except ValueError:
        return web.json_response({"ok": False, "code": "BAD_REQUEST", "message": "A JSON body is required."}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "code": "BAD_REQUEST", "message": "A JSON object is required."}, status=400)

    def work():
        try:
            client = Ima2Client(timeout=30)
        except Ima2BridgeError as exc:
            return {"ok": False, "code": "IMA2_UNREACHABLE", "message": str(exc)}
        return send_workflow(client, body.get("graph"), body.get("name"), _own_origin(), label=body.get("label"), replace=body.get("replace") is True)

    # urllib blocks; ComfyUI's event loop must not wait on it.
    result = await asyncio.get_running_loop().run_in_executor(None, work)
    return web.json_response(result)

