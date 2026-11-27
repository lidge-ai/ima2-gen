// Starts the kit fake server and the Vite dev server together for UI work without the real ima2 server.
import { spawn } from "node:child_process";

const fakePort = process.env.FAKE_PORT ?? "8790";
const children = [
  spawn(process.execPath, ["../kit/src/fake/cli.ts"], { stdio: "inherit", env: { ...process.env, PORT: fakePort } }),
  spawn("npx", ["vite"], { stdio: "inherit", env: { ...process.env, IMA2_STUDIO_API: "http://127.0.0.1:" + fakePort } }),
];
const stop = () => { for (const child of children) child.kill("SIGTERM"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) child.on("exit", (code) => { stop(); process.exitCode = code ?? 0; });
