import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { config } from "../config.js";
import { buildViewUrl, cancelComfyJob, generateViaComfy, probeComfyOrigins } from "../lib/comfyImageAdapter.ts";
import { putWorkflow } from "../lib/comfyWorkflowStore.ts";

const ORIGIN = "http://127.0.0.1:8188";

// A 1x1 PNG. detectImageMimeFromB64 reads magic bytes, so this must be real.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_B64, "base64");

const GRAPH = {
  "6": { class_type: "CLIPTextEncode", inputs: { text: "" } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "ima2" } },
};
const BIND = { prompt: { node: "6", input: "text" }, output: { node: "9" } };

const originalConfigDir = config.storage.configDir;
const scratch: string[] = [];

async function withWorkflow<T>(
  fn: (id: string) => Promise<T>,
  over: Record<string, unknown> = {},
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ima2-comfy-adapter-"));
  scratch.push(dir);
  (config.storage as { configDir: string }).configDir = dir;
  await putWorkflow({
    id: "wf", label: "WF", origin: ORIGIN, graph: GRAPH, bind: BIND, params: [], ...over,
  } as never);
  try {
    return await fn("wf");
  } finally {
    (config.storage as { configDir: string }).configDir = originalConfigDir;
  }
}

afterEach(async () => {
  (config.storage as { configDir: string }).configDir = originalConfigDir;
  while (scratch.length > 0) await rm(scratch.pop()!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

function ctx(): any {
  return {
    config: {
      ...config,
      comfy: {
        ...config.comfy,
        pollIntervalMs: 1,
        generationTimeoutMs: 5_000,
        healthTimeoutMs: 50,
      },
    },
  };
}

type Route = (url: string, init?: any) => Response | Promise<Response>;

/** Records outbound calls so assertions can read what was actually sent. */
function stub(routes: Array<[RegExp, Route]>) {
  const calls: Array<{ url: string; init: any }> = [];
  const impl = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, init });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init);
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const HISTORY_DONE = (pid: string) => json({
  [pid]: {
    status: { status_str: "success", completed: true, messages: [] },
    outputs: { "9": { images: [{ filename: "ima2_00001_.png", subfolder: "", type: "output" }] } },
  },
});

describe("comfy adapter submit", () => {
  it("injects the prompt into the bound node and returns the image", async () => {
    await withWorkflow(async (id) => {
      const { impl, calls } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", number: 0, node_errors: {} })],
        [/\/history\//, () => HISTORY_DONE("p1")],
        [/\/view\?/, () => new Response(PNG_BYTES, { status: 200 })],
      ]);
      const result = await generateViaComfy("a red bicycle", ctx(), { model: id, fetchImpl: impl });

      const submit = calls.find((c) => c.url.endsWith("/prompt"))!;
      const body = JSON.parse(submit.init.body);
      assert.equal(body.prompt["6"].inputs.text, "a red bicycle");
      assert.equal(body.client_id, "ima2");

      assert.equal(result.b64, PNG_B64);
      assert.equal(result.mime, "image/png");
      assert.equal(result.effectiveModel, "wf");
      // prompt_id is instance-local, so it is only meaningful with its origin.
      assert.equal(result.promptId, "p1");
      assert.equal(result.origin, ORIGIN);
      assert.equal(result.usage, null);
      assert.equal(result.webSearchCalls, 0);
    });
  });

  it("passes requestId as prompt_id only when it is a canonical UUID", async () => {
    await withWorkflow(async (id) => {
      const uuid = "3f2a1c5e-7b84-4d19-9c60-8a15be237d41";
      const uuidRun = stub([
        [/\/prompt$/, () => json({ prompt_id: uuid, node_errors: {} })],
        [/\/history\//, () => HISTORY_DONE(uuid)],
        [/\/view\?/, () => new Response(PNG_BYTES)],
      ]);
      await generateViaComfy("x", ctx(), { model: id, requestId: uuid, fetchImpl: uuidRun.impl });
      const sent = JSON.parse(uuidRun.calls.find((c) => c.url.endsWith("/prompt"))!.init.body);
      assert.equal(sent.prompt_id, uuid, "a UUID requestId is reused as prompt_id");

      // ima2's ordinary request ids are not UUIDs, and ComfyUI answers 400
      // invalid_prompt_id for anything else — so the field is omitted and the
      // server-generated id is taken instead.
      const plainRun = stub([
        [/\/prompt$/, () => json({ prompt_id: "srv-1", node_errors: {} })],
        [/\/history\//, () => HISTORY_DONE("srv-1")],
        [/\/view\?/, () => new Response(PNG_BYTES)],
      ]);
      const result = await generateViaComfy("x", ctx(), { model: id, requestId: "req_abc123", fetchImpl: plainRun.impl });
      const plain = JSON.parse(plainRun.calls.find((c) => c.url.endsWith("/prompt"))!.init.body);
      assert.equal("prompt_id" in plain, false);
      assert.equal(result.promptId, "srv-1");
    });
  });

  it("treats a 200 carrying node_errors as a rejection", async () => {
    await withWorkflow(async (id) => {
      // ComfyUI reports per-node validation failures inside a 200 body.
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: { "4": { errors: ["missing model"] } } })],
      ]);
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl }),
        (e: any) => e?.code === "COMFY_SUBMIT_REJECTED" && /4/.test(e.message),
      );
    });
  });

  it("reports an unreachable instance as offline, not as a failed generation", async () => {
    await withWorkflow(async (id) => {
      const impl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl }),
        (e: any) => e?.code === "COMFY_OFFLINE" && e.message.includes(ORIGIN),
      );
    });
  });

  it("rejects an unregistered workflow id with 404", async () => {
    await withWorkflow(async () => {
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: "nope", fetchImpl: stub([]).impl }),
        (e: any) => e?.code === "COMFY_WORKFLOW_NOT_FOUND" && e?.status === 404,
      );
    });
  });
});

