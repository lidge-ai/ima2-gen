# 000 Plan: Codex/Grok quota and reset coupons (OpenCodex port)

Loop-spec (cxc-loop HOTL, same goal as 261121_openai-gpt6x-lineup; P amendment 2026-11-21)

- Trigger: user request 2026-11-21 to port OpenCodex's Codex quota logic, Grok weekly quota logic and reset-coupon/reset-credit logic into ima2-gen, as a PR separate from the lineup PR.
- Reference: OpenCodex origin/dev d61cca122d (read with `git show origin/dev:<path>` only). Research: 001.
- Goal: Account settings show Codex windows by their real duration (5h / weekly / other), Codex credit balance and reset-credit count; Grok weekly credits stay correct; users can list and manually redeem Codex reset credits and Grok reset coupons with an explicit confirmation; Codex auto-redeem exists, default OFF.
- Non-goals: OpenCodex account-pool router, credit-after-limit spend toggle, low-quota notifications, quota-driven account switching, immediate-reset purchase, Grok auto-redeem (OpenCodex scoped it out), release/tag.
- Verifier: typecheck, typecheck:tests, lint, test:inventory, generate-provider-types --check, refresh-structure-line-counts --check, build:server, build:cli, ui build, npm test; new failing-first files listed in 010/020.
- Safety invariant: no test or live check may call a consuming endpoint (WHAM `/rate-limit-reset-credits/consume`, Grok `RedeemReset`). Reset clients take an injected transport; tests use a transport that throws on any unmatched URL; live checks are read-only (usage, reset-credit list, GetRemainingResets).
- Stop: PR to dev merged by merge commit after fresh Terra final review PASS, checks green, 0 blockers. No release.
- Branch: `codex/261121-quota-reset-coupons` from origin/dev 75041138 (lineup PR #432 merged first).

## Work-phase map

| wp | Doc | Closes with |
|---|---|---|
| wp4 | 000-001 (docs only) | roadmap locked |
| wp5 | 010 | Codex windows/credits/reset-credit list + manual redeem with ledger, failing-first tests, UI |
| wp6 | 020 | Grok coupons list + manual redeem, Codex auto-redeem (default off), Grok weekly label polish |
| wp7 | 030 | gates, screenshots, PR, fresh review, merge |

## Main decisions on the architect's open questions (001 §F)

1. Codex balance: shown by default in Account settings (read-only; ima2 has no status bar to clutter, unlike OpenCodex's default-off bar).
2. Grok coupon account: ima2 own xAI OAuth session; identity per 020 §1 (OIDC userinfo `sub` for the exact bearer, ledger key grok:oidc:<sub>, fail closed). The live finding that grok.com billing RPCs answered this session and refused the ~/.grok CLI key is account-specific evidence from 2026-11-21 (001).
3. Ledger: a `reset_operations` table in ima2's SQLite db (`lib/db.ts`, better-sqlite3), unique operation_id, one unresolved operation per (provider, account) enforced by a partial unique index; claims are single INSERT transactions, so they are atomic across local server processes.
4. Unresolved operations block new redeems for that account until the user clears them after a fresh read (explicit "I checked" action that records who/when); no automatic settlement.
5. Codex auto-redeem ships in this PR but in its own slice (wp6) after manual redeem + ledger tests pass; default OFF, lead 10 min (1-60).
