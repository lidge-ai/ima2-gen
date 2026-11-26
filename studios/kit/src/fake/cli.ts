import { startFakeServer } from "./server.ts";
const server = await startFakeServer({
  port: Number(process.env.PORT ?? 8790),
  // Multiplies every simulated delay; e2e and audit runs slow jobs down to see in-progress states.
  timeScale: Number(process.env.FAKE_TIME_SCALE ?? 1) || 1,
  envKeys: (process.env.FAKE_ENV_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});
console.log(server.url);
