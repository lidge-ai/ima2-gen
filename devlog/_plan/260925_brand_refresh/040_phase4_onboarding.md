# 040 Phase 4 — First-run onboarding

Keep the gate in ui/src/components/OnboardingPopup.tsx (open only when GPT OAuth, Grok and Gemini are all unauthenticated and `ima2.onboardingDismissed` is unset) and the sign-in surface (Settings → providers). Replace the one-paragraph modal with a 3-step welcome: step 1 is actionable now, step 2 happens in the composer, step 3 is the StarPrompt from wp3.

## File change map

| Path | Action | Change |
|---|---|---|
| ui/src/components/OnboardingPopup.tsx | MODIFY | mark + title + lead; ordered 3-step list (step 1 current); three provider choices (ChatGPT recommended, Grok, API key) each `dismiss(); openSettings("providers")`; footer privacy line + "Skip for now" |
| ui/src/styles/onboarding.css | NEW | two columns ≥ 760px, one column below, 44px targets |
| ui/src/i18n/{en,ko,zh-Hans,zh-Hant}.json | MODIFY | `onboarding.*`: title, lead, steps.{signIn,firstImage,star}.{title,hint}, choice.{chatgpt,grok,apiKey}.{title,body,cta}, recommended, privacy, skip; keep old keys only if referenced elsewhere |

Copy: no unverified numbers. ChatGPT "Uses your ChatGPT plan through a browser sign-in. No API key needed." Grok "Sign in with your xAI account. Adds Grok Imagine images and video." API key "OpenAI, Gemini or another provider key, billed by that provider."

Interplay: ProviderReadinessPopup and StarPrompt must not stack with onboarding (verify at P against the ui gap report).

## Accept criteria

- `cd ui && npm run build` exit 0; tests that reference onboarding keys (`rg -n onboarding tests`) pass.
- Render: this host has real logins, so the gate will not open in the live app. A `.concepts/` harness mounts the built CSS with the component markup; screenshot read back. Recorded as a render-harness observation, not a live-flow proof.


## A round 1 amendments (002)

- Gate: open when zero lanes are ready per `useProviderAvailability()` (re-verify name at P) instead of the three-provider check, and `!settingsOpen`; key `ima2.onboardingDismissed` kept (e2e fixtures ui/e2e/fixtures/appServer.ts:210) and appended to PERSISTED_KEYS (ui/src/store/persistenceRegistry.ts).
- Escape / backdrop = close for this session only (state), "Skip for now" = permanent dismiss; initial focus on the primary ChatGPT button.
- Dedicated backdrop class `onboarding-backdrop` with z-index above gallery (≥ 120) and below metadata dialogs.
- ui/src/components/home/HomeHero.tsx:74-78: the "no lane ready" line becomes a button calling `openSettings("providers")`.
- CSS import in ui/src/index.css next to the other modal sheets.

## wp4 P re-verification (HEAD 99b8deac) — supersedes the A round 1 gate change

- Gate stays as shipped (OnboardingPopup.tsx:29-35: GPT OAuth, Grok and Gemini all signed out). `useProviderAvailability()` reports `agy` as always `ok: true` (ui/src/hooks/useProviderAvailability.ts, agy entry), so "zero ready lanes" can never be true and would disable onboarding entirely. Added condition: `!settingsOpen`.
- HomeHero "no lane ready" button dropped for the same reason: `readyLanes` is always ≥ 1, so `home.lanesNone` never renders.
- Close semantics: Escape / close reason from `useModalFocus` hides for this page load only (component state); "Skip for now" and any provider choice write `ima2.onboardingDismissed` = "1" (key unchanged for e2e fixtures). The key is appended to PERSISTED_KEYS (append-only list).
- Initial focus on the ChatGPT choice (`data-modal-initial-focus`).
- Layout: `.modal.onboarding` width min(760px, 100vw - 32px); two columns ≥ 760px (intro + steps | choices), one column below. Backdrop `onboarding-backdrop` z-index 167 (A-round fix: band 165-169 above mobile chrome 150/160 and gallery 110, below compose 170/180; star prompt moved to 168).
- Radius: new rules `.onboarding__step-num` (var(--r-pill)) and `.onboarding__choice` (var(--r-md)) add two manifest rows; count 480 → 482 in tests/ui-radius-scale-contract.test.ts. No gradients.
- i18n (4 locales): onboarding.{title, lead, stepsLabel, steps.signIn.{title,hint}, steps.firstImage.{title,hint}, steps.star.{title,hint}, recommended, choices.chatgpt.{title,body}, choices.grok.{title,body}, choices.apiKey.{title,body}, privacy, skip}; old `body`/`login` removed if unreferenced (`rg -n "onboarding\.(body|login)" ui/src tests`).
- Render: the :3345 worktree server (temp HOME, all providers signed out) shows the popup live; screenshot at 1280x800 and 390x844.
