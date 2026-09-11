package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

type lifecycleFakeAdapter struct {
	create   func(context.Context, AdapterCreateRequest) (ProviderTaskRef, error)
	poll     func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error)
	callback func(context.Context, []byte) (ProviderTaskRef, error)
	cancel   func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error)
}

func (a lifecycleFakeAdapter) Create(ctx context.Context, req AdapterCreateRequest) (ProviderTaskRef, error) {
	return a.create(ctx, req)
}

func (a lifecycleFakeAdapter) Poll(ctx context.Context, channel model.ModelChannel, id string) (ProviderTaskRef, error) {
	return a.poll(ctx, channel, id)
}

func (a lifecycleFakeAdapter) ParseCallback(ctx context.Context, body []byte) (ProviderTaskRef, error) {
	return a.callback(ctx, body)
}

func (a lifecycleFakeAdapter) Cancel(ctx context.Context, channel model.ModelChannel, id string) (ProviderTaskRef, error) {
	return a.cancel(ctx, channel, id)
}

func TestGenerationCallbackRejectsInvalidTokenWithoutChangingTask(t *testing.T) {
	adapter := lifecycleFakeAdapter{callback: func(context.Context, []byte) (ProviderTaskRef, error) {
		return ProviderTaskRef{ID: "provider-callback", Status: model.TaskStatusFailed}, nil
	}}
	profile := lifecycleProfile("callback-profile", []string{"callback", "poll"}, false)
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()

	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-callback", 0)
	err := HandleGenerationCallback(context.Background(), "wrong-token", []byte(`{"id":"provider-callback","status":"failed"}`))
	var operationErr GenerationOperationError
	if !errors.As(err, &operationErr) || operationErr.Code != "CALLBACK_UNAUTHORIZED" {
		t.Fatalf("error = %#v, want CALLBACK_UNAUTHORIZED", err)
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusRunning {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
}

func TestGenerationCallbackAndPollConvergeOnce(t *testing.T) {
	var persisted atomic.Int32
	adapter := lifecycleFakeAdapter{
		poll: func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
			return ProviderTaskRef{ID: "provider-converge", Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}, nil
		},
		callback: func(context.Context, []byte) (ProviderTaskRef, error) {
			return ProviderTaskRef{ID: "provider-converge", Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}, nil
		},
	}
	profile := lifecycleProfile("callback-converge", []string{"callback", "poll"}, false)
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
		persisted.Add(1)
		return &model.UserFile{ID: "file-converged", MimeType: "video/mp4"}, nil
	}

	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-converge", 0)
	if err := HandleGenerationCallback(context.Background(), task.CallbackToken, []byte(`{"id":"provider-converge","status":"succeeded"}`)); err != nil {
		t.Fatalf("first callback: %v", err)
	}
	if err := HandleGenerationCallback(context.Background(), task.CallbackToken, []byte(`{"id":"provider-converge","status":"succeeded"}`)); err != nil {
		t.Fatalf("duplicate callback: %v", err)
	}
	executeGeneration(context.Background(), task, profile, model.ModelChannel{})

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || persisted.Load() != 1 {
		t.Fatalf("stored=%#v persisted=%d err=%v", stored, persisted.Load(), err)
	}
}

