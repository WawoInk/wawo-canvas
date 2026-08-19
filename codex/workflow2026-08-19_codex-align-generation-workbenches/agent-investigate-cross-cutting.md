# Cross-cutting Investigation

## Scope And Verification

- Task: `investigate-cross-cutting`
- Role: `system-config/log-credit investigator`
- Mode: read-only investigation
- Wave/group: `wave-1` / `read-only-investigation`
- Branch checked: `codex/align-generation-workbenches`
- Baseline: `main` and `HEAD` both point to `a13233e4649ed39f220b11b0c865a2e4997f581f`
- Read: `CONTEXT.md`, `.knowledge/architecture.md`, `.knowledge/backend-modules.md`, `.knowledge/frontend-modules.md`, `.knowledge/api.md`, `.knowledge/database.md`, `.knowledge/business-flows.md`, `.knowledge/canvas.md`, `.knowledge/generation.md`, relevant Go/TS source and existing tests.
- `docs/adr/` contains no files.
- No browser test, server startup, build, dependency/config/business-code/test edit, branch switch, worktree creation, or commit was performed.
- The prompt archive contains one `{{...}}` match only because the user contract literally mentions the placeholder syntax in the check instruction; there is no unresolved operational template.

## Executive Findings

1. There are two legitimate remote model-config projections, not one: legacy public `ModelChannel` settings (`/api/settings`) and stable first-party `GenerationProfile` bindings (`/api/v1/model-profiles`). Compatibility image/video paths select by public model name/upstream model; first-party Canvas video selects by stable profile ID.
2. `generation_tasks` is the shared task ledger, but three creation paths coexist: first-party `CreateGeneration`, automatic compatibility proxy logging, and client-supplied `POST /api/v1/generation-tasks` backfill. Only the first-party path has request-ID idempotency.
3. Credit-log idempotency is task-scoped: partial unique `(task_id,type)` plus repository checks prevents a second consume/refund for one platform task. It does not prevent a retried compatibility submission from creating a new task and charging again.
4. First-party video is the most coherent path: task/payload/precharge transaction, worker lease, adapter callback/poll arbitration, result materialization, terminal refund/event transaction, and Canvas file-ID commit.
5. Remote Canvas images and remote workbench video use compatibility APIs. Their browser and server responsibilities are split inconsistently; remote video can be polled by both the browser and a server observer, while generic async images have no server timeout observer.
6. Legacy compatibility video terminal handling calls `OnTaskCompleted(..., refund=false)`, so asynchronous provider failure, cancellation, and `TASK_SYNC_TIMEOUT` can leave the initial precharge consumed. Durable accepted compatibility tasks use a different `refund=true` path.
7. Workbench result metadata is not reliably tied to the platform task: remote video `saveLog` patches with a local random log ID, and remote image uses a “latest matching task” heuristic. This is the main source of duplicate/fragmented history rather than the credit unique index.
8. History projection has a status gap: `service.mapTaskStatus` maps `success` but not `succeeded`; first-party/durable tasks can therefore appear as `pending` in image/video history.

## System Settings And Model Resolution

### Storage And Backend Projection

Call chain:

```text
Admin settings UI
  -> web/src/services/api/admin.ts:390-395
  -> POST/GET /api/admin/settings
  -> handler/settings.go:26-43
  -> service.AdminSettings / service.SaveSettings
  -> repository.GetSettings / SaveSettings
  -> settings table, two JSON rows: public/private
```

Relevant source:

- `model/setting.go:12-23`: private `ModelChannel` holds `protocol`, `name`, `baseUrl`, `apiKey`, raw `models`, weight and enabled state.
- `model/setting.go:44-60`: public model-channel projection holds available/capability model lists, defaults, `modelCosts` (display name, per-call credits, resolution credits), image request format and Canvas request mode.
- `model/setting.go:90-110`: private `GenerationProfileBinding` holds stable binding ID, code template ID, one upstream model, route channel, billing mode, limits and adapter metadata.
- `repository/setting.go:10-28`: reads all settings rows and unmarshals only `public` and `private`.
- `repository/setting.go:31-47`: writes both rows with `ON CONFLICT (key)`.
- `service/settings.go:44-84,126-209,294-365`: normalizes defaults, enabled-channel model lists, capability lists, image request formats, billing costs, binding IDs and file limits.
- `service/settings.go:21-41`: save preserves masked API keys/secrets, migrates legacy binding credits into public model costs, filters costs and validates generation bindings.
- `service/channel.go:13-35`: compatibility routing selects enabled channels matching an upstream model, weighted randomly.
- `service/channel.go:37-53`: first-party task route can select a named channel captured by the binding.

