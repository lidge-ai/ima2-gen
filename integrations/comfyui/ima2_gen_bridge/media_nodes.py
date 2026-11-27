"""ima2 media nodes for ComfyUI (V3 schema).

Each node runs one job on the user's own ima2 server, with the keys saved there,
and hands the result to the graph as IMAGE, VIDEO or AUDIO. No node takes a key
or a server address: a workflow file that uses them carries neither.
"""
from __future__ import annotations

import io as pyio
import json
import wave

import numpy as np
import torch
from PIL import Image

from comfy_api.latest import ComfyExtension, InputImpl, io

from .ima2_client import Ima2Client
from .ima2_job import Ima2Interrupted, models_for, pick_task, run_media_job
from .nodes import Ima2BridgeError, Ima2Generate, MODEL_OPTIONS

CATEGORY = "ima2"
NO_MODELS = "(start ima2, then refresh node definitions)"


def _model_options(kind):
    """The catalog as it is right now. ComfyUI asks again whenever node definitions are refreshed."""
    try:
        ids = models_for(Ima2Client(timeout=2).catalog(kind), kind)
    except Exception:
        ids = []
    return ids or [NO_MODELS]


def _common_inputs(kind):
    return [
        io.Combo.Input("model", options=_model_options(kind), tooltip="A model from your ima2 catalog. Refresh node definitions after adding keys or workflows in ima2."),
        io.String.Input("prompt", multiline=True, default=""),
        io.Float.Input("max_usd", default=0.0, min=-1.0, max=1000.0, step=0.01,
                       tooltip="The most this run may cost by ima2's estimate. 0 runs only free (local) models. -1 skips the check."),
        io.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF, control_after_generate=True,
                     tooltip="Sent to models that take a seed; a new value also makes ComfyUI run the node again."),
        io.Combo.Input("send_seed", options=["no", "yes"], default="no", tooltip="Models that do not take a seed refuse one."),
        io.String.Input("route", default="", optional=True, tooltip="An ima2 route id (e.g. fal). Empty lets ima2 choose."),
        io.String.Input("task", default="", optional=True, tooltip="Empty picks the task from the connected inputs."),
        io.String.Input("negative_prompt", multiline=True, default="", optional=True),
        io.String.Input("resolution", default="", optional=True),
        io.String.Input("aspect_ratio", default="", optional=True),
        io.String.Input("vendor_options", multiline=True, default="", optional=True, tooltip="A JSON object passed as ima2 vendorOptions."),
        io.Int.Input("timeout", default=1800, min=30, max=7200, optional=True, tooltip="Seconds to wait before the ima2 job is canceled."),
    ]


def _png_bytes(image):
    array = (image.detach().cpu().numpy().clip(0.0, 1.0) * 255.0).round().astype(np.uint8)
    buffer = pyio.BytesIO()
    Image.fromarray(array).save(buffer, format="PNG")
    return buffer.getvalue()


def _image_inputs(batch, role):
    return [] if batch is None else [(role, _png_bytes(frame), "image/png") for frame in batch]


def _video_input(video, role):
    if video is None:
        return []
    buffer = pyio.BytesIO()
    video.save_to(buffer)
    return [(role, buffer.getvalue(), "video/mp4")]


def _audio_input(audio, role):
    if audio is None:
        return []
    samples = audio["waveform"][0].detach().cpu().clamp(-1.0, 1.0)
    pcm = (samples.transpose(0, 1).numpy() * 32767.0).astype("<i2")
    buffer = pyio.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(pcm.shape[1])
        out.setsampwidth(2)
        out.setframerate(int(audio["sample_rate"]))
        out.writeframes(pcm.tobytes())
    return [(role, buffer.getvalue(), "audio/wav")]


def _to_image(data):
    array = np.asarray(Image.open(pyio.BytesIO(data)).convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None,]


def _to_audio(data):
    import av

    chunks, rate = [], 44100
    with av.open(pyio.BytesIO(data)) as container:
        stream = container.streams.audio[0]
        rate = stream.rate or rate
        resampler = av.AudioResampler(format="fltp", rate=rate)
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                chunks.append(converted.to_ndarray())
    if not chunks:
        raise Ima2BridgeError("ima2 returned audio this node could not decode")
    return {"waveform": torch.from_numpy(np.concatenate(chunks, axis=1)).float()[None,], "sample_rate": int(rate)}


