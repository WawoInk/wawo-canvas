# Backend Log Contract Investigation

## Status

- Task slug: `backend-log-contract`
- Execution mode: investigation and review only
- Status: completed
- Confirmed branch before investigation: `codex/admin-log-date-range-username`
- Files changed by this Subagent: only this findings file
- Business code, tests, database schema, frontend files, and Git state were not modified

## Executive Finding

The administrator credit-log date contract already works end to end:

```text
GET /api/admin/credit-logs
  -> handler.parseQuery(start_time, end_time)
  -> model.Query.StartTime / EndTime
  -> repository.ListCreditLogs
  -> created_at::timestamptz >= start
     created_at::timestamptz <= end
```

No new backend date-filter implementation is needed. The first red-green slice
should add one administrator HTTP integration test that locks the existing
inclusive date behavior and fails because list items do not yet expose
`username`. The minimum green implementation is one `LEFT JOIN users` query
projection plus an administrator-only response DTO. It does not require a
database column, migration, handler change, date parser, or ordinary-user API
change.

## Current HTTP-to-Repository Chain

| Layer | File and symbol | Current behavior |
| --- | --- | --- |
| Route/auth | `router/router.go:182`, `router/router.go:208`, `router.New` | Registers `GET /api/admin/credit-logs` under `middleware.AdminAuth`. |
| Handler | `handler/auth.go:213`, `handler.AdminCreditLogs` | Calls `service.ListCreditLogs(parseQuery(r))` and returns the standard `{code,data,msg}` envelope. |
| Query parser | `handler/response.go:53`, `handler.parseQuery` | Reads `keyword`, `type`, `start_time`, `end_time`, `page`, and `pageSize`. |
| Query model | `model/query.go:6`, `model.Query` | Already contains `StartTime` and `EndTime`; `Normalize` supplies pagination defaults. |
| Service | `service/auth.go:499`, `service.ListCreditLogs` | Thin pass-through to the repository and builds `model.CreditLogList`. |
| Repository | `repository/user.go:229`, `repository.ListCreditLogs` | Applies keyword/type filters and inclusive `>= start_time`, `<= end_time` PostgreSQL `timestamptz` comparisons before count and pagination. |
| Persisted model | `model/user.go:106`, `model.CreditLog` | Contains `UserID`, but no username projection. |

Separate user behavior remains on:

- `handler.UserCreditLogs` at `handler/auth.go:223`
- `service.ListUserCreditLogs` at `service/auth.go:508`
- `repository.ListCreditLogsByUserID` at `repository/user.go:259`

That path should remain unchanged.

## Date Range Conclusion

The existing backend contract is already the required minimum:

```go
if q.StartTime != "" {
    tx = tx.Where("created_at::timestamptz >= ?::timestamptz", q.StartTime)
}
if q.EndTime != "" {
    tx = tx.Where("created_at::timestamptz <= ?::timestamptz", q.EndTime)
}
```

Properties already provided:

- Query keys are the existing snake-case `start_time` and `end_time`.
- Either boundary may be omitted independently.
- Both supplied boundaries are inclusive.
- Offset-bearing stored strings and UTC query strings compare as instants
  because both sides are cast to PostgreSQL `timestamptz`.
- Count and page rows share the same filtered GORM statement.

Existing public HTTP coverage proves the same contract for sibling endpoints:

- `router/account_integration_test.go:176`,
  `TestAccountCreditLogsFilterByDateRangeThroughHTTP`
- `router/enterprise_integration_test.go:680`,
  `TestEnterpriseCreditLogsFilterByDateRangeThroughHTTP`

The missing coverage is specifically the administrator endpoint.

## Recommended First Red Test

### Seam

Use only the public administrator HTTP contract for target-user creation,
credit-log creation, and observation:

1. Bootstrap one administrator with `service.SaveUser`; there is no public
   endpoint that can create the first administrator, and this is the existing
   router-test convention.
2. Log in through `POST /api/admin/login`.
3. Create the target user through `POST /api/admin/users`.
4. Create four logs through `POST /api/admin/credit-logs`: immediately before
   the range, exactly at the start, exactly at the end, and immediately after.
5. List through `GET /api/admin/credit-logs` with `start_time`, `end_time`,
   target `userId` as the existing keyword filter, and pagination.
6. Assert that only the two boundary records are returned and both expose the
   target user's current `username`.

