package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestLegacyViduPollingRecordsUpstreamCreditsIncludingNull(t *testing.T) {
	for _, testCase := range []struct {
		name            string
		response        string
		upstreamCredits *model.Decimal
	}{
		{name: "credits", response: `{"id":"vidu-upstream","model":"vidu_hq_t2v-oversea(文生视频)","status":"succeeded","credits":18}`, upstreamCredits: func() *model.Decimal { value := credit(18); return &value }()},
		{name: "null", response: `{"id":"vidu-upstream","model":"vidu_hq_t2v-oversea(文生视频)","status":"succeeded"}`},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(testCase.response))
			}))
			t.Cleanup(server.Close)

			now := time.Now().UTC().Format(time.RFC3339Nano)
			task := model.GenerationTask{ID: "legacy-vidu-" + uuid.NewString(), UserID: "compat-user", TaskType: model.TaskTypeVideo, Model: "vidu_hq_t2v-oversea", Status: model.TaskStatusRunning, UpstreamTaskID: "vidu-upstream", CreatedAt: now, UpdatedAt: now}
			if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "payload-" + uuid.NewString(), CreatedAt: now}); err != nil {
				t.Fatalf("create task: %v", err)
			}

			status, result := queryUpstreamTaskViaHTTP(TaskSyncConfig{GenTaskID: task.ID, UpstreamTaskID: task.UpstreamTaskID, Channel: model.ModelChannel{BaseURL: server.URL}})
			OnTaskCompleted(task.ID, status, result)

			stored, err := repository.GetGenerationTaskByID(task.ID)
			if err != nil {
				t.Fatalf("get task: %v", err)
			}
			if testCase.upstreamCredits == nil {
				if stored.UpstreamCredits != nil {
					t.Fatalf("upstream credits = %v, want nil", *stored.UpstreamCredits)
				}
			} else if stored.UpstreamCredits == nil || !stored.UpstreamCredits.Equal(*testCase.upstreamCredits) {
				t.Fatalf("upstream credits = %#v, want %s", stored.UpstreamCredits, testCase.upstreamCredits.String())
			}
			payload, err := repository.GetGenerationPayloadByTaskID(task.ID)
			if err != nil {
				t.Fatalf("get payload: %v", err)
			}
			var audit map[string]any
			if err := json.Unmarshal([]byte(payload.ResponseBody), &audit); err != nil {
				t.Fatalf("unmarshal response body: %v", err)
			}
			credits, ok := audit["credits"]
			if !ok || (testCase.upstreamCredits == nil && credits != nil) || (testCase.upstreamCredits != nil && credits != float64(18)) {
				t.Fatalf("logged credits = %#v, present=%t", credits, ok)
			}
		})
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