def _interrupted():
    import comfy.model_management

    return comfy.model_management.processing_interrupted()


def _status(node_id):
    from server import PromptServer

    def send(line):
        if node_id is not None and PromptServer.instance is not None:
            PromptServer.instance.send_progress_text(line, node_id)
    return send


def _options(raw):
    if not raw or not raw.strip():
        return None
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise Ima2BridgeError("vendor_options must be a JSON object") from exc
    if not isinstance(parsed, dict):
        raise Ima2BridgeError("vendor_options must be a JSON object")
    return parsed


def _run(kind, node_id, inputs, values, extra=None):
    if values["model"] == NO_MODELS:
        raise Ima2BridgeError("No ima2 model is selected. Start ima2 ('ima2 serve'), refresh node definitions, and choose a model.")
    request = {
        "model": values["model"], "prompt": values["prompt"], "adapter": values.get("route"),
        "task": values.get("task") or pick_task(kind, [role for role, _data, _mime in inputs]),
        "negativePrompt": values.get("negative_prompt"), "resolution": values.get("resolution"),
        "aspectRatio": values.get("aspect_ratio"), "vendorOptions": _options(values.get("vendor_options")),
        "seed": values["seed"] if values.get("send_seed") == "yes" else None,
    }
    request.update(extra or {})
    try:
        result = run_media_job(
            Ima2Client(), request, inputs, max_usd=float(values["max_usd"]), on_status=_status(node_id),
            interrupted=_interrupted, timeout=int(values.get("timeout") or 1800),
        )
    except Ima2Interrupted:
        import comfy.model_management

        raise comfy.model_management.InterruptProcessingException()
    wanted = [out for out in result["outputs"] if out.get("mediaType") == kind] or result["outputs"]
    summary = {key: value for key, value in result.items() if key != "outputs"}
    summary["files"] = [out["filename"] for out in result["outputs"]]
    return wanted, wanted[0]["filename"], json.dumps(summary, ensure_ascii=False, sort_keys=True)


def _schema(node_id, display_name, description, kind, more_inputs, output):
    return io.Schema(
        node_id=node_id, display_name=display_name, category=CATEGORY, description=description,
        inputs=_common_inputs(kind) + more_inputs,
        outputs=[output, io.String.Output(display_name="filename"), io.String.Output(display_name="metadata")],
        hidden=[io.Hidden.unique_id], not_idempotent=True,
    )


class Ima2MediaImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return _schema("Ima2MediaImage", "ima2 Image", "Generates or edits an image with a model from your ima2 catalog.", "image", [
            io.Image.Input("image", optional=True, tooltip="Each image in the batch is sent with the role below."),
            io.Combo.Input("image_role", options=["source-image", "reference-image"], default="source-image", optional=True),
            io.Mask.Input("mask", optional=True),
        ], io.Image.Output(display_name="image"))

    @classmethod
    def validate_inputs(cls, model):
        return True

    @classmethod
    def execute(cls, model, prompt, max_usd, seed, send_seed, image=None, image_role="source-image", mask=None, **more):
        inputs = _image_inputs(image, image_role)
        if mask is not None:
            inputs += _image_inputs(mask.reshape((-1, mask.shape[-2], mask.shape[-1], 1)).expand(-1, -1, -1, 3), "mask")[:1]
        values = dict(more, model=model, prompt=prompt, max_usd=max_usd, seed=seed, send_seed=send_seed)
        outputs, filename, metadata = _run("image", cls.hidden.unique_id, inputs, values)
        images = [_to_image(out["data"]) for out in outputs]
        # A batch needs one size; results of different sizes come back as the first one (all are saved in ima2).
        same_size = all(image.shape == images[0].shape for image in images)
        return io.NodeOutput(torch.cat(images, dim=0) if same_size else images[0], filename, metadata)