The test does not query the database, call the list service/repository, inspect
generated SQL, or import the production projection DTO.

### Recommended location and name

- New file: `router/admin_credit_logs_integration_test.go`
- Test: `TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP`

### Ready-to-add test

```go
package router_test

import (
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/basketikun/infinite-canvas/config"
    "github.com/basketikun/infinite-canvas/model"
    "github.com/basketikun/infinite-canvas/router"
    "github.com/basketikun/infinite-canvas/service"
    "github.com/google/uuid"
)

type adminCreditLogHTTPItem struct {
    model.CreditLog
    Username string `json:"username"`
}

type adminCreditLogHTTPList struct {
    Items []adminCreditLogHTTPItem `json:"items"`
    Total int                      `json:"total"`
}

func TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP(t *testing.T) {
    previousJWTSecret := config.Cfg.JWTSecret
    config.Cfg.JWTSecret = "admin-credit-log-contract-test-secret"
    t.Cleanup(func() { config.Cfg.JWTSecret = previousJWTSecret })

    adminUsername := "admin-credit-log-contract-" + uuid.NewString()
    if _, err := service.SaveUser(
        model.User{Username: adminUsername, Role: model.UserRoleAdmin},
        "admin-password",
    ); err != nil {
        t.Fatalf("create admin: %v", err)
    }

    server := httptest.NewServer(router.New())
    defer server.Close()

    admin := doJSON[model.AuthSession](
        t,
        http.MethodPost,
        server.URL+"/api/admin/login",
        "",
        map[string]string{"username": adminUsername, "password": "admin-password"},
    )
    if admin.Code != 0 || admin.Data.Token == "" {
        t.Fatalf("admin login = %#v", admin)
    }

    targetUsername := "admin-credit-log-user-" + uuid.NewString()
    target := doJSON[model.User](
        t,
        http.MethodPost,
        server.URL+"/api/admin/users",
        admin.Data.Token,
        map[string]string{"username": targetUsername, "password": "user-password"},
    )
    if target.Code != 0 || target.Data.ID == "" {
        t.Fatalf("create target user = %#v", target)
    }

    atStartID := "admin-credit-at-start-" + uuid.NewString()
    atEndID := "admin-credit-at-end-" + uuid.NewString()
    fixtures := []model.CreditLog{
        {
            ID: "admin-credit-before-" + uuid.NewString(), UserID: target.Data.ID,
            Type: model.CreditLogTypeAdminAdjust, Amount: model.NewDecimal(1),
            Balance: model.NewDecimal(1), CreatedAt: "2026-07-01T23:59:59.999+08:00",
        },
        {
            ID: atStartID, UserID: target.Data.ID,
            Type: model.CreditLogTypeAdminAdjust, Amount: model.NewDecimal(1),
            Balance: model.NewDecimal(2), CreatedAt: "2026-07-02T00:00:00+08:00",
        },
        {
            ID: atEndID, UserID: target.Data.ID,
            Type: model.CreditLogTypeAdminAdjust, Amount: model.NewDecimal(1),
            Balance: model.NewDecimal(3), CreatedAt: "2026-07-02T23:59:59.999+08:00",
        },
        {
            ID: "admin-credit-after-" + uuid.NewString(), UserID: target.Data.ID,
            Type: model.CreditLogTypeAdminAdjust, Amount: model.NewDecimal(1),
            Balance: model.NewDecimal(4), CreatedAt: "2026-07-03T00:00:00+08:00",
        },
    }
    for _, fixture := range fixtures {
        created := doJSON[model.CreditLog](
            t,
            http.MethodPost,
            server.URL+"/api/admin/credit-logs",
            admin.Data.Token,
            fixture,
        )
        if created.Code != 0 {
            t.Fatalf("create credit log = %#v", created)
        }
    }

    logs := doJSON[adminCreditLogHTTPList](
        t,
        http.MethodGet,
        server.URL+"/api/admin/credit-logs?keyword="+target.Data.ID+
            "&start_time=2026-07-01T16:00:00.000Z"+
            "&end_time=2026-07-02T15:59:59.999Z&page=1&pageSize=20",
        admin.Data.Token,
        nil,
    )
    if logs.Code != 0 || logs.Data.Total != 2 || len(logs.Data.Items) != 2 {
        t.Fatalf("date filtered admin credit logs = %#v", logs)
    }

    expected := map[string]bool{atStartID: true, atEndID: true}
    for _, item := range logs.Data.Items {
        if !expected[item.ID] {
            t.Fatalf("out-of-range credit log returned = %#v", item)
        }
        if item.Username != targetUsername {
            t.Fatalf("credit log username = %q, want %q", item.Username, targetUsername)
        }
        delete(expected, item.ID)
    }
    if len(expected) != 0 {
        t.Fatalf("inclusive boundary logs missing = %#v", expected)
    }
}
```

