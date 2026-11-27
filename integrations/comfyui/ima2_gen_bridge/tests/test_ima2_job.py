"""Tests for the parts of the pack that need neither ComfyUI nor torch: the ima2 client and the job runner.

A small HTTP server stands in for ima2 on a loopback port. Run from the repository root:
    python3 -B integrations/comfyui/ima2_gen_bridge/tests/test_ima2_job.py
"""
import json
import os
import sys
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
# The package's legacy node imports numpy, torch and PIL at module load; none is used here.
for _name in ("numpy", "torch", "PIL"):
    sys.modules.setdefault(_name, types.ModuleType(_name))
sys.modules["PIL"].Image = getattr(sys.modules["PIL"], "Image", object())

from ima2_gen_bridge import ima2_client, ima2_job  # noqa: E402
from ima2_gen_bridge.nodes import Ima2BridgeError  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32


class FakeIma2(ThreadingHTTPServer):
    def __init__(self, estimate, polls=("running", "completed"), error_code=None):
        super().__init__(("127.0.0.1", 0), Handler)
        self.estimate, self.polls, self.error_code = estimate, list(polls), error_code
        self.calls, self.headers_seen, self.submitted, self.canceled, self.uploads = [], [], None, [], []
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server_address[1]}"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def _send(self, status, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_GET(self):
        fake = self.server
        fake.calls.append("GET " + self.path.split("?")[0])
        fake.headers_seen.append(dict(self.headers))
        if self.path.startswith("/api/media/catalog"):
            return self._send(200, {"models": [
                {"id": "a/needs-key", "kind": "image", "defaultRoute": None}, {"id": "comfy/klein", "kind": "image", "defaultRoute": "comfy-local"},
                {"id": "b/clip", "kind": "video", "defaultRoute": "fal"}]})
        if self.path.startswith("/api/media/jobs/"):
            status = fake.polls.pop(0) if len(fake.polls) > 1 else fake.polls[0]
            job = {"status": status, "phase": "streaming"}
            if status == "error":
                job.update({"errorCode": fake.error_code, "meta": {"category": "quota"}})
            return self._send(200, {"job": job})
        if self.path.startswith("/api/history"):
            return self._send(200, {"items": [{"filename": "out.png", "mediaType": "image", "mimeType": "image/png", "billed": {"usd": 0.1}}]})
        if self.path == "/generated/out.png":
            return self._send(200, PNG, "image/png")
        return self._send(404, {"ok": False, "code": "NOT_FOUND", "error": "nothing here"})

    def do_POST(self):
        fake = self.server
        fake.calls.append("POST " + self.path)
        raw = self._body()
        if self.path == "/api/media/estimate":
            return self._send(200, fake.estimate)
        if self.path == "/api/media/inputs":
            fake.uploads.append((self.headers.get("Content-Type"), len(raw)))
            return self._send(201, {"ref": f"input:{len(fake.uploads)}.png"})
        if self.path == "/api/media":
            fake.submitted = json.loads(raw)
            if fake.error_code == "MEDIA_KEY_MISSING":
                return self._send(400, {"ok": False, "code": "MEDIA_KEY_MISSING", "error": "No key saved for fal", "category": "auth"})
            return self._send(202, {"requestId": fake.submitted["requestId"], "model": fake.submitted["model"], "adapter": "fal"})
        if self.path.endswith("/cancel"):
            fake.canceled.append(self.path)
            return self._send(200, {"ok": True})
        return self._send(404, {})


