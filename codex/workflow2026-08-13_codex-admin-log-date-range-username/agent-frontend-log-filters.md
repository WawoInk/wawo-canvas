# Frontend Log Filters Findings

## Status

- Task: `frontend-log-filters`
- Mode: investigation and review only
- Status: completed
- Branch confirmed: `codex/admin-log-date-range-username`
- Files changed by this Subagent: this findings file only

## Exact Files And Symbols

### Administrator credit logs

- `web/src/pages/admin/credit-logs/index.tsx`
  - `AdminCreditLogsPage`
  - Current filter card is at lines 105-142.
  - It has a keyword `Input.Search`, reset button, and query button. A date `Form.Item` should be added in the same `Row`, before the action column.
  - The page currently consumes `logs`, `keyword`, pagination state, and filter actions from `useAdminCreditLogs`.
- `web/src/pages/admin/credit-logs/use-admin-credit-logs.ts`
  - `useAdminCreditLogs`
  - Current query key: `["admin", "credit-logs", token, keyword, page, pageSize]`.
  - Current request: `fetchAdminCreditLogs(token, { keyword, page, pageSize })`.
  - `updateFilters` and `resetFilters` are the correct ownership point for date-range state and resetting page 1.
- `web/src/services/api/admin.ts`
  - `AdminCreditLog`
  - `fetchAdminCreditLogs`
  - It currently reuses `AdminUserQuery`, which does not expose `start_time` or `end_time`.
  - Minimal API typing change: add a dedicated `AdminCreditLogQuery` with `keyword`, `type`, `start_time`, `end_time`, `page`, and `pageSize`, then use it in `fetchAdminCreditLogs`. Do not widen `AdminUserQuery`, because that would falsely advertise date filters on users and enterprises.

### Administrator usage logs

- `web/src/pages/admin/generation-tasks/index.tsx`
  - `AdminGenerationTasksPage`
  - Current filter card is at lines 179-248.
  - It already has user ID, task type, status, reset, and query controls. Add the date range in the same `Row`, before the action column.
- `web/src/pages/admin/generation-tasks/use-admin-generation-tasks.ts`
  - `useAdminGenerationTasks`
  - Current query key: `["admin", "generation-tasks", token, keyword, taskType, status, page, pageSize]`.
  - Current request already uses `fetchAdminGenerationTasks`, but omits dates.
  - `updateFilters` and `resetFilters` should own the range and page reset.
- `web/src/services/api/admin.ts`
  - `AdminGenerationTaskQuery`
  - `fetchAdminGenerationTasks`
  - The type already has `start_time?: string` and `end_time?: string`; no API type change is required for the first slice.

## Reusable Date-Range Pattern

The closest established implementation is `web/src/pages/account/account-logs.tsx`:

- `LogDateRange = [Dayjs, Dayjs] | null` at line 48.
- `AccountUsageLogs` at lines 179-268.
- `AccountCreditLogs` at lines 270-359.
- Controlled `DatePicker.RangePicker`.
- Start conversion: `range?.[0].startOf("day").toISOString()`.
- End conversion: `range?.[1].endOf("day").toISOString()`.
- Changing or clearing the range returns pagination to page 1.

Ant Design `RangePicker` in installed `antd@6.4.2` uses Dayjs values. Its public `onChange` receives the selected pair and receives `null` when the built-in clear control is used. The component is clearable by default.

### Translation reuse

Existing translations are:

- `account.logs.filters.dateFormat`
  - `zh-CN`: `YYYY-MM-DD`
  - `en-US`: `MM/DD/YYYY`
- `account.logs.filters.startDate`
  - `zh-CN`: `开始日期`
  - `en-US`: `Start date`
- `account.logs.filters.endDate`
  - `zh-CN`: `结束日期`
  - `en-US`: `End date`

Recommended minimal product-facing shape is to add equivalent admin-common keys rather than couple administrator pages to the account namespace:

