import { createServer } from "node:http";
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
}
export async function startFakeServer(
  options: FakeServerOptions = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const keys = new Keys(options.keyed ?? ["openai", "fal"]);
  const events = new EventRing((value) => keys.scrub(value)),
    jobs = new Jobs(events, options.timeScale ?? 1, String(options.seed ?? "fake"));
  const server = createServer((req, res) => {
    void router(req, res, jobs, keys);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
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
