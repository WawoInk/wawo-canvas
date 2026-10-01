package service

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
	"github.com/google/uuid"
)

func TestCanvasVideoRecoveryDoesNotRequireSubmittedInputs(t *testing.T) {
	profile := lifecycleProfile("submitted-input-recovery", []string{"poll"}, false)
	adapter := lifecycleFakeAdapter{
		create: func(context.Context, AdapterCreateRequest) (ProviderTaskRef, error) {
			return ProviderTaskRef{}, fmt.Errorf("submitted generation must not be recreated")
		},
		poll: func(_ context.Context, _ model.ModelChannel, id string) (ProviderTaskRef, error) {
			if id != "provider-submitted" {
				return ProviderTaskRef{}, fmt.Errorf("unexpected upstream identity %q", id)
			}
			return ProviderTaskRef{ID: id, Status: model.TaskStatusSucceeded, VideoURL: "https://example.invalid/video.mp4"}, nil
		},
	}
	restore := useLifecycleTestAdapter(profile, adapter)
	defer restore()
	previousPersist := generationPersistVideo
	defer func() { generationPersistVideo = previousPersist }()
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
		return &model.UserFile{ID: "recovered-video", MimeType: "video/mp4"}, nil
	}

	for _, unavailable := range []string{"deleted reference", "expired audit payload"} {
		t.Run(unavailable, func(t *testing.T) {
			key := uuid.NewString()
			now := time.Now().UTC()
			task := model.GenerationTask{
				ID: "submitted-input-task-" + key, UserID: "submitted-input-user-" + key,
				TaskType: model.TaskTypeVideo, Source: string(model.SourceCanvas), Status: model.TaskStatusRunning,
				CommandVersion: 1, IntentKind: string(model.IntentVideoGenerate), ModelProfileID: profile.ID,
				AdapterKey: profile.AdapterKey, UpstreamModel: profile.UpstreamModel, UpstreamTaskID: "provider-submitted",
				WorkerLeaseOwner: "expired-worker", WorkerLeaseExpiresAt: now.Add(-time.Minute).Format(time.RFC3339Nano),
				CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano),
			}
			fileID := "submitted-input-file-" + key
			command, err := json.Marshal(model.GenerationCommand{CommandVersion: 1, Intent: model.GenerationIntent{
				Kind: model.IntentVideoGenerate, Prompt: "continue submitted generation",
				References: model.GenerationReferences{Images: []model.MediaReference{{FileID: fileID}}},
			}})
			if err != nil {
				t.Fatal(err)
			}
			if err := repository.CreateGenerationTask(task, model.GenerationPayload{ID: "submitted-input-payload-" + key, CommandBody: string(command), CreatedAt: task.CreatedAt}); err != nil {
				t.Fatal(err)
			}
			if unavailable == "deleted reference" {
				if err := repository.CreateUserFile(model.UserFile{ID: fileID, UserID: task.UserID, FileType: "images"}); err != nil {
					t.Fatal(err)
				}
				if _, err := repository.DeleteUserFile(fileID, task.UserID); err != nil {
					t.Fatal(err)
				}
			} else {
				db, err := repository.DB()
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Where("task_id = ?", task.ID).Delete(&model.GenerationPayload{}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if !processGenerationTask(context.Background(), task.ID, "recovery-worker-"+key) {
				t.Fatal("expired generation lease was not recovered")
			}
			result, err := GetGeneration(task.UserID, task.ID)
			if err != nil || result.Status != model.TaskStatusSucceeded || result.Result == nil || result.Result.File.FileID != "recovered-video" {
				t.Fatalf("recovery with %s: result=%#v err=%v", unavailable, result, err)
			}
		})
	}
}

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
	generationPersistVideo = func(context.Context, model.GenerationTask, string) (*model.UserFile, error) {
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
