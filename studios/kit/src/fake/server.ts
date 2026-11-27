import { createServer, type Server } from "node:http";
import { EventRing } from "./events.ts";
import { Jobs } from "./jobs.ts";
import { Keys } from "./keys.ts";
import { router } from "./router.ts";
export interface FakeServerOptions {
  port?: number;
  host?: string;
  timeScale?: number;
  keyed?: readonly string[];
  seed?: string | number;
  envKeys?: readonly string[];
  /** Ports to refuse when any port will do; fetch's blocked list unless a test passes its own. */
  isBlockedPort?: (port: number) => boolean;
}

/** Ports fetch refuses ("bad port", https://fetch.spec.whatwg.org/#port-blocking); the root tests keep the same list. */
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
  123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
  993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);
const MAX_ASKS = 20;

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") reject(new Error("No TCP address"));
      else resolve(address.port);
    });
  });
}

const closeServer = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/**
 * Listens where a client's fetch can reach. With any port (0), the system may hand out one fetch refuses
 * (Windows starts its dynamic range at 1024); that one stays held while another is asked for, then is let go.
 */
async function listenFetchable(make: () => Server, port: number, host: string, isBlocked: (port: number) => boolean): Promise<Server> {
  const held: Server[] = [];
  try {
    for (let ask = 0; ask < MAX_ASKS; ask++) {
      const server = make();
      const got = await listen(server, port, host);
      if (port !== 0 || !isBlocked(got)) return server;
      held.push(server);
    }
    throw new Error("No fetchable port after " + MAX_ASKS + " tries");
  } finally {
    await Promise.all(held.map(closeServer));
  }
}

export async function startFakeServer(
  options: FakeServerOptions = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const keys = new Keys(options.keyed ?? ["openai", "fal"], options.envKeys);
  const events = new EventRing((value) => keys.scrub(value)),
    jobs = new Jobs(events, options.timeScale ?? 1, String(options.seed ?? "fake"));
  const make = () =>
    createServer((req, res) => {
      void router(req, res, jobs, keys);
    });
  const isBlocked = options.isBlockedPort ?? ((port: number) => FETCH_BLOCKED_PORTS.has(port));
  const server = await listenFetchable(make, options.port ?? 0, options.host ?? "127.0.0.1", isBlocked);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No TCP address");
  const host = address.address.includes(":") ? `[${address.address}]` : address.address;
  return {
    url: `http://${host}:${address.port}`,
    close: async () => {
      jobs.close();
      events.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
