# Progress

## Workflow

- Branch: `codex/fix-canvas-durable-save`
- Base reference: local `main`
- Base commit: `1319459c7dc960efeac65958c359fcdee38753c1`
- Worktree: `/Users/eldenpdx/git-project/infinite-canvas-worktrees/fix-canvas-durable-save`
- Workflow directory: `codex/workflow2026-08-04_codex-fix-canvas-durable-save`

## Bounded Task

Implement the confirmed frontend Canvas durability fix with TDD:

1. lock in the immediate-close video-node loss as a failing test;
2. make Canvas Replica persistence serialized and awaitable;
3. order backend sync after local durability;
4. ensure generated video success uses the durable commit path;
5. retain current revision, dirty, retry, account-boundary, and hydration behavior.

## Expected Outputs

- Focused permanent regression tests at the confirmed seams.
- Minimal frontend implementation.
- Updated Canvas/progress documentation only when actual behavior changes require it.
- One implementation commit containing code, tests, and workflow documentation.

## Out Of Scope

- Generation API contract changes.
- Database/model/repository changes.
- Server-side reconstruction of missing output nodes.
- UI redesign or unrelated Canvas refactoring.
- Build, production deployment, branch merge, remote push, or release work.

## Current Status

`completed`

## Changed Files

- `.knowledge/business-flows.md`
- `.knowledge/canvas.md`
- `.knowledge/generation.md`
- `CHANGELOG.md`
- `docs/content/docs/progress/pending-test.mdx`
- `web/src/lib/account-storage.ts`
- `web/src/pages/canvas/project/index.tsx`
- `web/src/pages/canvas/stores/canvas-sync.ts`
- `web/src/pages/canvas/stores/canvas-video-result.ts`
- `web/src/pages/canvas/stores/use-canvas-store.ts`
- `web/test/canvas-durable-save.test.ts`
- `web/test/canvas-sync.test.ts`
- `codex/workflow2026-08-04_codex-fix-canvas-durable-save/acceptance.md`
- `codex/workflow2026-08-04_codex-fix-canvas-durable-save/agent-implementation.md`
- `codex/workflow2026-08-04_codex-fix-canvas-durable-save/progress.md`
- `codex/workflow2026-08-04_codex-fix-canvas-durable-save/decisions.md`
- `codex/workflow2026-08-04_codex-fix-canvas-durable-save/subagent-prompt.md`

## Blockers

None.

## Next Step

Hand off the local task commit to the main agent.

## Confirmed Test Seams

1. `useCanvasStore` public project mutations followed by fresh account-scoped hydration.
2. Durable local Canvas Project Replica commit before backend Canvas PUT.
3. The public operation used by the Canvas page to commit a generated-video result.
4. Large-project recovery after simulated close/restart while a normal PUT remains in flight.

## Tooling Notes

- The task uses the `tdd` and `diagnosing-bugs` skills.
- Codegraph is unavailable in this worktree because no `.codegraph/` index exists; repository exploration therefore uses `rg` and focused file reads.
- Context7 selected official Zustand documentation (`/pmndrs/zustand`) for async persist behavior.
- `web/node_modules` was a test-only symlink supplied by the main agent. It was used only for Bun tests and removed before staging.

## TDD Log

### Slice 1: newest public mutation survives fresh hydration

- Red command: `cd web && bun test test/canvas-durable-save.test.ts`
- Red result: `0 pass, 1 fail`.
- Exact symptom: expected the hydrated title `最新快照`, received `较旧快照` after the older blocked storage write completed last.
- Minimal green target: serialize writes by account-scoped storage key so an older asynchronous snapshot cannot become the final stored value.
- Green command: `cd web && bun test test/canvas-durable-save.test.ts`
- Green result: `1 passed, 0 failed`.
- Focused regression command: `cd web && bun test test/account-storage.test.ts test/canvas-sync.test.ts`
- Focused regression result: `14 passed, 0 failed`.

### Slice 2: backend sync consumes only durable local state

- Red command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'backend sync sends'`
- Red result: `0 passed, 1 failed`.
- Exact symptom: while the browser storage write remained blocked, the Canvas PUT adapter had already started.
- Minimal green target: wait for the account-scoped Canvas storage queue to drain before the sync worker re-reads and sends the project.
- Green command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'backend sync sends'`
- Green result: `1 passed, 0 failed`.
- Focused regression command: `cd web && bun test test/canvas-sync.test.ts test/account-storage.test.ts`
- Focused regression result: `14 passed, 0 failed`.

### Slice 3: generated-video success uses a durable public operation

- Red command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'generated video result'`
- Red result: `0 passed, 1 failed`.
- Exact symptom: the expected public module `canvas-video-result` did not exist, so the Canvas page had no explicit durable result operation to call.
- Minimal green target: add one operation that materializes the video node, awaits `updateProject`, and returns the committed nodes; call it from both video success paths.
- Green command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'generated video result'`
- Green result: `1 passed, 0 failed`.
- Related generation regression command: `cd web && bun test src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs`
- Related generation regression result: `9 passed, 0 failed`.

### Slice 4: failed local durability cannot be bypassed by retry

- Red command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'local durable write failed'`
- Red result: `0 passed, 1 failed`.
- Exact symptom: after the local write rejected, the 500ms backend retry observed an empty write queue and started PUT.
- Minimal green target: retain the rejected account-key promise until a later storage write replaces it and succeeds.
- Green command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'local durable write failed'`
- Green result: `1 passed, 0 failed`; a later successful public mutation also resumed PUT.

### Slice 5: generated-video commit preserves newer accepted edits

- Red command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'preserves a newer accepted'`
- Red result: `0 passed, 1 failed`.
- Exact symptom: a text edit accepted while the video storage write was blocked was replaced by the older node list when the video commit completed.
- Minimal green target: after each durable write, compare the Store's current nodes reference and reapply the video result to any newer accepted node list before publishing success.
- Green command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern 'preserves a newer accepted'`
- Green result: `1 passed, 0 failed`.

### End-to-end acceptance scenario

- Command: `cd web && bun test test/canvas-durable-save.test.ts --test-name-pattern '120-node'`
- Result: `1 passed, 0 failed`.
- Covered behavior: 120 media nodes, blocked local write, ordinary PUT in flight, simulated close, fresh same-account hydration, dirty recovery, and no unload dependency.

## Final Verification

- `cd web && bun test test/canvas-durable-save.test.ts`: 6 passed.
- `cd web && bun test test/canvas-sync.test.ts`: 8 passed.
- `cd web && bun test test/account-storage.test.ts`: 6 passed.
- `cd web && bun test src/pages/canvas/stores/canvas-replica.test.mjs`: 3 passed.
- `cd web && bun test src/pages/canvas/components/canvas-node-generation.test.mjs src/pages/canvas/components/canvas-generation-resume.test.mjs`: 9 passed.
- `cd web && bun test src/pages/canvas/components/canvas-node-config.test.ts src/pages/canvas/components/canvas-overview.test.mjs src/pages/canvas/utils/canvas-image-edit-source.test.mjs`: 9 passed.
- Total: 41 passed, 0 failed in the final focused commands.
