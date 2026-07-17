package service

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestLegacyCompatibilityTerminalNotificationsArbitrateOnce(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	task := model.GenerationTask{ID: "compat-terminal-" + uuid.NewString(), UserID: "compat-user", TaskType: model.TaskTypeVideo, Model: "compat-model", Status: model.TaskStatusRunning, UpstreamTaskID: "compat-upstream", CreatedAt: now, UpdatedAt: now}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}

	OnTaskCompleted(task.ID, model.TaskStatusSuccess, TaskResult{ResponseBody: `{"status":"succeeded"}`})
	OnTaskCompleted(task.ID, model.TaskStatusFailed, TaskResult{ErrorCode: "LATE_FAILURE", ErrorMessage: "late"})

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || stored.ErrorCode != "" {
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

func TestAcceptedCompatibilityWorkerPollsWithoutCreating(t *testing.T) {
	var creates atomic.Int32
	var polls atomic.Int32
	profile := lifecycleProfile("compat-profile", []string{"poll"}, false)
	adapter := lifecycleFakeAdapter{
		create: func(context.Context, AdapterCreateRequest) (ProviderTaskRef, error) {
			creates.Add(1)
			return ProviderTaskRef{}, nil
		},
		poll: func(context.Context, model.ModelChannel, string) (ProviderTaskRef, error) {
			polls.Add(1)
			return ProviderTaskRef{ID: "compat-provider", Status: model.TaskStatusFailed, Error: &model.GenerationError{Code: "COMPAT_FAILED", Message: "failed"}}, nil
		},
	}
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()

	now := time.Now().UTC().Format(time.RFC3339Nano)
	task := model.GenerationTask{
		ID: "compat-worker-" + uuid.NewString(), UserID: "compat-user", TaskType: model.TaskTypeVideo, Model: profile.UpstreamModel,
		Status: model.TaskStatusRunning, CommandVersion: 0, ModelProfileID: profile.ID, ProfileVersion: profile.Version,
		AdapterKey: profile.AdapterKey, UpstreamModel: profile.UpstreamModel, UpstreamTaskID: "compat-provider", ChannelID: "compat-channel",
		WorkerLeaseOwner: "compat-worker", WorkerLeaseExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), CreatedAt: now, UpdatedAt: now,
	}
	if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
		t.Fatalf("create task: %v", err)
	}

	processClaimedGenerationTask(context.Background(), task, "compat-worker")

	stored, err := repository.GetGenerationTaskByID(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.ErrorCode != "COMPAT_FAILED" || stored.WorkerLeaseOwner != "" || stored.WorkerLeaseExpiresAt != "" || creates.Load() != 0 || polls.Load() != 1 {
		t.Fatalf("stored=%#v creates=%d polls=%d err=%v", stored, creates.Load(), polls.Load(), err)
	}
}
