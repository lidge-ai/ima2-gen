# WP1 failing-first baseline

Base: `4010154b6de1c751f5b574042e80d46038cfde3a`. Command: `node --experimental-test-module-mocks --import tsx --test tests/openai-gpt6x-lineup-contract.test.ts tests/openai-gpt6x-lineup-transport.test.ts tests/openai-gpt6x-lineup-replay.test.ts` (exit 1, expected). All 33 changed-behavior failures are assertion failures; no cancellations or setup failures.

| Test | Base result and assertion message |
|---|---|
| 1 oauth lineup | FAIL — Expected values to be strictly deep-equal: Actual: `[ 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra' ]`; expected: `[ 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra' ]` |
| 1 api lineup | FAIL — Expected values to be strictly deep-equal: Actual: `[ 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra' ]`; expected: `[ 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra' ]` |
| 2 alias terra | FAIL — Expected values to be strictly equal: Actual: `'terra'`; expected: `'gpt-6.1-terra'` |
| 2 alias sol | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-sol'`; expected: `'gpt-6.2-sol'` |
| 2 alias astra | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-astra'`; expected: `'gpt-6.2-astra'` |
| 3 oauth migration gpt-6-sol | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-sol'`; expected: `'gpt-6.2-sol'` |
| 3 oauth migration gpt-6-astra | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-astra'`; expected: `'gpt-6.2-astra'` |
| 3 oauth migration gpt-5.6-terra | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-luna'`; expected: `'gpt-6.1-terra'` |
| 3 oauth migration gpt-6.1-sol | FAIL — Expected values to be strictly equal: Actual: `undefined`; expected: `'gpt-6.2-sol'` |
| 4 api migration gpt-5.6-luna | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-luna'`; expected: `'gpt-6-luna'` |
| 4 api migration gpt-5.6-terra | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-terra'`; expected: `'gpt-6.1-terra'` |
| 4 api migration gpt-5.6-sol | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-sol'`; expected: `'gpt-6.2-sol'` |
| 4 api migration gpt-6-astra | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-astra'`; expected: `'gpt-6.2-astra'` |
| 4 api migration gpt-5.4-mini | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.4-mini'`; expected: `'gpt-6-luna'` |
| 4 saved API default migrates | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-luna'`; expected: `'gpt-6-luna'` |
| 5 API options migrate before effort coercion | FAIL — Expected values to be strictly deep-equal: Actual: `{ model: undefined, reasoningEffort: undefined }`; expected: `{ model: 'gpt-6.2-sol', reasoningEffort: 'low' }` |
| 5 API options migrate saved default | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-luna'`; expected: `'gpt-6-luna'` |
| 5 GPT-6.2 Sol effort floor | FAIL — Expected values to be strictly equal: Actual: `'none'`; expected: `'low'` |
| 7 CLI api/gpt-5.6-luna | FAIL — Expected values to be strictly deep-equal: Actual: `{ ok: false, code: 'MODEL_NOT_FOUND', message: 'api/gpt-5.6-luna is not available for image' }`; expected: `{ ok: true, lane: 'api', model: 'gpt-6-luna', transport: 'core' }` |
| 7 CLI oauth/sol | FAIL — Expected values to be strictly deep-equal: Actual: `{ ok: false, code: 'MODEL_NOT_FOUND', message: 'oauth/gpt-6-sol is not available for image' }`; expected: `{ ok: true, lane: 'oauth', model: 'gpt-6.2-sol', transport: 'core' }` |
| 8 selection api | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-terra'`; expected: `'gpt-6.1-terra'` |
| 8 selection oauth | FAIL — Expected values to be strictly equal: Actual: `'gpt-6-astra'`; expected: `'gpt-6.2-astra'` |
| 8 persisted selection | FAIL — Expected values to be strictly deep-equal: Actual: `{ provider: 'api', imageModel: 'gpt-5.6-luna' }`; expected: `{ provider: 'api', imageModel: 'gpt-6-luna' }` |
| 8 persisted provider memory and switching | FAIL — Expected values to be strictly deep-equal: Actual: `{ oauth: { kind: 'image', image: 'gpt-6-sol' }, api: { kind: 'image', image: 'gpt-5.6-sol' } }`; expected: `{ oauth: { kind: 'image', image: 'gpt-6.2-sol' }, api: { kind: 'image', image: 'gpt-6.2-sol' } }` |
| 9 prompt builder API lineup | FAIL — Expected values to be strictly deep-equal: Actual: `[ 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini' ]`; expected: `[ 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.2-sol', 'gpt-6.2-astra' ]` |
| 9 prompt builder API legacy | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.5'`; expected: `'gpt-6-luna'` |
| 5 replay sends migrated model and preserves history | FAIL — Expected values to be strictly equal: Actual: `'gpt-5.6-terra'`; expected: `'gpt-6.1-terra'` |
| 5 replay sends migrated model with coerced effort | FAIL — Expected values to be strictly deep-equal: Actual: `{ model: undefined, effort: undefined }`; expected: `{ model: 'gpt-6.2-sol', effort: 'low' }` |
| 5 OAuth upstream effort | FAIL — Expected values to be strictly equal: Actual: `'none'`; expected: `'low'` |
| 5 OAuth upstream lite header | FAIL — Expected values to be strictly equal: Actual: `undefined`; expected: `'true'` |
| 6 lite fallback gpt-6.1-terra | FAIL — Expected values to be strictly equal: Actual: `false`; expected: `true` |
| 6 lite fallback gpt-6.2-astra | FAIL — Expected values to be strictly equal: Actual: `false`; expected: `true` |
| 6 client version floor | FAIL — floor 0.157.0 must be >= 0.166.0 Actual: `false`; expected: `true` |

| Control test | Base result |
|---|---|
| api gpt-6-astra none | PASS |
| oauth gpt-6-luna none | PASS |
| api gpt-6-astra high | PASS |
| unknown model is rejected | PASS |
| other provider memory survives | PASS |

Totals: 38 tests, 33 expected assertion failures, 5 controls passed, 0 cancelled. The replay sidecar assertion passes before the outbound model assertion. The replay suite is a separate file to keep its isolated runtime independent from the OAuth transport session fixture.
