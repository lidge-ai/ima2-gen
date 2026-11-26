// Shared fake transport for the L2 direct adapter tests: records every ctx.fetch call
// and answers from a scripted list, so no test reaches a paid endpoint.
import assert from "node:assert/strict";
import { MediaAdapterError } from "../lib/providers/media/direct/_l2/errors.ts";
import type { MediaAdapterContext, MediaSubmitRequest } from "../lib/providers/media/contract.ts";
export const KEY = "ark-test-key-5d4c3b2a1f0e";
export const HOST = "https://ark.ap-southeast.bytepluses.com/api/v3";

export type Call = { url: string; method: string; headers: Headers; body: unknown };

export function fakeFetch(responses: Array<{ status?: number; body: unknown }>, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : "";
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: raw ? JSON.parse(raw) : undefined,
    });
    const next = responses.shift() ?? {
      status: 500,
      body: { error: { code: "Unexpected", message: "no scripted response" } },
    };
    return new Response(next.body === null ? "" : JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

export function ctxWith(
  responses: Array<{ status?: number; body: unknown }>,
  calls: Call[],
  extra?: Record<string, string>,
): MediaAdapterContext {
  const ctx: MediaAdapterContext = { apiKey: KEY, fetch: fakeFetch(responses, calls) };
  if (extra) ctx.extra = extra;
  return ctx;
}

export function req(
  partial: Partial<MediaSubmitRequest> & Pick<MediaSubmitRequest, "model" | "task">,
): MediaSubmitRequest {
  return { inputs: [], ...partial };
}

export async function rejection(promise: Promise<unknown>): Promise<MediaAdapterError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof MediaAdapterError, String(error));
    return error;
  }
  assert.fail("expected a rejection");
}

export const png = (role: "first-frame" | "last-frame" | "reference-image" | "source-image") => ({
  role,
  bytes: new Uint8Array([137, 80]),
  mimeType: "image/png",
});
