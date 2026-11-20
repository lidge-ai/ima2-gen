# 011 Failing-first evidence

## S1 image (G1, R1-F1, R2-F2, 1.5k)

Base: 077765cf. `node --experimental-test-module-mocks --import tsx --test tests/grok-planner-adapter.test.ts`: 21 tests, 12 pass, 9 fail, exit 1. Failing (assertion failures at the outbound `/v1/images/*` body): retired `grok-imagine-image-quality` stayed on the retired slug with no quality for request quality none/high/medium/auto; `grok-imagine-image-pro` likewise; 2.0 edits sent no quality for none/low/high; `grok:1:1:1.5k` mapped to 1k. Control that passes on base: the base `grok-imagine-image` request carries no `quality` field. Fake fetch and the isolated CDN transport only; no live call.
## S2 video models (G2, G4, native 1.5 T2V)

Base: dd38a850. `node --experimental-test-module-mocks --import tsx --test tests/grok-video-lite.test.ts tests/grokVideoAdapter.test.ts tests/videoRoute.test.ts tests/video-reference-audio-contract.test.ts`: exit 1. Failing as intended: Lite is not a registered video model and has no local reference/voice rule; 1080p is refused for 1.5 and Lite text-to-video without the canvas option; a 1.5 start 400 is resubmitted on grok-imagine-video (two starts, done event, mp4 saved); 1.5 prompt-only 1080p sends a white canvas `image` and a technical-note prompt (adapter and route); the adapter source still contains the base-model retry. The replaced tests previously pinned the canvas shim and the fallback metadata (plan R1-F6 names them). Fake fetch and loopback fixtures only.
