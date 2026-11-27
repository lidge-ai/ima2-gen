# ima2 for ComfyUI

Nodes that let a ComfyUI graph use your own ima2 server: any image, video or
audio model in its catalog, with the keys you saved in ima2, and the result back
in the graph as `IMAGE`, `VIDEO` or `AUDIO`.

Nothing here holds a key. A workflow you save or share contains no key and no
server address, because no node takes either as an input.

## Install

Until the pack is on the Comfy Registry, copy or symlink this folder into your
ComfyUI custom nodes directory and restart ComfyUI:

```bash
ln -s /path/to/ima2-gen/integrations/comfyui/ima2_gen_bridge \
  /path/to/ComfyUI/custom_nodes/comfyui-ima2
```

It needs no extra Python packages: it uses the standard library and what ComfyUI
already ships (torch, numpy, Pillow, PyAV).

## Prerequisite

Start ima2 on the same computer before you queue a graph:

```bash
ima2 serve
```

The nodes find it on their own, in this order: `IMA2_SERVER`, `IMA2_ADVERTISE_FILE`, `IMA2_CONFIG_DIR/server.json`, `~/.ima2/server.json`, `http://127.0.0.1:3333`.
Only loopback HTTP origins are accepted (`127.0.0.1`, `localhost`, `[::1]`); a remote
address, credentials in the URL, a path or HTTPS are refused. If your ima2 asks
for its LAN token, set `IMA2_LAN_TOKEN` in ComfyUI's environment.

## Nodes

Add them from `Add Node -> ima2`.

| Node | Output | Optional inputs |
| --- | --- | --- |
| `ima2 Image` | `IMAGE` | `image` (as source or reference), `mask` |
| `ima2 Video` | `VIDEO` | `first_frame`, `last_frame`, `reference_images`, `source_video`, `source_audio` |
| `ima2 Audio` | `AUDIO` | `source_video` |

Every node also returns the saved `filename` and a `metadata` JSON string with the
model, the route that ran, ima2's estimate, what the provider billed when it says,
and the elapsed time.

Shared inputs:

| Input | Meaning |
| --- | --- |
| `model` | A model id from your ima2 catalog. The list is read when ComfyUI loads node definitions; after adding a key or a workflow in ima2, refresh them (`R`). Models that can run right now come first. |
| `prompt` | The text prompt. |
| `max_usd` | The most this run may cost by ima2's estimate. The node asks ima2 for the estimate first and stops before sending the job when it is higher, or when ima2 cannot price the run. `0` (the default) runs only models that cost nothing, such as your own ComfyUI workflows registered in ima2. `-1` switches the check off. |
| `seed`, `send_seed` | A new seed makes ComfyUI run the node again. It is sent to the model only when `send_seed` is `yes`, because models that take no seed refuse one. |
| `route` | An ima2 route id to pin (`fal`, `replicate`, ...`). Empty lets ima2 choose: the model maker's own API when you have its key, otherwise the cheapest route you have a key for. |
| `task` | Empty picks it from what is connected: a first frame makes it image-to-video, a video with audio lip-sync, and so on. |
| `negative_prompt`, `resolution`, `aspect_ratio`, `duration`, `audio` | Sent when set. ima2 refuses a value the chosen model does not list, and the node shows its reason. |
| `vendor_options` | A JSON object passed through as ima2 `vendorOptions`. |

While a job runs, the node shows ima2's state and the estimate. Stopping the
ComfyUI run cancels the ima2 job.

A `comfy/<workflow>` model is a ComfyUI workflow registered in ima2. When it is
registered on the same ComfyUI that is running the node, the node refuses it:
ComfyUI runs one graph at a time, so the inner run would wait for the outer one.
Open that workflow in ComfyUI directly, or register it in ima2 on a second
ComfyUI server.

### Cost

A job runs on the route ima2 picks and is charged by that provider to the key you
saved in ima2. The estimate comes from the provider's published price list; the
real bill can differ. `max_usd` is a check before the run, not a spending cap on
your account.

## Send a workflow to ima2

`Workflow > Send workflow to ima2` registers the workflow that is open in the
editor as a model in ima2: `comfy/<name>`. ima2 then runs it on this ComfyUI from
its own screens, CLI and tools, with the prompt and files you give it there.

The editor converts the workflow to the API format and ima2 works out where the
prompt goes, which node saves the result and which file inputs it takes. When
that is clear it is registered at once. When something can go more than one way
(two text encoders that could each be the prompt, two image inputs) nothing is
registered and the message lists what is undecided: export the workflow with
`Workflow > Export (API)` and add that file in ima2 Settings, where each one
can be chosen. A workflow that itself uses ima2 nodes is refused, because ima2
would end up calling itself.

Sending registers a workflow; it generates nothing and involves no key.

### Ima2 Generate

The original node is still here under the same id, so saved workflows keep
loading. It is text-to-image only, through ima2's own image lane
(`POST /api/generate`, with `webSearchEnabled`). For any catalog model, use
`ima2 Image`. Its `server_url` input may be left empty.

## Older ComfyUI

The media nodes use ComfyUI's V3 node schema. On a ComfyUI without it, the pack
registers `Ima2 Generate` alone.

## Tests

```bash
python3 -B integrations/comfyui/ima2_gen_bridge/tests/test_ima2_job.py
```
