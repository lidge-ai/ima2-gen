import assert from "node:assert/strict";
import { before, after, describe, test, mock } from "node:test";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import express from "express";
import childProcess from "node:child_process";
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { executionChildEnv, executionTestProcess } from "./_executionTestProcess.ts";
import { openRouteHarness, responsesSse, type RouteHarness } from "./_executionRouteHarness.ts";
import { observeBeforeWrite, PromiseTracker, SettlementTimeout } from "./_executionTrackedWrites.ts";
import { isolateExecution } from "./_executionRouteIsolation.ts";
import { installGrokImageTransportFixture, listenOwnedLoopback } from "./_grokImageTransportFixture.ts";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

if (executionTestProcess(import.meta.url)) {
    const hosts = { "fixture.invalid": [{ address: "8.8.8.8", family: 4 as const }] };
    const url = "https://fixture.invalid/image";
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      const addresses = hosts["fixture.invalid"].filter((entry) => !options.family || entry.family === options.family);
      if (!addresses.length) { callback(new Error("no matching family"), "", 0); return; }
      // Node invokes this same callback with an array when all=true.
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    };
  describe("image transport fixture safety (no production imports)", () => {
    const requestBody = (options: http.RequestOptions = {}) => new Promise<Buffer>((resolve, reject) => {
      const request = https.request(url, { lookup: pinnedLookup, ...options }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("end", () => resolve(Buffer.concat(chunks)));
        response.once("error", reject);
      });
      request.once("error", reject); request.end();
    });

    test("inactive DNS and both request protocols deny before DUT import and restore exact descriptors", async () => {
      const entries = [[dnsPromises, "lookup"], [dns, "lookup"], [http, "request"], [https, "request"], [http, "get"], [https, "get"]] as const;
      const saved = entries.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
      const fixture = installGrokImageTransportFixture();
      try {
        for (const family of [0, 4, 6]) for (const all of [false, true]) {
          const result = await new Promise<{ error: Error | null; address: unknown; family: unknown }>((resolve) => {
            listenOwnedLoopback(() => dns.lookup("127.0.0.1", { family, all }, (error, address, resolvedFamily) => resolve({ error, address, family: resolvedFamily })));
          });
          if (family === 6) assert.ok(result.error);
          else {
            assert.equal(result.error, null);
            assert.deepEqual(result.address, all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1");
            if (!all) assert.equal(result.family, 4);
          }
        }
        assert.equal(fixture.resolutions.length, 0, "numeric bind is not artifact DNS");
        const imported = await import("node:https");
        assert.equal(imported.request, https.request, "named ESM binding must be trapped before DUT import");
        await assert.rejects(dnsPromises.lookup("fixture.invalid"), /outside active fixture/);
        assert.throws(() => dns.lookup("fixture.invalid", () => {}), /Default DNS lookup forbidden/);
        assert.throws(() => http.request("http://fixture.invalid/a"), /outside active fixture/);
        assert.throws(() => imported.request(url), /outside active fixture/);
        assert.equal(fixture.calls.length, 0); assert.equal(fixture.violations.length, 4);
        assert.throws(() => fixture.activate({ hosts, respond: () => new Response("never") }), /Pre-activation network violations/);
      } finally { await fixture.restore(); }
      assert.deepEqual(entries.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key)), saved);
    });

    test("unknown hosts and inherited map keys fail closed with zero GET", async () => {
      const fixture = installGrokImageTransportFixture();
      fixture.activate({ hosts, respond: () => assert.fail("unmatched host reached upstream") });
      try {
        for (const hostname of ["unknown.invalid", "toString"]) {
          await assert.rejects(dnsPromises.lookup(hostname), /Unmatched image fixture host/);
          assert.throws(() => https.request(`https://${hostname}/image`), /Unmatched image fixture host/);
        }
        assert.equal(fixture.calls.length, 0);
      } finally { await fixture.restore(); }
    });

    test("actual custom lookup covers family/all and GET preserves the response stream", async () => {
      const fixture = installGrokImageTransportFixture();
      const optionsSeen: unknown[] = [];
      fixture.activate({ hosts, respond: (call) => {
        assert.equal(call.method, "GET"); assert.equal(call.body, "");
        const response = new Response("image bytes");
        response.arrayBuffer = async () => assert.fail("must not prebuffer Response");
        return response;
      } });
      try {
        assert.deepEqual(await dnsPromises.lookup("fixture.invalid", { all: true }), hosts["fixture.invalid"]);
        const lookup: LookupFunction = (host, options, callback) => { optionsSeen.push(options); pinnedLookup(host, options, callback); };
        assert.equal((await requestBody({ lookup })).toString(), "image bytes");
        await fixture.drain();
        assert.deepEqual(optionsSeen, [0, 4, 6].flatMap((family) => [{ family, all: false }, { family, all: true }]));
        assert.equal(fixture.calls.length, 1); assert.equal(fixture.resolutions.length, 1);
        assert.deepEqual(fixture.violations, []);
      } finally { await fixture.restore(); }
    });

    test("missing or wrong custom lookup rejects before upstream without fallback", async () => {
      for (const lookup of [undefined, ((_host, _options, callback) => callback(null, "127.0.0.1", 4)) as LookupFunction]) {
        const fixture = installGrokImageTransportFixture();
        fixture.activate({ hosts, respond: () => assert.fail("bad lookup reached upstream") });
        try {
          await assert.rejects(requestBody({ lookup }), /custom lookup|Expected values/);
          await fixture.drain(); assert.equal(fixture.calls.length, 0); assert.ok(fixture.violations.length);
        } finally { await fixture.restore(); }
      }
    });

    test("headers and first chunk arrive before held body release; deactivate waits for pump", async () => {
      const fixture = installGrokImageTransportFixture();
      const entered = deferred(); const release = deferred();
      let count = 0; let first = "";
      fixture.activate({ hosts, respond: () => new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
        try {
          if (++count === 1) controller.enqueue(Buffer.from("first"));
          else { entered.resolve(); await release.promise; controller.enqueue(Buffer.from("last")); controller.close(); }
        } catch (error) { controller.error(error); }
      } })) });
      const received = new Promise<void>((resolve, reject) => {
        const req = https.request(url, { lookup: pinnedLookup }, (response) => {
          response.once("data", (chunk) => { first = String(chunk); });
          response.once("end", resolve); response.once("error", reject); response.resume();
        }); req.once("error", reject); req.end();
      });
      try {
        await entered.promise;
        await assert.rejects(fixture.drain(20), SettlementTimeout);
        assert.equal(first, "first");
        let deactivated = false;
        const closing = fixture.deactivate().then(() => { deactivated = true; });
        assert.equal(deactivated, false); release.resolve(); await received; await closing;
        assert.deepEqual(fixture.violations, []);
      } finally { release.resolve(); await received; await fixture.restore(); }
    });

    test("abort drains a late response and rejects unrelated post-abort callback exceptions", async () => {
      for (const unexpected of [false, true]) {
        const fixture = installGrokImageTransportFixture();
        const entered = deferred(); const release = deferred(); const abort = new AbortController();
        const failure = new Error("unexpected post-abort upstream failure"); let canceled = false;
        fixture.activate({ hosts, respond: async () => {
          entered.resolve(); await release.promise;
          if (unexpected) throw failure;
          return new Response(new ReadableStream({ cancel() { canceled = true; } }));
        } });
        const received = requestBody({ signal: abort.signal });
        const rejected = assert.rejects(received, (error) => error === abort.signal.reason);
        try {
          await entered.promise; abort.abort(new Error("expected fixture abort")); await rejected;
          await assert.rejects(fixture.drain(20), SettlementTimeout);
          release.resolve(); await fixture.deactivate();
          assert.equal(canceled, !unexpected);
          assert.deepEqual(fixture.violations, unexpected ? [failure] : []);
        } finally { release.resolve(); await rejected; await fixture.restore(); }
      }
    });

    test("post-abort Node error events remain visible after request close", async () => {
      const fixture = installGrokImageTransportFixture();
      const abort = new AbortController(); const headers = deferred(); const canceled = deferred();
      const late = new Error("late Node event after abort");
      fixture.activate({ hosts, respond: () => new Response(new ReadableStream({ cancel() { canceled.resolve(); } })) });
      const request = https.request(url, { lookup: pinnedLookup, signal: abort.signal }, () => headers.resolve());
      request.end();
      try {
        await headers.promise; abort.abort(new Error("expected abort")); await canceled.promise;
        await fixture.drain(); assert.equal(request.destroyed, true);
        request.emit("error", late); await fixture.drain();
        assert.deepEqual(fixture.violations, [late]);
      } finally { request.destroy(); await fixture.restore(); }
    });

    test("failed body pump settles, preserves its violation, and permits deactivation", async () => {
      const fixture = installGrokImageTransportFixture();
      const failure = new Error("controlled body pump failure");
      fixture.activate({ hosts, respond: () => new Response(new ReadableStream({
        start(controller) { controller.error(failure); },
      })) });
      try {
        await assert.rejects(requestBody(), (error) => error === failure);
        await fixture.deactivate();
        assert.deepEqual(fixture.violations, [failure]);
        fixture.activate({ hosts, respond: () => new Response("next case") });
        assert.equal((await requestBody()).toString(), "next case");
      } finally { await fixture.restore(); }
    });

    test("failed isolation setup rolls back descriptors and environment without a DUT import", async () => {
      const savedFetch = globalThis.fetch; const savedConfig = process.env.IMA2_CONFIG_DIR;
      const savedRequest = Object.getOwnPropertyDescriptor(https, "request");
      const savedSpawn = Object.getOwnPropertyDescriptor(childProcess, "spawn");
      const methodDescriptor = Object.getOwnPropertyDescriptor(Object, "getOwnPropertyDescriptor")!;
      const original = Object.getOwnPropertyDescriptor; let root = "", hits = 0;
      let unexpected: Awaited<ReturnType<typeof isolateExecution>> | undefined;
      Object.defineProperty(Object, "getOwnPropertyDescriptor", { ...methodDescriptor,
        value: (target: object, name: PropertyKey) => {
          if (target === childProcess && name === "spawnSync" && hits++ === 0) {
            root = process.env.IMA2_CONFIG_DIR!; throw new Error("controlled isolation setup failure");
          }
          return original(target, name);
        } });
      try { await assert.rejects(async () => { unexpected = await isolateExecution(); }, /controlled isolation setup failure/); }
      finally {
        Object.defineProperty(Object, "getOwnPropertyDescriptor", methodDescriptor);
        await unexpected?.close();
      }
      assert.equal(hits, 1);
      assert.equal(globalThis.fetch, savedFetch); assert.equal(process.env.IMA2_CONFIG_DIR, savedConfig);
      assert.deepEqual(Object.getOwnPropertyDescriptor(https, "request"), savedRequest);
      assert.deepEqual(Object.getOwnPropertyDescriptor(childProcess, "spawn"), savedSpawn);
      await assert.rejects(access(root), { code: "ENOENT" });
    });
  });
  describe("route harness integration", () => {
  let harness: RouteHarness;
  let image: string;
  const payload = { provider: "api", prompt: "execution harness", async: true, n: 1, webSearchEnabled: false };
  before(async () => {
    const spawnBefore = childProcess.spawn;
    const beforeIsolation = globalThis.fetch;
    const owned = await isolateExecution();
    assert.throws(() => childProcess.spawn("must-never-launch"), /Provider process launch forbidden/);
    await assert.rejects(owned.close(), /Isolation violations/);
    assert.equal(childProcess.spawn, spawnBefore);
    assert.equal(globalThis.fetch, beforeIsolation);
    await assert.rejects(access(owned.rootDir), { code: "ENOENT" });
    const moduleDescriptor = Object.getOwnPropertyDescriptor(mock, "module");
    const original = mock.module.bind(mock);
    const builtinDescriptors = [dnsPromises, dns, http, https].map((target, index) =>
      Object.getOwnPropertyDescriptor(target, index < 2 ? "lookup" : "request"));
    const savedFetch = globalThis.fetch;
    const savedConfig = process.env.IMA2_CONFIG_DIR;
    let failedRoot = "";
    let count = 0;
    const moduleMock = mock.method(mock, "module", (...args: Parameters<typeof mock.module>) => {
      failedRoot = process.env.IMA2_CONFIG_DIR!;
      if (++count === 2) throw new Error("fixture mock installation failed");
      return original(...args);
    });
    try { await assert.rejects(openRouteHarness(), /fixture mock installation failed/); }
    finally {
      moduleMock.mock.restore();
      if (moduleDescriptor) Object.defineProperty(mock, "module", moduleDescriptor);
      else Reflect.deleteProperty(mock, "module");
    }
    assert.deepEqual(Object.getOwnPropertyDescriptor(mock, "module"), moduleDescriptor);
    assert.deepEqual([dnsPromises, dns, http, https].map((target, index) =>
      Object.getOwnPropertyDescriptor(target, index < 2 ? "lookup" : "request")), builtinDescriptors);
    assert.equal(globalThis.fetch, savedFetch);
    assert.equal(process.env.IMA2_CONFIG_DIR, savedConfig);
    await assert.rejects(access(failedRoot), { code: "ENOENT" });
    harness = await openRouteHarness();
    image = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#345678" } }).png().toBuffer()).toString("base64");
  });
  after(async () => { observeBeforeWrite(); await harness?.close(); });
  test("caught request-normalization errors fail the active route fixture ledger", async () => {
    await assert.rejects(harness.run("classic", {
      upstream: () => assert.fail("Malformed request must not reach synthetic upstream"),
    }, async (fixture) => {
      await assert.rejects(fetch("https://fixture.invalid", { method: "CONNECT" }));
      assert.equal(fixture.calls.length, 0);
    }), /Unmatched upstream calls/);
  });
  const upstream = (call: { url: string }) => {
    assert.equal(call.url, "https://api.openai.com/v1/responses");
    return responsesSse([
      { type: "response.output_item.done", item: { type: "image_generation_call", result: image } },
      { type: "response.completed", response: { usage: { total_tokens: 7 } } },
    ]);
  };

  test("child environment excludes credentials and ambient loader options", () => {
    const env = executionChildEnv();
    for (const name of ["HOME", "IMA2_CONFIG_DIR", "OPENAI_API_KEY", "XAI_API_KEY", "IMA2_88API_IMAGE_KEY", "IMA2_88API_VIDEO_KEY", "IMA2_88API_BASE_URL", "NODE_OPTIONS", "EXECUTION_TEST_FILE"]) {
      assert.equal(env[name], undefined);
    }
  });

  test("route setup failure restores its fetch and removes its case directory", async () => {
    const beforeFetch = globalThis.fetch;
    const listen = mock.method(express.application, "listen", () => { throw new Error("fixture listen failed"); });
    try {
      await assert.rejects(harness.run("classic", { upstream }, async () => assert.fail("setup did not fail")), /fixture listen failed/);
    } finally { listen.mock.restore(); }
    assert.equal(globalThis.fetch, beforeFetch);
    await assert.rejects(access(join(process.env.IMA2_CONFIG_DIR!, "execution-1")), { code: "ENOENT" });
  });

  test("202 is not handler settlement; canceled held fetch honors the actual AbortSignal", async () => {
    const entered = deferred();
    await harness.run("classic", { upstream: (call) => {
      entered.resolve();
      return new Promise<Response>((_resolve, reject) => {
        assert.ok(call.signal);
        call.signal.addEventListener("abort", () => reject(call.signal!.reason), { once: true });
      });
    } }, async (fixture) => {
      const response = await fixture.post(payload);
      assert.equal(response.status, 202);
      await entered.promise;
      await assert.rejects(fixture.waitSettled(20), SettlementTimeout);
      fixture.cancel();
      await fixture.waitSettled();
      assert.equal(fixture.calls[0].signal?.aborted, true);
      assert.equal((await fixture.waitTerminal()).event, "error");
      assert.equal(fixture.events.some((entry) => entry.event === "done"), false);
    });
  });

  test("direct work retains original promise identity and expected rejection", async () => {
    await harness.run("classic", { upstream }, async (fixture) => {
      const sentinel = new Error("expected direct-operation refusal");
      const work = Promise.reject(sentinel);
      assert.equal(fixture.trackWork(work), work);
      await assert.rejects(work, (error) => error === sentinel);
      await fixture.waitSettled();
      assert.equal(fixture.calls.length, 0);
    });
  });

  test("pinned GET shares upstream totals but has separate transport and DNS records", async () => {
    await harness.run("classic", { upstream: (call) => {
      assert.equal(call.url, "https://fixture.invalid/image");
      assert.equal(call.method, "GET"); assert.equal(call.body, "");
      return new Response("fixture");
    } }, async (fixture) => {
      await fetch("https://fixture.invalid/image");
      await dnsPromises.lookup("fixture.invalid", { all: true });
      const bytes = new Promise<void>((resolve, reject) => {
        const req = https.request("https://fixture.invalid/image", { lookup: pinnedLookup }, (response) => {
          response.once("end", resolve); response.once("error", reject); response.resume();
        }); req.once("error", reject); req.end();
      });
      await fixture.trackWork(bytes); await fixture.waitSettled();
      assert.equal(fixture.calls.length, 2); assert.equal(fixture.imageTransportCalls.length, 1);
      assert.equal(fixture.imageResolutions.length, 1);
    });
  });

  test("pending direct work delays fixture settlement until released", async () => {
    const held = deferred();
    await harness.run("classic", { upstream }, async (fixture) => {
      const work = fixture.trackWork(held.promise);
      try {
        await assert.rejects(fixture.waitSettled(20), SettlementTimeout);
        await access(fixture.generatedDir);
      } finally { held.resolve(); await Promise.allSettled([work]); }
      await fixture.waitSettled();
    });
  });

  test("failed image pump reports its violation after removing settled case storage", async () => {
    const failure = new Error("route fixture body pump failure"); let generatedDir = "";
    await assert.rejects(harness.run("classic", { upstream: () => new Response(new ReadableStream({
      start(controller) { controller.error(failure); },
    })) }, async (fixture) => {
      generatedDir = fixture.generatedDir;
      const work = new Promise<void>((resolve, reject) => {
        const req = https.request("https://fixture.invalid/image", { lookup: pinnedLookup }, (response) => {
          response.once("error", reject); response.once("end", resolve); response.resume();
        }); req.once("error", reject); req.end();
      });
      await assert.rejects(fixture.trackWork(work), (error) => error === failure);
    }), (error: assert.AssertionError) => {
      assert.match(error.message, /Unmatched pinned image transport calls/);
      assert.deepEqual(error.actual, [failure]); return true;
    });
    await assert.rejects(access(generatedDir), { code: "ENOENT" });
    await harness.run("classic", { upstream }, async () => {}); // Prove clean reuse after the asserted failure.
  });

  test("test-body failure releases held direct work before fixture cleanup", async () => {
    const held = deferred();
    const sentinel = new Error("test-body failure fixture");
    let generatedDir = "";
    await assert.rejects(harness.run("classic", { upstream }, async (fixture) => {
      generatedDir = fixture.generatedDir;
      const work = fixture.trackWork(held.promise);
      try { throw sentinel; }
      finally { held.resolve(); await Promise.allSettled([work]); }
    }), (error) => error === sentinel);
    await assert.rejects(access(generatedDir), { code: "ENOENT" });
  });

  test("actual handler cancellation cannot hide an unmatched upstream exception", async () => {
    const sentinel = new Error("UNMATCHED_ENDPOINT_SENTINEL");
    let cancel!: () => void;
    await assert.rejects(harness.run("classic", { upstream: (call) => {
      cancel();
      assert.equal(call.signal?.aborted, true);
      assert.notEqual(sentinel, call.signal?.reason);
      throw sentinel;
    } }, async (fixture) => {
      cancel = fixture.cancel;
      assert.equal((await fixture.post(payload)).status, 202);
      assert.equal((await fixture.waitTerminal()).data.code, "GENERATION_CANCELED");
      await fixture.waitSettled();
      assert.ok(fixture.calls.length > 0, "the real handler invoked the concrete transport");
    }), (error: assert.AssertionError) => {
      assert.match(error.message, /Unmatched upstream calls/);
      assert.ok(Array.isArray(error.actual) && error.actual.includes(sentinel));
      return true;
    });
  });

  for (const kind of ["request-log", "thumbnail"] as const) {
    test(`cleanup drains the held real ${kind} writer before scratch removal`, async () => {
      const entered = deferred<readonly unknown[]>();
      const bodyReturned = deferred();
      const release = deferred();
      let nextWriterArgs: readonly unknown[] | undefined;
      let written: Buffer | undefined;
      let observationError: unknown;
      const originalTrack = PromiseTracker.prototype.track;
      const tracked = mock.method(PromiseTracker.prototype, "track", function<T>(this: PromiseTracker, work: Promise<T>): Promise<T> {
        const args = nextWriterArgs;
        nextWriterArgs = undefined;
        if (args) void work.then(() => {
          try {
            const path = kind === "request-log" ? String(args[0]) : String(args[1]).replace(/\.(png|jpe?g|webp)$/i, ".thumb.jpg");
            // Read before the tracker releases drain; this observes the real completed writer.
            written = readFileSync(path);
          } catch (error) { observationError = error; }
        }, () => undefined);
        return originalTrack.call(this, work) as Promise<T>;
      });
      observeBeforeWrite(async (name, args) => {
        if (name === kind) { nextWriterArgs = args; entered.resolve(args); await release.promise; }
      });
      let generatedDir = "";
      let requestId = "";
      try {
        const run = harness.run("classic", { upstream }, async (fixture) => {
          generatedDir = fixture.generatedDir; requestId = fixture.requestId;
          assert.equal((await fixture.post(payload)).status, 202);
          assert.equal((await fixture.waitTerminal()).event, "done");
          bodyReturned.resolve();
        });
        let complete = false;
        void run.then(() => { complete = true; }, () => undefined);
        await entered.promise; await bodyReturned.promise;
        await access(generatedDir);
        assert.equal(complete, false, "run cleanup cannot remove an active writer's root");
        release.resolve();
        await run;
        assert.equal(observationError, undefined);
        assert.ok(written && written.length > 0, "real file observed before cleanup removal");
        if (kind === "request-log") assert.equal(JSON.parse(written.toString())[0].requestId, requestId);
        else assert.equal((await sharp(written).metadata()).format, "jpeg");
        await assert.rejects(access(generatedDir), { code: "ENOENT" });
      } finally { release.resolve(); observeBeforeWrite(); tracked.mock.restore(); }
    });
  }

  test("tracker returns the exact promise and retains rejection diagnostics", async () => {
    const tracker = new PromiseTracker();
    const failure = new Error("owned writer failure");
    const promise = Promise.reject(failure);
    assert.equal(tracker.track(promise), promise);
    await assert.rejects(promise, (error) => error === failure);
    await assert.rejects(tracker.drain(), (error: AggregateError) => error.errors[0] === failure);
  });

  test("real detached writer rejection fails cleanup even when production catches it", async () => {
    const failure = new Error("held request-log rejection");
    observeBeforeWrite(async (kind) => { if (kind === "request-log") throw failure; });
    try {
      await assert.rejects(harness.run("classic", { upstream }, async (fixture) => {
        assert.equal((await fixture.post(payload)).status, 202);
        await fixture.waitTerminal();
      }), (error: AggregateError) => error.errors.includes(failure));
    } finally { observeBeforeWrite(); }
  });

  test("unmatched global loopback fetch is recorded even if application catches it", async () => {
    await assert.rejects(harness.run("classic", { upstream: () => { throw new Error("unmatched endpoint"); } }, async () => {
      await assert.rejects(fetch(new Request("http://127.0.0.1:3333/forbidden", { method: "POST", body: "fixture" })), /unmatched endpoint/);
    }), /Unmatched upstream calls/);
  });

  test("cleanup timeout retains traps and storage until the held writer settles", async () => {
    const release = deferred();
    let generatedDir = "";
    let rootDir = "";
    observeBeforeWrite(async (kind) => { if (kind === "thumbnail") await release.promise; });
    try {
      await assert.rejects(harness.run("classic", { upstream }, async (fixture) => {
        generatedDir = fixture.generatedDir; rootDir = fixture.ctx.rootDir;
        await fixture.post(payload);
        await fixture.waitTerminal();
      }), SettlementTimeout);
      await access(generatedDir);
      await access(join(rootDir, "config.json"));
      assert.equal(process.env.IMA2_CONFIG_DIR, rootDir, "environment must not be restored with an active writer");
      release.resolve();
      await harness.close();
      await assert.rejects(access(rootDir), { code: "ENOENT" });
    } finally { release.resolve(); observeBeforeWrite(); }
  });
  });
}