describe("comfy adapter polling", () => {
  it("fails when the job finished without completing", async () => {
    await withWorkflow(async (id) => {
      // An interrupted run lands in history too, with completed:false — so
      // presence alone would report a canceled generation as a success.
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => json({
          p1: { status: { status_str: "error", completed: false, messages: [["execution_interrupted", {}]] }, outputs: {} },
        })],
      ]);
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl }),
        (e: any) => e?.code === "COMFY_EXECUTION_FAILED" && /error/.test(e.message),
      );
    });
  });

  it("waits while the job is queued and reports its position", async () => {
    await withWorkflow(async (id) => {
      let poll = 0;
      const seen: Array<{ running: boolean; position: number }> = [];
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => (poll >= 3 ? HISTORY_DONE("p1") : json({}))],
        [/\/queue$/, () => {
          poll += 1;
          return poll === 1
            ? json({ queue_running: [[0, "other"]], queue_pending: [[1, "p1"]] })
            : json({ queue_running: [[1, "p1"]], queue_pending: [] });
        }],
        [/\/view\?/, () => new Response(PNG_BYTES)],
      ]);
      const result = await generateViaComfy("x", ctx(), {
        model: id, fetchImpl: impl, onQueue: (info) => seen.push(info),
      });
      assert.equal(result.b64, PNG_B64);
      assert.deepEqual(seen[0], { running: false, position: 1 }, "queued behind one job");
      assert.deepEqual(seen[1], { running: true, position: 0 }, "then running");
    });
  });

  it("gives up when the job is absent from both history and queue", async () => {
    await withWorkflow(async (id) => {
      // /history returns {} until a job finishes, so absence alone cannot tell
      // running from never-queued. Gone from both means it vanished.
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => json({})],
        [/\/queue$/, () => json({ queue_running: [], queue_pending: [] })],
      ]);
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl }),
        (e: any) => e?.code === "COMFY_EXECUTION_FAILED" && /disappeared/.test(e.message),
      );
    });
  });

  it("rejects a non-image body instead of saving it as a png", async () => {
    await withWorkflow(async (id) => {
      const { impl } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => HISTORY_DONE("p1")],
        [/\/view\?/, () => new Response("<html>error</html>", { status: 200 })],
      ]);
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl }),
        (e: any) => e?.code === "COMFY_IMAGE_INVALID",
      );
    });
  });

  it("cancels on abort and fires both cancel endpoints", async () => {
    await withWorkflow(async (id) => {
      const controller = new AbortController();
      const { impl, calls } = stub([
        [/\/prompt$/, () => json({ prompt_id: "p1", node_errors: {} })],
        [/\/history\//, () => { controller.abort(); return json({}); }],
        [/\/queue$/, () => json({ queue_running: [[0, "p1"]], queue_pending: [] })],
        [/\/interrupt$/, () => new Response("", { status: 200 })],
      ]);
      await assert.rejects(
        () => generateViaComfy("x", ctx(), { model: id, fetchImpl: impl, signal: controller.signal }),
        (e: any) => e?.code === "GENERATION_CANCELED" && e?.status === 499,
      );
      const posted = calls.filter((c) => c.init?.method === "POST").map((c) => c.url);
      // Both fire: /queue delete only touches the pending heap (verified live:
      // it returns 200 for a running job and does nothing), /interrupt stops a
      // running one, and firing both avoids racing the job into running between
      // a read and an act.
      assert.ok(posted.some((u) => u.endsWith("/queue")), "pending delete attempted");
      assert.ok(posted.some((u) => u.endsWith("/interrupt")), "running interrupt attempted");
    });
  });
});