### Expected red and green

- Before production changes, the date/count assertions should pass.
- The test should fail with `item.Username == ""`, because the current
  administrator list serializes plain `model.CreditLog`.
- After the join projection below, the same test should pass without changing
  its setup or assertions.

This is one vertical slice: one public seam, one failing test, one query change.

## Minimum Green Implementation

### 1. Add an administrator-only repository projection

In `repository/user.go`, keep persisted `model.CreditLog` unchanged:

```go
type AdminCreditLogWithUser struct {
    model.CreditLog
    Username string `json:"username"`
}
```

Do not add `Username` to `model.CreditLog`. That would broaden
`GET /api/v1/credit-logs` and `POST /api/admin/credit-logs` with an unrelated
empty field, and would mix a list projection into the persisted entity.

### 2. Change only the administrator list query

Keep the existing function name to minimize call-site churn, but return the
administrator projection:

```go
func ListCreditLogs(q model.Query) ([]AdminCreditLogWithUser, int64, error) {
    db, err := DB()
    if err != nil {
        return nil, 0, err
    }
    q.Normalize()
    tx := db.Table("credit_logs AS log").
        Joins("LEFT JOIN users AS account ON account.id = log.user_id")
    if keyword := strings.TrimSpace(q.Keyword); keyword != "" {
        like := "%" + keyword + "%"
        tx = tx.Where(
            "log.user_id LIKE ? OR log.type LIKE ? OR log.remark LIKE ? OR log.related_id LIKE ?",
            like, like, like, like,
        )
    }
    if q.Type != "" {
        tx = tx.Where("log.type = ?", q.Type)
    }
    if q.StartTime != "" {
        tx = tx.Where("log.created_at::timestamptz >= ?::timestamptz", q.StartTime)
    }
    if q.EndTime != "" {
        tx = tx.Where("log.created_at::timestamptz <= ?::timestamptz", q.EndTime)
    }
    var total int64
    if err := tx.Count(&total).Error; err != nil {
        return nil, 0, err
    }
    var logs []AdminCreditLogWithUser
    err = tx.
        Select("log.*, account.username AS username").
        Order("log.created_at DESC").
        Offset(q.Offset()).
        Limit(q.PageSize).
        Scan(&logs).Error
    return logs, total, err
}
```

Important details:

- Qualify `created_at` after adding the join; both `credit_logs` and `users`
  have that column, so the old unqualified date/order expressions would become
  ambiguous in PostgreSQL.
- `LEFT JOIN` preserves a historical or manually created log if its user row no
  longer exists. Such a row returns an empty username instead of disappearing.
- Keep the current keyword semantics. Searching by username is not required by
  this slice and should not be silently added.
- Apply `Select` only for the row scan, after `Count`.
- `Scan` is the established project pattern for a base record plus joined
  projection; see `repository.ListGenerationTasksWithUsername`.

The GORM official documentation retrieved through Context7 (`/websites/gorm_io`)
confirms the `Table` + `Select` + `Joins` + `Scan` shape for projecting joined
columns into a result struct.

### 3. Return an administrator-only list from the service

In `service/auth.go`, mirror the existing administrator generation-task list
pattern:

```go
type AdminCreditLogList struct {
    Items []repository.AdminCreditLogWithUser `json:"items"`
    Total int                                 `json:"total"`
}

func ListCreditLogs(q model.Query) (AdminCreditLogList, error) {
    logs, total, err := repository.ListCreditLogs(q)
    if err != nil {
        return AdminCreditLogList{}, err
    }
    return AdminCreditLogList{Items: logs, Total: int(total)}, nil
}
```

`handler.AdminCreditLogs` does not need to change because it only forwards the
service result to `OK`.

## Project Precedent

The closest existing implementation is:

- `repository/generation_task.go:226`,
  `repository.AdminGenerationTaskWithUser`
- `repository/generation_task.go:233`,
  `repository.ListGenerationTasksWithUsername`
- `service/generation_service.go:99`,
  `service.AdminGenerationTaskListWithUser`

