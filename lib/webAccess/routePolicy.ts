import { posix } from "node:path";

/**
 * What a signed-in remote person may reach on the shared web instance.
 * Reads stay open except surfaces that drive this computer (MCP processes,
 * ComfyUI, local folders, admin stop, subscription sign-in). Writes are an
 * allow list: everyday library edits plus priced media jobs. Generation routes
 * without published prices are closed because the spend guard cannot bound them.
 */
export type WebRouteDecision =
  | { action: "allow" }
  | { action: "deny"; code: "WEB_ROUTE_DISABLED" | "WEB_UNPRICED"; message: string };

const CLOSED_ANY_METHOD: readonly RegExp[] = [
  /^\/api\/admin(\/|$)/,
  /^\/api\/mcp(\/|$)/,
  /^\/api\/comfy(\/|$)/,
  /^\/api\/history\/import-local$/,
  /^\/api\/prompts\/import\/folder-/,
];
const OPEN_AUTH_READ = /^\/api\/auth\/lan\/session$/;

const UNPRICED_WRITES: readonly RegExp[] = [
  /^\/api\/generate(\/|$)/,
  /^\/api\/edit$/,
  /^\/api\/node\/generate$/,
  /^\/api\/video(\/|$)/,
  /^\/api\/cardnews(\/|$)/,
  /^\/api\/agent(\/|$)/,
  /^\/api\/prompt-builder\/chat$/,
  /^\/api\/sprite-recipes\/[^/]+\/generate/,
];

const ALLOWED_WRITES: readonly RegExp[] = [
  /^\/api\/media$/,
  // Price lookup only (routes/mediaTools.ts); the media UI asks it before every run.
  /^\/api\/media\/estimate$/,
  /^\/api\/media\/inputs$/,
  /^\/api\/media\/[^/]+\/cancel$/,
  /^\/api\/inflight\/[^/]+$/,
  /^\/api\/workflows\/[^/]+\/estimate$/,
  // Runs pass the spend guard in routes/workflows.ts (complete published-price estimate only).
  /^\/api\/workflows\/[^/]+$/,
  /^\/api\/sessions(\/|$)/,
  /^\/api\/history\/favorite$/,
  /^\/api\/history\/[^/]+$/,
  /^\/api\/prompts(\/(?!import(\/|$)).*)?$/,
  /^\/api\/annotations\//,
  /^\/api\/canvas-versions(\/|$)/,
  /^\/api\/assets(\/(?!derived$).*)?$/,
  /^\/api\/node-templates(\/|$)/,
];

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalize(rawPath: string): string | null {
  try {
    const decoded = decodeURIComponent(rawPath.split("?")[0] || "/");
    if (decoded.includes("\0")) return null;
    const path = posix.normalize(decoded.replace(/\\/g, "/")).toLowerCase();
    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  } catch { return null; }
}

const disabled = (what: string): WebRouteDecision => ({ action: "deny", code: "WEB_ROUTE_DISABLED", message: what + " is not available on the shared web instance." });

export function classifyWebRoute(method: string, rawPath: string): WebRouteDecision {
  const path = normalize(rawPath);
  if (path === null) return disabled("This path");
  const verb = method.toUpperCase();
  const read = READ_METHODS.has(verb);
  if (!/^\/api(\/|$)/.test(path)) return read ? { action: "allow" } : disabled("This request");
  if (read && OPEN_AUTH_READ.test(path)) return { action: "allow" };
  if (/^\/api\/auth(\/|$)/.test(path) || CLOSED_ANY_METHOD.some((re) => re.test(path))) return disabled("This feature");
  if (read) return { action: "allow" };
  if (UNPRICED_WRITES.some((re) => re.test(path))) {
    return { action: "deny", code: "WEB_UNPRICED", message: "This generator has no published price, so the shared web instance cannot cap its spend. Use a priced model in the media studio." };
  }
  if (ALLOWED_WRITES.some((re) => re.test(path))) return { action: "allow" };
  return disabled("This action");
}
