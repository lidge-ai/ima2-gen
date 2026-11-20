# 001 Research (OpenCodex origin/dev d61cca122d + live read-only probes)

Architect/research lane: GOAT task …29ec554f (codex / gpt-6.1-terra, executedModel confirmed). Full report reproduced below; live probe evidence after it.

## Live read-only probes (2026-11-21, user's ChatGPT session)

- `GET /backend-api/wham/usage` 200: plan pro; `rate_limit.primary_window.limit_window_seconds = 604800` (weekly) and `secondary_window = null`. ima2 dev labels primary as "5h" unconditionally (routes/quota.ts:89-96) ⇒ this account's weekly window is shown as "5h" today (bug).
- Usage also carries `credits{has_credits, unlimited, overage_limit_reached, balance:"<decimal string>", approx_local_messages[2], approx_cloud_messages[2]}`, `rate_limit_reset_credits{available_count, applicable_available_count}`, `model_usage`, `spend_control`.
- `GET /backend-api/wham/rate-limit-reset-credits` 200: `{credits:[], available_count, total_earned_count, immediate_reset_purchase_eligible, history_enabled}`.
- No consuming endpoint was called.


# Quota and reset-credit port research

**Source snapshots:** OpenCodex `origin/dev` = `d61cca122d00899b0a917162875c7c2c659f4952`; ima2-gen `origin/dev` = `bc6fbcdea1e39dfd1f23441a73d68f2ecf50204c`. All code references below are to those Git objects, not either working tree.

The main finding is that **ima2-gen already implements Grok weekly credits**. The substantive additions are Codex credit/reset-credit presentation, Codex reset-credit inspection and redemption, Grok coupon inspection and redemption, and an explicitly opt-in Codex auto-redeemer. The irreversible operations need account-bound durable coordination before UI work can safely expose them.

## A. Upstream contracts

The contracts below describe the provider-facing requests. Local ima2-gen routes proposed in section D are separate. HTTP error details are limited to what the inspected source establishes; the source does not establish a complete provider error-code catalog.

### Codex usage, quota windows, balance and reset count

**Read only:** `GET https://chatgpt.com/backend-api/wham/usage`

Headers:

```http
Authorization: Bearer <access token>
ChatGPT-Account-Id: <physical ChatGPT account ID>
```

ima2-gen’s existing `authHeaders()` also adds `X-OpenAI-Fedramp: true` when applicable (`lib/codexBackend/client.ts:74-80`).

Relevant response shape, with synthetic values:

```json
{
  "email": "person@example.test",
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "primary_window": {
      "used_percent": 42,
      "reset_at": 1800000000,
      "limit_window_seconds": 18000
    },
    "secondary_window": {
      "used_percent": 12,
      "reset_at": 1800100000,
      "limit_window_seconds": 604800
    },
    "tertiary_window": null
  },
  "credits": {
    "has_credits": true,
    "unlimited": false,
    "overage_limit_reached": false,
    "balance": "12.50",
    "approx_local_messages": [10, 20],
    "approx_cloud_messages": [3, 8]
  },
  "rate_limit_reset_credits": {
    "available_count": 2
  }
}
```

Fields are optional or nullable; the example does not assert they all appear together. `reset_at` is epoch seconds. A `credits.balance` is accepted upstream as a nonnegative finite number or plain decimal string; message ranges are optional two-number arrays (`src/codex/credits.ts:3-10,20-44`). Reset count is parsed independently of quota windows (`src/codex/quota.ts:1222-1229`). Explicit duration matters: OpenCodex distinguishes a short primary window, a roughly monthly primary window, and a weekly window rather than treating every primary as five hours (`src/codex/quota.ts:1274-1314`).

The existing ima2-gen call refreshes once after a 401 and maps a final 401/403 to unauthenticated; other non-2xx and parsing/transport failures become a quota error (`routes/quota.ts:55-78,107-110`). These are ima2-gen’s current mappings, not a complete WHAM error specification.

### Codex reset-credit list

