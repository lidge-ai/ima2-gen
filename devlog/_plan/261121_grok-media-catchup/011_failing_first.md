# 011 Failing-first evidence

## S1 image (G1, R1-F1, R2-F2, 1.5k)

Base: 077765cf. `node --experimental-test-module-mocks --import tsx --test tests/grok-planner-adapter.test.ts`: 21 tests, 12 pass, 9 fail, exit 1. Failing (assertion failures at the outbound `/v1/images/*` body): retired `grok-imagine-image-quality` stayed on the retired slug with no quality for request quality none/high/medium/auto; `grok-imagine-image-pro` likewise; 2.0 edits sent no quality for none/low/high; `grok:1:1:1.5k` mapped to 1k. Control that passes on base: the base `grok-imagine-image` request carries no `quality` field. Fake fetch and the isolated CDN transport only; no live call.