Private binding resolution:

```text
repository.GetSettings
  -> normalizeSettings
  -> resolveGenerationProfiles (service/generation_profiles.go:202-286)
      template from GenerationProfiles()
      + binding ID/display name/upstream model/channel
      + typed setting limits
      + public cost
      + enabled channel validation
  -> AvailableGenerationProfiles (service/generation_profiles.go:300-312)
      -> public video allowlist filter
```

Templates in `service/generation_profiles.go:48-120` currently expose:

- `seedance-contents-v1` / `video.generate`
- `vidu-short-drama-v1` / `video.short-drama`
- `sora-videos-v1` / `video.generate`

The public JSON deliberately omits `UpstreamModel`, `ChannelName` and `Metadata` (`model/generation_profile.go:11-23`). The browser receives stable profile identity and provider-neutral capabilities; the server owns the upstream binding.

### HTTP And Frontend Sources

Public settings:

```text
ClientRootInit (web/src/components/layout/client-root-init.tsx:26-43)
  -> useConfigStore.loadPublicSettings
  -> fetchPublicSettings
  -> GET /api/settings
  -> PublicSettings
  -> persisted AiConfig capability lists/defaults/remote mode
```

- `web/src/stores/use-config-store.ts:227-287` applies public lists and defaults.
- When `allowCustomChannel=false`, it forces `channelMode="remote"` and rejects stale persisted models by capability.
- When custom channels are allowed and the persisted mode is remote, it switches back to local.
- Local channels/API keys/models live in the browser `AiConfig`; remote mode only needs a selected public model/profile and a platform JWT.
- The config store uses Zustand persistence; workbench histories use account-scoped localforage separately.

First-party profiles:

```text
video settings / Canvas profile-aware UI
  -> getGenerationProfiles (web/src/services/api/generations.ts:37-45)
  -> GET /api/v1/model-profiles
  -> handler.ModelProfiles
  -> service.AvailableGenerationProfiles
```

- Profile catalog cache is keyed by auth token only and is not invalidated by an admin settings save in the same browser session.
- Canvas remote video pickers use profile IDs (`canvas-config-node-panel.tsx:41-64`, `canvas-node-prompt-panel.tsx:53-80`).
- Image and compatibility model pickers use public capability model names.
- `VideoSettingsPanel` fetches the profile catalog even when local mode is selected (`video-settings-panel.tsx:40-55`), then falls back to generic compatibility controls if no profile is found.
- `web/src/constant/credits.tsx:27-34` is display-only. It returns zero for local mode, uses public `resolutionCredits * duration` for per-second estimates, and otherwise uses public per-call/fallback credits. It is not the authoritative charge.

### Model-Config Risks

- Binding IDs and upstream model names are intentionally distinct, but compatibility and first-party callers still accept both in different places. A workbench can display a stable binding while its client payload contains the upstream model name; the server then has to remap it.
- `AvailableGenerationProfiles` filters by `profile.ID` against public `VideoModels`. Explicit bindings are normalized to replace upstream names with binding IDs; the `GenerationProfiles == nil` dynamic-template branch does not perform that same replacement, so a dynamic channel whose public list contains only upstream names can expose no profiles.
- Per-second “auto” duration is shown as zero by `requestCreditCost` because `Number("-1")` is clamped to zero, while backend `generationBillingPlanFor` substitutes the profile maximum duration. The UI estimate can be lower than the actual charge.
- Per-credit profiles show a rate-like estimate in the UI, but actual billing waits for upstream credits and settles server-side.
- `imageRequestFormats.canvasRequestMode` is consumed by Canvas async image edit selection (`web/src/services/api/image.ts:272-279`) but not by the image workbench synchronous `requestGeneration/requestEdit` path. The same public model configuration therefore does not produce the same endpoint behavior in all surfaces.

## Data Models And Persistence

### Generation Task Facts

