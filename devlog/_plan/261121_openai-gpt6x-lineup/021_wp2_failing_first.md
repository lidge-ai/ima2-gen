# wp2 failing-first evidence

Base: `cfcf7c28e13b6a9a1479497ae3ad7baf1fb8c5cf`.
Command: `node --experimental-test-module-mocks --import tsx --test tests/svg-output-contract.test.ts`
Exit 1: 17 inner tests, 15 passed, 2 failed, 0 cancelled. The resolver returned `SVG_REASONING_REQUIRES_MODEL` (400) instead of the default author and low effort; the route returned 400 instead of 200. The preexisting rejection test passed. No live API was called.