**Read only:** `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

Headers: bearer and `ChatGPT-Account-Id` as above. No request body. The OpenCodex client sets an eight-second timeout (`src/codex/auth-api/reset-credit-service.ts:135-143`).

The safe response projection is:

```json
{
  "credits": [
    {
      "granted_at": "2030-01-01T00:00:00Z",
      "expires_at": "2030-01-31T00:00:00Z"
    }
  ],
  "available_count": 1
}
```

`available_count` is optional and may be sourced from a nested `rate_limit_reset_credits.available_count` or the top level; the projection accepts only string grant/expiry pairs (`src/codex/auth-api/reset-credit-service.ts:96-111`). Do not infer a per-credit identifier or assume the list count equals the usage summary.

OpenCodex forwards non-2xx status for the management read and maps an invalid or timed-out response body to 502 (`src/codex/auth-api/reset-credit-service.ts:271-306`). Exact provider error JSON is not established by these files.

### Codex reset-credit redemption

**Consuming:** `POST https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume`

```http
Authorization: Bearer <access token>
ChatGPT-Account-Id: <physical ChatGPT account ID>
Content-Type: application/json
```

```json
{ "redeem_request_id": "<UUIDv4 for this logical operation>" }
```

Known response codes:

```json
{ "code": "reset" }
```

`code` may be `reset`, `nothing_to_reset`, `no_credit`, or `already_redeemed`. The research notes state: “Reuse the same key when retrying the same logical reset attempt” (`devlog/_fin/290_rate-limit-reset-credits/01_codex-rs-api-research.md:29-55`). The current client sends a 10-second timeout and marks transport errors, non-2xx, malformed bodies, and unknown outcome codes ambiguous when an operation is journaled (`src/codex/auth-api/reset-credit-service.ts:363-409`).

A successful consume refreshes usage; a remaining count is returned only from a **freshly parsed** count, never from stale cache (`src/codex/auth-api/reset-credit-service.ts:411-423`). Exact HTTP error bodies are not specified.

### Grok weekly credits

**Read only:** `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`

```http
Authorization: Bearer <eligible xAI access token>
X-XAI-Token-Auth: xai-grok-cli
x-authenticateresponse: authenticate-response
x-userid: <user ID>
x-grok-client-version: <installed Grok client version>
x-grok-client-mode: headless
```

```json
{
  "config": {
    "creditUsagePercent": 57,
    "currentPeriod": {
      "type": "USAGE_PERIOD_TYPE_WEEKLY",
      "end": "2030-01-07T00:00:00Z"
    }
  }
}
```

An omitted `creditUsagePercent` in an otherwise valid weekly envelope means zero; invalid or non-weekly periods are not weekly readings. The source-backed cross-repo plan records the contract and fallback (`devlog/_fin/260716_grok_weekly_credits_crossrepo/000_plan.md:11-16,24-30,47-54`); ima2-gen already sends these headers and parses it (`routes/quota.ts:217-247`).

Only production xAI `oidc`/`external` candidates with a user ID and resolved client version qualify for the weekly request. Non-2xx, malformed responses and transport failures proceed to another candidate or the legacy monthly fallback; no detailed upstream error schema is established (`routes/quota.ts:172-175,197-215,233-270`).

The fallback is read-only `GET https://cli-chat-proxy.grok.com/v1/billing` and `GET https://cli-chat-proxy.grok.com/v1/user`, with bearer auth. Billing reads `config.monthlyLimit.val`, `config.used.val`, and `config.billingPeriodEnd`; `/v1/user` may return `email` (`routes/quota.ts:272-302`). Monthly dollar values must not be presented as the weekly credit pool.

### Grok reset coupons

These two RPCs are **binary gRPC-Web**, not JSON. Both use `POST`; the first is logically read-only.

```http
Content-Type: application/grpc-web+proto
Accept: application/grpc-web+proto
X-Grpc-Web: 1
Authorization: Bearer <xAI OAuth access token>
x-xai-token-auth: xai-grok-cli
```

The URLs and headers are defined in `src/grok/reset-coupons.ts:8-12,220-227`; the compatibility header name is in `src/providers/xai-transport.ts:36-39`.

