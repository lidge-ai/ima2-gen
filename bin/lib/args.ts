// Tiny argv parser — no dependencies.
// Supports: --long, --long=val, --long val, -s, -s val, repeatable flags, positional, --.

export type FlagValue = string | string[] | boolean | undefined;

export interface FlagDef {
  type?: string;
  short?: string;
  default?: string | boolean;
  repeatable?: boolean;
}

export interface ParseSpec {
  flags?: Record<string, FlagDef>;
}

export interface ParsedArgs {
  positional: string[];
  _unknown: string[];
  _present: string[];
  [key: string]: FlagValue;
}

function pushRepeatable(out: ParsedArgs, name: string, val: string | undefined): void {
  const list = out[name];
  if (Array.isArray(list)) list.push(val as string);
}

export function parseArgs(argv: string[], spec: ParseSpec = {}): ParsedArgs {
  const flags = spec.flags || {};
  const shortMap: Record<string, string> = {};
  for (const [name, def] of Object.entries(flags)) {
    if (def.short) shortMap[def.short] = name;
  }

  const out: ParsedArgs = { positional: [], _unknown: [], _present: [] };
  for (const [name, def] of Object.entries(flags)) {
    if (def.repeatable) out[name] = [];
    else if ("default" in def) out[name] = def.default;
  }

  let i = 0;
  let doubleDashSeen = false;
  while (i < argv.length) {
    const a = argv[i];
    if (a === undefined) break;
    if (doubleDashSeen) {
      out.positional.push(a);
      i++;
      continue;
    }
    if (a === "--") {
      doubleDashSeen = true;
      i++;
      continue;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq > -1 ? a.slice(2, eq) : a.slice(2);
      const def = flags[name];
      if (!def) {
        out._unknown.push(a);
        i++;
        continue;
      }
      out._present.push(name);
      if (def.type === "boolean") {
        out[name] = true;
        i++;
      } else {
        const val = eq > -1 ? a.slice(eq + 1) : argv[i + 1];
        if (eq === -1) i++;
        if (def.repeatable) pushRepeatable(out, name, val);
        else out[name] = val;
        i++;
      }
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      const short = a.slice(1);
      const name = shortMap[short];
      if (!name) {
        out._unknown.push(a);
        i++;
        continue;
      }
      out._present.push(name);
      const def = flags[name];
      if (!def) break;
      if (def.type === "boolean") {
        out[name] = true;
        i++;
      } else {
        const val = argv[i + 1];
        if (def.repeatable) pushRepeatable(out, name, val);
        else out[name] = val;
        i += 2;
      }
    } else {
      out.positional.push(a);
      i++;
    }
  }
  return out;
}
