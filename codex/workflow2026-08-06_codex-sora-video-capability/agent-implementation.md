# Agent Implementation

## Investigation

- First-party normal video already flows through `GenerationProfile` -> task route snapshot -> `generationAdapterFor` -> `GenerationAdapter.Create/Poll` -> existing lifecycle and result materialization.
- Seedance and Vidu share the contents-task protocol in `service/generation_adapter.go`; changing that shared protocol would violate the task contract.
- `BuildModelChannelURL` already normalizes root, `/v1`, and Ark Plan base URLs, while `modelChannelAuthorization` already normalizes Bearer tokens.
- Admin capability binding options are code-defined in `web/src/pages/admin/settings/index.tsx`; public Canvas model choices are projected from enabled backend bindings, so no new public API is required.
- The external HTTP seam is already established by adapter tests using `httptest.Server`. The new tests assert method, path, Authorization, multipart fields, task ID/status, and completed result URL normalization.

## Intended Minimal Change

- Add one `sora-videos-v1` adapter and one `sora-2` profile template for `video.generate`.
- Add the adapter to profile validation and lifecycle routing.
- Add the Sora capability option to the admin binding UI and both locale files.
- Leave Seedance/Vidu implementations, cancellation, billing, task persistence, and materialization unchanged.

## Implementation

- Sora create uses multipart `model`, `prompt`, `size`, and `seconds` fields at `/v1/videos`.
- Sora poll uses `/v1/videos/{task_id}` and maps `queued`/`in_progress` to running, `completed` to succeeded, and `failed` to the existing stable upstream error.
- Size translation is deliberately explicit: 720p/1080p in 16:9 or 9:16 map to the corresponding Sora pixel dimensions.
- Completed result parsing accepts direct `url` and `output.url`, then hands the URL to the unchanged platform materialization flow.
- The Sora profile exposes only aspect ratio, resolution, duration, poll completion, and no cancellation. Frontend video settings now omit optional output fields when the profile does not declare them.
- Admin settings now offers the distinct "普通视频（Sora）" template while retaining "普通视频（Seedance）" and "短剧（Vidu Drama）".

## Metadata Follow-up

- Every generation binding now accepts administrator-defined string metadata Key/Value pairs.
- Metadata is snapshotted into the private stored Generation Command and passed to the Adapter when the run is submitted.
- Seedance and Vidu receive a JSON `metadata` object; Sora receives the same object JSON-encoded in its multipart `metadata` field.
- Existing system metadata is preserved and wins over an administrator value using the same key.

## Documentation Check

- Added this feature to `docs/content/docs/progress/pending-test.mdx`.
- Reviewed `docs/content/docs/progress/todo.mdx`; no existing todo represented this task, so no item moved.
- Formal feature documentation remains unchanged until user testing confirms the pending item, per project documentation rules.