class JobTest(unittest.TestCase):
    def serve(self, *args, **kwargs):
        fake = FakeIma2(*args, **kwargs)
        self.addCleanup(fake.server_close)
        self.addCleanup(fake.shutdown)
        return fake, ima2_client.Ima2Client(fake.url)

    def run_job(self, client, **kwargs):
        request = {"model": "b/clip", "task": "image-to-video", "prompt": "a fox", "seed": None, "resolution": ""}
        return ima2_job.run_media_job(client, request, kwargs.pop("inputs", []), sleep=lambda _s: None, **kwargs)

    def test_priced_run_uploads_submits_waits_and_returns_the_bytes(self):
        fake, client = self.serve({"usd": 0.1, "unit": "second", "quantity": 5, "route": "aggregator"})
        lines = []
        result = self.run_job(client, inputs=[("first-frame", PNG, "image/png")], max_usd=0.5, on_status=lines.append)
        self.assertEqual(fake.calls[:3], ["POST /api/media/estimate", "POST /api/media/inputs", "POST /api/media"])
        self.assertEqual(fake.uploads, [("image/png", len(PNG))])
        self.assertEqual(fake.submitted["inputs"], [{"role": "first-frame", "ref": "input:1.png", "mimeType": "image/png"}])
        self.assertTrue(fake.submitted["requestId"].startswith("comfyui_"))
        # Empty settings are left out instead of being sent as empty strings.
        self.assertEqual(sorted(fake.submitted), ["inputs", "model", "prompt", "requestId", "task"])
        self.assertEqual([(o["filename"], o["mediaType"], o["data"]) for o in result["outputs"]], [("out.png", "image", PNG)])
        self.assertEqual(result["billed"], {"usd": 0.1})
        self.assertEqual(result["estimate"]["usd"], 0.1)
        self.assertEqual(lines[0], "ima2: estimated $0.1")
        self.assertTrue(any("streaming" in line for line in lines[1:]))

    def test_an_estimate_over_the_budget_stops_before_anything_is_sent(self):
        fake, client = self.serve({"usd": 0.9})
        with self.assertRaisesRegex(Ima2BridgeError, r"estimate is \$0\.9, above max_usd \$0\.5"):
            self.run_job(client, inputs=[("first-frame", PNG, "image/png")], max_usd=0.5)
        self.assertEqual(fake.calls, ["POST /api/media/estimate"])

    def test_an_unknown_price_is_over_budget_unless_the_check_is_switched_off(self):
        fake, client = self.serve({"usd": None, "note": "no published price for second"})
        with self.assertRaisesRegex(Ima2BridgeError, r"cannot price this run \(no published price for second\)"):
            self.run_job(client, max_usd=100)
        self.assertIsNone(fake.submitted)
        self.run_job(client, max_usd=-1)
        self.assertIsNotNone(fake.submitted)

    def test_a_local_model_runs_with_a_budget_of_zero(self):
        _fake, client = self.serve({"usd": 0, "route": "local", "local": {"expectedSec": 4.2, "basis": "median of 3 runs", "mayBill": False}})
        lines = []
        self.run_job(client, max_usd=0, on_status=lines.append)
        self.assertEqual(lines[0], "ima2: runs locally, about 4.2 s on your machine, no provider charge")

    def test_stopping_the_comfyui_run_cancels_the_ima2_job(self):
        fake, client = self.serve({"usd": 0}, polls=("running",))
        answers = iter([False, False, True])
        with self.assertRaises(ima2_job.Ima2Interrupted):
            self.run_job(client, interrupted=lambda: next(answers))
        self.assertEqual(len(fake.canceled), 1)
        self.assertTrue(fake.canceled[0].startswith("/api/media/comfyui_"))

    def test_a_failed_job_and_a_refused_one_say_why(self):
        _fake, client = self.serve({"usd": 0}, polls=("error",), error_code="FAL_INSUFFICIENT_CREDIT")
        with self.assertRaisesRegex(Ima2BridgeError, r"ima2 job failed: FAL_INSUFFICIENT_CREDIT \(quota\)"):
            self.run_job(client)
        _fake, client = self.serve({"usd": 0}, error_code="MEDIA_KEY_MISSING")
        with self.assertRaisesRegex(ima2_client.Ima2ApiError, "MEDIA_KEY_MISSING: No key saved for fal") as caught:
            self.run_job(client)
        self.assertEqual((caught.exception.code, caught.exception.status, caught.exception.category), ("MEDIA_KEY_MISSING", 400, "auth"))


class ClientTest(unittest.TestCase):
    def test_only_a_loopback_server_is_ever_called_and_the_lan_token_comes_from_the_environment(self):
        fake = FakeIma2({"usd": 0})
        self.addCleanup(fake.server_close)
        self.addCleanup(fake.shutdown)
        saved = {name: os.environ.get(name) for name in ("IMA2_SERVER", "IMA2_LAN_TOKEN")}
        self.addCleanup(lambda: [os.environ.pop(n, None) if v is None else os.environ.__setitem__(n, v) for n, v in saved.items()])
        os.environ["IMA2_SERVER"] = fake.url
        os.environ["IMA2_LAN_TOKEN"] = "lan-token-1"
        client = ima2_client.Ima2Client()
        self.assertEqual(client.base_url, fake.url)
        self.assertEqual(ima2_job.models_for(client.catalog("image"), "image"), ["comfy/klein", "a/needs-key"])
        seen = {key.lower(): value for key, value in fake.headers_seen[-1].items()}
        self.assertEqual((seen["x-ima2-token"], seen["x-ima2-client"]), ("lan-token-1", "comfyui/bridge"))
        # A remote address in the environment is not used; the node falls back to the local default instead.
        os.environ["IMA2_SERVER"] = "https://ima2.example.com"
        self.assertTrue(ima2_client.Ima2Client().base_url.startswith("http://127.0.0.1:"))

    def test_a_server_that_is_not_running_says_how_to_start_it(self):
        with self.assertRaisesRegex(Ima2BridgeError, "ima2 is not running at http://127.0.0.1:9 .*ima2 serve"):
            ima2_client.Ima2Client("http://127.0.0.1:9", timeout=2).catalog()

    def test_the_task_follows_the_connected_inputs(self):
        cases = [("image", [], "text-to-image"), ("image", ["source-image"], "image-to-image"), ("video", [], "text-to-video"),
                 ("video", ["first-frame"], "image-to-video"), ("video", ["reference-image"], "reference-to-video"),
                 ("video", ["source-video"], "video-to-video"), ("video", ["first-frame", "source-audio"], "avatar"),
                 ("video", ["source-video", "source-audio"], "lipsync"), ("audio", [], "text-to-audio"), ("audio", ["source-video"], "video-to-audio")]
        for kind, roles, task in cases:
            self.assertEqual(ima2_job.pick_task(kind, roles), task, (kind, roles))


if __name__ == "__main__":
    unittest.main()
