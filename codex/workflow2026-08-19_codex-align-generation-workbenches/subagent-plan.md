# Subagent Plan

## Task Assessment

This is a cross-surface, medium-to-large change. The work spans canvas node behavior, two generation workbenches, shared model configuration, asynchronous polling, storage, persisted logs, credit accounting, and focused regression checks. The main risks are duplicated provider behavior, inconsistent terminal-state handling, non-idempotent accounting, and overlapping edits in shared service/API files.

## Roles and Ownership

### `generation-contract-investigator`

- Mode: read-only investigation
- Wave/group: `wave-1` / `investigations`
- Task: map existing canvas image/video node generation, polling, storage, error, log, and credit paths; identify canonical entry points and tests.
- Output: findings file with source map, behavior matrix, invariants, and proposed implementation boundaries.
- Project write scope: none; workflow prompt and findings files only.
- Dependencies: none; can start immediately.
- Skills: none beyond project instructions.

### `image-workbench-aligner`

- Mode: write implementation
- Wave/group: `wave-2` / `workbenches`
- Task: align image-generation workbench with the canonical canvas image-node behavior.
- Output: image workbench generation/polling/storage changes and focused tests.
- Project write scope: exact image-workbench files and their directly owned tests, to be confirmed by `wave-1`; do not edit shared model/log/credit files.
- Dependencies: `generation-contract-investigator` findings.
- Skills: `ponytail` full and `tdd`; read both before work.

### `video-workbench-aligner`

- Mode: write implementation
- Wave/group: `wave-2` / `workbenches`
- Task: align video-creation workbench with the canonical canvas video-node behavior.
- Output: video workbench generation/polling/storage changes and focused tests.
- Project write scope: exact video-workbench files and their directly owned tests, to be confirmed by `wave-1`; do not edit shared model/log/credit files.
- Dependencies: `generation-contract-investigator` findings.
- Skills: `ponytail` full and `tdd`; read both before work.

### `model-config-accounting-owner`

- Mode: write implementation
- Wave/group: `wave-2` / `shared-contracts`
- Task: make system-settings model configuration the single shared source and enforce persisted logs plus credit accounting across generation paths.
- Output: shared configuration/log/accounting changes and focused tests.
- Project write scope: system-settings/configuration, logging, credit/accounting, and shared service/API files identified by `wave-1`; do not modify workbench-private UI files.
- Dependencies: `generation-contract-investigator` findings; must coordinate by findings files rather than simultaneous edits to workbench files.
- Skills: `ponytail` full and `tdd`; read both before work.

### `focused-verifier`

- Mode: read-only verification
- Wave/group: `wave-3` / `verification`
- Task: independently inspect changed behavior and run focused non-browser checks for image/video contracts, model configuration, logs, credits, and regression risk.
- Output: verification findings, commands, results, and uncovered risks.
- Project write scope: none; isolated temporary outputs only, plus prompt/findings files.
- Dependencies: relevant `wave-2` work complete.
- Skills: `tdd` if test interpretation requires it; no `ponytail` needed unless assigned by coordinator.

### `integration-closer`

- Mode: serial integration, final verification, documentation, and commit
- Wave/group: `wave-4` / `integration`
- Task: read all findings, inspect the task-branch diff, resolve ownership issues, run permitted focused checks, update workflow docs, check placeholders/base/branch/worktree constraints, and commit the completed task branch.
- Output: integrated branch, final workflow documentation, acceptance report, and one task-branch commit.
- Project write scope: all task-appropriate files after reviewing ownership; workflow documents; no unrelated changes.
- Dependencies: all required implementation and verification roles.
- Skills: `ponytail` full and `tdd`; read both before integration.
- Commit permission: task-branch commit only; no push/merge/switch/delete.

## Waves and Dependency Order

1. `wave-0`: bootstrap/planner completed. Branch and workflow documents initialized.
2. `wave-1`: `generation-contract-investigator` runs alone because implementation boundaries depend on its source map.
3. `wave-2`: `image-workbench-aligner` and `video-workbench-aligner` run in parallel within `workbenches`; `model-config-accounting-owner` runs in parallel within `shared-contracts` only after the investigator confirms file ownership does not overlap.
4. `wave-3`: `focused-verifier` starts after the affected implementation unit(s) finish; additional narrowly scoped verifiers may be added if findings expose independent risk.
5. `wave-4`: `integration-closer` runs serially after all required agents complete or are explicitly blocked.

## Parallel Strategy

- Read-only investigation is isolated from all writes.
- Image and video workbench edits are parallel only if their file boundaries do not overlap.
- Shared configuration/log/accounting edits are parallel with workbench edits only when the investigator confirms no shared-file collision; otherwise move the shared role to a later wave.
- No agent may run a real browser test, start a competing server, or write outside its declared scope.

## Skill Routing

| Skill | Responsible Subagents | Read timing | Scope |
| --- | --- | --- | --- |
| `subagents-workflow` | bootstrap/planner (this role) and orchestration context | Before initialization | Workflow rules, branch/doc/dispatch constraints |
| `ponytail` full | image-workbench-aligner, video-workbench-aligner, model-config-accounting-owner, integration-closer | At each agent start, before project work | Keep implementation minimal and avoid speculative abstraction |
| `tdd` | image-workbench-aligner, video-workbench-aligner, model-config-accounting-owner, integration-closer; focused-verifier as needed | Before implementation/verification | Focused regression tests and red-green-refactor discipline |
| `subagents-workflow` | All later Subagents | Before each later agent starts | Prompt archive, scope, findings, and handoff protocol |

The main orchestration window does not read or execute `ponytail` or `tdd`; those Skills are routed to the responsible later Subagents.

## Shared Resource Constraints

- One current workspace and one task branch only.
- No extra worktrees or subbranches.
- No concurrent writes to shared config, logging, accounting, lockfiles, generated artifacts, or workflow summary files.
- No real browser testing.
- External resource access, when needed by later agents, must use the user-specified local port `7897`.

## Actual Execution

- `wave-0`: bootstrap/planner completed branch and workflow initialization.
- `wave-1`: image, cross-cutting, and test-seam investigations established the compatibility and accounting contracts.
- `wave-2`: shared backend lifecycle plus image/video workbench implementations completed serially or with non-overlapping ownership.
- `wave-3`: frontend/backend/config-log-credit verifiers found and drove fixes for TypeScript narrowing, image cancellation, pending timeout refund, materialized file ownership, and video cancellation identity.
- `wave-4`: the sole integration/closer reviewed all findings, restored generated artifacts, fixed the remaining video cancel ID defect, ran final non-browser validation, updated documentation, and committed the task branch.
- No task-owned extra worktree or subbranch was created. Existing unrelated worktrees were observed but not modified.