- `model/generation_task.go:43-80`: `GenerationTask` stores user/source/provider/model, lifecycle status, charged credits, upstream credits, billing mode/rate, upstream task ID, callback token, request identity/hash/version, first-party profile/adapter/channel snapshot, result JSON, worker queue/lease fields and timestamps.
- `model/generation_task.go:82-93`: `GenerationPayload` stores command body, redacted request/response headers/body and raw error; one logical payload per task.
- `model/generation_task_event.go:3-10`: append-only lifecycle events.
- `model/user.go:95-118`: credit types and `CreditLog` fields. Amount is signed from the user-account perspective; balance is post-change.
- `model/user.go:27`: user credits have a nonnegative DB check.
- `model/video_task.go:3-10`: legacy upstream video-task ownership mapping.

Schema/transaction facts:

- `repository/db.go:53-67` AutoMigrates users, credit logs, settings, generation tasks/payload/events and video tasks.
- `repository/db.go:69-90` creates partial unique `(user_id,client_request_id)` for nonempty first-party request IDs and partial unique `(task_id,type)` for nonempty credit-log task IDs.
- `repository/db.go:117-147` migrates billing columns to PostgreSQL `numeric`.
- No foreign keys connect `credit_logs` to tasks/users; deleting a task does not delete its ledger facts.
- `service/payload_cleanup.go:10-29` removes payloads after 90 days; task summaries and credit logs remain.

### Credit Application Seam

```text
service.ConsumeUserCreditsWithTask / RefundUserCreditsWithTask
  -> repository.ApplyUserCreditLog
  -> transaction:
       SELECT user FOR UPDATE
       if task/type log already exists: no-op success
       refund: derive amount from matching ai_consume log
       consume: apply enterprise discount
       reject negative resulting balance
       update users.credits
       insert credit_logs
       consume: update generation_tasks.credits to actual discounted amount
```

Source: `service/auth.go:438-497`, `repository/user.go:148-207`.

This is the authoritative idempotency behavior for compatibility billing. Passing a different requested refund amount does not change the amount; the original consume log wins.

## Generation Lifecycle And Accounting Contracts

### First-Party `/api/v1/generations`

Call chain:

```text
POST /api/v1/generations
  -> handler.CreateGeneration
  -> service.CreateGeneration
     validate command/source/profile/intent/settings/files
     normalize intent settings
     SHA-256 command body
     lookup (userId,clientRequestId)
     resolve named channel + billing plan
     repository.CreateGenerationTaskWithCharge
       task + payload + optional discounted precharge + ai_consume
     dispatch worker
  -> queued FirstPartyGenerationTask
```

Source: `handler/generations.go:22-39`, `service/generation_orchestrator.go:55-171`, `repository/generation_billing.go:15-59`.

Idempotency:

- Same `(user,clientRequestId)` and same normalized command hash returns the existing task.
- Same request ID with a different hash returns `ErrGenerationCommandConflict`.
- A concurrent unique-index conflict is caught and re-read.
- A request rejected before task creation (invalid profile/settings/media or insufficient precharge) leaves no task/consume log.

Worker/lifecycle:

- `main.go:27-35` starts profile validation, payload cleanup and the generation worker.
- `service/generation_worker.go:14-77` claims queued/expired tasks with a one-minute lease, renews it, then routes first-party or accepted compatibility tasks.
- `service/generation_orchestrator.go:419-500` creates/polls through the adapter, records audits/events, and times out at `generationTaskTimeout` (30 minutes).
- `service/generation_lifecycle.go:146-199` treats upstream success without a video URL as failure; transitions to internal `pending`, downloads/uploads to `user_files`, and requires a platform file ID.
- Temporary result persistence failure returns the task to `running` with `RESULT_PERSIST_FAILED`; the worker lease expiry allows retry.
- `service/generation_lifecycle.go:209-239` performs terminal CAS, optional upstream-credit settlement, refund, and terminal event in one transaction.
- Failed/cancelled first-party tasks refund `task.Credits` (the actual discounted precharge), with `(task_id,ai_refund)` uniqueness and terminal CAS preventing duplicates.
- Per-credit first-party tasks start with zero precharge; success charges `upstream_credits * billing_rate` transactionally. Failure/cancel with zero charged credits has no refund.

Callback/cancel:

- `service/generation_lifecycle.go:52-82` validates callback token with constant-time comparison, profile callback capability, adapter parsing and upstream ID equality.
- `:84-124` only cancels through a profile adapter that declares cancellation; provider confirmation is required before terminal cancellation/refund.
- Poll and callback races are covered by terminal state arbitration; later signals cannot overwrite a terminal task.

Browser observation:

- `web/src/services/api/generation-contract.ts:20-46` polls up to 360 observations with 5-second sleeps.
- Twenty consecutive retryable query failures produce `GenerationPollingPausedError`; this pauses local observation and does not alter task status or billing.
- `web/src/services/api/generations.ts:161-193` supports lookup by task ID or client request ID, and throws a structured terminal error.
- Canvas stores `generationTaskId`, `generationClientRequestId`, profile ID and status in node metadata, then `commitCanvasVideoResult` writes the server-produced file ID.
- Stop/Resume is local observation control; Retry should create a new request ID.

### Compatibility Proxy: Synchronous Image/Text/Audio And Generic Async Images

Call chain:

```text
POST /api/v1/images/* (or chat/audio)
  -> router proxy
  -> service.ProxyAIRequest
     read body/model/count
     PublicSettings + publicModelAllowed
     ModelCost * request count
     SelectModelChannel
     LogTaskStart (task/payload, status=running)
     ConsumeUserCreditsWithTask
     upstream HTTP
       success -> LogTaskSuccess
       HTTP/network failure -> LogTaskFailure + RefundUserCreditsWithTask
```

Source: `router/router.go:49-60`, `service/ai_proxy.go:20-119`, `service/task_lifecycle.go:31-130`.

Important timing/risks:

- `LogTaskStart` and the consume transaction are separate. `ProxyAIRequest` ignores the `LogTaskStart` error (`ai_proxy.go:73`); the helper has already generated a random ID when persistence fails, so the subsequent consume can leave an orphaned task-scoped credit log with no durable task row.
- The proxy decides upstream failure from HTTP status. A provider response with HTTP 200 and a business error envelope can be recorded as task success and remain charged; the browser parser may then throw after the charge.
- Synchronous compatibility retries have no client request ID. Every new POST can create a new task and consume log; task-scoped idempotency cannot collapse separate task IDs.
- Multipart audit redacts file bytes (`requestAuditBody`), which is covered by tests.

Generic async images:

```text
POST /api/v1/async/images/*
  -> same LogTaskStart + precharge
  -> response retains running task and upstreamTaskID
  -> browser GET /api/v1/tasks/:upstreamID
  -> ProxyAIGetRequest finds image task by upstream ID
  -> finalizeAsyncImageTask
     response/raw error audit
     terminal CAS
     refund on failed/cancelled
```

Source: `service/ai_proxy.go:121-257`.

- Immediate terminal response is finalized by the submit callback.
- A pending response is only finalized when a browser poll reaches `ProxyAIGetRequest`; there is no generic async-image worker/lease timeout.
- Browser Canvas polling also caps at 360 * 5 seconds (~30 minutes). A local timeout/Stop Observing does not cancel or settle the server task; without another observer, the charged task can remain `running`.
- `X-Generation-Task-Id` is emitted by the backend, but `createAsyncImageTask` currently returns only one ID and does not preserve a separate platform task ID versus upstream task ID.

### Compatibility Video `/api/v1/contents/generations/tasks`

Call chain:

```text
POST /contents/generations/tasks
  -> handler.CreateVideoTask
  -> service.ProxyVideoTaskCreate / proxyVideoTaskPost
     public model allowlist
     compatibilityProfileForModel
     binding billing plan or ModelCost
     optional model rewrite to binding upstream model
     StartCompatibilityTask
       task + payload + precharge in one transaction
     upstream create
```

Source: `handler/video_tasks.go:10-47`, `service/ai_proxy.go:670-794`, `service/task_lifecycle.go:16-29`.

Two branches:

1. **Bound/durable profile**: response with upstream ID calls `QueueAcceptedCompatibilityTask` (`repository/generation_lifecycle.go:12-35`), snapshots adapter/profile/channel, then the shared worker observes without creating a second upstream task. `observeCompatibilityTask` (`service/compatibility_lifecycle.go:32-80`) settles upstream credits and calls terminal arbitration with `refund=true`.
2. **Legacy/non-durable profile**: response with upstream ID calls `LogTaskCreated`, saves `video_tasks` ownership, and starts `SyncTaskStatus` (`service/task_sync.go:62-141`). `OnTaskCompleted` (`task_sync.go:213-232`) calls terminal arbitration with `refund=false`.