describe("comfy /view parameter bounds", () => {
  it("allowlists the folder class and encodes the query", () => {
    const url = buildViewUrl(ORIGIN, { filename: "a b.png", subfolder: "sub", type: "temp" });
    assert.match(url, /filename=a\+b\.png/);
    assert.match(url, /subfolder=sub/);
    assert.match(url, /type=temp/);
    // An unknown folder class falls back rather than reaching the server.
    assert.match(buildViewUrl(ORIGIN, { filename: "a.png", type: "../../etc" }), /type=output/);
  });

  it("refuses traversal in values ComfyUI reported", () => {
    // These come from a /history response; a custom SaveImage node decides them.
    for (const subfolder of ["../secrets", "/etc", "C:\\windows"]) {
      assert.throws(
        () => buildViewUrl(ORIGIN, { filename: "a.png", subfolder }),
        (e: any) => e?.code === "COMFY_IMAGE_INVALID",
        `accepted ${subfolder}`,
      );
    }
    assert.throws(
      () => buildViewUrl(ORIGIN, { filename: "" }),
      (e: any) => e?.code === "COMFY_NO_IMAGE",
    );
    // A path in filename is reduced to its basename rather than rejected.
    assert.match(buildViewUrl(ORIGIN, { filename: "../../a.png" }), /filename=a\.png/);
  });
});

describe("comfy health probing", () => {
  it("probes distinct origins in parallel and isolates a dead one", async () => {
    const live = "http://127.0.0.1:8188";
    const dead = "http://127.0.0.1:8189";
    const impl = (async (input: any, init?: any) => {
      if (String(input).startsWith(live)) {
        return json({ system: { comfyui_version: "0.27.0" } });
      }
      // Stands in for a box that accepts the socket and never answers. The
      // guard timer is a real ref'd timer so the loop cannot drain out from
      // under this promise on runtimes where AbortSignal.timeout is unref'd.
      return new Promise((_resolve, reject) => {
        const guard = setTimeout(() => reject(new Error("timed out")), 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(guard);
          reject(new Error("timed out"));
        }, { once: true });
      });
    }) as unknown as typeof fetch;

    const started = Date.now();
    const health = await probeComfyOrigins([live, dead, live], 50, impl);
    const elapsed = Date.now() - started;

    assert.equal(health.size, 2, "duplicate origins are probed once");
    assert.equal(health.get(live)?.ok, true);
    assert.equal(health.get(live)?.version, "0.27.0");
    assert.equal(health.get(dead)?.ok, false);
    // Sequential probing would cost at least one timeout per dead instance and
    // make a live workflow wait behind a dead box.
    assert.ok(elapsed < 500, `probes ran in parallel (took ${elapsed}ms)`);
  });
});

describe("comfy cancel", () => {
  it("swallows transport failures so teardown cannot throw", async () => {
    const impl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await cancelComfyJob(ORIGIN, "p1", impl);
  });
});
