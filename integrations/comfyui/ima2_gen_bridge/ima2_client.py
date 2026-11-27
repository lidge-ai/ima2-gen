"""HTTP client for a local ima2 server. Standard library only.

The server address is never a node input: it is found from the environment or
from the file a running ima2 writes, and only a loopback address is accepted
(see nodes._resolve_server_url). Keys stay in ima2; this client holds none.
"""
from __future__ import annotations

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .nodes import IMA2_CLIENT_HEADER, Ima2BridgeError, _resolve_server_url

MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3


class Ima2ApiError(Ima2BridgeError):
    """A refusal from ima2, with the code and category it sent."""

    def __init__(self, message, code="", status=0, category=""):
        super().__init__(message)
        self.code = code
        self.status = status
        self.category = category


def _error_from_body(status, text):
    try:
        body = json.loads(text)
    except ValueError:
        return Ima2ApiError(f"ima2 answered HTTP {status}", status=status)
    if not isinstance(body, dict):
        return Ima2ApiError(f"ima2 answered HTTP {status}", status=status)
    nested = body.get("error") if isinstance(body.get("error"), dict) else {}
    message = nested.get("message") or (body.get("error") if isinstance(body.get("error"), str) else None) or body.get("message")
    code = str(body.get("code") or nested.get("code") or "")
    line = str(message or f"ima2 answered HTTP {status}")
    return Ima2ApiError(f"{code}: {line}" if code else line, code=code, status=status, category=str(body.get("category") or ""))


class Ima2Client:
    def __init__(self, base_url=None, timeout=30):
        self.base_url = base_url or _resolve_server_url("")
        self.timeout = timeout

    def _headers(self, extra=None):
        headers = {"X-ima2-client": IMA2_CLIENT_HEADER}
        # A server opened to the LAN asks for its token even on loopback. It comes from the environment only,
        # so it is never part of a workflow file.
        token = os.environ.get("IMA2_LAN_TOKEN")
        if token:
            headers["x-ima2-token"] = token
        headers.update(extra or {})
        return headers

    def _open(self, method, path, data=None, headers=None, timeout=None):
        request = Request(f"{self.base_url}{path}", data=data, method=method, headers=self._headers(headers))
        try:
            with urlopen(request, timeout=timeout or self.timeout) as response:
                return response.read(MAX_DOWNLOAD_BYTES + 1)
        except HTTPError as exc:
            with exc:
                text = exc.read().decode("utf-8", errors="replace")
            raise _error_from_body(exc.code, text) from exc
        except URLError as exc:
            raise Ima2BridgeError(
                f"ima2 is not running at {self.base_url} ({exc.reason}). Start it with 'ima2 serve', or set IMA2_SERVER."
            ) from exc

    def _json(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        raw = self._open(method, path, data, {"Content-Type": "application/json"} if body is not None else None)
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except ValueError as exc:
            raise Ima2BridgeError("ima2 returned something that is not JSON") from exc

    def catalog(self, kind=None):
        return self._json("GET", "/api/media/catalog" + (f"?{urlencode({'kind': kind})}" if kind else ""))

    def estimate(self, body):
        return self._json("POST", "/api/media/estimate", body)

    def inspect_workflow(self, graph, origin):
        """What ima2 makes of a workflow on the ComfyUI at origin: where the prompt goes, which files it takes, what that server lacks."""
        return self._json("POST", "/api/comfy/inspect", {"graph": graph, "origin": origin})

    def register_workflow(self, body):
        return self._json("POST", "/api/comfy/workflows", body)

    def workflow_origin(self, workflow_id):
        """The ComfyUI server a registered workflow runs on, or None when ima2 does not say."""
        try:
            workflows = self._json("GET", "/api/comfy/workflows").get("workflows")
        except Ima2ApiError:
            return None
        for workflow in workflows if isinstance(workflows, list) else []:
            if isinstance(workflow, dict) and workflow.get("id") == workflow_id:
                return workflow.get("origin")
        return None

    def upload(self, data, mime_type):
        raw = self._open("POST", "/api/media/inputs", bytes(data), {"Content-Type": mime_type}, timeout=max(self.timeout, 120))
        ref = json.loads(raw.decode("utf-8")).get("ref")
        if not isinstance(ref, str) or not ref:
            raise Ima2BridgeError("ima2 did not return a reference for the uploaded input")
        return ref

    def submit(self, body):
        return self._json("POST", "/api/media", body)

    def job(self, request_id):
        """The job as ima2 lists it, or None when it has left the list (finished long ago, or never existed)."""
        try:
            return self._json("GET", f"/api/media/jobs/{quote(request_id, safe='')}").get("job")
        except Ima2ApiError as exc:
            if exc.status == 404:
                return None
            raise

    def cancel(self, request_id):
        return self._json("POST", f"/api/media/{quote(request_id, safe='')}/cancel", {})

    def outputs(self, request_id):
        query = urlencode({"requestId": request_id, "includeAudio": "true"})
        return self._json("GET", f"/api/history?{query}").get("items") or []

    def download(self, filename):
        data = self._open("GET", f"/generated/{quote(filename, safe='')}", timeout=max(self.timeout, 300))
        if len(data) > MAX_DOWNLOAD_BYTES:
            raise Ima2BridgeError("the generated file is larger than this node will load")
        return data