It uses an administrator-only embedded DTO, `LEFT JOIN users`, selected
`username`, and a service list wrapper. Reusing this shape avoids inventing a
new abstraction.

`repository.ListEnterpriseCreditLogs` is another valid join precedent, but its
`model.EnterpriseCreditLog` is a public enterprise-domain DTO. The
administrator-only repository DTO is narrower for this task.

## Affected Callers and Contracts

Direct production callers:

- `repository.ListCreditLogs` has one direct caller:
  `service.ListCreditLogs`.
- `service.ListCreditLogs` has one direct caller:
  `handler.AdminCreditLogs`.
- `handler.AdminCreditLogs` remains registered only at
  `GET /api/admin/credit-logs`.

Unaffected backend paths:

- `repository.ListCreditLogsByUserID`
- `service.ListUserCreditLogs`
- `GET /api/v1/credit-logs`
- `GET /api/v1/enterprise/credit-logs`
- Administrator credit-log POST and DELETE
- Database model and `AutoMigrate`

Existing administrator tests that decode the response into
`model.CreditLogList` will continue to work because Go's JSON decoder ignores
the new `username` field.

External caller changes for the main task, outside this Subagent's scope:

- `web/src/services/api/admin.ts` must add `username` to `AdminCreditLog`.
- Its admin credit-log query type must allow `start_time` and `end_time`.
- The administrator page can then display the projection and send the already
  supported date keys.
- API/progress documentation should describe the administrator date keys and
  `username` projection.

## Focused Verification Commands

Run the first command immediately after adding the test, before production
changes:

```bash
go test ./router -run '^TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP$' -count=1
```

Expected red: the returned item has an empty username.

Run the same command after the repository/service change:

```bash
go test ./router -run '^TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP$' -count=1
```

Expected green: exactly the two inclusive boundary records are returned and
both contain the target username.

Focused regression set:

```bash
go test ./router -run '^(TestAdminCreditLogsFilterByInclusiveDateRangeAndReturnUsernameThroughHTTP|TestAdminAdjustsEnterpriseOwnerCreditsByDeltaAndRecordsLog|TestAccountCreditLogsFilterByDateRangeThroughHTTP|TestEnterpriseCreditLogsFilterByDateRangeThroughHTTP)$' -count=1
```

These are PostgreSQL-backed integration tests and require the repository test
database configuration used by the existing router suite.

## Alternatives Considered

- Add `Username` to `model.CreditLog`: rejected because it broadens ordinary
  user and save-response contracts and couples a read projection to persistence.
- Persist a copied username on `credit_logs`: rejected; username belongs to
  `users`, and no historical snapshot requirement exists.
- Fetch users in the service per row: rejected because it creates N+1 queries.
- Build a second date-query type or parse dates in the service: rejected; the
  shared query and repository already implement the contract.
- Add username to keyword matching in this slice: rejected as unrequested
  behavior. It can be a separate product decision.
- Use an inner join: rejected because `credit_logs.user_id` has no foreign key
  and administrator-created or historical orphan rows should not vanish.

## Uncovered Risks

- `credit_logs.created_at` is stored as text and cast per query. An invalid
  stored timestamp can fail the whole list request, and the cast may prevent
  normal index use. Fixing storage/index design is outside this slice.
- Invalid `start_time` or `end_time` strings currently surface as the generic
  administrator failure envelope. Input validation is not part of the stated
  requirement.
- The projected username is the user's current username, not a historical
  snapshot. Renaming a user changes how old logs display.
- A missing user produces `username: ""` because of the `LEFT JOIN`.
- The integration test leaves UUID-isolated rows in the configured test
  database, matching existing router-test behavior.
- Router tests mutate the package-global JWT secret and must not use
  `t.Parallel`.
- The test intentionally does not assert result order; its contract is
  inclusion/exclusion and username projection.

## Verification Performed by This Subagent

- Confirmed the specified task branch before investigation.
- Traced the route, handler, query parser, service, repository, model, and
  direct callers with Codegraph and line-numbered source reads.
- Compared the proposed query with the existing administrator generation-task
  username projection and enterprise credit-log join.
- Checked current GORM join/projection guidance through Context7.
- Reviewed existing public HTTP date-range tests and router test helpers.
- Did not run database integration tests because this execution mode adds no
  test or business-code implementation; the exact red/green commands are
  provided above for the implementing agent.
