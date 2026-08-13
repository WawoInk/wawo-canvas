# Acceptance

## Acceptance criteria

- Administrator credit-log queries can filter inclusively by `start_time` and `end_time`.
- Administrator usage-log queries can filter inclusively by `start_time` and `end_time`.
- Selecting a local calendar date range sends the start of the first day and end of the last day as timestamps.
- Resetting either page clears its date range and returns to page 1.
- Every administrator credit-log item exposes the current matching user's `username`.
- The credit-log table displays username in a dedicated column.
- Existing keyword, type/status, pagination, refresh, edit, and delete behavior remains intact.

## TDD seams

Confirmed by the user before tests were written:

1. Administrator credit-log HTTP list response and filters.
2. Administrator log-page filter interaction and resulting API query.

## Verification log

- The frontend investigation ran a temporary in-memory Happy DOM probe against the installed Ant Design RangePicker. Selecting `2026-08-10` through `2026-08-12` emitted a completed range, and the built-in clear control emitted `null`.
- Backend red:
  - `go test ./router -run '^TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP$' -count=1`
  - Failed as expected because returned `username` was empty while inclusive date filtering already returned exactly the two boundary records.
- Backend green:
  - The same command passed after the administrator-only username projection was added.
- Frontend usage-log red:
  - `bun test test/admin-log-date-filter.test.tsx --timeout 10000`
  - Failed as expected because the page had no date-range input.
- Frontend usage-log green:
  - The usage-log date selection and clearing test passed after wiring the RangePicker and query parameters.
- Frontend credit-log red:
  - The date test failed because the page had no date-range input.
  - The username test failed because the user ID rendered but the returned username did not.
- Frontend credit-log green:
  - `bun test test/admin-log-date-filter.test.tsx --timeout 10000`
  - Passed 3 tests: usage-log date selection/clearing, credit-log date selection/clearing, and credit-log username display.
- Focused backend regression:
  - `go test ./router -run '^(TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP|TestAdminAdjustsEnterpriseOwnerCreditsByDeltaAndRecordsLog|TestAccountCreditLogsFilterByDateRangeThroughHTTP|TestEnterpriseCreditLogsFilterByDateRangeThroughHTTP)$' -count=1`
  - Passed all selected tests.
- Focused frontend regression:
  - `bun test src/pages/admin/generation-tasks/generation-task-status.test.mjs --timeout 10000`
  - Passed.
- `git diff --check` passed for all task-owned implementation and test files.

## Uncovered items

- No manual signed-in browser spot check was run. The real Ant Design RangePicker and table were exercised through Happy DOM.
- No build or full test suite was run, following project instructions.
- Existing `web/test/admin-users.test.tsx` and `web/test/account-logs.test.tsx` fail their Chinese text assertions when the current persisted language is English. The new test no longer mutates global i18n state or mocks the admin API module, and its focused tests pass.

## Residual risks

- The worktree contains unrelated pre-existing changes, including translations and pending-test documentation. Task-owned hunks must be staged selectively.
- Credit-log usernames are current user values, not historical snapshots; renaming a user changes old rows' displayed username.
- Orphan credit logs remain visible through `LEFT JOIN` and display `-` for username.
