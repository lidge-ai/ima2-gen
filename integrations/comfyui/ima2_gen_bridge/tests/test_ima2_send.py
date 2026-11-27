"""Tests for sending a workflow from ComfyUI to ima2: what is registered by itself, and what is handed back to a person.

A small HTTP server stands in for ima2 on a loopback port. Run from the repository root:
    python3 -B integrations/comfyui/ima2_gen_bridge/tests/test_ima2_send.py
"""
import json
import os
import sys
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
for _name in ("numpy", "torch", "PIL"):
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["PIL"].Image = getattr(sys.modules["PIL"], "Image", object())

from ima2_gen_bridge import ima2_client, ima2_send  # noqa: E402

GRAPH = {"6": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox"}}, "9": {"class_type": "SaveImage", "inputs": {"images": ["6", 0]}}}
ORIGIN = "http://127.0.0.1:8188"
READY = {"origin": ORIGIN, "reachable": True, "missingNodes": [], "missingChoices": [], "paidNodes": []}


def candidate(field, node, input_name, unambiguous=True):
    return {"field": field, "node": node, "input": input_name, "classType": "X", "unambiguous": unambiguous}


class FakeIma2(ThreadingHTTPServer):
    def __init__(self, inspection, taken=False):
        super().__init__(("127.0.0.1", 0), Handler)
        self.inspection, self.taken, self.calls = inspection, taken, []
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server_address[1]}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        fake = self.server
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        fake.calls.append((self.path, self.headers.get("Content-Type"), body))
        if self.path == "/api/comfy/inspect":
            status, answer = 200, dict({"ok": True, "nodes": [], "needsConfirmation": False}, **fake.inspection)
        elif self.path == "/api/comfy/workflows" and fake.taken and not body.get("replace"):
            status, answer = 409, {"ok": False, "error": {"code": "COMFY_WORKFLOW_ID_TAKEN", "message": "Workflow 'fox' already exists."}}
        elif self.path == "/api/comfy/workflows":
            status, answer = 200, {"ok": True, "workflow": {"id": body["id"]}, "server": READY, "media": {"model": "comfy/" + body["id"], "task": "text-to-image"}}
        else:
            status, answer = 404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "nothing here"}}
        data = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class SendTest(unittest.TestCase):
    def serve(self, inspection, **kwargs):
        fake = FakeIma2(inspection, **kwargs)
        self.addCleanup(fake.server_close)
        self.addCleanup(fake.shutdown)
        return fake, ima2_client.Ima2Client(fake.url)

    def test_a_workflow_with_nothing_to_decide_is_registered_on_the_comfyui_it_came_from(self):
        slots = [{"kind": "image", "node": "52", "input": "image", "classType": "LoadImage", "role": "first-frame"}]
        fake, client = self.serve({"candidates": [candidate("prompt", "6", "text"), candidate("seed", "3", "seed"), candidate("output", "9", "")],
                                   "mediaKind": "video", "mediaSlots": slots, "server": READY})
        result = ima2_send.send_workflow(client, GRAPH, "My Fox Clip", ORIGIN, label="Fox clip")
        self.assertEqual(result, {"ok": True, "id": "my-fox-clip", "model": "comfy/my-fox-clip", "task": "text-to-image", "problems": []})
        (inspect_path, inspect_type, inspect_body), (path, content_type, body) = fake.calls
        self.assertEqual((inspect_path, inspect_type, inspect_body), ("/api/comfy/inspect", "application/json", {"graph": GRAPH, "origin": ORIGIN}))
        self.assertEqual((path, content_type), ("/api/comfy/workflows", "application/json"))
        self.assertEqual(body, {
            "graph": GRAPH, "id": "my-fox-clip", "label": "Fox clip", "origin": ORIGIN, "mediaKind": "video",
            "bind": {"prompt": {"node": "6", "input": "text"}, "seed": {"node": "3", "input": "seed"}, "output": {"node": "9"},
                     "inputs": [{"kind": "image", "role": "first-frame", "node": "52", "input": "image"}]},
        })

    def test_a_choice_only_a_person_can_make_is_handed_back_and_nothing_is_registered(self):
        slots = [{"kind": "image", "node": "52", "input": "image", "classType": "LoadImage"}, {"kind": "image", "node": "53", "input": "image", "classType": "LoadImage"}]
        fake, client = self.serve({"candidates": [candidate("prompt", "6", "text", False), candidate("prompt", "7", "text", False), candidate("output", "9", "")],
                                   "mediaSlots": slots, "server": READY})
        result = ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN)
        self.assertEqual(result["ok"], False)
        self.assertEqual(result["code"], "NEEDS_A_PERSON")
        self.assertEqual(result["undecided"], ["prompt: 6.text or 7.text", "file input 52.image (LoadImage)", "file input 53.image (LoadImage)"])
        self.assertIn("ima2 Settings", result["message"])
        self.assertEqual([call[0] for call in fake.calls], ["/api/comfy/inspect"])

    def test_no_prompt_or_no_output_is_said_plainly(self):
        _fake, client = self.serve({"candidates": [candidate("output", "9", "")], "mediaSlots": [], "server": READY})
        result = ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN)
        self.assertEqual((result["ok"], result["code"]), (False, "NO_PROMPT"))
        self.assertIn("text input", result["message"])
        _fake, client = self.serve({"candidates": [candidate("prompt", "6", "text")], "mediaSlots": [], "server": READY})
        self.assertEqual(ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN)["code"], "NO_OUTPUT")

    def test_a_graph_that_uses_ima2_nodes_is_refused_before_ima2_is_asked(self):
        fake, client = self.serve({"candidates": [], "mediaSlots": [], "server": READY})
        graph = dict(GRAPH, **{"20": {"class_type": "Ima2MediaImage", "inputs": {}}})
        result = ima2_send.send_workflow(client, graph, "fox", ORIGIN)
        self.assertEqual((result["ok"], result["code"]), (False, "USES_IMA2_NODES"))
        self.assertIn("call itself", result["message"])
        self.assertEqual(fake.calls, [])

    def test_an_existing_id_is_not_replaced_unless_asked(self):
        inspection = {"candidates": [candidate("prompt", "6", "text"), candidate("output", "9", "")], "mediaSlots": [], "server": READY}
        fake, client = self.serve(inspection, taken=True)
        result = ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN)
        self.assertEqual((result["ok"], result["code"]), (False, "COMFY_WORKFLOW_ID_TAKEN"))
        self.assertEqual(ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN, replace=True)["ok"], True)
        self.assertEqual(fake.calls[-1][2]["replace"], True)

    def test_what_the_server_lacks_comes_back_with_a_registration_that_went_through(self):
        report = dict(READY, missingNodes=[{"classType": "WanAnimate", "nodes": ["12"]}],
                      missingChoices=[{"node": "4", "classType": "UNETLoader", "input": "unet_name", "value": "wan.safetensors", "model": True}], paidNodes=["KlingNode"])
        fake, client = self.serve({"candidates": [candidate("prompt", "6", "text"), candidate("output", "9", "")], "mediaSlots": [], "server": report})
        fake_answer_server = report

        class Reporting(Handler):
            pass
        result = ima2_send.describe_problems(fake_answer_server)
        self.assertEqual(result, ["node type not installed: WanAnimate", "model file not on the server: wan.safetensors", "paid partner nodes (ComfyUI may charge your Comfy account): KlingNode"])
        self.assertEqual(ima2_send.describe_problems({"origin": ORIGIN, "reachable": False, "reason": "refused"}), ["ComfyUI at " + ORIGIN + " did not answer ima2: refused"])
        self.assertEqual(ima2_send.describe_problems(None), [])

    def test_ids_are_made_from_the_name_and_an_empty_one_is_refused(self):
        self.assertEqual(ima2_send.workflow_id("Wan 2.2 — Image to Video!.json"), "wan-2-2-image-to-video")
        self.assertEqual(ima2_send.workflow_id("  "), "")
        _fake, client = self.serve({"candidates": [], "mediaSlots": [], "server": READY})
        self.assertEqual(ima2_send.send_workflow(client, GRAPH, "///", ORIGIN)["code"], "NO_ID")
        self.assertEqual(ima2_send.send_workflow(client, {}, "fox", ORIGIN)["code"], "EMPTY_GRAPH")

    def test_ima2_not_running_says_how_to_start_it(self):
        client = ima2_client.Ima2Client("http://127.0.0.1:9")
        result = ima2_send.send_workflow(client, GRAPH, "fox", ORIGIN)
        self.assertEqual((result["ok"], result["code"]), (False, "IMA2_UNREACHABLE"))
        self.assertIn("ima2 serve", result["message"])


if __name__ == "__main__":
    unittest.main()

