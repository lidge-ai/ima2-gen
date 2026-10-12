# Composer audio feedback and video sound intent

Depends on wp2 and verified dependency inputs. Carry the pinned #364 patch in 031 companions onto current dev, amend only review findings and integration regressions.

## File delta

- NEW ui/src/lib/videoSoundIntent.ts and ui/src/components/SoundIntentPicker.tsx exactly as the reviewed upstream patch, subject to explicit audit corrections. Presets are ordinary persisted composer prompt chips, not a new provider parameter. One managed sound chip at a time; toggle and Clear preserve unrelated chips. They persist across model changes/reload, matching the current store contract; node video generation bypasses these chips and is out of scope.
- MODIFY ui/src/components/VideoControlsPanel.tsx: mount SoundIntentPicker among existing video settings.
- MODIFY ui/src/lib/droppedMedia.ts and components/composer/useComposerDrop.ts: stop accepting unsupported audio/* as a valid reference; return actionable localized feedback while valid images/video keep working.
- MODIFY ui/src/i18n/en.json, ko.json, zh-Hans.json, zh-Hant.json: matching preset and unsupported-audio text, preserving existing key consumers.
- NEW tests/video-sound-intent-contract.test.ts and video-sound-intent-ui-contract.test.ts; MODIFY dropped-media-sorting-contract.test.ts per patch.
- MODIFY docs/migration/runtime-test-inventory.md by node scripts/classify-tests.mjs; add the mandatory rendered behavior matrix below; source-string assertions cannot substitute for interaction proof.
- MODIFY structure/04-frontend-architecture.md and 260908_xai_imagine_spec_resync/030_wp35_gui_inputs.md to match unsupported composer audio and prompt-only sound intent.

No new serialized request field: preset selection edits the existing prompt; existing prompt serialization and consumers remain responsible. Trace storePromptImpl.ts creation → storePersistence.ts serialization/deserialization → existing prompt composition consumers. Preserve model-switch persistence in storeCoreSelectionImpl.ts. Do not add an enum to backend payloads.

## Activation and verification

Audio-only drop produces translated rejection and no attached reference; mixed audio/image drop rejects audio and retains image; base-model video drop retains the existing CLI-guidance toast without attaching/submitting video; other models retain rejection. Each preset inserts its exact intent once, switching replaces prior managed intent without deleting user-authored prompt text, and clearing/removing an intent restores truthful UI state. Test empty prompt, custom prompt, repeated click and prompt edits. Verify unsupported-audio feedback in normal and video composer paths.

Run focused node tests, typecheck/typecheck:tests, inventory and UI build. Run the existing Playwright component fixture or browser smoke with mocked provider calls, inspect screenshot and console, exercise the full ARCH-05 rendered behavior matrix and audio rejection. Capture screenshot outside the PR branch, upload to pr-assets by immutable SHA and embed in PR body. No paid upstream calls. Independent implementation review plus hosted exact-head PR Fast Gate/CodeQL required before dev merge; current dev post-merge checks required before release.

## ARCH-05 audit amendments

Add ui/e2e/video-sound-intent.spec.ts (or reuse equivalent owning rendered fixture) for select/replace/toggle/Clear, ordinary and continuity chip preservation, prompt ordering, model switch and reload persistence, keyboard activation/aria-pressed and narrow viewport. Retain locale-key source checks only where they test locale completeness. Include both current and dated 1.5 aliases in audio rejection coverage; regenerate docs/migration/runtime-test-inventory.md.