func TestSucceededWithoutVideoURLFailsAndSettlesOnce(t *testing.T) {
	profile := lifecycleProfile("missing-video", []string{"poll"}, false)
	restore := useLifecycleTestAdapter(profile, lifecycleFakeAdapter{})
	defer restore()
	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-missing-video", 2)

	ref := ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusSucceeded}
	if err := resolveGenerationTask(context.Background(), task, profile, ref, "poll"); err != nil {
		t.Fatalf("resolve generation: %v", err)
	}
	if err := resolveGenerationTask(context.Background(), task, profile, ref, "callback"); err != nil {
		t.Fatalf("duplicate resolve: %v", err)
	}

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ErrorCode != "UPSTREAM_REJECTED" || stored.ErrorMessage != "上游未返回视频结果" || stored.ErrorRetryable {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	user, ok, err := repository.GetUserByID(task.UserID)
	if err != nil || !ok || !user.Credits.Equal(task.Credits) {
		t.Fatalf("user=%#v ok=%v err=%v", user, ok, err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(task.UserID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].Type != model.CreditLogTypeAIRefund {
		t.Fatalf("logs=%#v err=%v", logs, err)
	}
	events, err := repository.ListGenerationTaskEvents(task.ID)
	terminal := 0
	for _, event := range events {
		if event.Type == "terminal" {
			terminal++
		}
	}
	if err != nil || terminal != 1 {
		t.Fatalf("events=%#v terminal=%d err=%v", events, terminal, err)
	}
}

func TestSucceededWithMissingPersistedFileIDFailsAndSettlesOnce(t *testing.T) {
	profile := lifecycleProfile("missing-file-id", []string{"poll"}, false)
	restore := useLifecycleTestAdapter(profile, lifecycleFakeAdapter{})
	defer restore()
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
		return &model.UserFile{MimeType: "video/mp4"}, nil
	}
	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-missing-file-id", 2)

	ref := ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}
	if err := resolveGenerationTask(context.Background(), task, profile, ref, "poll"); err != nil {
		t.Fatalf("resolve generation: %v", err)
	}

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ErrorCode != "RESULT_FILE_MISSING" || stored.ResultJSON != "" || stored.WorkerLeaseOwner != "" || stored.WorkerLeaseExpiresAt != "" {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	user, ok, err := repository.GetUserByID(task.UserID)
	if err != nil || !ok || !user.Credits.Equal(task.Credits) {
		t.Fatalf("user=%#v ok=%v err=%v", user, ok, err)
	}
}

func TestGenerationProgressCannotReopenSettlementOrTerminalTask(t *testing.T) {
	profile := lifecycleProfile("progress-guard", []string{"poll"}, false)
	restore := useLifecycleTestAdapter(profile, lifecycleFakeAdapter{})
	defer restore()

	for _, status := range []model.TaskStatus{model.TaskStatusPending, model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled} {
		t.Run(string(status), func(t *testing.T) {
			task := createLifecycleTask(t, profile, status, "provider-progress", 0)
			if err := updateGenerationProgress(task.ID, model.TaskStatusRunning, "poll"); err != nil {
				t.Fatalf("update progress: %v", err)
			}
			stored, err := repository.GetGenerationTaskByID(task.ID)
			if err != nil || stored.Status != status {
				t.Fatalf("stored=%#v err=%v", stored, err)
			}
			events, err := repository.ListGenerationTaskEvents(task.ID)
			if err != nil || hasGenerationEvent(events, "poll") {
				t.Fatalf("events=%#v err=%v", events, err)
			}
		})
	}
}

func TestGenerationConcurrentTerminalNotificationsPersistOnce(t *testing.T) {
	var persisted atomic.Int32
	profile := lifecycleProfile("concurrent-converge", []string{"callback", "poll"}, false)
	adapter := lifecycleFakeAdapter{callback: func(context.Context, []byte) (ProviderTaskRef, error) {
		return ProviderTaskRef{ID: "provider-concurrent", Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}, nil
	}}
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
		persisted.Add(1)
		time.Sleep(10 * time.Millisecond)
		return &model.UserFile{ID: "file-concurrent", MimeType: "video/mp4"}, nil
	}
	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-concurrent", 0)
	ref := ProviderTaskRef{ID: task.UpstreamTaskID, Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}
	errors := make(chan error, 2)
	go func() { errors <- resolveGenerationTask(context.Background(), task, profile, ref, "poll") }()
	go func() {
		errors <- HandleGenerationCallback(context.Background(), task.CallbackToken, []byte(`{"id":"provider-concurrent","status":"succeeded","content":{"video_url":"https://example.com/video.mp4"}}`))
	}()
	for range 2 {
		if err := <-errors; err != nil {
			t.Fatalf("terminal notification: %v", err)
		}
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || persisted.Load() != 1 {
		t.Fatalf("stored=%#v persisted=%d err=%v", stored, persisted.Load(), err)
	}
}

func TestGenerationCompensationPollTimesOutWithStableError(t *testing.T) {
	var polls atomic.Int32
	adapter := lifecycleFakeAdapter{
		poll: func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
			polls.Add(1)
			return ProviderTaskRef{ID: "provider-timeout", Status: model.TaskStatusRunning}, nil
		},
	}
	profile := lifecycleProfile("timeout-profile", []string{"callback", "poll"}, false)
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	previousPollInterval, previousCallbackPoll, previousTimeout := generationPollInterval, generationCallbackPollInterval, generationTaskTimeout
	defer func() {
		generationPollInterval, generationCallbackPollInterval, generationTaskTimeout = previousPollInterval, previousCallbackPoll, previousTimeout
	}()
	generationPollInterval = time.Millisecond
	generationCallbackPollInterval = time.Millisecond
	generationTaskTimeout = 5 * time.Millisecond

	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-timeout", 0)
	executeGeneration(context.Background(), task, profile, model.ModelChannel{})

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ErrorCode != "GENERATION_TIMEOUT" || stored.ErrorRetryable {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	if polls.Load() == 0 {
		t.Fatal("compensation poll was not attempted")
	}
	events, err := repository.ListGenerationTaskEvents(task.ID)
	if err != nil || !hasGenerationEvent(events, "timeout") || !hasGenerationEvent(events, "terminal") {
		t.Fatalf("events=%#v err=%v", events, err)
	}
}

func TestCancelGenerationRequiresRealAdapterCancellation(t *testing.T) {
	unsupported := lifecycleProfile("cancel-unsupported", []string{"poll"}, false)
	restore := useLifecycleTestAdapter(unsupported, lifecycleFakeAdapter{})
	defer restore()
	task := createLifecycleTask(t, unsupported, model.TaskStatusRunning, "provider-unsupported", 0)

	_, err := CancelGeneration(context.Background(), task.UserID, task.ID)
	var operationErr GenerationOperationError
	if !errors.As(err, &operationErr) || operationErr.Code != "CANCEL_UNSUPPORTED" {
		t.Fatalf("error=%#v, want CANCEL_UNSUPPORTED", err)
	}
	stored, _ := repository.GetGenerationTaskByID(task.ID)
	if stored.Status != model.TaskStatusRunning {
		t.Fatalf("status=%s, want running", stored.Status)
	}
}

func TestCancelGenerationUsesProviderDecisionAndSettlesOnce(t *testing.T) {
	var cancels atomic.Int32
	adapter := lifecycleFakeAdapter{cancel: func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
		cancels.Add(1)
		return ProviderTaskRef{ID: "provider-cancel", Status: model.TaskStatusCancelled}, nil
	}}
	profile := lifecycleProfile("cancel-supported", []string{"poll"}, true)
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()

	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-cancel", 2)
	first, err := CancelGeneration(context.Background(), task.UserID, task.ID)
	if err != nil || first.Status != model.TaskStatusCancelled {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	second, err := CancelGeneration(context.Background(), task.UserID, task.ID)
	if err != nil || second.Status != model.TaskStatusCancelled || cancels.Load() != 1 {
		t.Fatalf("second=%#v cancels=%d err=%v", second, cancels.Load(), err)
	}
	logs, _, err := repository.ListCreditLogsByUserID(task.UserID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 1 || logs[0].Type != model.CreditLogTypeAIRefund {
		t.Fatalf("logs=%#v err=%v", logs, err)
	}
}

func TestCancelAndSuccessRaceProducesOneTerminalDecision(t *testing.T) {
	profile := lifecycleProfile("cancel-race", []string{"callback", "poll"}, true)
	adapter := lifecycleFakeAdapter{cancel: func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
		time.Sleep(5 * time.Millisecond)
		return ProviderTaskRef{ID: "provider-race", Status: model.TaskStatusCancelled}, nil
	}}
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "file-race", MimeType: "video/mp4"}, nil
	}
	task := createLifecycleTask(t, profile, model.TaskStatusRunning, "provider-race", 0)
	errors := make(chan error, 2)
	go func() {
		_, err := CancelGeneration(context.Background(), task.UserID, task.ID)
		errors <- err
	}()
	go func() {
		errors <- resolveGenerationTask(context.Background(), task, profile, ProviderTaskRef{ID: "provider-race", Status: model.TaskStatusSucceeded, VideoURL: "https://example.com/video.mp4"}, "poll")
	}()
	for range 2 {
		if err := <-errors; err != nil && generationOperationCode(err) != "CANCEL_PENDING" {
			t.Fatalf("race operation: %v", err)
		}
	}
	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || (stored.Status != model.TaskStatusSucceeded && stored.Status != model.TaskStatusCancelled) {
		t.Fatalf("stored=%#v err=%v", stored, err)
	}
	events, err := repository.ListGenerationTaskEvents(task.ID)
	terminal := 0
	for _, event := range events {
		if event.Type == "terminal" {
			terminal++
		}
	}
	if err != nil || terminal != 1 {
		t.Fatalf("events=%#v terminal=%d err=%v", events, terminal, err)
	}
}

