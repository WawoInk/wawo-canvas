# Decisions

## 2026-08-06

- Keep the change inside the existing first-party generation Profile/Adapter path. This preserves task ownership, billing, polling, materialization, and Canvas metadata behavior.
- Represent "普通视频（Sora）" as a distinct adapter/profile selection rather than changing the existing Seedance adapter. Existing bindings must continue sending `/contents/generations/tasks`.
- Test at the external HTTP server boundary used by the adapter: assert method, URL, headers, request JSON, and parse the provider task response.
- Reuse existing channel URL and Authorization helpers. The Sora adapter should call `/videos` and `/videos/{task_id}` through the same `BuildModelChannelURL` path so base URL normalization stays centralized.
- Do not add cancellation or speculative Sora-specific fields until the current product contract requires them; preserve the existing video intent fields that can be mapped directly.
- Use `multipart/form-data` for Sora task creation because the current OpenAI Videos API create operation uses multipart fields. Map only `model`, `prompt`, `size`, and `seconds`; the current first-party intent has no compatible Sora contract for audio, watermark, negative prompt, or URL-based media references.
- Project `aspectRatio` plus `resolution` becomes the Sora `size` field through a small explicit mapping. The Sora capability template only exposes combinations this adapter can translate.
- Normalize Sora `queued`/`in_progress` as running, `completed` as succeeded, and preserve the existing Materialized Result path by extracting the provider result URL into `ProviderTaskRef.VideoURL`.
- Store administrator-defined metadata as a string map on each binding. Snapshot it into the server-generated private Generation Payload, not user-editable task metadata, so queued runs cannot have upstream parameters changed through the task metadata API.
- Merge binding metadata in every current create Adapter. Existing platform-generated metadata such as Seedance negative prompt fields wins on key collision; Sora carries the same object as a JSON-encoded multipart `metadata` field.
