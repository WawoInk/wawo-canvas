# Acceptance

## Criteria

- [x] The video capability binding UI/public projection exposes "普通视频（Sora）".
- [x] A Sora-bound normal video generation sends `POST {base}/v1/videos` with Bearer auth and Sora multipart fields.
- [x] Polling a Sora task sends `GET {base}/v1/videos/{task_id}` with Bearer auth.
- [x] Sora task responses are normalized into the existing `ProviderTaskRef` lifecycle.
- [x] Existing Seedance/Vidu adapter behavior is unchanged.
- [x] Focused tests pass.

## Verification

- Red: `go test ./service -run 'TestSoraAdapter(CreatesVideoTask|PollsCompletedVideoTask)$' -count=1` failed because the Sora adapter/profile did not exist.
- Green: the same command passed after implementation.
- `go test ./service -run 'Test(GenerationProfilesAreValid|ResolveGenerationProfilesRoutesSoraBinding|SoraAdapterCreatesVideoTask|SoraAdapterPollsCompletedVideoTask|SeedanceAdapterCreatesPromptOnlyTask|ViduShortDramaAdapterCreatesGoldenPayloads)$' -count=1` passed.
- `go test ./service -count=1` passed.
- `go test ./model -count=1` passed.
- `npx --yes tsx --test src/services/api/generations.test.mjs` passed from `web/` with 12 tests.
- Frontend type check passed with a temporary config excluding the branch baseline duplicate property in `canvas-node-config.test.ts`; the unmodified branch baseline fails the full project command on that unrelated file.
- `git diff --check` passed.

## Residual Risk

- Upstream Sora-compatible providers can differ in completed result URL shape. The adapter covers direct `url` and `output.url`; a provider that only exposes authenticated binary content at a separate endpoint would require a future materialization transport change, which is outside this task.
- Sora image references, negative prompt, audio, watermark, and cancellation are intentionally not mapped.
