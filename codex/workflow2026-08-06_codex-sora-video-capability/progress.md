# Progress

- Branch: `codex/sora-video-capability`
- Base ref: `main`
- Base commit: `1319459c7dc960efeac65958c359fcdee38753c1`
- Worktree: `/Users/eldenpdx/git-project/infinite-canvas-sora-video`
- Workflow directory: `codex/workflow2026-08-06_codex-sora-video-capability`

## Task Contract

- Scope: add the "普通视频（Sora）" video capability binding and route its first-party upstream create/poll requests to OpenAI Sora `/v1/videos` endpoints.
- Expected outputs: profile/adapter routing, request and response handling, focused tests, and workflow records.
- Out of scope: changing existing Seedance/Vidu protocols, adding a new public compatibility endpoint, cancel support, or changing billing/materialization semantics.
- Definition of done: focused tests cover Sora create and poll HTTP behavior; existing generation tests remain compatible; workflow documents and implementation are committed on this branch.

## Status

- [x] Confirmed `main` and created isolated worktree.
- [x] Inspected existing Profile, Adapter, Canvas selection, and test seams.
- [x] Added external HTTP boundary tests for Sora create/poll behavior and confirmed they failed before implementation.
- [x] Implemented the smallest compatible adapter/profile change.
- [x] Ran focused verification and recorded results.
- [x] Commit implementation and workflow documents.
- [x] Added follow-up binding-level metadata Key/Value configuration and private task snapshotting.

## Current Changes

- `service/generation_adapter_test.go`: added real `httptest.Server` coverage for Sora create and poll HTTP behavior.
- `service/generation_adapter.go`, `generation_profiles.go`, `generation_lifecycle.go`: added Sora create/poll normalization, profile capabilities, validation, and adapter routing.
- `web/src/pages/admin/settings/index.tsx`, locales, and generation contract/tests: exposed the Sora binding and omitted unsupported output settings.
- `docs/content/docs/progress/pending-test.mdx`: added the user-testable Sora capability item.
- Binding metadata follow-up: updated settings models, admin KV editor, private Generation Payload snapshot, and all create Adapters.
- Workflow records updated with investigation, decisions, verification, and acceptance results.

## Blockers / Next Step

- No blocker. Implementation and workflow records are ready for the task commit.