```text
admin.common.filters.dateRange
admin.common.filters.dateFormat
admin.common.filters.startDate
admin.common.filters.endDate
```

Suggested text:

```text
zh-CN: 日期范围 / YYYY-MM-DD / 开始日期 / 结束日期
en-US: Date range / MM/DD/YYYY / Start date / End date
```

Both locale files already contain unrelated user changes. Add only these keys to the existing `admin.common.filters` object; do not replace or broadly reformat either file.

## Minimal State And Parameter Design

Use the same local hook state on both pages:

```ts
type LogDateRange = [Dayjs, Dayjs] | null;

const [dateRange, setDateRange] = useState<LogDateRange>(null);
const startTime = dateRange?.[0].startOf("day").toISOString();
const endTime = dateRange?.[1].endOf("day").toISOString();
```

For each hook:

1. Add `dateRange`, `startTime`, and `endTime` to the query key. Prefer the two derived strings in the key so cache identity matches the actual request contract.
2. Pass `start_time: startTime` and `end_time: endTime` to the API function. `compactApiParams` already removes `undefined`, so a cleared range omits both query parameters.
3. Extend `updateFilters` with `dateRange`.
4. Treat `next.dateRange !== undefined` as a filter change that sets `page = 1`. `null` is the explicit cleared value; `undefined` means unchanged.
5. Return `dateRange` and `filterByDateRange(value)` from the hook.
6. Include `dateRange: null` in `resetFilters`.

Page control:

```tsx
<Form.Item label={t("admin.common.filters.dateRange")}>
    <DatePicker.RangePicker
        value={dateRange}
        format={t("admin.common.filters.dateFormat")}
        placeholder={[t("admin.common.filters.startDate"), t("admin.common.filters.endDate")]}
        onChange={(value) => filterByDateRange(value as LogDateRange)}
    />
</Form.Item>
```

Keep this in each page rather than introducing a shared component or global hook. There are only two small usages, and both pages already own private filter hooks.

## First Red-Green Slice

Start with the usage-log page because `AdminGenerationTaskQuery` already supports both date parameters. This isolates the first failure to the missing page/hook wiring.

Recommended test file:

`web/test/admin-generation-task-date-filter.test.tsx`

Recommended test name:

`使用日志选择和清空日期范围会更新管理员查询参数`

### Public behavior under test

1. Register Happy DOM, set `IS_REACT_ACT_ENVIRONMENT`, call Bun's `setSystemTime(new Date("2026-08-13T04:00:00Z"))`, and explicitly switch i18n to `zh-CN`.
2. Mock `@/services/api/admin` before dynamically importing the page:
   - `fetchAdminGenerationTasks` records each query and resolves `{ items: [], total: 0 }`.
   - Supply harmless mocks for `fetchAdminGenerationTaskDetail`, `deleteAdminGenerationTask`, and `batchDeleteAdminGenerationTasks`, because the real hook imports them at runtime.
3. Use the real `useUserStore`, set an administrator token, and render the real `AdminGenerationTasksPage` inside:
   - `QueryClientProvider` with a fresh `QueryClient`
   - Ant Design `App`
4. Wait for the initial API call, then clear the recorded calls.
5. Click `input[placeholder="开始日期"]` to open the real picker.
6. Click the public calendar cells:
   - `td[title="2026-08-10"]`
   - `td[title="2026-08-12"]`
7. Wait until `fetchAdminGenerationTasks` receives:

```ts
{
    user_id: undefined,
    task_type: undefined,
    status: undefined,
    start_time: dayjs("2026-08-10").startOf("day").toISOString(),
    end_time: dayjs("2026-08-12").endOf("day").toISOString(),
    page: 1,
    pageSize: 10,
}
```

8. Clear recorded calls.
9. Click the public `.ant-picker-clear` control.
10. Wait until the next query has `page: 1` and both `start_time` and `end_time` are `undefined`.

