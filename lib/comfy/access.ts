// lib/comfy/access.ts — which ComfyUI servers ima2 may talk to, and with what credential.
//
// Loopback HTTP origins are always allowed (lib/comfyBridge normalizeComfyOrigin).
// Anything else must have been added by the user, and is matched by exact origin:
// a workflow file or a request body can never point ima2 at an address the user
// did not approve. A server behind an auth proxy gets a bearer token, kept in
// config.json beside the provider keys (mode 0600) and never returned by an API.
import { updateConfigFileAtomic } from "../configFileStore.js";
import { isComfyBridgeError, normalizeComfyOrigin, COMFY_ERROR } from "../comfyBridge.js";
import { readConfigFileSafe } from "../providers/media/credentials.js";

export const COMFY_REMOTE_ERROR = {
  ORIGIN_INVALID: "COMFY_REMOTE_ORIGIN_INVALID",
  TOKEN_INVALID: "COMFY_REMOTE_TOKEN_INVALID",
  NOT_FOUND: "COMFY_REMOTE_NOT_FOUND",
} as const;

const CONFIG_KEY = "comfyRemotes";
const MAX_TOKEN_CHARS = 4096;
/** A bearer token is one header value: no whitespace or control characters. */
const TOKEN_RE = /^[\x21-\x7e]+$/;

export class ComfyRemoteError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ComfyRemoteError";
    this.code = code;
    this.status = status;
  }
}

export function isComfyRemoteError(error: unknown): error is ComfyRemoteError {
  return error instanceof ComfyRemoteError;
}

/** One ComfyUI server ima2 is allowed to call, with the headers that authenticate to it. */
export interface ComfyTarget {
  origin: string;
  headers: Readonly<Record<string, string>>;
  /** Values that must never reach a log line or an error message. */
  secrets: readonly string[];
}

export interface ComfyRemoteSummary {
  origin: string;
  hasToken: boolean;
  /** Plain HTTP to a non-loopback host: the token and every image cross the network unencrypted. */
  insecure: boolean;
}

function isLoopbackOrigin(raw: string): boolean {
  try {
    normalizeComfyOrigin(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an address the user is adding to the allow list.
 *
 * Only an origin: credentials in the URL would end up in logs and records, and a
 * path or query would let two spellings of one server differ.
 */
export function normalizeRemoteOrigin(raw: unknown): string {
  const invalid = (message: string) => new ComfyRemoteError(COMFY_REMOTE_ERROR.ORIGIN_INVALID, message);
  if (typeof raw !== "string" || !raw.trim()) throw invalid("A ComfyUI server address is required.");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalid("The ComfyUI server address is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw invalid("The ComfyUI server address must use http or https.");
  if (url.username || url.password) throw invalid("The ComfyUI server address must not contain credentials. Save a token instead.");
  if (url.pathname !== "/" || url.search || url.hash) throw invalid("The ComfyUI server address must be an origin, without a path or query.");
  return url.origin;
}

function validateToken(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || raw.length > MAX_TOKEN_CHARS || !TOKEN_RE.test(raw)) {
    throw new ComfyRemoteError(COMFY_REMOTE_ERROR.TOKEN_INVALID, "The token must be a single line of printable characters.");
  }
  return raw;
}

type StoredRemotes = Record<string, { token?: string }>;

function readStored(fileConfig: Readonly<Record<string, unknown>>): StoredRemotes {
  const raw = fileConfig[CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: StoredRemotes = {};
  for (const [origin, value] of Object.entries(raw as Record<string, unknown>)) {
    let normalized: string;
    try {
      normalized = normalizeRemoteOrigin(origin);
    } catch {
      continue;
    }
    const token = value && typeof value === "object" ? (value as { token?: unknown }).token : undefined;
    out[normalized] = typeof token === "string" && TOKEN_RE.test(token) ? { token } : {};
  }
  return out;
}

/** The allow list as of one read of config.json. */
export class ComfyAccess {
  constructor(private readonly remotes: StoredRemotes) {}

  static async load(configFile: string): Promise<ComfyAccess> {
    return new ComfyAccess(readStored(await readConfigFileSafe(configFile)));
  }

  list(): ComfyRemoteSummary[] {
    return Object.entries(this.remotes)
      .map(([origin, entry]) => ({
        origin,
        hasToken: Boolean(entry.token),
        insecure: origin.startsWith("http:") && !isLoopbackOrigin(origin),
      }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  private withToken(origin: string): ComfyTarget {
    const token = this.remotes[origin]?.token;
    return token
      ? { origin, headers: { Authorization: "Bearer " + token }, secrets: [token] }
      : { origin, headers: {}, secrets: [] };
  }

  /**
   * Resolves an address to a server ima2 may call, or throws.
   *
   * A loopback origin passes as before. Anything else passes only when it is on
   * the allow list; otherwise the original loopback refusal is rethrown, so a
   * caller that never added a remote sees exactly the error it always did.
   */
  target(raw: unknown): ComfyTarget {
    try {
      return this.withToken(normalizeComfyOrigin(raw));
    } catch (error) {
      if (!isComfyBridgeError(error) || error.code !== COMFY_ERROR.URL_NOT_LOCAL) throw error;
      let origin: string;
      try {
        origin = normalizeRemoteOrigin(raw);
      } catch {
        throw error;
      }
      if (!(origin in this.remotes)) throw error;
      return this.withToken(origin);
    }
  }

  /** Like target(), for callers that report instead of failing (health probes). */
  tryTarget(raw: unknown): ComfyTarget | null {
    try {
      return this.target(raw);
    } catch {
      return null;
    }
  }
}

/** Adds a server to the allow list, or replaces its token. Omitting the token keeps a saved one. */
export async function putComfyRemote(
  configFile: string,
  input: { origin: unknown; token?: unknown; clearToken?: boolean },
): Promise<ComfyRemoteSummary> {
  const origin = normalizeRemoteOrigin(input.origin);
  const token = validateToken(input.token);
  await updateConfigFileAtomic(configFile, (existing) => {
    const stored = readStored(existing);
    const kept = input.clearToken ? undefined : token ?? stored[origin]?.token;
    stored[origin] = kept ? { token: kept } : {};
    existing[CONFIG_KEY] = stored;
  });
  const saved = (await ComfyAccess.load(configFile)).list().find((entry) => entry.origin === origin);
  if (!saved) throw new ComfyRemoteError(COMFY_REMOTE_ERROR.NOT_FOUND, "The ComfyUI server could not be saved.", 500);
  return saved;
}

export async function deleteComfyRemote(configFile: string, rawOrigin: unknown): Promise<boolean> {
  const origin = normalizeRemoteOrigin(rawOrigin);
  let removed = false;
  await updateConfigFileAtomic(configFile, (existing) => {
    const stored = readStored(existing);
    removed = origin in stored;
    delete stored[origin];
    existing[CONFIG_KEY] = stored;
  });
  return removed;
}
