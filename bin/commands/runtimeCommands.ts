/** Dispatch for the commands that manage the server process itself. */
export const RUNTIME_COMMANDS = ["start", "restart", "stop", "logs", "service"] as const;
export type RuntimeCommand = (typeof RUNTIME_COMMANDS)[number];

export function isRuntimeCommand(command: string | undefined): command is RuntimeCommand {
  return (RUNTIME_COMMANDS as readonly string[]).includes(command ?? "");
}

export async function runRuntimeCommand(command: RuntimeCommand, args: string[]): Promise<void> {
  if (command === "start" || command === "restart") return (await import("./start.js")).start(args, command);
  if (command === "stop") return (await import("./stop.js")).stop(args);
  if (command === "logs") return (await import("./logs.js")).logs(args);
  return (await import("./service.js")).service(args);
}