- **Inspect, read only:** `POST https://grok.com/prod_mc_billing.ConsumerUiSvc/GetRemainingResets`. Request is an empty protobuf message inside a five-byte gRPC-Web data envelope. Response protobuf has repeated field 10, each token containing field 10 `tokenId`, field 20 start timestamp, and field 30 end timestamp. OpenCodex projects it to `{tokens:[{tokenId,validityStart,validityEnd}]}` (`src/grok/reset-coupons.ts:143-188,190-217,246-273`).
- **Redeem, consuming:** `POST https://grok.com/prod_mc_billing.ConsumerUiSvc/RedeemReset`. Request protobuf is field 1 string `token_id`, framed as gRPC-Web. Successful complete framing plus confirmed `grpc-status: 0` produces `{success:true,status:0,statusMessage?}` locally (`src/grok/reset-coupons.ts:99-112,279-305`).

A frame uses a five-byte header, `0x00` for data and `0x80` for trailers (`src/grok/grpc-web.ts:1-4,34-40`). HTTP non-2xx is an error; nonzero gRPC status is an error; missing, malformed, conflicting status or incomplete framing is **not confirmation** (`src/grok/reset-coupons.ts:230-243,260-267,292-299`). The source does not establish a comprehensive HTTP/gRPC status catalog. Unlike WHAM consume, the Grok wire request has **no upstream operation ID**.

## B. OpenCodex decisions to preserve

1. **Separate balance from reset credits.** WHAM `credits` is a display-only balance observation, while `rate_limit_reset_credits` is a count of reset entitlements. A credits row has no invented denominator or utilization percentage (`src/codex/credits.ts:3-10`; `gui/src/components/CodexCreditsRow.tsx:6-24`). OpenCodex’s display setting defaults off (`devlog/_fin/260930_codex_credits_bar/010_phase1_credits_implementation.md:43-52`). Whether ima2-gen should mirror that visibility default is a product choice, distinct from auto-redeem.

2. **Unknown is not zero.** An omitted balance observation retains a prior observation only for the same identity; explicit null or unusable data clears it. Identity changes discard the observation (`src/codex/credits.ts:26-29,47-65`). Reset count can exist without windows (`src/codex/quota.ts:1222-1229,1250`).

3. **Use actual account identity and generation.** Manual Codex operations open the ledger only after resolving the physical ChatGPT account. The same operation ID for a different account returns 409; ledger capacity or unavailability returns 503 instead of generating a replacement ID (`src/codex/auth-api/reset-credit-service.ts:315-359`). Post-dispatch publication checks that credential identity/generation is still live (`src/codex/auth-api/reset-credit-service.ts:201-214,224-239`).

4. **Do not exclude team accounts by plan name.** The later UI correction explicitly says: “do not exclude workspace/team plans from reset-credit lookup”; show numeric count including zero and hide unknown (`devlog/_fin/290_rate-limit-reset-credits/02_ui-spec.md:3-8,26-30,56-58`). This supersedes the older plan and research assumptions.

5. **Confirmation and outcome truth.** Show count and expiry where available, then confirm the specific consumption. Codex outcome codes need distinct messaging (`devlog/_fin/290_rate-limit-reset-credits/02_ui-spec.md:120-139,157-160`). Grok’s UI selects and sends a specific nearest-expiry `tokenId`, mints a UUIDv4, blocks when it cannot, and bases success on `code === "redeemed"` rather than HTTP 200 (`gui/src/components/provider-workspace/GrokResetCoupons.tsx:149-178`; `gui/src/hooks/useGrokResetCoupons.ts:260-300`).

6. **Ambiguity is a durable state.** The current Grok route marks an attempt **before** dispatch and does not issue another spend after an attempted-but-unsettled operation. A missing coupon does not prove which operation consumed it (`src/server/management/grok-coupon-routes.ts:268-329,473-516`). Earlier GUI planning recorded a double-spend residual, but the later current source provides the stronger attempted-state guard; preserve the current behavior, not the older plan’s assumption.