Failure/refund behavior:

- Network/HTTP failure before a task ID, missing upstream ID, or queue failure invokes `RefundUserCreditsWithTask` from `proxyVideoTaskPost`.
- Legacy asynchronous provider failure, cancellation, and `TASK_SYNC_TIMEOUT` go through `OnTaskCompleted(..., refund=false)`, so the initial precharge is not refunded. The legacy callback handler (`handler/task_callback.go:13-70`) uses the same `OnTaskCompleted` path.
- Durable accepted compatibility failures do use the shared refund path.
- `ProxyVideoTaskDelete` settles a matched generation task as cancelled with `refund=false`, so cancellation of a legacy compatibility task also does not automatically refund.
- `generation_tasks` terminal CAS still prevents duplicate terminal events, but it cannot restore a missing refund.

Observation duplication:

- `web/src/services/api/video.ts:37-98` polls the provider from the browser.
- The server also starts `SyncTaskStatus` for legacy tasks or the generation worker for durable tasks.
- The browser GET route (`handler/video_tasks.go:15-27`) proxies upstream status but does not become the sole lifecycle owner for compatibility video.
- Durable compatibility worker and browser can therefore query the same upstream task concurrently; legacy server watcher and browser can do the same.

### Manual Frontend History Backfill

`POST /api/v1/generation-tasks`:

```text
workbench page
  -> recordGenerationTask
  -> handler.RecordGenerationTask
  -> service.RecordUserTask
  -> task/payload insert or upsert by (user,upstreamTaskID)
```

Source: `handler/generation_tasks.go:96-129`, `service/generation_service.go:151-219`, `web/src/services/api/generation-tasks.ts:130-153`.

- It stores client-provided history; it does not charge credits.
- Image workbench uses it only in local mode, with a generated `dedupeKey` and `credits="0"`.
- Video workbench uses it only in local mode, keyed by provider upstream task ID and `credits="0"`.
- Remote video skips it because the proxy already creates a task.
- Remote image does not create a second task, but later heuristically finds a recent matching backend task to patch file IDs.
- `RecordUserTask` upserts only when `upstreamTaskID` is nonempty. Empty IDs insert separate rows.
- The endpoint accepts arbitrary status/credit fields as history data; it is not a safe replacement for a billing/task creation endpoint.

## Frontend Entry-Point Matrix

| Entry | Remote model/config | Submit + task identity | Log persistence | Credit timing | Result ownership | Timeout/observation | Current deviation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Canvas image node | `/api/settings` public model + image request format | `createAsyncImageTask/EditTask` -> compatibility proxy; Canvas stores upstream ID, sometimes platform header ID | Proxy task automatic; no Canvas file-ID metadata patch | Proxy precharge; refund only when server sees terminal poll | Browser uploads `results/images`, Canvas stores file ID | Canvas loop 360 x 5s; no server image observer timeout | Compatibility path, no first-party command; sync mask edits lack `X-Source: canvas` |
| Canvas video node, remote | `/api/v1/model-profiles` stable profile + binding | `createGeneration` with `clientRequestId`; platform task ID | First-party task/payload/events automatic | Create precharge or success-time per-credit settlement; terminal refund | Server materializes `user_files`; Canvas commits file ID | Worker 30m; browser observes/pauses/resumes | Canonical path, but only Canvas uses it |
| Canvas video node, local | Browser `AiConfig` raw channel/model | Direct `/contents/generations/tasks`; upstream ID | No platform task/log backfill | No platform charge | Browser uploads result; Canvas stores file ID | Browser loop 30m; direct provider | No shared platform history/accounting by design |
| Image workbench, remote | `/api/settings` public image model/cost/format | Sync `/images/generations` or `/edits`; response task ID not retained as a stable page field | Proxy task automatic; page patches a guessed recent task | Proxy precharge; sync HTTP failure refunds | Browser uploads result | Request lifetime only | Batch launches one backend task per slot but one visible aggregate log; 200-code business errors can remain charged |
| Image workbench, local | Browser `AiConfig` raw channel/model | Direct provider sync request | Localforage log + optional `RecordUserTask` | `credits=0`; no platform billing | Browser uploads result | Request lifetime only | Does not share Canvas async image lifecycle |
| Video workbench, remote | Public capability list; stable binding IDs are remapped by backend compatibility profile | `/contents/generations/tasks`; browser keeps upstream ID, backend has hidden platform task ID | Proxy task automatic; page skips record, then patches with random local log ID | Atomic compatibility precharge; durable profile settles/refunds, legacy async failure does not | Browser uploads result | Page ~10m (120 polls); legacy watcher ~15m (90 polls with 5-10s backoff), durable worker ~30m | Browser/server double-poll; wrong metadata patch ID; timeout mismatch |
| Video workbench, local | Browser `AiConfig` raw channel/model | Direct provider task + upstream ID | Localforage + `RecordUserTask` keyed by upstream ID | `credits=0` | Browser uploads result | Page ~10m | No platform task/accounting; Canvas local path does not even backfill local history |

