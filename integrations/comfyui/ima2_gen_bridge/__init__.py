"""ima2 for ComfyUI.

ComfyUI loads a node pack either through NODE_CLASS_MAPPINGS (the original
schema) or through comfy_entrypoint (the V3 schema), never both. On a ComfyUI
that has the V3 API this pack registers the media nodes and the original
Ima2Generate node through it; on an older one it registers Ima2Generate alone.
"""
try:
    from .media_nodes import comfy_entrypoint  # noqa: F401

    __all__ = ["comfy_entrypoint"]
except ImportError:
    # No comfy_api.latest: a ComfyUI from before the V3 schema.
    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS  # noqa: F401

    __all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
