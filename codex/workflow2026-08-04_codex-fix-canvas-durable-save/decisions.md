# Decisions

## Confirmed Scope

Fix the Canvas data-loss window where generated video nodes can exist in page memory while both browser persistence and server synchronization are still non-durable.

This branch covers the frontend root fix only:

- durable, account-scoped Canvas Replica persistence;
- local-first ordering before backend synchronization;
- durable commit before a generated video result is exposed as successfully saved;
- recovery after immediate close/restart without depending on `beforeunload` delivery.

Generation API fields, database schema, and server-side reconstruction by `canvasProjectId` or output node ID are explicitly deferred to a separate hardening task.

## TDD Seams Confirmed By User

1. Canvas Store public actions and fresh hydration from account-scoped browser storage.
2. The boundary between durable local Replica persistence and backend Canvas synchronization.
3. The public Canvas operation that commits a generated video result.
4. Immediate close/restart recovery with a large project and an in-flight server request.

Tests may mock browser storage and HTTP because they are system boundaries. Tests must not mock Canvas Store internals or assert private call structure.

## Design Direction

- A Canvas project mutation must have an awaitable local durability result.
- Browser persistence writes must be serialized so an older snapshot cannot become the final durable value.
- Backend synchronization must not read or send a project state newer than the latest completed local durable write.
- If a server request is in flight during close, the latest accepted project must already be recoverable from the local dirty Replica.
- `beforeunload` and `keepalive` remain optional best-effort acceleration, not correctness mechanisms.
- Keep the implementation concrete and small. Reuse the existing Store, account-scoped storage, dirty/revision model, and project-serialized sync queue.

## Rejected As Insufficient

- Only removing the `syncRequests.has(project.id)` unload guard.
- Replacing `fetch(..., keepalive)` with `sendBeacon`.
- Relying on a full-project unload request, because large Canvas payloads can exceed browser keepalive limits.
- Fixing only first-party video generation while leaving the shared Replica durability boundary unchanged.
- Adding Generation Run project/node linkage in this branch.

## Initial Investigation Assumptions

- Browser storage and HTTP remain the only mocked system boundaries in new tests.
- Existing Canvas collaborators, queues, stores, and page operations will be exercised through public exports rather than mocked or inspected through call-count assertions.
- The smallest acceptable implementation may add one awaitable public Store operation and one serialization primitive around account-scoped persistence, provided existing synchronous mutation APIs retain their behavior.
- No correctness assertion will depend on `beforeunload`, `keepalive`, or a completed server response.
- The supplied `web/node_modules` symlink is execution-only workspace state and is excluded from the implementation commit.

## Implemented Decisions

- Serialize account storage operations by the captured scoped key. This keeps separate accounts independent and prevents a delayed older snapshot from winning.
- Expose `flush(name)` from account storage and `waitForLocalPersistence()` from the Canvas Store. The sync worker waits for this boundary, then re-reads the Store before sending.
- Make `updateProject` return `Promise<void>` while preserving existing callers that intentionally ignore the Promise.
- Retain a rejected durability Promise as the current account-key state. Backend retry cannot interpret a failed local write as an empty queue; a later real write replaces the failure and resumes sync.
- Use `commitCanvasVideoResult` for both first-party and compatibility video success. It reapplies the result to newer accepted nodes when another mutation lands during the durable write.
- Leave `beforeunload` and keepalive unchanged as best-effort only. No regression test or correctness path depends on them.

## Documentation Decision

- Updated the existing Canvas persistence entries in `.knowledge`, `CHANGELOG.md`, and `pending-test.mdx`.
- `docs/content/docs/progress/todo.mdx` was checked and did not require a change because no planned item was completed or added.
