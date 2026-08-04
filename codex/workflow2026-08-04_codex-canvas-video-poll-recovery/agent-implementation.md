# Agent Implementation

## Investigation

- Canvas restore only resumed nodes whose local status was `loading` and whose metadata already contained a task ID.
- `generationClientRequestId` was persisted before first-party submission, but no frontend or HTTP lookup used it after a lost create response.
- `pollGenerationTask` propagated the first browser query error, and the project page converted that error into local `generationTaskStatus: failed`.
- Backend task timeout, terminal compare-and-set, and refund transaction were already correct and required no changes.

## TDD Slices

1. Added a failing Canvas resume test for a materialized successful video, then guarded successful `fileId`-backed nodes from resume.
2. Added a failing resume test for a first-party video with only `generationClientRequestId`, then made that identity resumable even from local `error`.
3. Added a failing polling test with 19 errors, a valid running response, another 19 errors, and success; then added the separate consecutive-error counter.
4. Added a failing test for the twentieth consecutive error, then added `GenerationPollingPausedError`.
5. Added failing retry classification coverage, including immediate `AbortError`, then wired the predicate into `waitForGeneration`.
6. Added a failing authenticated HTTP lookup assertion, then reused `GetGenerationTaskByClientRequestID` through service, handler, and router.

## Final Behavior

- Successful first-party videos with a platform `fileId` hydrate and display without querying generation status.
- Every other first-party video with a task ID or client request ID rechecks the backend after refresh, regardless of stale local loading/error state.
- The first successful client request lookup stores the recovered task ID back into Canvas metadata.
- Twenty consecutive retryable browser query errors pause only local observation and keep recovery identity; authoritative task failures and cancellations still come only from backend task responses.
- The existing 30-minute backend timeout and one-time refund transaction remain unchanged and passed focused regression tests.