Additional Canvas path: mask/edit actions at `canvas/project/index.tsx:1902-2023` call synchronous `requestEdit`, not the async Canvas image task helpers. They do not set `X-Source: canvas`, so compatibility task source can be inferred as `image_workbench`.

## Strict-Reuse Boundary Recommendation

The smallest coherent boundary is to preserve the existing first-party/compatibility split while making task identity and lifecycle ownership explicit. Do not add a new page-local billing implementation.

1. **Return one typed remote run reference from every create API.**
   - At minimum: `platformTaskId`, `upstreamTaskId`, `clientRequestId` (when supplied), `source`, and route kind (`first_party`, `compatibility`, `local`).
   - The existing `X-Generation-Task-Id` header is the platform-task source for compatibility POSTs; `video.ts` currently discards it and workbench pages invent a separate random log ID.
   - `patchGenerationTaskMetadata`, delete/detail, and history reconciliation must use `platformTaskId`, never a local log ID or “latest matching task” query.

2. **Make remote `generation_tasks` authoritative and keep `RecordUserTask` local-only.**
   - Remote workbenches must not create a second history task after a proxy request.
   - Local workbenches may keep a zero-credit local-history backfill, but Canvas local behavior should be an explicit policy: either use the same local recorder or intentionally omit local platform history everywhere.
   - The manual endpoint should not be used as a billing seam.

3. **Add request idempotency at compatibility submission, not only credit-log idempotency.**
   - First-party already has `(user,clientRequestId,commandHash)`.
   - Compatibility image/video currently has only random task IDs and upstream IDs. A lost response or browser retry can submit again and charge a new task.
   - Reuse one client request ID per logical workbench/Canvas run and enforce it before provider creation; retain command/body conflict semantics.

4. **Choose one observer for each remote asynchronous task.**
   - First-party: worker owns provider lifecycle; browser only calls `/generations/:id`.
   - Durable compatibility video: either browser observes the platform task through a dedicated API or the server worker owns observation; do not keep independent provider polling in both paths.
   - Generic async images need a server-side terminal/timeout owner before they can have the same “Stop Observing does not leave billing open” contract. If the smallest change keeps browser ownership, add an explicit authenticated settle/timeout path and make it idempotent.

5. **Route all terminal accounting through one arbiter.**
   - Legacy `OnTaskCompleted`/callback must pass the same refund policy as durable compatibility, or delegate to the shared lifecycle resolver.
   - Timeout, provider failure, cancellation, and missing-result cases must all make one terminal CAS plus at most one refund log.
   - A browser timeout should mean “pause observation” unless the server has explicitly won terminal timeout arbitration.

6. **Use settings projections consistently.**
   - Remote video surfaces should select stable profile IDs whenever a binding exists; only the backend maps to upstream model/channel.
   - Remote image surfaces should share the configured request format and Canvas mode intentionally; current workbench sync and Canvas async paths are not equivalent.
   - Keep public `modelCosts` as display/estimate input; actual billing remains private binding + server repository transaction.

7. **Normalize status/result history at one projection seam.**
   - Treat `success` and `succeeded` equivalently in `mapTaskStatus`, `ToImageHistoryDTO`, `ToVideoHistoryDTO`, and result URL/file-ID extraction.
   - Prefer platform `fileId` metadata/result JSON over raw provider URLs for durable history.

