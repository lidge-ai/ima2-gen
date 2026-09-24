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