Use Dayjs to build expected timestamps in the test rather than hard-coding UTC offsets. The application intentionally converts local calendar-day boundaries to ISO timestamps; for example, in the current `Asia/Shanghai` environment the expected values are `2026-08-09T16:00:00.000Z` and `2026-08-12T15:59:59.999Z`.

The date cell selectors were verified against the installed component: opening the start input exposes `td[title="YYYY-MM-DD"]`; selecting the two cells emits one completed range change; clicking `.ant-picker-clear` emits `null`.

### Why this is the first failing test

It observes only public page interaction and the API boundary. On the current code it fails because the page renders no date picker and the hook never sends date fields. It does not assert private state, query-key layout, or implementation helper calls.

### Green implementation for this slice

Change only:

- `web/src/pages/admin/generation-tasks/index.tsx`
- `web/src/pages/admin/generation-tasks/use-admin-generation-tasks.ts`
- the two locale files
- the new focused test

After this passes, apply the identical state/control/query-key/reset pattern to credit logs and add `AdminCreditLogQuery` in `web/src/services/api/admin.ts`. The second page may have a small companion assertion or be covered by extending the same test file, but it should not require a new abstraction.

## Focused Verification

Red/green command for the first slice:

```sh
cd /Users/eldenpdx/git-project/infinite-canvas/web
bun test test/admin-generation-task-date-filter.test.tsx --timeout 10000
```

Focused regression commands after applying the pattern to both pages:

```sh
cd /Users/eldenpdx/git-project/infinite-canvas/web
bun test test/admin-generation-task-date-filter.test.tsx test/admin-users.test.tsx test/account-logs.test.tsx --timeout 10000
```

No build or full-suite command is recommended for this Subagent contract; project instructions explicitly leave build and syntax checks to the user/main agent.

## Assumptions And Alternatives

- Assumption: selecting a date should immediately re-query, matching the existing account log pages and task type/status selects. The existing query button remains for the staged text input.
- Assumption: an inclusive local-calendar range is required, hence `startOf("day")` and `endOf("day")`.
- Rejected: storing already-formatted ISO strings in the page. Dayjs range state keeps the picker controlled and centralizes conversion in the query hook.
- Rejected: adding a shared date-filter component or global store. Two short page-private controls are smaller and match current admin architecture.
- Rejected: extending `AdminUserQuery` with dates. A dedicated credit-log query type is more accurate and avoids misleading unrelated callers.
- Rejected for the first slice: mocking Axios and asserting a serialized URL. Mocking the typed admin API boundary keeps the test focused on page-to-request-parameter behavior; `compactApiParams` and serialization are existing shared behavior.

## Uncovered Risks

- Happy DOM interaction with Ant Design overlays can be sensitive to leaked document nodes. The test should unmount the root, remove the container, clear the QueryClient, and restore the user store in `finally`.
- Freeze the test clock with Bun's verified `setSystemTime` API so the August 2026 cells are always in the initially opened panels. Restore it with `setSystemTime()` in cleanup.
- The two locale files are already dirty with unrelated edits. Only add narrow keys.
- The credit-log page also needs the backend username projection and table column, but that is outside this frontend-filter investigation.
- This investigation did not visually verify responsive wrapping after adding another filter column. Existing `Row`/`Col` layout should wrap, but the integrated implementation should receive a browser spot check.
- Refresh, keyword, type/status, pagination, edit, and delete behavior were inspected but not covered by the proposed single red-green test.

## Validation Performed

- Confirmed the requested task branch without changing Git state.
- Read both administrator pages, both private hooks, API query types/functions, request compaction, locale entries, and adjacent tests.
- Confirmed the installed versions: React 19, Ant Design 6.4.2, TanStack Query 5, Dayjs 1.11.20.
- Queried current Ant Design documentation through Context7 for `RangePicker` selection and clear behavior.
- Ran an in-memory Happy DOM probe against the installed `RangePicker`; selecting `2026-08-10` through `2026-08-12` emitted the expected pair, and the clear control emitted `null`.
- No business code, test, locale, backend, or Git changes were made.
