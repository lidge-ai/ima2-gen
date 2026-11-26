/**
 * Scripted fetch for media adapter tests: each route answers in order and every
 * call is recorded, so tests assert the exact wire shape without a network.
 */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

export type Responder = (call: RecordedCall) => Response | Promise<Response>;

export function fakeFetch(routes: Array<[RegExp | string, Responder]>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const raw = init?.body;
    let body: any = raw;
    if (typeof raw === "string") {
      try { body = JSON.parse(raw); } catch { body = raw; }
    }
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    const route = routes.find(([pattern]) => (typeof pattern === "string" ? url === pattern : pattern.test(url)));
    if (!route) throw new Error(`unexpected fetch ${call.method} ${url}`);
    return route[1](call);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
