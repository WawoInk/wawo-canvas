# Decisions

## Current decisions

- Reuse the existing `start_time` and `end_time` query contract already supported by `model.Query` and `model.GenerationTaskQuery`.
- Keep the admin pages aligned with the existing Ant Design filter-card layout and use the installed `DatePicker.RangePicker`.
- Match the existing account-log date semantics: store a controlled Day.js range, convert the first date with `startOf("day")` and the last date with `endOf("day")`, then serialize both to ISO timestamps.
- Keep each page's date filter in its existing private hook. Two small page-local integrations are clearer than adding a shared component or global state.
- Give credit logs a dedicated frontend query type rather than adding date fields to `AdminUserQuery`, which is also used by users and enterprises.
- Expose the credit-log username as an administrator-only list projection using `LEFT JOIN users`, mirroring the existing administrator generation-task projection. Keep `model.CreditLog` and ordinary-user responses unchanged.
- Keep the current administrator keyword semantics. Username display is required, but username search is not part of this task.
- Preserve all changes that existed before this task. Only task-owned paths or task-owned hunks will be staged and committed.

## Confirmed TDD seams

The user confirmed both seams before tests were written:

1. `GET /api/admin/credit-logs` filters by date range and returns the matching user's `username`.
2. The two admin log pages send `start_time` and `end_time` after a range is selected and omit them after reset.

## Alternatives considered

- Adding a username column to `credit_logs` was rejected because usernames already belong to `users` and the admin list can use a join, matching the existing generation-task list pattern.
- Adding `Username` to persisted `model.CreditLog` was rejected because it would broaden ordinary-user and save-response contracts with a read-only projection field.
- Adding a new date-query contract was rejected because both backend list query types already support the required fields.
- Adding a shared date-filter abstraction was rejected because the existing hooks already own each page's filter state and the duplicated integration is short.
