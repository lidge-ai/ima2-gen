// tests/helpers/fetchablePorts.mjs: listen(0) never settles on a port fetch refuses.
// scripts/run-tests.mjs loads it into every test process, so no test server has to ask for it.
import { strict as assert } from "node:assert";
import http from "node:http";
import net from "node:net";
import { test } from "node:test";
import { FETCH_BLOCKED_PORTS, installFetchablePorts, isFetchBlocked } from "./helpers/fetchablePorts.mjs";

const HOST = "127.0.0.1";

function badPort(error: unknown): boolean {
  const cause = (error as { cause?: { message?: string } } | null)?.cause;
  return /bad port/i.test(String(cause?.message ?? (error as Error)?.message ?? ""));
}

async function fetchRefuses(port: number): Promise<boolean> {
  // A refused port fails before any connection is made; anything else here is a connection error.
  return fetch("http://" + HOST + ":" + String(port) + "/", { signal: AbortSignal.timeout(2_000) }).then(() => false, badPort);
}

test("the list is the one this runtime's fetch refuses", async () => {
  for (const port of FETCH_BLOCKED_PORTS) assert.equal(await fetchRefuses(port), true, "fetch should refuse port " + String(port));
  for (const port of [1024, 5999, 6001, 6664, 6670, 10079, 10081, 49152]) {
    assert.equal(isFetchBlocked(port), false);
    assert.equal(await fetchRefuses(port), false, "fetch should not call port " + String(port) + " a bad port");
  }
  for (const port of [6000, 6665, 6666, 6667, 6668, 6669, 10080]) assert.equal(isFetchBlocked(port), true);
});

test("a server given a refused port asks again before anyone hears it is listening", async () => {
  // The first port the system hands out is treated as refused, whatever it is.
  const refused: number[] = [];
  const uninstall = installFetchablePorts({ isBlocked: (port: number) => { if (refused.length === 0) refused.push(port); return refused.includes(port); } });
  const server = http.createServer((_req, res) => { res.end("ok"); });
  const heard = { listening: 0, callback: 0, close: 0 };
  server.on("listening", () => { heard.listening += 1; });
  server.on("close", () => { heard.close += 1; });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, HOST, () => { heard.callback += 1; resolve(); }); });
    const address = server.address() as net.AddressInfo;
    assert.equal(refused.length, 1, "one port was refused");
    assert.notEqual(address.port, refused[0], "the server is not on the refused port");
    assert.deepEqual(heard, { listening: 1, callback: 1, close: 0 }, "the move is not visible to the test");
    assert.equal(await (await fetch("http://" + HOST + ":" + String(address.port) + "/")).text(), "ok");
    // The refused port was only held during the move.
    await new Promise<void>((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(refused[0], HOST, () => probe.close(() => resolve())); });
  } finally {
    uninstall();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(heard.close, 1, "the test's own close is still heard");
});

test("every way of asking for any port is covered, and a fixed port is left alone", async () => {
  const seen: number[] = [];
  const uninstall = installFetchablePorts({ isBlocked: (port: number) => { seen.push(port); return false; } });
  const open = async (listen: (server: net.Server, done: () => void) => void): Promise<number> => {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.once("listening", resolve); listen(server, () => {}); });
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  };
  try {
    const ports = [
      await open((server) => server.listen(0)),
      await open((server) => server.listen()),
      await open((server, done) => server.listen(done)),
      await open((server, done) => server.listen(0, HOST, done)),
      await open((server) => server.listen({ port: 0, host: HOST })),
      await open((server) => server.listen({ host: HOST })),
    ];
    assert.deepEqual(seen, ports, "each of them was checked once");
    const fixed = await open((server) => server.listen(ports[0], HOST));
    assert.equal(fixed, ports[0]);
    assert.equal(seen.length, ports.length, "a port the test chose is not second-guessed");
  } finally { uninstall(); }
});

test("a listen error still reaches the test", async () => {
  const taken = net.createServer();
  await new Promise<void>((resolve) => taken.listen(0, HOST, resolve));
  const port = (taken.address() as net.AddressInfo).port;
  const second = net.createServer();
  const error = await new Promise<NodeJS.ErrnoException>((resolve) => { second.once("error", resolve); second.listen(port, HOST); });
  assert.equal(error.code, "EADDRINUSE");
  await new Promise((resolve) => taken.close(resolve));
});

test("it gives up moving after a bounded number of asks instead of hanging", async () => {
  let asked = 0;
  const uninstall = installFetchablePorts({ isBlocked: () => { asked += 1; return true; } });
  const server = net.createServer();
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, HOST, resolve); });
    assert.equal(server.listening, true);
    assert.ok(asked >= 2 && asked <= 20, "asked " + String(asked) + " times");
  } finally { uninstall(); await new Promise((resolve) => server.close(resolve)); }
});
