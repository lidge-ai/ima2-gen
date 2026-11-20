import net from "node:net";
import tls from "node:tls";

process.env.IMA2_RESET_DISPATCH_DISABLED = "1";
let blocked = 0;
const loopback = (host: unknown) => host === undefined || host === "localhost" || host === "::1"
  || (typeof host === "string" && host.startsWith("127."));
const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: Parameters<typeof socketConnect>) {
  const first = args[0] as unknown;
  const options = typeof first === "object" && first !== null ? first as { host?: string; path?: string } : null;
  const host = options ? options.host : typeof args[1] === "string" ? args[1] : undefined;
  if (!options?.path && !loopback(host)) { blocked++; throw new Error("RESET_TEST_NON_LOOPBACK"); }
  return Reflect.apply(socketConnect, this, args);
} as typeof socketConnect;
const tlsConnect = tls.connect;
tls.connect = function (...args: Parameters<typeof tlsConnect>) {
  const first = args[0] as unknown;
  const options = typeof first === "object" && first !== null ? first as { host?: string; path?: string } : null;
  const host = options ? options.host : typeof args[1] === "string" ? args[1] : undefined;
  if (!options?.path && !loopback(host)) { blocked++; throw new Error("RESET_TEST_NON_LOOPBACK"); }
  return Reflect.apply(tlsConnect, tls, args);
} as typeof tlsConnect;
export const sentinelCount = () => blocked;
