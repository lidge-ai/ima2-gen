# 030 GPT-6 model probe (user request: keep only 6s / 6l / 6a)

Request, 2026-09-25 during the v3.21.0 cut: keep only `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra` on the GPT lane.

## Release state when the request arrived

The second cut (release.yml run 36099640992, candidate `93334aea`) was waiting on its candidate CI gate. It was cancelled before the gate so preview never moved: main `233631af`, dev `6e92b638`, preview `e78bbbaa`, no `v3.21.0` tag, npm latest 3.20.0. Only `release-candidate` points at the abandoned candidate; the next cut overwrites it with force-with-lease. The first cut (run 36095743795) had failed earlier when its candidate CI (all test legs green) queued the aggregate `ci` job past the 45-minute gate by about one minute.

## Probe results (live, user's ChatGPT OAuth)

| Proxy | Model | Request | Result |
|---|---|---|---|
| openai-oauth 1.0.2 (ima2's bundled proxy, :10531) | gpt-6-astra | Responses + `image_generation` tool, forced | image returned (1,015,309-byte SSE with `image_generation` item) |
| openai-oauth 1.0.2 | gpt-6-luna | same | 400: "The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account." |
| openai-oauth 1.0.2 | gpt-6-sol | same | same rejection |
| openai-oauth 2.0.0 (npx, :10592) | gpt-6-luna / gpt-6-sol / gpt-6-astra | forced `image_generation` tool | 400 "Tool choice 'image_generation' not found in 'tools' parameter" — 2.0.0 strips the image tool |
| openai-oauth 2.0.0 | gpt-6-luna | tool offered, not forced | text-only answer, no image item |

`openai-oauth` 2.0.0 lists gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-*, gpt-5.5 and gpt-image-2, and documents image work only through `/v1/images/generations` and `/v1/images/edits` with `gpt-image-2`.

## Consequence

With ima2's current OAuth design (a mainline model driving the Responses `image_generation` tool), only `gpt-6-astra` of the three produces images. Listing gpt-6-sol and gpt-6-luna would ship two models that fail on every request. Supporting them needs the OAuth lane to move to the 2.0 Images API, where the mainline model choice no longer applies. The user was asked to choose between shipping 3.21.0 unchanged, trimming to gpt-6-astra only, or the Images API migration.
