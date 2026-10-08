import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "../config.ts";
import { createTestRuntimeContext } from "../lib/runtimeContext.ts";
import { mountKeyRoutes } from "../routes/keys.ts";
import { mountApi88ConfigRoutes } from "../routes/api88Config.ts";

export async function withApi88Routes(run: (fixture: {
  ctx: ReturnType<typeof createTestRuntimeContext>; base: string; configFile: string;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "ima2-api88-contract-"));
  const configFile = join(root, "config.json");
  const ctx = createTestRuntimeContext({ config: { ...config,
    storage: { ...config.storage, configFile },
    api88Provider: { ...config.api88Provider, baseUrl: "https://route-gateway.example/v1/", baseUrlSource: "config" } } });
  const app = express(); app.use(express.json());
  mountKeyRoutes(app, ctx); mountApi88ConfigRoutes(app, ctx);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run({ ctx, base, configFile }); }
  finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
