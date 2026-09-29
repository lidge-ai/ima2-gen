/** Flag parsing shared by the runtime commands (start, stop, restart, status --runtime, logs). */

export class RuntimeArgError extends Error {}

export function flagValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new RuntimeArgError(`${name} needs a value`);
  return v;
}

export function intFlag(args: string[], name: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | undefined {
  const raw = flagValue(args, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new RuntimeArgError(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

export function portFlag(args: string[]): number | undefined {
  return intFlag(args, "--port", { min: 1, max: 65535 });
}

export function wantsHelp(args: string[]): boolean {
  return args.includes("-h") || args.includes("--help");
}

/** In --json mode stdout carries exactly one document; everything human goes to stderr. */
export function humanWriter(json: boolean): (line: string) => void {
  return (line) => (json ? process.stderr : process.stdout).write(`${line}\n`);
}
