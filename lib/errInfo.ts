export interface ErrInfo {
  message: string;
  code: string | undefined;
  status: number | undefined;
  name: string | undefined;
  cause: unknown;
  stack: string | undefined;
  raw: unknown;
}

/** Narrow an unknown thrown value to a stable info shape. */
export function errInfo(e: unknown): ErrInfo {
  if (e instanceof Error) {
    const anyE = e as Error & { code?: unknown; status?: unknown; cause?: unknown };
    return {
      message: e.message,
      code: typeof anyE.code === "string" ? anyE.code : undefined,
      status: typeof anyE.status === "number" ? anyE.status : undefined,
      name: e.name,
      cause: anyE.cause,
      stack: e.stack,
      raw: e,
    };
  }
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    return {
      message: typeof o.message === "string" ? o.message : String(e),
      code: typeof o.code === "string" ? o.code : undefined,
      status: typeof o.status === "number" ? o.status : undefined,
      name: typeof o.name === "string" ? o.name : undefined,
      cause: o.cause,
      stack: typeof o.stack === "string" ? o.stack : undefined,
      raw: e,
    };
  }
  return { message: String(e), code: undefined, status: undefined, name: undefined, cause: undefined, stack: undefined, raw: e };
}

/** Handy for `throw e instanceof Error ? e : asError(e)`. */
export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e));
}

/** Error carrying the HTTP-facing status/code metadata attached at throw sites. */
export interface CodedError extends Error {
  status?: number | undefined;
  code?: string | undefined;
}

/** Unverified fields of a caught value; each must be checked before use as a typed value. */
export interface ThrownFields {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  stderr?: unknown;
  isOperational?: unknown;
}

/** Field view of a caught value; non-object throws expose no fields. */
export function thrownFields(e: unknown): ThrownFields {
  return e !== null && typeof e === "object" ? e : {};
}

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberField(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
