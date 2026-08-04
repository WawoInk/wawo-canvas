# Acceptance

## Confirmed Behavioral Criteria

1. A Canvas project mutation has an awaitable public durability boundary.
2. After that boundary succeeds, a fresh account-scoped hydration contains the exact latest nodes and dirty metadata.
3. With browser storage deliberately blocked, backend PUT does not send a newer project snapshot before that snapshot is locally durable.
4. Multiple rapid project updates preserve the newest snapshot and do not allow an older asynchronous write to win.
5. A generated video result is not treated as durably committed until the local Replica contains its `fileId`, successful status, and result metadata.
6. A project with at least 120 representative media nodes survives simulated immediate close/restart while a normal server PUT is in flight.
7. Recovery correctness does not require a successful unload keepalive request.
8. Existing retry, concurrent ACK/localVersion, 409 conflict, create-response recovery, deletion, and dirty rehydration tests remain green.
9. Account-scoped persistence remains isolated by user ID.

## TDD Execution

Each slice must follow:

1. Add one failing behavior test at a confirmed seam.
2. Run it and record the red result.
3. Add only the minimum implementation needed for green.
4. Run the focused test and relevant existing Canvas tests.
5. Continue to the next slice.

## Planned Focused Commands

```text
bun test test/canvas-sync.test.ts
bun test <new Canvas durability regression test>
```

Do not run the full build unless explicitly required by a discovered blocker. The project instructions assign build verification to the user.

## Actual Results

- Baseline `cd web && bun test test/canvas-sync.test.ts`: 8 passed, 0 failed.
- Slice 1 red `cd web && bun test test/canvas-durable-save.test.ts`: 0 passed, 1 failed; fresh hydration restored `较旧快照` instead of `最新快照`.
- Slice 1 green `cd web && bun test test/canvas-durable-save.test.ts`: 1 passed, 0 failed.
- Slice 1 regressions `cd web && bun test test/account-storage.test.ts test/canvas-sync.test.ts`: 14 passed, 0 failed.
- Slice 2 red `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'backend sync sends'`: 0 passed, 1 failed; PUT started before the blocked local Replica write completed.
- Slice 2 green `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'backend sync sends'`: 1 passed, 0 failed.
- Slice 2 regressions `cd web && bun test test/canvas-sync.test.ts test/account-storage.test.ts`: 14 passed, 0 failed.
- Slice 3 red `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'generated video result'`: 0 passed, 1 failed; no public durable generated-video result operation existed.
- Slice 3 green `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'generated video result'`: 1 passed, 0 failed.
- Slice 3 generation regressions `cd web && bun test src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs`: 9 passed, 0 failed.
- Large-canvas acceptance `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern '120-node'`: 1 passed, 0 failed.
- Slice 4 red `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'local durable write failed'`: 0 passed, 1 failed; backend retry sent the project after the failed local write was removed from the pending map.
- Slice 4 green `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'local durable write failed'`: 1 passed, 0 failed; later successful local mutation resumed backend sync.
- Slice 5 red `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'preserves a newer accepted'`: 0 passed, 1 failed; the operation returned `初始内容` instead of the newer accepted edit.
- Slice 5 green `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'preserves a newer accepted'`: 1 passed, 0 failed.
- Final `cd web && bun test test/canvas-durable-save.test.ts`: 6 passed, 0 failed.
- Final `cd web && bun test test/canvas-sync.test.ts`: 8 passed, 0 failed.
- Final `cd web && bun test test/account-storage.test.ts`: 6 passed, 0 failed.
- Final `cd web && bun test src/pages/canvas/stores/canvas-replica.test.mjs`: 3 passed, 0 failed.
- Final `cd web && bun test src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs`: 9 passed, 0 failed.
- Final `cd web && bun test src/pages/canvas/components/canvas-node-config.test.ts src/pages/canvas/components/canvas-overview.test.mjs src/pages/canvas/utils/canvas-image-edit-source.test.mjs`: 9 passed, 0 failed.
- Final focused total: 41 passed, 0 failed.
- A combined multi-file attempt produced 28 passes plus one loader error because the existing `canvas-sync.test.ts` global `mock.module("@/services/api/request")` omits exports later generation tests import. Running the same groups in separate Bun processes passed; this task did not change that pre-existing test isolation issue.
- Per project instruction, no build, deployment, or release command was run.

## Uncovered Items

- Server-side Generation Run reconstruction is deferred.
- Hard power loss before any browser API can complete remains a platform limit; the visible generated-success boundary must therefore wait for the local durability promise.
- No real-browser process-kill E2E was added; the permanent tests deterministically model browser storage and HTTP boundaries.
- `docs/content/docs/progress/todo.mdx` was checked and required no change.

## Residual Risks

- Existing Bun global module mocks prevent some otherwise passing test files from sharing one process; final verification uses isolated commands.
- Generic Canvas edits whose callers ignore the durable Promise can still be lost if the browser process terminates before the browser storage API completes. The generated-video success path addressed by this task explicitly awaits durability before publishing success.
