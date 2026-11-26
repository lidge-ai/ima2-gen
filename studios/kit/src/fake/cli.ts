import { startFakeServer } from "./server.ts";
const server = await startFakeServer({
  port: Number(process.env.PORT ?? 8790),
  envKeys: (process.env.FAKE_ENV_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});
console.log(server.url);
