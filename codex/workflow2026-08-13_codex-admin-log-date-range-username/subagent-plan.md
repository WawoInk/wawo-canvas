# Subagent Plan

## Workload assessment

This is a medium, cross-layer change:

- Backend: administrator credit-log projection and HTTP behavior test.
- Frontend: two admin pages, two query hooks, API types, and interaction tests.
- Documentation and selective staging are required because the worktree was already dirty.

The backend and frontend investigations are independent and have disjoint findings files, so two Subagents can run in parallel. Source implementation remains with the main agent until the TDD seams are confirmed, which avoids writing tests at an unconfirmed boundary and avoids source-file conflicts.

## Subagents

### `backend-log-contract`

- Bounded task: inspect the administrator credit-log list flow, identify the smallest username projection and date-range HTTP test shape.
- Expected outputs: exact files/symbols, recommended public test, likely SQL/GORM query, blast radius, focused verification command.
- Out of scope: editing source or tests, schema changes, frontend work, Git operations.
- Definition of done: findings identify a behavior-first failing test and minimal implementation path.
- Execution mode: investigation and review.
- Write scope: `codex/workflow2026-08-13_codex-admin-log-date-range-username/agent-backend-log-contract.md` only.
- Dependencies: none.

### `frontend-log-filters`

- Bounded task: inspect both admin log pages and hooks, identify the smallest aligned RangePicker state/query design and public interaction test shape.
- Expected outputs: exact files/symbols, existing reusable patterns/translations, recommended behavior-first test, focused verification command.
- Out of scope: editing source or tests, redesigning pages, backend work, Git operations.
- Definition of done: findings identify one vertical frontend test slice and minimal implementation path for both pages.
- Execution mode: investigation and review.
- Write scope: `codex/workflow2026-08-13_codex-admin-log-date-range-username/agent-frontend-log-filters.md` only.
- Dependencies: none.

## Parallel strategy

Both Subagents start together. They may read the same source but write only their unique findings file. Neither may modify implementation files, tests, global workflow documents, Git state, branches, or worktrees.