7. **Freshness and bounded reads.** Refresh after confirmed Codex consumption, but never invent a fresh remaining count from cache (`src/codex/auth-api/reset-credit-service.ts:411-423`). Grok’s UI bounds coupon reads to three at once and uses separate per-account request tokens (`gui/src/hooks/useGrokResetCoupons.ts:55-57,198-205`). The earlier GUI plan says there was no TTL cache and a mount could cost one read per account (`devlog/_fin/260912_grok_reset_coupon_gui/000_plan.md:47-58`); that is a cost trade-off, not a requirement to reproduce eager reads.

8. **Codex auto-redeem is opt-in, expiry-based, and scoped.** Default is off; default lead is 10 minutes, configurable from 1–60 minutes. It selects the nearest unexpired credit for the main account, re-inspects before spending, checks the same `(granted_at, expires_at)` remains, journals one request ID before dispatch, and rechecks enabled state (`src/codex/reset-credit-auto-redeem.ts:10-19,27-37,53-67,226-250`). It is not a generic “redeem on low quota” policy. The Grok GUI scope explicitly says no auto-redeem (`devlog/_fin/260912_grok_reset_coupon_gui/000_plan.md:23-27`).

9. **Credit spending after quota is separate.** OpenCodex’s router offers an opt-in policy to allow ordinary credit spending after the included limit (`gui/src/components/CodexCreditSpend.tsx:7-9`). Do not conflate that router policy with reset-credit redemption or assume an ima2-gen equivalent exists.

## C. ima2-gen dev state and gaps

| Item | Existing on dev | Gap |
|---|---|---|
| Codex windows | `/api/quota` reads WHAM using the generation session store, with one 401 refresh and retry; it maps primary to `5h`, secondary to `7d` (`routes/quota.ts:29-30,44-107`). | It discards duration, tertiary window, credit balance and reset count. It also defaults missing `used_percent` to zero, and unconditional primary/secondary labels can misrepresent other topologies. |
| Codex credentials | The same store used by image generation supplies session and account headers. The auth module documents ima2’s separate session store and account extraction (`lib/chatgptAuth.ts:5-12,100-108,163-175`; `lib/codexBackend/client.ts:74-80`). | A redemption operation must bind to the physical account and detect switching/reauth while the user is confirming or the request is in flight. |
| Grok weekly credits | Eligibility, production xAI issuer checks, nested weekly parsing, source-parity headers and legacy monthly fallback already exist (`routes/quota.ts:172-175,197-247,254-302`). Existing tests cover weekly envelopes, auth headers, failure fallback and missing prerequisites (`tests/billing-source.test.ts:133-252`). | Preserve this implementation during extraction. Account selection for coupons must be tied to the displayed Grok identity; weekly probing may choose a candidate different from the ima2-owned xAI session. |
| Reset credits and coupons | `QuotaCard` renders provider windows; `AccountSettings` embeds Codex and Grok quota blocks (`ui/src/components/settings/QuotaCard.tsx:382-450`; `ui/src/components/AccountSettings.tsx:79-88,113-123`). Styles already define the quota card (`ui/src/styles/quota-card.css:1-12`). | No reset-credit/coupon list, confirmation, consuming route, durable operation ledger, uncertainty UI, or auto-redeem setting is present in these dev surfaces. |
| Grok auth | ima2 has an xAI OAuth store and refresh client; its comments say the file is the source of truth and explicitly avoid an in-memory credential cache (`lib/xaiAuth.ts:2-12,60-67`). | Prove a stable, physical identity for the precise candidate used by coupon operations; do not assume an email or selected display row is sufficient. |
| Existing test coverage | Codex quota tests stub WHAM and the token endpoint, covering refresh, 401 retry, FedRAMP and auth failures (`tests/quota-codex-session.test.ts:1-7,143-194`). | They do not cover credit DTOs or irreversible reset operations. |

## D. Architecture proposal

### Q1 — Separate provider clients and keep the existing aggregate route

Split `routes/quota.ts` into small modules, keeping each file under 500 lines and each function under 50:

