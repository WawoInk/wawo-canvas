# Decisions

## Confirmed Product Decisions

- Scope is Canvas first-party video Generation Runs only.
- A materialized successful video remains display-only and must not resume polling.
- A non-success video with `generationTaskId` must re-check the backend after refresh even if its local node status is `error`.
- If the create response was lost, `generationClientRequestId` is used to recover the existing task instead of creating a new Generation Run.
- Twenty consecutive retryable browser-to-backend query failures stop only the current local observation cycle. They do not mark the backend task terminal and do not trigger a refund.
- A valid backend response resets the consecutive query-failure count.
- The existing backend 30-minute Generation Run timeout remains authoritative.
- Credits are refunded only by the existing backend terminal transaction after authoritative `failed`, `cancelled`, or timeout state.

## Minimal Design

- Reuse the existing `generationClientRequestId`, `generationTaskId`, Generation Run repository lookup, and terminal refund lifecycle.
- Add one authenticated lookup API for the current user's first-party task by client request ID.
- Extend the existing Canvas resume decision and first-party polling helper rather than adding a new polling manager.
- Preserve the current successful-result materialization and video rendering path.
- Add no dependency and no database field.

## Implementation Decisions

- A first-party video is considered already materialized when the Canvas node is successful and has a platform `fileId`; this is the only resume guard, so a backend success whose file was not yet restored can still be rechecked.
- The existing polling helper counts valid task responses toward the 360-response observation window. Retryable browser query errors use a separate consecutive counter and therefore cannot shorten the backend-authoritative timeout window.
- `AbortError` and explicit 401/403/404 responses are permanent for the current observation cycle. Network errors, HTTP 200 business failures, 408, 425, 429, and 5xx responses use the 20-error budget.
- The client request lookup endpoint returns `data: null` for missing or foreign tasks. This avoids exposing task existence and lets the frontend treat a missing lookup as a permanent query result without adding a new error contract.
- Browser query failures never update the backend task. Only an authoritative terminal task response sets the Canvas `generationTaskStatus` to `failed` or `cancelled`.

## Out Of Scope

- Compatibility image polling and refunds.
- Local-channel task accounting.
- Compatibility/legacy video accounting changes.
- Changing the backend 30-minute timeout.
- Cancelling an upstream task because the browser cannot query the backend.
- Refactoring the large Canvas project page beyond the minimum needed for this behavior.
