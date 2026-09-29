import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, watchFile } from "node:fs";
import { config } from "../../config.js";
import { serverLogFile } from "../lib/runtime.js";
import { RuntimeArgError, intFlag, wantsHelp } from "../lib/runtimeArgs.js";

const HELP = `
  Usage: ima2 logs [-n <lines>] [-f]

  Shows the log of the background server started by 'ima2 start'.
  The login service writes its own log: 'ima2 service logs'.

    -n <lines>  How many trailing lines to print (default 50)
    -f          Keep printing new lines until Ctrl+C
`;

function follow(file: string, from: number): void {
  let offset = from;
  watchFile(file, { interval: 500 }, (cur) => {
    if (cur.size < offset) offset = 0;
    if (cur.size === offset) return;
    const fd = openSync(file, "r");
    const buf = Buffer.alloc(cur.size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    closeSync(fd);
    offset = cur.size;
    process.stdout.write(buf);
  });
}

export async function logs(args: string[] = []): Promise<void> {
  if (wantsHelp(args)) {
    console.log(HELP);
    return;
  }
  let lines: number;
  try {
    lines = intFlag(args, "-n", { min: 1, max: 100_000 }) ?? 50;
  } catch (error) {
    if (!(error instanceof RuntimeArgError)) throw error;
    console.error(`  ${error.message}`);
    process.exitCode = 64;
    return;
  }
  const file = serverLogFile(config.storage.configDir);
  if (!existsSync(file)) {
    console.log(`\n  No background server log yet at ${file}.\n  'ima2 start' writes it; the login service uses 'ima2 service logs'.\n`);
    return;
  }
  const text = readFileSync(file, "utf-8").split(/\r?\n/);
  if (text[text.length - 1] === "") text.pop();
  console.log(text.slice(-lines).join("\n"));
  if (args.includes("-f")) {
    follow(file, statSync(file).size);
    await new Promise<never>(() => {});
  }
}