- `lib/quota/codex-usage.ts`: bounded WHAM read, duration-aware parser, explicit unknowns.
- `lib/quota/codex-credits.ts`: balance and reset-count parsing, identity-scoped observations.
- `lib/quota/grok-weekly.ts`: existing eligibility, headers, parser and fallback, preserving behavior and tests.
- `lib/quota/nai.ts`: existing NovelAI projection.
- `routes/quota.ts`: composition of the existing `GET /api/quota` response, retaining compatible `windows`.

Add typed `observedAt` and source/status metadata. Classify explicit window durations; use a documented legacy fallback only when duration is absent. Missing or invalid usage must remain unknown, not an invented zero. Avoid using a displayed quota reading as authorization to spend.

### Q2 — Add reset clients with injected transports

- `lib/reset/codex-client.ts`: WHAM list and consume with existing Codex session headers, bounded body reads and deadlines.
- `lib/reset/grok-grpc-web.ts`, `lib/reset/grok-protobuf.ts`, `lib/reset/grok-client.ts`: binary frame/field parsing and RPCs. Validate complete framing and affirmative status.
- `lib/reset/identity.ts`: resolved provider identity and credential generation. Expose only opaque account references to the UI; never return bearer tokens or raw credential data.
- Require an injected transport at the domain boundary. Production composition supplies real `fetch`; tests supply a transport that rejects all unexpected URLs.

Use read-only details on demand. A GET for Grok coupons translates internally to its read-only **upstream POST**. Avoid automatic eager scans of unrelated account candidates.

### Q3 — Local API and confirmation

Proposed authenticated local routes:

```text
GET  /api/quota/codex/reset-credits
GET  /api/quota/grok/reset-coupons
POST /api/quota/reset-confirmations
POST /api/quota/codex/reset-credits/redeem
POST /api/quota/grok/reset-coupons/redeem
GET  /api/quota/reset-operations/:operationId
```

`POST /reset-confirmations` prepares a short-lived, single-use opaque confirmation token after an authenticated, origin-protected request. Bind it to provider, physical account identity, credential generation, selected Grok token where applicable, and an operation UUID. It must not dispatch a redeem. The final confirmation action submits, for example:

```json
{
  "operationId": "<UUIDv4>",
  "confirmationToken": "<opaque one-time token>",
  "tokenId": "<required for Grok>"
}
```

The server verifies the token and current identity and atomically records admission before dispatch. A confirmation token is an application guard, **not a replacement** for existing authentication, LAN-session restrictions, origin/CSRF defenses, or the durable operation ledger. A repeat request with the same operation ID must query/replay its recorded result even after the one-time confirmation has been consumed.

Return typed outcomes: `confirmed`, `nothing_to_reset`, `no_credit`, `unavailable`, `identity_changed`, `in_progress`, `unknown`, and explicit authentication/upstream errors. Preserve provider codes where useful. Do not claim success from HTTP 200 alone.

### Q4 — Durable operation ledger and recovery

Create `lib/reset/operation-ledger.ts` plus a separate storage adapter. Use atomic cross-process claims and durable writes **before** upstream dispatch; bind operation ID to provider, physical account and selected coupon. Fail closed if persistence or locking fails.

- **Codex:** send the canonical operation UUID as `redeem_request_id`; replay recorded terminal outcomes. A retry policy must preserve that exact ID and account and be tested against the upstream idempotency contract.
- **Grok:** mark `attempted` atomically before the wire call. Repeated requests can inspect durable state but must not redispatch an attempted operation, including after restart. An unavailable coupon is not proof of success.
- Block conflicting operations for the same account/coupon while an outcome is unresolved, including across manual and automatic paths. A new ID must not bypass an unresolved old operation.
- Store only the minimal identity and operation metadata, restrict permissions, and never log credentials or raw response bodies.

### Q5 — UI placement, states and i18n

Keep the existing `AccountSettings` provider cards. Split the quota UI into:

- `CodexCreditBalance`: remaining balance/unlimited/overage, with no fabricated percentage.
- `ResetCreditBadge` and `ResetCreditDialog`: count, list dates, empty/unknown/error states, explicit confirmation.
- `GrokCouponBadge` and `GrokCouponDialog`: available coupons sorted by valid expiry, explicit selected token and confirmation.
- `ResetOperationStatus`: pending, confirmed, definitive refusal, and unresolved states that survive dialog close/remount.

