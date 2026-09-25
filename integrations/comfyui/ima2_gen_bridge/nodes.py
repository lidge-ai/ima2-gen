from __future__ import annotations

import base64
import json
import os
from io import BytesIO
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import numpy as np
import torch
from PIL import Image


DEFAULT_SERVER_URL = "http://127.0.0.1:3333"
IMA2_CLIENT_HEADER = "comfyui/bridge"
ALLOWED_LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
MODEL_OPTIONS = ["", "gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]


class Ima2BridgeError(Exception):
    pass


def _normalize_loopback_url(raw):
    value = str(raw or "").strip()
    if not value:
        raise Ima2BridgeError("ima2 server URL is required")

    parsed = urlparse(value)
    if parsed.scheme != "http":
        raise Ima2BridgeError("ima2 server URL must use http")
    if parsed.username or parsed.password:
        raise Ima2BridgeError("ima2 server URL must not include credentials")
    if parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment:
        raise Ima2BridgeError("ima2 server URL must be an origin only")

    hostname = (parsed.hostname or "").lower()
    if hostname not in ALLOWED_LOOPBACK_HOSTS:
        raise Ima2BridgeError("ima2 server URL must point to a loopback host")

    try:
        port = parsed.port
    except ValueError as exc:
        raise Ima2BridgeError("ima2 server URL port is invalid") from exc
    if port is None:
        raise Ima2BridgeError("ima2 server URL must include a port")

    host = f"[{hostname}]" if hostname == "::1" else hostname
    return f"http://{host}:{port}"


def _read_json_file(path):
    try:
        if not path or not Path(path).is_file():
            return None
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


def _read_advertise_file():
    explicit = os.environ.get("IMA2_ADVERTISE_FILE")
    if explicit:
        data = _read_json_file(explicit)
        if data:
            return data

    config_dir = os.environ.get("IMA2_CONFIG_DIR")
    candidates = []
    if config_dir:
        candidates.append(Path(config_dir) / "server.json")
    candidates.append(Path.home() / ".ima2" / "server.json")

    for path in candidates:
        data = _read_json_file(path)
        if data:
            return data
    return None


def _candidate_server_urls(server_url):
    if str(server_url or "").strip():
        return [server_url]

    candidates = []
    env_url = os.environ.get("IMA2_SERVER")
    if env_url:
        candidates.append(env_url)

    advertised = _read_advertise_file()
    if isinstance(advertised, dict):
        backend = advertised.get("backend")
        if isinstance(backend, dict) and backend.get("url"):
            candidates.append(backend["url"])
        if advertised.get("url"):
            candidates.append(advertised["url"])
        if advertised.get("port"):
            candidates.append(f"http://127.0.0.1:{advertised['port']}")

    candidates.append(DEFAULT_SERVER_URL)
    return candidates


def _resolve_server_url(server_url=""):
    candidates = _candidate_server_urls(server_url)
    if str(server_url or "").strip():
        return _normalize_loopback_url(candidates[0])

    for candidate in candidates:
        try:
            return _normalize_loopback_url(candidate)
        except Ima2BridgeError:
            continue
    raise Ima2BridgeError("No valid local ima2 server URL was found")


def _post_generate(base_url, payload, timeout):
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base_url}/api/generate",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-ima2-client": IMA2_CLIENT_HEADER,
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
    except HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        raise Ima2BridgeError(f"ima2 server returned HTTP {exc.code}: {text}") from exc
    except URLError as exc:
        raise Ima2BridgeError(f"ima2 server is unreachable: {exc.reason}") from exc

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise Ima2BridgeError("ima2 server returned invalid JSON") from exc


def _decode_data_url_to_tensor(data_url):
    if not isinstance(data_url, str) or "," not in data_url:
        raise Ima2BridgeError("ima2 response did not include an image data URL")
    header, encoded = data_url.split(",", 1)
    if not header.startswith("data:image/") or ";base64" not in header:
        raise Ima2BridgeError("ima2 response image must be a base64 image data URL")

    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise Ima2BridgeError("ima2 response image base64 is invalid") from exc

    image = Image.open(BytesIO(raw)).convert("RGB")
    array = np.asarray(image).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None,]


class Ima2Generate:
    CATEGORY = "ima2-gen"
    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("image", "filename", "metadata")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "server_url": ("STRING", {"default": ""}),
                "quality": (["low", "medium", "high"], {"default": "medium"}),
                "size": ("STRING", {"default": "1024x1024"}),
                "moderation": (["low", "auto"], {"default": "low"}),
                "timeout": ("INT", {"default": 180, "min": 5, "max": 600}),
            },
            "optional": {
                "model": (MODEL_OPTIONS,),
                "mode": (["auto", "direct"], {"default": "auto"}),
                "web_search": ("BOOLEAN", {"default": True}),
            },
        }

    def generate(
        self,
        prompt,
        server_url="",
        quality="medium",
        size="1024x1024",
        moderation="low",
        timeout=180,
        model="",
        mode="auto",
        web_search=True,
    ):
        clean_prompt = str(prompt or "").strip()
        if not clean_prompt:
            raise Ima2BridgeError("prompt is required")

        base_url = _resolve_server_url(server_url)
        payload = {
            "prompt": clean_prompt,
            "quality": quality,
            "size": size,
            "n": 1,
            "format": "png",
            "moderation": moderation,
            "mode": mode,
            "webSearchEnabled": bool(web_search),
        }
        if model:
            payload["model"] = model

        response = _post_generate(base_url, payload, int(timeout))
        image_data = response.get("image")
        filename = response.get("filename") or ""
        image = _decode_data_url_to_tensor(image_data)
        metadata = {
            "filename": filename,
            "requestId": response.get("requestId"),
            "elapsed": response.get("elapsed"),
            "serverUrl": base_url,
            "model": response.get("model") or model or None,
            "size": response.get("size") or size,
        }
        return (image, filename, json.dumps(metadata, ensure_ascii=False, sort_keys=True))


NODE_CLASS_MAPPINGS = {
    "Ima2Generate": Ima2Generate,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Ima2Generate": "Ima2 Generate",
}
