# Acceptance

## Bootstrap Checks

- [x] Repository root resolved to `/Users/eldenpdx/git-project/infinite-canvas`.
- [x] `git status --short` was run before branch switching.
- [x] Pre-switch status was recorded as clean.
- [x] Local `main` was preferred over `origin/main`.
- [x] Task branch was created from the recorded local `main` commit.
- [x] Current branch is `codex/align-generation-workbenches`.
- [x] No extra worktree or subbranch was created.
- [x] Workflow directory and required planning files were created.
- [x] Prompt archive and bootstrap findings file were created.
- [x] No business implementation or real browser test was performed.

## Commands and Results

| Check | Result |
| --- | --- |
| `pwd && git status --short` before switch | Passed; repository resolved and status was clean |
| `git branch --list main` / `git branch --remotes --list origin/main` | Passed; both refs exist |
| `git rev-parse main` / `git rev-parse origin/main` | Passed; both resolve to `a13233e4649ed39f220b11b0c865a2e4997f581f` |
| `git switch -c codex/align-generation-workbenches main` | Passed |
| Post-init branch/status/path/placeholder checks | Passed after restoring the task branch; the prompt archive contains only the literal placeholder-syntax mention from the user instruction |

## Handoff Acceptance for Later Waves

- Every Subagent must archive its complete prompt and remove operational placeholders.
- Each Subagent must write only inside its assigned project-file boundary plus its own workflow artifacts.
- User-specified Skills must be routed to responsible Subagents before implementation.
- Generation, polling, storage, model configuration, log persistence, and credit accounting must be checked against existing canvas behavior and existing tests.
- Real browser testing remains explicitly unexecuted and user-owned.

## Residual Risk

- This file does not claim business behavior is implemented or verified; those claims belong to later Subagents.
- Exact source-file boundaries, test commands, provider behavior, and accounting invariants require repository investigation in `wave-1`.

## Final Acceptance

- [x] Image workbench submits and polls the same compatibility task contract used by Canvas image nodes.
- [x] Image success requires a materialized, current-user image `fileId`; metadata alone cannot forge success.
- [x] Image running and pending materialization states time out through shared terminal settlement and refund once.
- [x] Video workbench observes the platform task and consumes its materialized `fileId` without polling upstream in the browser.
- [x] Video cancellation uses the upstream task ID and backend cancellation refunds through shared idempotent settlement.
- [x] Canvas and both workbenches read the same effective system model configuration.
- [x] Generation logging failure stops the request before upstream work; terminal states are persisted and observable.
- [x] Successful/failed/cancelled/succeeded history statuses project consistently.
- [x] Image cancel control remains clickable while generation is running.
- [x] Tracked `server` build output was restored to the baseline.
- [x] No real browser test or dev server was run.

## Final Commands And Results

| Check | Result |
| --- | --- |
| Related image/video/API/Canvas Bun tests | Passed; 47 tests, 0 failures |
| `cd web && bunx tsc --noEmit --pretty false` | Passed |
| `go test ./service ./handler ./model ./config -count=1` | Passed |
| `go test ./... -count=1` | Passed across all Go packages |
| `git diff --check` | Passed |
| Base ancestor and branch checks | Passed |
| Prompt placeholder audit | Passed; matches are literal audit instructions, not unresolved operational values |

## Final Residual Risk

- Real-browser behavior for IndexedDB history, signed file URLs, account switching, and external resources through local port `7897` remains user-owned.
- Local direct/BYOK workbench mode intentionally keeps its existing direct provider behavior and zero-platform-billing semantics.
