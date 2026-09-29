import { config } from "../../config.js";
import { exitCodeForStop } from "../lib/runtimeReport.js";
import { RuntimeArgError, flagValue, humanWriter, intFlag, wantsHelp } from "../lib/runtimeArgs.js";
import { stopRuntime } from "../lib/stopRuntime.js";

const HELP = `
  Usage: ima2 stop [--json] [--service] [--force]
                   [--expect-pid <pid> (--expect-boot <id> | --expect-started <ms>)]

  Stops the running ima2 server safely: the pid in ~/.ima2/server.json must
  answer /api/health, then a graceful admin stop, then signals (Windows: taskkill).

    --json            Print one ima2-stop/1 document on stdout (human text on stderr)
    --service         The server belongs to the login service: stop the service itself
    --force           Skip the graceful stop and the service refusal
    --expect-pid      Refuse unless exactly this server is running (with --expect-boot
                      or --expect-started, as printed by 'ima2 status --runtime --json')
`;

/**
 * `ima2 stop` — stop the running ima2 server safely. Idempotent: "not running"
 * exits 0. Refusals and failures exit 1. Logic lives in bin/lib/stopRuntime.ts.
 */
export async function stop(args: string[] = []): Promise<void> {
  if (wantsHelp(args)) {
    console.log(HELP);
    return;
  }
  const json = args.includes("--json");
  const say = humanWriter(json);
  let expect: { expectPid?: number; expectBoot?: string; expectStarted?: number };
  try {
    expect = parseExpect(args);
  } catch (error) {
    say(`  ${(error as Error).message}`);
    process.exitCode = 64;
    return;
  }
  const report = await stopRuntime({
    advertiseFile: config.storage.advertiseFile,
    force: args.includes("--force"),
    service: args.includes("--service"),
    ...expect,
  });
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else say(`\n  ${report.message}\n`);
  process.exitCode = exitCodeForStop(report);
}

function parseExpect(args: string[]): { expectPid?: number; expectBoot?: string; expectStarted?: number } {
  const expectPid = intFlag(args, "--expect-pid", { min: 1 });
  const expectBoot = flagValue(args, "--expect-boot");
  const expectStarted = intFlag(args, "--expect-started", { min: 1 });
  if ((expectBoot !== undefined || expectStarted !== undefined) && expectPid === undefined) {
    throw new RuntimeArgError("--expect-boot / --expect-started need --expect-pid");
  }
  return {
    ...(expectPid !== undefined ? { expectPid } : {}),
    ...(expectBoot !== undefined ? { expectBoot } : {}),
    ...(expectStarted !== undefined ? { expectStarted } : {}),
  };
}
