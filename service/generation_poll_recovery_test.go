package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

func TestCanvasVideoTransientPollKeepsTaskIdentity(t *testing.T) {
	runCanvasVideoTransientPoll(t, false, false)
}
func TestCanvasVideoRecoveryTransientPollDoesNotFailTask(t *testing.T) {
	runCanvasVideoTransientPoll(t, true, false)
}
func TestCanvasVideoExpiredRecoveryStillPollsSuccessfulTask(t *testing.T) {
	runCanvasVideoTransientPoll(t, true, true)
}

func runCanvasVideoTransientPoll(t *testing.T, recovered, expired bool) {
	if _, err := repository.DB(); err != nil {
		t.Fatal(err)
	}
	profile := lifecycleProfile("transient-poll", []string{"poll"}, false)
	var ids []string
	creates := 0
	adapter := lifecycleFakeAdapter{create: func(context.Context, AdapterCreateRequest) (ProviderTaskRef, error) {
		creates++
		return ProviderTaskRef{ID: "provider-stable", Status: model.TaskStatusRunning}, nil
	}, poll: func(_ context.Context, _ model.ModelChannel, id string) (ProviderTaskRef, error) {
		ids = append(ids, id)
		if !expired && len(ids) == 1 {
			return ProviderTaskRef{Error: generationTransportErrorFrom(context.DeadlineExceeded)}, context.DeadlineExceeded
		}
		if id != "provider-stable" {
			return ProviderTaskRef{Error: mapGenerationHTTPError(404)}, fmt.Errorf("wrong poll task ID %q", id)
		}
		return ProviderTaskRef{ID: id, Status: model.TaskStatusSucceeded, VideoURL: "https://example.invalid/video.mp4"}, nil
	}}
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	oldPoll, oldMax, oldTimeout, oldPersist := generationPollInterval, generationPollIntervalMax, generationTaskTimeout, generationPersistVideo
	defer func() {
		generationPollInterval, generationPollIntervalMax, generationTaskTimeout, generationPersistVideo = oldPoll, oldMax, oldTimeout, oldPersist
	}()
	generationPollInterval = time.Millisecond
	generationPollIntervalMax = time.Millisecond
	generationTaskTimeout = 100 * time.Millisecond
	generationPersistVideo = func(context.Context, string, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "materialized-result", MimeType: "video/mp4"}, nil
	}
	upstreamID, wantCreates := "", 1
	if recovered {
		upstreamID, wantCreates = "provider-stable", 0
	}
	task := createLifecycleTask(t, profile, model.TaskStatusRunning, upstreamID, 0)
	if expired {
		task.CreatedAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	}
	executeGeneration(context.Background(), task, profile, model.ModelChannel{})
	stored, err := repository.GetGenerationTaskByID(task.ID)
	t.Logf("poll IDs=%q; status=%s; error=%s; retryable=%v", ids[:min(len(ids), 4)], stored.Status, stored.ErrorCode, stored.ErrorRetryable)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Errorf("temporary poll error must recover to success, got status=%s code=%s", stored.Status, stored.ErrorCode)
	}
	result := firstPartyTask(stored).Result
	if stored.UpstreamTaskID != "provider-stable" || result == nil || result.File.FileID != "materialized-result" {
		t.Errorf("upstream ID=%q result=%#v, want original ID and materialized file", stored.UpstreamTaskID, result)
	}
	if creates != wantCreates {
		t.Errorf("creates=%d, want %d", creates, wantCreates)
	}
	logs, _, err := repository.ListCreditLogsByUserID(task.UserID, model.Query{PageSize: 20})
	if err != nil || len(logs) != 0 {
		t.Errorf("unexpected credit logs=%#v err=%v", logs, err)
	}
	for _, id := range ids {
		if id != "provider-stable" {
			t.Fatalf("poll task ID changed: %q", ids)
		}
	}
}