Use existing quota-card styling as the base and make confirmation focus, keyboard behavior, and error announcements accessible. Suggested locale keys: `settings.quota.creditsRemaining`, `resetCredits`, `resetCreditsUnknown`, `couponExpires`, `redeemConfirm`, `redeeming`, `redeemSuccess`, `nothingToReset`, `noCredit`, `identityChanged`, `outcomeUnknown`, `refresh`, and `autoRedeem.*`. Add each key to every supported locale.

### Q6 — Codex auto-redeem

Add persisted `resetCreditAutoRedeem: { enabled: false, leadTimeMinutes: 10 }`; validate lead time 1–60 minutes. The settings UI must explain that enabling it can consume a credit near expiry without another confirmation.

Use a separate `lib/reset/codex-auto-redeem.ts` with an injected clock, scheduler, inspector and ledger. Only start it when explicitly enabled. Bind its plan to the active physical account and credit date pair; fresh-inspect and recheck setting, identity and eligibility before dispatch. Share admission with manual operations. On reauth, account switch, missing expiry, malformed data, failed inspection or ledger failure, do not spend. There is no Grok auto-redeem in this proposal.

### Q7 — Scope boundaries

Port the client contracts, parsing, current identity safeguards, confirmation behavior, ledger semantics and Codex expiry policy. Preserve existing Grok weekly-first/monthly-fallback behavior.

Leave out OpenCodex’s account-pool router, credit-after-limit routing toggle, notification machinery and quota-driven account switching: ima2’s requested feature is quota visibility and reset management, and those mechanisms depend on a separate pool-routing architecture. Do not copy old workspace exclusion or the old Grok open-operation replay behavior.

### Q8 — Synthetic fixtures and failing-first tests

Fixtures should contain **shape-only synthetic values**: WHAM windows with declared/missing durations, zero and unknown counts, decimal/unlimited/overage credits, dated reset credits, Grok weekly/legacy envelopes, binary gRPC-Web coupon frames and trailers, and malformed/truncated/status-error variants. No recorded real account IDs, coupon IDs, tokens or live payloads.

Proposed tests, written first and observed failing on the dev ref before implementation:

| Test file | Assertion and expected reason for failure on dev |
|---|---|
| `tests/quota-codex-credits.test.ts` | Credit balance, reset count, credits-only response, null/unknown and identity changes survive the quota projection. Dev currently drops those fields. |
| `tests/quota-codex-windows.test.ts` | Explicit short/weekly/monthly durations classify correctly; missing percent stays unknown. Dev hardcodes primary/secondary labels and defaults missing percent to zero. |
| `tests/reset-codex-client.test.ts` | List DTO, exact account headers, bounded responses and consume UUID/code handling. Client does not exist on dev. |
| `tests/reset-grok-protobuf.test.ts` | Empty framed list request; coupon fields; truncated frame, invalid varint and missing/conflicting/nonzero status fail closed. Client does not exist. |
| `tests/reset-operation-ledger.test.ts` | Concurrent same-ID calls dispatch at most once; account/token mismatch is rejected; restart after attempted Grok dispatch never redispatches; failed ledger admission makes zero upstream calls. Ledger does not exist. |
| `tests/reset-routes.test.ts` | Missing/expired confirmation, invalid UUID, changed identity and unauthenticated/LAN-locked requests make zero consume calls; terminal replay returns recorded result; ambiguous stays unknown. Routes do not exist. |
| `tests/reset-auto-redeem.test.ts` | Default off starts no scheduler; fake clock schedules at expiry minus lead; disabling, account change, vanished credit, failed inspection or manual race prevents dispatch; restart keeps the same operation. Policy does not exist. |
| UI tests for settings quota cards | Show zero versus unknown, balance separately from reset credits, confirmation, expiry, replayed failure, and unknown state surviving remount without another POST. UI does not exist. |
| Existing `tests/billing-source.test.ts` and `tests/quota-codex-session.test.ts` | Run unchanged after extraction to guard existing Grok fallback and Codex refresh/header behavior. These are preservation checks, not claimed failing tests. |

