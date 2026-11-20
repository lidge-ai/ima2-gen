# 020 wp6: Grok weekly reading, Grok reset coupons, Codex auto-redeem

Normative text for wp6 (rewritten after audit round 5; history of earlier rounds is in 002_audit_log.md). Shared safety model: 010 §0 (ledger states, fencing, reservations, consumption guard, principal binding, naive baselines).

## 1. Grok accounts and identity (R5-F1, R5-F3)

- Two Grok sources exist and are shown separately:
  1. **ima2 xAI OAuth session** (lib/xaiAuth.ts). Used for the weekly reading when present and for every coupon operation.
  2. **~/.grok CLI candidates** (existing reader in lib/quota/grokBilling.ts). Used for the weekly reading only when no ima2 xAI session exists or its reading fails. The coupon RPCs refuse this credential (live read-only probe 2026-11-21: grpc-status 7).
- Each Grok observation carries `source: "ima2-session" | "grok-cli"` and its account label. The coupon panel shows its own account label (the ima2 session's). When the weekly reading came from the CLI fallback, the card states that the coupon account may differ; coupon actions never depend on the fallback reading.
- Identity binding (round 6): the account that a bearer charges is asserted by the server for that exact bearer. Before issuing a confirmation and again immediately before dispatch, the client calls the OIDC userinfo endpoint advertised in auth.x.ai discovery (`userinfo_endpoint`, the same discovery document lib/xaiAuth.ts already fetches) with the access token it will send to the RPC, and requires the standard `sub` claim. Ledger key = `grok:oidc:<sub>`. Email (from userinfo or cli-chat-proxy /v1/user) is display-only. No `sub`, non-2xx, malformed JSON or discovery without userinfo ⇒ coupons unavailable (fail closed); `sub` at dispatch ≠ confirmed `sub` ⇒ IDENTITY_CHANGED, zero dispatch. The userinfo response shape was not live-verified on this host (session absent since 04:36 KST) [unverified]; fixtures cover it. Tests: sub stable while email changes with an unresolved operation (same key, still blocking), userinfo without sub, discovery without userinfo_endpoint, refresh without a new id token, account replacement during refresh, mismatched id-token vs asserted sub (asserted wins), A/B divergence between CLI fallback reading and ima2 session.

## 2. Grok coupon RPCs (R5-F4)

Exactly the contract OpenCodex ships (origin/dev src/grok/reset-coupons.ts:8-12,143-305), one service for list and redeem so the coupon token comes from the service that consumes it:
- List: `POST https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets`, gRPC-Web (`content-type: application/grpc-web+proto`, `accept` same, `x-grpc-web: 1`, `authorization: Bearer`, `x-xai-token-auth: xai-grok-cli`), body = 5-byte frame of an empty message. Response: data frame with repeated field 10 messages {10: tokenId string, 20: validity start Timestamp, 30: validity end Timestamp}; success only with complete frames and trailer `grpc-status: 0`.
- Redeem: `POST https://grok.com/prod_mc_billing.ConsumerUiSvc/RedeemReset` (case-sensitive), request field 1 = tokenId; success only with complete framing and `grpc-status: 0`; anything else ⇒ `unknown` (ledger) and no retry.
- `grok_api_v2.GrokBuildBilling/*` is not used for coupons (list-only evidence, zero-coupon account, no consume counterpart verified). Its `GetGrokCreditsConfig` is not used either; the weekly reading keeps the JSON endpoint below.
- Fixtures (synthetic bytes): empty list, two tokens, truncated frame, bad varint, missing trailer, conflicting status, nonzero status, HTTP 200 + grpc-status 7.
- UI shows validity end from field 30; no cooldown text unless a response field supplies it (R5-F5).

## 3. Grok weekly reading

`GET https://cli-chat-proxy.grok.com/v1/billing?format=credits` with the ima2 session (live 2026-11-21: `currentPeriod{type USAGE_PERIOD_TYPE_WEEKLY,start,end}`, `creditUsagePercent`, `productUsage[]`, `isUnifiedBillingUser`, `prepaidBalance`), then the existing ~/.grok candidate path, then the legacy monthly path — all existing parsing kept. New optional display rows: `productUsage[]` (product + percent) and `prepaidBalance` when present; parsers ignore malformed rows.

## 4. Codex auto-redeem

As 010 §0 R3-F2/F3/F4, R4-F1/F2: db settings `reset_settings` (default disabled, lead 10 min, 1-60), watcher always started; while disabled it performs no inspection and no network call (test asserts zero fetches over several ticks); enabled ⇒ nearest unexpired credit by (granted_at, expires_at), revision-checked claim + reservation, settings re-read inside the CAS transaction, one dispatch, never redispatch after `unknown`. Consume sends only `redeem_request_id` (no `credit_id`, R5-F2). No Grok auto-redeem.

## 5. Failing-first tests (commit 1, naive baselines per 010 §0 R3-F5)

`tests/reset-grok-grpc.test.ts` (fixtures above), `tests/reset-grok-routes.test.ts` (identity binding cases of §1, list/redeem through buildApp with fake transports, ledger claim before dispatch, restart never redispatches `claimed/sending/unknown`, missing coupon after attempt ⇒ `unknown`), `tests/reset-auto-redeem.test.ts` (§4 incl. disabled ⇒ zero fetches, two schedulers, forced interleavings, enable after boot), `tests/quota-grok-weekly.test.ts` (source labels, productUsage/prepaidBalance parsing, malformed rows), locale parity for all new keys.

## 6. Implementation (commit 2)

`lib/reset/grokGrpcWeb.ts`, `lib/reset/grokResetClient.ts`, `lib/reset/grokIdentity.ts`, `lib/reset/codexAutoRedeem.ts`, settings route + UI toggle with warning, `ui/src/components/settings/GrokCouponsPanel.tsx`, weekly rows in the Grok card.

## 7. Screenshots and live checks

Fixture server with fake transports, temp config dir and db, `IMA2_RESET_DISPATCH_DISABLED=1`. Live: read-only list + identity read only, only if an ima2 xAI session exists at that time (the session file disappeared from this host at 04:36 KST for reasons outside this loop; if still absent, NOT RUN). Never RedeemReset, never WHAM consume.


## 8. Userinfo endpoint safety (audit round 7, R7-F1)

lib/xaiAuth.ts discovery validation (HTTPS + host allow-list, :164-192) is extended to `userinfo_endpoint`; an endpoint outside the allow-list is treated as absent (coupons unavailable). The userinfo request uses `redirect: "manual"` (any 3xx ⇒ failure, bearer never re-sent), a 5 s timeout and a 64 KiB response cap. Tests: untrusted endpoint host, http scheme, 302 redirect, malformed JSON, oversize body, timeout — each ⇒ coupons unavailable with zero RPC calls.