class Ima2MediaVideo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return _schema("Ima2MediaVideo", "ima2 Video", "Generates a video with a model from your ima2 catalog.", "video", [
            io.Int.Input("duration", default=0, min=0, max=600, optional=True, tooltip="Seconds. 0 leaves it to the model."),
            io.Combo.Input("audio", options=["model default", "on", "off"], default="model default", optional=True, tooltip="Generated sound, for models that make it."),
            io.Image.Input("first_frame", optional=True),
            io.Image.Input("last_frame", optional=True),
            io.Image.Input("reference_images", optional=True),
            io.Video.Input("source_video", optional=True),
            io.Audio.Input("source_audio", optional=True),
        ], io.Video.Output(display_name="video"))

    @classmethod
    def validate_inputs(cls, model):
        return True

    @classmethod
    def execute(cls, model, prompt, max_usd, seed, send_seed, duration=0, audio="model default", first_frame=None, last_frame=None,
                reference_images=None, source_video=None, source_audio=None, **more):
        inputs = (_image_inputs(first_frame, "first-frame")[:1] + _image_inputs(last_frame, "last-frame")[:1]
                  + _image_inputs(reference_images, "reference-image") + _video_input(source_video, "source-video")
                  + _audio_input(source_audio, "source-audio"))
        values = dict(more, model=model, prompt=prompt, max_usd=max_usd, seed=seed, send_seed=send_seed)
        extra = {"durationSec": duration or None, "audio": {"on": True, "off": False}.get(audio)}
        outputs, filename, metadata = _run("video", cls.hidden.unique_id, inputs, values, extra)
        return io.NodeOutput(InputImpl.VideoFromFile(pyio.BytesIO(outputs[0]["data"])), filename, metadata)


class Ima2MediaAudio(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return _schema("Ima2MediaAudio", "ima2 Audio", "Generates speech, music or sound with a model from your ima2 catalog.", "audio", [
            io.Int.Input("duration", default=0, min=0, max=3600, optional=True, tooltip="Seconds. 0 leaves it to the model."),
            io.Video.Input("source_video", optional=True),
        ], io.Audio.Output(display_name="audio"))

    @classmethod
    def validate_inputs(cls, model):
        return True

    @classmethod
    def execute(cls, model, prompt, max_usd, seed, send_seed, duration=0, source_video=None, **more):
        values = dict(more, model=model, prompt=prompt, max_usd=max_usd, seed=seed, send_seed=send_seed)
        outputs, filename, metadata = _run("audio", cls.hidden.unique_id, _video_input(source_video, "source-video"), values, {"durationSec": duration or None})
        return io.NodeOutput(_to_audio(outputs[0]["data"]), filename, metadata)


class Ima2GenerateV3(io.ComfyNode):
    """The original text-to-image node, under its original id, so saved workflows keep loading."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="Ima2Generate", display_name="Ima2 Generate", category="ima2-gen",
            description="Text to image through ima2's own image lane. For any catalog model, use ima2 Image.",
            inputs=[
                io.String.Input("prompt", multiline=True, default=""),
                io.String.Input("server_url", default=""),
                io.Combo.Input("quality", options=["low", "medium", "high"], default="medium"),
                io.String.Input("size", default="1024x1024"),
                io.Combo.Input("moderation", options=["low", "auto"], default="low"),
                io.Int.Input("timeout", default=180, min=5, max=600),
                io.Combo.Input("model", options=list(MODEL_OPTIONS), optional=True),
                io.Combo.Input("mode", options=["auto", "direct"], default="auto", optional=True),
                io.Boolean.Input("web_search", default=True, optional=True),
            ],
            outputs=[io.Image.Output(display_name="image"), io.String.Output(display_name="filename"), io.String.Output(display_name="metadata")],
            not_idempotent=True,
        )

    @classmethod
    def execute(cls, prompt, server_url="", quality="medium", size="1024x1024", moderation="low", timeout=180, model="", mode="auto", web_search=True):
        return io.NodeOutput(*Ima2Generate().generate(prompt, server_url, quality, size, moderation, timeout, model, mode, web_search))


class Ima2Extension(ComfyExtension):
    async def get_node_list(self):
        return [Ima2MediaImage, Ima2MediaVideo, Ima2MediaAudio, Ima2GenerateV3]


async def comfy_entrypoint():
    return Ima2Extension()
