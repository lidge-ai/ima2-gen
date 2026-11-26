import { startFakeServer } from "./server.ts";

// FAKE_TIME_SCALE stretches simulated job timing (1 = about one second per media job).
const timeScale = Number(process.env.FAKE_TIME_SCALE ?? 4);
const keyed = process.env.FAKE_KEYED === undefined ? undefined : process.env.FAKE_KEYED.split(",").filter(Boolean);
const server = await startFakeServer({
  port: Number(process.env.PORT ?? 8790),
  timeScale,
  ...(keyed ? { keyed } : {}),
});
console.log(server.url);