## Suggested Test Seams

Tests should observe public handlers/services or typed API boundaries, not private helper state.

### Backend Seams

- `GET /api/settings` and `GET /api/v1/model-profiles`: public projection contains no API key/channel/upstream metadata; explicit binding ID, display name, limits, billing cost and allowlist resolve consistently.
- `POST /api/admin/settings` followed by the two reads: masked keys are preserved, invalid binding is rejected, and public lists/defaults match the binding IDs.
- `POST /api/v1/generations`:
  - same user/request ID + same normalized command returns one task and one consume log;
  - same request ID + different hash returns conflict with no second charge;
  - lost create response recovered by client request lookup.
- First-party callback/poll/cancel/timeout races: exactly one terminal event, one materialization attempt, and one refund where applicable.
- Compatibility POST:
  - response exposes both platform and upstream identity;
  - repeated terminal failure/callback/poll produces one refund;
  - legacy failure, cancellation and timeout refund the actual consume amount;
  - duplicate compatibility request ID does not create a second provider task/charge;
  - HTTP 200 business-error envelope is recorded as failure/refunded, not success/charged.
- Generic async image:
  - immediate success/failure settles once;
  - pending task settles/refunds without requiring an arbitrary browser GET after the server-side timeout policy is in place;
  - repeated status observations do not duplicate credit logs.
- History projection:
  - both `success` and `succeeded` map to `success`;
  - first-party materialized file ID appears in the history result/metadata.
- `LogTaskStart` persistence failure is surfaced or safely aborts before charge; never fall through to an orphaned task-scoped or non-task-scoped consume log.

### Frontend Seams

- Config store:
  - forced-remote mode removes stale local selections;
  - profile catalog and public settings resolve the same stable video ID;
  - per-second auto/per-credit display is clearly an estimate and does not claim a zero charge.
- Shared create adapter:
  - captures `platformTaskId` from compatibility response headers and `upstreamTaskId` from body;
  - uses the platform ID for metadata patching and history refresh;
  - reuses client request ID on retry/recovery.
- Image workbench batch:
  - each slot maps to its own platform task or the chosen single batch task;
  - one visible aggregate history item does not leave unrelated backend tasks unlinked.
- Video workbench and Canvas compatibility:
  - only one observer owns provider polling;
  - Stop Observing does not mark a task failed or trigger a second submit;
  - Resume observes the same platform/upstream task;
  - browser timeout and server timeout have one documented meaning.
- Canvas first-party:
  - result commit uses server `fileId`;
  - create-response loss uses the same client request ID;
  - late node edits are preserved while result commit remains durable.

### Existing Coverage And Gaps

Already covered by existing tests:

- Settings normalization/binding limits/costs: `service/settings_test.go`.
- Public profile projection: `handler/generations_test.go`.
- First-party lifecycle races, result-file requirements, timeout and cancellation refunds: `service/generation_lifecycle_test.go`.
- Atomic/pre-credit billing and enterprise discounts: `repository/generation_billing_test.go`.
- Async image failure refund after a poll: `service/ai_proxy_test.go:45-138`.
- Durable compatibility upstream-credit settlement: `service/ai_proxy_test.go:147-239`, `service/compatibility_lifecycle_test.go`.
- Browser command/profile/polling contracts and Canvas resume/compiler behavior: `web/src/services/api/generations.test.mjs`, `web/src/services/api/image.test.mjs`, `web/src/services/api/video.test.mjs`, `web/src/pages/canvas/components/canvas-generation-resume.test.mjs`, `canvas-node-generation.test.mjs`, `web/src/stores/use-config-store.test.ts`.

Not covered:

- `TaskStatusSucceeded` history mapping.
- Legacy compatibility async failure/cancel/timeout refund.
- Generic async-image server timeout or lost-observer settlement.
- Compatibility client request idempotency and response platform-task-ID propagation.
- Remote video workbench metadata patch currently using local random log ID.
- Remote image batch-to-task mapping and HTTP 200 business-error refund.
- `LogTaskStart` failure before charge.
- Browser/server duplicate provider polling and timeout mismatch.
- Dynamic profile allowlist filtering when bindings are absent.
