// Deliberately incomplete failing-first baseline; callers must not use for dispatch.
export async function grokIdentity(discovery: { userinfo_endpoint?: string }, bearer: string,
  request: typeof fetch): Promise<{ ledgerKey: string; email: string | null } | null> {
  if (!discovery.userinfo_endpoint) return null;
  try {
    const response = await request(discovery.userinfo_endpoint, { headers: { authorization: `Bearer ${bearer}` } });
    const value = await response.json() as { sub?: string; email?: string };
    return value.sub ? { ledgerKey: `grok:oidc:${value.sub}`, email: value.email ?? null } : null;
  } catch { return null; }
}
