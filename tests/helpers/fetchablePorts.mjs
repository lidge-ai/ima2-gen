// Loaded into every test process by scripts/run-tests.mjs (--import). A test server that listens on
// port 0 takes whatever the system hands out, and fetch refuses a fixed list of ports ("bad port":
// 6000, 6665-6669, 10080, ...). Where the dynamic range includes them (a Windows host whose range
// starts at 1024), a test that fetches its own server then fails by chance.
//
// This makes listen(0) ask again when it is given such a port, before anyone hears "listening".
// Nothing else about listen changes: a fixed port, a pipe or a handle is passed straight through.
import net from "node:net";

/** Ports fetch refuses (https://fetch.spec.whatwg.org/#port-blocking). tests/fetchable-test-ports.test.ts checks this against the runtime. */
export const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
  123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
  993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** @param {number} port */
export function isFetchBlocked(port) {
  return FETCH_BLOCKED_PORTS.has(port);
}

const MAX_ASKS = 20;

/** listen(), listen(0, ...), listen("0", ...), listen(callback) and listen({ port: 0 | undefined }) all mean "any port". */
function asksForAnyPort(args) {
  const first = args[0];
  if (args.length === 0 || typeof first === "function" || first === 0 || first === "0" || first === undefined || first === null) return true;
  if (typeof first !== "object") return false;
  if ("path" in first || "fd" in first || "handle" in first || "_handle" in first) return false;
  return first.port === 0 || first.port === "0" || first.port === undefined || first.port === null;
}

/**
 * Replaces net.Server.prototype.listen (http and https servers inherit it). isBlocked is the list
 * above unless a test passes its own. Returns a function that puts the original back.
 * @param {{ isBlocked?: (port: number) => boolean }} [options]
 * @returns {() => void}
 */
export function installFetchablePorts(options = {}) {
  const isBlocked = options.isBlocked ?? isFetchBlocked;
  const original = net.Server.prototype.listen;
  net.Server.prototype.listen = function listen(...args) {
    if (!asksForAnyPort(args)) return original.apply(this, args);
    const server = this;
    const callback = typeof args[args.length - 1] === "function" ? args.pop() : null;
    // Registered once here; the original would add it again on every ask.
    if (callback) server.once("listening", callback);
    const emit = server.emit;
    let asks = 1;
    let moving = false;
    const restore = () => { if (server.emit === intercept) delete server.emit; if (server.emit !== emit) server.emit = emit; };
    function intercept(event, ...rest) {
      // The close of a refused port belongs to this helper, not to the test.
      if (moving && event === "close") return false;
      if (event === "error") restore();
      if (event !== "listening") return emit.call(server, event, ...rest);
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      if (port === null || !isBlocked(port) || asks >= MAX_ASKS) { restore(); return emit.call(server, event, ...rest); }
      asks += 1;
      moving = true;
      const host = address.address;
      net.Server.prototype.close.call(server, () => {
        // The refused port is held while asking again, so the system cannot hand it straight back.
        const holder = net.createServer();
        const again = () => { moving = false; server.once("listening", () => holder.close()); original.apply(server, args); };
        holder.once("error", again);
        original.call(holder, port, host, again);
      });
      return false;
    }
    server.emit = intercept;
    return original.apply(server, args);
  };
  return () => { net.Server.prototype.listen = original; };
}

// Importing the file (as the runner does) installs it; a test that needs its own list imports the functions and installs again on top.
if (!globalThis[Symbol.for("ima2.fetchablePorts")]) {
  globalThis[Symbol.for("ima2.fetchablePorts")] = true;
  installFetchablePorts();
}