func lifecycleProfile(id string, completion []string, cancellation bool) model.GenerationProfile {
	return model.GenerationProfile{
		ID: id, Version: 1, AdapterKey: "lifecycle-fake", UpstreamModel: "fake-model",
		Intents:      []model.GenerationIntentKind{model.IntentVideoGenerate},
		Capabilities: model.GenerationCapabilities{Settings: map[string]model.GenerationSettingDefinition{}, Completion: completion, Cancellation: cancellation},
	}
}

func useLifecycleTestAdapter(profile model.GenerationProfile, adapter lifecycleFakeAdapter) func() {
	previousProfiles := generationProfiles
	previousFactory := generationAdapterFor
	previousRoute := generationRouteChannel
	generationProfiles = func() []model.GenerationProfile { return []model.GenerationProfile{profile} }
	generationAdapterFor = func(string) (GenerationAdapter, bool) { return adapter, true }
	generationRouteChannel = func(string, string) (model.ModelChannel, error) { return model.ModelChannel{}, nil }
	return func() {
		generationProfiles = previousProfiles
		generationAdapterFor = previousFactory
		generationRouteChannel = previousRoute
	}
}

func createLifecycleTask(t *testing.T, profile model.GenerationProfile, status model.TaskStatus, upstreamID string, credits int64) model.GenerationTask {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	userID := "lifecycle-user-" + uuid.NewString()
	if credits > 0 {
		if _, err := repository.SaveUser(model.User{ID: userID, Username: "lifecycle-" + uuid.NewString(), AffCode: "aff-" + uuid.NewString(), Role: model.UserRoleUser, Credits: credit(0), CreatedAt: now, UpdatedAt: now}); err != nil {
			t.Fatalf("save user: %v", err)
		}
	}
	task := model.GenerationTask{
		ID: "lifecycle-task-" + uuid.NewString(), UserID: userID, TaskType: model.TaskTypeVideo, Status: status, Credits: credit(credits),
		ModelProfileID: profile.ID, AdapterKey: profile.AdapterKey, UpstreamModel: profile.UpstreamModel, UpstreamTaskID: upstreamID,
		CallbackToken: "callback-" + uuid.NewString(), IntentKind: string(model.IntentVideoGenerate), CreatedAt: now, UpdatedAt: now,
	}
	command, _ := json.Marshal(model.GenerationCommand{CommandVersion: 1, Intent: model.GenerationIntent{Kind: model.IntentVideoGenerate, Prompt: "lifecycle"}})
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CommandBody: string(command), CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}
	return task
}

func hasGenerationEvent(events []model.GenerationTaskEvent, eventType string) bool {
	for _, event := range events {
		if event.Type == eventType {
			return true
		}
	}
	return false
}
