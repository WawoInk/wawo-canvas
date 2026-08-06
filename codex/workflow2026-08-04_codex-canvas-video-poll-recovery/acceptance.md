# Acceptance

## Confirmed TDD Seams

1. Canvas resume decision through the exported `canvasGenerationResume` helper.
2. First-party task polling through the exported polling API/helper used by `waitForGeneration`.
3. Authenticated HTTP lookup of a first-party Generation Run by `generationClientRequestId`.

## Required Behavior

- A video node with a materialized successful result is not resumable and is not polled on refresh.
- A non-success first-party video node with `generationTaskId` is resumable regardless of stale local `loading` or `error` status.
- A first-party video node with only `generationClientRequestId` can recover its existing task.
- Nineteen consecutive retryable query failures followed by success still materialize the current result.
- The twentieth consecutive retryable query failure pauses local observation without changing the backend task terminal state.
- A valid `queued` or `running` response resets the consecutive query-failure count.
- Permanent authorization/not-found errors are not retried twenty times.
- Backend `failed`, `cancelled`, and 30-minute timeout states remain authoritative and retain existing one-time refund behavior.
- Existing successful-video display behavior remains unchanged.

## Validation Commands

- `bun test src/pages/canvas/components/canvas-generation-resume.test.mjs`
- `bun test src/services/api/generations.test.mjs`
- `go test ./router -run '^TestGenerationHTTPSeam$' -count=1`
- `go test ./service -run '^(TestGenerationCompensationPollTimesOutWithStableError|TestCancelGenerationUsesProviderDecisionAndSettlesOnce|TestCreateGenerationRefundsFailedTaskOnce)$' -count=1`
- `git diff --check`

## Actual Results

- Canvas resume seam: 4 passed.
- Generation polling seam: 14 passed.
- Authenticated HTTP seam: passed, including current-user recovery and foreign-user `null`.
- Existing timeout/cancel/refund lifecycle checks: all passed.
- Diff whitespace check: passed.

## Uncovered Items

- No full frontend build or full repository test suite was run, per the task contract and repository instructions.
- No manual browser session was used to wait through 20 real five-second failures; the exported polling seam covers the same state transition with zero-delay test sleeps.

## Residual Risks

- A browser that cannot reach the backend for 20 consecutive queries intentionally requires refresh or Resume Observing to start a new local observation cycle.
- Legacy successful first-party nodes without a platform `fileId` remain resumable; current first-party success invariants always materialize a `fileId`.