## E. Risks and test isolation

- A real `RedeemReset` or WHAM `/consume` call can spend a real entitlement. Tests must inject a rejecting-by-default fake transport; an unmatched URL throws rather than falling through to global `fetch`. Use synthetic credentials and temporary fake stores. No test should load a real home directory or credential file.
- A timeout, abort, malformed body or process crash after dispatch does **not** prove failure. Persist the attempted state first, retain operation identity, and block a new consuming operation while unresolved. Grok list changes alone do not prove the original request succeeded.
- A retry middleware or generic 401-refresh helper could resend a consuming POST. The reset client must own retry behavior explicitly; Grok must never automatically replay an attempted request. Codex retries, if implemented, must retain the same journaled request ID and physical account.
- An account switch between list, confirmation and dispatch could spend another account’s entitlement. Bind every stage to a resolved identity and generation; reject mismatch and discard stale UI results.
- An enabled scheduler could spend without a visible click. Default off, no timer or live redeem in tests, fake clock/transport, fresh preflight and shared manual/automatic ledger are mandatory.
- gRPC-Web HTTP 200 is insufficient evidence. Require complete frames and confirmed zero gRPC status before reporting success.

## F. Open questions for main

1. Should Codex balance visibility be on by default in ima2 settings, or mirror OpenCodex’s separate default-off `showCodexCredits` setting?
2. Which Grok account should own the coupon surface when weekly quota selected a `~/.grok` candidate but image generation uses the ima2-owned xAI session? The UI must identify the actual account; implementation should not silently assume they coincide.
3. Where should the durable cross-process ledger live in ima2-gen, and what existing locking/storage primitive can guarantee atomic claims across multiple local server processes?
4. Should an unresolved operation require explicit support/manual reconciliation indefinitely, or is there an independently verifiable provider receipt that can settle it? The inspected Grok contract does not establish one.
5. Should Codex auto-redeem ship in the first implementation or a later slice after manual redemption and ledger recovery are proven? The requested setting can be designed now, but enabling the scheduler before those guarantees would be unsafe.

**NOT RUN:** tests, builds, live provider requests, paid calls, credential reads, web lookups, and redemption. Test failures described above are predictions from the dev source, not observed failing-test receipts.

## Cross-check with Aside exec report (openai-codex-report.md, 2026-11-21)

Report claims vs main's live read (same day, Pro account, read-only):
- wham/usage: live keys match the report incl. model_usage, credits.overage_limit_reached, promo, rate_limit_reset_credits.applicable_available_count; primary_window 604800 s and secondary_window null (weekly only) — matches report §2.2. additional_rate_limits was null on this account (report: image buckets image_gen / imagegen_premium can appear there with normal_model_slug).
- reset-credit list: live keys credits[], available_count, total_earned_count, immediate_reset_purchase_eligible, history_enabled — matches §2.5; the report's per-credit fields (id, reset_type, status available|redeeming|redeemed, title, description) could not be confirmed live (empty list).
- Not re-verified live (would need a consume): consume body optional credit_id and response windows_reset.

Additions to the plan (historical; the normative version is 010 "Report-driven additions"):
- plan_type display map (report §2.4, codex-rs source): prolite → "Pro 100", pro → "Pro 200", promax → "Pro 500", sci/sci_plus → Academic Researchers (Plus), ent26/enterprise* → Enterprise, self_serve_business_prolite → Business Premium; unknown → raw value.
- additional_rate_limits[] → extra windows labelled by limit_name (e.g. image buckets), same duration classifier, stable id = metered_feature.
- applicable_available_count shown as "usable now" next to available_count.
- reset list DTO keeps id/status/title when present (display only; superseded in round 5: consume sends no credit_id); the consume response's windows_reset is recorded when present.
- rate_limit_upsell CTAs are rendered as external links only for buy_reset (https://chatgpt.com/codex/purchase/reset) and view_usage (https://chatgpt.com/settings/usage); no purchase inside ima2.
