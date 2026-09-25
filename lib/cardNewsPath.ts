import type { CodedError } from "./errInfo.js";
import { isAbsolute, resolve, sep } from "node:path";

export function assertSafeSetId(setId: unknown, status = 400): string {
  if (
    typeof setId === "string"
    && !isAbsolute(setId)
    && !setId.includes("..")
    && !setId.includes("/")
    && !setId.includes("\\")
    && /^[a-zA-Z0-9_-]{3,120}$/.test(setId)
  ) return setId;
  const err: CodedError = new Error(status === 404 ? "Card News set not found" : "Invalid Card News setId");
  err.status = status;
  err.code = status === 404 ? "CARD_NEWS_SET_NOT_FOUND" : "INVALID_CARD_NEWS_SET_ID";
  throw err;
}

export function resolveCardNewsSetDir(generatedDir: string, setId: unknown, status = 400): string {
  const root = resolve(generatedDir, "cardnews");
  const target = resolve(root, assertSafeSetId(setId, status));
  if (!target.startsWith(root + sep)) {
    const err: CodedError = new Error("Invalid Card News setId");
    err.status = status;
    err.code = status === 404 ? "CARD_NEWS_SET_NOT_FOUND" : "INVALID_CARD_NEWS_SET_ID";
    throw err;
  }
  return target;
}
